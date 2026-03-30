import { getDb } from "@/db";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { isVideoQueueJobType } from "@/lib/job-queue-types";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  clampKlingDuration,
  type ImageModelId,
  type KlingShotType,
  type VideoModelId,
} from "@/services/fal.service";
import {
  enqueueAudioDialogueJob,
  enqueueImageJobs,
  enqueueLipSyncJob,
  enqueueStoryboardFrameJob,
  enqueueUpscaleJobs,
  enqueueVideoJobs,
} from "@/services/jobqueue.service";
import {
  getShots,
  updateShotAudioFields,
  updateShotPaths,
} from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore, type Job } from "@/store/queue.store";

type PersistedJobRow = {
  id: string;
  project_id: string;
  type: Job["type"];
  status: Job["status"];
  priority: number;
  shot_id: string | null;
  asset_id: string | null;
  model: string | null;
  prompt: string | null;
  params: string | null;
  ref_image_path: string | null;
  fal_job_id: string | null;
  tensorpix_job_id: string | null;
  progress: number;
  error_msg: string | null;
  cost_usd: number | null;
  result_path: string | null;
  queued_at: number;
  started_at: number | null;
  completed_at: number | null;
  sequence_order: number | null;
};

let initialized = false;
let isHydrating = false;
let lastProjectId: string | null = null;
let lastProjectFolderPath: string | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushingSnapshot = false;
const persistedSnapshotKeysByProject = new Map<string, string>();
let pendingSyncSnapshot: {
  projectId: string;
  projectFolderPath: string;
  jobs: Job[];
  key: string;
} | null = null;

function coerceVideoModel(model: string | undefined): VideoModelId | undefined {
  return model && model in VIDEO_MODELS ? (model as VideoModelId) : undefined;
}

function coerceImageModel(model: string | undefined): ImageModelId | undefined {
  return model && model in IMAGE_MODELS ? (model as ImageModelId) : undefined;
}

function parseParams(params: string | null): Record<string, unknown> | undefined {
  if (!params) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(params) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeParams(params?: Record<string, unknown>): string | null {
  return params ? JSON.stringify(params) : null;
}

function fromRow(row: PersistedJobRow): Job {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    shotId: row.shot_id ?? undefined,
    assetId: row.asset_id ?? undefined,
    model: row.model ?? undefined,
    prompt: row.prompt ?? undefined,
    params: parseParams(row.params),
    refImagePath: row.ref_image_path ?? undefined,
    falJobId: row.fal_job_id ?? undefined,
    tensorpixJobId: row.tensorpix_job_id ?? undefined,
    progress: row.progress ?? 0,
    errorMsg: row.error_msg ?? undefined,
    costUsd: row.cost_usd ?? undefined,
    resultPath: row.result_path ?? undefined,
    queuedAt: row.queued_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    sequenceOrder: row.sequence_order ?? undefined,
  };
}

async function listPersistedJobs(projectId: string): Promise<Job[]> {
  return withSqliteLockRetry(async () => {
    const db = await getProjectDb();
    const rows = await db.select<PersistedJobRow[]>(
      `SELECT *
       FROM job_queue
       WHERE project_id = $1
       ORDER BY queued_at ASC, priority DESC`,
      [projectId],
    );
    return rows.map(fromRow);
  });
}

function dedupeJobsById(jobs: Job[]): Job[] {
  const seen = new Set<string>();
  const uniqueJobs: Job[] = [];

  for (let index = jobs.length - 1; index >= 0; index -= 1) {
    const job = jobs[index];

    if (seen.has(job.id)) {
      continue;
    }

    seen.add(job.id);
    uniqueJobs.unshift(job);
  }

  return uniqueJobs;
}

function buildActiveShotJobTypeMap(jobs: Job[]): Map<string, Set<Job["type"]>> {
  const map = new Map<string, Set<Job["type"]>>();

  for (const job of jobs) {
    if (
      !job.shotId ||
      (job.status !== "queued" && job.status !== "active")
    ) {
      continue;
    }

    const current = map.get(job.shotId) ?? new Set<Job["type"]>();
    current.add(job.type);
    map.set(job.shotId, current);
  }

  return map;
}

function hasActiveShotJob(
  jobsByShotId: Map<string, Set<Job["type"]>>,
  shotId: string,
  jobTypes: Job["type"][],
): boolean {
  const activeTypes = jobsByShotId.get(shotId);
  return jobTypes.some((jobType) => activeTypes?.has(jobType));
}

async function reconcileOrphanedGeneratingShotStatuses(
  projectId: string,
  jobs: Job[],
): Promise<void> {
  const jobsByShotId = buildActiveShotJobTypeMap(jobs);
  const shots = await getShots(projectId, { includeArchived: true });

  for (const shot of shots) {
    const pendingUpdates: Array<Promise<void>> = [];

    if (
      shot.imageStatus === "generating" &&
      !hasActiveShotJob(jobsByShotId, shot.id, [
        "image_start",
        "image_end",
        "coverage_image",
      ])
    ) {
      pendingUpdates.push(
        updateShotPaths(shot.id, {
          imageStatus:
            shot.imageStartPath || shot.imageEndPath ? "done" : "pending",
        }),
      );
    }

    if (
      shot.videoStatus === "generating" &&
      !hasActiveShotJob(jobsByShotId, shot.id, ["video", "coverage_video"])
    ) {
      pendingUpdates.push(
        updateShotPaths(shot.id, {
          videoStatus:
            shot.video4kPath || shot.videoPath ? "done" : "pending",
        }),
      );
    }

    if (
      shot.upscaleStatus === "generating" &&
      !hasActiveShotJob(jobsByShotId, shot.id, ["upscale"])
    ) {
      pendingUpdates.push(
        updateShotPaths(shot.id, {
          upscaleStatus: shot.video4kPath ? "done" : "none",
        }),
      );
    }

    if (
      shot.audioStatus === "generating" &&
      !hasActiveShotJob(jobsByShotId, shot.id, ["audio_dialogue"])
    ) {
      pendingUpdates.push(
        updateShotAudioFields(shot.id, {
          audioStatus: shot.audioMasterPath ? "done" : "pending",
          audioError: null,
        }),
      );
    }

    if (
      shot.lipsyncStatus === "generating" &&
      !hasActiveShotJob(jobsByShotId, shot.id, ["lipsync"])
    ) {
      pendingUpdates.push(
        updateShotPaths(shot.id, {
          lipsyncStatus: shot.lipsyncVideoPath ? "done" : "none",
          lipsyncError: null,
        }),
      );
    }

    if (pendingUpdates.length > 0) {
      await Promise.all(pendingUpdates);
    }
  }
}

function isTerminalJobStatus(status: Job["status"]): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

function buildSnapshotKey(jobs: Job[]): string {
  return JSON.stringify(
    dedupeJobsById(jobs).map((job) => {
      const isTerminal = isTerminalJobStatus(job.status);

      return {
        id: job.id,
        projectId: job.projectId,
        type: job.type,
        status: job.status,
        priority: job.priority,
        shotId: job.shotId ?? null,
        assetId: job.assetId ?? null,
        model: job.model ?? null,
        prompt: job.prompt ?? null,
        params: job.params ?? null,
        refImagePath: job.refImagePath ?? null,
        falJobId: job.falJobId ?? null,
        tensorpixJobId: job.tensorpixJobId ?? null,
        progress: isTerminal ? job.progress : undefined,
        errorMsg: isTerminal ? job.errorMsg ?? null : undefined,
        costUsd: isTerminal ? job.costUsd ?? null : undefined,
        resultPath: isTerminal ? job.resultPath ?? null : undefined,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt ?? null,
        completedAt: isTerminal ? job.completedAt ?? null : undefined,
        sequenceOrder: job.sequenceOrder ?? null,
      };
    }),
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSqliteLockError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("database is locked") ||
    message.includes("database is busy") ||
    message.includes("sqlite_busy")
  );
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSqliteLockRetry<T>(operation: () => Promise<T>): Promise<T> {
  const retryDelaysMs = [80, 180, 320];

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteLockError(error) || attempt === retryDelaysMs.length) {
        throw error;
      }

      await wait(retryDelaysMs[attempt]);
    }
  }

  throw new Error("SQLite retry flow exhausted unexpectedly.");
}

async function replacePersistedJobs(
  projectId: string,
  jobs: Job[],
  projectFolderPath?: string,
): Promise<void> {
  const uniqueJobs = dedupeJobsById(jobs);

  await withSqliteLockRetry(async () => {
    const db = projectFolderPath ? await getDb(projectFolderPath) : await getProjectDb();
    await db.execute("DELETE FROM job_queue WHERE project_id = $1", [projectId]);

    for (const job of uniqueJobs) {
      await db.execute(
        `INSERT OR REPLACE INTO job_queue (
          id, project_id, type, status, priority, shot_id, asset_id,
          model, prompt, params, ref_image_path, fal_job_id, tensorpix_job_id,
          progress, error_msg, cost_usd, result_path, queued_at, started_at,
          completed_at, sequence_order
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19, $20, $21
        )`,
        [
          job.id,
          job.projectId,
          job.type,
          job.status,
          job.priority,
          job.shotId ?? null,
          job.assetId ?? null,
          job.model ?? null,
          job.prompt ?? null,
          serializeParams(job.params),
          job.refImagePath ?? null,
          job.falJobId ?? null,
          job.tensorpixJobId ?? null,
          job.progress,
          job.errorMsg ?? null,
          job.costUsd ?? null,
          job.resultPath ?? null,
          job.queuedAt,
          job.startedAt ?? null,
          job.completedAt ?? null,
          job.sequenceOrder ?? null,
        ],
      );
    }
  });

  try {
    await withSqliteLockRetry(() => syncProjectDbMirror(projectFolderPath));
  } catch (error) {
    console.warn("Skipped job queue mirror sync after lock contention.", error);
  }
}

async function flushSyncSnapshot(): Promise<void> {
  if (isFlushingSnapshot || !pendingSyncSnapshot) {
    return;
  }

  isFlushingSnapshot = true;

  try {
    while (pendingSyncSnapshot) {
      const snapshot = pendingSyncSnapshot;
      pendingSyncSnapshot = null;
      await replacePersistedJobs(
        snapshot.projectId,
        snapshot.jobs,
        snapshot.projectFolderPath,
      );
      persistedSnapshotKeysByProject.set(snapshot.projectId, snapshot.key);
    }
  } catch (error) {
    console.error("Failed to persist job queue snapshot", error);
  } finally {
    isFlushingSnapshot = false;

    if (pendingSyncSnapshot) {
      void flushSyncSnapshot();
    }
  }
}

function scheduleSync(projectId?: string, jobs?: Job[], projectFolderPath?: string) {
  if (isHydrating) {
    return;
  }

  const activeProject = useProjectStore.getState().activeProject;
  const scopedProjectId = projectId ?? activeProject?.id;
  const scopedProjectFolderPath = projectFolderPath ?? activeProject?.folderPath;

  if (!scopedProjectId || !scopedProjectFolderPath) {
    return;
  }

  const nextJobs = dedupeJobsById(
    jobs ??
      useQueueStore
        .getState()
        .jobs.filter((job) => job.projectId === scopedProjectId),
  );
  const nextKey = buildSnapshotKey(nextJobs);
  const pendingKeyForProject =
    pendingSyncSnapshot?.projectId === scopedProjectId ? pendingSyncSnapshot.key : null;

  if (
    persistedSnapshotKeysByProject.get(scopedProjectId) === nextKey ||
    pendingKeyForProject === nextKey
  ) {
    return;
  }

  pendingSyncSnapshot = {
    projectId: scopedProjectId,
    projectFolderPath: scopedProjectFolderPath,
    jobs: nextJobs,
    key: nextKey,
  };

  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushSyncSnapshot();
  }, 900);
}

async function requeuePersistedJob(job: Job): Promise<void> {
  const params = job.params ?? {};
  const basePrompt =
    typeof params.basePrompt === "string" && params.basePrompt.trim()
      ? params.basePrompt
      : job.prompt;

  if (job.type === "audio_dialogue") {
    if (!job.shotId) {
      return;
    }

    await enqueueAudioDialogueJob({
      shotId: job.shotId,
      priority: job.priority,
    });
    return;
  }

  if (job.type === "lipsync") {
    if (!job.shotId) {
      return;
    }

    await enqueueLipSyncJob({
      shotId: job.shotId,
      priority: job.priority,
    });
    return;
  }

  if (!basePrompt?.trim()) {
    return;
  }

  if (isVideoQueueJobType(job.type)) {
    await enqueueVideoJobs({
      model: coerceVideoModel(job.model),
      prompt: basePrompt,
      imageStartPath: params.imageStartPath as string | undefined,
      imageEndPath: params.imageEndPath as string | undefined,
      resolveStartDependencies:
        typeof params.resolveStartDependencies === "boolean"
          ? params.resolveStartDependencies
          : undefined,
      resolveEndDependencies:
        typeof params.resolveEndDependencies === "boolean"
          ? params.resolveEndDependencies
          : undefined,
      duration: clampKlingDuration(params.duration as number | undefined),
      aspectRatio: (params.aspectRatio as "16:9" | "9:16" | "1:1") ?? "16:9",
      cfg: Number(params.cfg ?? 0.45),
      generateAudio:
        typeof params.generateAudio === "boolean"
          ? params.generateAudio
          : undefined,
      negativePrompt: params.negativePrompt as string | undefined,
      shotType: params.shotType as KlingShotType | undefined,
      quantity: 1,
      shotId: job.shotId,
      priority: job.priority,
      outputSuffix: params.outputSuffix as string | undefined,
      assetTags: Array.isArray(params.assetTags)
        ? (params.assetTags as string[])
        : undefined,
      persistToShotPath:
        typeof params.persistToShotPath === "boolean"
          ? params.persistToShotPath
          : undefined,
      completeStatus: params.completeStatus as string | undefined,
      jobType: job.type,
    });
    return;
  }

  if (job.type === "upscale") {
    await enqueueUpscaleJobs({
      shotId: job.shotId,
      assetId: job.assetId,
      sourceRelativePath: params.sourceRelativePath as string | undefined,
      sourcePath: params.sourcePath as string | undefined,
      filterId: params.filterId as number | undefined,
      priority: job.priority,
      outputSuffix: params.outputSuffix as string | undefined,
    });
    return;
  }

  if (
    job.shotId &&
    (job.type === "image_start" ||
      job.type === "image_end" ||
      job.type === "coverage_image")
  ) {
    await enqueueStoryboardFrameJob({
      shotId: job.shotId,
      prompt: basePrompt,
      mode:
        job.type === "image_start"
          ? "start"
          : job.type === "image_end"
            ? "end"
            : "coverage",
      model: coerceImageModel(job.model),
      aspectRatio: (params.aspectRatio as string) ?? "16:9",
      cfg: Number(params.cfg ?? 7),
      steps: Number(params.steps ?? 28),
      priority: job.priority,
      outputSuffix: params.outputSuffix as string | undefined,
      assetTags: Array.isArray(params.assetTags)
        ? (params.assetTags as string[])
        : undefined,
      referenceImagePaths: Array.isArray(params.referenceImagePaths)
        ? (params.referenceImagePaths as string[])
        : undefined,
      allowVideoFrameFallback:
        typeof params.allowVideoFrameFallback === "boolean"
          ? params.allowVideoFrameFallback
          : undefined,
      persistToShotPath:
        typeof params.persistToShotPath === "boolean"
          ? params.persistToShotPath
          : undefined,
      completeStatus: params.completeStatus as string | undefined,
    });
    return;
  }

  await enqueueImageJobs({
    model: coerceImageModel(job.model) ?? "fal-ai/nano-banana-2",
    prompt: basePrompt,
    aspectRatio: (params.aspectRatio as string) ?? "16:9",
    cfg: Number(params.cfg ?? 7),
    steps: Number(params.steps ?? 28),
    quantity: 1,
    refImagePath: job.refImagePath,
    referenceImagePaths: Array.isArray(params.referenceImagePaths)
      ? (params.referenceImagePaths as string[])
      : undefined,
    shotId: job.shotId,
    jobType: job.type,
    assetTags: Array.isArray(params.assetTags)
      ? (params.assetTags as string[])
      : undefined,
    assetMetadata:
      params.assetMetadata &&
      typeof params.assetMetadata === "object" &&
      !Array.isArray(params.assetMetadata)
        ? (params.assetMetadata as Record<string, unknown>)
        : undefined,
  });
}

async function hydrateForProject(projectId: string): Promise<void> {
  isHydrating = true;

  try {
    const persistedJobs = await listPersistedJobs(projectId);
    const terminalJobs = persistedJobs.filter(
      (job) =>
        job.status === "done" ||
        job.status === "error" ||
        job.status === "cancelled",
    );
    const interruptedJobs = persistedJobs
      .filter((job) => job.status === "active")
      .map((job) => ({
        ...job,
        status: "error" as const,
        errorMsg: "Interrupted while the app was closed.",
        completedAt: Date.now(),
      }));
    const queuedJobs = persistedJobs.filter((job) => job.status === "queued");

    useQueueStore.getState().setJobs([...terminalJobs, ...interruptedJobs]);
    try {
      await replacePersistedJobs(projectId, [...terminalJobs, ...interruptedJobs]);
      persistedSnapshotKeysByProject.set(
        projectId,
        buildSnapshotKey([...terminalJobs, ...interruptedJobs]),
      );
    } catch (error) {
      console.error("Failed to rewrite hydrated terminal jobs.", error);
    }

    try {
      await reconcileOrphanedGeneratingShotStatuses(projectId, persistedJobs);
    } catch (error) {
      console.error("Failed to reconcile orphaned generating shot statuses.", error);
    }

    for (const queuedJob of queuedJobs) {
      try {
        await requeuePersistedJob(queuedJob);
      } catch (error) {
        useQueueStore.getState().setJobs([
          ...useQueueStore.getState().jobs,
          {
            ...queuedJob,
            status: "error",
            errorMsg:
              error instanceof Error
                ? `Recovery failed: ${error.message}`
                : "Recovery failed.",
            completedAt: Date.now(),
          },
        ]);
      }
    }
  } finally {
    isHydrating = false;
    scheduleSync();
  }
}

export function initializeJobQueuePersistence(): void {
  if (initialized) {
    return;
  }

  initialized = true;
  lastProjectId = useProjectStore.getState().activeProject?.id ?? null;
  lastProjectFolderPath = useProjectStore.getState().activeProject?.folderPath ?? null;

  useQueueStore.subscribe(() => {
    scheduleSync();
  });

  useProjectStore.subscribe((state) => {
    const nextProjectId = state.activeProject?.id ?? null;
    if (nextProjectId === lastProjectId) {
      return;
    }

    const previousProjectId = lastProjectId;
    const previousProjectFolderPath = lastProjectFolderPath;
    const previousProjectJobs = previousProjectId
      ? useQueueStore
          .getState()
          .jobs.filter((job) => job.projectId === previousProjectId)
      : [];

    if (previousProjectId && previousProjectFolderPath) {
      scheduleSync(previousProjectId, previousProjectJobs, previousProjectFolderPath);
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      void flushSyncSnapshot();
    }

    lastProjectId = nextProjectId;
    lastProjectFolderPath = state.activeProject?.folderPath ?? null;

    if (!nextProjectId) {
      isHydrating = true;
      useQueueStore.getState().setJobs([]);
      isHydrating = false;
      return;
    }

    void hydrateForProject(nextProjectId);
  });

  if (lastProjectId) {
    void hydrateForProject(lastProjectId);
  }
}
