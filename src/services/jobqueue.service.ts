import { dirname, join } from "@tauri-apps/api/path";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getCoveragePrompt, resolveBulkScope } from "@/lib/bulk-production";
import { composeShotCharacterPrompt } from "@/lib/character-studio";
import { getBulkVideoJobType } from "@/lib/job-queue-types";
import { saveAsset } from "@/services/asset.service";
import {
  generateShotDialogueAudio,
  getDialogueAudioShotById,
  listDialogueAudioShots,
} from "@/services/audio-pipeline.service";
import { resolveStartImage, waitForJob } from "@/services/chain.service";
import { resolveShotCharacterContext } from "@/services/character.service";
import { logCost } from "@/services/cost.service";
import {
  analyzeKlingVideoPrompt,
  clampKlingDuration,
  calcImageCost,
  calcVideoCost,
  downloadImageToLocal,
  downloadVideoToLocal,
  generateImage,
  generateVideo,
  resolveImageModel,
  resolveVideoModel,
  type ImageModelId,
  type KlingDuration,
  type KlingShotType,
  type VideoModelId,
  type VideoAspectRatio,
} from "@/services/fal.service";
import { upscaleVideoTo4k } from "@/services/tensorpix.service";
import {
  getShotMissingExternalReferenceMessage,
  getShotById,
  getShots,
  resolveShotExternalReferencePath,
  updateShotAudioFields,
  updateShotPaths,
  type ShotRow,
} from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore, type Job, type JobType } from "@/store/queue.store";

const DEFAULT_VIDEO_MODEL: VideoModelId = "fal-ai/kling-video/v3/pro/image-to-video";
const DEFAULT_ASPECT_RATIO = "16:9";
const DEFAULT_IMAGE_STEPS = 28;

type JobExecutor = (abortSignal: AbortSignal) => Promise<void>;

type RegisteredTask = {
  execute: JobExecutor;
};

type StoryboardFrameMode = "start" | "end" | "coverage";

async function syncAudioDialogueShotStatusFromQueue(
  shotId: string,
  nextStatus: "queued" | "cancelled",
): Promise<void> {
  const detail = await getDialogueAudioShotById(shotId);

  if (!detail) {
    return;
  }

  if (nextStatus === "queued") {
    await updateShotAudioFields(shotId, {
      audioStatus: "queued",
      audioError: null,
    });
    return;
  }

  await updateShotAudioFields(shotId, {
    audioStatus: detail.blockerReason ? "blocked" : "pending",
    audioError: detail.blockerReason,
  });
}

class JobRunner {
  private running = 0;

  private tasks = new Map<string, RegisteredTask>();

  private pendingIds: string[] = [];

  private controllers = new Map<string, AbortController>();

  enqueue(job: Job, execute: JobExecutor) {
    const store = useQueueStore.getState();
    store.addJob(job);
    this.tasks.set(job.id, { execute });
    this.pendingIds.push(job.id);
    this.sortPendingIds();
    this.pump();
  }

  retry(jobId: string) {
    const store = useQueueStore.getState();
    const job = store.jobs.find((item) => item.id === jobId);

    if (!job || job.status !== "error" || !this.tasks.has(jobId)) {
      return;
    }

    store.updateJob(jobId, {
      status: "queued",
      errorMsg: undefined,
      progress: 0,
      startedAt: undefined,
      completedAt: undefined,
    });
    if (job.type === "audio_dialogue" && job.shotId) {
      void syncAudioDialogueShotStatusFromQueue(job.shotId, "queued");
    }

    this.pendingIds = this.pendingIds.filter((pendingId) => pendingId !== jobId);
    this.pendingIds.push(jobId);
    this.sortPendingIds();
    this.pump();
  }

  cancel(jobId: string) {
    const store = useQueueStore.getState();
    const job = store.jobs.find((item) => item.id === jobId);

    if (!job) {
      return;
    }

    this.pendingIds = this.pendingIds.filter((pendingId) => pendingId !== jobId);
    this.controllers.get(jobId)?.abort();

    store.updateJob(jobId, {
      status: "cancelled",
      completedAt: Date.now(),
      errorMsg: undefined,
    });
    if (job.type === "audio_dialogue" && job.shotId) {
      void syncAudioDialogueShotStatusFromQueue(job.shotId, "cancelled");
    }
  }

  resume() {
    this.pump();
  }

  private sortPendingIds() {
    const jobs = useQueueStore.getState().jobs;

    this.pendingIds.sort((leftId, rightId) => {
      const left = jobs.find((job) => job.id === leftId);
      const right = jobs.find((job) => job.id === rightId);

      if (!left || !right) {
        return 0;
      }

      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }

      return left.queuedAt - right.queuedAt;
    });
  }

  private dequeueNextJobId(): string | null {
    const store = useQueueStore.getState();

    while (this.pendingIds.length > 0) {
      const nextId = this.pendingIds.shift() ?? null;

      if (!nextId) {
        return null;
      }

      const job = store.jobs.find((item) => item.id === nextId);

      if (job?.status === "queued" && this.tasks.has(nextId)) {
        return nextId;
      }
    }

    return null;
  }

  private pump() {
    const limit = useQueueStore.getState().parallelLimit;

    while (this.running < limit) {
      const nextId = this.dequeueNextJobId();

      if (!nextId) {
        break;
      }

      this.start(nextId);
    }
  }

  private start(jobId: string) {
    const store = useQueueStore.getState();
    const task = this.tasks.get(jobId);

    if (!task) {
      return;
    }

    const controller = new AbortController();

    this.running += 1;
    this.controllers.set(jobId, controller);
    store.updateJob(jobId, {
      status: "active",
      startedAt: Date.now(),
      completedAt: undefined,
    });

    void (async () => {
      try {
        await task.execute(controller.signal);

        const currentJob = useQueueStore
          .getState()
          .jobs.find((item) => item.id === jobId);

        if (controller.signal.aborted || currentJob?.status === "cancelled") {
          store.updateJob(jobId, { status: "cancelled", completedAt: Date.now() });
          return;
        }

        store.updateJob(jobId, {
          status: "done",
          completedAt: Date.now(),
          progress: 100,
        });
      } catch (error) {
        const currentJob = useQueueStore
          .getState()
          .jobs.find((item) => item.id === jobId);

        if (controller.signal.aborted || currentJob?.status === "cancelled") {
          store.updateJob(jobId, {
            status: "cancelled",
            completedAt: Date.now(),
            errorMsg: undefined,
          });
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        store.updateJob(jobId, {
          status: "error",
          errorMsg: message,
          completedAt: Date.now(),
        });
      } finally {
        this.controllers.delete(jobId);
        this.running = Math.max(0, this.running - 1);
        this.pump();
      }
    })();
  }
}

export interface EnqueueImageJobParams {
  model: ImageModelId;
  prompt: string;
  aspectRatio: string;
  cfg: number;
  steps: number;
  quantity: number;
  refImagePath?: string;
  referenceImagePaths?: string[];
  shotId?: string;
  jobType?: JobType;
  assetTags?: string[];
}

export interface EnqueueStoryboardFrameJobParams {
  shotId: string;
  prompt: string;
  mode: StoryboardFrameMode;
  model?: ImageModelId;
  aspectRatio?: string;
  cfg?: number;
  steps?: number;
  priority?: number;
  outputSuffix?: string;
  assetTags?: string[];
  persistToShotPath?: boolean;
  completeStatus?: string;
  referenceImagePaths?: string[];
}

export interface EnqueueVideoJobParams {
  model?: VideoModelId;
  prompt: string;
  imageStartPath?: string;
  imageEndPath?: string;
  resolveStartDependencies?: boolean;
  resolveEndDependencies?: boolean;
  duration: KlingDuration;
  aspectRatio?: VideoAspectRatio;
  cfg?: number;
  generateAudio?: boolean;
  negativePrompt?: string;
  shotType?: KlingShotType;
  quantity: number;
  shotId?: string;
  priority?: number;
  outputSuffix?: string;
  assetTags?: string[];
  persistToShotPath?: boolean;
  completeStatus?: string;
  jobType?: "video" | "coverage_video";
}

export interface EnqueueUpscaleJobParams {
  shotId?: string;
  assetId?: string;
  sourcePath?: string;
  sourceRelativePath?: string;
  filterId?: number;
  priority?: number;
  outputSuffix?: string;
}

export interface EnqueueAudioDialogueJobParams {
  shotId: string;
  priority?: number;
}

export interface BulkProductionOptions {
  produceStartFrames: boolean;
  produceEndFrames: boolean;
  produceCoverageImages: boolean;
  produceVideos: boolean;
  imageModel?: ImageModelId | "shot-default";
  videoModel?: VideoModelId;
  filter: "all" | "missing" | "selected";
  selectedShotIds?: string[];
}

export const jobRunner = new JobRunner();

function normalizeStoredPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function toRelativeProjectPath(projectFolderPath: string, absolutePath: string): string {
  const normalizedProjectPath = normalizeStoredPath(projectFolderPath).replace(/\/$/, "");
  const normalizedAbsolutePath = normalizeStoredPath(absolutePath);

  if (normalizedAbsolutePath.startsWith(`${normalizedProjectPath}/`)) {
    return normalizedAbsolutePath.slice(normalizedProjectPath.length + 1);
  }

  return normalizedAbsolutePath;
}

async function ensureFileDirectory(filePath: string): Promise<void> {
  await mkdir(await dirname(filePath), { recursive: true });
}

function buildImageAssetMetadata(params: {
  source: "still-image-lab" | "storyboard";
  basePrompt: string;
  aspectRatio: string;
  cfg: number;
  steps: number;
  quantity: number;
  refImagePath?: string | null;
  referenceImagePaths?: string[];
}): Record<string, unknown> {
  return {
    source: params.source,
    basePrompt: params.basePrompt,
    aspectRatio: params.aspectRatio,
    cfg: params.cfg,
    steps: params.steps,
    quantity: params.quantity,
    refImagePath: params.refImagePath ?? null,
    referenceImagePaths: params.referenceImagePaths ?? [],
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function padSegment(value: number | null | undefined): string {
  return String(value ?? 1).padStart(2, "0");
}

async function resolveProjectFilePath(
  projectFolderPath: string,
  storedPath: string,
): Promise<string> {
  const segments = storedPath.split(/[\\/]+/).filter(Boolean);
  return join(projectFolderPath, ...segments);
}

function findQueuedJob(shotId: string, type: JobType): Job | undefined {
  return useQueueStore
    .getState()
    .jobs.slice()
    .reverse()
    .find(
      (job) =>
        job.shotId === shotId &&
        job.type === type &&
        (job.status === "queued" || job.status === "active" || job.status === "done"),
    );
}

async function buildStoryboardImagePath(
  projectFolderPath: string,
  shot: ShotRow,
  mode: StoryboardFrameMode,
  outputSuffix?: string,
): Promise<string> {
  const suffix =
    mode === "start" ? "start" : mode === "end" ? "end" : "coverage";
  const fileSuffix = outputSuffix ? `_${outputSuffix}` : "";

  return join(
    projectFolderPath,
    "storyboard",
    `act-${padSegment(shot.act)}`,
    `scene-${padSegment(shot.scene)}`,
    `${shot.shotNumber.toLowerCase()}_${suffix}${fileSuffix}.png`,
  );
}

async function buildStoryboardVideoPath(
  projectFolderPath: string,
  shot: ShotRow,
  outputSuffix?: string,
): Promise<string> {
  const fileSuffix = outputSuffix ? `_${outputSuffix}` : "";
  return join(
    projectFolderPath,
    "storyboard",
    `act-${padSegment(shot.act)}`,
    `scene-${padSegment(shot.scene)}`,
    `${shot.shotNumber.toLowerCase()}_video${fileSuffix}.mp4`,
  );
}

async function buildStoryboard4kVideoPath(
  projectFolderPath: string,
  shot: ShotRow,
  outputSuffix?: string,
): Promise<string> {
  const fileSuffix = outputSuffix ? `_${outputSuffix}` : "";
  return join(
    projectFolderPath,
    "storyboard",
    `act-${padSegment(shot.act)}`,
    `scene-${padSegment(shot.scene)}`,
    `${shot.shotNumber.toLowerCase()}_video_4k${fileSuffix}.mp4`,
  );
}

async function updateShotGenerationState(
  shotId: string,
  mode: StoryboardFrameMode | "video",
  status: "pending" | "generating" | "done" | "error",
): Promise<void> {
  if (mode === "video") {
    await updateShotPaths(shotId, { videoStatus: status });
    return;
  }

  await updateShotPaths(shotId, { imageStatus: status });
}

async function ensureStoryboardFrameJobQueued(
  params: EnqueueStoryboardFrameJobParams,
): Promise<string> {
  const jobType =
    params.mode === "start"
      ? "image_start"
      : params.mode === "end"
        ? "image_end"
        : "coverage_image";
  const existing = findQueuedJob(params.shotId, jobType);

  if (existing) {
    return existing.id;
  }

  return enqueueStoryboardFrameJob(params);
}

async function resolveStartReferenceForShot(
  shot: ShotRow,
  jobId: string,
  priority: number,
): Promise<string[]> {
  const store = useQueueStore.getState();
  let chainResult = await resolveStartImage(shot);

  if (chainResult.status === "ready" && chainResult.refImagePath) {
    const externalReferencePath = await resolveShotExternalReferencePath(shot);
    const characterReferencePaths =
      (await resolveShotCharacterContext({
        characterId: shot.characterId,
        characterLookId: shot.characterLookId,
      }))?.referencePaths ?? [];
    return Array.from(
      new Set(
        [chainResult.refImagePath, externalReferencePath, ...characterReferencePaths].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );
  }

  if (chainResult.status === "waiting" && chainResult.waitForJobId) {
    store.updateJob(jobId, {
      errorMsg: `${shot.shotNumber} zincirde bekliyor`,
      progress: 6,
    });
    await waitForJob(chainResult.waitForJobId);
    chainResult = await resolveStartImage(shot);
  }

  if (chainResult.status === "needs_production" && shot.prevShotId) {
    const previousShot = await getShotById(shot.prevShotId);

    if (!previousShot?.promptEnd) {
      throw new Error(`Onceki shot icin END promptu yok: ${previousShot?.shotNumber ?? shot.prevShotId}`);
    }

    const dependencyJobId = await ensureStoryboardFrameJobQueued({
      shotId: previousShot.id,
      prompt: previousShot.promptEnd,
      mode: "end",
      model: resolveImageModel(previousShot.model),
      aspectRatio: DEFAULT_ASPECT_RATIO,
      cfg: previousShot.cfg ?? 7,
      steps: DEFAULT_IMAGE_STEPS,
      priority: priority + 1,
    });

    store.updateJob(jobId, {
      errorMsg: `${previousShot.shotNumber} END uretiliyor`,
      progress: 6,
    });
    await waitForJob(dependencyJobId);
    chainResult = await resolveStartImage(shot);
  }

  if (chainResult.status !== "ready") {
    throw new Error(`Zincir referansi hazirlanamadi: ${shot.shotNumber}`);
  }

  const externalReferencePath = await resolveShotExternalReferencePath(shot);
  const characterReferencePaths =
    (await resolveShotCharacterContext({
      characterId: shot.characterId,
      characterLookId: shot.characterLookId,
    }))?.referencePaths ?? [];
  return Array.from(
    new Set(
      [externalReferencePath, ...characterReferencePaths].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

async function resolveDirectReferenceForShot(
  shot: ShotRow,
  mode: "end" | "coverage",
  allowMissingReference = false,
): Promise<string[]> {
  const missingReferenceMessage =
    !allowMissingReference ? getShotMissingExternalReferenceMessage(shot, mode) : null;

  if (missingReferenceMessage) {
    throw new Error(missingReferenceMessage);
  }

  const externalReferencePath = await resolveShotExternalReferencePath(shot);
  const characterReferencePaths =
    (await resolveShotCharacterContext({
      characterId: shot.characterId,
      characterLookId: shot.characterLookId,
    }))?.referencePaths ?? [];

  return Array.from(
    new Set(
      [externalReferencePath, ...characterReferencePaths].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

async function resolveEndReferenceForShot(
  shot: ShotRow,
  jobId: string,
  priority: number,
  allowMissingReference = false,
): Promise<string[]> {
  const startReferencePath = await ensureVideoInputPath(shot, "start", jobId, priority);
  const externalReferencePaths = await resolveDirectReferenceForShot(
    shot,
    "end",
    allowMissingReference,
  );

  return Array.from(
    new Set(
      [startReferencePath, ...externalReferencePaths].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

async function ensureVideoInputPath(
  shot: ShotRow,
  mode: "start" | "end",
  jobId: string,
  priority: number,
  allowDependencyResolution = true,
): Promise<string | undefined> {
  const activeProject = useProjectStore.getState().activeProject;

  if (!activeProject) {
    throw new Error("Aktif proje yok.");
  }

  if (!allowDependencyResolution) {
    return undefined;
  }

  const storedPath = mode === "start" ? shot.imageStartPath : shot.imageEndPath;

  if (storedPath) {
    const absolutePath = await resolveProjectFilePath(activeProject.folderPath, storedPath);

    if (await exists(absolutePath)) {
      return absolutePath;
    }
  }

  const jobType = mode === "start" ? "image_start" : "image_end";
  const queueJob = findQueuedJob(shot.id, jobType);

  if (queueJob && (queueJob.status === "queued" || queueJob.status === "active")) {
    useQueueStore.getState().updateJob(jobId, {
      errorMsg: `${shot.shotNumber} ${mode.toUpperCase()} bekleniyor`,
    });
    await waitForJob(queueJob.id);
  } else {
    const prompt = mode === "start" ? shot.promptStart : shot.promptEnd;

    if (!prompt) {
      return undefined;
    }

    const dependencyJobId = await ensureStoryboardFrameJobQueued({
      shotId: shot.id,
      prompt,
      mode,
      model: resolveImageModel(shot.model),
      aspectRatio: DEFAULT_ASPECT_RATIO,
      cfg: shot.cfg ?? 7,
      steps: DEFAULT_IMAGE_STEPS,
      priority: priority + 1,
    });

    useQueueStore.getState().updateJob(jobId, {
      errorMsg: `${shot.shotNumber} ${mode.toUpperCase()} uretiliyor`,
    });
    await waitForJob(dependencyJobId);
  }

  const refreshedShot = await getShotById(shot.id);
  const refreshedPath = mode === "start" ? refreshedShot?.imageStartPath : refreshedShot?.imageEndPath;

  if (!refreshedPath) {
    return undefined;
  }

  const absolutePath = await resolveProjectFilePath(activeProject.folderPath, refreshedPath);
  return (await exists(absolutePath)) ? absolutePath : undefined;
}

export async function enqueueImageJobs(
  params: EnqueueImageJobParams,
): Promise<string[]> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const {
    model,
    prompt,
    aspectRatio,
    cfg,
    steps,
    quantity,
    refImagePath,
    referenceImagePaths,
    shotId,
    jobType = "image_start",
    assetTags,
  } = params;

  const costPerImage = calcImageCost(model, 1);
  const jobIds: string[] = [];
  const mergedReferenceImagePaths = Array.from(
    new Set([...(referenceImagePaths ?? []), ...(refImagePath ? [refImagePath] : [])]),
  );

  for (let index = 0; index < quantity; index += 1) {
    const jobId = uuidv4();
    const job: Job = {
      id: jobId,
      projectId: project.id,
      type: jobType,
      status: "queued",
      priority: 100 - index,
      shotId,
      model,
      prompt,
      params: { aspectRatio, cfg, steps, referenceImagePaths: mergedReferenceImagePaths, assetTags },
      refImagePath: mergedReferenceImagePaths[0],
      progress: 0,
      costUsd: costPerImage,
      queuedAt: Date.now(),
      sequenceOrder: index,
    };

    jobIds.push(jobId);

    jobRunner.enqueue(job, async (abortSignal) => {
      const queue = useQueueStore.getState();
      const updateProgress = (progress: number) => {
        queue.updateJob(jobId, { progress });
      };

      updateProgress(8);

      const result = await generateImage({
        jobId,
        model,
        prompt,
        aspectRatio,
        cfg,
        steps,
        refImagePath: mergedReferenceImagePaths[0],
        referenceImagePaths: mergedReferenceImagePaths,
        abortSignal,
        onProgress: updateProgress,
      });

      queue.updateJob(jobId, {
        falJobId: result.requestId,
        progress: 82,
      });

      const filename = `img_${jobId.slice(0, 8)}.png`;
      const destinationPath = await join(
        project.folderPath,
        "assets",
        "images",
        filename,
      );

      await downloadImageToLocal(result.url, destinationPath, abortSignal);

      queue.updateJob(jobId, {
        progress: 94,
        resultPath: destinationPath,
      });

      const assetId = await saveAsset({
        projectId: project.id,
        type: "image",
        filePath: `assets/images/${filename}`,
        filename,
        width: result.width,
        height: result.height,
        modelUsed: model,
        prompt,
        costUsd: costPerImage,
        falJobId: result.requestId ?? jobId,
        shotId,
        metadata: buildImageAssetMetadata({
          source: "still-image-lab",
          basePrompt: prompt,
          aspectRatio,
          cfg,
          steps,
          quantity,
          refImagePath: mergedReferenceImagePaths[0],
          referenceImagePaths: mergedReferenceImagePaths,
        }),
        tags: assetTags,
      });

      await logCost({
        projectId: project.id,
        jobId,
        model,
        type: "image",
        amountUsd: costPerImage,
        units: 1,
      });

      queue.updateJob(jobId, {
        assetId,
        falJobId: result.requestId ?? jobId,
        costUsd: costPerImage,
      });
    });
  }

  return jobIds;
}

export async function enqueueStoryboardFrameJob(
  params: EnqueueStoryboardFrameJobParams,
): Promise<string> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const shot = await getShotById(params.shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  if (!params.prompt.trim()) {
    throw new Error("Prompt bos olamaz.");
  }

  const explicitReferenceImagePaths = Array.from(
    new Set((params.referenceImagePaths ?? []).filter((value): value is string => Boolean(value))),
  );
  const missingReferenceMessage =
    explicitReferenceImagePaths.length === 0
      ? getShotMissingExternalReferenceMessage(shot, params.mode)
      : null;

  if (missingReferenceMessage) {
    throw new Error(missingReferenceMessage);
  }

  const mode = params.mode;
  const jobType: JobType =
    mode === "start" ? "image_start" : mode === "end" ? "image_end" : "coverage_image";
  const model = resolveImageModel(params.model ?? shot.model);
  const aspectRatio = params.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const cfg = params.cfg ?? shot.cfg ?? 7;
  const steps = params.steps ?? DEFAULT_IMAGE_STEPS;
  const costPerImage = calcImageCost(model, 1);
  const persistToShotPath = params.persistToShotPath ?? true;
  const completeStatus = params.completeStatus ?? "done";
  const characterContext = await resolveShotCharacterContext({
    characterId: shot.characterId,
    characterLookId: shot.characterLookId,
  });
  const effectivePrompt = composeShotCharacterPrompt(
    params.prompt.trim(),
    characterContext?.promptHint,
    Boolean(shot.includeCharacterPrompt),
  );
  const jobId = uuidv4();

  const job: Job = {
    id: jobId,
    projectId: project.id,
    type: jobType,
    status: "queued",
    priority: params.priority ?? 120,
    shotId: shot.id,
    model,
    prompt: effectivePrompt,
    params: {
      aspectRatio,
      cfg,
      steps,
      mode,
      outputSuffix: params.outputSuffix,
      referenceImagePaths: explicitReferenceImagePaths,
      assetTags: params.assetTags,
      persistToShotPath,
      completeStatus,
      basePrompt: params.prompt.trim(),
    },
    refImagePath: explicitReferenceImagePaths[0],
    progress: 0,
    costUsd: costPerImage,
    queuedAt: Date.now(),
  };

  jobRunner.enqueue(job, async (abortSignal) => {
    const queue = useQueueStore.getState();
    const updateProgress = (progress: number) => {
      queue.updateJob(jobId, { progress });
    };

    try {
      await updateShotGenerationState(shot.id, mode, "generating");

      let referenceImagePaths = explicitReferenceImagePaths;

      if (mode === "start") {
        const resolvedReferenceImagePaths = await resolveStartReferenceForShot(
          shot,
          jobId,
          params.priority ?? 120,
        );
        referenceImagePaths = Array.from(
          new Set([...explicitReferenceImagePaths, ...resolvedReferenceImagePaths]),
        );
      } else if (mode === "end") {
        const resolvedReferenceImagePaths = await resolveEndReferenceForShot(
          shot,
          jobId,
          params.priority ?? 120,
          explicitReferenceImagePaths.length > 0,
        );
        referenceImagePaths = Array.from(
          new Set([...explicitReferenceImagePaths, ...resolvedReferenceImagePaths]),
        );
      } else {
        const resolvedReferenceImagePaths = await resolveDirectReferenceForShot(
          shot,
          mode,
          explicitReferenceImagePaths.length > 0,
        );
        referenceImagePaths = Array.from(
          new Set([...explicitReferenceImagePaths, ...resolvedReferenceImagePaths]),
        );
      }

      updateProgress(10);

      const result = await generateImage({
        jobId,
        model,
        prompt: effectivePrompt,
        aspectRatio,
        cfg,
        steps,
        referenceImagePaths,
        abortSignal,
        onProgress: updateProgress,
      });

      queue.updateJob(jobId, {
        falJobId: result.requestId,
        progress: 84,
        refImagePath: referenceImagePaths[0],
        errorMsg: undefined,
      });

      const destinationPath = await buildStoryboardImagePath(
        project.folderPath,
        shot,
        mode,
        params.outputSuffix,
      );
      await ensureFileDirectory(destinationPath);
      await downloadImageToLocal(result.url, destinationPath, abortSignal);

      const relativePath = toRelativeProjectPath(project.folderPath, destinationPath);
      const filename = destinationPath.split(/[\\/]/).pop() ?? `${shot.shotNumber}.png`;
      if (persistToShotPath) {
        const update =
          mode === "end"
            ? { imageEndPath: relativePath, imageStatus: completeStatus }
            : { imageStartPath: relativePath, imageStatus: completeStatus };
        await updateShotPaths(shot.id, update);
      } else {
        await updateShotPaths(shot.id, { imageStatus: completeStatus });
      }

      const assetId = await saveAsset({
        projectId: project.id,
        type: "image",
        filePath: relativePath,
        filename,
        width: result.width,
        height: result.height,
        modelUsed: model,
        prompt: effectivePrompt,
        costUsd: costPerImage,
        falJobId: result.requestId ?? jobId,
        shotId: shot.id,
        metadata: buildImageAssetMetadata({
          source: "storyboard",
          basePrompt: params.prompt.trim(),
          aspectRatio,
          cfg,
          steps,
          quantity: 1,
          refImagePath: referenceImagePaths[0],
          referenceImagePaths,
        }),
        tags: params.assetTags ?? [],
      });

      await logCost({
        projectId: project.id,
        jobId,
        model,
        type: "image",
        amountUsd: costPerImage,
        units: 1,
      });

      queue.updateJob(jobId, {
        assetId,
        resultPath: destinationPath,
        falJobId: result.requestId ?? jobId,
        costUsd: costPerImage,
      });
    } catch (error) {
      await updateShotGenerationState(
        shot.id,
        mode,
        isAbortError(error) ? "pending" : "error",
      );
      throw error;
    }
  });

  return jobId;
}

export async function enqueueVideoJobs(
  params: EnqueueVideoJobParams,
): Promise<string[]> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  if (!params.prompt.trim()) {
    throw new Error("Prompt bos olamaz.");
  }

  const model = resolveVideoModel(params.model ?? DEFAULT_VIDEO_MODEL);
  const aspectRatio = params.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const cfg = params.cfg ?? 0.45;
  const duration = clampKlingDuration(params.duration);
  const persistToShotPath = params.persistToShotPath ?? true;
  const completeStatus = params.completeStatus ?? "done";
  const resolveStartDependencies = params.resolveStartDependencies ?? true;
  const resolveEndDependencies = params.resolveEndDependencies ?? true;
  const jobIds: string[] = [];

  for (let index = 0; index < params.quantity; index += 1) {
    const shot = params.shotId ? await getShotById(params.shotId) : null;
    const characterContext = shot
      ? await resolveShotCharacterContext({
          characterId: shot.characterId,
          characterLookId: shot.characterLookId,
        })
      : null;
    const effectivePrompt = composeShotCharacterPrompt(
      params.prompt.trim(),
      characterContext?.promptHint,
      Boolean(shot?.includeCharacterPrompt ?? false),
    );
    const resolvedGenerateAudio =
      params.generateAudio ?? analyzeKlingVideoPrompt(effectivePrompt).hasAudioDirection;
    const costPerVideo = calcVideoCost(model, duration, resolvedGenerateAudio);
    const jobId = uuidv4();

    const job: Job = {
      id: jobId,
      projectId: project.id,
      type: params.jobType ?? "video",
      status: "queued",
      priority: (params.priority ?? 90) - index,
      shotId: shot?.id,
      model,
      prompt: effectivePrompt,
      params: {
        duration,
        aspectRatio,
        cfg,
        generateAudio: resolvedGenerateAudio,
        negativePrompt: params.negativePrompt,
        shotType: params.shotType,
        imageStartPath: params.imageStartPath,
        imageEndPath: params.imageEndPath,
        resolveStartDependencies,
        resolveEndDependencies,
        outputSuffix: params.outputSuffix,
        assetTags: params.assetTags,
        persistToShotPath,
        completeStatus,
        basePrompt: params.prompt.trim(),
      },
      progress: 0,
      costUsd: costPerVideo,
      queuedAt: Date.now(),
      sequenceOrder: index,
    };

    jobIds.push(jobId);

    jobRunner.enqueue(job, async (abortSignal) => {
      const queue = useQueueStore.getState();
      const updateProgress = (progress: number) => {
        queue.updateJob(jobId, { progress });
      };

      try {
        if (shot?.id) {
          await updateShotGenerationState(shot.id, "video", "generating");
        }

        let startPath = params.imageStartPath;
        let endPath = params.imageEndPath;

        if (shot?.id) {
          startPath ??= await ensureVideoInputPath(
            shot,
            "start",
            jobId,
            job.priority,
            resolveStartDependencies,
          );
          endPath ??= await ensureVideoInputPath(
            shot,
            "end",
            jobId,
            job.priority,
            resolveEndDependencies,
          );
        }

        if (!startPath) {
          throw new Error("Video uretimi icin START frame gerekli.");
        }

        updateProgress(12);

        const result = await generateVideo({
          jobId,
          model,
          prompt: effectivePrompt,
          imageStartPath: startPath,
          imageEndPath: endPath,
          duration,
          aspectRatio,
          cfg,
          generateAudio: resolvedGenerateAudio,
          negativePrompt: params.negativePrompt,
          shotType: params.shotType,
          abortSignal,
          onProgress: updateProgress,
        });

        queue.updateJob(jobId, {
          falJobId: result.requestId,
          progress: 86,
          errorMsg: undefined,
        });

        const destinationPath = shot
          ? await buildStoryboardVideoPath(project.folderPath, shot, params.outputSuffix)
          : await join(project.folderPath, "assets", "videos", `vid_${jobId.slice(0, 8)}.mp4`);
        await ensureFileDirectory(destinationPath);
        await downloadVideoToLocal(result.url, destinationPath, abortSignal);

        const relativePath = toRelativeProjectPath(project.folderPath, destinationPath);
        const filename = destinationPath.split(/[\\/]/).pop() ?? `${jobId}.mp4`;

        if (shot?.id && persistToShotPath) {
          await updateShotPaths(shot.id, {
            videoPath: relativePath,
            videoStatus: completeStatus,
          });
        } else if (shot?.id) {
          await updateShotPaths(shot.id, {
            videoStatus: completeStatus,
          });
        }

        const assetId = await saveAsset({
          projectId: project.id,
          type: "video",
          filePath: relativePath,
          filename,
          durationS: duration,
          resolution: "HD",
          modelUsed: model,
          prompt: effectivePrompt,
          costUsd: costPerVideo,
          falJobId: result.requestId ?? jobId,
          shotId: shot?.id,
          tags: params.assetTags ?? [],
        });

        await logCost({
          projectId: project.id,
          jobId,
          model,
          type: "video",
          amountUsd: costPerVideo,
          units: duration,
        });

        queue.updateJob(jobId, {
          assetId,
          resultPath: destinationPath,
          falJobId: result.requestId ?? jobId,
          costUsd: costPerVideo,
        });
      } catch (error) {
        if (shot?.id) {
          await updateShotGenerationState(
            shot.id,
            "video",
            isAbortError(error) ? "pending" : "error",
          );
        }
        throw error;
      }
    });
  }

  return jobIds;
}

export async function enqueueUpscaleJobs(
  params: EnqueueUpscaleJobParams,
): Promise<string[]> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const shot = params.shotId ? await getShotById(params.shotId) : null;
  let sourceAbsolutePath = params.sourcePath;
  let sourceRelativePath = params.sourceRelativePath ?? null;

  if (!sourceAbsolutePath && shot?.videoPath) {
    sourceRelativePath = shot.videoPath;
    sourceAbsolutePath = await resolveProjectFilePath(project.folderPath, shot.videoPath);
  }

  if (!sourceAbsolutePath) {
    throw new Error("4K upscale icin kaynak video bulunamadi.");
  }

  const jobId = uuidv4();
  const job: Job = {
    id: jobId,
    projectId: project.id,
    type: "upscale",
    status: "queued",
    priority: params.priority ?? 80,
    shotId: shot?.id,
    assetId: params.assetId,
    model: "tensorpix/upscale",
    prompt: "TensorPix 4K upscale",
    params: {
      filterId: params.filterId ?? null,
      sourceRelativePath,
      outputSuffix: params.outputSuffix ?? null,
    },
    progress: 0,
    queuedAt: Date.now(),
  };

  jobRunner.enqueue(job, async (abortSignal) => {
    const queue = useQueueStore.getState();
    const updateProgress = (progress: number) => {
      queue.updateJob(jobId, { progress });
    };

    try {
      if (shot?.id) {
        await updateShotPaths(shot.id, { upscaleStatus: "generating" });
      }

      const result = await upscaleVideoTo4k({
        videoPath: sourceAbsolutePath!,
        filterId: params.filterId,
        abortSignal,
        onProgress: updateProgress,
      });

      const destinationPath = shot
        ? await buildStoryboard4kVideoPath(project.folderPath, shot, params.outputSuffix)
        : await join(
            project.folderPath,
            "assets",
            "videos",
            `${jobId.slice(0, 8)}_4k.mp4`,
          );
      await ensureFileDirectory(destinationPath);
      await downloadVideoToLocal(result.url, destinationPath, abortSignal);

      const relativePath = toRelativeProjectPath(project.folderPath, destinationPath);
      const filename = destinationPath.split(/[\\/]/).pop() ?? `${jobId}_4k.mp4`;

      if (shot?.id) {
        await updateShotPaths(shot.id, {
          video4kPath: relativePath,
          upscaleStatus: "done",
        });
      }

      const assetId = await saveAsset({
        projectId: project.id,
        type: "video",
        filePath: relativePath,
        filename,
        durationS: shot?.durationS ?? undefined,
        resolution: "4K",
        modelUsed: `tensorpix:${result.filterName}`,
        prompt: "TensorPix 4K upscale",
        costUsd: result.spentUsd,
        shotId: shot?.id,
        tags: ["upscale", "4k"],
      });

      await logCost({
        projectId: project.id,
        jobId,
        model: `tensorpix:${result.filterName}`,
        type: "upscale",
        amountUsd: result.spentUsd,
        units: 1,
      });

      queue.updateJob(jobId, {
        assetId,
        tensorpixJobId: String(result.jobId),
        resultPath: destinationPath,
        costUsd: result.spentUsd,
      });
    } catch (error) {
      if (shot?.id) {
        await updateShotPaths(shot.id, {
          upscaleStatus: isAbortError(error) ? "none" : "error",
        });
      }

      throw error;
    }
  });

  return [jobId];
}

export async function enqueueAudioDialogueJob(
  params: EnqueueAudioDialogueJobParams,
): Promise<string> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const shot = await getShotById(params.shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const detail = await getDialogueAudioShotById(shot.id);

  if (!detail) {
    throw new Error("Bu shot icin parse edilen diyalog transcript yok.");
  }

  if (detail.blockerReason) {
    await updateShotAudioFields(shot.id, {
      audioStatus: "blocked",
      audioError: detail.blockerReason,
    });
    throw new Error(detail.blockerReason);
  }

  const existingJob = useQueueStore
    .getState()
    .jobs.slice()
    .reverse()
    .find(
      (job) =>
        job.type === "audio_dialogue" &&
        job.shotId === shot.id &&
        (job.status === "queued" || job.status === "active"),
    );

  if (existingJob) {
    return existingJob.id;
  }

  const jobId = uuidv4();
  const job: Job = {
    id: jobId,
    projectId: project.id,
    type: "audio_dialogue",
    status: "queued",
    priority: params.priority ?? 85,
    shotId: shot.id,
    model: "eleven_v3",
    prompt: detail.audioDirection?.dialoguePreview ?? shot.promptVideo ?? shot.shotNumber,
    params: {
      outputFormat: "wav_44100 -> mp3_44100_128 fallback",
      characterCount: detail.characterCount,
    },
    progress: 0,
    queuedAt: Date.now(),
  };

  await updateShotAudioFields(shot.id, {
    audioStatus: "queued",
    audioError: null,
  });

  jobRunner.enqueue(job, async (abortSignal) => {
    const queue = useQueueStore.getState();
    const updateProgress = (progress: number) => {
      queue.updateJob(jobId, { progress });
    };

    const result = await generateShotDialogueAudio({
      shotId: shot.id,
      jobId,
      abortSignal,
      onProgress: updateProgress,
    });

    queue.updateJob(jobId, {
      resultPath: result.outputPath,
      costUsd: result.costUsd,
      progress: 96,
    });
  });

  return jobId;
}

export async function enqueueBulkAudioDialogueJobs(params?: {
  filter?: "all" | "missing" | "selected";
  selectedShotIds?: string[];
}): Promise<{ jobCount: number }> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const filter = params?.filter ?? "missing";
  const selectedShotIds = new Set(params?.selectedShotIds ?? []);
  const dialogueShots = await listDialogueAudioShots(project.id);
  const readyShots = dialogueShots.filter((detail) => {
    if (!detail.isReady) {
      return false;
    }

    if (filter === "missing") {
      return !detail.shot.audioMasterPath;
    }

    if (filter === "selected") {
      return selectedShotIds.has(detail.shot.id);
    }

    return true;
  });

  let jobCount = 0;

  for (const [index, detail] of readyShots.entries()) {
    await enqueueAudioDialogueJob({
      shotId: detail.shot.id,
      priority: 85 - index,
    });
    jobCount += 1;
  }

  return { jobCount };
}

export async function enqueueBulkProduction(
  options: BulkProductionOptions,
): Promise<{ jobCount: number; estimatedCost: number }> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  const allShots = await getShots(project.id);
  const { mainShots, coverageShots } = resolveBulkScope(allShots, options);

  const missingReferenceShots = new Set<string>();

  for (const shot of mainShots) {
    if (options.produceStartFrames && shot.promptStart) {
      const missingReference = getShotMissingExternalReferenceMessage(shot, "start");
      if (missingReference) {
        missingReferenceShots.add(`${shot.shotNumber} START`);
      }
    }

    if (options.produceEndFrames && shot.promptEnd) {
      const missingReference = getShotMissingExternalReferenceMessage(shot, "end");
      if (missingReference) {
        missingReferenceShots.add(`${shot.shotNumber} END`);
      }
    }
  }

  for (const shot of coverageShots) {
    if (options.produceCoverageImages) {
      const prompt = getCoveragePrompt(shot);

      if (prompt) {
        const missingReference = getShotMissingExternalReferenceMessage(shot, "coverage");
        if (missingReference) {
          missingReferenceShots.add(`${shot.shotNumber} COVERAGE`);
        }
      }
    }

    if (options.produceVideos && shot.promptVideo) {
      const missingReference = getShotMissingExternalReferenceMessage(shot, "coverage");
      if (missingReference) {
        missingReferenceShots.add(`${shot.shotNumber} COVERAGE VIDEO`);
      }
    }
  }

  if (missingReferenceShots.size > 0) {
    throw new Error(
      `Bazi shotlar icin harici referans gorseli eksik: ${Array.from(missingReferenceShots).join(", ")}.`,
    );
  }

  let jobCount = 0;
  let estimatedCost = 0;
  const selectedVideoModel = options.videoModel ?? DEFAULT_VIDEO_MODEL;

  for (const [index, shot] of mainShots.entries()) {
    const imageModel =
      options.imageModel && options.imageModel !== "shot-default"
        ? options.imageModel
        : resolveImageModel(shot.model);
    const startPriority = (mainShots.length - index) * 10 + 5;
    const endPriority = (mainShots.length - index) * 10 + 4;
    const videoPriority = (mainShots.length - index) * 10 + 1;

    if (options.produceStartFrames && shot.promptStart) {
      if (options.filter !== "missing" || !shot.imageStartPath) {
        await enqueueStoryboardFrameJob({
          shotId: shot.id,
          prompt: shot.promptStart,
          mode: "start",
          model: imageModel,
          cfg: shot.cfg ?? 7,
          steps: DEFAULT_IMAGE_STEPS,
          aspectRatio: DEFAULT_ASPECT_RATIO,
          priority: startPriority,
        });
        jobCount += 1;
        estimatedCost += calcImageCost(imageModel, 1);
      }
    }

    if (options.produceEndFrames && shot.promptEnd) {
      if (options.filter !== "missing" || !shot.imageEndPath) {
        await enqueueStoryboardFrameJob({
          shotId: shot.id,
          prompt: shot.promptEnd,
          mode: "end",
          model: imageModel,
          cfg: shot.cfg ?? 7,
          steps: DEFAULT_IMAGE_STEPS,
          aspectRatio: DEFAULT_ASPECT_RATIO,
          priority: endPriority,
        });
        jobCount += 1;
        estimatedCost += calcImageCost(imageModel, 1);
      }
    }

    if (options.produceVideos && shot.promptVideo) {
      if (options.filter !== "missing" || !shot.videoPath) {
        await enqueueVideoJobs({
          model: selectedVideoModel,
          prompt: shot.promptVideo,
          duration: clampKlingDuration(shot.durationS),
          aspectRatio: DEFAULT_ASPECT_RATIO,
          cfg: 0.45,
          quantity: 1,
          shotId: shot.id,
          priority: videoPriority,
          jobType: getBulkVideoJobType(shot.parentShotId),
        });
        jobCount += 1;
        estimatedCost += calcVideoCost(
          selectedVideoModel,
          clampKlingDuration(shot.durationS),
          analyzeKlingVideoPrompt(shot.promptVideo).hasAudioDirection,
        );
      }
    }
  }

  for (const [index, shot] of coverageShots.entries()) {
    const imageModel =
      options.imageModel && options.imageModel !== "shot-default"
        ? options.imageModel
        : resolveImageModel(shot.model);
    const coveragePrompt = getCoveragePrompt(shot);

    if (options.produceCoverageImages && coveragePrompt) {
      if (options.filter !== "missing" || !shot.imageStartPath) {
        await enqueueStoryboardFrameJob({
          shotId: shot.id,
          prompt: coveragePrompt,
          mode: "coverage",
          model: imageModel,
          cfg: shot.cfg ?? 7,
          steps: DEFAULT_IMAGE_STEPS,
          aspectRatio: DEFAULT_ASPECT_RATIO,
          priority: 70 - index * 2,
        });
        jobCount += 1;
        estimatedCost += calcImageCost(imageModel, 1);
      }
    }

    if (options.produceVideos && shot.promptVideo) {
      if (options.filter !== "missing" || !shot.videoPath) {
        await enqueueVideoJobs({
          model: selectedVideoModel,
          prompt: shot.promptVideo,
          duration: clampKlingDuration(shot.durationS),
          aspectRatio: DEFAULT_ASPECT_RATIO,
          cfg: 0.45,
          quantity: 1,
          shotId: shot.id,
          priority: 69 - index * 2,
          jobType: getBulkVideoJobType(shot.parentShotId),
        });
        jobCount += 1;
        estimatedCost += calcVideoCost(
          selectedVideoModel,
          clampKlingDuration(shot.durationS),
          analyzeKlingVideoPrompt(shot.promptVideo).hasAudioDirection,
        );
      }
    }
  }

  return {
    jobCount,
    estimatedCost,
  };
}

export async function retryJob(jobId: string): Promise<void> {
  jobRunner.retry(jobId);
}

export function cancelJob(jobId: string): void {
  jobRunner.cancel(jobId);
}

export function resumeJobQueue(): void {
  jobRunner.resume();
}
