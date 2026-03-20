export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:2";
export type VideoAspectRatio = "16:9" | "9:16" | "1:1";
export type KlingShotType = "customize" | "intelligent";

export interface ImageGeneratorDefaults {
  model: string;
  aspectRatio: ImageAspectRatio;
  cfg: number;
  steps: number;
}

export interface VideoGeneratorDefaults {
  model: string;
  duration: number;
  aspectRatio: VideoAspectRatio;
  cfg: number;
  generateAudio: boolean;
  shotType: KlingShotType;
}

type AppDefaultsLike = {
  defaultImageModel?: string;
  defaultVideoModel?: string;
};

type ImagePresetLike = {
  imageModel?: string | null;
  imageParams?: string | null;
};

type VideoPresetLike = {
  videoModel?: string | null;
  videoParams?: string | null;
};

const IMAGE_ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:2"];
const VIDEO_ASPECT_RATIOS: VideoAspectRatio[] = ["16:9", "9:16", "1:1"];
const KLING_DURATIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export const DEFAULT_IMAGE_GENERATOR_DEFAULTS: ImageGeneratorDefaults = {
  model: "fal-ai/nano-banana-2",
  aspectRatio: "16:9",
  cfg: 7,
  steps: 28,
};

export const DEFAULT_VIDEO_GENERATOR_DEFAULTS: VideoGeneratorDefaults = {
  model: "fal-ai/kling-video/v3/pro/image-to-video",
  duration: 5,
  aspectRatio: "16:9",
  cfg: 0.45,
  generateAudio: false,
  shotType: "customize",
};

function parseJsonObject(value?: string | null): Record<string, unknown> | null {
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

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toImageAspectRatio(value: unknown): ImageAspectRatio | undefined {
  return typeof value === "string" && IMAGE_ASPECT_RATIOS.includes(value as ImageAspectRatio)
    ? (value as ImageAspectRatio)
    : undefined;
}

function toVideoAspectRatio(value: unknown): VideoAspectRatio | undefined {
  return typeof value === "string" && VIDEO_ASPECT_RATIOS.includes(value as VideoAspectRatio)
    ? (value as VideoAspectRatio)
    : undefined;
}

function toDuration(value: unknown): number | undefined {
  return typeof value === "number" && KLING_DURATIONS.includes(value) ? value : undefined;
}

function toShotType(value: unknown): KlingShotType | undefined {
  return value === "customize" || value === "intelligent" ? value : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mergeImageDefaults(
  current: ImageGeneratorDefaults,
  next?: Partial<ImageGeneratorDefaults>,
): ImageGeneratorDefaults {
  return {
    model: next?.model ?? current.model,
    aspectRatio: next?.aspectRatio ?? current.aspectRatio,
    cfg: next?.cfg ?? current.cfg,
    steps: next?.steps ?? current.steps,
  };
}

function mergeVideoDefaults(
  current: VideoGeneratorDefaults,
  next?: Partial<VideoGeneratorDefaults>,
): VideoGeneratorDefaults {
  return {
    model: next?.model ?? current.model,
    duration: next?.duration ?? current.duration,
    aspectRatio: next?.aspectRatio ?? current.aspectRatio,
    cfg: next?.cfg ?? current.cfg,
    generateAudio: next?.generateAudio ?? current.generateAudio,
    shotType: next?.shotType ?? current.shotType,
  };
}

function imageDefaultsFromPreset(preset?: ImagePresetLike | null): Partial<ImageGeneratorDefaults> {
  const parsed = parseJsonObject(preset?.imageParams);

  return {
    model: preset?.imageModel?.trim() || undefined,
    aspectRatio: toImageAspectRatio(parsed?.aspectRatio),
    cfg: toFiniteNumber(parsed?.cfg),
    steps: toFiniteNumber(parsed?.steps),
  };
}

function videoDefaultsFromPreset(preset?: VideoPresetLike | null): Partial<VideoGeneratorDefaults> {
  const parsed = parseJsonObject(preset?.videoParams);

  return {
    model: preset?.videoModel?.trim() || undefined,
    duration: toDuration(parsed?.duration),
    aspectRatio: toVideoAspectRatio(parsed?.aspectRatio),
    cfg: toFiniteNumber(parsed?.cfg),
    generateAudio: toBoolean(parsed?.generateAudio),
    shotType: toShotType(parsed?.shotType),
  };
}

export function resolveImageGeneratorDefaults(input: {
  appDefaults?: AppDefaultsLike | null;
  defaultPreset?: ImagePresetLike | null;
  inboundState?: Partial<ImageGeneratorDefaults> | null;
  inboundPreset?: ImagePresetLike | null;
}): ImageGeneratorDefaults {
  let resolved = DEFAULT_IMAGE_GENERATOR_DEFAULTS;

  resolved = mergeImageDefaults(resolved, {
    model: input.appDefaults?.defaultImageModel?.trim() || undefined,
  });
  resolved = mergeImageDefaults(resolved, imageDefaultsFromPreset(input.defaultPreset));
  resolved = mergeImageDefaults(resolved, input.inboundState ?? undefined);
  resolved = mergeImageDefaults(resolved, imageDefaultsFromPreset(input.inboundPreset));

  return resolved;
}

export function resolveVideoGeneratorDefaults(input: {
  appDefaults?: AppDefaultsLike | null;
  defaultPreset?: VideoPresetLike | null;
  inboundState?: Partial<VideoGeneratorDefaults> | null;
  inboundPreset?: VideoPresetLike | null;
}): VideoGeneratorDefaults {
  let resolved = DEFAULT_VIDEO_GENERATOR_DEFAULTS;

  resolved = mergeVideoDefaults(resolved, {
    model: input.appDefaults?.defaultVideoModel?.trim() || undefined,
  });
  resolved = mergeVideoDefaults(resolved, videoDefaultsFromPreset(input.defaultPreset));
  resolved = mergeVideoDefaults(resolved, input.inboundState ?? undefined);
  resolved = mergeVideoDefaults(resolved, videoDefaultsFromPreset(input.inboundPreset));

  return resolved;
}
