import { join } from "@tauri-apps/api/path";
import { exists, remove, rename } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import { getApiKey } from "@/lib/store";
import {
  applyDialogueLineOverride,
  createAudioContentHash,
  normalizeAudioSpeakerKey,
  parseAudioDirection,
  resolveAudioShotStatus,
  type AudioShotStatus,
  type ParsedAudioDirection,
  type ParsedDialogueLine,
} from "@/lib/audio-direction-parser";
import { logCost } from "@/services/cost.service";
import {
  addSharedVoiceToMyVoices,
  ELEVENLABS_DIALOGUE_MODEL_ID,
  ELEVENLABS_MAX_DIALOGUE_CHARS,
  ELEVENLABS_FALLBACK_OUTPUT_FORMAT,
  ELEVENLABS_PREFERRED_OUTPUT_FORMAT,
  generateDialogueWithTimestamps,
  listRecommendedTurkishSharedVoicesPage,
  listVoices,
  listRecommendedTurkishSharedVoices,
  type ElevenLabsSharedVoicesPageResult,
  type ElevenLabsSharedVoice,
  type ElevenLabsVoice,
} from "@/services/elevenlabs.service";
export type { ElevenLabsSharedVoicesPageResult } from "@/services/elevenlabs.service";
import {
  createDialogueOptimizationSourceHash,
  optimizeDialogueForSpeech,
  resolveDialoguePerformanceProfile,
  type DialoguePerformancePreset,
  type OptimizedDialogueLine,
} from "@/services/llm.service";
import { listCharacters, type CharacterRecord } from "@/services/character.service";
import {
  getShotById,
  getShots,
  updateShotAudioFields,
  type ShotRow,
} from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";

type CharacterVoiceBindingRow = {
  id: string;
  project_id: string;
  character_id: string;
  voice_id: string;
  voice_name: string | null;
  voice_provider: string;
  model_id: string | null;
  created_at: number;
  updated_at: number;
};

type AudioSpeakerAliasRow = {
  id: string;
  project_id: string;
  speaker_key: string;
  speaker_label: string;
  character_id: string;
  created_at: number;
  updated_at: number;
};

type AudioSpeakerVoiceBindingRow = {
  id: string;
  project_id: string;
  speaker_key: string;
  speaker_label: string;
  voice_id: string;
  voice_name: string | null;
  voice_provider: string;
  model_id: string | null;
  created_at: number;
  updated_at: number;
};

export interface CharacterVoiceBindingRecord {
  id: string;
  projectId: string;
  characterId: string;
  voiceId: string;
  voiceName: string | null;
  voiceProvider: string;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AudioSpeakerAliasRecord {
  id: string;
  projectId: string;
  speakerKey: string;
  speakerLabel: string;
  characterId: string;
  createdAt: number;
  updatedAt: number;
}

export interface AudioSpeakerVoiceBindingRecord {
  id: string;
  projectId: string;
  speakerKey: string;
  speakerLabel: string;
  voiceId: string;
  voiceName: string | null;
  voiceProvider: string;
  modelId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedDialogueLine extends ParsedDialogueLine {
  characterId: string | null;
  characterName: string | null;
  voiceId: string | null;
  voiceName: string | null;
  resolutionType: "character" | "speaker" | "unresolved";
  resolvedTargetLabel: string | null;
}

export interface DialogueAudioTake {
  id: string;
  takeNumber: number;
  relativePath: string;
  outputFormat: string | null;
  modelUsed: string | null;
  optimizerModel: string | null;
  optimizedPreview: string | null;
  characterCount: number | null;
  costUsd: number | null;
  requestId: string | null;
  createdAt: number;
  isMaster: boolean;
}

export interface DialogueAudioShot {
  shot: ShotRow;
  audioDirection: ParsedAudioDirection | null;
  resolvedLines: ResolvedDialogueLine[];
  blockerReason: string | null;
  isReady: boolean;
  characterCount: number;
  hasDialogueOverride: boolean;
  generationProfile: DialogueGenerationProfile;
  hasGenerationProfileOverride: boolean;
  audioTakes: DialogueAudioTake[];
}

export type DialogueOverrideLine = ParsedDialogueLine;

export interface DialogueGenerationProfile {
  useOptimizer: boolean;
  performancePreset: DialoguePerformancePreset;
  performanceNote: string | null;
}

export interface ImportTurkishVoicesResult {
  catalogCount: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: string[];
}

type DialogueResolutionContext = {
  charactersById: Map<string, CharacterRecord>;
  charactersBySpeakerKey: Map<string, CharacterRecord>;
  voiceBindingsByCharacterId: Map<string, CharacterVoiceBindingRecord>;
  aliasesBySpeakerKey: Map<string, AudioSpeakerAliasRecord>;
  speakerVoiceBindingsBySpeakerKey: Map<string, AudioSpeakerVoiceBindingRecord>;
  dialogueOptimizerReady: boolean;
};

type StoredOptimizedDialogueLine = OptimizedDialogueLine & {
  speakerKey: string;
};

type StoredDialogueAudioTake = Omit<DialogueAudioTake, "isMaster">;

const AUTO_ONSCREEN_SPEAKER_KEYS = new Set([
  "on screen character",
  "onscreen character",
  "on screen",
  "onscreen",
  "primary character",
]);

const DEFAULT_DIALOGUE_GENERATION_PROFILE: DialogueGenerationProfile = {
  useOptimizer: true,
  performancePreset: "auto",
  performanceNote: null,
};

function ensureActiveProject() {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    throw new Error("Aktif proje yok.");
  }

  return project;
}

function padSegment(value: number | null | undefined): string {
  return String(value ?? 1).padStart(2, "0");
}

function normalizeVoiceLookupValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function parseStoredAudioDirection(
  value: string | null,
  promptVideo: string | null,
): ParsedAudioDirection | null {
  if (promptVideo) {
    const parsedFromPrompt = parseAudioDirection(promptVideo);

    if (parsedFromPrompt) {
      return parsedFromPrompt;
    }
  }

  if (value) {
    try {
      const parsed = JSON.parse(value) as ParsedAudioDirection;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Fall through to prompt parsing.
    }
  }

  return null;
}

function buildDialogueCharacterCount(audioDirection: ParsedAudioDirection | null): number {
  return audioDirection?.dialogueLines.reduce((total, line) => total + line.text.length, 0) ?? 0;
}

function buildOptimizedDialoguePreview(lines: StoredOptimizedDialogueLine[]): string | null {
  if (lines.length === 0) {
    return null;
  }

  return lines
    .slice(0, 2)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join(" / ")
    .slice(0, 220);
}

function normalizeDialoguePerformancePreset(
  value: string | null | undefined,
): DialoguePerformancePreset {
  switch (value?.trim()) {
    case "command":
      return "command";
    case "threat":
      return "threat";
    case "controlled_grief":
      return "controlled_grief";
    case "oath":
      return "oath";
    case "tense":
      return "tense";
    case "conversation":
      return "conversation";
    default:
      return "auto";
  }
}

function normalizeDialogueGenerationProfile(
  value?: Partial<DialogueGenerationProfile> | null,
): DialogueGenerationProfile {
  return {
    useOptimizer: value?.useOptimizer ?? DEFAULT_DIALOGUE_GENERATION_PROFILE.useOptimizer,
    performancePreset: normalizeDialoguePerformancePreset(value?.performancePreset),
    performanceNote: value?.performanceNote?.trim() || null,
  };
}

function parseStoredDialogueGenerationProfile(
  value: string | null | undefined,
): DialogueGenerationProfile {
  if (!value) {
    return { ...DEFAULT_DIALOGUE_GENERATION_PROFILE };
  }

  try {
    const parsed = JSON.parse(value) as Partial<DialogueGenerationProfile>;
    return normalizeDialogueGenerationProfile(parsed);
  } catch {
    return { ...DEFAULT_DIALOGUE_GENERATION_PROFILE };
  }
}

function stringifyDialogueGenerationProfile(profile: DialogueGenerationProfile): string | null {
  const normalized = normalizeDialogueGenerationProfile(profile);

  if (
    normalized.useOptimizer === DEFAULT_DIALOGUE_GENERATION_PROFILE.useOptimizer &&
    normalized.performancePreset === DEFAULT_DIALOGUE_GENERATION_PROFILE.performancePreset &&
    normalized.performanceNote === DEFAULT_DIALOGUE_GENERATION_PROFILE.performanceNote
  ) {
    return null;
  }

  return JSON.stringify(normalized);
}

function hasDialogueGenerationProfileOverride(profile: DialogueGenerationProfile): boolean {
  return stringifyDialogueGenerationProfile(profile) !== null;
}

function inferOutputFormatFromRelativePath(relativePath: string | null | undefined): string | null {
  if (!relativePath) {
    return null;
  }

  const normalized = relativePath.toLowerCase();

  if (normalized.endsWith(".mp3")) {
    return ELEVENLABS_FALLBACK_OUTPUT_FORMAT;
  }

  if (normalized.endsWith(".wav")) {
    return ELEVENLABS_PREFERRED_OUTPUT_FORMAT;
  }

  return null;
}

function parseAudioTakeHistory(value: string | null | undefined): StoredDialogueAudioTake[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as {
      takes?: StoredDialogueAudioTake[];
    };

    if (!Array.isArray(parsed.takes)) {
      return [];
    }

    return parsed.takes.filter((take) => Boolean(take?.relativePath));
  } catch {
    return [];
  }
}

function createLegacyAudioTake(shot: ShotRow): StoredDialogueAudioTake | null {
  if (!shot.audioMasterPath) {
    return null;
  }

  return {
    id: `legacy-${shot.id}`,
    takeNumber: 1,
    relativePath: shot.audioMasterPath,
    outputFormat: shot.audioOutputFormat ?? inferOutputFormatFromRelativePath(shot.audioMasterPath),
    modelUsed: shot.audioModelUsed,
    optimizerModel: shot.audioOptimizerModel,
    optimizedPreview: shot.audioOptimizedDialoguePreview,
    characterCount: shot.audioCharacterCount,
    costUsd: shot.audioCostUsd,
    requestId: null,
    createdAt: shot.updatedAt || shot.createdAt,
  };
}

function sortStoredAudioTakesDescending(takes: StoredDialogueAudioTake[]): StoredDialogueAudioTake[] {
  return takes.slice().sort((left, right) => {
    if (right.takeNumber !== left.takeNumber) {
      return right.takeNumber - left.takeNumber;
    }

    return right.createdAt - left.createdAt;
  });
}

function buildStoredAudioTakesForShot(shot: ShotRow): StoredDialogueAudioTake[] {
  const storedTakes = parseAudioTakeHistory(shot.audioTakeHistoryJson);
  const deduped = new Map<string, StoredDialogueAudioTake>();

  for (const take of storedTakes) {
    deduped.set(take.relativePath, take);
  }

  if (shot.audioMasterPath && !deduped.has(shot.audioMasterPath)) {
    const legacyTake = createLegacyAudioTake(shot);

    if (legacyTake) {
      deduped.set(legacyTake.relativePath, legacyTake);
    }
  }

  return sortStoredAudioTakesDescending(Array.from(deduped.values()));
}

function buildDialogueAudioTakesForShot(shot: ShotRow): DialogueAudioTake[] {
  return buildStoredAudioTakesForShot(shot).map((take) => ({
    ...take,
    isMaster: take.relativePath === shot.audioMasterPath,
  }));
}

function stringifyAudioTakeHistory(takes: StoredDialogueAudioTake[]): string | null {
  if (takes.length === 0) {
    return null;
  }

  return JSON.stringify({
    takes: sortStoredAudioTakesDescending(takes),
  });
}

function resolveNextAudioTakeNumber(takes: StoredDialogueAudioTake[]): number {
  const maxTakeNumber = takes.reduce(
    (currentMax, take) => Math.max(currentMax, take.takeNumber || 0),
    0,
  );

  return maxTakeNumber + 1;
}

function buildDialogueOptimizationSourceHashForShot(
  shot: Pick<
    ShotRow,
    | "shotNumber"
    | "durationS"
    | "summaryTr"
    | "promptVideo"
    | "audioContentHash"
    | "audioGenerationProfileJson"
  >,
  audioDirection: ParsedAudioDirection | null,
): string | null {
  const effectiveAudioContentHash = createAudioContentHash(audioDirection) ?? shot.audioContentHash;
  const generationProfile = parseStoredDialogueGenerationProfile(shot.audioGenerationProfileJson);

  return createDialogueOptimizationSourceHash({
    shotNumber: shot.shotNumber,
    durationS: shot.durationS,
    summaryTr: shot.summaryTr,
    promptVideo: shot.promptVideo,
    dialogueTranscript: audioDirection?.dialogueTranscript ?? null,
    audioContentHash: effectiveAudioContentHash,
    useOptimizer: generationProfile.useOptimizer,
    performancePreset: generationProfile.performancePreset,
    performanceNote: generationProfile.performanceNote,
  });
}

function parseStoredDialogueOverrideLines(
  value: string | null | undefined,
): ParsedDialogueLine[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      lines?: Array<{
        speaker?: string;
        speakerKey?: string;
        text?: string;
      }>;
    };

    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return null;
    }

    const lines = parsed.lines
      .map((line) => ({
        speaker: line.speaker?.trim() ?? "",
        speakerKey: normalizeAudioSpeakerKey(line.speakerKey ?? line.speaker ?? ""),
        text: line.text?.trim() ?? "",
      }))
      .filter((line) => line.speaker && line.speakerKey && line.text);

    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

function buildEffectiveAudioDirection(shot: Pick<ShotRow, "audioDialogueOverrideJson">, audioDirection: ParsedAudioDirection | null): ParsedAudioDirection | null {
  return applyDialogueLineOverride(
    audioDirection,
    parseStoredDialogueOverrideLines(shot.audioDialogueOverrideJson),
  );
}

function buildPerformancePromptNote(note: string | null | undefined): string | null {
  const normalized = note?.trim().replace(/\s+/g, " ") ?? "";
  return normalized ? normalized.slice(0, 120) : null;
}

function stringifyDialogueOverrideLines(lines: ParsedDialogueLine[]): string | null {
  if (lines.length === 0) {
    return null;
  }

  return JSON.stringify({ lines });
}

function normalizeDialogueOverrideLines(
  lines: DialogueOverrideLine[],
): DialogueOverrideLine[] {
  return lines
    .map((line) => ({
      speaker: line.speaker.trim(),
      speakerKey: normalizeAudioSpeakerKey(line.speakerKey || line.speaker),
      text: line.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((line) => line.speaker && line.speakerKey && line.text);
}

function validateDialogueOverrideLines(
  baseLines: ParsedDialogueLine[],
  overrideLines: DialogueOverrideLine[],
): void {
  if (baseLines.length === 0) {
    throw new Error("Bu shot icin duzenlenebilir speaker-tagged dialog bulunmuyor.");
  }

  if (overrideLines.length !== baseLines.length) {
    throw new Error("Duzenlenen satir sayisi orijinal transcript ile ayni olmali.");
  }

  for (let index = 0; index < baseLines.length; index += 1) {
    const baseLine = baseLines[index];
    const overrideLine = overrideLines[index];

    if (
      baseLine.speakerKey !== overrideLine.speakerKey ||
      baseLine.speaker.trim().toLowerCase() !== overrideLine.speaker.trim().toLowerCase()
    ) {
      throw new Error("Speaker sirasi ve speaker etiketleri degistirilemez.");
    }
  }
}

function dialogueOverrideMatchesBase(
  baseLines: ParsedDialogueLine[],
  overrideLines: DialogueOverrideLine[],
): boolean {
  if (baseLines.length !== overrideLines.length) {
    return false;
  }

  return baseLines.every((line, index) => {
    const overrideLine = overrideLines[index];
    return (
      line.speakerKey === overrideLine.speakerKey &&
      line.speaker.trim().toLowerCase() === overrideLine.speaker.trim().toLowerCase() &&
      line.text.trim() === overrideLine.text.trim()
    );
  });
}

function parseStoredOptimizedDialogueLines(
  value: string | null,
): StoredOptimizedDialogueLine[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      lines?: Array<{
        speaker?: string;
        speakerKey?: string;
        text?: string;
        delivery?: string | null;
      }>;
    };
    const lines = parsed.lines ?? [];

    if (!Array.isArray(lines) || lines.length === 0) {
      return null;
    }

    return lines
      .map((line) => ({
        speaker: line.speaker?.trim() ?? "",
        speakerKey: line.speakerKey?.trim() ?? normalizeAudioSpeakerKey(line.speaker ?? ""),
        text: line.text?.trim() ?? "",
        delivery: line.delivery?.trim() || null,
      }))
      .filter((line) => line.speaker && line.speakerKey && line.text);
  } catch {
    return null;
  }
}

function validateStoredOptimizedDialogueLines(
  lines: StoredOptimizedDialogueLine[] | null,
  resolvedLines: ResolvedDialogueLine[],
): lines is StoredOptimizedDialogueLine[] {
  if (!lines || lines.length !== resolvedLines.length) {
    return false;
  }

  return lines.every((line, index) => {
    const sourceLine = resolvedLines[index];
    return (
      line.speakerKey === sourceLine.speakerKey &&
      line.speaker.toLowerCase() === sourceLine.speaker.toLowerCase() &&
      Boolean(line.text.trim())
    );
  });
}

function buildEmotionPromptedDialogueText(
  text: string,
  delivery: string | null,
  performanceNote?: string | null,
): string {
  const trimmedText = text.trim();
  const trimmedDelivery = delivery?.trim();
  const trimmedPerformanceNote = buildPerformancePromptNote(performanceNote);

  if (!trimmedText) {
    return "";
  }

  if (!trimmedDelivery && !trimmedPerformanceNote) {
    return trimmedText;
  }

  const promptTags = [trimmedDelivery, trimmedPerformanceNote].filter(Boolean).join("; ");

  return `[${promptTags}] ${trimmedText}`;
}

function mapCharacterVoiceBinding(row: CharacterVoiceBindingRow): CharacterVoiceBindingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    characterId: row.character_id,
    voiceId: row.voice_id,
    voiceName: row.voice_name ?? null,
    voiceProvider: row.voice_provider,
    modelId: row.model_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSpeakerAlias(row: AudioSpeakerAliasRow): AudioSpeakerAliasRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    speakerKey: row.speaker_key,
    speakerLabel: row.speaker_label,
    characterId: row.character_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSpeakerVoiceBinding(
  row: AudioSpeakerVoiceBindingRow,
): AudioSpeakerVoiceBindingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    speakerKey: row.speaker_key,
    speakerLabel: row.speaker_label,
    voiceId: row.voice_id,
    voiceName: row.voice_name ?? null,
    voiceProvider: row.voice_provider,
    modelId: row.model_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listCharacterVoiceBindingRows(
  projectId: string,
): Promise<CharacterVoiceBindingRecord[]> {
  const db = await getProjectDb();
  const rows = await db.select<CharacterVoiceBindingRow[]>(
    `SELECT *
     FROM character_voice_bindings
     WHERE project_id = $1
     ORDER BY updated_at DESC`,
    [projectId],
  );
  return rows.map(mapCharacterVoiceBinding);
}

async function listAudioSpeakerAliasRows(
  projectId: string,
): Promise<AudioSpeakerAliasRecord[]> {
  const db = await getProjectDb();
  const rows = await db.select<AudioSpeakerAliasRow[]>(
    `SELECT *
     FROM audio_speaker_aliases
     WHERE project_id = $1
     ORDER BY updated_at DESC`,
    [projectId],
  );
  return rows.map(mapSpeakerAlias);
}

async function listAudioSpeakerVoiceBindingRows(
  projectId: string,
): Promise<AudioSpeakerVoiceBindingRecord[]> {
  const db = await getProjectDb();
  const rows = await db.select<AudioSpeakerVoiceBindingRow[]>(
    `SELECT *
     FROM audio_speaker_voice_bindings
     WHERE project_id = $1
     ORDER BY updated_at DESC`,
    [projectId],
  );
  return rows.map(mapSpeakerVoiceBinding);
}

async function buildDialogueResolutionContext(
  projectId: string,
): Promise<DialogueResolutionContext> {
  const [characters, voiceBindings, speakerAliases, speakerVoiceBindings, openRouterKey] = await Promise.all([
    listCharacters(),
    listCharacterVoiceBindingRows(projectId),
    listAudioSpeakerAliasRows(projectId),
    listAudioSpeakerVoiceBindingRows(projectId),
    getApiKey("OPENROUTER_API_KEY"),
  ]);

  const projectCharacters = characters.filter((character) => character.projectId === projectId);
  const charactersById = new Map(projectCharacters.map((character) => [character.id, character] as const));
  const charactersBySpeakerKey = new Map(
    projectCharacters.map((character) => [normalizeAudioSpeakerKey(character.name), character] as const),
  );
  const voiceBindingsByCharacterId = new Map(
    voiceBindings.map((binding) => [binding.characterId, binding] as const),
  );
  const aliasesBySpeakerKey = new Map(
    speakerAliases.map((alias) => [alias.speakerKey, alias] as const),
  );
  const speakerVoiceBindingsBySpeakerKey = new Map(
    speakerVoiceBindings.map((binding) => [binding.speakerKey, binding] as const),
  );

  return {
    charactersById,
    charactersBySpeakerKey,
    voiceBindingsByCharacterId,
    aliasesBySpeakerKey,
    speakerVoiceBindingsBySpeakerKey,
    dialogueOptimizerReady: Boolean(openRouterKey?.trim()),
  };
}

function resolveDialogueLines(
  audioDirection: ParsedAudioDirection | null,
  context: DialogueResolutionContext,
  shot: ShotRow,
): ResolvedDialogueLine[] {
  if (!audioDirection?.speakerTagged) {
    return [];
  }

  return audioDirection.dialogueLines.map((line) => {
    const alias = context.aliasesBySpeakerKey.get(line.speakerKey);
    const aliasedCharacter = alias
      ? context.charactersById.get(alias.characterId) ?? null
      : null;
    const exactCharacter = context.charactersBySpeakerKey.get(line.speakerKey) ?? null;
    const shotCharacter =
      shot.characterId && AUTO_ONSCREEN_SPEAKER_KEYS.has(line.speakerKey)
        ? context.charactersById.get(shot.characterId) ?? null
        : null;
    const character = aliasedCharacter ?? exactCharacter ?? shotCharacter;
    const characterVoiceBinding = character
      ? context.voiceBindingsByCharacterId.get(character.id) ?? null
      : null;
    const speakerVoiceBinding =
      context.speakerVoiceBindingsBySpeakerKey.get(line.speakerKey) ?? null;
    const voiceId = characterVoiceBinding?.voiceId ?? speakerVoiceBinding?.voiceId ?? null;
    const voiceName =
      characterVoiceBinding?.voiceName ?? speakerVoiceBinding?.voiceName ?? null;
    const resolutionType = character
      ? "character"
      : speakerVoiceBinding
        ? "speaker"
        : "unresolved";
    const resolvedTargetLabel = character?.name ?? speakerVoiceBinding?.speakerLabel ?? null;

    return {
      ...line,
      characterId: character?.id ?? null,
      characterName: character?.name ?? null,
      voiceId,
      voiceName,
      resolutionType,
      resolvedTargetLabel,
    };
  });
}

function getDialogueBlockerReason(
  audioDirection: ParsedAudioDirection | null,
  resolvedLines: ResolvedDialogueLine[],
  dialogueOptimizerReady: boolean,
  useOptimizer: boolean,
): string | null {
  if (!audioDirection?.dialogueTranscript) {
    return null;
  }

  if (!audioDirection.speakerTagged || audioDirection.dialogueLines.length === 0) {
    return "Transcript speaker-tagged degil. Her satir `Konusmaci: replik` formatinda olmali.";
  }

  const unresolvedSpeakers = Array.from(
    new Set(
      resolvedLines
        .filter((line) => !line.characterId && !line.voiceId)
        .map((line) => line.speaker),
    ),
  );

  if (unresolvedSpeakers.length > 0) {
    return `Speaker routing eksik: ${unresolvedSpeakers.join(", ")}. Karaktere bagla veya direkt voice sec.`;
  }

  const missingVoiceBindings = Array.from(
    new Set(
      resolvedLines
        .filter((line) => line.characterId && !line.voiceId)
        .map((line) => line.characterName ?? line.speaker),
    ),
  );

  if (missingVoiceBindings.length > 0) {
    return `Voice binding eksik: ${missingVoiceBindings.join(", ")}.`;
  }

  if (useOptimizer && !dialogueOptimizerReady) {
    return "OpenRouter API key gerekli. Dialog optimizasyon ara katmani zorunlu.";
  }

  const characterCount = buildDialogueCharacterCount(audioDirection);

  if (characterCount > ELEVENLABS_MAX_DIALOGUE_CHARS) {
    return `Dialogue ${characterCount} karakter. Eleven v3 limiti ${ELEVENLABS_MAX_DIALOGUE_CHARS}.`;
  }

  return null;
}

function buildDesiredShotAudioStatus(
  shot: ShotRow,
  blockerReason: string | null,
  audioDirection: ParsedAudioDirection | null,
): AudioShotStatus {
  if (!audioDirection?.dialogueTranscript) {
    return "none";
  }

  if (blockerReason) {
    return "blocked";
  }

  if (shot.audioStatus === "queued" || shot.audioStatus === "generating") {
    return shot.audioStatus;
  }

  if (shot.audioStatus === "done" && shot.audioMasterPath) {
    return "done";
  }

  if (shot.audioStatus === "error") {
    return "error";
  }

  return resolveAudioShotStatus(audioDirection) === "blocked" ? "blocked" : "pending";
}

async function tryRemoveAudioMaster(
  projectFolderPath: string,
  relativePath: string | null | undefined,
): Promise<void> {
  if (!relativePath) {
    return;
  }

  try {
    const absolutePath = await join(
      projectFolderPath,
      ...relativePath.split(/[\\/]+/).filter(Boolean),
    );

    if (await exists(absolutePath)) {
      await remove(absolutePath);
    }
  } catch (error) {
    console.warn("Failed to remove audio master.", { projectFolderPath, relativePath, error });
  }
}

async function tryRemoveAudioTakeFiles(
  projectFolderPath: string,
  takes: Array<Pick<StoredDialogueAudioTake, "relativePath">>,
): Promise<void> {
  for (const take of takes) {
    await tryRemoveAudioMaster(projectFolderPath, take.relativePath);
  }
}

function buildLegacyMalformedAudioPath(relativePath: string): string | null {
  const match = relativePath.match(/(\.[^./\\]+)$/);

  if (!match?.[1]) {
    return null;
  }

  return `${relativePath.slice(0, -match[1].length)}..${match[1].slice(1)}`;
}

async function repairLegacyAudioMasterPath(
  projectFolderPath: string,
  relativePath: string | null | undefined,
): Promise<string | null> {
  if (!relativePath) {
    return null;
  }

  const expectedAbsolutePath = await join(
    projectFolderPath,
    ...relativePath.split(/[\\/]+/).filter(Boolean),
  );

  if (await exists(expectedAbsolutePath)) {
    return relativePath;
  }

  const malformedRelativePath = buildLegacyMalformedAudioPath(relativePath);

  if (!malformedRelativePath) {
    return null;
  }

  const malformedAbsolutePath = await join(
    projectFolderPath,
    ...malformedRelativePath.split(/[\\/]+/).filter(Boolean),
  );

  if (!(await exists(malformedAbsolutePath))) {
    return null;
  }

  try {
    await rename(malformedAbsolutePath, expectedAbsolutePath);
    return relativePath;
  } catch (error) {
    console.warn("Failed to repair malformed audio master path.", {
      projectFolderPath,
      relativePath,
      malformedRelativePath,
      error,
    });
    return malformedRelativePath;
  }
}

async function reconcileShotAudioState(
  projectFolderPath: string,
  detail: DialogueAudioShot,
  options?: { forceInvalidateMaster?: boolean },
): Promise<void> {
  const baseAudioDirection = parseStoredAudioDirection(
    detail.shot.audioDirectionJson,
    detail.shot.promptVideo,
  );
  const expectedAudioContentHash = createAudioContentHash(detail.audioDirection);
  const expectedOptimizerSourceHash = buildDialogueOptimizationSourceHashForShot(
    detail.shot,
    detail.audioDirection,
  );
  const audioHashesChanged =
    detail.shot.audioContentHash !== expectedAudioContentHash ||
    detail.shot.audioOptimizerSourceHash !== expectedOptimizerSourceHash;
  const desiredStatus = buildDesiredShotAudioStatus(
    detail.shot,
    detail.blockerReason,
    detail.audioDirection,
  );
  const shouldInvalidateMaster =
    Boolean(detail.shot.audioMasterPath) &&
    (options?.forceInvalidateMaster ||
      audioHashesChanged ||
      desiredStatus !== "done" ||
      !detail.isReady);
  const shouldClearOptimizerCache = options?.forceInvalidateMaster || audioHashesChanged;
  const storedAudioTakes = buildStoredAudioTakesForShot(detail.shot);

  if (shouldInvalidateMaster) {
    await tryRemoveAudioMaster(projectFolderPath, detail.shot.audioMasterPath);
  }

  if (audioHashesChanged && storedAudioTakes.length > 0) {
    await tryRemoveAudioTakeFiles(projectFolderPath, storedAudioTakes);
  }

  await updateShotAudioFields(detail.shot.id, {
    audioDirectionJson: baseAudioDirection ? JSON.stringify(baseAudioDirection) : null,
    audioDialoguePreview: detail.audioDirection?.dialoguePreview ?? null,
    audioStatus: desiredStatus,
    audioMasterPath: shouldInvalidateMaster ? null : detail.shot.audioMasterPath,
    audioModelUsed: shouldInvalidateMaster ? null : detail.shot.audioModelUsed,
    audioOutputFormat: shouldInvalidateMaster ? null : detail.shot.audioOutputFormat,
    audioCharacterCount: shouldInvalidateMaster ? null : detail.shot.audioCharacterCount,
    audioCostUsd: shouldInvalidateMaster ? null : detail.shot.audioCostUsd,
    audioTimestampsJson: shouldInvalidateMaster ? null : detail.shot.audioTimestampsJson,
    audioContentHash: expectedAudioContentHash,
    audioError: detail.blockerReason,
    audioOptimizedDialogueJson: shouldClearOptimizerCache ? null : detail.shot.audioOptimizedDialogueJson,
    audioOptimizedDialoguePreview: shouldClearOptimizerCache ? null : detail.shot.audioOptimizedDialoguePreview,
    audioOptimizerModel: shouldClearOptimizerCache ? null : detail.shot.audioOptimizerModel,
    audioOptimizerSourceHash: expectedOptimizerSourceHash,
    audioTakeHistoryJson: audioHashesChanged ? null : stringifyAudioTakeHistory(storedAudioTakes),
  });
}

function resolveAudioFileExtension(outputFormat: string): string {
  if (outputFormat.startsWith("mp3_")) {
    return "mp3";
  }

  return "wav";
}

function resolveDialogueAudioOutputRelativePath(
  shot: ShotRow,
  outputFormat: string,
  takeNumber: number,
): string {
  const extension = resolveAudioFileExtension(outputFormat);
  return [
    "audio",
    "dialogue",
    `act-${padSegment(shot.act)}`,
    `scene-${padSegment(shot.scene)}`,
    `${shot.shotNumber.toLowerCase()}_dialogue_take_${String(takeNumber).padStart(2, "0")}.${extension}`,
  ].join("/");
}

async function buildDialogueShotDetail(
  shot: ShotRow,
  context: DialogueResolutionContext,
  projectFolderPath: string,
): Promise<DialogueAudioShot> {
  const repairedAudioMasterPath = await repairLegacyAudioMasterPath(
    projectFolderPath,
    shot.audioMasterPath,
  );
  const normalizedShot =
    repairedAudioMasterPath && repairedAudioMasterPath !== shot.audioMasterPath
      ? {
          ...shot,
          audioMasterPath: repairedAudioMasterPath,
        }
      : shot;
  const generationProfile = parseStoredDialogueGenerationProfile(
    normalizedShot.audioGenerationProfileJson,
  );
  const baseAudioDirection = parseStoredAudioDirection(shot.audioDirectionJson, shot.promptVideo);
  const audioDirection = buildEffectiveAudioDirection(normalizedShot, baseAudioDirection);
  const resolvedLines = resolveDialogueLines(audioDirection, context, normalizedShot);
  const blockerReason = getDialogueBlockerReason(
    audioDirection,
    resolvedLines,
    context.dialogueOptimizerReady,
    generationProfile.useOptimizer,
  );
  const audioTakes = buildDialogueAudioTakesForShot(normalizedShot);

  return {
    shot: normalizedShot,
    audioDirection,
    resolvedLines,
    blockerReason,
    isReady: Boolean(audioDirection?.dialogueTranscript) && !blockerReason,
    characterCount: buildDialogueCharacterCount(audioDirection),
    hasDialogueOverride: Boolean(normalizedShot.audioDialogueOverrideJson),
    generationProfile,
    hasGenerationProfileOverride: hasDialogueGenerationProfileOverride(generationProfile),
    audioTakes,
  };
}

async function ensureOptimizedDialogueLines(params: {
  shot: ShotRow;
  detail: DialogueAudioShot;
  jobId?: string;
}): Promise<{ lines: StoredOptimizedDialogueLine[]; model: string | null }> {
  const expectedSourceHash = buildDialogueOptimizationSourceHashForShot(
    params.shot,
    params.detail.audioDirection,
  );
  const cachedLines = parseStoredOptimizedDialogueLines(params.shot.audioOptimizedDialogueJson);

  if (
    expectedSourceHash &&
    params.shot.audioOptimizerSourceHash === expectedSourceHash &&
    validateStoredOptimizedDialogueLines(cachedLines, params.detail.resolvedLines)
  ) {
    return {
      lines: cachedLines,
      model: params.shot.audioOptimizerModel,
    };
  }

  if (!params.detail.generationProfile.useOptimizer) {
    const passthroughLines: StoredOptimizedDialogueLine[] = params.detail.resolvedLines.map((line) => {
      const performanceProfile = resolveDialoguePerformanceProfile({
        sourceText: line.text,
        summaryTr: params.shot.summaryTr,
        promptVideo: params.shot.promptVideo,
        preset: params.detail.generationProfile.performancePreset,
        note: params.detail.generationProfile.performanceNote,
      });

      return {
        speaker: line.speaker,
        speakerKey: line.speakerKey,
        text: line.text,
        delivery: performanceProfile.baselineCue,
      };
    });

    await updateShotAudioFields(params.shot.id, {
      audioOptimizedDialogueJson: JSON.stringify({ lines: passthroughLines }),
      audioOptimizedDialoguePreview: buildOptimizedDialoguePreview(passthroughLines),
      audioOptimizerModel: null,
      audioOptimizerSourceHash: expectedSourceHash,
    });

    return {
      lines: passthroughLines,
      model: null,
    };
  }

  const optimizationResult = await optimizeDialogueForSpeech({
    shotNumber: params.shot.shotNumber,
    durationS: params.shot.durationS,
    summaryTr: params.shot.summaryTr,
    promptVideo: params.shot.promptVideo,
    performancePreset: params.detail.generationProfile.performancePreset,
    performanceNote: params.detail.generationProfile.performanceNote,
    lines: params.detail.resolvedLines.map((line) => ({
      speaker: line.speaker,
      text: line.text,
    })),
  });
  const optimizedLines: StoredOptimizedDialogueLine[] = optimizationResult.optimizedLines.map(
    (line, index) => ({
      ...line,
      speakerKey: params.detail.resolvedLines[index]?.speakerKey ?? normalizeAudioSpeakerKey(line.speaker),
    }),
  );

  await updateShotAudioFields(params.shot.id, {
    audioOptimizedDialogueJson: JSON.stringify({ lines: optimizedLines }),
    audioOptimizedDialoguePreview: buildOptimizedDialoguePreview(optimizedLines),
    audioOptimizerModel: optimizationResult.model,
    audioOptimizerSourceHash: expectedSourceHash,
  });

  return {
    lines: optimizedLines,
    model: optimizationResult.model,
  };
}

export async function listElevenLabsVoices(): Promise<ElevenLabsVoice[]> {
  return listVoices();
}

export async function listRecommendedTurkishVoices(): Promise<ElevenLabsSharedVoice[]> {
  return listRecommendedTurkishSharedVoices();
}

export async function listRecommendedTurkishVoicesPage(params?: {
  page?: number;
  pageSize?: number;
}): Promise<ElevenLabsSharedVoicesPageResult> {
  return listRecommendedTurkishSharedVoicesPage(params);
}

export async function importSharedElevenLabsVoice(params: {
  publicOwnerId: string;
  voiceId: string;
  newName?: string;
}): Promise<void> {
  await addSharedVoiceToMyVoices(params);
}

export async function importAllTurkishElevenLabsVoices(params?: {
  onProgress?: (state: { completed: number; total: number; voiceName: string }) => void;
}): Promise<ImportTurkishVoicesResult> {
  const [catalogVoices, existingVoices] = await Promise.all([
    listRecommendedTurkishSharedVoices(),
    listVoices(),
  ]);
  const existingVoiceIds = new Set(existingVoices.map((voice) => voice.voiceId));
  const existingVoiceNames = new Set(
    existingVoices.map((voice) => normalizeVoiceLookupValue(voice.name)),
  );
  const importCandidates = catalogVoices.filter((voice) => {
    if (existingVoiceIds.has(voice.voiceId)) {
      return false;
    }

    const normalizedName = normalizeVoiceLookupValue(voice.name);
    return !normalizedName || !existingVoiceNames.has(normalizedName);
  });
  const failures: string[] = [];
  let importedCount = 0;

  for (let index = 0; index < importCandidates.length; index += 1) {
    const voice = importCandidates[index];

    try {
      await addSharedVoiceToMyVoices({
        publicOwnerId: voice.publicOwnerId,
        voiceId: voice.voiceId,
        newName: voice.name,
      });
      importedCount += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Bilinmeyen hata";
      failures.push(`${voice.name}: ${reason}`);
    } finally {
      params?.onProgress?.({
        completed: index + 1,
        total: importCandidates.length,
        voiceName: voice.name,
      });
    }
  }

  return {
    catalogCount: catalogVoices.length,
    importedCount,
    skippedCount: catalogVoices.length - importCandidates.length,
    failedCount: failures.length,
    failures,
  };
}

export async function listCharacterVoiceBindings(): Promise<CharacterVoiceBindingRecord[]> {
  const project = ensureActiveProject();
  return listCharacterVoiceBindingRows(project.id);
}

export async function listAudioSpeakerAliases(): Promise<AudioSpeakerAliasRecord[]> {
  const project = ensureActiveProject();
  return listAudioSpeakerAliasRows(project.id);
}

export async function listAudioSpeakerVoiceBindings(): Promise<AudioSpeakerVoiceBindingRecord[]> {
  const project = ensureActiveProject();
  return listAudioSpeakerVoiceBindingRows(project.id);
}

export async function listDialogueAudioShots(
  projectId?: string,
): Promise<DialogueAudioShot[]> {
  const project = ensureActiveProject();
  const scopedProjectId = projectId ?? project.id;
  const [shots, context] = await Promise.all([
    getShots(scopedProjectId),
    buildDialogueResolutionContext(scopedProjectId),
  ]);

  const details = await Promise.all(
    shots.map((shot) => buildDialogueShotDetail(shot, context, project.folderPath)),
  );

  return details.filter((detail) => Boolean(detail.audioDirection?.dialogueTranscript));
}

export async function getDialogueAudioShotById(
  shotId: string,
): Promise<DialogueAudioShot | null> {
  const project = ensureActiveProject();
  const shot = await getShotById(shotId);

  if (!shot) {
    return null;
  }

  const context = await buildDialogueResolutionContext(project.id);
  const detail = await buildDialogueShotDetail(shot, context, project.folderPath);
  return detail.audioDirection?.dialogueTranscript ? detail : null;
}

export async function saveDialogueTextOverride(params: {
  shotId: string;
  lines: DialogueOverrideLine[];
}): Promise<void> {
  const project = ensureActiveProject();
  const shot = await getShotById(params.shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const baseAudioDirection = parseStoredAudioDirection(shot.audioDirectionJson, shot.promptVideo);

  if (!baseAudioDirection?.speakerTagged || baseAudioDirection.dialogueLines.length === 0) {
    throw new Error("Bu shot icin duzenlenebilir speaker-tagged transcript yok.");
  }

  const normalizedLines = normalizeDialogueOverrideLines(params.lines);
  validateDialogueOverrideLines(baseAudioDirection.dialogueLines, normalizedLines);

  if (dialogueOverrideMatchesBase(baseAudioDirection.dialogueLines, normalizedLines)) {
    await clearDialogueTextOverride(params.shotId);
    return;
  }

  const overrideJson = stringifyDialogueOverrideLines(normalizedLines);
  const effectiveAudioDirection = applyDialogueLineOverride(baseAudioDirection, normalizedLines);

  await updateShotAudioFields(params.shotId, {
    audioDialogueOverrideJson: overrideJson,
    audioDialoguePreview: effectiveAudioDirection?.dialoguePreview ?? shot.audioDialoguePreview,
  });

  const refreshedShot = await getShotById(params.shotId);

  if (!refreshedShot) {
    return;
  }

  const context = await buildDialogueResolutionContext(project.id);
  const detail = await buildDialogueShotDetail(refreshedShot, context, project.folderPath);
  await reconcileShotAudioState(project.folderPath, detail);
}

export async function clearDialogueTextOverride(shotId: string): Promise<void> {
  const project = ensureActiveProject();
  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const baseAudioDirection = parseStoredAudioDirection(shot.audioDirectionJson, shot.promptVideo);

  await updateShotAudioFields(shotId, {
    audioDialogueOverrideJson: null,
    audioDialoguePreview: baseAudioDirection?.dialoguePreview ?? shot.audioDialoguePreview,
  });

  const refreshedShot = await getShotById(shotId);

  if (!refreshedShot) {
    return;
  }

  const context = await buildDialogueResolutionContext(project.id);
  const detail = await buildDialogueShotDetail(refreshedShot, context, project.folderPath);
  await reconcileShotAudioState(project.folderPath, detail);
}

export async function saveDialogueGenerationProfile(
  shotId: string,
  profile: DialogueGenerationProfile,
): Promise<void> {
  const project = ensureActiveProject();
  const shot = await getShotById(shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const normalizedProfile = normalizeDialogueGenerationProfile(profile);

  await updateShotAudioFields(shotId, {
    audioGenerationProfileJson: stringifyDialogueGenerationProfile(normalizedProfile),
  });

  const refreshedShot = await getShotById(shotId);

  if (!refreshedShot) {
    return;
  }

  const context = await buildDialogueResolutionContext(project.id);
  const detail = await buildDialogueShotDetail(refreshedShot, context, project.folderPath);
  await reconcileShotAudioState(project.folderPath, detail);
}

export async function clearDialogueGenerationProfile(shotId: string): Promise<void> {
  await saveDialogueGenerationProfile(shotId, DEFAULT_DIALOGUE_GENERATION_PROFILE);
}

export async function reconcileProjectAudioState(projectId?: string): Promise<void> {
  const project = ensureActiveProject();
  const details = await listDialogueAudioShots(projectId ?? project.id);

  for (const detail of details) {
    await reconcileShotAudioState(project.folderPath, detail);
  }
}

export async function setCharacterVoiceBinding(
  characterId: string,
  voiceId: string,
  voiceName: string,
): Promise<void> {
  const project = ensureActiveProject();
  const db = await getProjectDb();
  const timestamp = Date.now();

  await db.execute(
    `INSERT INTO character_voice_bindings (
      id, project_id, character_id, voice_id, voice_name, voice_provider, model_id, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    )
    ON CONFLICT(project_id, character_id) DO UPDATE SET
      voice_id = excluded.voice_id,
      voice_name = excluded.voice_name,
      voice_provider = excluded.voice_provider,
      model_id = excluded.model_id,
      updated_at = excluded.updated_at`,
    [
      uuidv4(),
      project.id,
      characterId,
      voiceId.trim(),
      voiceName.trim() || null,
      "elevenlabs",
      ELEVENLABS_DIALOGUE_MODEL_ID,
      timestamp,
      timestamp,
    ],
  );

  await syncProjectDbMirror();

  const details = await listDialogueAudioShots(project.id);
  const affectedShots = details.filter((detail) =>
    detail.resolvedLines.some((line) => line.characterId === characterId),
  );

  for (const detail of affectedShots) {
    await reconcileShotAudioState(project.folderPath, detail, { forceInvalidateMaster: true });
  }
}

export async function clearCharacterVoiceBinding(characterId: string): Promise<void> {
  const project = ensureActiveProject();
  const db = await getProjectDb();

  await db.execute(
    `DELETE FROM character_voice_bindings
     WHERE project_id = $1
       AND character_id = $2`,
    [project.id, characterId],
  );
  await syncProjectDbMirror();

  const details = await listDialogueAudioShots(project.id);
  const affectedShots = details.filter((detail) =>
    detail.resolvedLines.some((line) => line.characterId === characterId),
  );

  for (const detail of affectedShots) {
    await reconcileShotAudioState(project.folderPath, detail, { forceInvalidateMaster: true });
  }
}

export async function setAudioSpeakerAlias(
  speakerLabel: string,
  characterId: string,
): Promise<void> {
  const project = ensureActiveProject();
  const db = await getProjectDb();
  const speakerKey = normalizeAudioSpeakerKey(speakerLabel);
  const timestamp = Date.now();

  if (!speakerKey) {
    throw new Error("Speaker label bos olamaz.");
  }

  await db.execute(
    `INSERT INTO audio_speaker_aliases (
      id, project_id, speaker_key, speaker_label, character_id, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7
    )
    ON CONFLICT(project_id, speaker_key) DO UPDATE SET
      speaker_label = excluded.speaker_label,
      character_id = excluded.character_id,
      updated_at = excluded.updated_at`,
    [
      uuidv4(),
      project.id,
      speakerKey,
      speakerLabel.trim(),
      characterId,
      timestamp,
      timestamp,
    ],
  );
  await syncProjectDbMirror();

  const details = await listDialogueAudioShots(project.id);
  const affectedShots = details.filter((detail) =>
    detail.audioDirection?.dialogueLines.some((line) => line.speakerKey === speakerKey),
  );

  for (const detail of affectedShots) {
    await reconcileShotAudioState(project.folderPath, detail, { forceInvalidateMaster: true });
  }
}

export async function clearAudioSpeakerAlias(speakerKey: string): Promise<void> {
  const project = ensureActiveProject();
  const db = await getProjectDb();
  const normalizedSpeakerKey = normalizeAudioSpeakerKey(speakerKey);

  await db.execute(
    `DELETE FROM audio_speaker_aliases
     WHERE project_id = $1
       AND speaker_key = $2`,
    [project.id, normalizedSpeakerKey],
  );
  await syncProjectDbMirror();

  const details = await listDialogueAudioShots(project.id);
  const affectedShots = details.filter((detail) =>
    detail.audioDirection?.dialogueLines.some((line) => line.speakerKey === normalizedSpeakerKey),
  );

  for (const detail of affectedShots) {
    await reconcileShotAudioState(project.folderPath, detail, { forceInvalidateMaster: true });
  }
}

export async function setAudioSpeakerVoiceBinding(
  speakerLabel: string,
  voiceId: string,
  voiceName: string,
): Promise<void> {
  const project = ensureActiveProject();
  const db = await getProjectDb();
  const speakerKey = normalizeAudioSpeakerKey(speakerLabel);
  const timestamp = Date.now();

  if (!speakerKey) {
    throw new Error("Speaker label bos olamaz.");
  }

  await db.execute(
    `INSERT INTO audio_speaker_voice_bindings (
      id, project_id, speaker_key, speaker_label, voice_id, voice_name, voice_provider, model_id, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
    )
    ON CONFLICT(project_id, speaker_key) DO UPDATE SET
      speaker_label = excluded.speaker_label,
      voice_id = excluded.voice_id,
      voice_name = excluded.voice_name,
      voice_provider = excluded.voice_provider,
      model_id = excluded.model_id,
      updated_at = excluded.updated_at`,
    [
      uuidv4(),
      project.id,
      speakerKey,
      speakerLabel.trim(),
      voiceId.trim(),
      voiceName.trim() || null,
      "elevenlabs",
      ELEVENLABS_DIALOGUE_MODEL_ID,
      timestamp,
      timestamp,
    ],
  );
  await syncProjectDbMirror();

  const details = await listDialogueAudioShots(project.id);
  const affectedShots = details.filter((detail) =>
    detail.audioDirection?.dialogueLines.some((line) => line.speakerKey === speakerKey),
  );

  for (const detail of affectedShots) {
    await reconcileShotAudioState(project.folderPath, detail, { forceInvalidateMaster: true });
  }
}

export async function clearAudioSpeakerVoiceBinding(speakerKey: string): Promise<void> {
  const project = ensureActiveProject();
  const db = await getProjectDb();
  const normalizedSpeakerKey = normalizeAudioSpeakerKey(speakerKey);

  await db.execute(
    `DELETE FROM audio_speaker_voice_bindings
     WHERE project_id = $1
       AND speaker_key = $2`,
    [project.id, normalizedSpeakerKey],
  );
  await syncProjectDbMirror();

  const details = await listDialogueAudioShots(project.id);
  const affectedShots = details.filter((detail) =>
    detail.audioDirection?.dialogueLines.some((line) => line.speakerKey === normalizedSpeakerKey),
  );

  for (const detail of affectedShots) {
    await reconcileShotAudioState(project.folderPath, detail, { forceInvalidateMaster: true });
  }
}

export async function generateShotDialogueAudio(params: {
  shotId: string;
  jobId?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<{
  outputPath: string;
  relativePath: string;
  costUsd: number;
  characterCount: number;
}> {
  const project = ensureActiveProject();
  const shot = await getShotById(params.shotId);

  if (!shot) {
    throw new Error("Shot bulunamadi.");
  }

  const context = await buildDialogueResolutionContext(project.id);
  const detail = await buildDialogueShotDetail(shot, context, project.folderPath);

  if (!detail.audioDirection?.dialogueTranscript) {
    await updateShotAudioFields(shot.id, {
      audioStatus: "none",
      audioError: null,
    });
    throw new Error("Bu shot icin parse edilen diyalog transcript yok.");
  }

  if (detail.blockerReason) {
    await updateShotAudioFields(shot.id, {
      audioStatus: "blocked",
      audioError: detail.blockerReason,
    });
    throw new Error(detail.blockerReason);
  }

  const preferredOutputFormat =
    shot.audioOutputFormat === ELEVENLABS_FALLBACK_OUTPUT_FORMAT
      ? ELEVENLABS_FALLBACK_OUTPUT_FORMAT
      : ELEVENLABS_PREFERRED_OUTPUT_FORMAT;
  const existingTakes = buildStoredAudioTakesForShot(shot);
  const nextTakeNumber = resolveNextAudioTakeNumber(existingTakes);
  const outputRelativePath = resolveDialogueAudioOutputRelativePath(
    shot,
    preferredOutputFormat,
    nextTakeNumber,
  );
  const outputAbsolutePath = await join(
    project.folderPath,
    ...outputRelativePath.split("/"),
  );

  await updateShotAudioFields(shot.id, {
    audioStatus: "generating",
    audioError: null,
  });

  try {
    params.onProgress?.(8);
    const optimizedDialogue = await ensureOptimizedDialogueLines({
      shot,
      detail,
      jobId: params.jobId,
    });
    params.onProgress?.(20);
    const performanceProfile = resolveDialoguePerformanceProfile({
      lines: detail.resolvedLines.map((line, index) => ({
        speaker: line.speaker,
        text: optimizedDialogue.lines[index]?.text ?? line.text,
      })),
      summaryTr: shot.summaryTr,
      promptVideo: shot.promptVideo,
      preset: detail.generationProfile.performancePreset,
      note: detail.generationProfile.performanceNote,
    });

    const result = await generateDialogueWithTimestamps({
      lines: detail.resolvedLines.map((line, index) => ({
        text: buildEmotionPromptedDialogueText(
          optimizedDialogue.lines[index]?.text ?? line.text,
          optimizedDialogue.lines[index]?.delivery ?? null,
          detail.generationProfile.performanceNote,
        ),
        voiceId: line.voiceId!,
        speaker: line.speaker,
      })),
      outputPath: outputAbsolutePath,
      outputFormat: preferredOutputFormat,
      stability: performanceProfile.recommendedStability,
      useSpeakerBoost: true,
      abortSignal: params.abortSignal,
      onProgress: params.onProgress,
    });

    const normalizedOutputRelativePath =
      result.outputFormat === preferredOutputFormat
        ? outputRelativePath
        : resolveDialogueAudioOutputRelativePath(shot, result.outputFormat, nextTakeNumber);
    const completedAt = Date.now();
    const nextTake: StoredDialogueAudioTake = {
      id: uuidv4(),
      takeNumber: nextTakeNumber,
      relativePath: normalizedOutputRelativePath,
      outputFormat: result.outputFormat,
      modelUsed: ELEVENLABS_DIALOGUE_MODEL_ID,
      optimizerModel: optimizedDialogue.model,
      optimizedPreview: buildOptimizedDialoguePreview(optimizedDialogue.lines),
      characterCount: result.characterCount,
      costUsd: result.costUsd,
      requestId: result.requestId,
      createdAt: completedAt,
    };
    const nextTakeHistory = sortStoredAudioTakesDescending([
      nextTake,
      ...existingTakes.filter((take) => take.relativePath !== normalizedOutputRelativePath),
    ]);

    await updateShotAudioFields(shot.id, {
      audioStatus: "done",
      audioMasterPath: normalizedOutputRelativePath,
      audioModelUsed: ELEVENLABS_DIALOGUE_MODEL_ID,
      audioOutputFormat: result.outputFormat,
      audioCharacterCount: result.characterCount,
      audioCostUsd: result.costUsd,
      audioTimestampsJson: JSON.stringify({
        requestId: result.requestId,
        optimizerModel: optimizedDialogue.model,
        optimizedPreview: buildOptimizedDialoguePreview(optimizedDialogue.lines),
        performanceProfile,
        voiceSegments: result.voiceSegments,
        alignment: result.alignment,
        normalizedAlignment: result.normalizedAlignment,
      }),
      audioTakeHistoryJson: stringifyAudioTakeHistory(nextTakeHistory),
      audioError: null,
    });

    await logCost({
      projectId: project.id,
      jobId: params.jobId,
      model: ELEVENLABS_DIALOGUE_MODEL_ID,
      type: "tts",
      amountUsd: result.costUsd,
      units: result.characterCount,
    });

    return {
      outputPath: result.outputPath,
      relativePath: normalizedOutputRelativePath,
      costUsd: result.costUsd,
      characterCount: result.characterCount,
    };
  } catch (error) {
    await updateShotAudioFields(shot.id, {
      audioStatus: params.abortSignal?.aborted ? "pending" : "error",
      audioError: error instanceof Error ? error.message : String(error),
      audioMasterPath: shot.audioMasterPath,
      audioModelUsed: shot.audioModelUsed,
      audioOutputFormat: shot.audioOutputFormat,
      audioCharacterCount: shot.audioCharacterCount,
      audioCostUsd: shot.audioCostUsd,
      audioTimestampsJson: shot.audioTimestampsJson,
      audioTakeHistoryJson: stringifyAudioTakeHistory(existingTakes),
    });
    throw error;
  }
}

export type { ElevenLabsSharedVoice, ElevenLabsVoice } from "@/services/elevenlabs.service";
