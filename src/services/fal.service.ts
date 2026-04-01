import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@tauri-apps/plugin-fs";
import { extractAudioDirectionBlock } from "@/lib/audio-direction-parser";
import { type LipSyncModelId, type LipSyncSyncMode } from "@/lib/lipsync";
import { getApiKey } from "@/lib/store";
import {
  generateVideoOnEvoLink,
  testEvoLinkConnection as testEvoLinkConnectionRequest,
} from "@/services/evolink.service";

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

export const VIDEO_PROVIDER_LABELS = {
  fal: "fal.ai",
  evolink: "EvoLink",
} as const;

export type VideoProviderId = keyof typeof VIDEO_PROVIDER_LABELS;
export type VideoInputMode =
  | "image-to-video"
  | "reference-to-video"
  | "text-to-video";

type VideoModelMeta = {
  label: string;
  provider: VideoProviderId;
  inputMode: VideoInputMode;
  remoteModel: string;
  variantGroup?: string;
  quality?: "720p" | "1080p";
  costPerSecond: number;
  costPerSecondWithAudio: number;
  minDurationS: number;
  maxDurationS: number;
  supportsAudio: boolean;
  supportsAspectRatio: boolean;
  supportsEndImage: boolean;
  supportsMultiShot: boolean;
  supportsNegativePrompt: boolean;
  storyboardCapable: boolean;
  generatorCapable: boolean;
};

const MAX_EVOLINK_ELEMENT_COUNT = 3;

export const VIDEO_MODELS = {
  "fal-ai/kling-video/v3/pro/image-to-video": {
    label: "fal.ai · Kling 3.0 Pro",
    provider: "fal",
    inputMode: "image-to-video",
    remoteModel: "fal-ai/kling-video/v3/pro/image-to-video",
    variantGroup: "fal-ai/kling-video/v3/image-to-video",
    quality: "1080p",
    costPerSecond: 0.112,
    costPerSecondWithAudio: 0.168,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: true,
    supportsMultiShot: true,
    supportsNegativePrompt: true,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "fal-ai/kling-video/v3/standard/image-to-video": {
    label: "fal.ai Â· Kling 3.0 Std",
    provider: "fal",
    inputMode: "image-to-video",
    remoteModel: "fal-ai/kling-video/v3/standard/image-to-video",
    variantGroup: "fal-ai/kling-video/v3/image-to-video",
    quality: "720p",
    costPerSecond: 0.084,
    costPerSecondWithAudio: 0.126,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: true,
    supportsMultiShot: true,
    supportsNegativePrompt: true,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "fal-ai/kling-video/o3/standard/reference-to-video": {
    label: "fal.ai - Kling O3 Std (Reference)",
    provider: "fal",
    inputMode: "reference-to-video",
    remoteModel: "fal-ai/kling-video/o3/standard/reference-to-video",
    variantGroup: "fal-ai/kling-video/o3/reference-to-video",
    quality: "720p",
    costPerSecond: 0.084,
    costPerSecondWithAudio: 0.112,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: true,
    supportsMultiShot: true,
    supportsNegativePrompt: true,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "fal-ai/kling-video/o3/pro/reference-to-video": {
    label: "fal.ai - Kling O3 Pro (Reference)",
    provider: "fal",
    inputMode: "reference-to-video",
    remoteModel: "fal-ai/kling-video/o3/pro/reference-to-video",
    variantGroup: "fal-ai/kling-video/o3/reference-to-video",
    quality: "1080p",
    costPerSecond: 0.112,
    costPerSecondWithAudio: 0.14,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: true,
    supportsMultiShot: true,
    supportsNegativePrompt: true,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "evolink/kling-v3/std/image-to-video": {
    label: "EvoLink · Kling 3.0 Std (Image)",
    provider: "evolink",
    inputMode: "image-to-video",
    remoteModel: "kling-v3-image-to-video",
    quality: "720p",
    costPerSecond: 0.075,
    costPerSecondWithAudio: 0.1125,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: false,
    supportsEndImage: true,
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "evolink/kling-v3/pro/image-to-video": {
    label: "EvoLink · Kling 3.0 Pro (Image)",
    provider: "evolink",
    inputMode: "image-to-video",
    remoteModel: "kling-v3-image-to-video",
    quality: "1080p",
    costPerSecond: 0.1,
    costPerSecondWithAudio: 0.15,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: false,
    supportsEndImage: true,
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "evolink/kling-o3/std/image-to-video": {
    label: "EvoLink · Kling O3 Std (Image)",
    provider: "evolink",
    inputMode: "image-to-video",
    remoteModel: "kling-o3-image-to-video",
    quality: "720p",
    costPerSecond: 0.075,
    costPerSecondWithAudio: 0.1125,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: true,
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "evolink/kling-o3/pro/image-to-video": {
    label: "EvoLink · Kling O3 Pro (Image)",
    provider: "evolink",
    inputMode: "image-to-video",
    remoteModel: "kling-o3-image-to-video",
    quality: "1080p",
    costPerSecond: 0.1,
    costPerSecondWithAudio: 0.15,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: true,
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    storyboardCapable: true,
    generatorCapable: true,
  },
  "evolink/kling-v3/std/text-to-video": {
    label: "EvoLink · Kling 3.0 Std (Text)",
    provider: "evolink",
    inputMode: "text-to-video",
    remoteModel: "kling-v3-text-to-video",
    quality: "720p",
    costPerSecond: 0.075,
    costPerSecondWithAudio: 0.1125,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: false,
    supportsMultiShot: false,
    supportsNegativePrompt: true,
    storyboardCapable: false,
    generatorCapable: true,
  },
  "evolink/kling-v3/pro/text-to-video": {
    label: "EvoLink · Kling 3.0 Pro (Text)",
    provider: "evolink",
    inputMode: "text-to-video",
    remoteModel: "kling-v3-text-to-video",
    quality: "1080p",
    costPerSecond: 0.1,
    costPerSecondWithAudio: 0.15,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: false,
    supportsMultiShot: false,
    supportsNegativePrompt: true,
    storyboardCapable: false,
    generatorCapable: true,
  },
  "evolink/kling-o3/std/text-to-video": {
    label: "EvoLink · Kling O3 Std (Text)",
    provider: "evolink",
    inputMode: "text-to-video",
    remoteModel: "kling-o3-text-to-video",
    quality: "720p",
    costPerSecond: 0.075,
    costPerSecondWithAudio: 0.1125,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: false,
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    storyboardCapable: false,
    generatorCapable: true,
  },
  "evolink/kling-o3/pro/text-to-video": {
    label: "EvoLink · Kling O3 Pro (Text)",
    provider: "evolink",
    inputMode: "text-to-video",
    remoteModel: "kling-o3-text-to-video",
    quality: "1080p",
    costPerSecond: 0.1,
    costPerSecondWithAudio: 0.15,
    minDurationS: 3,
    maxDurationS: 15,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsEndImage: false,
    supportsMultiShot: false,
    supportsNegativePrompt: false,
    storyboardCapable: false,
    generatorCapable: true,
  },
} as const satisfies Record<string, VideoModelMeta>;

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

export type CrystalUpscaleFactor = 2 | 4;

export interface GenerateCrystalUpscaledImageParams {
  sourcePath: string;
  scaleFactor?: CrystalUpscaleFactor;
  abortSignal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface GenerateCrystalUpscaledImageResult {
  url: string;
  width: number;
  height: number;
  requestId?: string;
}

export interface GenerateVideoParams {
  jobId: string;
  model: VideoModelId;
  prompt: string;
  imageStartPath?: string;
  imageEndPath?: string;
  elementIds?: string[];
  characterReferenceImagePaths?: string[];
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
  durationS?: number;
}

export interface FalKlingElementInput {
  frontal_image_url: string;
  reference_image_urls?: string[];
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
const CRYSTAL_UPSCALER_MODEL = "clarityai/crystal-upscaler";
const KLING_MULTI_PROMPT_CHAR_LIMIT = 512;
const MIN_SHARED_KLING_CONTEXT_LENGTH = 24;

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

export function getVideoProviderLabel(provider: VideoProviderId): string {
  return VIDEO_PROVIDER_LABELS[provider];
}

export function resolveVideoModel(model?: string | null): VideoModelId {
  return model && model in VIDEO_MODELS
    ? (model as VideoModelId)
    : "fal-ai/kling-video/v3/pro/image-to-video";
}

export function getVideoModelMeta(
  model?: string | null,
): (typeof VIDEO_MODELS)[VideoModelId] {
  return VIDEO_MODELS[resolveVideoModel(model)];
}

function getVideoVariantGroup(meta: VideoModelMeta): string {
  return (
    meta.variantGroup ??
    [
      meta.provider,
      meta.remoteModel,
      meta.inputMode,
      meta.storyboardCapable ? "storyboard" : "generator",
    ].join(":")
  );
}

export function resolveStoryboardVideoModel(model?: string | null): VideoModelId {
  const resolved = resolveVideoModel(model);
  return VIDEO_MODELS[resolved].storyboardCapable
    ? resolved
    : "fal-ai/kling-video/v3/pro/image-to-video";
}

export function getVideoQuality(
  model?: string | null,
): "720p" | "1080p" | null {
  return getVideoModelMeta(model).quality ?? null;
}

export function getVideoQualityOptions(
  model?: string | null,
): Array<"720p" | "1080p"> {
  const resolved = resolveVideoModel(model);
  const meta = VIDEO_MODELS[resolved];
  const variantGroup = getVideoVariantGroup(meta);
  const options = (Object.entries(VIDEO_MODELS) as Array<
    [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]
  >)
    .filter(([, candidate]) =>
      candidate.provider === meta.provider &&
      getVideoVariantGroup(candidate) === variantGroup &&
      candidate.inputMode === meta.inputMode &&
      candidate.storyboardCapable === meta.storyboardCapable,
    )
    .map(([, candidate]) => candidate.quality)
    .filter((quality): quality is "720p" | "1080p" => Boolean(quality));

  return Array.from(new Set(options)).sort((left, right) =>
    left === right ? 0 : left === "720p" ? -1 : 1,
  );
}

export function getStoryboardVideoQualityOptions(): Array<"720p" | "1080p"> {
  const options = (Object.entries(VIDEO_MODELS) as Array<
    [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]
  >)
    .filter(([, meta]) => meta.storyboardCapable)
    .map(([, meta]) => meta.quality)
    .filter((quality): quality is "720p" | "1080p" => Boolean(quality));

  return Array.from(new Set(options)).sort((left, right) =>
    left === right ? 0 : left === "720p" ? -1 : 1,
  );
}

export function resolveVideoModelWithQuality(
  model: string | null | undefined,
  quality?: "720p" | "1080p" | null,
): VideoModelId {
  const resolved = resolveVideoModel(model);
  const meta = VIDEO_MODELS[resolved];
  const variantGroup = getVideoVariantGroup(meta);

  if (!quality) {
    return resolved;
  }

  const candidate = (Object.entries(VIDEO_MODELS) as Array<
    [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]
  >).find(([, candidateMeta]) =>
    candidateMeta.provider === meta.provider &&
    getVideoVariantGroup(candidateMeta) === variantGroup &&
    candidateMeta.inputMode === meta.inputMode &&
    candidateMeta.storyboardCapable === meta.storyboardCapable &&
    candidateMeta.quality === quality,
  );

  return candidate?.[0] ?? resolved;
}

export function resolveStoryboardVideoModelForQuality(
  model: string | null | undefined,
  quality?: "720p" | "1080p" | null,
): VideoModelId {
  const baseModel = resolveStoryboardVideoModel(model);
  const baseMeta = VIDEO_MODELS[baseModel];
  const exactMatch = resolveVideoModelWithQuality(baseModel, quality);

  if (!quality || getVideoQuality(exactMatch) === quality) {
    return exactMatch;
  }

  const fallback = (Object.entries(VIDEO_MODELS) as Array<
    [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]
  >).find(([, meta]) =>
    meta.storyboardCapable &&
    meta.inputMode === baseMeta.inputMode &&
    meta.quality === quality,
  ) ?? (Object.entries(VIDEO_MODELS) as Array<
    [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]
  >).find(([, meta]) =>
    meta.storyboardCapable &&
    meta.inputMode === "image-to-video" &&
    meta.quality === quality,
  );

  return fallback?.[0] ?? baseModel;
}

export function resolveVideoProvider(model?: string | null): VideoProviderId {
  return getVideoModelMeta(model).provider;
}

export function getVideoModelEntries(options?: {
  provider?: VideoProviderId;
  storyboardCapable?: boolean;
  generatorCapable?: boolean;
}): Array<[VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]> {
  return (Object.entries(VIDEO_MODELS) as Array<
    [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]]
  >).filter(([, meta]) => {
    if (options?.provider && meta.provider !== options.provider) {
      return false;
    }

    if (options?.storyboardCapable && !meta.storyboardCapable) {
      return false;
    }

    if (options?.generatorCapable && !meta.generatorCapable) {
      return false;
    }

    return true;
  });
}

export function selectVideoModelForProvider(params: {
  provider: VideoProviderId;
  currentModel?: string | null;
  generatorCapable?: boolean;
  storyboardCapable?: boolean;
}): VideoModelId {
  const currentMeta = params.currentModel ? getVideoModelMeta(params.currentModel) : null;
  const candidate = getVideoModelEntries({
    provider: params.provider,
    generatorCapable: params.generatorCapable,
    storyboardCapable: params.storyboardCapable,
  }).find(([, meta]) => meta.inputMode === currentMeta?.inputMode)
    ?? getVideoModelEntries({
      provider: params.provider,
      generatorCapable: params.generatorCapable,
      storyboardCapable: params.storyboardCapable,
    })[0];

  return candidate?.[0] ?? "fal-ai/kling-video/v3/pro/image-to-video";
}

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

function normalizeEvoLinkElementIds(elementIds?: string[]): string[] {
  return Array.from(
    new Set(
      (elementIds ?? [])
        .map((elementId) => elementId.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_EVOLINK_ELEMENT_COUNT);
}

function normalizeFalCharacterReferencePaths(referenceImagePaths?: string[]): string[] {
  return Array.from(
    new Set(
      (referenceImagePaths ?? [])
        .map((referencePath) => referencePath.trim())
        .filter(Boolean),
    ),
  );
}

function supportsEvoLinkElementList(meta: VideoModelMeta): boolean {
  return meta.provider === "evolink" && meta.remoteModel.startsWith("kling-o3");
}

function supportsFalReferenceElements(meta: VideoModelMeta): boolean {
  return meta.provider === "fal" && meta.inputMode === "reference-to-video";
}

export function injectEvoLinkElementReferences(
  prompt: string,
  elementCount: number,
): string {
  const normalizedPrompt = normalizeMultilineText(prompt);

  if (!Number.isInteger(elementCount) || elementCount < 1) {
    return normalizedPrompt;
  }

  const tokens = Array.from(
    { length: Math.min(elementCount, MAX_EVOLINK_ELEMENT_COUNT) },
    (_, index) => `<<<element_${index + 1}>>>`,
  );
  const hasAllReferences = tokens.every((token) => normalizedPrompt.includes(token));

  if (hasAllReferences) {
    return normalizedPrompt;
  }

  const anchorLine =
    tokens.length === 1
      ? `Use ${tokens[0]} as the primary character identity anchor and preserve this exact character throughout the shot.`
      : `Use ${tokens.join(", ")} as the character identity anchors and preserve them consistently throughout the shot.`;

  return [anchorLine, normalizedPrompt].filter(Boolean).join("\n\n").trim();
}

export function injectFalElementReferences(
  prompt: string,
  elementCount: number,
): string {
  const normalizedPrompt = normalizeMultilineText(prompt);

  if (!Number.isInteger(elementCount) || elementCount < 1) {
    return normalizedPrompt;
  }

  const tokens = Array.from({ length: elementCount }, (_, index) => `@Element${index + 1}`);
  const hasAllReferences = tokens.every((token) => normalizedPrompt.includes(token));

  if (hasAllReferences) {
    return normalizedPrompt;
  }

  const anchorLine =
    tokens.length === 1
      ? `Use ${tokens[0]} as the primary character identity anchor and preserve this exact character throughout the shot.`
      : `Use ${tokens.join(", ")} as the character identity anchors and preserve them consistently throughout the shot.`;

  return [anchorLine, normalizedPrompt].filter(Boolean).join("\n\n").trim();
}

export function buildFalCharacterElements(
  referenceImageUrls?: string[],
): FalKlingElementInput[] {
  const normalizedUrls = Array.from(
    new Set((referenceImageUrls ?? []).map((url) => url.trim()).filter(Boolean)),
  );
  const [frontalImageUrl, ...referenceImageUrlsRest] = normalizedUrls;

  if (!frontalImageUrl) {
    return [];
  }

  const referenceImageUrlsForFal =
    referenceImageUrlsRest.length > 0 ? referenceImageUrlsRest : [frontalImageUrl];

  return [
    {
      frontal_image_url: frontalImageUrl,
      reference_image_urls: referenceImageUrlsForFal,
    },
  ];
}

export function buildFalVideoRequestInput(params: {
  model: VideoModelId;
  prompt: string;
  startImageUrl: string;
  endImageUrl?: string;
  characterReferenceImageUrls?: string[];
  duration: KlingDuration;
  aspectRatio: VideoAspectRatio;
  cfg: number;
  generateAudio: boolean;
  negativePrompt?: string;
  shotType?: KlingShotType;
}): Record<string, unknown> {
  const meta = getVideoModelMeta(params.model);
  const promptAnalysis = analyzeKlingVideoPrompt(params.prompt);
  const multiPrompt = promptAnalysis.multiPrompt;
  const usesMultiPrompt = Array.isArray(multiPrompt) && multiPrompt.length > 1;
  const input: Record<string, unknown> = {
    start_image_url: params.startImageUrl,
    duration: params.duration,
    aspect_ratio: params.aspectRatio,
    cfg_scale: params.cfg,
    generate_audio: params.generateAudio,
  };

  const negativePrompt = dedupePromptList([
    DEFAULT_KLING_NEGATIVE_PROMPT,
    params.negativePrompt,
    promptAnalysis.negativePrompt,
  ]);

  if (meta.supportsNegativePrompt && negativePrompt) {
    input.negative_prompt = negativePrompt;
  }

  if (params.endImageUrl) {
    input.end_image_url = params.endImageUrl;
  }

  if (supportsFalReferenceElements(meta)) {
    const elements = buildFalCharacterElements(params.characterReferenceImageUrls);

    if (elements.length > 0) {
      input.elements = elements;
    }
  }

  if (usesMultiPrompt) {
    const shotDurations = distributeKlingMultiShotDurations(
      params.duration,
      multiPrompt.length,
    );
    input.multi_prompt = multiPrompt.map((element, index) => ({
      ...element,
      duration: shotDurations[index],
    }));
    input.shot_type = params.shotType ?? "customize";
    return input;
  }

  input.prompt = promptAnalysis.prompt || params.prompt;
  return input;
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

function normalizeKlingPromptSegment(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function truncateKlingPromptSegment(value: string, maxLength: number): string {
  const normalized = normalizeKlingPromptSegment(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  if (maxLength <= 1) {
    return normalized.slice(0, maxLength);
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function compactKlingPromptSegment(value: string, maxLength: number): string {
  const normalized = normalizeKlingPromptSegment(value);

  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  const chunks = normalized.match(/[^.!?;,]+[.!?;,]?/g)
    ?.map((chunk) => chunk.trim())
    .filter(Boolean) ?? [normalized];
  let compacted = "";

  for (const chunk of chunks) {
    const candidate = normalizeKlingPromptSegment([compacted, chunk].filter(Boolean).join(" "));

    if (candidate.length <= maxLength) {
      compacted = candidate;
      continue;
    }

    break;
  }

  return compacted || truncateKlingPromptSegment(normalized, maxLength);
}

function buildKlingMultiPromptPrompt(
  sharedPrefix: string,
  shotPrompt: string,
  sharedSuffix: string,
): string {
  const compactedShotPrompt = compactKlingPromptSegment(
    shotPrompt,
    KLING_MULTI_PROMPT_CHAR_LIMIT,
  );
  let prompt = compactedShotPrompt;
  const reservedForSuffix = sharedSuffix ? MIN_SHARED_KLING_CONTEXT_LENGTH + 1 : 0;
  const availablePrefixLength =
    KLING_MULTI_PROMPT_CHAR_LIMIT - prompt.length - reservedForSuffix - 1;

  if (sharedPrefix && availablePrefixLength >= MIN_SHARED_KLING_CONTEXT_LENGTH) {
    const compactedPrefix = compactKlingPromptSegment(sharedPrefix, availablePrefixLength);

    if (compactedPrefix) {
      prompt = normalizeKlingPromptSegment([compactedPrefix, prompt].join(" "));
    }
  }

  const availableSuffixLength = KLING_MULTI_PROMPT_CHAR_LIMIT - prompt.length - 1;

  if (sharedSuffix && availableSuffixLength >= MIN_SHARED_KLING_CONTEXT_LENGTH) {
    const compactedSuffix = compactKlingPromptSegment(sharedSuffix, availableSuffixLength);

    if (compactedSuffix) {
      prompt = normalizeKlingPromptSegment([prompt, compactedSuffix].join(" "));
    }
  }

  return compactKlingPromptSegment(prompt, KLING_MULTI_PROMPT_CHAR_LIMIT);
}

function stripKlingShotHeader(shotPrompt: string): string {
  return shotPrompt.replace(/^\s*Shot\s+\d+\s*[,:.\-]\s*/i, "").trim();
}

function isQuotaRelatedErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("http 402") ||
    normalized.includes("insufficient credit") ||
    normalized.includes("insufficient quota") ||
    normalized.includes("pre-deduction failed") ||
    normalized.includes("quota exceeded")
  );
}

function isFalBalanceRelatedErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("user is locked") ||
    normalized.includes("exhausted balance") ||
    normalized.includes("top up your balance") ||
    normalized.includes("fal.ai/dashboard/billing")
  );
}

export function summarizeFalApiError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);

  if (isFalBalanceRelatedErrorMessage(rawMessage)) {
    return `FAL bakiyesi tukenmis veya hesap kilitlenmis. ${rawMessage}`;
  }

  if (isQuotaRelatedErrorMessage(rawMessage)) {
    return `EvoLink kredisi yetersiz. ${rawMessage}`;
  }

  if (rawMessage.includes("Prompt must not exceed 512 characters")) {
    return `Fal Kling multi-shot limiti asildi. Her shot promptu en fazla 512 karakter olabilir. Ortak ortam aciklamasini ve shot bloklarini kisaltin. ${rawMessage}`;
  }

  return rawMessage;
}

function isRetriableFalUploadErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("408 request timeout") ||
    normalized.includes("\"status\":408") ||
    normalized.includes(" request timeout") ||
    normalized.includes(" timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("429") ||
    normalized.includes("too many requests") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("connection reset") ||
    normalized.includes("connection aborted") ||
    normalized.includes("temporarily unavailable")
  );
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

async function uploadLocalFileToFal(
  filePath: string,
  apiKey: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const retryDelaysMs = [900, 2200];
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (abortSignal?.aborted) {
      throw createAbortError();
    }

    try {
      return await invokeFalCommand<string>("fal_upload_file", {
        apiKey,
        filePath,
      });
    } catch (error) {
      lastError = error;
      const summarizedError = summarizeFalApiError(error);

      if (
        !isRetriableFalUploadErrorMessage(summarizedError) ||
        attempt === retryDelaysMs.length
      ) {
        throw new Error(summarizedError);
      }

      await waitForDelay(retryDelaysMs[attempt], abortSignal);
    }
  }

  throw new Error(summarizeFalApiError(lastError));
}

async function uploadLocalFilesToFal(
  filePaths: string[],
  apiKey: string,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  const uploadedUrls: string[] = [];

  // Fal CDN upload step is prone to transient 408s; keeping uploads sequential reduces burst pressure.
  for (const filePath of filePaths) {
    uploadedUrls.push(await uploadLocalFileToFal(filePath, apiKey, abortSignal));
  }

  return uploadedUrls;
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

  const emptyIndex = promptAnalysis.multiPrompt.findIndex(
    (element) => normalizeKlingPromptSegment(element.prompt).length === 0,
  );

  if (emptyIndex >= 0) {
    return `Shot ${emptyIndex + 1} promptu bos. Kling multi-shot icin her shot acik bir prompt icermeli.`;
  }

  const tooLongIndex = promptAnalysis.multiPrompt.findIndex(
    (element) => element.prompt.length > KLING_MULTI_PROMPT_CHAR_LIMIT,
  );

  if (tooLongIndex >= 0) {
    const length = promptAnalysis.multiPrompt[tooLongIndex]?.prompt.length ?? 0;
    return `Shot ${tooLongIndex + 1} promptu ${length} karakter. Kling multi-shot modda her shot en fazla 512 karakter olabilir. Shot bloklarini kisaltin.`;
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

export async function testEvoLinkConnection(
  apiKeyOverride?: string,
): Promise<{
  remainingUserCredits: number;
  remainingTokenCredits: number | null;
}> {
  return testEvoLinkConnectionRequest(apiKeyOverride);
}

export function buildCrystalUpscaleInput(
  imageUrl: string,
  scaleFactor: CrystalUpscaleFactor = 2,
): Record<string, unknown> {
  return {
    image_url: imageUrl,
    scale_factor: scaleFactor,
  };
}

type FalImageOutput = {
  url: string;
  width: number;
  height: number;
  seed?: number;
};

export function extractFalImageOutput(data: unknown): FalImageOutput {
  const payload = (data ?? {}) as {
    image?: string | { url?: string; width?: number; height?: number; seed?: number };
    images?: Array<string | { url?: string; width?: number; height?: number; seed?: number }>;
  };
  const candidate = payload.images?.[0] ?? payload.image;

  if (typeof candidate === "string") {
    return {
      url: candidate,
      width: 0,
      height: 0,
    };
  }

  if (candidate?.url) {
    return {
      url: candidate.url,
      width: candidate.width ?? 0,
      height: candidate.height ?? 0,
      seed: candidate.seed,
    };
  }

  throw new Error("fal yanitinda indirilebilir gorsel bulunamadi.");
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
      ? await uploadLocalFilesToFal(mergedReferencePaths, apiKey, abortSignal)
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

  const image = extractFalImageOutput(result.data);

  return {
    url: image.url,
    width: image.width,
    height: image.height,
    seed: image.seed,
    requestId: result.requestId,
  };
}

export async function generateCrystalUpscaledImage(
  params: GenerateCrystalUpscaledImageParams,
): Promise<GenerateCrystalUpscaledImageResult> {
  const apiKey = await resolveFalApiKey();
  const scaleFactor = params.scaleFactor ?? 2;
  const imageUrl = await uploadLocalFileToFal(params.sourcePath, apiKey, params.abortSignal);

  params.onProgress?.(18);

  const result = await runFalQueue({
    apiKey,
    endpointId: CRYSTAL_UPSCALER_MODEL,
    input: buildCrystalUpscaleInput(imageUrl, scaleFactor),
    abortSignal: params.abortSignal,
    pollIntervalMs: 800,
    onQueueUpdate(update) {
      if (update.status === "IN_QUEUE") {
        params.onProgress?.(12);
      }

      if (update.status === "IN_PROGRESS") {
        params.onProgress?.(55);
      }

      if (update.status === "COMPLETED") {
        params.onProgress?.(78);
      }
    },
  });
  const image = extractFalImageOutput(result.data);

  return {
    url: image.url,
    width: image.width,
    height: image.height,
    requestId: result.requestId,
  };
}

async function generateVideoOnFal(
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
  const meta = getVideoModelMeta(model);

  if (!imageStartPath) {
    throw new Error("fal.ai video uretimi icin START gorseli gerekli.");
  }

  const apiKey = await resolveFalApiKey();

  const imageUrl = await uploadLocalFileToFal(imageStartPath, apiKey, abortSignal);
  const promptAnalysis = analyzeKlingVideoPrompt(prompt);
  const multiPrompt = promptAnalysis.multiPrompt;
  const usesMultiPrompt = Array.isArray(multiPrompt) && multiPrompt.length > 1;
  const suppressEndImageForMultiPrompt = Boolean(imageEndPath) && usesMultiPrompt;
  const tailImageUrl =
    imageEndPath && !suppressEndImageForMultiPrompt
      ? await uploadLocalFileToFal(imageEndPath, apiKey, abortSignal)
      : undefined;
  const normalizedCharacterReferencePaths = supportsFalReferenceElements(meta)
    ? normalizeFalCharacterReferencePaths(params.characterReferenceImagePaths)
    : [];
  const characterReferenceImageUrls =
    normalizedCharacterReferencePaths.length > 0
      ? await uploadLocalFilesToFal(
          normalizedCharacterReferencePaths,
          apiKey,
          abortSignal,
        )
      : [];
  const input = buildFalVideoRequestInput({
    model,
    prompt,
    startImageUrl: imageUrl,
    endImageUrl: tailImageUrl,
    characterReferenceImageUrls,
    duration,
    aspectRatio: params.aspectRatio,
    cfg,
    generateAudio: params.generateAudio ?? promptAnalysis.hasAudioDirection,
    negativePrompt: params.negativePrompt,
    shotType: params.shotType,
  });

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
        characterElementCount: characterReferenceImageUrls.length > 0 ? 1 : 0,
        detectedMultiShot: promptAnalysis.detectedMultiShot,
        shotCount: promptAnalysis.shotCount,
        shotType: params.shotType,
        inputMode: meta.inputMode,
      },
      error,
    });

    throw new Error(summarizeFalApiError(error));
  }
}

export async function generateVideo(
  params: GenerateVideoParams,
): Promise<GenerateVideoResult> {
  const meta = getVideoModelMeta(params.model);
  const elementIds = supportsEvoLinkElementList(meta)
    ? normalizeEvoLinkElementIds(params.elementIds)
    : [];
  const falCharacterReferencePaths = supportsFalReferenceElements(meta)
    ? normalizeFalCharacterReferencePaths(params.characterReferenceImagePaths)
    : [];
  const providerPrompt =
    elementIds.length > 0
      ? injectEvoLinkElementReferences(params.prompt, elementIds.length)
      : falCharacterReferencePaths.length > 0
        ? injectFalElementReferences(params.prompt, 1)
        : params.prompt;
  const promptAnalysis = analyzeKlingVideoPrompt(providerPrompt);

  if (promptAnalysis.detectedMultiShot && !meta.supportsMultiShot) {
    throw new Error(
      `${meta.label} icin multi-shot gonderimi henuz uygulanmadi. Tek shot prompt kullan veya fal.ai Kling modeline gec.`,
    );
  }

  if (meta.provider === "fal") {
    return generateVideoOnFal({
      ...params,
      prompt: providerPrompt,
      characterReferenceImagePaths: falCharacterReferencePaths,
    });
  }

  try {
    return await generateVideoOnEvoLink({
      remoteModel: meta.remoteModel,
      inputMode: meta.inputMode,
      prompt: promptAnalysis.prompt || providerPrompt,
      duration: params.duration,
      aspectRatio: params.aspectRatio,
      quality: meta.quality ?? "720p",
      generateAudio: meta.supportsAudio
        ? (params.generateAudio ?? promptAnalysis.hasAudioDirection)
        : false,
      elementIds,
      negativePrompt: dedupePromptList([
        DEFAULT_KLING_NEGATIVE_PROMPT,
        params.negativePrompt,
        promptAnalysis.negativePrompt,
      ]),
      imageStartPath: params.imageStartPath,
      imageEndPath: meta.supportsEndImage ? params.imageEndPath : undefined,
      abortSignal: params.abortSignal,
      onProgress: params.onProgress,
      supportsAudio: meta.supportsAudio,
      supportsAspectRatio: meta.supportsAspectRatio,
      supportsNegativePrompt: meta.supportsNegativePrompt,
      supportsElementList: supportsEvoLinkElementList(meta),
    });
  } catch (error) {
    const summarizedError = summarizeFalApiError(error);
    const logMethod = isQuotaRelatedErrorMessage(summarizedError) ? console.warn : console.error;

    logMethod("EvoLink video request failed", {
      model: params.model,
      requestContext: {
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        generateAudio: params.generateAudio ?? promptAnalysis.hasAudioDirection,
        hasStartImage: Boolean(params.imageStartPath),
        hasEndImage: Boolean(params.imageEndPath),
        elementCount: elementIds.length,
        provider: meta.provider,
        inputMode: meta.inputMode,
        quality: meta.quality,
      },
      error: summarizedError,
    });

    throw new Error(summarizedError);
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
  const videoUrl = await uploadLocalFileToFal(videoPath, apiKey, abortSignal);
  const audioUrl = await uploadLocalFileToFal(audioPath, apiKey, abortSignal);
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
  const rate = generateAudio && resolvedModel.supportsAudio
    ? resolvedModel.costPerSecondWithAudio
    : resolvedModel.costPerSecond;

  return rate * Math.max(1, durationS);
}
