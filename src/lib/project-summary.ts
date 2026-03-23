export interface ProjectSummaryShot {
  parentShotId: string | null;
  isArchived: boolean;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  video4kPath: string | null;
  updatedAt: number;
}

export interface ProjectSummaryMetadata {
  mainShotCount: number;
  coverageShotCount: number;
  archivedShotCount: number;
  readyStartCount: number;
  readyEndCount: number;
  readyVideoCount: number;
  characterCount: number;
  assetCount: number;
}

export interface ProjectPresentationSummary {
  metadata: ProjectSummaryMetadata;
  thumbnail: string | null;
}

export interface ProjectSummaryCounts {
  characterCount?: number;
  assetCount?: number;
}

export function computeProjectPresentationSummary(
  shots: ProjectSummaryShot[],
  counts?: ProjectSummaryCounts,
): ProjectPresentationSummary {
  const mainShots = shots.filter((shot) => !shot.parentShotId);
  const visibleMainShots = mainShots.filter((shot) => !shot.isArchived);
  const sortedVisibleMainShots = visibleMainShots
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const thumbnailStartShot = sortedVisibleMainShots.find((shot) => Boolean(shot.imageStartPath));
  const thumbnailEndShot =
    thumbnailStartShot ??
    sortedVisibleMainShots.find((shot) => Boolean(shot.imageEndPath));

  return {
    metadata: {
      mainShotCount: mainShots.length,
      coverageShotCount: shots.filter((shot) => Boolean(shot.parentShotId)).length,
      archivedShotCount: shots.filter((shot) => shot.isArchived).length,
      readyStartCount: mainShots.filter((shot) => Boolean(shot.imageStartPath)).length,
      readyEndCount: mainShots.filter((shot) => Boolean(shot.imageEndPath)).length,
      readyVideoCount: mainShots.filter(
        (shot) => Boolean(shot.video4kPath || shot.videoPath),
      ).length,
      characterCount: Number(counts?.characterCount) || 0,
      assetCount: Number(counts?.assetCount) || 0,
    },
    thumbnail: thumbnailStartShot?.imageStartPath ?? thumbnailEndShot?.imageEndPath ?? null,
  };
}
