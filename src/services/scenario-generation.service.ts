import { v4 as uuidv4 } from "uuid";
import { getProjectDb } from "@/db/project-db";
import {
  buildContinuityGroups,
  getMainShots,
  mergeScenarioChunkPlans,
  type PlannedMainShot,
  shouldChunkScenarioAnalysis,
  splitScenarioIntoChunks,
} from "@/lib/scenario-generation-utils";
import {
  buildPass1SystemPrompt,
  buildShotGeneratorSystemPrompt,
  describePlannedChainStatus,
  validatePass1Output,
  validateShotGeneratorMarkdown,
} from "@/lib/scenario-prompts";
import { getAppSettings } from "@/lib/store";
import type {
  GeneratedShot,
  GeneratedShotFile,
  GenerationProgress,
  GenerationResult,
  KlingPreset,
  PassLog,
  ScenarioBatchPlan,
  ScenarioSceneUnit,
  ScenarioShotSizing,
  ScenePlan,
  ShotPlan,
  ShotPlanItem,
  TargetVideoModel,
} from "@/lib/scenario-types";
import { logCost } from "@/services/cost.service";
import {
  autoCloseJsonDelimiters,
  extractJsonObject,
  runScenarioLLM,
} from "@/services/llm.service";
import { useProjectStore } from "@/store/project.store";

function ensureActiveProject() {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje bulunamadi.");
  }

  return project;
}

async function logGenerationPass(params: {
  scenarioId: string;
  passName: string;
  model: string;
  costUsd: number;
  durationMs: number;
}): Promise<void> {
  const db = await getProjectDb();

  await db.execute(
    `INSERT INTO scenario_generation_logs (id, scenario_id, pass_name, model, cost_usd, duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuidv4(),
      params.scenarioId,
      params.passName,
      params.model,
      params.costUsd,
      params.durationMs,
      Date.now(),
    ],
  );
}

async function callLLMWithRetry(params: {
  systemPrompt: string;
  userPrompt: string;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ content: string; model: string; finishReason: string | null }> {
  const maxRetries = params.maxRetries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await runScenarioLLM({
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        model: params.model,
        temperature: params.temperature ?? 0.15,
        maxTokens: params.maxTokens,
        abortSignal: params.abortSignal,
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (params.abortSignal?.aborted) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("LLM cagrisi basarisiz.");
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }

  return new Error(fallback);
}

function parseScenarioPlanContent(params: {
  content: string;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
}): ShotPlan {
  const jsonContent = extractJsonObject(params.content);
  const candidates = [
    jsonContent,
    autoCloseJsonDelimiters(jsonContent),
  ].filter((candidate, index, source): candidate is string =>
    Boolean(candidate) && source.indexOf(candidate) === index,
  );
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      return enrichShotPlan(
        validatePass1Output(candidate),
        params.targetModel,
        params.klingPreset,
      );
    } catch (error) {
      lastError = toError(error, "Shot plan parse edilemedi.");
    }
  }

  throw lastError ?? new Error("Shot plan parse edilemedi.");
}

function buildPass1RetryPrompt(scenarioText: string): string {
  return [
    "CRITICAL RETRY: Your previous response was invalid JSON or got truncated.",
    "Regenerate the FULL shot plan from scratch.",
    "Return ONLY one valid JSON object.",
    'Use this root shape exactly: {"scenes":[...],"totalMainShots":0,"totalCoverageShots":0,"estimatedDurationS":0,"tensionArc":[...],"dialogueNamePolicy":"preserve","targetModel":"veo31"}.',
    "Do not use markdown fences, comments, trailing commas, or explanatory text.",
    "Double-check that every opened [ or { is fully closed before you stop.",
    "",
    "SCENARIO",
    scenarioText,
  ].join("\n");
}

function buildPass1ChunkPrompt(chunkText: string, chunkIndex: number, chunkCount: number): string {
  return [
    `SCENARIO CHUNK ${chunkIndex}/${chunkCount}`,
    "Plan ONLY the scenes that appear in this chunk.",
    "Scene numbers and shot numbers may restart inside this chunk.",
    "Do not reference content outside the chunk.",
    "Return the same JSON contract as the full-plan mode.",
    "",
    chunkText,
  ].join("\n");
}

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function inferSceneUnit(scene: ScenePlan, totalScenes: number): ScenarioSceneUnit {
  const mainShots = scene.shots.filter((shot) => shot.type === "main");
  const dialogueCount = mainShots.filter((shot) => shot.hasDialogue).length;
  const sceneTypes = new Set(mainShots.map((shot) => shot.sceneType).filter(Boolean));
  const hasAction = sceneTypes.has("action") || scene.tensionLevel >= 4;
  const hasSuspense = sceneTypes.has("suspense");
  const hasEmotion = sceneTypes.has("emotional");
  const isFirstScene = scene.sceneNumber === 1;
  const isLastScene = scene.sceneNumber === totalScenes;
  const dramaticFunction =
    isFirstScene ? "setup"
      : isLastScene ? "payoff"
      : hasAction || hasSuspense ? "escalation"
      : hasEmotion ? "reaction"
      : "transition";
  const pacePressure =
    hasAction ? "compressed"
      : hasEmotion || dialogueCount >= Math.max(2, Math.ceil(mainShots.length / 2)) ? "extended"
      : "standard";
  const dialogueDensity =
    dialogueCount === 0 ? "none"
      : dialogueCount >= Math.max(3, mainShots.length - 1) ? "dense"
      : dialogueCount >= 2 ? "medium"
      : "light";
  const motionDensity =
    hasAction ? "high"
      : scene.tensionLevel >= 3 ? "moderate"
      : "still";
  const spatialComplexity =
    hasAction || hasSuspense ? "layered"
      : sceneTypes.has("dialogue") && dialogueCount >= 2 ? "reset-required"
      : "simple";
  const coverageNeed =
    hasAction || dialogueCount >= 2 ? "high"
      : scene.tensionLevel >= 3 ? "medium"
      : "low";
  const minShots = Math.max(2, mainShots.length);
  const maxShots = Math.max(minShots, minShots + (coverageNeed === "high" ? 2 : 1));
  const targetShots = mainShots.length;

  return {
    sceneId: `S${padNumber(scene.sceneNumber)}`,
    dramaticFunction,
    pacePressure,
    dialogueDensity,
    motionDensity,
    spatialComplexity,
    coverageNeed,
    minShots,
    targetShots,
    maxShots,
    reason:
      `${scene.title}: ${mainShots.length} main shot ile ${scene.summaryTr || "dramatic beat"} korunuyor; ` +
      `${coverageNeed === "high" ? "coverage yuksek" : "coverage dengeli"}, ` +
      `${spatialComplexity === "layered" ? "spatial staging dikkat istiyor" : "sahne net okunuyor"}.`,
  };
}

function buildShotSizing(plan: ShotPlan): ScenarioShotSizing {
  const sceneUnits = plan.scenes.map((scene) => inferSceneUnit(scene, plan.scenes.length));
  const minFunctionalShots = sceneUnits.reduce((sum, unit) => sum + unit.minShots, 0);
  const maxTastefulShots = sceneUnits.reduce((sum, unit) => sum + unit.maxShots, 0);

  return {
    method: "director-paced-balance",
    minFunctionalShots,
    maxTastefulShots,
    selectedTargetShots: plan.totalMainShots,
    globalRationale:
      `${plan.scenes.length} sahne boyunca ${plan.totalMainShots} ana shot secildi. ` +
      "Plan, dialog power shift ve aksiyon fazlarini ayirirken gereksiz yapay kesmeyi engelliyor.",
    sceneUnits,
  };
}

function resolveBatchSizeTarget(totalMainShots: number): number {
  if (totalMainShots <= 8) {
    return 4;
  }

  if (totalMainShots <= 15) {
    return 4;
  }

  if (totalMainShots <= 25) {
    return 5;
  }

  return 6;
}

function buildBatches(plan: ShotPlan): ScenarioBatchPlan[] {
  const mainShots = getMainShots(plan);
  const batchSizeTarget = resolveBatchSizeTarget(mainShots.length);
  const batches: ScenarioBatchPlan[] = [];

  for (let index = 0; index < mainShots.length; index += batchSizeTarget) {
    const chunk = mainShots.slice(index, index + batchSizeTarget);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    const next = mainShots[index + batchSizeTarget];

    if (!first || !last) {
      continue;
    }

    batches.push({
      batchId: `B${padNumber(batches.length + 1)}`,
      shotStart: first.shot.shotNumber,
      shotEnd: last.shot.shotNumber,
      chainEntry:
        first.shot.prevShotRef ?
          `CHAINED from ${first.shot.prevShotRef}_END`
        : `FIRST SHOT - ${first.scene.title}`,
      chainExitTarget: next?.shot.shotNumber ?? null,
    });
  }

  return batches;
}

function enrichShotPlan(
  plan: ShotPlan,
  targetModel: TargetVideoModel,
  klingPreset?: KlingPreset,
): ShotPlan {
  return {
    ...plan,
    targetModel,
    klingPreset,
    shotSizing: plan.shotSizing ?? buildShotSizing(plan),
    batches: plan.batches ?? buildBatches(plan),
  };
}

function buildSyntheticShotSourceFile(
  scenarioId: string,
  sceneNumber: number,
  shotNumber: string,
): string {
  return `scenario/${scenarioId}/act-01/scene-${padNumber(sceneNumber)}/${shotNumber}.md`;
}

function buildShotGeneratorUserPrompt(params: {
  scenarioText: string;
  scene: ScenePlan;
  mainShot: ShotPlanItem;
  coveragePlan: ShotPlanItem[];
  previousGeneratedMainShot: GeneratedShot | null;
  nextMainShot: ShotPlanItem | null;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  validationFeedback?: string;
}): string {
  const presetLabel =
    params.targetModel === "kling-3.0" ? (params.klingPreset ?? "ultra-realism") : "veo-default";
  const chainStatus = describePlannedChainStatus(params.mainShot);

  return [
    "LEAD DIRECTOR BRIEF",
    `Target model: ${params.targetModel}`,
    `Preset: ${presetLabel}`,
    `Scene ${params.scene.sceneNumber}: ${params.scene.title}`,
    `Scene summary (TR): ${params.scene.summaryTr}`,
    "",
    "SHOT ASSIGNMENT",
    `Main shot: ${params.mainShot.shotNumber}`,
    `Duration: ${params.mainShot.durationS}s`,
    `Tension: ${params.mainShot.tensionLevel}/5`,
    `Shot summary (TR): ${params.mainShot.summaryTr}`,
    `Chain status: ${chainStatus}`,
    params.mainShot.hasDialogue ?
      `Dialogue preview: ${params.mainShot.dialoguePreview ?? "Speaker-tagged dialogue required."}`
    : "Dialogue preview: NONE",
    "",
    "COVERAGE REQUIRED IN THE SAME FILE",
    ...params.coveragePlan.map((coverage) =>
      `- ${coverage.shotNumber} | ${coverage.coverageType ?? "coverage"} | ${coverage.durationS}s | ${coverage.summaryTr}`,
    ),
    "",
    "SCENARIO SOURCE",
    params.scenarioText,
    "",
    "CONTINUITY INPUT",
    params.previousGeneratedMainShot?.promptEnd ?
      [
        `Previous approved main shot: ${params.previousGeneratedMainShot.shotNumber}`,
        `Use this END frame as the continuity anchor for ${params.mainShot.shotNumber}:`,
        params.previousGeneratedMainShot.promptEnd,
      ].join("\n")
    : "This is the opening shot. Create a true first frame.",
    params.nextMainShot ?
      `\nNEXT MAIN SHOT TARGET\n${params.nextMainShot.shotNumber}: ${params.nextMainShot.summaryTr}`
    : "\nNEXT MAIN SHOT TARGET\nThis shot closes the current sequence cleanly.",
    "",
    "DELIVERY REQUIREMENTS",
    "- Return the full SHOT markdown file only.",
    "- Main shot and coverage must live in the same file.",
    "- Visual prompts must stay in English.",
    "- Turkish summaries should remain Turkish.",
    "- Dialogue inside Audio direction stays in original language.",
    "- Music must be NONE unless explicitly requested. Here it is NOT requested.",
    params.validationFeedback ? `\nVALIDATION FEEDBACK FROM PREVIOUS ATTEMPT\n${params.validationFeedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateSingleShotFile(params: {
  scenarioId: string;
  scenarioText: string;
  scene: ScenePlan;
  mainShot: ShotPlanItem;
  coveragePlan: ShotPlanItem[];
  previousGeneratedMainShot: GeneratedShot | null;
  nextMainShot: ShotPlanItem | null;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  llmModel: string;
  abortSignal?: AbortSignal;
}): Promise<{
  model: string;
  shotFile: GeneratedShotFile;
  shots: GeneratedShot[];
}> {
  const systemPrompt = buildShotGeneratorSystemPrompt(
    params.targetModel,
    params.klingPreset,
  );
  const sourceFile = buildSyntheticShotSourceFile(
    params.scenarioId,
    params.scene.sceneNumber,
    params.mainShot.shotNumber,
  );
  let validationFeedback = "";
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await callLLMWithRetry({
      systemPrompt,
      userPrompt: buildShotGeneratorUserPrompt({
        scenarioText: params.scenarioText,
        scene: params.scene,
        mainShot: params.mainShot,
        coveragePlan: params.coveragePlan,
        previousGeneratedMainShot: params.previousGeneratedMainShot,
        nextMainShot: params.nextMainShot,
        targetModel: params.targetModel,
        klingPreset: params.klingPreset,
        validationFeedback,
      }),
      model: params.llmModel,
      abortSignal: params.abortSignal,
      maxRetries: 0,
      maxTokens: 5200,
      temperature: 0.2,
    });

    try {
      const validated = validateShotGeneratorMarkdown({
        markdown: result.content,
        sourceFile,
        scene: params.scene,
        mainShot: params.mainShot,
        coveragePlan: params.coveragePlan,
        targetModel: params.targetModel,
        klingPreset: params.klingPreset,
      });

      return {
        model: result.model,
        shotFile: {
          shotNumber: params.mainShot.shotNumber,
          sourceFile,
          markdown: validated.markdown,
        },
        shots: validated.shots,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      validationFeedback =
        `${lastError.message}\nRegenerate the entire markdown file from scratch and fix ALL contract violations.`;
    }
  }

  throw lastError ?? new Error(`${params.mainShot.shotNumber} uretilemedi.`);
}

function validateContinuityGate(plan: ShotPlan, shots: GeneratedShot[]): string[] {
  const issues: string[] = [];
  const mainShots = shots.filter((shot) => shot.parentShotNumber === null);
  const byShotNumber = new Map(shots.map((shot) => [shot.shotNumber, shot] as const));

  if (mainShots.length !== plan.totalMainShots) {
    issues.push(`Ana shot sayisi uyusmuyor. Beklenen ${plan.totalMainShots}, gelen ${mainShots.length}.`);
  }

  if (shots.length !== plan.totalMainShots + plan.totalCoverageShots) {
    issues.push(
      `Toplam shot sayisi uyusmuyor. Beklenen ${plan.totalMainShots + plan.totalCoverageShots}, gelen ${shots.length}.`,
    );
  }

  for (const scene of plan.scenes) {
    for (const plannedShot of scene.shots.filter((shot) => shot.type === "main")) {
      const generatedShot = byShotNumber.get(plannedShot.shotNumber);

      if (!generatedShot) {
        issues.push(`${plannedShot.shotNumber} uretilemedi.`);
        continue;
      }

      if (plannedShot.chainStatus === "chained" && generatedShot.prevShotRef !== plannedShot.prevShotRef) {
        issues.push(
          `${plannedShot.shotNumber} continuity ref uyusmuyor. Beklenen ${plannedShot.prevShotRef ?? "none"}, gelen ${generatedShot.prevShotRef ?? "none"}.`,
        );
      }

      const coverageCount = shots.filter((shot) => shot.parentShotNumber === plannedShot.shotNumber).length;
      const expectedCoverageCount = scene.shots.filter(
        (shot) => shot.type === "coverage" && shot.parentShotNumber === plannedShot.shotNumber,
      ).length;

      if (coverageCount !== expectedCoverageCount) {
        issues.push(
          `${plannedShot.shotNumber} coverage sayisi uyusmuyor. Beklenen ${expectedCoverageCount}, gelen ${coverageCount}.`,
        );
      }
    }
  }

  return issues;
}

function validateDeliveryGate(shots: GeneratedShot[], shotFiles: GeneratedShotFile[]): string[] {
  const issues: string[] = [];
  const fileSet = new Set(shotFiles.map((file) => file.shotNumber));

  for (const shot of shots) {
    if (!shot.promptVideo || !/Audio direction\s*:/i.test(shot.promptVideo)) {
      issues.push(`${shot.shotNumber} video prompt'unda Audio direction eksik.`);
    }

    if (shot.promptVideo && !/Music:\s*NONE/i.test(shot.promptVideo)) {
      issues.push(`${shot.shotNumber} video prompt'unda Music NONE degil.`);
    }

    if (!shot.sourceFile) {
      issues.push(`${shot.shotNumber} source file metadata'si eksik.`);
    }
  }

  for (const shotFile of shotFiles) {
    if (!fileSet.has(shotFile.shotNumber) || !shotFile.markdown.trim()) {
      issues.push(`${shotFile.shotNumber} markdown dosyasi bos.`);
    }
  }

  return issues;
}

// ─── PASS 1: ANALYZE SCENARIO ─────────────────────────────────────────

async function analyzeScenarioInChunks(params: {
  scenarioText: string;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  llmModel: string;
  abortSignal?: AbortSignal;
}): Promise<{ plan: ShotPlan; model: string; chunkCount: number }> {
  const chunks = splitScenarioIntoChunks(params.scenarioText);
  const systemPrompt = buildPass1SystemPrompt(params.targetModel);
  const plans: ShotPlan[] = [];
  let lastModel = params.llmModel;

  for (let index = 0; index < chunks.length; index += 1) {
    if (params.abortSignal?.aborted) {
      throw new Error("Senaryo analizi iptal edildi.");
    }

    let result = await callLLMWithRetry({
      systemPrompt,
      userPrompt: buildPass1ChunkPrompt(chunks[index] ?? "", index + 1, chunks.length),
      model: params.llmModel,
      abortSignal: params.abortSignal,
      maxTokens: 7000,
      temperature: 0.08,
    });

    let plan: ShotPlan | null = null;
    let parseError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        plan = parseScenarioPlanContent({
          content: result.content,
          targetModel: params.targetModel,
          klingPreset: params.klingPreset,
        });
        break;
      } catch (error) {
        parseError = toError(error, "Chunk shot plan parse edilemedi.");
      }

      if (params.abortSignal?.aborted || attempt === 1) {
        break;
      }

      result = await callLLMWithRetry({
        systemPrompt,
        userPrompt: buildPass1RetryPrompt(chunks[index] ?? ""),
        model: params.llmModel,
        abortSignal: params.abortSignal,
        maxRetries: 0,
        maxTokens: result.finishReason === "length" ? 10000 : 8000,
        temperature: 0.04,
      });
    }

    if (!plan) {
      throw new Error(
        `Chunk ${index + 1}/${chunks.length} planlanamadi: ${parseError?.message ?? "Bilinmeyen parse hatasi"}`,
      );
    }

    plans.push(plan);
    lastModel = result.model;
  }

  return {
    plan: enrichShotPlan(
      mergeScenarioChunkPlans({
        plans,
        targetModel: params.targetModel,
        klingPreset: params.klingPreset,
      }),
      params.targetModel,
      params.klingPreset,
    ),
    model: lastModel,
    chunkCount: chunks.length,
  };
}

async function generateContinuityGroup(params: {
  group: PlannedMainShot[];
  nextMainShotByNumber: Map<string, ShotPlanItem | null>;
  generatedByMainShot: Map<string, { model: string; shotFile: GeneratedShotFile; shots: GeneratedShot[] }>;
  completedCounter: { value: number };
  totalShots: number;
  workerLabel: string;
  scenarioId: string;
  scenarioText: string;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  llmModel: string;
  abortSignal?: AbortSignal;
  onProgress?: (status: GenerationProgress) => void;
  onLogEntry?: (pass: number, message: string, shotNumber?: string) => void;
  onShotCompleted?: (shotNumber: string) => void;
}): Promise<void> {
  let previousGeneratedMainShot: GeneratedShot | null = null;

  for (const { scene, shot } of params.group) {
    if (params.abortSignal?.aborted) {
      throw new Error("Uretim iptal edildi.");
    }

    const coveragePlan = scene.shots.filter(
      (candidate) =>
        candidate.type === "coverage" && candidate.parentShotNumber === shot.shotNumber,
    );
    const nextMainShot = params.nextMainShotByNumber.get(shot.shotNumber) ?? null;
    const completedShots = params.completedCounter.value;

    params.onProgress?.({
      currentPass: 2,
      passLabel: `${params.workerLabel} - Shot Generator`,
      shotNumber: shot.shotNumber,
      completedShots,
      totalShots: params.totalShots,
      percent: Math.min(78, 10 + Math.round((completedShots / Math.max(params.totalShots, 1)) * 68)),
    });
    params.onLogEntry?.(
      2,
      `${params.workerLabel} ${shot.shotNumber} icin shot-generator calisiyor`,
      shot.shotNumber,
    );

    const generated = await generateSingleShotFile({
      scenarioId: params.scenarioId,
      scenarioText: params.scenarioText,
      scene,
      mainShot: shot,
      coveragePlan,
      previousGeneratedMainShot,
      nextMainShot,
      targetModel: params.targetModel,
      klingPreset: params.klingPreset,
      llmModel: params.llmModel,
      abortSignal: params.abortSignal,
    });

    params.generatedByMainShot.set(shot.shotNumber, generated);
    previousGeneratedMainShot =
      generated.shots.find((candidate) => candidate.shotNumber === shot.shotNumber) ?? null;

    for (const generatedShot of generated.shots) {
      params.onShotCompleted?.(generatedShot.shotNumber);
      params.completedCounter.value += 1;
    }

    params.onLogEntry?.(
      2,
      `${params.workerLabel} ${shot.shotNumber} onaylandi (${coveragePlan.length} coverage ayni dosyada)`,
      shot.shotNumber,
    );
  }
}

export async function analyzeScenario(params: {
  scenarioText: string;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  llmModel: string;
  projectId: string;
  abortSignal?: AbortSignal;
}): Promise<{ plan: ShotPlan; scenarioId: string }> {
  const project = ensureActiveProject();
  const scenarioId = uuidv4();
  const db = await getProjectDb();
  const startTime = Date.now();

  await db.execute(
    `INSERT INTO scenarios (id, project_id, scenario_text, target_model, kling_preset, llm_model, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      scenarioId,
      params.projectId,
      params.scenarioText,
      params.targetModel,
      params.klingPreset ?? null,
      params.llmModel,
      "analyzing",
      Date.now(),
      Date.now(),
    ],
  );

  try {
    const systemPrompt = buildPass1SystemPrompt(params.targetModel);
    let result = await callLLMWithRetry({
      systemPrompt,
      userPrompt: params.scenarioText,
      model: params.llmModel,
      abortSignal: params.abortSignal,
      maxTokens: 7000,
      temperature: 0.1,
    });

    let plan: ShotPlan | null = null;
    let parseError: Error | null = null;
    let analysisModel = result.model;
    let analysisChunkCount = 1;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        plan = parseScenarioPlanContent({
          content: result.content,
          targetModel: params.targetModel,
          klingPreset: params.klingPreset,
        });
        break;
      } catch (error) {
        parseError = toError(error, "Shot plan parse edilemedi.");
      }

      if (params.abortSignal?.aborted || attempt === 1) {
        break;
      }

      result = await callLLMWithRetry({
        systemPrompt,
        userPrompt: buildPass1RetryPrompt(params.scenarioText),
        model: params.llmModel,
        abortSignal: params.abortSignal,
        maxRetries: 0,
        maxTokens: result.finishReason === "length" ? 10000 : 8000,
        temperature: 0.05,
      });
      analysisModel = result.model;
    }

    if (
      !plan &&
      !params.abortSignal?.aborted &&
      (result.finishReason === "length" || shouldChunkScenarioAnalysis(params.scenarioText))
    ) {
      const chunked = await analyzeScenarioInChunks({
        scenarioText: params.scenarioText,
        targetModel: params.targetModel,
        klingPreset: params.klingPreset,
        llmModel: params.llmModel,
        abortSignal: params.abortSignal,
      });

      plan = chunked.plan;
      analysisModel = chunked.model;
      analysisChunkCount = chunked.chunkCount;
    }

    if (!plan) {
      const snippet = result.content.slice(0, 300);
      const finishReasonNote =
        result.finishReason === "length" ?
          "\n\nNot: Model yaniti max token sinirinda kesildi. Sistem otomatik ikinci denemeyi yapti fakat plan hala toparlanamadi."
        : "";
      throw new Error(
        `AI yaniti gecerli JSON donduremedi. Tekrar deneyin veya senaryoyu kisaltin.\n\nHata: ${parseError?.message ?? "Bilinmeyen parse hatasi"}${finishReasonNote}\n\nYanit basi: ${snippet}`,
      );
    }

    const durationMs = Date.now() - startTime;

    await db.execute(
      `UPDATE scenarios SET shot_plan_json = $1, status = $2, updated_at = $3 WHERE id = $4`,
      [JSON.stringify(plan), "planned", Date.now(), scenarioId],
    );

    await logGenerationPass({
      scenarioId,
      passName: "pass1_lead_director",
      model: analysisModel,
      costUsd: 0.02 * analysisChunkCount,
      durationMs,
    });

    await logCost({
      projectId: project.id,
      model: analysisModel,
      type: "llm",
      amountUsd: 0.02 * analysisChunkCount,
    });

    return { plan, scenarioId };
  } catch (error) {
    await db.execute(
      `UPDATE scenarios SET status = $1, updated_at = $2 WHERE id = $3`,
      ["error", Date.now(), scenarioId],
    );
    throw error;
  }
}

// ─── PASS 2-5: GENERATE SHOTS ─────────────────────────────────────────

export async function generateShotsFromPlan(params: {
  scenarioId: string;
  scenarioText: string;
  plan: ShotPlan;
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  llmModel: string;
  projectId: string;
  abortSignal?: AbortSignal;
  onProgress?: (status: GenerationProgress) => void;
  onLogEntry?: (pass: number, message: string, shotNumber?: string) => void;
  onShotCompleted?: (shotNumber: string) => void;
}): Promise<GenerationResult> {
  const project = ensureActiveProject();
  const db = await getProjectDb();
  const passLogs: PassLog[] = [];
  const allGeneratedShots: GeneratedShot[] = [];
  const shotFiles: GeneratedShotFile[] = [];
  const allPlannedMainShots = getMainShots(params.plan);
  const nextMainShotByNumber = new Map(
    allPlannedMainShots.map((entry, index) => [
      entry.shot.shotNumber,
      allPlannedMainShots[index + 1]?.shot ?? null,
    ] as const),
  );
  const totalShots = params.plan.totalMainShots + params.plan.totalCoverageShots;
  let totalCostUsd = 0;
  const completedCounter = { value: 0 };
  let lastLLMModel = "openrouter/auto";

  await db.execute(
    `UPDATE scenarios SET status = $1, updated_at = $2 WHERE id = $3`,
    ["generating", Date.now(), params.scenarioId],
  );

  try {
    // ── Pass 2: Shot Generator ──
    const pass2Start = Date.now();
    const continuityGroups = buildContinuityGroups(params.plan);
    const { queueParallelLimit } = await getAppSettings();
    const workerCount = Math.max(1, Math.min(queueParallelLimit, continuityGroups.length || 1));
    const generatedByMainShot = new Map<
      string,
      { model: string; shotFile: GeneratedShotFile; shots: GeneratedShot[] }
    >();
    let nextGroupIndex = 0;

    params.onLogEntry?.(
      2,
      `${continuityGroups.length} continuity zinciri ${workerCount} worker ile baslatildi.`,
    );

    await Promise.all(
      Array.from({ length: workerCount }, async (_value, workerIndex) => {
        while (nextGroupIndex < continuityGroups.length) {
          const currentGroupIndex = nextGroupIndex;
          nextGroupIndex += 1;
          const group = continuityGroups[currentGroupIndex];

          if (!group || group.length === 0) {
            continue;
          }

          const workerLabel = `Worker ${workerIndex + 1}`;
          params.onLogEntry?.(
            2,
            `${workerLabel} ${group[0]?.shot.shotNumber}-${group[group.length - 1]?.shot.shotNumber} zincirine girdi.`,
          );

          await generateContinuityGroup({
            group,
            nextMainShotByNumber,
            generatedByMainShot,
            completedCounter,
            totalShots,
            workerLabel,
            scenarioId: params.scenarioId,
            scenarioText: params.scenarioText,
            targetModel: params.targetModel,
            klingPreset: params.klingPreset,
            llmModel: params.llmModel,
            abortSignal: params.abortSignal,
            onProgress: params.onProgress,
            onLogEntry: params.onLogEntry,
            onShotCompleted: params.onShotCompleted,
          });
        }
      }),
    );

    for (const { shot } of allPlannedMainShots) {
      const generated = generatedByMainShot.get(shot.shotNumber);

      if (!generated) {
        throw new Error(`${shot.shotNumber} uretimi tamamlanamadi.`);
      }

      lastLLMModel = generated.model;
      shotFiles.push(generated.shotFile);
      allGeneratedShots.push(...generated.shots);
    }

    /* Legacy sequential path removed after worker-based continuity execution.
    for (let index = 0; index < 0; index += 1) {
      if (params.abortSignal?.aborted) {
        throw new Error("Uretim iptal edildi.");
      }

      const { scene, shot } = allPlannedMainShots[index];
      const coveragePlan = scene.shots.filter(
        (candidate) =>
          candidate.type === "coverage" && candidate.parentShotNumber === shot.shotNumber,
      );
      const nextMainShot = allPlannedMainShots[index + 1]?.shot ?? null;

      params.onProgress?.({
        currentPass: 2,
        passLabel: `Shot Generator — ${shot.shotNumber}`,
        shotNumber: shot.shotNumber,
        completedShots,
        totalShots,
        percent: Math.min(78, 10 + Math.round((completedShots / Math.max(totalShots, 1)) * 68)),
      });
      params.onLogEntry?.(2, `${shot.shotNumber} icin shot-generator calisiyor`, shot.shotNumber);

      const generated = await generateSingleShotFile({
        scenarioId: params.scenarioId,
        scenarioText: params.scenarioText,
        scene,
        mainShot: shot,
        coveragePlan,
        previousGeneratedMainShot,
        nextMainShot,
        targetModel: params.targetModel,
        klingPreset: params.klingPreset,
        llmModel: params.llmModel,
        abortSignal: params.abortSignal,
      });

      lastLLMModel = generated.model;
      shotFiles.push(generated.shotFile);
      allGeneratedShots.push(...generated.shots);

      const mainShot = generated.shots.find((candidate) => candidate.shotNumber === shot.shotNumber) ?? null;
      previousGeneratedMainShot = mainShot;

      for (const generatedShot of generated.shots) {
        params.onShotCompleted?.(generatedShot.shotNumber);
        completedShots += 1;
      }

      params.onLogEntry?.(
        2,
        `${shot.shotNumber} onaylandi (${coveragePlan.length} coverage ayni dosyada)`,
        shot.shotNumber,
      );
    }

    */

    const pass2Duration = Date.now() - pass2Start;
    const pass2CostUsd = Math.max(0.06, allPlannedMainShots.length * 0.03);
    totalCostUsd += pass2CostUsd;
    passLogs.push({
      pass: 2,
      label: "Shot Generator",
      durationMs: pass2Duration,
      costUsd: pass2CostUsd,
      shotCount: allGeneratedShots.length,
    });

    await logGenerationPass({
      scenarioId: params.scenarioId,
      passName: "pass2_shot_generator",
      model: lastLLMModel,
      costUsd: pass2CostUsd,
      durationMs: pass2Duration,
    });

    // ── Pass 3: Continuity Gate ──
    const pass3Start = Date.now();
    params.onProgress?.({
      currentPass: 3,
      passLabel: "Continuity Editor",
      completedShots: completedCounter.value,
      totalShots,
      percent: 84,
    });

    const continuityIssues = validateContinuityGate(params.plan, allGeneratedShots);

    if (continuityIssues.length > 0) {
      throw new Error(`Continuity gate basarisiz:\n- ${continuityIssues.join("\n- ")}`);
    }

    params.onLogEntry?.(3, "Cross-shot continuity dogrulandi.");
    const pass3Duration = Date.now() - pass3Start;
    passLogs.push({
      pass: 3,
      label: "Continuity Editor",
      durationMs: pass3Duration,
      costUsd: 0,
      shotCount: allGeneratedShots.length,
    });
    await logGenerationPass({
      scenarioId: params.scenarioId,
      passName: "pass3_continuity_gate",
      model: "local/validator",
      costUsd: 0,
      durationMs: pass3Duration,
    });

    // ── Pass 4: Delivery Contract Gate ──
    const pass4Start = Date.now();
    params.onProgress?.({
      currentPass: 4,
      passLabel: "Delivery Contract",
      completedShots: completedCounter.value,
      totalShots,
      percent: 92,
    });

    const deliveryIssues = validateDeliveryGate(allGeneratedShots, shotFiles);

    if (deliveryIssues.length > 0) {
      throw new Error(`Delivery gate basarisiz:\n- ${deliveryIssues.join("\n- ")}`);
    }

    params.onLogEntry?.(4, "Audio ve markdown sozlesmesi dogrulandi.");
    const pass4Duration = Date.now() - pass4Start;
    passLogs.push({
      pass: 4,
      label: "Delivery Contract",
      durationMs: pass4Duration,
      costUsd: 0,
      shotCount: allGeneratedShots.length,
    });
    await logGenerationPass({
      scenarioId: params.scenarioId,
      passName: "pass4_delivery_gate",
      model: "local/validator",
      costUsd: 0,
      durationMs: pass4Duration,
    });

    // ── Pass 5: Finalize ──
    const pass5Start = Date.now();
    params.onProgress?.({
      currentPass: 5,
      passLabel: "Packaging",
      completedShots: totalShots,
      totalShots,
      percent: 97,
    });

    await db.execute(
      `UPDATE scenarios SET status = $1, updated_at = $2 WHERE id = $3`,
      ["done", Date.now(), params.scenarioId],
    );

    await logCost({
      projectId: project.id,
      model: lastLLMModel,
      type: "llm",
      amountUsd: totalCostUsd,
    });

    const pass5Duration = Date.now() - pass5Start;
    passLogs.push({
      pass: 5,
      label: "Packaging",
      durationMs: pass5Duration,
      costUsd: 0,
      shotCount: allGeneratedShots.length,
    });
    await logGenerationPass({
      scenarioId: params.scenarioId,
      passName: "pass5_finalize",
      model: "local/finalize",
      costUsd: 0,
      durationMs: pass5Duration,
    });

    params.onProgress?.({
      currentPass: 5,
      passLabel: "Tamamlandi",
      completedShots: totalShots,
      totalShots,
      percent: 100,
    });
    params.onLogEntry?.(5, `${shotFiles.length} adet SHOT markdown dosyasi paketlendi.`);

    return {
      shots: allGeneratedShots,
      shotFiles,
      totalCostUsd,
      passLogs,
    };
  } catch (error) {
    await db.execute(
      `UPDATE scenarios SET status = $1, updated_at = $2 WHERE id = $3`,
      ["error", Date.now(), params.scenarioId],
    );
    throw error;
  }
}
