import { extname } from "@tauri-apps/api/path";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getApiKey } from "@/lib/store";

const TENSORPIX_API_BASE = "https://backend.tensorpix.ai/api";

type TensorPixModelRow = {
  id: number;
  name: string;
  task: number;
  cost_weight: number;
  upscale_factor: number | null;
  fps_boost_factor: number | null;
  priority: number | null;
  max_resolution: number | null;
};

type UploadedVideo = {
  id: number;
  file: string | null;
};

type TensorPixJob = {
  id: number;
  status?: number | string | null;
  processing_progress?: number | null;
  restored_video?: number | null;
  output_video?: number | null;
};

type RestoredVideo = {
  id: number;
  file: string | null;
  width?: number | null;
  height?: number | null;
};

export interface TensorPixModel {
  id: number;
  name: string;
  upscaleFactor: number;
  costWeight: number;
  priority: number;
  maxResolution: number | null;
}

export interface UpscaleVideoParams {
  sourcePath: string;
  destinationPath: string;
  upscaleFactor: 2 | 4;
  modelId?: number;
  onProgress?: (progress: number) => void;
  abortSignal?: AbortSignal;
}

export interface UpscaleVideoResult {
  outputUrl: string;
  width?: number | null;
  height?: number | null;
  jobId: number;
  restoredVideoId: number;
  modelId: number;
  modelName: string;
  spentUsd: number;
}

export interface UpscaleVideoTo4kParams {
  videoPath: string;
  filterId?: number;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

let cachedModels: TensorPixModel[] | null = null;
let cachedModelsKey: string | null = null;

async function getTensorPixKey(apiKeyOverride?: string): Promise<string> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey("TENSORPIX_API_KEY"))?.trim();
  if (!apiKey) {
    throw new Error("TensorPix API key bulunamadi. Ayarlardan ekleyin.");
  }

  return apiKey;
}

async function tensorPixRequest<T>(
  path: string,
  init?: RequestInit,
  apiKeyOverride?: string,
): Promise<T> {
  const apiKey = await getTensorPixKey(apiKeyOverride);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Token ${apiKey}`);

  const response = await fetch(`${TENSORPIX_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new Error(`TensorPix istegi basarisiz oldu (${response.status}).`);
  }

  return (await response.json()) as T;
}

async function uploadVideo(sourcePath: string): Promise<number> {
  const bytes = await readFile(sourcePath);
  const extension = (await extname(sourcePath)).toLowerCase();
  const fileName = sourcePath.split(/[\\/]/).pop() ?? `upscale${extension || ".mp4"}`;
  const mimeType = MIME_BY_EXTENSION[extension] ?? "video/mp4";
  const formData = new FormData();
  formData.append("file", new File([bytes], fileName, { type: mimeType }));

  const apiKey = await getTensorPixKey();
  const response = await fetch(`${TENSORPIX_API_BASE}/videos/`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`TensorPix video yukleme basarisiz oldu (${response.status}).`);
  }

  const payload = (await response.json()) as UploadedVideo;
  return payload.id;
}

async function waitForUploadedVideo(
  uploadedVideoId: number,
  onProgress?: (progress: number) => void,
  abortSignal?: AbortSignal,
): Promise<UploadedVideo> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 180_000) {
    abortSignal?.throwIfAborted();
    const uploadedVideo = await tensorPixRequest<UploadedVideo>(`/videos/${uploadedVideoId}/`);
    if (uploadedVideo.file) {
      onProgress?.(24);
      return uploadedVideo;
    }

    onProgress?.(12);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  throw new Error("TensorPix video upload hazirlanamadi.");
}

export async function getTensorPixModels(apiKeyOverride?: string): Promise<TensorPixModel[]> {
  const apiKey = await getTensorPixKey(apiKeyOverride);

  if (cachedModels && cachedModelsKey === apiKey) {
    return cachedModels;
  }

  const response = await tensorPixRequest<{
    results: TensorPixModelRow[];
  }>("/ml-models/", undefined, apiKey);

  cachedModels = response.results
    .filter((model) => (model.upscale_factor ?? 0) >= 2)
    .map((model) => ({
      id: model.id,
      name: model.name,
      upscaleFactor: model.upscale_factor ?? 1,
      costWeight: model.cost_weight ?? 0,
      priority: model.priority ?? 0,
      maxResolution: model.max_resolution ?? null,
    }))
    .sort((left, right) => {
      if (right.upscaleFactor !== left.upscaleFactor) {
        return right.upscaleFactor - left.upscaleFactor;
      }

      return right.priority - left.priority;
    });
  cachedModelsKey = apiKey;

  return cachedModels;
}

export async function testTensorPixConnection(
  apiKeyOverride?: string,
): Promise<{ modelCount: number }> {
  const models = await getTensorPixModels(apiKeyOverride);
  return { modelCount: models.length };
}

function pickUpscaleModel(models: TensorPixModel[], upscaleFactor: 2 | 4): TensorPixModel {
  return (
    models.find((model) => model.upscaleFactor === upscaleFactor) ??
    models.find((model) => model.upscaleFactor >= upscaleFactor) ??
    models[0]
  );
}

async function createEnhancementJob(
  uploadedVideoId: number,
  modelId: number,
  upscaleFactor: 2 | 4,
): Promise<number> {
  const payload = await tensorPixRequest<TensorPixJob>("/jobs/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_video: uploadedVideoId,
      ml_models: [modelId],
      output_resolution: upscaleFactor === 4 ? 3840 : 1920,
      container: "mp4",
      codec: "libx264",
      preview: false,
    }),
  });

  return payload.id;
}

async function waitForEnhancementJob(
  jobId: number,
  onProgress?: (progress: number) => void,
  abortSignal?: AbortSignal,
): Promise<TensorPixJob> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 30 * 60_000) {
    abortSignal?.throwIfAborted();
    const job = await tensorPixRequest<TensorPixJob>(`/jobs/${jobId}/`);
    const progress = Number(job.processing_progress ?? 0);
    onProgress?.(Math.min(92, 28 + Math.max(0, progress) * 0.58));

    if (job.restored_video || job.output_video) {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  throw new Error("TensorPix enhancement zaman asimina ugradi.");
}

async function getRestoredVideo(restoredVideoId: number): Promise<RestoredVideo> {
  return tensorPixRequest<RestoredVideo>(`/restored-videos/${restoredVideoId}/`);
}

async function downloadFile(
  url: string,
  destinationPath: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`TensorPix cikti indirilemedi (${response.status}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(destinationPath, bytes);
}

export async function upscaleVideo(
  params: UpscaleVideoParams,
): Promise<UpscaleVideoResult> {
  const models = await getTensorPixModels();
  if (models.length === 0) {
    throw new Error("TensorPix icin uygun upscale modeli bulunamadi.");
  }

  const selectedModel =
    params.modelId !== undefined
      ? models.find((model) => model.id === params.modelId) ?? pickUpscaleModel(models, params.upscaleFactor)
      : pickUpscaleModel(models, params.upscaleFactor);

  params.onProgress?.(6);
  const uploadedVideoId = await uploadVideo(params.sourcePath);
  await waitForUploadedVideo(uploadedVideoId, params.onProgress, params.abortSignal);
  const jobId = await createEnhancementJob(uploadedVideoId, selectedModel.id, params.upscaleFactor);
  params.onProgress?.(32);
  const job = await waitForEnhancementJob(jobId, params.onProgress, params.abortSignal);
  const restoredVideoId = job.restored_video ?? job.output_video;

  if (!restoredVideoId) {
    throw new Error("TensorPix tamamlandi ama cikti videosu donmedi.");
  }

  const restoredVideo = await getRestoredVideo(restoredVideoId);
  if (!restoredVideo.file) {
    throw new Error("TensorPix cikti videosu hazir degil.");
  }

  params.onProgress?.(96);
  await downloadFile(restoredVideo.file, params.destinationPath, params.abortSignal);

  return {
    outputUrl: restoredVideo.file,
    width: restoredVideo.width,
    height: restoredVideo.height,
    jobId,
    restoredVideoId,
    modelId: selectedModel.id,
    modelName: selectedModel.name,
    spentUsd: Number((selectedModel.costWeight / 100).toFixed(4)),
  };
}

export async function upscaleVideoTo4k(
  params: UpscaleVideoTo4kParams,
): Promise<{
  url: string;
  width?: number | null;
  height?: number | null;
  jobId: number;
  filterName: string;
  spentUsd: number;
}> {
  const models = await getTensorPixModels();
  if (models.length === 0) {
    throw new Error("TensorPix icin uygun upscale modeli bulunamadi.");
  }

  const selectedModel =
    params.filterId !== undefined
      ? models.find((model) => model.id === params.filterId) ?? pickUpscaleModel(models, 4)
      : pickUpscaleModel(models, 4);

  params.onProgress?.(6);
  const uploadedVideoId = await uploadVideo(params.videoPath);
  await waitForUploadedVideo(uploadedVideoId, params.onProgress, params.abortSignal);
  const jobId = await createEnhancementJob(uploadedVideoId, selectedModel.id, 4);
  params.onProgress?.(32);
  const job = await waitForEnhancementJob(jobId, params.onProgress, params.abortSignal);
  const restoredVideoId = job.restored_video ?? job.output_video;

  if (!restoredVideoId) {
    throw new Error("TensorPix tamamlandi ama cikti videosu donmedi.");
  }

  const restoredVideo = await getRestoredVideo(restoredVideoId);
  if (!restoredVideo.file) {
    throw new Error("TensorPix cikti videosu hazir degil.");
  }

  return {
    url: restoredVideo.file,
    width: restoredVideo.width,
    height: restoredVideo.height,
    jobId,
    filterName: selectedModel.name,
    spentUsd: Number((selectedModel.costWeight / 100).toFixed(4)),
  };
}
