import { dirname } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { getApiKey, getSetting } from "@/lib/store";

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
export const ELEVENLABS_DIALOGUE_MODEL_ID = "eleven_v3";
export const ELEVENLABS_PREFERRED_OUTPUT_FORMAT = "wav_44100";
export const ELEVENLABS_FALLBACK_OUTPUT_FORMAT = "mp3_44100_128";
export const ELEVENLABS_LANGUAGE_CODE = "tr";
export const ELEVENLABS_MAX_DIALOGUE_CHARS = 5000;
let supportsPreferredDialogueOutputFormat: boolean | null = null;

class ElevenLabsApiError extends Error {
  readonly httpStatus: number;
  readonly detailStatus: string | null;
  readonly detailMessage: string | null;
  readonly rawDetail: string;

  constructor(params: {
    httpStatus: number;
    detailStatus: string | null;
    detailMessage: string | null;
    rawDetail: string;
    message: string;
  }) {
    super(params.message);
    this.name = "ElevenLabsApiError";
    this.httpStatus = params.httpStatus;
    this.detailStatus = params.detailStatus;
    this.detailMessage = params.detailMessage;
    this.rawDetail = params.rawDetail;
  }
}

type ElevenLabsVoiceRow = {
  voice_id?: string;
  name?: string | null;
  labels?: Record<string, string> | null;
  preview_url?: string | null;
};

type ElevenLabsVoicesResponse = {
  voices?: ElevenLabsVoiceRow[];
};

type ElevenLabsSharedVoiceRow = {
  public_owner_id?: string;
  voice_id?: string;
  name?: string | null;
  accent?: string | null;
  gender?: string | null;
  age?: string | null;
  descriptive?: string | null;
  use_case?: string | null;
  category?: string | null;
  language?: string | null;
  locale?: string | null;
  usage_character_count_1y?: number | null;
  usage_character_count_7d?: number | null;
  play_api_usage_character_count_1y?: number | null;
  cloned_by_count?: number | null;
  free_users_allowed?: boolean | null;
  live_moderation_enabled?: boolean | null;
  featured?: boolean | null;
  preview_url?: string | null;
  description?: string | null;
  verified_languages?: ElevenLabsVerifiedLanguageRow[] | null;
};

type ElevenLabsSharedVoicesResponse = {
  voices?: ElevenLabsSharedVoiceRow[];
  has_more?: boolean;
  last_sort_id?: string | null;
};

type ElevenLabsVerifiedLanguageRow = {
  language?: string | null;
  model_id?: string | null;
  accent?: string | null;
  locale?: string | null;
  preview_url?: string | null;
};

type ElevenLabsDialogueAlignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
};

type ElevenLabsVoiceSegment = {
  voice_id?: string;
  text?: string;
  start?: number;
  end?: number;
};

type ElevenLabsDialogueResponse = {
  audio_base64?: string;
  voice_segments?: ElevenLabsVoiceSegment[];
  alignment?: ElevenLabsDialogueAlignment | null;
  normalized_alignment?: ElevenLabsDialogueAlignment | null;
};

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  labels: Record<string, string>;
  previewUrl: string | null;
}

export interface ElevenLabsSharedVoice {
  publicOwnerId: string;
  voiceId: string;
  name: string;
  accent: string | null;
  gender: string | null;
  age: string | null;
  descriptive: string | null;
  useCase: string | null;
  category: string | null;
  language: string | null;
  locale: string | null;
  usageCharacterCount1y: number;
  usageCharacterCount7d: number;
  playApiUsageCharacterCount1y: number;
  clonedByCount: number;
  freeUsersAllowed: boolean;
  liveModerationEnabled: boolean;
  featured: boolean;
  previewUrl: string | null;
  description: string | null;
  verifiedLanguages: ElevenLabsVerifiedLanguage[];
  turkishCompatibilityScore: number;
}

export interface ElevenLabsVerifiedLanguage {
  language: string | null;
  modelId: string | null;
  accent: string | null;
  locale: string | null;
  previewUrl: string | null;
}

export interface ElevenLabsSharedVoicesPageResult {
  voices: ElevenLabsSharedVoice[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DialogueLineInput {
  text: string;
  voiceId: string;
  speaker?: string;
}

export interface GenerateDialogueWithTimestampsParams {
  lines: DialogueLineInput[];
  outputPath: string;
  outputFormat?: string;
  stability?: number;
  similarityBoost?: number;
  useSpeakerBoost?: boolean;
  seed?: number;
  apiKeyOverride?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface GenerateDialogueWithTimestampsResult {
  outputPath: string;
  outputFormat: string;
  requestId: string | null;
  characterCount: number;
  costUsd: number;
  voiceSegments: ElevenLabsVoiceSegment[];
  alignment: ElevenLabsDialogueAlignment | null;
  normalizedAlignment: ElevenLabsDialogueAlignment | null;
}

function decodeBase64Audio(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getElevenLabsKey(apiKeyOverride?: string): Promise<string> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey("ELEVENLABS_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("ElevenLabs API key bulunamadi. Ayarlardan ekleyin.");
  }

  return apiKey;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseElevenLabsErrorDetail(rawDetail: string): {
  detailStatus: string | null;
  detailMessage: string | null;
} {
  const trimmed = rawDetail.trim();

  if (!trimmed) {
    return {
      detailStatus: null,
      detailMessage: null,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (!isObjectRecord(parsed)) {
      return {
        detailStatus: null,
        detailMessage: trimmed,
      };
    }

    const parsedDetail = parsed.detail;

    if (typeof parsedDetail === "string") {
      return {
        detailStatus: getNonEmptyString(parsed.status),
        detailMessage: getNonEmptyString(parsedDetail) ?? getNonEmptyString(parsed.message),
      };
    }

    if (isObjectRecord(parsedDetail)) {
      return {
        detailStatus:
          getNonEmptyString(parsedDetail.status) ?? getNonEmptyString(parsed.status),
        detailMessage:
          getNonEmptyString(parsedDetail.message) ?? getNonEmptyString(parsed.message),
      };
    }

    return {
      detailStatus: getNonEmptyString(parsed.status),
      detailMessage: getNonEmptyString(parsed.message) ?? trimmed,
    };
  } catch {
    return {
      detailStatus: null,
      detailMessage: trimmed,
    };
  }
}

function formatElevenLabsErrorMessage(
  httpStatus: number,
  detailStatus: string | null,
  detailMessage: string | null,
  rawDetail: string,
): string {
  const normalizedStatus = detailStatus?.toLowerCase() ?? "";
  const normalizedMessage = (detailMessage ?? rawDetail).toLowerCase();

  if (httpStatus === 401 || normalizedStatus === "invalid_api_key") {
    return "ElevenLabs API key gecersiz veya yetkisiz. Ayarlar ekranindan anahtari kontrol edin.";
  }

  if (
    httpStatus === 402 ||
    normalizedStatus === "quota_exceeded" ||
    normalizedMessage.includes("credit") ||
    normalizedMessage.includes("quota")
  ) {
    return "ElevenLabs kredisi yetersiz veya kullanim limiti dolmus. ElevenLabs hesabinizdaki kredi ve billing durumunu kontrol edin.";
  }

  if (
    httpStatus === 403 &&
    (
      normalizedStatus === "output_format_not_allowed" ||
      normalizedMessage.includes("output format") ||
      (normalizedMessage.includes("wav") && normalizedMessage.includes("pro")) ||
      (normalizedMessage.includes("pcm") && normalizedMessage.includes("pro"))
    )
  ) {
    return "Secilen ses cikti formati bu hesapta kullanilamiyor. ElevenLabs `wav_44100` icin Pro tier ister.";
  }

  if (httpStatus === 403) {
    return "ElevenLabs istegi reddedildi. API key kisitlari, hesap plani veya ozellik izinleri yeterli olmayabilir.";
  }

  if (httpStatus === 429 || normalizedStatus === "too_many_concurrent_requests") {
    return "ElevenLabs rate limitine ulasildi. Kisa bir sure sonra tekrar deneyin.";
  }

  const detail = detailMessage ?? getNonEmptyString(rawDetail);
  return `ElevenLabs istegi basarisiz oldu (${httpStatus})${detail ? `: ${detail}` : "."}`;
}

async function elevenLabsRequest<T>(
  path: string,
  init?: RequestInit,
  apiKeyOverride?: string,
): Promise<{ payload: T; response: Response }> {
  const apiKey = await getElevenLabsKey(apiKeyOverride);
  const headers = new Headers(init?.headers);
  headers.set("xi-api-key", apiKey);

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${ELEVENLABS_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let rawDetail = "";

    try {
      rawDetail = await response.text();
    } catch {
      rawDetail = "";
    }

    const { detailStatus, detailMessage } = parseElevenLabsErrorDetail(rawDetail);

    throw new ElevenLabsApiError({
      httpStatus: response.status,
      detailStatus,
      detailMessage,
      rawDetail,
      message: formatElevenLabsErrorMessage(
        response.status,
        detailStatus,
        detailMessage,
        rawDetail,
      ),
    });
  }

  return {
    payload: (await response.json()) as T,
    response,
  };
}

function isOutputFormatNotAllowedError(error: unknown): boolean {
  if (error instanceof ElevenLabsApiError) {
    const normalizedMessage = `${error.detailStatus ?? ""} ${error.detailMessage ?? ""}`.toLowerCase();

    return (
      error.httpStatus === 403 &&
      (
        normalizedMessage.includes("output_format_not_allowed") ||
        normalizedMessage.includes("output format") ||
        (normalizedMessage.includes("wav") && normalizedMessage.includes("pro")) ||
        (normalizedMessage.includes("pcm") && normalizedMessage.includes("pro"))
      )
    );
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("output_format_not_allowed") ||
    error.message.includes("Output format")
  );
}

function resolveOutputFileExtension(outputFormat: string): string {
  if (outputFormat.startsWith("mp3_")) {
    return ".mp3";
  }

  return ".wav";
}

async function resolveOutputPathForFormat(outputPath: string, outputFormat: string): Promise<string> {
  const nextExtension = resolveOutputFileExtension(outputFormat);
  const currentExtensionMatch = outputPath.match(/(\.[^./\\]+)$/);
  const currentExtension = currentExtensionMatch?.[1] ?? null;

  if (currentExtension?.toLowerCase() === nextExtension.toLowerCase()) {
    return outputPath;
  }

  if (currentExtension) {
    return `${outputPath.slice(0, outputPath.length - currentExtension.length)}${nextExtension}`;
  }

  return `${outputPath}${nextExtension}`;
}

function countDialogueCharacters(lines: DialogueLineInput[]): number {
  return lines.reduce((total, line) => total + line.text.trim().length, 0);
}

function normalizeMetadataValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isTurkishLanguageValue(value: string | null | undefined): boolean {
  const normalized = normalizeMetadataValue(value);
  return (
    normalized === "tr" ||
    normalized === "tr-tr" ||
    normalized === "turkish" ||
    normalized === "turkce" ||
    normalized === "turkce (turkiye)" ||
    normalized === "turkiye turkcesi" ||
    normalized === "turkish (turkiye)" ||
    normalized === "turkish (turkey)" ||
    normalized === "türkçe" ||
    normalized === "türkçe (türkiye)"
  );
}

function isTurkishLocaleValue(value: string | null | undefined): boolean {
  const normalized = normalizeMetadataValue(value);
  return (
    normalized === "tr" ||
    normalized.startsWith("tr-") ||
    normalized.startsWith("tr_") ||
    normalized.endsWith("-tr") ||
    normalized.endsWith("_tr")
  );
}

function isTurkishAccentValue(value: string | null | undefined): boolean {
  const normalized = normalizeMetadataValue(value);
  return normalized.includes("turk") || normalized.includes("türk");
}

function mapVerifiedLanguage(
  value: ElevenLabsVerifiedLanguageRow | null | undefined,
): ElevenLabsVerifiedLanguage {
  return {
    language: value?.language?.trim() || null,
    modelId: value?.model_id?.trim() || null,
    accent: value?.accent?.trim() || null,
    locale: value?.locale?.trim() || null,
    previewUrl: value?.preview_url ?? null,
  };
}

function scoreSharedVoiceForTurkishCompatibility(
  voice: Pick<
    ElevenLabsSharedVoice,
    | "language"
    | "locale"
    | "accent"
    | "description"
    | "descriptive"
    | "verifiedLanguages"
    | "freeUsersAllowed"
    | "featured"
  >,
): number {
  let score = 0;

  if (isTurkishLanguageValue(voice.language)) {
    score += 14;
  }

  if (isTurkishLocaleValue(voice.locale)) {
    score += 10;
  }

  if (isTurkishAccentValue(voice.accent)) {
    score += 10;
  }

  for (const verifiedLanguage of voice.verifiedLanguages) {
    if (isTurkishLanguageValue(verifiedLanguage.language)) {
      score += 16;
    }

    if (isTurkishLocaleValue(verifiedLanguage.locale)) {
      score += 12;
    }

    if (isTurkishAccentValue(verifiedLanguage.accent)) {
      score += 8;
    }
  }

  const descriptionHaystack = [
    voice.description,
    voice.descriptive,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bturk(?:ish|ce)?\b|türk/.test(descriptionHaystack)) {
    score += 6;
  }

  if (voice.freeUsersAllowed) {
    score += 2;
  }

  if (voice.featured) {
    score += 1;
  }

  return score;
}

function mapSharedVoice(
  voice: ElevenLabsSharedVoiceRow & { public_owner_id: string; voice_id: string },
): ElevenLabsSharedVoice {
  const verifiedLanguages = (voice.verified_languages ?? []).map(mapVerifiedLanguage);
  const mappedVoice: ElevenLabsSharedVoice = {
    publicOwnerId: voice.public_owner_id,
    voiceId: voice.voice_id,
    name: voice.name?.trim() || voice.voice_id,
    accent: voice.accent?.trim() || null,
    gender: voice.gender?.trim() || null,
    age: voice.age?.trim() || null,
    descriptive: voice.descriptive?.trim() || null,
    useCase: voice.use_case?.trim() || null,
    category: voice.category?.trim() || null,
    language: voice.language?.trim() || null,
    locale: voice.locale?.trim() || null,
    usageCharacterCount1y: Math.max(0, Number(voice.usage_character_count_1y) || 0),
    usageCharacterCount7d: Math.max(0, Number(voice.usage_character_count_7d) || 0),
    playApiUsageCharacterCount1y: Math.max(
      0,
      Number(voice.play_api_usage_character_count_1y) || 0,
    ),
    clonedByCount: Math.max(0, Number(voice.cloned_by_count) || 0),
    freeUsersAllowed: Boolean(voice.free_users_allowed),
    liveModerationEnabled: Boolean(voice.live_moderation_enabled),
    featured: Boolean(voice.featured),
    previewUrl: voice.preview_url ?? null,
    description: voice.description?.trim() || null,
    verifiedLanguages,
    turkishCompatibilityScore: 0,
  };

  return {
    ...mappedVoice,
    turkishCompatibilityScore: scoreSharedVoiceForTurkishCompatibility(mappedVoice),
  };
}

function isTurkishCompatibleSharedVoice(voice: ElevenLabsSharedVoice): boolean {
  return voice.turkishCompatibilityScore > 0;
}

async function listSharedVoicesPage(
  query: URLSearchParams,
  apiKeyOverride?: string,
): Promise<ElevenLabsSharedVoicesResponse> {
  const { payload } = await elevenLabsRequest<ElevenLabsSharedVoicesResponse>(
    `/shared-voices?${query.toString()}`,
    undefined,
    apiKeyOverride,
  );

  return payload;
}

async function collectSharedVoicesForQuery(
  queryOverrides: Record<string, string>,
  apiKeyOverride?: string,
): Promise<ElevenLabsSharedVoice[]> {
  const collected = new Map<string, ElevenLabsSharedVoice>();
  let page = 0;
  let hasMore = true;

  while (hasMore && page < 12) {
    const query = new URLSearchParams({
      page_size: "100",
      include_live_moderated: "false",
      page: String(page),
      ...queryOverrides,
    });
    const payload = await listSharedVoicesPage(query, apiKeyOverride);

    for (const voice of payload.voices ?? []) {
      if (!voice.public_owner_id || !voice.voice_id) {
        continue;
      }

      const mappedVoice = mapSharedVoice(
        voice as ElevenLabsSharedVoiceRow & { public_owner_id: string; voice_id: string },
      );
      const existing = collected.get(mappedVoice.voiceId);

      if (!existing || mappedVoice.turkishCompatibilityScore > existing.turkishCompatibilityScore) {
        collected.set(mappedVoice.voiceId, mappedVoice);
      }
    }

    hasMore = Boolean(payload.has_more);
    page += 1;
  }

  return Array.from(collected.values());
}

async function collectSharedVoicesPageForQuery(
  queryOverrides: Record<string, string>,
  page: number,
  pageSize: number,
  apiKeyOverride?: string,
): Promise<{ voices: ElevenLabsSharedVoice[]; hasMore: boolean }> {
  const query = new URLSearchParams({
    page_size: String(pageSize),
    include_live_moderated: "false",
    page: String(Math.max(0, page)),
    ...queryOverrides,
  });
  const payload = await listSharedVoicesPage(query, apiKeyOverride);
  const voices = (payload.voices ?? [])
    .filter(
      (voice): voice is ElevenLabsSharedVoiceRow & { public_owner_id: string; voice_id: string } =>
        Boolean(voice.public_owner_id) && Boolean(voice.voice_id),
    )
    .map((voice) => mapSharedVoice(voice))
    .filter(isTurkishCompatibleSharedVoice);

  return {
    voices,
    hasMore: Boolean(payload.has_more),
  };
}

async function estimateDialogueCostUsd(characterCount: number): Promise<number> {
  const ratePer1kChars = await getSetting(
    "ELEVENLABS_ESTIMATED_USD_PER_1K_CHARS",
    0.12,
  );
  return (Math.max(0, characterCount) / 1000) * Math.max(0, Number(ratePer1kChars) || 0.12);
}

export async function listVoices(
  apiKeyOverride?: string,
): Promise<ElevenLabsVoice[]> {
  const { payload } = await elevenLabsRequest<ElevenLabsVoicesResponse>(
    "/voices",
    undefined,
    apiKeyOverride,
  );

  return (payload.voices ?? [])
    .filter((voice): voice is ElevenLabsVoiceRow & { voice_id: string } => Boolean(voice.voice_id))
    .map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name?.trim() || voice.voice_id,
      labels: voice.labels ?? {},
      previewUrl: voice.preview_url ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

export async function testElevenLabsConnection(
  apiKeyOverride?: string,
): Promise<{ voiceCount: number }> {
  const voices = await listVoices(apiKeyOverride);
  return { voiceCount: voices.length };
}

export async function listRecommendedTurkishSharedVoices(
  apiKeyOverride?: string,
): Promise<ElevenLabsSharedVoice[]> {
  const [languageVoices, accentVoices, localeVoices] = await Promise.all([
    collectSharedVoicesForQuery({ language: "turkish" }, apiKeyOverride),
    collectSharedVoicesForQuery({ accent: "turkish" }, apiKeyOverride),
    collectSharedVoicesForQuery({ locale: "tr-TR" }, apiKeyOverride),
  ]);
  const merged = new Map<string, ElevenLabsSharedVoice>();

  for (const voice of [...languageVoices, ...accentVoices, ...localeVoices]) {
    if (!isTurkishCompatibleSharedVoice(voice)) {
      continue;
    }

    const existing = merged.get(voice.voiceId);

    if (!existing || voice.turkishCompatibilityScore > existing.turkishCompatibilityScore) {
      merged.set(voice.voiceId, voice);
    }
  }

  return Array.from(merged.values()).sort((left, right) =>
    right.turkishCompatibilityScore - left.turkishCompatibilityScore ||
    Number(right.freeUsersAllowed) - Number(left.freeUsersAllowed) ||
    right.clonedByCount - left.clonedByCount ||
    right.playApiUsageCharacterCount1y - left.playApiUsageCharacterCount1y ||
    right.usageCharacterCount1y - left.usageCharacterCount1y ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export async function listRecommendedTurkishSharedVoicesPage(params?: {
  page?: number;
  pageSize?: number;
  apiKeyOverride?: string;
}): Promise<ElevenLabsSharedVoicesPageResult> {
  const page = Math.max(0, params?.page ?? 0);
  const pageSize = Math.min(48, Math.max(8, params?.pageSize ?? 18));
  const [languagePage, accentPage, localePage] = await Promise.all([
    collectSharedVoicesPageForQuery({ language: "turkish" }, page, pageSize, params?.apiKeyOverride),
    collectSharedVoicesPageForQuery({ accent: "turkish" }, page, pageSize, params?.apiKeyOverride),
    collectSharedVoicesPageForQuery({ locale: "tr-TR" }, page, pageSize, params?.apiKeyOverride),
  ]);
  const merged = new Map<string, ElevenLabsSharedVoice>();

  for (const voice of [
    ...languagePage.voices,
    ...accentPage.voices,
    ...localePage.voices,
  ]) {
    const existing = merged.get(voice.voiceId);

    if (!existing || voice.turkishCompatibilityScore > existing.turkishCompatibilityScore) {
      merged.set(voice.voiceId, voice);
    }
  }

  return {
    voices: Array.from(merged.values()).sort((left, right) =>
      right.turkishCompatibilityScore - left.turkishCompatibilityScore ||
      Number(right.freeUsersAllowed) - Number(left.freeUsersAllowed) ||
      right.clonedByCount - left.clonedByCount ||
      right.playApiUsageCharacterCount1y - left.playApiUsageCharacterCount1y ||
      right.usageCharacterCount1y - left.usageCharacterCount1y ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    ),
    page,
    pageSize,
    hasMore: languagePage.hasMore || accentPage.hasMore || localePage.hasMore,
  };
}

export async function addSharedVoiceToMyVoices(params: {
  publicOwnerId: string;
  voiceId: string;
  newName?: string;
  apiKeyOverride?: string;
}): Promise<{ voiceId: string }> {
  const { payload } = await elevenLabsRequest<{ voice_id?: string }>(
    `/voices/add/${encodeURIComponent(params.publicOwnerId)}/${encodeURIComponent(params.voiceId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        new_name: params.newName?.trim() || undefined,
        bookmarked: true,
      }),
    },
    params.apiKeyOverride,
  );

  if (!payload.voice_id) {
    throw new Error("ElevenLabs yanitinda yeni voice_id bulunamadi.");
  }

  return {
    voiceId: payload.voice_id,
  };
}

export async function generateDialogueWithTimestamps(
  params: GenerateDialogueWithTimestampsParams,
): Promise<GenerateDialogueWithTimestampsResult> {
  const trimmedLines = params.lines
    .map((line) => ({
      ...line,
      text: line.text.trim(),
      voiceId: line.voiceId.trim(),
      speaker: line.speaker?.trim(),
    }))
    .filter((line) => line.text && line.voiceId);

  if (trimmedLines.length === 0) {
    throw new Error("ElevenLabs dialogue istegi icin en az bir satir gerekli.");
  }

  const uniqueVoiceIds = new Set(trimmedLines.map((line) => line.voiceId));

  if (uniqueVoiceIds.size > 10) {
    throw new Error("ElevenLabs text-to-dialogue en fazla 10 benzersiz voice ID destekler.");
  }

  const characterCount = countDialogueCharacters(trimmedLines);

  if (characterCount > ELEVENLABS_MAX_DIALOGUE_CHARS) {
    throw new Error(
      `Dialogue transcript ${characterCount} karakter. Eleven v3 limiti ${ELEVENLABS_MAX_DIALOGUE_CHARS} karakter olarak sabitlendi.`,
    );
  }

  params.onProgress?.(12);

  const requestedOutputFormat = params.outputFormat?.trim() || ELEVENLABS_PREFERRED_OUTPUT_FORMAT;
  const initialOutputFormat =
    requestedOutputFormat === ELEVENLABS_PREFERRED_OUTPUT_FORMAT &&
    supportsPreferredDialogueOutputFormat === false
      ? ELEVENLABS_FALLBACK_OUTPUT_FORMAT
      : requestedOutputFormat;
  const requestBody = {
    model_id: ELEVENLABS_DIALOGUE_MODEL_ID,
    language_code: ELEVENLABS_LANGUAGE_CODE,
    stability: Math.max(0, Math.min(1, params.stability ?? 0.5)),
    similarity_boost: Math.max(0, Math.min(1, params.similarityBoost ?? 0.78)),
    use_speaker_boost: params.useSpeakerBoost ?? true,
    seed: params.seed,
    apply_text_normalization: "auto",
    inputs: trimmedLines.map((line) => ({
      text: line.text,
      voice_id: line.voiceId,
    })),
  };
  let selectedOutputFormat = initialOutputFormat;
  let payload: ElevenLabsDialogueResponse;
  let response: Response;

  try {
    ({ payload, response } = await elevenLabsRequest<ElevenLabsDialogueResponse>(
      `/text-to-dialogue/with-timestamps?output_format=${selectedOutputFormat}`,
      {
        method: "POST",
        body: JSON.stringify(requestBody),
        signal: params.abortSignal,
      },
      params.apiKeyOverride,
    ));
    if (selectedOutputFormat === ELEVENLABS_PREFERRED_OUTPUT_FORMAT) {
      supportsPreferredDialogueOutputFormat = true;
    }
  } catch (error) {
    if (
      selectedOutputFormat === ELEVENLABS_PREFERRED_OUTPUT_FORMAT &&
      isOutputFormatNotAllowedError(error)
    ) {
      supportsPreferredDialogueOutputFormat = false;
      selectedOutputFormat = ELEVENLABS_FALLBACK_OUTPUT_FORMAT;
      ({ payload, response } = await elevenLabsRequest<ElevenLabsDialogueResponse>(
        `/text-to-dialogue/with-timestamps?output_format=${selectedOutputFormat}`,
        {
          method: "POST",
          body: JSON.stringify(requestBody),
          signal: params.abortSignal,
        },
        params.apiKeyOverride,
      ));
    } else {
      throw error;
    }
  }

  if (!payload.audio_base64) {
    throw new Error("ElevenLabs yanitinda audio_base64 bulunamadi.");
  }

  params.onProgress?.(68);

  const resolvedOutputPath = await resolveOutputPathForFormat(params.outputPath, selectedOutputFormat);

  await mkdir(await dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, decodeBase64Audio(payload.audio_base64));

  params.onProgress?.(92);

  return {
    outputPath: resolvedOutputPath,
    outputFormat: selectedOutputFormat,
    requestId: response.headers.get("request-id"),
    characterCount,
    costUsd: await estimateDialogueCostUsd(characterCount),
    voiceSegments: payload.voice_segments ?? [],
    alignment: payload.alignment ?? null,
    normalizedAlignment: payload.normalized_alignment ?? null,
  };
}
