import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  clampKlingDuration,
  type ImageModelId,
  type KlingShotType,
  type VideoModelId,
} from "@/services/fal.service";
import {
  enqueueImageJobs,
  enqueueStoryboardFrameJob,
  enqueueUpscaleJobs,
  enqueueVideoJobs,
} from "@/services/jobqueue.service";
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
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSyncSnapshot: { projectId: string; jobs: Job[] } | null = null;

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
  const db = await getProjectDb();
  const rows = await db.select<PersistedJobRow[]>(
    `SELECT *
     FROM job_queue
     WHERE project_id = $1
     ORDER BY queued_at ASC, priority DESC`,
    [projectId],
  );
  return rows.map(fromRow);
}

async function replacePersistedJobs(projectId: string, jobs: Job[]): Promise<void> {
  const db = await getProjectDb();
  await db.execute("DELETE FROM job_queue WHERE project_id = $1", [projectId]);

  for (const job of jobs) {
    await db.execute(
      `INSERT INTO job_queue (
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

  await syncProjectDbMirror();
}

async function flushSyncSnapshot(): Promise<void> {
  if (!pendingSyncSnapshot) {
    return;
  }

  const snapshot = pendingSyncSnapshot;
  pendingSyncSnapshot = null;
  await replacePersistedJobs(snapshot.projectId, snapshot.jobs);
}

function scheduleSync(projectId?: string, jobs?: Job[]) {
  if (isHydrating) {
    return;
  }

  const activeProject = useProjectStore.getState().activeProject;
  const scopedProjectId = projectId ?? activeProject?.id;

  if (!scopedProjectId) {
    return;
  }

  pendingSyncSnapshot = {
    projectId: scopedProjectId,
    jobs:
      jobs ??
      useQueueStore
        .getState()
        .jobs.filter((job) => job.projectId === scopedProjectId),
  };

  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushSyncSnapshot();
  }, 250);
}

async function requeuePersistedJob(job: Job): Promise<void> {
  const params = job.params ?? {};

  if (!job.prompt?.trim()) {
    return;
  }

  if (job.type === "video") {
    await enqueueVideoJobs({
      model: coerceVideoModel(job.model),
      prompt: job.prompt,
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
      prompt: job.prompt,
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
    });
    return;
  }

  await enqueueImageJobs({
    model: coerceImageModel(job.model) ?? "fal-ai/nano-banana-2",
    prompt: job.prompt,
    aspectRatio: (params.aspectRatio as string) ?? "16:9",
    cfg: Number(params.cfg ?? 7),
    steps: Number(params.steps ?? 28),
    quantity: 1,
    refImagePath: job.refImagePath,
    shotId: job.shotId,
    jobType: job.type,
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
    await replacePersistedJobs(projectId, [...terminalJobs, ...interruptedJobs]);

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

  useQueueStore.subscribe(() => {
    scheduleSync();
  });

  useProjectStore.subscribe((state) => {
    const nextProjectId = state.activeProject?.id ?? null;
    if (nextProjectId === lastProjectId) {
      return;
    }

    const previousProjectId = lastProjectId;
    const previousProjectJobs = previousProjectId
      ? useQueueStore
          .getState()
          .jobs.filter((job) => job.projectId === previousProjectId)
      : [];

    if (previousProjectId) {
      scheduleSync(previousProjectId, previousProjectJobs);
      if (syncTimer) {
        clearTimeout(syncTimer);
        syncTimer = null;
      }
      void flushSyncSnapshot();
    }

    lastProjectId = nextProjectId;

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
