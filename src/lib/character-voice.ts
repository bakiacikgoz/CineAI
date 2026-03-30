import type { CharacterVoiceBindingRecord } from "@/services/audio-pipeline.service";
import type { ElevenLabsVoice } from "@/services/elevenlabs.service";

export interface CharacterVoiceRecord {
  voiceId: string | null;
  voiceName: string | null;
  voiceProvider: string | null;
  modelId: string | null;
}

export interface CharacterVoiceState extends CharacterVoiceRecord {
  isMissing: boolean;
}

export const EMPTY_CHARACTER_VOICE_STATE: CharacterVoiceState = {
  voiceId: null,
  voiceName: null,
  voiceProvider: null,
  modelId: null,
  isMissing: true,
};

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeVoiceMetadataValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function normalizeCharacterVoiceRecord(
  input?: Partial<CharacterVoiceRecord> | null,
): CharacterVoiceRecord {
  return {
    voiceId: normalizeNullableString(input?.voiceId),
    voiceName: normalizeNullableString(input?.voiceName),
    voiceProvider: normalizeNullableString(input?.voiceProvider),
    modelId: normalizeNullableString(input?.modelId),
  };
}

export function resolveCharacterVoiceState(
  input?: Partial<CharacterVoiceRecord> | null,
): CharacterVoiceState {
  const record = normalizeCharacterVoiceRecord(input);

  return {
    ...record,
    isMissing: !record.voiceId,
  };
}

export function buildCharacterVoiceState(
  binding?: CharacterVoiceBindingRecord | null,
): CharacterVoiceState {
  return resolveCharacterVoiceState(binding);
}

export function hasCharacterVoiceSelection(
  input?: Partial<CharacterVoiceRecord> | null,
): boolean {
  return Boolean(normalizeCharacterVoiceRecord(input).voiceId);
}

function scoreVoiceForTurkish(voice: ElevenLabsVoice): number {
  const haystack = [
    voice.name,
    ...Object.entries(voice.labels).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;

  if (/\bturk(?:ish)?\b/.test(haystack)) {
    score += 12;
  }

  if (/\btr\b|\btr-tr\b/.test(haystack)) {
    score += 8;
  }

  if (/\bistanbul\b|\bankara\b/.test(haystack)) {
    score += 4;
  }

  const useCase = normalizeVoiceMetadataValue(voice.labels.use_case);
  if (/\bconversational\b|\bnarration\b|\bstorytelling\b/.test(useCase)) {
    score += 2;
  }

  return score;
}

export function scoreVoiceForTurkishCompatibility(voice: ElevenLabsVoice): number {
  const haystack = [
    voice.name,
    ...Object.entries(voice.labels).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .toLowerCase();

  let score = scoreVoiceForTurkish(voice);

  if (/\bturk\b|\bturkce\b|\bturkey\b|\bturkiye\b/.test(haystack)) {
    score += 6;
  }

  if (/\blanguage\b.*\btr\b|\blocale\b.*\btr\b|\baccent\b.*\bturk/.test(haystack)) {
    score += 6;
  }

  if (/\bvoice over\b|\bconversational\b|\bnarration\b|\bstorytelling\b/.test(haystack)) {
    score += 2;
  }

  return score;
}

export function buildVoiceOptionLabel(voice: ElevenLabsVoice): string {
  return scoreVoiceForTurkishCompatibility(voice) > 0 ? `${voice.name} [TR]` : voice.name;
}

export function sortVoicesForCharacterSelection(
  voices: ElevenLabsVoice[],
): ElevenLabsVoice[] {
  return voices.slice().sort(
    (left, right) =>
      scoreVoiceForTurkishCompatibility(right) - scoreVoiceForTurkishCompatibility(left) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}
