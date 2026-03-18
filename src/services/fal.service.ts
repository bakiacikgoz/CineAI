import { extname } from "@tauri-apps/api/path";
import { fal } from "@fal-ai/client";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { getApiKey } from "@/lib/store";

export const IMAGE_MODELS = {
  "fal-ai/nano-banana-2": {
    label: "Nano Banana 2",
    costPerImage: 0,
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
    costPerVideo: 0,
    maxDurationS: 15,
    supportsAudio: true,
    supportsMultiShot: true,
  },
} as const;

export type VideoModelId = keyof typeof VIDEO_MODELS;
export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type KlingShotType = "customize" | "intelligent";

export const KLING_V3_DURATION_VALUES = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
] as const;

export type KlingDuration = (typeof KLING_V3_DURATION_VALUES)[number];

export interface KlingMultiPromptElement {
  prompt: string;
  duration?: KlingDuration;
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

let falConfigured = false;
const DEFAULT_KLING_NEGATIVE_PROMPT = "blur, distort, and low quality";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
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
  return [sharedPrefix, shotPrompt, sharedSuffix].filter(Boolean).join("\n\n").trim();
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
  const negativePrompt = dedupePromptList([
    DEFAULT_KLING_NEGATIVE_PROMPT,
    normalizeAvoidBlock(avoidMatch?.[1] ?? ""),
  ]);

  const shotHeaderRegex = /^\s*Shot\s+\d+\s*[,:.\-].*$/gim;
  const shotHeaders = Array.from(withoutAvoid.matchAll(shotHeaderRegex))
    .map((match) => ({
      index: typeof match.index === "number" ? match.index : -1,
    }))
    .filter((match) => match.index >= 0);
  const hasAudioDirection = /(^|\n)\s*Audio direction\s*:/i.test(withoutAvoid);

  if (shotHeaders.length < 2) {
    return {
      detectedMultiShot: false,
      shotCount: shotHeaders.length,
      hasAudioDirection,
      prompt: withoutAvoid,
      multiPrompt: null,
      negativePrompt,
    };
  }

  const trailingSectionRegex =
    /^\s*(Audio direction:|Language:|Type:|Dialogue transcript:|SFX:|Ambience:|Music:|Mix target:|No on-screen subtitles\/captions\.)/im;
  const sharedPrefix = withoutAvoid.slice(0, shotHeaders[0].index).trim();
  const multiPrompt: KlingMultiPromptElement[] = [];
  const lastShotStart = shotHeaders[shotHeaders.length - 1]?.index ?? 0;
  const trailingMatch = trailingSectionRegex.exec(withoutAvoid.slice(lastShotStart));
  const sharedSuffixStartIndex =
    trailingMatch && typeof trailingMatch.index === "number" && trailingMatch.index > 0
      ? lastShotStart + trailingMatch.index
      : -1;
  const sharedSuffix =
    sharedSuffixStartIndex >= 0
      ? withoutAvoid.slice(sharedSuffixStartIndex).trim()
      : "";

  shotHeaders.forEach((header, index) => {
    const nextHeaderIndex = shotHeaders[index + 1]?.index ?? withoutAvoid.length;
    let endIndex = nextHeaderIndex;

    if (index === shotHeaders.length - 1) {
      if (sharedSuffixStartIndex >= 0) {
        endIndex = sharedSuffixStartIndex;
      } else {
        const inlineTrailingMatch = trailingSectionRegex.exec(withoutAvoid.slice(header.index));
        if (
          inlineTrailingMatch &&
          typeof inlineTrailingMatch.index === "number" &&
          inlineTrailingMatch.index > 0
        ) {
          endIndex = header.index + inlineTrailingMatch.index;
        }
      }
    }

    const shotPrompt = withoutAvoid.slice(header.index, endIndex).trim();

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
    prompt: withoutAvoid,
    multiPrompt: multiPrompt.length > 1 ? multiPrompt : null,
    negativePrompt,
  };
}

async function ensureFalConfigured() {
  if (falConfigured) {
    return;
  }

  const key = (await getApiKey("FAL_API_KEY"))?.trim();

  if (!key) {
    throw new Error("FAL API key bulunamadi. Ayarlardan ekleyin.");
  }

  fal.config({ credentials: key });
  falConfigured = true;
}

async function uploadLocalFileToFal(filePath: string): Promise<string> {
  await ensureFalConfigured();

  const bytes = await readFile(filePath);
  const fileExtension = (await extname(filePath)).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[fileExtension] ?? "application/octet-stream";
  const fileName = `cineai-upload${fileExtension || ".bin"}`;
  const file = new File([bytes], fileName, { type: mimeType });

  return fal.storage.upload(file);
}

export async function initFal(): Promise<boolean> {
  const key = (await getApiKey("FAL_API_KEY"))?.trim();

  if (!key) {
    falConfigured = false;
    return false;
  }

  fal.config({ credentials: key });
  falConfigured = true;
  return true;
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

  await ensureFalConfigured();
  const mergedReferencePaths = Array.from(
    new Set([...(referenceImagePaths ?? []), ...(refImagePath ? [refImagePath] : [])]),
  );
  const referenceUrls =
    mergedReferencePaths.length > 0
      ? await Promise.all(mergedReferencePaths.map((path) => uploadLocalFileToFal(path)))
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

  const result = await fal.subscribe(endpoint, {
    input,
    abortSignal,
    mode: "polling",
    pollInterval: 800,
    logs: true,
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

  await ensureFalConfigured();

  const imageUrl = await uploadLocalFileToFal(imageStartPath);
  const tailImageUrl = imageEndPath ? await uploadLocalFileToFal(imageEndPath) : undefined;
  const promptAnalysis = analyzeKlingVideoPrompt(prompt);
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

  if (promptAnalysis.multiPrompt && promptAnalysis.multiPrompt.length > 1) {
    input.multi_prompt = promptAnalysis.multiPrompt;
    input.shot_type = params.shotType ?? "customize";
  } else {
    input.prompt = promptAnalysis.prompt || prompt;
  }

  onProgress?.(18);

  const subscribeVideo = fal.subscribe as unknown as (
    endpoint: string,
    options: {
      input: Record<string, unknown>;
      abortSignal?: AbortSignal;
      mode: "polling";
      pollInterval: number;
      logs: boolean;
      onQueueUpdate: (update: { status: string }) => void;
    },
  ) => Promise<{ data: unknown; requestId?: string }>;

  const result = await subscribeVideo(model, {
    input,
    abortSignal,
    mode: "polling",
    pollInterval: 1200,
    logs: true,
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
  quantity: number,
): number {
  return VIDEO_MODELS[resolveVideoModel(model)].costPerVideo * quantity;
}
