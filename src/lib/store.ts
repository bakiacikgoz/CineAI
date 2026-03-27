import { Store } from "@tauri-apps/plugin-store";

let storeInstance: Store | null = null;

export type ApiKeyName =
  | "FAL_API_KEY"
  | "TENSORPIX_API_KEY"
  | "OPENROUTER_API_KEY"
  | "ELEVENLABS_API_KEY";

export type AppSettingName =
  | "DEFAULT_IMAGE_MODEL"
  | "DEFAULT_VIDEO_MODEL"
  | "DEFAULT_TENSORPIX_FILTER"
  | "DEFAULT_UPSCALE_FACTOR"
  | "ELEVENLABS_ESTIMATED_USD_PER_1K_CHARS"
  | "PARALLEL_LIMIT"
  | "QUEUE_PARALLEL_LIMIT"
  | "LAST_ACTIVE_PROJECT_PATH";

export type SettingsKey = ApiKeyName | AppSettingName;

export interface AppSettings {
  defaultImageModel: string;
  defaultVideoModel: string;
  defaultUpscaleFactor: 2 | 4;
  elevenLabsEstimatedUsdPer1kChars: number;
  queueParallelLimit: number;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultImageModel: "fal-ai/nano-banana-2",
  defaultVideoModel: "fal-ai/kling-video/v3/pro/image-to-video",
  defaultUpscaleFactor: 4,
  elevenLabsEstimatedUsdPer1kChars: 0.12,
  queueParallelLimit: 3,
};

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load("settings.dat");
  }

  return storeInstance;
}

export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  const store = await getStore();
  return (await store.get<string>(key)) ?? null;
}

export async function setApiKey(key: ApiKeyName, value: string): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

export async function getAppSetting<T = string>(
  key: AppSettingName,
): Promise<T | null> {
  const store = await getStore();
  return (await store.get<T>(key)) ?? null;
}

export async function setAppSetting<T>(
  key: AppSettingName,
  value: T,
): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

export async function getSetting<T>(key: SettingsKey, fallback: T): Promise<T> {
  const store = await getStore();
  return ((await store.get<T>(key)) ?? fallback) as T;
}

export async function setSetting<T>(key: SettingsKey, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

export async function getAppSettings(): Promise<AppSettings> {
  const [
    defaultImageModel,
    defaultVideoModel,
    defaultUpscaleFactor,
    elevenLabsEstimatedUsdPer1kChars,
    queueParallelLimit,
    legacyParallelLimit,
  ] = await Promise.all([
    getSetting("DEFAULT_IMAGE_MODEL", DEFAULT_APP_SETTINGS.defaultImageModel),
    getSetting("DEFAULT_VIDEO_MODEL", DEFAULT_APP_SETTINGS.defaultVideoModel),
    getSetting(
      "DEFAULT_UPSCALE_FACTOR",
      DEFAULT_APP_SETTINGS.defaultUpscaleFactor,
    ),
    getSetting(
      "ELEVENLABS_ESTIMATED_USD_PER_1K_CHARS",
      DEFAULT_APP_SETTINGS.elevenLabsEstimatedUsdPer1kChars,
    ),
    getAppSetting<number>("QUEUE_PARALLEL_LIMIT"),
    getAppSetting<number>("PARALLEL_LIMIT"),
  ]);

  const resolvedParallelLimit =
    queueParallelLimit ?? legacyParallelLimit ?? DEFAULT_APP_SETTINGS.queueParallelLimit;

  return {
    defaultImageModel,
    defaultVideoModel,
    defaultUpscaleFactor:
      defaultUpscaleFactor === 2 || defaultUpscaleFactor === 4
        ? defaultUpscaleFactor
        : DEFAULT_APP_SETTINGS.defaultUpscaleFactor,
    elevenLabsEstimatedUsdPer1kChars:
      Math.max(0, Number(elevenLabsEstimatedUsdPer1kChars)) ||
      DEFAULT_APP_SETTINGS.elevenLabsEstimatedUsdPer1kChars,
    queueParallelLimit: Math.min(
      5,
      Math.max(1, Number(resolvedParallelLimit) || 3),
    ),
  };
}

export function normalizeQueueParallelLimit(limit: number): number {
  return Math.min(5, Math.max(1, Number(limit) || DEFAULT_APP_SETTINGS.queueParallelLimit));
}

export async function setAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const store = await getStore();
  const entries = Object.entries(settings) as Array<
    [keyof AppSettings, AppSettings[keyof AppSettings]]
  >;

  for (const [key, value] of entries) {
    const storageKey =
      key === "defaultImageModel"
        ? "DEFAULT_IMAGE_MODEL"
        : key === "defaultVideoModel"
          ? "DEFAULT_VIDEO_MODEL"
          : key === "defaultUpscaleFactor"
            ? "DEFAULT_UPSCALE_FACTOR"
            : key === "elevenLabsEstimatedUsdPer1kChars"
              ? "ELEVENLABS_ESTIMATED_USD_PER_1K_CHARS"
            : "QUEUE_PARALLEL_LIMIT";
    await store.set(
      storageKey,
      key === "queueParallelLimit" ? normalizeQueueParallelLimit(Number(value)) : value,
    );

    if (key === "queueParallelLimit") {
      await store.set("PARALLEL_LIMIT", normalizeQueueParallelLimit(Number(value)));
    }
  }

  await store.save();
}

export async function persistQueueParallelLimit(limit: number): Promise<number> {
  const normalized = normalizeQueueParallelLimit(limit);
  await setAppSettings({ queueParallelLimit: normalized });
  return normalized;
}

export async function getLastActiveProjectPath(): Promise<string | null> {
  const path = await getAppSetting<string>("LAST_ACTIVE_PROJECT_PATH");
  return path?.trim() ? path : null;
}

export async function setLastActiveProjectPath(path: string): Promise<void> {
  const store = await getStore();
  await store.set("LAST_ACTIVE_PROJECT_PATH", path.trim());
  await store.save();
}

export async function clearLastActiveProjectPath(): Promise<void> {
  const store = await getStore();
  await store.delete("LAST_ACTIVE_PROJECT_PATH");
  await store.save();
}
