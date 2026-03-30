import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { saveAsset } from "@/services/asset.service";
import { getProjectDb } from "@/db/project-db";
import { logCost } from "@/services/cost.service";
import {
  LIPSYNC_MODELS,
  downloadVideoToLocal,
  generateLipSyncVideoOnFal,
} from "@/services/fal.service";
import {
  deriveLipSyncState,
  resolveLipSyncPlan,
  type LipSyncModelId,
  type LipSyncStatus,
  type ResolvedLipSyncPlan,
} from "@/lib/lipsync";
import { getShotById, getShots, updateShotPaths, type ShotRow } from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";

export type { LipSyncModelId, LipSyncStatus, ResolvedLipSyncPlan } from "@/lib/lipsync";
export { calcLipSyncCost } from "@/lib/lipsync";

export interface LipSyncShotDetail {
  shot: ShotRow;
  status: LipSyncStatus;
  isEligible: boolean;
  isStale: boolean;
  blockerReasons: string[];
  staleReasons: string[];
  sourceVideoPath: string | null;
  fallbackVideoPath: string | null;
  sourceAudioPath: string | null;
  masterVideoPath: string | null;
  masterVideoAbsolutePath: string | null;
  masterVideoUrl: string | null;
  videoDurationS: number | null;
  audioDurationS: number | null;
  resolvedPlan: ResolvedLipSyncPlan | null;
  estimatedCostUsd: number | null;
  modelLabel: string | null;
  metadata: Record<string, unknown> | null;
}

function ensureActiveProject() {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  return project;
}

function normalizeStoredPath(path: string | null | undefined): string | null {
  return path ? path.replace(/\\/g, "/") : null;
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toRelativeProjectPath(projectFolderPath: string, absolutePath: string): string {
  const normalizedProjectPath = projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedAbsolutePath = absolutePath.replace(/\\/g, "/");

  if (!normalizedAbsolutePath.startsWith(normalizedProjectPath)) {
    return normalizedAbsolutePath;
  }

  return normalizedAbsolutePath.slice(normalizedProjectPath.length + 1);
}

async function resolveProjectFilePath(
  projectFolderPath: string,
  relativePath: string,
): Promise<string> {
  return join(projectFolderPath, ...relativePath.split(/[\\/]+/).filter(Boolean));
}

async function projectFileExists(
  projectFolderPath: string,
  relativePath: string | null | undefined,
): Promise<boolean> {
  if (!relativePath) {
    return false;
  }

  try {
    return await exists(await resolveProjectFilePath(projectFolderPath, relativePath));
  } catch {
    return false;
  }
}

async function findAssetDurationS(
  projectId: string,
  filePath: string | null | undefined,
): Promise<number | null> {
  const normalizedPath = normalizeStoredPath(filePath);
  if (!normalizedPath) {
    return null;
  }

  const db = await getProjectDb();
  const rows = await db.select<Array<{ durationS: number | null }>>(
    `SELECT duration_s AS durationS
     FROM assets
     WHERE project_id = $1
       AND REPLACE(file_path, '\\', '/') = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId, normalizedPath],
  );

  return typeof rows[0]?.durationS === "number" && Number.isFinite(rows[0].durationS)
    ? rows[0].durationS
    : null;
}

async function waitForMediaMetadata(
  media: HTMLMediaElement,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      media.removeEventListener("loadedmetadata", handleLoaded);
      media.removeEventListener("error", handleError);
    }

    function handleLoaded() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(new Error("Medya suresi okunamadi."));
    }

    media.addEventListener("loadedmetadata", handleLoaded, { once: true });
    media.addEventListener("error", handleError, { once: true });
  });
}

function createHiddenMediaElement(
  tagName: "audio" | "video",
): { wrapper: HTMLDivElement; media: HTMLMediaElement } {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.pointerEvents = "none";
  wrapper.style.opacity = "0";
  wrapper.style.width = "1px";
  wrapper.style.height = "1px";
  wrapper.style.overflow = "hidden";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";

  const media = document.createElement(tagName);
  media.preload = "metadata";
  if (tagName === "video") {
    (media as HTMLVideoElement).muted = true;
    (media as HTMLVideoElement).playsInline = true;
  }

  wrapper.appendChild(media);
  document.body.appendChild(wrapper);

  return { wrapper, media };
}

async function resolveMediaElementDurationS(
  absolutePath: string,
  kind: "audio" | "video",
): Promise<number | null> {
  if (typeof document === "undefined") {
    return null;
  }

  const { wrapper, media } = createHiddenMediaElement(kind);

  try {
    media.src = convertFileSrc(absolutePath);
    media.load();

    if (!Number.isFinite(media.duration) || media.readyState < 1) {
      await waitForMediaMetadata(media);
    }

    return Number.isFinite(media.duration) && media.duration > 0
      ? media.duration
      : null;
  } catch {
    return null;
  } finally {
    media.pause();
    media.removeAttribute("src");
    media.load();
    wrapper.remove();
  }
}

function extractAudioAlignmentDurationS(shot: ShotRow): number | null {
  const payload = parseJsonObject(shot.audioTimestampsJson);
  if (!payload) {
    return null;
  }

  const normalizedAlignment = payload.normalizedAlignment as
    | {
        character_end_times_seconds?: number[];
      }
    | undefined;
  const alignment = payload.alignment as
    | {
        character_end_times_seconds?: number[];
      }
    | undefined;
  const voiceSegments = payload.voiceSegments as
    | Array<{ end?: number | null }>
    | undefined;

  const alignmentEnds = normalizedAlignment?.character_end_times_seconds ??
    alignment?.character_end_times_seconds;

  if (Array.isArray(alignmentEnds) && alignmentEnds.length > 0) {
    const maxEnd = Math.max(...alignmentEnds.filter((value) => Number.isFinite(value)));
    if (Number.isFinite(maxEnd) && maxEnd > 0) {
      return maxEnd;
    }
  }

  if (Array.isArray(voiceSegments) && voiceSegments.length > 0) {
    const maxEnd = Math.max(
      ...voiceSegments
        .map((segment) => segment.end)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    );

    return Number.isFinite(maxEnd) && maxEnd > 0 ? maxEnd : null;
  }

  return null;
}

async function resolveShotMediaDurationS(params: {
  shot: ShotRow;
  projectId: string;
  projectFolderPath: string;
  filePath: string | null;
  kind: "audio" | "video";
}): Promise<number | null> {
  const normalizedPath = normalizeStoredPath(params.filePath);

  if (normalizedPath) {
    try {
      const absolutePath = await resolveProjectFilePath(
        params.projectFolderPath,
        normalizedPath,
      );

      if (await exists(absolutePath)) {
        const mediaDuration = await resolveMediaElementDurationS(absolutePath, params.kind);
        if (typeof mediaDuration === "number" && mediaDuration > 0) {
          return mediaDuration;
        }
      }
    } catch {
      // Fall through to DB and shot-level fallbacks.
    }

    const assetDuration = await findAssetDurationS(params.projectId, normalizedPath);
    if (typeof assetDuration === "number" && assetDuration > 0) {
      return assetDuration;
    }
  }

  if (params.kind === "video" && typeof params.shot.durationS === "number" && params.shot.durationS > 0) {
    return params.shot.durationS;
  }

  if (params.kind === "audio") {
    const audioAlignmentDuration = extractAudioAlignmentDurationS(params.shot);
    if (typeof audioAlignmentDuration === "number" && audioAlignmentDuration > 0) {
      return audioAlignmentDuration;
    }

    if (typeof params.shot.durationS === "number" && params.shot.durationS > 0) {
      return params.shot.durationS;
    }
  }

  return null;
}

function shouldRetryWithHd(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return [
    "4k",
    "resolution",
    "dimension",
    "width",
    "height",
    "too large",
    "size limit",
    "input video",
    "exceeds",
  ].some((pattern) => message.includes(pattern));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error
        ? error.name === "AbortError" || error.message === "Islem iptal edildi."
        : false
  );
}

async function buildLipSyncShotDetail(
  shot: ShotRow,
  projectId: string,
  projectFolderPath: string,
): Promise<LipSyncShotDetail> {
  const preferred4kPath = normalizeStoredPath(shot.video4kPath);
  const hdVideoPath = normalizeStoredPath(shot.videoPath);
  let sourceVideoPath = normalizeStoredPath(shot.video4kPath ?? shot.videoPath);
  let fallbackVideoPath =
    shot.video4kPath && shot.videoPath
      ? normalizeStoredPath(shot.videoPath)
      : null;
  const sourceAudioPath = normalizeStoredPath(shot.audioMasterPath);
  const blockerReasons: string[] = [];

  if (preferred4kPath && !(await projectFileExists(projectFolderPath, preferred4kPath)) && hdVideoPath) {
    sourceVideoPath = hdVideoPath;
    fallbackVideoPath = null;
  }

  if (!sourceVideoPath) {
    blockerReasons.push("Master video yok.");
  } else if (!(await projectFileExists(projectFolderPath, sourceVideoPath))) {
    blockerReasons.push("Master video dosyasi bulunamadi.");
  }

  if (!sourceAudioPath) {
    blockerReasons.push("Master audio yok.");
  } else if (!(await projectFileExists(projectFolderPath, sourceAudioPath))) {
    blockerReasons.push("Master audio dosyasi bulunamadi.");
  }

  const [videoDurationS, audioDurationS] = await Promise.all([
    resolveShotMediaDurationS({
      shot,
      projectId,
      projectFolderPath,
      filePath: sourceVideoPath,
      kind: "video",
    }),
    resolveShotMediaDurationS({
      shot,
      projectId,
      projectFolderPath,
      filePath: sourceAudioPath,
      kind: "audio",
    }),
  ]);
  const resolvedPlan =
    sourceVideoPath && sourceAudioPath
      ? resolveLipSyncPlan({
          shotType: shot.shotType,
          cameraAngle: shot.cameraAngle,
          summaryTr: shot.summaryTr,
          promptVideo: shot.promptVideo,
          videoDurationS,
          audioDurationS,
          preferredVideoPath: sourceVideoPath,
          fallbackVideoPath,
        })
      : null;
  const derivedState = deriveLipSyncState({
    persistedStatus: shot.lipsyncStatus,
    hasMaster: Boolean(shot.lipsyncVideoPath),
    blockerReasons,
    sourceVideoPath: normalizeStoredPath(shot.lipsyncSourceVideoPath),
    sourceAudioPath: normalizeStoredPath(shot.lipsyncSourceAudioPath),
    currentVideoPath: sourceVideoPath,
    currentAudioPath: sourceAudioPath,
  });
  const masterVideoPath = normalizeStoredPath(shot.lipsyncVideoPath);
  const masterVideoAbsolutePath = masterVideoPath
    ? await resolveProjectFilePath(projectFolderPath, masterVideoPath)
    : null;
  const masterVideoUrl = masterVideoAbsolutePath
    ? convertFileSrc(masterVideoAbsolutePath)
    : null;
  const modelId =
    shot.lipsyncModelUsed && shot.lipsyncModelUsed in LIPSYNC_MODELS
      ? (shot.lipsyncModelUsed as LipSyncModelId)
      : resolvedPlan?.modelId ?? null;

  return {
    shot,
    status: derivedState.status,
    isEligible: blockerReasons.length === 0 && Boolean(resolvedPlan),
    isStale: derivedState.isStale,
    blockerReasons,
    staleReasons: derivedState.staleReasons,
    sourceVideoPath,
    fallbackVideoPath,
    sourceAudioPath,
    masterVideoPath,
    masterVideoAbsolutePath,
    masterVideoUrl,
    videoDurationS,
    audioDurationS,
    resolvedPlan,
    estimatedCostUsd: resolvedPlan?.estimatedCostUsd ?? null,
    modelLabel: modelId ? LIPSYNC_MODELS[modelId].label : shot.lipsyncModelUsed,
    metadata: parseJsonObject(shot.lipsyncMetadataJson),
  };
}

export async function getLipSyncDetailByShotId(
  shotId: string,
): Promise<LipSyncShotDetail | null> {
  const project = ensureActiveProject();
  const shot = await getShotById(shotId);

  if (!shot) {
    return null;
  }

  return buildLipSyncShotDetail(shot, project.id, project.folderPath);
}

export async function listLipSyncEligibleShots(): Promise<LipSyncShotDetail[]> {
  const project = ensureActiveProject();
  const shots = await getShots(project.id);
  const relevantShots = shots.filter(
    (shot) =>
      Boolean(shot.audioDirectionJson) ||
      Boolean(shot.audioVoiceoverText?.trim()) ||
      Boolean(shot.audioMasterPath) ||
      Boolean(shot.lipsyncVideoPath) ||
      shot.lipsyncStatus !== "none",
  );

  return Promise.all(
    relevantShots.map((shot) =>
      buildLipSyncShotDetail(shot, project.id, project.folderPath),
    ),
  );
}

export async function clearShotLipSyncMaster(shotId: string): Promise<void> {
  await updateShotPaths(shotId, {
    lipsyncVideoPath: null,
    lipsyncStatus: "none",
    lipsyncModelUsed: null,
    lipsyncCostUsd: null,
    lipsyncError: null,
    lipsyncSourceVideoPath: null,
    lipsyncSourceAudioPath: null,
    lipsyncMetadataJson: null,
  });
}

export async function generateLipSyncVideo(params: {
  shotId: string;
  jobId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<{
  outputPath: string;
  relativePath: string;
  costUsd: number;
  assetId: string;
  plan: ResolvedLipSyncPlan;
  retriedWithHd: boolean;
}> {
  const project = ensureActiveProject();
  const shot = await getShotById(params.shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const detail = await buildLipSyncShotDetail(shot, project.id, project.folderPath);
  const plan = detail.resolvedPlan;

  if (!plan || !detail.sourceVideoPath || !detail.sourceAudioPath) {
    throw new Error(detail.blockerReasons[0] ?? "Lipsync icin gerekli medya hazir degil.");
  }

  const outputFolder = await join(project.folderPath, "assets", "videos");
  const outputFilename = `${shot.shotNumber.toLowerCase()}_lipsync_${(params.jobId ?? Date.now()).toString().slice(-8)}.mp4`;
  const outputPath = await join(outputFolder, outputFilename);

  await mkdir(outputFolder, { recursive: true });

  params.onProgress?.(8);
  await updateShotPaths(shot.id, {
    lipsyncStatus: "generating",
    lipsyncError: null,
    lipsyncModelUsed: plan.modelId,
  });

  let selectedVideoPath = detail.sourceVideoPath;
  let retriedWithHd = false;

  try {
    const primaryAbsolutePath = await resolveProjectFilePath(project.folderPath, selectedVideoPath);
    const audioAbsolutePath = await resolveProjectFilePath(project.folderPath, detail.sourceAudioPath);
    let generationResult;

    try {
      generationResult = await generateLipSyncVideoOnFal({
        jobId: params.jobId ?? shot.id,
        model: plan.modelId,
        videoPath: primaryAbsolutePath,
        audioPath: audioAbsolutePath,
        syncMode: plan.syncMode,
        abortSignal: params.abortSignal,
        onProgress: params.onProgress,
      });
    } catch (error) {
      if (
        detail.fallbackVideoPath &&
        selectedVideoPath === detail.sourceVideoPath &&
        detail.sourceVideoPath === normalizeStoredPath(shot.video4kPath) &&
        shouldRetryWithHd(error)
      ) {
        retriedWithHd = true;
        selectedVideoPath = detail.fallbackVideoPath;
        const fallbackAbsolutePath = await resolveProjectFilePath(project.folderPath, selectedVideoPath);
        generationResult = await generateLipSyncVideoOnFal({
          jobId: params.jobId ?? shot.id,
          model: plan.modelId,
          videoPath: fallbackAbsolutePath,
          audioPath: audioAbsolutePath,
          syncMode: plan.syncMode,
          abortSignal: params.abortSignal,
          onProgress: params.onProgress,
        });
      } else {
        throw error;
      }
    }

    params.onProgress?.(88);
    await downloadVideoToLocal(generationResult.url, outputPath, params.abortSignal);

    const relativePath = toRelativeProjectPath(project.folderPath, outputPath);
    const resolution =
      selectedVideoPath === normalizeStoredPath(shot.video4kPath) ? "4K" : "HD";
    const metadata = {
      kind: "lipsync",
      selectedModel: plan.modelId,
      syncMode: plan.syncMode,
      selectedReason: plan.reason,
      reasonTags: plan.reasonTags,
      closeUpScore: plan.closeUpScore,
      sourceVideoPath: selectedVideoPath,
      preferredVideoPath: detail.sourceVideoPath,
      fallbackVideoPath: detail.fallbackVideoPath,
      sourceAudioPath: detail.sourceAudioPath,
      videoDurationS: plan.videoDurationS,
      audioDurationS: plan.audioDurationS,
      durationDeltaS: plan.durationDeltaS,
      durationDeltaRatio: plan.durationDeltaRatio,
      retriedWithHd,
      falRequestId: generationResult.requestId ?? null,
    } satisfies Record<string, unknown>;
    const outputDurationS = Math.max(detail.videoDurationS ?? 0, detail.audioDurationS ?? 0, 1);
    const assetId = await saveAsset({
      projectId: project.id,
      type: "video",
      filePath: relativePath,
      filename: outputFilename,
      durationS: outputDurationS,
      resolution,
      modelUsed: plan.modelId,
      prompt: shot.promptVideo ?? shot.summaryTr ?? shot.shotNumber,
      costUsd: plan.estimatedCostUsd,
      falJobId: generationResult.requestId,
      shotId: shot.id,
      metadata,
      tags: ["stage:video", "lipsync"],
    });

    await updateShotPaths(shot.id, {
      lipsyncVideoPath: relativePath,
      lipsyncStatus: "done",
      lipsyncModelUsed: plan.modelId,
      lipsyncCostUsd: plan.estimatedCostUsd,
      lipsyncError: null,
      lipsyncSourceVideoPath: selectedVideoPath,
      lipsyncSourceAudioPath: detail.sourceAudioPath,
      lipsyncMetadataJson: JSON.stringify(metadata),
    });

    await logCost({
      projectId: project.id,
      jobId: params.jobId,
      model: plan.modelId,
      type: "lipsync",
      amountUsd: plan.estimatedCostUsd,
      units: outputDurationS,
    });

    params.onProgress?.(96);

    return {
      outputPath,
      relativePath,
      costUsd: plan.estimatedCostUsd,
      assetId,
      plan,
      retriedWithHd,
    };
  } catch (error) {
    await updateShotPaths(shot.id, {
      lipsyncStatus: isAbortError(error) ? (shot.lipsyncVideoPath ? "done" : "none") : "error",
      lipsyncError: isAbortError(error)
        ? null
        : error instanceof Error
          ? error.message
          : "Lipsync uretimi basarisiz.",
    });
    throw error;
  }
}
