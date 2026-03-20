export interface BulkScopeShot {
  id: string;
  parentShotId: string | null;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  promptStart: string | null;
  promptEnd: string | null;
  promptVideo: string | null;
}

export interface BulkScopeOptions {
  produceStartFrames: boolean;
  produceEndFrames: boolean;
  produceCoverageImages: boolean;
  produceVideos: boolean;
  filter: "all" | "missing" | "selected";
  selectedShotIds?: string[];
}

export interface BulkScopeResult<TShot extends BulkScopeShot> {
  selectedMainShotIds: string[];
  mainShots: TShot[];
  coverageShots: TShot[];
}

export function getCoveragePrompt(shot: Pick<BulkScopeShot, "promptStart" | "promptEnd" | "promptVideo">): string | null {
  return shot.promptStart ?? shot.promptEnd ?? shot.promptVideo;
}

export function normalizeSelectedMainShotIds<TShot extends Pick<BulkScopeShot, "id" | "parentShotId">>(
  shots: readonly TShot[],
  selectedShotIds?: string[],
): string[] {
  if (!selectedShotIds?.length) {
    return [];
  }

  const shotsById = new Map(shots.map((shot) => [shot.id, shot] as const));
  const normalized = new Set<string>();

  for (const selectedShotId of selectedShotIds) {
    const shot = shotsById.get(selectedShotId);

    if (!shot) {
      continue;
    }

    normalized.add(shot.parentShotId ?? shot.id);
  }

  return Array.from(normalized);
}

function mainShotHasMissingWork(
  shot: BulkScopeShot,
  options: Pick<BulkScopeOptions, "produceStartFrames" | "produceEndFrames" | "produceVideos">,
): boolean {
  return Boolean(
    (options.produceStartFrames && shot.promptStart && !shot.imageStartPath) ||
      (options.produceEndFrames && shot.promptEnd && !shot.imageEndPath) ||
      (options.produceVideos && shot.promptVideo && !shot.videoPath),
  );
}

function coverageShotHasMissingWork(
  shot: BulkScopeShot,
  options: Pick<BulkScopeOptions, "produceCoverageImages" | "produceVideos">,
): boolean {
  const coveragePrompt = getCoveragePrompt(shot);
  return Boolean(
    (options.produceCoverageImages && coveragePrompt && !shot.imageStartPath) ||
      (options.produceVideos && shot.promptVideo && !shot.videoPath),
  );
}

export function resolveBulkScope<TShot extends BulkScopeShot>(
  shots: readonly TShot[],
  options: BulkScopeOptions,
): BulkScopeResult<TShot> {
  const selectedMainShotIds = normalizeSelectedMainShotIds(shots, options.selectedShotIds);
  let mainShots = shots.filter((shot) => !shot.parentShotId);
  let coverageShots = shots.filter((shot) => Boolean(shot.parentShotId));

  if (options.filter === "selected") {
    const selectedIds = new Set(selectedMainShotIds);
    mainShots = mainShots.filter((shot) => selectedIds.has(shot.id));
    coverageShots = coverageShots.filter((shot) =>
      selectedIds.has(shot.parentShotId ?? ""),
    );
  }

  if (options.filter === "missing") {
    mainShots = mainShots.filter((shot) => mainShotHasMissingWork(shot, options));
    coverageShots = coverageShots.filter((shot) =>
      coverageShotHasMissingWork(shot, options),
    );
  }

  return {
    selectedMainShotIds,
    mainShots,
    coverageShots,
  };
}

export function countPlannedBulkJobs<TShot extends BulkScopeShot>(
  shots: readonly TShot[],
  options: BulkScopeOptions,
): number {
  const scope = resolveBulkScope(shots, options);
  let count = 0;

  for (const shot of scope.mainShots) {
    if (options.produceStartFrames && shot.promptStart) {
      if (options.filter !== "missing" || !shot.imageStartPath) {
        count += 1;
      }
    }

    if (options.produceEndFrames && shot.promptEnd) {
      if (options.filter !== "missing" || !shot.imageEndPath) {
        count += 1;
      }
    }

    if (options.produceVideos && shot.promptVideo) {
      if (options.filter !== "missing" || !shot.videoPath) {
        count += 1;
      }
    }
  }

  for (const shot of scope.coverageShots) {
    const coveragePrompt = getCoveragePrompt(shot);

    if (options.produceCoverageImages && coveragePrompt) {
      if (options.filter !== "missing" || !shot.imageStartPath) {
        count += 1;
      }
    }

    if (options.produceVideos && shot.promptVideo) {
      if (options.filter !== "missing" || !shot.videoPath) {
        count += 1;
      }
    }
  }

  return count;
}
