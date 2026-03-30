import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { extractAudioDirectionBlock } from "@/lib/audio-direction-parser";
import { type LipSyncModelId, type LipSyncSyncMode } from "@/lib/lipsync";
import { getApiKey } from "@/lib/store";

export const IMAGE_MODELS = {
  "fal-ai/nano-banana-2": {
    label: "Nano Banana 2",
    costPerImage: 0.08,
    supportsImg2Img: true,
  },
  "fal-ai/flux-pro/v1.1": {
    label: "FLUX 1.1 Pro",
    costPerImage: 0.04,
    supportsImg2Img: true,
  },
} as const;

export type ImageModelId = keyof typeof IMAGE_MODELS;

export const VIDEO_MODELS = {
  "fal-ai/kling-video/v3/pro/image-to-video": {
    label: "Kling 3.0 Pro",
    costPerSecond: 0.112,
    costPerSecondWithAudio: 0.168,
    maxDurationS: 15,
    supportsAudio: true,
    supportsMultiShot: true,
  },
} as const;

export type VideoModelId = keyof typeof VIDEO_MODELS;
export const LIPSYNC_MODELS = {
  "fal-ai/latentsync": {
    label: "LatentSync",
    endpointId: "fal-ai/latentsync",
  },
  "fal-ai/sync-lipsync": {
    label: "Sync Lipsync 1.9",
    endpointId: "fal-ai/sync-lipsync",
  },
  "fal-ai/sync-lipsync/v2": {
    label: "Sync Lipsync 2.0",
    endpointId: "fal-ai/sync-lipsync/v2",
  },
  "fal-ai/sync-lipsync/v2/pro": {
    label: "Sync Lipsync 2.0 Pro",
    endpointId: "fal-ai/sync-lipsync/v2/pro",
  },
} as const;

export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type KlingShotType = "customize" | "intelligent";
export type KlingMultiShotDuration =
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "11"
  | "12"
  | "13"
  | "14"
  | "15";

export const KLING_V3_DURATION_VALUES = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

export type KlingDuration = (typeof KLING_V3_DURATION_VALUES)[number];

export interface KlingMultiPromptElement {
  prompt: string;
  duration?: KlingMultiShotDuration;
}

export interface KlingPromptAnalysis {
  detectedMultiShot: boolean;
  shotCount: number;
  hasAudioDirection: boolean;
  prompt: string;
  multiPrompt: KlingMultiPromptElement[] | null;
  negativePrompt?: string;
}

export const ASPECT_RATIO_MAP: Record<string, string> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:2": "landscape_4_3",
};

export interface GenerateImageParams {
  jobId: string;
  model: ImageModelId;
  prompt: string;
  aspectRatio: string;
  cfg: number;
  steps: number;
  refImagePath?: string;
  referenceImagePaths?: string[];
  abortSignal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface GenerateImageResult {
  url: string;
  width: number;
  height: number;
  seed?: number;
  requestId?: string;
}

export interface GenerateVideoParams {
  jobId: string;
  model: VideoModelId;
  prompt: string;
  imageStartPath: string;
  imageEndPath?: string;
  duration: KlingDuration;
  aspectRatio: VideoAspectRatio;
  cfg: number;
  generateAudio?: boolean;
  negativePrompt?: string;
  shotType?: KlingShotType;
  abortSignal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface GenerateVideoResult {
  url: string;
  requestId?: string;
}

export interface GenerateLipSyncVideoParams {
  jobId: string;
  model: LipSyncModelId;
  videoPath: string;
  audioPath: string;
  syncMode?: LipSyncSyncMode | null;
  abortSignal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface GenerateLipSyncVideoResult {
  url: string;
  requestId?: string;
}

const DEFAULT_KLING_NEGATIVE_PROMPT = "blur, distort, and low quality";

type FalAliasSummary = {
  aliasCount: number;
};

type FalQueueSubmitResponse = {
  requestId: string;
};

type FalQueueStatusResponse = {
  status: string;
  error?: string | null;
};

type FalQueueResultResponse = {
  requestId?: string;
  data?: unknown;
};

function normalizeAspectRatio(aspectRatio: string): "auto" | "21:9" | "16:9" | "3:2" | "4:3" | "5:4" | "1:1" | "4:5" | "3:4" | "2:3" | "9:16" {
  const supportedAspectRatios = new Set([
    "auto",
    "21:9",
    "16:9",
    "3:2",
    "4:3",
    "5:4",
    "1:1",
    "4:5",
    "3:4",
    "2:3",
    "9:16",
  ]);

  return supportedAspectRatios.has(aspectRatio)
    ? (aspectRatio as ReturnType<typeof normalizeAspectRatio>)
    : "16:9";
}

function normalizeMultilineText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function dedupePromptList(values: Array<string | undefined>): string | undefined {
  const normalized = Array.from(
    new Set(
      values
        .flatMap((value) =>
          (value ?? "")
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        ),
    ),
  );

  return normalized.length > 0 ? normalized.join(", ") : undefined;
}

function normalizeAvoidBlock(value: string): string | undefined {
  const flattened = value
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .join(", ");

  return flattened || undefined;
}

function buildKlingMultiPromptPrompt(
  sharedPrefix: string,
  shotPrompt: string,
  sharedSuffix: string,
): string {
  let prompt = shotPrompt.trim();

  if (sharedPrefix) {
    const withPrefix = [sharedPrefix, prompt].filter(Boolean).join("\n\n").trim();

    if (withPrefix.length <= 512) {
      prompt = withPrefix;
    }
  }

  if (sharedSuffix) {
    const withSuffix = [prompt, sharedSuffix].filter(Boolean).join("\n\n").trim();

    if (withSuffix.length <= 512) {
      prompt = withSuffix;
    }
  }

  return prompt;
}

function stripKlingShotHeader(shotPrompt: string): string {
  return shotPrompt.replace(/^\s*Shot\s+\d+\s*[,:.\-]\s*/i, "").trim();
}

function summarizeFalApiError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createAbortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("Islem iptal edildi.", "AbortError")
    : new Error("Islem iptal edildi.");
}

async function waitForDelay(durationMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);

    function cleanup() {
      globalThis.clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", handleAbort);
    }

    function handleAbort() {
      cleanup();
      reject(createAbortError());
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function invokeFalCommand<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    throw new Error(summarizeFalApiError(error));
  }
}

async function resolveFalApiKey(apiKeyOverride?: string): Promise<string> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey("FAL_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("FAL API key bulunamadi. Ayarlardan ekleyin.");
  }

  return apiKey;
}

async function uploadLocalFileToFal(filePath: string, apiKey: string): Promise<string> {
  return invokeFalCommand<string>("fal_upload_file", {
    apiKey,
    filePath,
  });
}

async function runFalQueue(params: {
  apiKey: string;
  endpointId: string;
  input: Record<string, unknown>;
  pollIntervalMs: number;
  abortSignal?: AbortSignal;
  onQueueUpdate?: (update: FalQueueStatusResponse) => void;
}): Promise<FalQueueResultResponse> {
  const { requestId } = await invokeFalCommand<FalQueueSubmitResponse>("fal_queue_submit", {
    apiKey: params.apiKey,
    endpointId: params.endpointId,
    input: params.input,
  });

  try {
    while (true) {
      if (params.abortSignal?.aborted) {
        throw createAbortError();
      }

      const status = await invokeFalCommand<FalQueueStatusResponse>("fal_queue_status", {
        apiKey: params.apiKey,
        endpointId: params.endpointId,
        requestId,
        logs: false,
      });

      params.onQueueUpdate?.(status);

      if (status.status === "COMPLETED") {
        return invokeFalCommand<FalQueueResultResponse>("fal_queue_result", {
          apiKey: params.apiKey,
          endpointId: params.endpointId,
          requestId,
        });
      }

      if (status.status === "FAILED" || status.status === "CANCELLED") {
        throw new Error(status.error?.trim() || "fal istegi tamamlanamadi.");
      }

      await waitForDelay(params.pollIntervalMs, params.abortSignal);
    }
  } catch (error) {
    if (params.abortSignal?.aborted) {
      void invokeFalCommand("fal_queue_cancel", {
        apiKey: params.apiKey,
        endpointId: params.endpointId,
        requestId,
      }).catch(() => undefined);
    }

    throw error;
  }
}

export function isKlingDuration(value: number): value is KlingDuration {
  return KLING_V3_DURATION_VALUES.includes(value as KlingDuration);
}

export function clampKlingDuration(value?: number | null): KlingDuration {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 5;
  }

  const rounded = Math.round(value);

  if (rounded < KLING_V3_DURATION_VALUES[0]) {
    return KLING_V3_DURATION_VALUES[0];
  }

  if (rounded > KLING_V3_DURATION_VALUES[KLING_V3_DURATION_VALUES.length - 1]) {
    return KLING_V3_DURATION_VALUES[KLING_V3_DURATION_VALUES.length - 1];
  }

  return rounded as KlingDuration;
}

export function analyzeKlingVideoPrompt(prompt: string): KlingPromptAnalysis {
  const normalized = normalizeMultilineText(prompt);

  if (!normalized) {
    return {
      detectedMultiShot: false,
      shotCount: 0,
      hasAudioDirection: false,
      prompt: "",
      multiPrompt: null,
    };
  }

  const avoidMatch = /\n?Avoid:\s*([\s\S]*)$/i.exec(normalized);
  const withoutAvoid = avoidMatch ? normalized.slice(0, avoidMatch.index).trim() : normalized;
  const audioExtraction = extractAudioDirectionBlock(withoutAvoid);
  const withoutAudio = audioExtraction.promptWithoutAudioBlock || withoutAvoid;
  const negativePrompt = dedupePromptList([
    DEFAULT_KLING_NEGATIVE_PROMPT,
    normalizeAvoidBlock(avoidMatch?.[1] ?? ""),
  ]);

  const shotHeaderRegex = /^\s*Shot\s+\d+\s*[,:.\-].*$/gim;
  const shotHeaders = Array.from(withoutAudio.matchAll(shotHeaderRegex))
    .map((match) => ({
      index: typeof match.index === "number" ? match.index : -1,
    }))
    .filter((match) => match.index >= 0);
  const hasAudioDirection = audioExtraction.hasAudioDirection;

  if (shotHeaders.length < 2) {
    return {
      detectedMultiShot: false,
      shotCount: shotHeaders.length,
      hasAudioDirection,
      prompt: withoutAudio,
      multiPrompt: null,
      negativePrompt,
    };
  }

  const sharedPrefix = withoutAudio.slice(0, shotHeaders[0].index).trim();
  const multiPrompt: KlingMultiPromptElement[] = [];
  const sharedSuffix = "";

  shotHeaders.forEach((header, index) => {
    const nextHeaderIndex = shotHeaders[index + 1]?.index ?? withoutAudio.length;
    const shotPrompt = stripKlingShotHeader(
      withoutAudio.slice(header.index, nextHeaderIndex).trim(),
    );

    if (!shotPrompt) {
      return;
    }

    multiPrompt.push({
      prompt: buildKlingMultiPromptPrompt(sharedPrefix, shotPrompt, sharedSuffix),
    });
  });

  return {
    detectedMultiShot: multiPrompt.length > 1,
    shotCount: multiPrompt.length,
    hasAudioDirection,
    prompt: withoutAudio,
    multiPrompt: multiPrompt.length > 1 ? multiPrompt : null,
    negativePrompt,
  };
}

export function distributeKlingMultiShotDurations(
  totalDuration: KlingDuration,
  shotCount: number,
): KlingMultiShotDuration[] {
  if (!Number.isInteger(shotCount) || shotCount < 2) {
    return [];
  }

  if (shotCount > totalDuration) {
    throw new Error(
      `Multi-shot prompt ${shotCount} bolum iceriyor. Sure en az ${shotCount}s olmali.`,
    );
  }

  const baseDuration = Math.floor(totalDuration / shotCount);
  const remainder = totalDuration % shotCount;

  return Array.from({ length: shotCount }, (_, index) =>
    String(baseDuration + (index < remainder ? 1 : 0)) as KlingMultiShotDuration,
  );
}

export function getKlingMultiPromptValidationMessage(
  promptAnalysis: KlingPromptAnalysis,
): string | null {
  if (!promptAnalysis.multiPrompt || promptAnalysis.multiPrompt.length < 2) {
    return null;
  }

  const tooLongIndex = promptAnalysis.multiPrompt.findIndex((element) => element.prompt.length > 512);

  if (tooLongIndex >= 0) {
    const length = promptAnalysis.multiPrompt[tooLongIndex]?.prompt.length ?? 0;
    return `Shot ${tooLongIndex + 1} promptu ${length} karakter. Kling multi-shot modda her shot en fazla 512 karakter olabilir. Shot bloklarini kisalt veya tek shot kullan.`;
  }

  return null;
}

export async function initFal(): Promise<boolean> {
  return Boolean((await getApiKey("FAL_API_KEY"))?.trim());
}

export async function testFalConnection(
  apiKeyOverride?: string,
): Promise<{ aliasCount: number }> {
  const apiKey = await resolveFalApiKey(apiKeyOverride);
  return invokeFalCommand<FalAliasSummary>("fal_test_connection", { apiKey });
}

export async function generateImage(
  params: GenerateImageParams,
): Promise<GenerateImageResult> {
  const {
    model,
    prompt,
    aspectRatio,
    cfg,
    steps,
    refImagePath,
    referenceImagePaths,
    abortSignal,
    onProgress,
  } = params;

  const apiKey = await resolveFalApiKey();
  const mergedReferencePaths = Array.from(
    new Set([...(referenceImagePaths ?? []), ...(refImagePath ? [refImagePath] : [])]),
  );
  const referenceUrls =
    mergedReferencePaths.length > 0
      ? await Promise.all(mergedReferencePaths.map((path) => uploadLocalFileToFal(path, apiKey)))
      : [];
  let endpoint: string = model;
  let input: Record<string, unknown>;

  if (model === "fal-ai/nano-banana-2") {
    endpoint = referenceUrls.length > 0 ? "fal-ai/nano-banana-2/edit" : "fal-ai/nano-banana-2";
    input = {
      prompt,
      num_images: 1,
      aspect_ratio: normalizeAspectRatio(aspectRatio),
      output_format: "png",
      resolution: "1K",
      limit_generations: true,
    };

    if (referenceUrls.length > 0) {
      input.image_urls = referenceUrls;
    }
  } else {
    input = {
      prompt,
      image_size: ASPECT_RATIO_MAP[aspectRatio] ?? "landscape_16_9",
      num_images: 1,
      guidance_scale: cfg,
      num_inference_steps: steps,
      enable_safety_checker: false,
    };

    if (referenceUrls[0]) {
      input.image_url = referenceUrls[0];
    }
  }

  onProgress?.(18);

  const result = await runFalQueue({
    apiKey,
    endpointId: endpoint,
    input,
    abortSignal,
    pollIntervalMs: 800,
    onQueueUpdate(update) {
      if (update.status === "IN_QUEUE") {
        onProgress?.(12);
      }

      if (update.status === "IN_PROGRESS") {
        onProgress?.(55);
      }

      if (update.status === "COMPLETED") {
        onProgress?.(78);
      }
    },
  });

  const data = result.data as {
    image?: {
      url: string;
      width?: number;
      height?: number;
      seed?: number;
    };
    images?: Array<{
      url: string;
      width?: number;
      height?: number;
      seed?: number;
    }>;
  };

  const image = data.images?.[0] ?? data.image;

  if (!image?.url) {
    throw new Error("fal yanitinda indirilebilir gorsel bulunamadi.");
  }

  return {
    url: image.url,
    width: image.width ?? 0,
    height: image.height ?? 0,
    seed: image.seed,
    requestId: result.requestId,
  };
}

export async function generateVideo(
  params: GenerateVideoParams,
): Promise<GenerateVideoResult> {
  const {
    model,
    prompt,
    imageStartPath,
    imageEndPath,
    duration,
    cfg,
    abortSignal,
    onProgress,
  } = params;

  const apiKey = await resolveFalApiKey();

  const imageUrl = await uploadLocalFileToFal(imageStartPath, apiKey);
  const promptAnalysis = analyzeKlingVideoPrompt(prompt);
  const multiPrompt = promptAnalysis.multiPrompt;
  const usesMultiPrompt = Array.isArray(multiPrompt) && multiPrompt.length > 1;
  const suppressEndImageForMultiPrompt = Boolean(imageEndPath) && usesMultiPrompt;
  const tailImageUrl =
    imageEndPath && !suppressEndImageForMultiPrompt
      ? await uploadLocalFileToFal(imageEndPath, apiKey)
      : undefined;
  const input: Record<string, unknown> = {
    start_image_url: imageUrl,
    duration,
    aspect_ratio: params.aspectRatio,
    cfg_scale: cfg,
    generate_audio: params.generateAudio ?? promptAnalysis.hasAudioDirection,
    negative_prompt: dedupePromptList([
      DEFAULT_KLING_NEGATIVE_PROMPT,
      params.negativePrompt,
      promptAnalysis.negativePrompt,
    ]),
  };

  if (tailImageUrl) {
    input.end_image_url = tailImageUrl;
  }

  if (usesMultiPrompt) {
    const validationMessage = getKlingMultiPromptValidationMessage(promptAnalysis);

    if (validationMessage) {
      throw new Error(validationMessage);
    }

    const shotDurations = distributeKlingMultiShotDurations(
      duration,
      multiPrompt.length,
    );
    input.multi_prompt = multiPrompt.map((element, index) => ({
      ...element,
      duration: shotDurations[index],
    }));
    input.shot_type = params.shotType ?? "customize";
  } else {
    input.prompt = promptAnalysis.prompt || prompt;
  }

  onProgress?.(18);

  try {
    const result = await runFalQueue({
      apiKey,
      endpointId: model,
      input,
      abortSignal,
      pollIntervalMs: 1200,
      onQueueUpdate(update) {
        if (update.status === "IN_QUEUE") {
          onProgress?.(16);
        }

        if (update.status === "IN_PROGRESS") {
          onProgress?.(62);
        }

        if (update.status === "COMPLETED") {
          onProgress?.(84);
        }
      },
    });

    const data = result.data as {
      video?: { url?: string };
      videos?: Array<{ url?: string }>;
    };
    const videoUrl = data.video?.url ?? data.videos?.[0]?.url;

    if (!videoUrl) {
      throw new Error("fal yanitinda indirilebilir video bulunamadi.");
    }

    return {
      url: videoUrl,
      requestId: result.requestId,
    };
  } catch (error) {
    console.error("Fal video request failed", {
      model,
      requestContext: {
        duration,
        aspectRatio: params.aspectRatio,
        generateAudio: params.generateAudio ?? promptAnalysis.hasAudioDirection,
        hasEndImage: Boolean(tailImageUrl),
        endImageSuppressed: suppressEndImageForMultiPrompt,
        detectedMultiShot: promptAnalysis.detectedMultiShot,
        shotCount: promptAnalysis.shotCount,
        shotType: params.shotType,
      },
      error,
    });

    throw new Error(summarizeFalApiError(error));
  }
}

export async function generateLipSyncVideoOnFal(
  params: GenerateLipSyncVideoParams,
): Promise<GenerateLipSyncVideoResult> {
  const {
    model,
    videoPath,
    audioPath,
    abortSignal,
    onProgress,
  } = params;

  const apiKey = await resolveFalApiKey();
  const videoUrl = await uploadLocalFileToFal(videoPath, apiKey);
  const audioUrl = await uploadLocalFileToFal(audioPath, apiKey);
  const endpoint = LIPSYNC_MODELS[model];
  const input: Record<string, unknown> = {
    video_url: videoUrl,
    audio_url: audioUrl,
  };

  if (params.syncMode) {
    input.sync_mode = params.syncMode;
  }

  if (model === "fal-ai/sync-lipsync") {
    input.model = "lipsync-1.9.0-beta";
  }

  onProgress?.(18);

  try {
    const result = await runFalQueue({
      apiKey,
      endpointId: endpoint.endpointId,
      input,
      abortSignal,
      pollIntervalMs: 1400,
      onQueueUpdate(update) {
        if (update.status === "IN_QUEUE") {
          onProgress?.(16);
        }

        if (update.status === "IN_PROGRESS") {
          onProgress?.(64);
        }

        if (update.status === "COMPLETED") {
          onProgress?.(84);
        }
      },
    });

    const data = result.data as {
      video?: { url?: string };
    };
    const outputUrl = data.video?.url;

    if (!outputUrl) {
      throw new Error("fal yanitinda indirilebilir lipsync video bulunamadi.");
    }

    return {
      url: outputUrl,
      requestId: result.requestId,
    };
  } catch (error) {
    console.error("Fal lipsync request failed", {
      model,
      videoPath,
      audioPath,
      syncMode: params.syncMode ?? null,
      error,
    });

    throw new Error(summarizeFalApiError(error));
  }
}

async function downloadBinaryToLocal(
  cdnUrl: string,
  destAbsPath: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  const response = await fetch(cdnUrl, { signal: abortSignal });

  if (!response.ok) {
    throw new Error(`Dosya indirilemedi (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  await writeFile(destAbsPath, new Uint8Array(buffer));
}

export async function downloadImageToLocal(
  cdnUrl: string,
  destAbsPath: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  await downloadBinaryToLocal(cdnUrl, destAbsPath, abortSignal);
}

export function resolveImageModel(model?: string | null): ImageModelId {
  return model && model in IMAGE_MODELS ? (model as ImageModelId) : "fal-ai/nano-banana-2";
}

export function resolveVideoModel(model?: string | null): VideoModelId {
  return model && model in VIDEO_MODELS
    ? (model as VideoModelId)
    : "fal-ai/kling-video/v3/pro/image-to-video";
}

export function calcImageCost(
  model: ImageModelId | string | null | undefined,
  quantity: number,
): number {
  return IMAGE_MODELS[resolveImageModel(model)].costPerImage * quantity;
}

export async function downloadVideoToLocal(
  cdnUrl: string,
  destAbsPath: string,
  abortSignal?: AbortSignal,
): Promise<void> {
  await downloadBinaryToLocal(cdnUrl, destAbsPath, abortSignal);
}

export function calcVideoCost(
  model: VideoModelId | string | null | undefined,
  durationS: number,
  generateAudio = false,
): number {
  const resolvedModel = VIDEO_MODELS[resolveVideoModel(model)];
  const rate = generateAudio
    ? resolvedModel.costPerSecondWithAudio
    : resolvedModel.costPerSecond;

  return rate * Math.max(1, durationS);
}
