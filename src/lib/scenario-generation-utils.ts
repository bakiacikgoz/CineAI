import type {
  KlingPreset,
  ScenePlan,
  ShotPlan,
  ShotPlanItem,
  TargetVideoModel,
} from "@/lib/scenario-types";

export interface PlannedMainShot {
  scene: ScenePlan;
  shot: ShotPlanItem;
}

const DEFAULT_CHUNK_CHAR_LIMIT = 6000;
const DEFAULT_CHUNK_WORD_LIMIT = 900;

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function formatShotNumber(index: number): string {
  return `SHOT${String(index).padStart(2, "0")}`;
}

function deriveCoverageSuffix(shotNumber: string, parentShotNumber?: string, fallbackIndex = 0): string {
  if (parentShotNumber && shotNumber.startsWith(parentShotNumber)) {
    const suffix = shotNumber.slice(parentShotNumber.length).trim();

    if (suffix) {
      return suffix;
    }
  }

  return String.fromCharCode("A".charCodeAt(0) + fallbackIndex);
}

function buildChunkAccumulator(
  units: string[],
  maxChars: number,
  maxWords: number,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentChars = 0;
  let currentWords = 0;

  for (const rawUnit of units) {
    const unit = rawUnit.trim();

    if (!unit) {
      continue;
    }

    const nextChars = currentChars + unit.length + (current.length > 0 ? 2 : 0);
    const nextWords = currentWords + countWords(unit);

    if (current.length > 0 && (nextChars > maxChars || nextWords > maxWords)) {
      chunks.push(current.join("\n\n"));
      current = [unit];
      currentChars = unit.length;
      currentWords = countWords(unit);
      continue;
    }

    current.push(unit);
    currentChars = nextChars;
    currentWords = nextWords;
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks;
}

function splitOversizedBlock(
  block: string,
  maxChars: number,
  maxWords: number,
): string[] {
  if (block.length <= maxChars && countWords(block) <= maxWords) {
    return [block.trim()];
  }

  const lineUnits = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lineUnits.length > 1) {
    return buildChunkAccumulator(lineUnits, maxChars, maxWords);
  }

  const sentenceUnits = block
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentenceUnits.length > 1) {
    return buildChunkAccumulator(sentenceUnits, maxChars, maxWords);
  }

  return [block.trim()];
}

export function shouldChunkScenarioAnalysis(scenarioText: string): boolean {
  return (
    scenarioText.trim().length > 9000 ||
    countWords(scenarioText) > 1400
  );
}

export function splitScenarioIntoChunks(
  scenarioText: string,
  options?: {
    maxChars?: number;
    maxWords?: number;
  },
): string[] {
  const normalized = scenarioText.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const maxChars = options?.maxChars ?? DEFAULT_CHUNK_CHAR_LIMIT;
  const maxWords = options?.maxWords ?? DEFAULT_CHUNK_WORD_LIMIT;
  const sections = normalized
    .split(/\n\s*\n+/)
    .map((section) => section.trim())
    .filter(Boolean)
    .flatMap((section) => splitOversizedBlock(section, maxChars, maxWords));

  const chunks = buildChunkAccumulator(sections, maxChars, maxWords);

  return chunks.length > 0 ? chunks : [normalized];
}

function mapMergedShot(
  shot: ShotPlanItem,
  localMainMap: Map<string, string>,
  previousMainShotNumber: string | null,
  coverageIndexByParent: Map<string, number>,
): ShotPlanItem {
  if (shot.type === "main") {
    const mappedShotNumber = localMainMap.get(shot.shotNumber) ?? shot.shotNumber;
    const mappedPrevRef =
      shot.chainStatus === "chained"
        ? (shot.prevShotRef ? localMainMap.get(shot.prevShotRef) : null) ?? previousMainShotNumber
        : null;
    const isFirstMainShot = previousMainShotNumber === null;
    const isChained =
      shot.chainStatus === "chained" &&
      Boolean(mappedPrevRef) &&
      mappedPrevRef !== mappedShotNumber;

    return {
      ...shot,
      shotNumber: mappedShotNumber,
      prevShotRef: isChained ? mappedPrevRef ?? undefined : undefined,
      chainStatus: isFirstMainShot ? "first" : isChained ? "chained" : "break",
      chainBreakReason: isFirstMainShot || isChained ? undefined : shot.chainBreakReason ?? "scene reset",
    };
  }

  const parentShotNumber = shot.parentShotNumber ?? "";
  const mappedParentShotNumber = localMainMap.get(parentShotNumber) ?? parentShotNumber;
  const nextCoverageIndex = coverageIndexByParent.get(parentShotNumber) ?? 0;
  coverageIndexByParent.set(parentShotNumber, nextCoverageIndex + 1);
  const coverageSuffix = deriveCoverageSuffix(
    shot.shotNumber,
    shot.parentShotNumber,
    nextCoverageIndex,
  );

  return {
    ...shot,
    shotNumber: `${mappedParentShotNumber}${coverageSuffix}`,
    parentShotNumber: mappedParentShotNumber,
    chainStatus: "first",
    prevShotRef: undefined,
  };
}

export function mergeScenarioChunkPlans(params: {
  plans: ShotPlan[];
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
}): ShotPlan {
  const mergedScenes: ScenePlan[] = [];
  let nextSceneNumber = 1;
  let nextMainShotNumber = 1;
  let previousGlobalMainShotNumber: string | null = null;

  for (const plan of params.plans) {
    for (const scene of plan.scenes) {
      const mappedSceneNumber = nextSceneNumber;
      nextSceneNumber += 1;

      const localMainMap = new Map<string, string>();
      const coverageIndexByParent = new Map<string, number>();
      let currentPreviousMainShotNumber: string | null = previousGlobalMainShotNumber;

      for (const shot of scene.shots) {
        if (shot.type !== "main") {
          continue;
        }

        localMainMap.set(shot.shotNumber, formatShotNumber(nextMainShotNumber));
        nextMainShotNumber += 1;
      }

      const mappedShots: ShotPlanItem[] = [];

      for (const shot of scene.shots) {
        const mappedShot = mapMergedShot(
          shot,
          localMainMap,
          currentPreviousMainShotNumber,
          coverageIndexByParent,
        );

        mappedShots.push(mappedShot);

        if (mappedShot.type === "main") {
          currentPreviousMainShotNumber = mappedShot.shotNumber;
        }
      }

      previousGlobalMainShotNumber = currentPreviousMainShotNumber;

      mergedScenes.push({
        ...scene,
        sceneNumber: mappedSceneNumber,
        shots: mappedShots,
      });
    }
  }

  const allShots = mergedScenes.flatMap((scene) => scene.shots);
  const mainShots = allShots.filter((shot) => shot.type === "main");
  const coverageShots = allShots.filter((shot) => shot.type === "coverage");

  return {
    scenes: mergedScenes,
    totalMainShots: mainShots.length,
    totalCoverageShots: coverageShots.length,
    estimatedDurationS: allShots.reduce((sum, shot) => sum + (shot.durationS ?? 0), 0),
    tensionArc: mainShots.map((shot) => shot.tensionLevel ?? 3),
    dialogueNamePolicy: "preserve",
    targetModel: params.targetModel,
    klingPreset: params.klingPreset,
  };
}

export function getMainShots(plan: ShotPlan): PlannedMainShot[] {
  return plan.scenes.flatMap((scene) =>
    scene.shots
      .filter((shot) => shot.type === "main")
      .map((shot) => ({ scene, shot })),
  );
}

export function buildContinuityGroups(plan: ShotPlan): PlannedMainShot[][] {
  const plannedMainShots = getMainShots(plan);

  if (plannedMainShots.length === 0) {
    return [];
  }

  const groups: PlannedMainShot[][] = [];
  let currentGroup: PlannedMainShot[] = [];

  for (const entry of plannedMainShots) {
    const previousEntry = currentGroup[currentGroup.length - 1];
    const continuesPrevious =
      previousEntry &&
      entry.shot.chainStatus === "chained" &&
      entry.shot.prevShotRef === previousEntry.shot.shotNumber;

    if (!continuesPrevious && currentGroup.length > 0) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push(entry);
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}
