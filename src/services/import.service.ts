import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readDir, readFile, readTextFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import {
  applyDialogueLineOverride,
  createAudioContentHash,
  resolveAudioShotStatus,
  type AudioShotStatus,
  type ParsedAudioDirection,
  type ParsedDialogueLine,
} from "@/lib/audio-direction-parser";
import { parseShot, type ParsedShot } from "@/lib/markdown-parser";
import { createDialogueOptimizationSourceHash } from "@/services/llm.service";
import { syncActiveProjectPresentation } from "@/services/project-presentation.service";
import { useProjectStore } from "@/store/project.store";

export interface ImportPreview {
  totalShots: number;
  coverageShots: number;
  chainLinks: number;
  parsedShotCount: number;
  files: string[];
  existingShotCount: number;
  matchedShotCount: number;
  newShotCount: number;
}

export interface ShotRow {
  id: string;
  shotNumber: string;
  parentShotId: string | null;
  act: number | null;
  scene: number | null;
  shotType: string;
  cameraAngle: string | null;
  durationS: number | null;
  tensionLevel: number | null;
  chainStatus: string;
  usePreviousEndForStart: boolean;
  prevShotId: string | null;
  promptStart: string | null;
  promptEnd: string | null;
  promptVideo: string | null;
  summaryTr: string | null;
  model: string | null;
  cfg: number | null;
  klingPreset: string | null;
  transitionMode: string | null;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  video4kPath: string | null;
  imageStatus: string;
  videoStatus: string;
  upscaleStatus: string;
  imageModelUsed: string | null;
  videoModelUsed: string | null;
  isArchived: boolean;
  requiresExternalReference: boolean;
  externalReferenceName: string | null;
  externalReferenceNotes: string | null;
  externalReferencePath: string | null;
  characterId: string | null;
  characterLookId: string | null;
  includeCharacterPrompt: boolean;
  audioDirectionJson: string | null;
  audioDialoguePreview: string | null;
  audioStatus: AudioShotStatus;
  audioMasterPath: string | null;
  audioModelUsed: string | null;
  audioOutputFormat: string | null;
  audioCharacterCount: number | null;
  audioCostUsd: number | null;
  audioTimestampsJson: string | null;
  audioContentHash: string | null;
  audioError: string | null;
  audioOptimizedDialogueJson: string | null;
  audioOptimizedDialoguePreview: string | null;
  audioOptimizerModel: string | null;
  audioOptimizerSourceHash: string | null;
  audioGenerationProfileJson: string | null;
  audioDialogueOverrideJson: string | null;
  audioTakeHistoryJson: string | null;
  audioVoiceoverText: string | null;
  sourceFile: string | null;
  createdAt: number;
  updatedAt: number;
}

const SHOT_SELECT_SQL = `SELECT
  id,
  shot_number AS shotNumber,
  parent_shot_id AS parentShotId,
  act,
  scene,
  shot_type AS shotType,
  camera_angle AS cameraAngle,
  duration_s AS durationS,
  tension_level AS tensionLevel,
  chain_status AS chainStatus,
  COALESCE(use_previous_end_for_start, 1) AS usePreviousEndForStart,
  prev_shot_id AS prevShotId,
  prompt_start AS promptStart,
  prompt_end AS promptEnd,
  prompt_video AS promptVideo,
  summary_tr AS summaryTr,
  model,
  cfg,
  kling_preset AS klingPreset,
  transition_mode AS transitionMode,
  image_start_path AS imageStartPath,
  image_end_path AS imageEndPath,
  video_path AS videoPath,
  video_4k_path AS video4kPath,
  image_status AS imageStatus,
  video_status AS videoStatus,
  upscale_status AS upscaleStatus,
  COALESCE(
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'image'
        AND asset.file_path = shot.image_start_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    ),
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'image'
        AND asset.file_path = shot.image_end_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    )
  ) AS imageModelUsed,
  COALESCE(
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'video'
        AND asset.file_path = shot.video_4k_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    ),
    (
      SELECT asset.model_used
      FROM assets asset
      WHERE asset.shot_id = shot.id
        AND asset.type = 'video'
        AND asset.file_path = shot.video_path
      ORDER BY asset.created_at DESC
      LIMIT 1
    )
  ) AS videoModelUsed,
  COALESCE(is_archived, 0) AS isArchived,
  COALESCE(requires_external_reference, 0) AS requiresExternalReference,
  external_reference_name AS externalReferenceName,
  external_reference_notes AS externalReferenceNotes,
  external_reference_path AS externalReferencePath,
  character_id AS characterId,
  character_look_id AS characterLookId,
  COALESCE(include_character_prompt, 1) AS includeCharacterPrompt,
  audio_direction_json AS audioDirectionJson,
  audio_dialogue_preview AS audioDialoguePreview,
  COALESCE(audio_status, 'none') AS audioStatus,
  audio_master_path AS audioMasterPath,
  audio_model_used AS audioModelUsed,
  audio_output_format AS audioOutputFormat,
  audio_character_count AS audioCharacterCount,
  audio_cost_usd AS audioCostUsd,
  audio_timestamps_json AS audioTimestampsJson,
  audio_content_hash AS audioContentHash,
  audio_error AS audioError,
  audio_optimized_dialogue_json AS audioOptimizedDialogueJson,
  audio_optimized_dialogue_preview AS audioOptimizedDialoguePreview,
  audio_optimizer_model AS audioOptimizerModel,
  audio_optimizer_source_hash AS audioOptimizerSourceHash,
  audio_generation_profile_json AS audioGenerationProfileJson,
  audio_dialogue_override_json AS audioDialogueOverrideJson,
  audio_take_history_json AS audioTakeHistoryJson,
  audio_voiceover_text AS audioVoiceoverText,
  source_file AS sourceFile,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM shots shot`;

export type StoryboardReferenceMode = "start" | "end" | "coverage";
export type ShotMediaAssignmentTarget =
  | "start"
  | "end"
  | "video"
  | "external-reference";

type ImportedAudioState = {
  audioDirectionJson: string | null;
  audioDialoguePreview: string | null;
  audioStatus: AudioShotStatus;
  audioMasterPath: string | null;
  audioModelUsed: string | null;
  audioOutputFormat: string | null;
  audioCharacterCount: number | null;
  audioCostUsd: number | null;
  audioTimestampsJson: string | null;
  audioContentHash: string | null;
  audioError: string | null;
  audioOptimizedDialogueJson: string | null;
  audioOptimizedDialoguePreview: string | null;
  audioOptimizerModel: string | null;
  audioOptimizerSourceHash: string | null;
  audioGenerationProfileJson: string | null;
  audioDialogueOverrideJson: string | null;
  audioTakeHistoryJson: string | null;
};

function getAudioBlockedMessage(audioDirection: ParsedAudioDirection | null): string | null {
  if (!audioDirection?.dialogueTranscript) {
    return null;
  }

  if (!audioDirection.speakerTagged || audioDirection.dialogueLines.length === 0) {
    return "Dialogue transcript speaker-tagged format istemeli: Konusmaci: replik";
  }

  return null;
}

function extractAudioTakePaths(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as {
      takes?: Array<{ relativePath?: string | null }>;
    };

    if (!Array.isArray(parsed.takes)) {
      return [];
    }

    return Array.from(
      new Set(
        parsed.takes
          .map((take) => take.relativePath?.trim() ?? "")
          .filter(Boolean),
      ),
    );
  } catch {
    return [];
  }
}

function parseStoredAudioDirection(value: string | null | undefined): ParsedAudioDirection | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as ParsedAudioDirection;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function parseStoredDialogueOverride(
  value: string | null | undefined,
): ParsedDialogueLine[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      lines?: Array<{
        speaker?: string;
        speakerKey?: string;
        text?: string;
      }>;
    };

    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return null;
    }

    const lines = parsed.lines
      .map((line) => ({
        speaker: line.speaker?.trim() ?? "",
        speakerKey: line.speakerKey?.trim() ?? "",
        text: line.text?.trim() ?? "",
      }))
      .filter((line) => line.speaker && line.speakerKey && line.text);

    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

function parseStoredAudioGenerationProfile(
  value: string | null | undefined,
): {
  useOptimizer?: boolean;
  performancePreset?: string | null;
  performanceNote?: string | null;
} | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      useOptimizer?: boolean;
      performancePreset?: string | null;
      performanceNote?: string | null;
    };
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function tryRemoveProjectRelativeFile(
  projectFolderPath: string,
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) {
    return;
  }

  try {
    const absolutePath = await join(
      projectFolderPath,
      ...relativePath.split(/[\\/]+/).filter(Boolean),
    );

    if (await exists(absolutePath)) {
      await remove(absolutePath);
    }
  } catch (error) {
    console.warn("Failed to remove stale project-relative file.", {
      projectFolderPath,
      relativePath,
      error,
    });
  }
}

async function buildImportedAudioState(
  projectFolderPath: string,
  existingShot: ShotRow | undefined,
  shot: ParsedShot,
): Promise<ImportedAudioState> {
  const audioDirection = shot.audioDirection;
  const audioDirectionJson = audioDirection ? JSON.stringify(audioDirection) : null;
  const baseAudioContentHash = createAudioContentHash(audioDirection);
  const existingBaseAudioDirection = parseStoredAudioDirection(existingShot?.audioDirectionJson);
  const existingBaseAudioContentHash = createAudioContentHash(existingBaseAudioDirection);
  const preservedOverrideJson =
    existingShot?.audioDialogueOverrideJson &&
    existingBaseAudioContentHash &&
    existingBaseAudioContentHash === baseAudioContentHash
      ? existingShot.audioDialogueOverrideJson
      : null;
  const effectiveAudioDirection = applyDialogueLineOverride(
    audioDirection,
    parseStoredDialogueOverride(preservedOverrideJson),
  );
  const existingGenerationProfile = parseStoredAudioGenerationProfile(
    existingShot?.audioGenerationProfileJson,
  );
  const audioDialoguePreview = effectiveAudioDirection?.dialoguePreview ?? null;
  const audioContentHash = createAudioContentHash(effectiveAudioDirection);
  const audioOptimizerSourceHash = createDialogueOptimizationSourceHash({
    shotNumber: shot.shotNumber,
    durationS: shot.durationS,
    summaryTr: shot.summaryTr,
    promptVideo: shot.promptVideo,
    dialogueTranscript: effectiveAudioDirection?.dialogueTranscript ?? null,
    audioContentHash,
    useOptimizer: existingGenerationProfile?.useOptimizer ?? true,
    performancePreset: existingGenerationProfile?.performancePreset ?? "auto",
    performanceNote: existingGenerationProfile?.performanceNote ?? null,
  });
  const baseStatus = resolveAudioShotStatus(effectiveAudioDirection);
  const audioError = getAudioBlockedMessage(effectiveAudioDirection);
  const shouldRemoveExistingMaster =
    Boolean(existingShot?.audioMasterPath) &&
    (
      existingShot?.audioContentHash !== audioContentHash ||
      existingShot?.audioOptimizerSourceHash !== audioOptimizerSourceHash
    );

  if (shouldRemoveExistingMaster) {
    await tryRemoveProjectRelativeFile(projectFolderPath, existingShot?.audioMasterPath);
    for (const takePath of extractAudioTakePaths(existingShot?.audioTakeHistoryJson)) {
      if (takePath !== existingShot?.audioMasterPath) {
        await tryRemoveProjectRelativeFile(projectFolderPath, takePath);
      }
    }
  }

  const canPreserveExistingMaster =
    Boolean(audioContentHash) &&
    existingShot?.audioContentHash === audioContentHash &&
    existingShot?.audioOptimizerSourceHash === audioOptimizerSourceHash &&
    existingShot?.audioStatus === "done" &&
    Boolean(existingShot.audioMasterPath);

  if (canPreserveExistingMaster && existingShot?.audioMasterPath) {
    const absoluteMasterPath = await join(
      projectFolderPath,
      ...existingShot.audioMasterPath.split(/[\\/]+/).filter(Boolean),
    );

    if (await exists(absoluteMasterPath)) {
      return {
        audioDirectionJson,
        audioDialoguePreview,
        audioStatus: "done",
        audioMasterPath: existingShot.audioMasterPath,
        audioModelUsed: existingShot.audioModelUsed,
        audioOutputFormat: existingShot.audioOutputFormat,
        audioCharacterCount: existingShot.audioCharacterCount,
        audioCostUsd: existingShot.audioCostUsd,
        audioTimestampsJson: existingShot.audioTimestampsJson,
        audioContentHash,
        audioError: null,
        audioOptimizedDialogueJson: existingShot.audioOptimizedDialogueJson,
        audioOptimizedDialoguePreview: existingShot.audioOptimizedDialoguePreview,
        audioOptimizerModel: existingShot.audioOptimizerModel,
        audioOptimizerSourceHash,
        audioGenerationProfileJson: existingShot.audioGenerationProfileJson,
        audioDialogueOverrideJson: preservedOverrideJson,
        audioTakeHistoryJson: existingShot.audioTakeHistoryJson,
      };
    }
  }

  return {
    audioDirectionJson,
    audioDialoguePreview,
    audioStatus: baseStatus,
    audioMasterPath: null,
    audioModelUsed: null,
    audioOutputFormat: null,
    audioCharacterCount: null,
    audioCostUsd: null,
    audioTimestampsJson: null,
    audioContentHash,
    audioError,
    audioOptimizedDialogueJson: null,
    audioOptimizedDialoguePreview: null,
    audioOptimizerModel: null,
    audioOptimizerSourceHash,
    audioGenerationProfileJson: existingShot?.audioGenerationProfileJson ?? null,
    audioDialogueOverrideJson: preservedOverrideJson,
    audioTakeHistoryJson:
      existingShot?.audioContentHash === audioContentHash &&
      existingShot?.audioOptimizerSourceHash === audioOptimizerSourceHash
        ? existingShot.audioTakeHistoryJson
        : null,
  };
}

export async function previewImport(outputsFolder: string): Promise<ImportPreview> {
  const project = useProjectStore.getState().activeProject;
  const files = await collectMdFiles(outputsFolder);
  let totalShots = 0;
  let coverageShots = 0;
  let chainLinks = 0;
  let parsedShotCount = 0;
  const parsedShotNumbers = new Set<string>();

  for (const file of files) {
    const raw = await readTextFile(file);
    const parsedShots = parseShot(raw, file);
    parsedShotCount += parsedShots.length;

    for (const shot of parsedShots) {
      parsedShotNumbers.add(shot.shotNumber.toUpperCase());

      if (shot.parentShotNum) {
        coverageShots += 1;
      } else {
        totalShots += 1;
      }

      if (shot.chainStatus === "continue") {
        chainLinks += 1;
      }
    }
  }

  const existingShots = project ? await getShots(project.id, { includeArchived: true }) : [];
  const existingShotNumbers = new Set(
    existingShots.map((shot) => shot.shotNumber.toUpperCase()),
  );
  const matchedShotCount = Array.from(parsedShotNumbers).filter((shotNumber) =>
    existingShotNumbers.has(shotNumber),
  ).length;
  const newShotCount = parsedShotNumbers.size - matchedShotCount;

  return {
    totalShots,
    coverageShots,
    chainLinks,
    parsedShotCount,
    files,
    existingShotCount: existingShots.length,
    matchedShotCount,
    newShotCount,
  };
}

export async function executeImport(outputsFolder: string): Promise<void> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const db = await getProjectDb();
  const files = await collectMdFiles(outputsFolder);
  const now = Date.now();
  const parsedShots: ParsedShot[] = [];

  for (const file of files) {
    const raw = await readTextFile(file);
    parsedShots.push(...parseShot(raw, file));
  }

  if (files.length === 0) {
    throw new Error("Secilen klasorde SHOT*.md dosyasi bulunamadi.");
  }

  if (parsedShots.length === 0) {
    throw new Error(
      "Markdown dosyalari bulundu ama hicbir shot parse edilemedi. Film-kit formatini kontrol edin.",
    );
  }

  const existingShots = await getShots(project.id, { includeArchived: true });
  const existingByShotNumber = new Map(
    existingShots.map((shot) => [shot.shotNumber.toUpperCase(), shot] as const),
  );
  const persistedIdsByShotNumber = new Map<string, string>();

  for (const shot of parsedShots) {
    const existingShot = existingByShotNumber.get(shot.shotNumber.toUpperCase());
    persistedIdsByShotNumber.set(
      shot.shotNumber.toUpperCase(),
      existingShot?.id ?? uuidv4(),
    );
  }

  await db.execute("DELETE FROM shots WHERE project_id = $1", [project.id]);

  for (const shot of parsedShots) {
    const existingShot = existingByShotNumber.get(shot.shotNumber.toUpperCase());
    const sharedExternalReferencePath =
      shot.externalReferenceName
        ? existingShots.find(
            (candidate) =>
              candidate.externalReferenceName?.toLowerCase() ===
                shot.externalReferenceName?.toLowerCase() &&
              Boolean(candidate.externalReferencePath),
          )?.externalReferencePath ?? null
        : null;
    const id = persistedIdsByShotNumber.get(shot.shotNumber.toUpperCase()) ?? uuidv4();
    const parentId = shot.parentShotNum
      ? (persistedIdsByShotNumber.get(shot.parentShotNum.toUpperCase()) ?? null)
      : null;
    const prevShotId = shot.prevShotRef
      ? (persistedIdsByShotNumber.get(shot.prevShotRef.toUpperCase()) ?? null)
      : null;
    const audioState = await buildImportedAudioState(
      project.folderPath,
      existingShot,
      shot,
    );

    await db.execute(
      `INSERT INTO shots (
        id, project_id, shot_number, parent_shot_id,
        act, scene, shot_type, camera_angle,
        duration_s, tension_level, chain_status, use_previous_end_for_start, prev_shot_id,
        prompt_start, prompt_end, prompt_video, summary_tr,
        model, cfg, kling_preset, transition_mode,
        requires_external_reference, external_reference_name, external_reference_notes,
        external_reference_path, character_id, character_look_id, include_character_prompt,
        image_start_path, image_end_path, video_path, video_4k_path,
        image_status, video_status, upscale_status,
        is_archived,
        audio_direction_json, audio_dialogue_preview, audio_status, audio_master_path,
        audio_model_used, audio_output_format, audio_character_count, audio_cost_usd,
        audio_timestamps_json, audio_content_hash, audio_error,
        audio_optimized_dialogue_json, audio_optimized_dialogue_preview,
        audio_optimizer_model, audio_optimizer_source_hash,
        audio_generation_profile_json,
        audio_dialogue_override_json, audio_take_history_json, source_file, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
        $51, $52, $53, $54, $55, $56, $57, $58
      )`,
      [
        id,
        project.id,
        shot.shotNumber,
        parentId,
        shot.act,
        shot.scene,
        shot.shotType,
        shot.cameraAngle,
        shot.durationS,
        shot.tensionLevel,
        shot.chainStatus,
        (existingShot?.usePreviousEndForStart ?? true) ? 1 : 0,
        prevShotId,
        shot.promptStart,
        shot.promptEnd,
        shot.promptVideo,
        shot.summaryTr,
        shot.model,
        shot.cfg,
        shot.klingPreset,
        shot.transitionMode,
        shot.requiresExternalReference ? 1 : 0,
        shot.externalReferenceName,
        shot.externalReferenceNotes,
        existingShot?.externalReferencePath ?? sharedExternalReferencePath ?? null,
        existingShot?.characterId ?? null,
        existingShot?.characterLookId ?? null,
        (existingShot?.includeCharacterPrompt ?? true) ? 1 : 0,
        existingShot?.imageStartPath ?? null,
        existingShot?.imageEndPath ?? null,
        existingShot?.videoPath ?? null,
        existingShot?.video4kPath ?? null,
        existingShot?.imageStatus ?? "pending",
        existingShot?.videoStatus ?? "pending",
        existingShot?.upscaleStatus ?? "none",
        existingShot?.isArchived ? 1 : 0,
        audioState.audioDirectionJson,
        audioState.audioDialoguePreview,
        audioState.audioStatus,
        audioState.audioMasterPath,
        audioState.audioModelUsed,
        audioState.audioOutputFormat,
        audioState.audioCharacterCount,
        audioState.audioCostUsd,
        audioState.audioTimestampsJson,
        audioState.audioContentHash,
        audioState.audioError,
        audioState.audioOptimizedDialogueJson,
        audioState.audioOptimizedDialoguePreview,
        audioState.audioOptimizerModel,
        audioState.audioOptimizerSourceHash,
        audioState.audioGenerationProfileJson,
        audioState.audioDialogueOverrideJson,
        audioState.audioTakeHistoryJson,
        shot.sourceFile,
        existingShot?.createdAt ?? now,
        now,
      ],
    );
  }

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function getShots(
  projectId: string,
  options?: { includeArchived?: boolean },
): Promise<ShotRow[]> {
  const db = await getProjectDb();
  const includeArchived = options?.includeArchived ?? false;
  return db.select<ShotRow[]>(
    `${SHOT_SELECT_SQL}
     WHERE shot.project_id = $1
       ${includeArchived ? "" : "AND COALESCE(shot.is_archived, 0) = 0"}
     ORDER BY shot.act, shot.scene, shot.shot_number`,
    [projectId],
  );
}

export async function getShotById(shotId: string): Promise<ShotRow | null> {
  const db = await getProjectDb();
  const rows = await db.select<ShotRow[]>(
    `${SHOT_SELECT_SQL}
     WHERE shot.id = $1
     LIMIT 1`,
    [shotId],
  );
  return rows[0] ?? null;
}

export async function updateShotPaths(
  shotId: string,
  updates: Partial<{
    imageStartPath: string | null;
    imageEndPath: string | null;
    videoPath: string | null;
    video4kPath: string | null;
    externalReferencePath: string | null;
    imageStatus: string;
    videoStatus: string;
    upscaleStatus: string;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const setClauses: string[] = ["updated_at = $1"];
  const values: unknown[] = [Date.now()];
  let parameterIndex = values.length + 1;

  if (updates.imageStartPath !== undefined) {
    setClauses.push(`image_start_path = $${parameterIndex}`);
    values.push(updates.imageStartPath);
    parameterIndex += 1;
  }

  if (updates.imageEndPath !== undefined) {
    setClauses.push(`image_end_path = $${parameterIndex}`);
    values.push(updates.imageEndPath);
    parameterIndex += 1;
  }

  if (updates.videoPath !== undefined) {
    setClauses.push(`video_path = $${parameterIndex}`);
    values.push(updates.videoPath);
    parameterIndex += 1;
  }

  if (updates.video4kPath !== undefined) {
    setClauses.push(`video_4k_path = $${parameterIndex}`);
    values.push(updates.video4kPath);
    parameterIndex += 1;
  }

  if (updates.externalReferencePath !== undefined) {
    setClauses.push(`external_reference_path = $${parameterIndex}`);
    values.push(updates.externalReferencePath);
    parameterIndex += 1;
  }

  if (updates.imageStatus !== undefined) {
    setClauses.push(`image_status = $${parameterIndex}`);
    values.push(updates.imageStatus);
    parameterIndex += 1;
  }

  if (updates.videoStatus !== undefined) {
    setClauses.push(`video_status = $${parameterIndex}`);
    values.push(updates.videoStatus);
    parameterIndex += 1;
  }

  if (updates.upscaleStatus !== undefined) {
    setClauses.push(`upscale_status = $${parameterIndex}`);
    values.push(updates.upscaleStatus);
    parameterIndex += 1;
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${setClauses.join(", ")}
     WHERE id = $${parameterIndex}`,
    values,
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function updateShotAudioFields(
  shotId: string,
  updates: Partial<{
    audioDirectionJson: string | null;
    audioDialoguePreview: string | null;
    audioStatus: AudioShotStatus;
    audioMasterPath: string | null;
    audioModelUsed: string | null;
    audioOutputFormat: string | null;
    audioCharacterCount: number | null;
    audioCostUsd: number | null;
    audioTimestampsJson: string | null;
    audioContentHash: string | null;
    audioError: string | null;
    audioOptimizedDialogueJson: string | null;
    audioOptimizedDialoguePreview: string | null;
    audioOptimizerModel: string | null;
    audioOptimizerSourceHash: string | null;
    audioGenerationProfileJson: string | null;
    audioDialogueOverrideJson: string | null;
    audioTakeHistoryJson: string | null;
    audioVoiceoverText: string | null;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const setClauses: string[] = ["updated_at = $1"];
  const values: Array<string | number | null> = [Date.now()];
  let parameterIndex = values.length + 1;

  if (updates.audioDirectionJson !== undefined) {
    setClauses.push(`audio_direction_json = $${parameterIndex}`);
    values.push(updates.audioDirectionJson);
    parameterIndex += 1;
  }

  if (updates.audioDialoguePreview !== undefined) {
    setClauses.push(`audio_dialogue_preview = $${parameterIndex}`);
    values.push(updates.audioDialoguePreview);
    parameterIndex += 1;
  }

  if (updates.audioStatus !== undefined) {
    setClauses.push(`audio_status = $${parameterIndex}`);
    values.push(updates.audioStatus);
    parameterIndex += 1;
  }

  if (updates.audioMasterPath !== undefined) {
    setClauses.push(`audio_master_path = $${parameterIndex}`);
    values.push(updates.audioMasterPath);
    parameterIndex += 1;
  }

  if (updates.audioModelUsed !== undefined) {
    setClauses.push(`audio_model_used = $${parameterIndex}`);
    values.push(updates.audioModelUsed);
    parameterIndex += 1;
  }

  if (updates.audioOutputFormat !== undefined) {
    setClauses.push(`audio_output_format = $${parameterIndex}`);
    values.push(updates.audioOutputFormat);
    parameterIndex += 1;
  }

  if (updates.audioCharacterCount !== undefined) {
    setClauses.push(`audio_character_count = $${parameterIndex}`);
    values.push(updates.audioCharacterCount);
    parameterIndex += 1;
  }

  if (updates.audioCostUsd !== undefined) {
    setClauses.push(`audio_cost_usd = $${parameterIndex}`);
    values.push(updates.audioCostUsd);
    parameterIndex += 1;
  }

  if (updates.audioTimestampsJson !== undefined) {
    setClauses.push(`audio_timestamps_json = $${parameterIndex}`);
    values.push(updates.audioTimestampsJson);
    parameterIndex += 1;
  }

  if (updates.audioContentHash !== undefined) {
    setClauses.push(`audio_content_hash = $${parameterIndex}`);
    values.push(updates.audioContentHash);
    parameterIndex += 1;
  }

  if (updates.audioError !== undefined) {
    setClauses.push(`audio_error = $${parameterIndex}`);
    values.push(updates.audioError);
    parameterIndex += 1;
  }

  if (updates.audioOptimizedDialogueJson !== undefined) {
    setClauses.push(`audio_optimized_dialogue_json = $${parameterIndex}`);
    values.push(updates.audioOptimizedDialogueJson);
    parameterIndex += 1;
  }

  if (updates.audioOptimizedDialoguePreview !== undefined) {
    setClauses.push(`audio_optimized_dialogue_preview = $${parameterIndex}`);
    values.push(updates.audioOptimizedDialoguePreview);
    parameterIndex += 1;
  }

  if (updates.audioOptimizerModel !== undefined) {
    setClauses.push(`audio_optimizer_model = $${parameterIndex}`);
    values.push(updates.audioOptimizerModel);
    parameterIndex += 1;
  }

  if (updates.audioOptimizerSourceHash !== undefined) {
    setClauses.push(`audio_optimizer_source_hash = $${parameterIndex}`);
    values.push(updates.audioOptimizerSourceHash);
    parameterIndex += 1;
  }

  if (updates.audioGenerationProfileJson !== undefined) {
    setClauses.push(`audio_generation_profile_json = $${parameterIndex}`);
    values.push(updates.audioGenerationProfileJson);
    parameterIndex += 1;
  }

  if (updates.audioDialogueOverrideJson !== undefined) {
    setClauses.push(`audio_dialogue_override_json = $${parameterIndex}`);
    values.push(updates.audioDialogueOverrideJson);
    parameterIndex += 1;
  }

  if (updates.audioTakeHistoryJson !== undefined) {
    setClauses.push(`audio_take_history_json = $${parameterIndex}`);
    values.push(updates.audioTakeHistoryJson);
    parameterIndex += 1;
  }

  if (updates.audioVoiceoverText !== undefined) {
    setClauses.push(`audio_voiceover_text = $${parameterIndex}`);
    values.push(updates.audioVoiceoverText);
    parameterIndex += 1;
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${setClauses.join(", ")}
     WHERE id = $${parameterIndex}`,
    values,
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function updateShotPromptFields(
  shotId: string,
  updates: Partial<{
    promptStart: string | null;
    promptEnd: string | null;
    promptVideo: string | null;
    model: string | null;
    cfg: number | null;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const clauses = ["updated_at = $1"];
  const values: Array<string | number | null> = [Date.now()];

  if (updates.promptStart !== undefined) {
    clauses.push(`prompt_start = $${values.length + 1}`);
    values.push(updates.promptStart);
  }

  if (updates.promptEnd !== undefined) {
    clauses.push(`prompt_end = $${values.length + 1}`);
    values.push(updates.promptEnd);
  }

  if (updates.promptVideo !== undefined) {
    clauses.push(`prompt_video = $${values.length + 1}`);
    values.push(updates.promptVideo);
  }

  if (updates.model !== undefined) {
    clauses.push(`model = $${values.length + 1}`);
    values.push(updates.model);
  }

  if (updates.cfg !== undefined) {
    clauses.push(`cfg = $${values.length + 1}`);
    values.push(updates.cfg);
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${clauses.join(", ")}
     WHERE id = $${values.length}`,
    values,
  );

  await syncProjectDbMirror();
}

export async function updateShotContinuitySettings(
  shotId: string,
  updates: Partial<{
    usePreviousEndForStart: boolean;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const clauses = ["updated_at = $1"];
  const values: Array<string | number | null> = [Date.now()];

  if (updates.usePreviousEndForStart !== undefined) {
    clauses.push(`use_previous_end_for_start = $${values.length + 1}`);
    values.push(updates.usePreviousEndForStart ? 1 : 0);
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${clauses.join(", ")}
     WHERE id = $${values.length}`,
    values,
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function updateShotCharacterBinding(
  shotId: string,
  updates: Partial<{
    characterId: string | null;
    characterLookId: string | null;
    includeCharacterPrompt: boolean;
    externalReferencePath: string | null;
  }>,
): Promise<void> {
  const db = await getProjectDb();
  const clauses = ["updated_at = $1"];
  const values: Array<string | number | null> = [Date.now()];

  if (updates.characterId !== undefined) {
    clauses.push(`character_id = $${values.length + 1}`);
    values.push(updates.characterId);
  }

  if (updates.characterLookId !== undefined) {
    clauses.push(`character_look_id = $${values.length + 1}`);
    values.push(updates.characterLookId);
  }

  if (updates.includeCharacterPrompt !== undefined) {
    clauses.push(`include_character_prompt = $${values.length + 1}`);
    values.push(updates.includeCharacterPrompt ? 1 : 0);
  }

  if (updates.externalReferencePath !== undefined) {
    clauses.push(`external_reference_path = $${values.length + 1}`);
    values.push(updates.externalReferencePath);
  }

  values.push(shotId);

  await db.execute(
    `UPDATE shots
     SET ${clauses.join(", ")}
     WHERE id = $${values.length}`,
    values,
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export async function assignShotMediaPath(
  shotId: string,
  target: ShotMediaAssignmentTarget,
  filePath: string | null,
): Promise<void> {
  if (target === "start") {
    await updateShotPaths(shotId, {
      imageStartPath: filePath,
      imageStatus: filePath ? "done" : "pending",
    });
    return;
  }

  if (target === "end") {
    await updateShotPaths(shotId, {
      imageEndPath: filePath,
      imageStatus: filePath ? "done" : "pending",
    });
    return;
  }

  if (target === "video") {
    await updateShotPaths(shotId, {
      videoPath: filePath,
      videoStatus: filePath ? "done" : "pending",
    });
    return;
  }

  await updateShotExternalReferencePath(shotId, filePath);
}

export async function setShotArchived(
  shotId: string,
  archived: boolean,
): Promise<void> {
  const db = await getProjectDb();
  const timestamp = Date.now();

  await db.execute(
    `UPDATE shots
     SET is_archived = $1, updated_at = $2
     WHERE id = $3 OR parent_shot_id = $3`,
    [archived ? 1 : 0, timestamp, shotId],
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

export function shotNeedsExternalReferenceForMode(
  shot: Pick<
    ShotRow,
    | "requiresExternalReference"
    | "externalReferencePath"
    | "chainStatus"
    | "usePreviousEndForStart"
  >,
  mode: StoryboardReferenceMode,
): boolean {
  if (!shot.requiresExternalReference || shot.externalReferencePath) {
    return false;
  }

  if (
    mode === "start" &&
    shot.chainStatus === "continue" &&
    shot.usePreviousEndForStart
  ) {
    return false;
  }

  return true;
}

export function getShotMissingExternalReferenceMessage(
  shot: Pick<
    ShotRow,
    | "shotNumber"
    | "requiresExternalReference"
    | "externalReferencePath"
    | "chainStatus"
    | "usePreviousEndForStart"
    | "externalReferenceName"
  >,
  mode: StoryboardReferenceMode,
): string | null {
  if (!shotNeedsExternalReferenceForMode(shot, mode)) {
    return null;
  }

  const expectedName = shot.externalReferenceName
    ? ` (${shot.externalReferenceName})`
    : "";
  return `${shot.shotNumber} icin harici referans gorseli${expectedName} gerekli. Once detay modalinden yukleyin.`;
}

export async function saveShotExternalReference(
  shotId: string,
  sourcePath: string,
): Promise<string> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const sourceBytes = await readFile(sourcePath);
  const originalFileName = sourcePath.split(/[\\/]/).pop() ?? "reference-image";
  const canonicalFileName = shot.externalReferenceName ?? originalFileName;
  const sanitizedFileName = canonicalFileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const targetFileName = sanitizedFileName;
  const targetRelativePath = `assets/references/${targetFileName}`;
  const targetAbsolutePath = await join(project.folderPath, "assets", "references", targetFileName);

  await mkdir(await join(project.folderPath, "assets", "references"), {
    recursive: true,
  });
  await writeFile(targetAbsolutePath, sourceBytes);

  await updateShotExternalReferencePath(shotId, targetRelativePath);

  if (shot.externalReferenceName) {
    await propagateSharedExternalReferencePath(
      project.id,
      shot.externalReferenceName,
      targetRelativePath,
    );
  }

  return targetRelativePath;
}

export async function clearShotExternalReference(shotId: string): Promise<void> {
  await updateShotExternalReferencePath(shotId, null);
}

export async function resolveShotExternalReferencePath(shot: Pick<ShotRow, "externalReferencePath">): Promise<string | undefined> {
  const project = useProjectStore.getState().activeProject;

  if (!project || !shot.externalReferencePath) {
    return undefined;
  }

  const absolutePath = await join(
    project.folderPath,
    ...shot.externalReferencePath.split(/[\\/]+/).filter(Boolean),
  );

  return (await exists(absolutePath)) ? absolutePath : undefined;
}

async function updateShotExternalReferencePath(
  shotId: string,
  externalReferencePath: string | null,
): Promise<void> {
  await updateShotPaths(shotId, { externalReferencePath });
}

export async function setShotExternalReferencePath(
  shotId: string,
  externalReferencePath: string | null,
): Promise<void> {
  await updateShotExternalReferencePath(shotId, externalReferencePath);
}

export async function assignAssetToShotMedia(
  shotId: string,
  mode: "start" | "end" | "video",
  relativePath: string | null,
): Promise<void> {
  if (mode === "start") {
    await updateShotPaths(shotId, {
      imageStartPath: relativePath,
      imageStatus: relativePath ? "done" : "pending",
    });
    return;
  }

  if (mode === "end") {
    await updateShotPaths(shotId, {
      imageEndPath: relativePath,
      imageStatus: relativePath ? "done" : "pending",
    });
    return;
  }

  await updateShotPaths(shotId, {
    videoPath: relativePath,
    videoStatus: relativePath ? "done" : "pending",
  });
}

export async function assignShotExternalReferencePath(
  shotId: string,
  relativePath: string | null,
): Promise<void> {
  await updateShotExternalReferencePath(shotId, relativePath);
}

async function propagateSharedExternalReferencePath(
  projectId: string,
  externalReferenceName: string,
  externalReferencePath: string,
): Promise<void> {
  const db = await getProjectDb();
  await db.execute(
    `UPDATE shots
     SET external_reference_path = $1, updated_at = $2
     WHERE project_id = $3
       AND lower(COALESCE(external_reference_name, '')) = $4`,
    [externalReferencePath, Date.now(), projectId, externalReferenceName.toLowerCase()],
  );

  await syncProjectDbMirror();
  await syncActiveProjectPresentation();
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readDir(currentDir);

    for (const entry of entries) {
      const entryPath =
        "path" in entry && typeof (entry as { path?: string }).path === "string"
          ? (entry as { path: string }).path
          : await join(currentDir, entry.name);

      if (entry.isDirectory) {
        await walk(entryPath);
      } else if (entry.isFile && /^SHOT.*\.md$/i.test(entry.name)) {
        results.push(entryPath);
      }
    }
  }

  await walk(dir);
  return results.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
