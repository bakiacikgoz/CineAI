import {
  getAssetById,
  getShotAssets,
  updateAssetTags,
  type AssetWithTags,
} from "@/services/asset.service";
import {
  clampKlingDuration,
  resolveImageModel,
  type ImageModelId,
  type VideoModelId,
} from "@/services/fal.service";
import {
  enqueueStoryboardFrameJob,
  enqueueVideoJobs,
} from "@/services/jobqueue.service";
import {
  getShotMissingExternalReferenceMessage,
  getShotById,
  getShots,
  updateShotPaths,
  type ShotRow,
} from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";

export type AutonomousStage = "start" | "end" | "video";

export type AutonomousCandidateAsset = AssetWithTags & {
  stage: AutonomousStage | null;
  variant: number | null;
  isSelected: boolean;
};

export const AUTONOMOUS_VARIANT_COUNT = 4;

const AUTONOMOUS_TAG = "autonomous";
const CANDIDATE_TAG = "candidate";
const SELECTED_TAG = "selected";

interface AutonomousModelOptions {
  imageModel?: ImageModelId | "shot-default";
  videoModel?: VideoModelId;
}

function getStageTag(stage: AutonomousStage): string {
  return `stage:${stage}`;
}

function getVariantTag(variant: number): string {
  return `variant:${String(variant).padStart(2, "0")}`;
}

function parseAssetStage(tags: string[]): AutonomousStage | null {
  if (tags.includes(getStageTag("start"))) {
    return "start";
  }

  if (tags.includes(getStageTag("end"))) {
    return "end";
  }

  if (tags.includes(getStageTag("video"))) {
    return "video";
  }

  return null;
}

function parseVariant(tags: string[]): number | null {
  const variantTag = tags.find((tag) => tag.startsWith("variant:"));

  if (!variantTag) {
    return null;
  }

  const value = Number.parseInt(variantTag.replace("variant:", ""), 10);
  return Number.isFinite(value) ? value : null;
}

function hydrateCandidate(asset: AssetWithTags): AutonomousCandidateAsset {
  return {
    ...asset,
    stage: parseAssetStage(asset.tagsList),
    variant: parseVariant(asset.tagsList),
    isSelected: asset.tagsList.includes(SELECTED_TAG),
  };
}

function sortCandidates(left: AutonomousCandidateAsset, right: AutonomousCandidateAsset): number {
  if (left.isSelected !== right.isSelected) {
    return left.isSelected ? -1 : 1;
  }

  if (left.variant !== null && right.variant !== null && left.variant !== right.variant) {
    return left.variant - right.variant;
  }

  return right.created_at - left.created_at;
}

async function getShotAutonomousAssets(shotId: string): Promise<AutonomousCandidateAsset[]> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const assets = await getShotAssets(project.id, shotId);
  return assets
    .map(hydrateCandidate)
    .filter((asset) => asset.tagsList.includes(AUTONOMOUS_TAG) && asset.stage !== null)
    .sort(sortCandidates);
}

async function getShotAutonomousAssetsByStage(
  shotId: string,
  stage: AutonomousStage,
): Promise<AutonomousCandidateAsset[]> {
  const assets = await getShotAutonomousAssets(shotId);
  return assets.filter((asset) => asset.stage === stage);
}

async function queueStartCandidates(
  shot: ShotRow,
  options?: AutonomousModelOptions,
): Promise<number> {
  if (!shot.promptStart) {
    return 0;
  }

  const missingReference = getShotMissingExternalReferenceMessage(shot, "start");
  if (missingReference) {
    throw new Error(missingReference);
  }

  for (let variant = 1; variant <= AUTONOMOUS_VARIANT_COUNT; variant += 1) {
    await enqueueStoryboardFrameJob({
      shotId: shot.id,
      prompt: shot.promptStart,
      mode: "start",
      model:
        options?.imageModel && options.imageModel !== "shot-default"
          ? options.imageModel
          : resolveImageModel(shot.model),
      cfg: shot.cfg ?? 7,
      steps: 28,
      priority: 160 - variant,
      persistToShotPath: false,
      completeStatus: "review",
      outputSuffix: `auto_start_v${String(variant).padStart(2, "0")}`,
      assetTags: [
        AUTONOMOUS_TAG,
        CANDIDATE_TAG,
        getStageTag("start"),
        getVariantTag(variant),
      ],
    });
  }

  return AUTONOMOUS_VARIANT_COUNT;
}

async function queueEndCandidates(
  shot: ShotRow,
  options?: AutonomousModelOptions,
): Promise<number> {
  if (!shot.promptEnd) {
    return 0;
  }

  const missingReference = getShotMissingExternalReferenceMessage(shot, "end");
  if (missingReference) {
    throw new Error(missingReference);
  }

  for (let variant = 1; variant <= AUTONOMOUS_VARIANT_COUNT; variant += 1) {
    await enqueueStoryboardFrameJob({
      shotId: shot.id,
      prompt: shot.promptEnd,
      mode: "end",
      model:
        options?.imageModel && options.imageModel !== "shot-default"
          ? options.imageModel
          : resolveImageModel(shot.model),
      cfg: shot.cfg ?? 7,
      steps: 28,
      priority: 154 - variant,
      persistToShotPath: false,
      completeStatus: "review",
      outputSuffix: `auto_end_v${String(variant).padStart(2, "0")}`,
      assetTags: [
        AUTONOMOUS_TAG,
        CANDIDATE_TAG,
        getStageTag("end"),
        getVariantTag(variant),
      ],
    });
  }

  return AUTONOMOUS_VARIANT_COUNT;
}

async function queueVideoCandidates(
  shot: ShotRow,
  options?: AutonomousModelOptions,
): Promise<number> {
  if (!shot.promptVideo || !shot.imageStartPath) {
    return 0;
  }

  for (let variant = 1; variant <= AUTONOMOUS_VARIANT_COUNT; variant += 1) {
    await enqueueVideoJobs({
      model: options?.videoModel ?? "fal-ai/kling-video/v3/pro/image-to-video",
      prompt: shot.promptVideo,
      duration: clampKlingDuration(shot.durationS),
      aspectRatio: "16:9",
      cfg: 0.45,
      quantity: 1,
      shotId: shot.id,
      priority: 132 - variant,
      persistToShotPath: false,
      completeStatus: "review",
      outputSuffix: `auto_video_v${String(variant).padStart(2, "0")}`,
      assetTags: [
        AUTONOMOUS_TAG,
        CANDIDATE_TAG,
        getStageTag("video"),
        getVariantTag(variant),
      ],
    });
  }

  return AUTONOMOUS_VARIANT_COUNT;
}

async function canQueueStartCandidates(shot: ShotRow): Promise<boolean> {
  if (shot.chainStatus !== "continue" || !shot.prevShotId) {
    return true;
  }

  const previousShot = await getShotById(shot.prevShotId);
  return Boolean(previousShot?.imageEndPath);
}

async function maybeQueueVideoCandidates(
  shotId: string,
  options?: AutonomousModelOptions,
): Promise<number> {
  const shot = await getShotById(shotId);

  if (!shot || !shot.promptVideo || !shot.imageStartPath || !shot.imageEndPath) {
    return 0;
  }

  const candidates = await getShotAutonomousAssetsByStage(shot.id, "video");

  if (candidates.length > 0) {
    return 0;
  }

  return queueVideoCandidates(shot, options);
}

async function maybeUnlockDependentStarts(
  selectedEndShotId: string,
  options?: AutonomousModelOptions,
): Promise<number> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const shots = await getShots(project.id);
  let queued = 0;

  for (const shot of shots) {
    if (shot.prevShotId !== selectedEndShotId || shot.chainStatus !== "continue") {
      continue;
    }

    const stageCandidates = await getShotAutonomousAssetsByStage(shot.id, "start");

    if (stageCandidates.length > 0 || !(await canQueueStartCandidates(shot))) {
      continue;
    }

    queued += await queueStartCandidates(shot, options);
  }

  return queued;
}

export async function getAutonomousCandidateGroups(shotId: string): Promise<
  Record<AutonomousStage, AutonomousCandidateAsset[]>
> {
  const assets = await getShotAutonomousAssets(shotId);

  return {
    start: assets.filter((asset) => asset.stage === "start"),
    end: assets.filter((asset) => asset.stage === "end"),
    video: assets.filter((asset) => asset.stage === "video"),
  };
}

export async function bootstrapAutonomousShot(
  shotId: string,
  options?: AutonomousModelOptions,
): Promise<{ jobCount: number }> {
  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const existingCandidates = await getAutonomousCandidateGroups(shot.id);
  let jobCount = 0;
  const missingReferences: string[] = [];

  if (existingCandidates.end.length === 0 && shot.promptEnd) {
    const missingReference = getShotMissingExternalReferenceMessage(shot, "end");
    if (missingReference) {
      missingReferences.push(`${shot.shotNumber} END`);
    }
  }

  if (
    existingCandidates.start.length === 0 &&
    shot.promptStart &&
    (await canQueueStartCandidates(shot))
  ) {
    const missingReference = getShotMissingExternalReferenceMessage(shot, "start");
    if (missingReference) {
      missingReferences.push(`${shot.shotNumber} START`);
    }
  }

  if (missingReferences.length > 0) {
    throw new Error(
      `Otonom mod baslatilamadi. Harici referans gorseli eksik: ${missingReferences.join(", ")}.`,
    );
  }

  if (existingCandidates.end.length === 0) {
    jobCount += await queueEndCandidates(shot, options);
  }

  if (existingCandidates.start.length === 0 && (await canQueueStartCandidates(shot))) {
    jobCount += await queueStartCandidates(shot, options);
  }

  if (existingCandidates.video.length === 0) {
    jobCount += await maybeQueueVideoCandidates(shot.id, options);
  }

  return { jobCount };
}

export async function bootstrapAutonomousBulk(
  shotIds: string[],
  options?: AutonomousModelOptions,
): Promise<{ jobCount: number }> {
  const missingReferences: string[] = [];

  for (const shotId of shotIds) {
    const shot = await getShotById(shotId);

    if (!shot) {
      continue;
    }

    const existingCandidates = await getAutonomousCandidateGroups(shot.id);
    if (existingCandidates.end.length === 0 && shot.promptEnd) {
      const missingReference = getShotMissingExternalReferenceMessage(shot, "end");
      if (missingReference) {
        missingReferences.push(`${shot.shotNumber} END`);
      }
    }

    if (
      existingCandidates.start.length === 0 &&
      shot.promptStart &&
      (await canQueueStartCandidates(shot))
    ) {
      const missingReference = getShotMissingExternalReferenceMessage(shot, "start");
      if (missingReference) {
        missingReferences.push(`${shot.shotNumber} START`);
      }
    }
  }

  if (missingReferences.length > 0) {
    throw new Error(
      `Otonom toplu uretim baslatilamadi. Harici referans gorseli eksik: ${missingReferences.join(", ")}.`,
    );
  }

  let jobCount = 0;

  for (const shotId of shotIds) {
    const result = await bootstrapAutonomousShot(shotId, options);
    jobCount += result.jobCount;
  }

  return { jobCount };
}

export async function regenerateAutonomousStage(
  shotId: string,
  stage: AutonomousStage,
  options?: AutonomousModelOptions,
): Promise<{ jobCount: number }> {
  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const referenceMode = stage === "video" ? null : stage;
  if (referenceMode) {
    const missingReference = getShotMissingExternalReferenceMessage(shot, referenceMode);
    if (missingReference) {
      throw new Error(missingReference);
    }
  }

  if (stage === "start" && !(await canQueueStartCandidates(shot))) {
    throw new Error("Bu shot icin START adaylari onceki END secimi bekliyor.");
  }

  const jobCount =
    stage === "start"
      ? await queueStartCandidates(shot, options)
      : stage === "end"
        ? await queueEndCandidates(shot, options)
        : await queueVideoCandidates(shot, options);

  return { jobCount };
}

export async function selectAutonomousCandidate(
  shotId: string,
  assetId: string,
): Promise<{ stage: AutonomousStage; queuedJobs: number }> {
  const asset = await getAssetById(assetId);

  if (!asset) {
    throw new Error("Asset bulunamadi.");
  }

  const hydrated = hydrateCandidate(asset);

  if (!hydrated.stage || !hydrated.tagsList.includes(AUTONOMOUS_TAG)) {
    throw new Error("Secilen asset otonom aday degil.");
  }

  const stageAssets = await getShotAutonomousAssetsByStage(shotId, hydrated.stage);

  for (const candidate of stageAssets) {
    const nextTags = candidate.tagsList.filter((tag) => tag !== SELECTED_TAG);

    if (candidate.id === assetId) {
      nextTags.push(SELECTED_TAG);
    }

    await updateAssetTags(candidate.id, nextTags);
  }

  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  let queuedJobs = 0;

  if (hydrated.stage === "start") {
    await updateShotPaths(shotId, {
      imageStartPath: hydrated.file_path,
      imageStatus: shot.imageEndPath ? "done" : "review",
    });
    queuedJobs += await maybeQueueVideoCandidates(shotId);
  } else if (hydrated.stage === "end") {
    await updateShotPaths(shotId, {
      imageEndPath: hydrated.file_path,
      imageStatus: shot.imageStartPath ? "done" : "review",
    });
    queuedJobs += await maybeQueueVideoCandidates(shotId);
    queuedJobs += await maybeUnlockDependentStarts(shotId);
  } else {
    await updateShotPaths(shotId, {
      videoPath: hydrated.file_path,
      videoStatus: "done",
    });
  }

  return {
    stage: hydrated.stage,
    queuedJobs,
  };
}
