import { getApiKey } from "@/lib/store";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_API_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_OPENROUTER_MODEL = "openrouter/auto";
const DEFAULT_DIALOGUE_OPTIMIZER_MODEL = "openrouter/auto";
const DIALOGUE_OPTIMIZER_VERSION = "dialogue-optimizer-v7-hollywood-direction";
const TURKISH_LIGHT_STOPWORDS = new Set([
  "ve",
  "ile",
  "ama",
  "fakat",
  "de",
  "da",
  "bir",
  "bu",
  "su",
  "o",
  "mi",
  "mu",
  "mu?",
  "mi?",
  "icin",
  "gibi",
  "kadar",
  "artık",
  "artik",
  "bile",
  "ya",
  "ki",
  "ise",
  "hem",
  "daha",
  "en",
]);
const LOW_PROJECTION_DELIVERY_REGEX =
  /\b(quiet|quietly|soft|softly|calm|calmly|gentle|gently|slow|slowly|whisper|whispered|hushed|murmured|murmur|under breath|breathy|delicate|tender)\b/i;
const EXPLICIT_LOW_PROJECTION_CONTEXT_REGEX =
  /\b(whisper|whispered|under breath|hushed|murmur|softly|gently|quietly|f[iı]s[ıi]lt[ıi]|sessizce|kisik ses|kısık ses|alcak ses|alçak ses)\b/i;
const PHONE_CONTEXT_REGEX = /\b(phone|static|telefon|ahize|call)\b/i;
const COMMAND_CONTEXT_REGEX =
  /\b(vur|ates|ate[sş]|hedef|asla|gorev|görev|anlasilmistir|anlaşıldı|anlasildi|bas ustune|baş üstüne|komutanim|komutanım|emir|hemen|dur|bekle)\b/i;
const HIGH_PRESSURE_CONTEXT_REGEX =
  /\b(vur|haini|haini|asla|gorev|görev|sehadet|şehadet|patlama|explosion|urgent|grave|pressure|tension|shocking|execution order|historical weight|resolve|karargah|karargâh|bunker|tehdit|ihanet)\b/i;
const CONTROLLED_GRIEF_CONTEXT_REGEX =
  /\b(hakkini helal|hakkını helal|helal et|veda|sehadet|şehadet|son gorev|son görev|olursem|ölürsem)\b/i;
const OATH_CONTEXT_REGEX =
  /\b(bas ustune|baş üstüne|anlasilmistir|anlaşıldı|anlasildi|yemin|emir|gorev|görev)\b/i;
const FLAT_DELIVERY_REGEX =
  /\b(natural|clear|calm|neutral|plain|simple|clean|gentle|soft|quiet|conversational)\b/i;
const HIGH_ENERGY_DELIVERY_REGEX =
  /\b(urgent|pressure|command|static|firm|cold|shaken|tense|clipped|authority|resolve|grit|grave|controlled)\b/i;
const CLAUSE_BREAK_MARKERS = [
  "gorev anlasilmistir",
  "görev anlaşılmıştır",
  "gorev anlasildi",
  "görev anlaşıldı",
  "hemen harekete geciyorum",
  "hemen harekete geçiyorum",
  "siz de hakkinizi helal edin",
  "siz de hakkinizi helal edin",
  "emir anlasilmistir",
  "emir anlaşılmıştır",
];
const ACKNOWLEDGEMENT_PREFIXES = [
  "bas ustune",
  "baş üstüne",
  "evet",
  "hayir",
  "hayır",
  "tamam",
  "peki",
  "anladim",
  "anladım",
  "emredersiniz",
  "helal olsun",
];
const VOCATIVE_WORDS = [
  "komutanim",
  "komutanım",
  "pasam",
  "paşam",
  "omer",
  "ömer",
  "amirim",
  "abi",
  "bey",
];

export type PromptAssistMode =
  | "refine"
  | "shorten"
  | "translate-tr"
  | "translate-en";

export type SurgicalPromptEditKind = "start" | "end" | "video";

export interface SurgicalPromptEditParams {
  originalPrompt: string;
  editInstruction: string;
  promptKind: SurgicalPromptEditKind;
  shotNumber?: string | null;
  shotType?: string | null;
  cameraAngle?: string | null;
  summaryTr?: string | null;
  model?: string | null;
}

export interface DialogueOptimizationInputLine {
  speaker: string;
  text: string;
}

export interface OptimizedDialogueLine {
  speaker: string;
  text: string;
  delivery: string | null;
}

export interface DialogueOptimizationResult {
  model: string;
  optimizedLines: OptimizedDialogueLine[];
}

export type DialoguePerformancePreset =
  | "auto"
  | "command"
  | "threat"
  | "controlled_grief"
  | "oath"
  | "tense"
  | "conversation";

export interface DialoguePerformanceProfile {
  preset: DialoguePerformancePreset;
  intensity: "low" | "medium" | "high";
  baselineCue: string;
  recommendedStability: number;
  recommendedSimilarityBoost: number;
  directionNote: string;
}

type DialogueTimingGuidance = {
  shotDurationSeconds: number | null;
  promptDetectedDialogueWindowSeconds: number | null;
  effectiveDialogueWindowSeconds: number;
  estimatedNaturalDialogueDurationSeconds: number;
  recommendedDialogueWindowSeconds: number;
  shouldCompressForTime: boolean;
};

export interface OpenRouterModelOption {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  promptPricePerM: number | null;
  completionPricePerM: number | null;
}

const OPENROUTER_PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  mistralai: "Mistral",
  xai: "xAI",
  "x-ai": "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  moonshotai: "Moonshot",
  perplexity: "Perplexity",
  cohere: "Cohere",
  microsoft: "Microsoft",
  nvidia: "NVIDIA",
  amazon: "Amazon",
  minimax: "MiniMax",
};

export function inferOpenRouterProvider(modelId: string): string {
  const [provider] = modelId.trim().split("/");
  const normalized = provider?.trim().toLowerCase();
  return normalized || "other";
}

export function formatOpenRouterProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();

  if (!normalized) {
    return "Other";
  }

  const mapped = OPENROUTER_PROVIDER_LABELS[normalized];

  if (mapped) {
    return mapped;
  }

  return normalized
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) =>
      part === "ai" ? "AI" : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

function createStableHash(value: string): string {
  let hash = 5381;

  for (const char of value) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }

  return Math.abs(hash >>> 0).toString(16);
}

function stripJsonComments(json: string): string {
  return json
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([}\]])/g, "$1");
}

export function extractJsonObject(content: string): string {
  const trimmed = content.trim();

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex >= 0 && endIndex > startIndex) {
    const raw = candidate.slice(startIndex, endIndex + 1);
    return stripJsonComments(raw);
  }

  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");

  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const raw = candidate.slice(arrayStart, arrayEnd + 1);
    return stripJsonComments(raw);
  }

  throw new Error("OpenRouter yanitinda JSON bulunamadi.");
}

export function autoCloseJsonDelimiters(content: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let isEscaped = false;

  for (const char of content) {
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      stack.push("}");
      continue;
    }

    if (char === "[") {
      stack.push("]");
      continue;
    }

    if (char === "}" || char === "]") {
      const expected = stack.pop();

      if (expected !== char) {
        return null;
      }
    }
  }

  if (inString) {
    return null;
  }

  if (stack.length === 0) {
    return content;
  }

  return `${content}${stack.reverse().join("")}`;
}

function normalizeDeliveryCue(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized ? normalized.slice(0, 80) : null;
}

function normalizeDialogueText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalizeSpeaker(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function normalizeComparisonText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeaningTokens(value: string): string[] {
  return normalizeComparisonText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TURKISH_LIGHT_STOPWORDS.has(token));
}

function extractProtectedNumberTokens(value: string): string[] {
  return Array.from(
    new Set(
      (value.match(/\d+(?:[.,]\d+)?/g) ?? [])
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  );
}

function computeDiceCoefficient(sourceTokens: string[], candidateTokens: string[]): number {
  if (sourceTokens.length === 0 && candidateTokens.length === 0) {
    return 1;
  }

  if (sourceTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const sourceCounts = new Map<string, number>();
  const candidateCounts = new Map<string, number>();

  for (const token of sourceTokens) {
    sourceCounts.set(token, (sourceCounts.get(token) ?? 0) + 1);
  }

  for (const token of candidateTokens) {
    candidateCounts.set(token, (candidateCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;

  for (const [token, sourceCount] of sourceCounts.entries()) {
    overlap += Math.min(sourceCount, candidateCounts.get(token) ?? 0);
  }

  return (2 * overlap) / (sourceTokens.length + candidateTokens.length);
}

export function preserveDialogueMeaning(sourceText: string, candidateText: string): string {
  const normalizedSource = normalizeDialogueText(sourceText);
  const normalizedCandidate = normalizeDialogueText(candidateText);

  if (!normalizedSource) {
    return normalizedCandidate;
  }

  if (!normalizedCandidate) {
    return normalizedSource;
  }

  const sourceWordCount = countWords(normalizedSource);
  const candidateWordCount = countWords(normalizedCandidate);
  const sourceTokens = extractMeaningTokens(normalizedSource);
  const candidateTokens = extractMeaningTokens(normalizedCandidate);
  const tokenSimilarity = computeDiceCoefficient(sourceTokens, candidateTokens);
  const wordRatio =
    sourceWordCount > 0 ? candidateWordCount / sourceWordCount : 1;
  const protectedNumberTokens = extractProtectedNumberTokens(normalizedSource);
  const normalizedCandidateComparison = normalizeComparisonText(normalizedCandidate);
  const preservedNumbers = protectedNumberTokens.every((token) =>
    normalizedCandidateComparison.includes(token.replace(",", ".")) ||
    normalizedCandidateComparison.includes(token),
  );
  const meaningDriftDetected =
    !preservedNumbers ||
    wordRatio < 0.72 ||
    wordRatio > 1.38 ||
    tokenSimilarity < 0.58;

  if (meaningDriftDetected) {
    return normalizedSource;
  }

  return normalizedCandidate;
}

function capitalizeSentenceStarts(value: string): string {
  return value.replace(/(^|[.!?]\s+)([a-zçğıöşü])/g, (_fullMatch, prefix: string, letter: string) =>
    `${prefix}${letter.toLocaleUpperCase("tr-TR")}`,
  );
}

function appendTerminalPunctuation(value: string): string {
  if (!value) {
    return value;
  }

  return /[.!?…]$/.test(value) ? value : `${value}.`;
}

function insertAcknowledgementComma(value: string): string {
  for (const prefix of ACKNOWLEDGEMENT_PREFIXES) {
    const regex = new RegExp(`^(${prefix})(\\s+)([^,.!?\\s]+(?:\\s+[^,.!?\\s]+){0,1})(\\b.*)$`, "i");
    const match = value.match(regex);

    if (match && !/[,.!?]$/.test(match[1])) {
      return `${match[1]}, ${match[3]}${match[4]}`;
    }
  }

  return value;
}

function insertVocativePause(value: string): string {
  const normalized = normalizeComparisonText(value);

  for (const vocative of VOCATIVE_WORDS) {
    if (!normalized.includes(vocative)) {
      continue;
    }

    const regex = new RegExp(`\\b(${vocative})\\b(\\s+)(?=[^,.!?\\s])`, "i");

    if (regex.test(value) && !new RegExp(`\\b${vocative}\\b[,.!?]`, "i").test(value)) {
      return value.replace(regex, "$1. ");
    }
  }

  return value;
}

function insertClauseBreak(value: string): string {
  const normalized = normalizeComparisonText(value);

  for (const marker of CLAUSE_BREAK_MARKERS) {
    const index = normalized.indexOf(marker);

    if (index <= 0) {
      continue;
    }

    const originalIndex = value.toLocaleLowerCase("tr-TR").indexOf(marker);

    if (originalIndex <= 0) {
      continue;
    }

    const previousChar = value[originalIndex - 1];

    if (/[,.!?]/.test(previousChar)) {
      continue;
    }

    return `${value.slice(0, originalIndex).trimEnd()}. ${value.slice(originalIndex).trimStart()}`;
  }

  return value;
}

export function polishTurkishDialogueFluency(value: string): string {
  let polished = normalizeDialogueText(value);

  if (!polished) {
    return polished;
  }

  polished = insertAcknowledgementComma(polished);
  polished = insertClauseBreak(polished);
  polished = insertVocativePause(polished);
  polished = polished.replace(/\s+([,.!?])/g, "$1");
  polished = polished.replace(/([,.!?])([^\s])/g, "$1 $2");
  polished = polished.replace(/\s+/g, " ").trim();
  polished = capitalizeSentenceStarts(polished);
  polished = appendTerminalPunctuation(polished);

  return polished;
}

function buildDeliveryContextText(params: {
  sourceText: string;
  summaryTr?: string | null;
  promptVideo?: string | null;
}): string {
  return [params.sourceText, params.summaryTr ?? "", params.promptVideo ?? ""]
    .join(" ")
    .toLocaleLowerCase("tr-TR");
}

export function resolveDialoguePerformanceProfile(params: {
  sourceText?: string;
  lines?: DialogueOptimizationInputLine[];
  summaryTr?: string | null;
  promptVideo?: string | null;
  preset?: DialoguePerformancePreset;
  note?: string | null;
}): DialoguePerformanceProfile {
  const context = [
    params.sourceText ?? "",
    ...(params.lines ?? []).map((line) => `${line.speaker}: ${line.text}`),
    params.summaryTr ?? "",
    params.promptVideo ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase("tr-TR");
  const preset = params.preset ?? "auto";
  const trimmedNote = params.note?.trim() || null;

  const withNote = (
    profile: Omit<DialoguePerformanceProfile, "preset" | "directionNote"> & {
      directionNote: string;
    },
  ): DialoguePerformanceProfile => ({
    ...profile,
    preset,
    directionNote: trimmedNote
      ? `${profile.directionNote} Custom performance note: ${trimmedNote}`
      : profile.directionNote,
  });

  if (preset === "command") {
    return withNote({
      intensity: "high",
      baselineCue: "clipped military command, hard and immediate",
      recommendedStability: 0.30,
      recommendedSimilarityBoost: 0.82,
      directionNote: "Hard command delivery. Immediate, clipped, fully committed. Jaw tight, breath short, zero hesitation. Not narrated, not announced — barked like a real officer under fire.",
    });
  }

  if (preset === "threat") {
    return withNote({
      intensity: "high",
      baselineCue: "cold dangerous restraint, barely holding back",
      recommendedStability: 0.28,
      recommendedSimilarityBoost: 0.80,
      directionNote: "Threat delivery. The danger is in the control, not the volume. Voice drops low, pace slows, every word lands like a blade. Cold, coiled, predatory stillness.",
    });
  }

  if (preset === "controlled_grief") {
    return withNote({
      intensity: "medium",
      baselineCue: "held emotion, voice cracks once then steadies",
      recommendedStability: 0.42,
      recommendedSimilarityBoost: 0.75,
      directionNote: "Controlled grief. The actor is fighting to hold it together. One micro-break in the voice, then recovery. Not weeping, not stoic — the struggle between the two is the performance.",
    });
  }

  if (preset === "oath") {
    return withNote({
      intensity: "medium",
      baselineCue: "firm resolve, weight of conviction in every word",
      recommendedStability: 0.45,
      recommendedSimilarityBoost: 0.78,
      directionNote: "Oath delivery. Each word carries the weight of commitment. Measured pace, grounded chest voice, eyes locked forward. Not rushed, not ceremonial — deeply personal.",
    });
  }

  if (preset === "tense") {
    return withNote({
      intensity: "high",
      baselineCue: "under pressure, controlled but strain audible",
      recommendedStability: 0.32,
      recommendedSimilarityBoost: 0.80,
      directionNote: "Tense scene. Adrenaline is running but discipline holds. Breath slightly faster, jaw set, words precise. The body is ready to move. Not panicked, not calm — coiled.",
    });
  }

  if (preset === "conversation") {
    return withNote({
      intensity: "low",
      baselineCue: "natural and present, real human talking",
      recommendedStability: 0.50,
      recommendedSimilarityBoost: 0.82,
      directionNote: "Natural conversation. Think two real people in a room, not actors on a soundstage. Slight overlaps in thought, natural breath, imperfect rhythm. Warm, present, lived-in.",
    });
  }

  if (PHONE_CONTEXT_REGEX.test(context) && COMMAND_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "high",
      baselineCue: "clipped command through phone static, terse",
      recommendedStability: 0.30,
      recommendedSimilarityBoost: 0.82,
      directionNote: "Phone command under pressure. Clipped, tense, words bitten off. Static degrades the line but urgency cuts through. Not a voicemail — a battlefield order.",
    });
  }

  if (HIGH_PRESSURE_CONTEXT_REGEX.test(context) && COMMAND_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "high",
      baselineCue: "urgent command, pressure audible in breath",
      recommendedStability: 0.28,
      recommendedSimilarityBoost: 0.80,
      directionNote: "Hard command under fire. The voice carries authority but you can hear the adrenaline underneath. Not narrated — present, dangerous, controlled.",
    });
  }

  if (CONTROLLED_GRIEF_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "medium",
      baselineCue: "held emotion, throat tight but voice steady",
      recommendedStability: 0.42,
      recommendedSimilarityBoost: 0.75,
      directionNote: "Controlled grief or farewell. The emotion lives in the pauses and the slight unsteadiness, not in volume or tears. Dignity under pressure.",
    });
  }

  if (OATH_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "medium",
      baselineCue: "firm resolve, weight behind every word",
      recommendedStability: 0.45,
      recommendedSimilarityBoost: 0.78,
      directionNote: "Oath or mission acceptance. Not formal — deeply personal. The commitment is felt in the grounded steadiness, not in volume.",
    });
  }

  if (HIGH_PRESSURE_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "high",
      baselineCue: "under pressure, strain audible but controlled",
      recommendedStability: 0.32,
      recommendedSimilarityBoost: 0.80,
      directionNote: "Tense scene. The body is tight, breath is measured, words are chosen carefully. Pressure is in the texture of the voice, not in shouting.",
    });
  }

  if (PHONE_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "medium",
      baselineCue: "tense through static, guarded",
      recommendedStability: 0.40,
      recommendedSimilarityBoost: 0.78,
      directionNote: "Phone or radio context. Voice filtered by distance and static. Guarded, slightly clipped, real tension underneath the compression.",
    });
  }

  return withNote({
    intensity: "low",
    baselineCue: "natural and present, real human talking",
    recommendedStability: 0.50,
    recommendedSimilarityBoost: 0.82,
    directionNote: "Natural human conversation. Not a performance — a real person in a real moment. Imperfect, warm, present. Breathe between thoughts.",
  });
}

function buildBaselineDeliveryCue(params: {
  sourceText: string;
  summaryTr?: string | null;
  promptVideo?: string | null;
  preset?: DialoguePerformancePreset;
  note?: string | null;
}): string {
  return resolveDialoguePerformanceProfile({
    sourceText: params.sourceText,
    summaryTr: params.summaryTr,
    promptVideo: params.promptVideo,
    preset: params.preset,
    note: params.note,
  }).baselineCue;
}

export function stabilizeDialogueDeliveryCue(params: {
  delivery: string | null | undefined;
  sourceText: string;
  summaryTr?: string | null;
  promptVideo?: string | null;
  preset?: DialoguePerformancePreset;
  note?: string | null;
  lockVoiceStyle?: boolean;
  isVoiceover?: boolean;
}): string {
  const normalizedDelivery = normalizeDeliveryCue(params.delivery);
  const performanceProfile = resolveDialoguePerformanceProfile({
    sourceText: params.sourceText,
    summaryTr: params.summaryTr,
    promptVideo: params.promptVideo,
    preset: params.preset,
    note: params.note,
  });
  const baselineCue = buildBaselineDeliveryCue(params);
  const context = buildDeliveryContextText(params);
  const explicitLowProjection = EXPLICIT_LOW_PROJECTION_CONTEXT_REGEX.test(context);
  const shouldForceBaseline = Boolean(params.lockVoiceStyle || params.isVoiceover);

  if (!normalizedDelivery) {
    return baselineCue;
  }

  const trimmedWords = normalizedDelivery
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  const shortenedDelivery = trimmedWords.join(" ");

  if (!shortenedDelivery) {
    return baselineCue;
  }

  if (!explicitLowProjection && LOW_PROJECTION_DELIVERY_REGEX.test(shortenedDelivery)) {
    return baselineCue;
  }

  if (
    performanceProfile.intensity === "high" &&
    FLAT_DELIVERY_REGEX.test(shortenedDelivery) &&
    !HIGH_ENERGY_DELIVERY_REGEX.test(shortenedDelivery)
  ) {
    return baselineCue;
  }

  if (shouldForceBaseline) {
    if (explicitLowProjection && LOW_PROJECTION_DELIVERY_REGEX.test(shortenedDelivery)) {
      return shortenedDelivery;
    }

    return baselineCue;
  }

  return shortenedDelivery;
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function estimatePromptDialogueWindowSeconds(promptVideo?: string | null): number | null {
  const normalizedPrompt = promptVideo?.replace(/\r/g, "").trim();

  if (!normalizedPrompt) {
    return null;
  }

  const lines = normalizedPrompt
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const segmentDurations = new Map<string, number>();
  let currentSegmentKey: string | null = null;
  let currentSegmentDuration: number | null = null;

  for (const line of lines) {
    const segmentMatch = line.match(/^Shot\s+([0-9]+)\b[\s,:-]*.*?\((\d+(?:\.\d+)?)s\)/i);

    if (segmentMatch) {
      currentSegmentKey = `shot-${segmentMatch[1]}`;
      currentSegmentDuration = Number(segmentMatch[2]);
      continue;
    }

    if (
      currentSegmentKey &&
      currentSegmentDuration &&
      Number.isFinite(currentSegmentDuration) &&
      /"[^"]{2,}"/.test(line)
    ) {
      segmentDurations.set(currentSegmentKey, currentSegmentDuration);
    }
  }

  if (segmentDurations.size === 0) {
    return null;
  }

  const totalWindowSeconds = Array.from(segmentDurations.values()).reduce(
    (total, duration) => total + duration,
    0,
  );

  return Number(Math.max(0.8, totalWindowSeconds).toFixed(2));
}

function resolveCinematicDialogueOccupancyRatio(
  availableWindowSeconds: number,
  fromPromptSegment: boolean,
): number {
  if (fromPromptSegment) {
    if (availableWindowSeconds <= 3) {
      return 0.96;
    }

    if (availableWindowSeconds <= 5) {
      return 0.9;
    }

    if (availableWindowSeconds <= 8) {
      return 0.86;
    }

    return 0.82;
  }

  if (availableWindowSeconds <= 3) {
    return 0.92;
  }

  if (availableWindowSeconds <= 5) {
    return 0.78;
  }

  if (availableWindowSeconds <= 8) {
    return 0.68;
  }

  if (availableWindowSeconds <= 12) {
    return 0.58;
  }

  return 0.5;
}

export function estimateDialogueTimingGuidance(params: {
  lines: DialogueOptimizationInputLine[];
  shotDurationS?: number | null;
  promptVideo?: string | null;
}): DialogueTimingGuidance {
  const totalWords = params.lines.reduce((total, line) => total + countWords(line.text), 0);
  const lineCount = Math.max(1, params.lines.length);
  const estimatedNaturalDialogueDurationSeconds = Number(
    Math.max(1.05, totalWords / 3.35 + lineCount * 0.18).toFixed(2),
  );
  const shotDurationSeconds =
    typeof params.shotDurationS === "number" && Number.isFinite(params.shotDurationS)
      ? Math.max(0, params.shotDurationS)
      : null;
  const promptDetectedDialogueWindowSeconds = estimatePromptDialogueWindowSeconds(
    params.promptVideo,
  );
  const effectiveDialogueWindowSeconds = Number(
    Math.max(
      1,
      promptDetectedDialogueWindowSeconds ?? shotDurationSeconds ?? estimatedNaturalDialogueDurationSeconds,
    ).toFixed(2),
  );
  const occupancyRatio = resolveCinematicDialogueOccupancyRatio(
    effectiveDialogueWindowSeconds,
    promptDetectedDialogueWindowSeconds !== null,
  );
  const recommendedDialogueWindowSeconds = Number(
    (
      shotDurationSeconds === null && promptDetectedDialogueWindowSeconds === null
        ? estimatedNaturalDialogueDurationSeconds
        : Math.min(
            estimatedNaturalDialogueDurationSeconds,
            Math.max(1.05, effectiveDialogueWindowSeconds * occupancyRatio),
          )
    ).toFixed(2),
  );

  return {
    shotDurationSeconds,
    promptDetectedDialogueWindowSeconds,
    effectiveDialogueWindowSeconds,
    estimatedNaturalDialogueDurationSeconds,
    recommendedDialogueWindowSeconds,
    shouldCompressForTime: estimatedNaturalDialogueDurationSeconds > recommendedDialogueWindowSeconds,
  };
}

function parseOptimizedDialoguePayload(content: string): OptimizedDialogueLine[] {
  const parsed = JSON.parse(extractJsonObject(content)) as {
    lines?: Array<{
      speaker?: string;
      text?: string;
      delivery?: string | null;
    }>;
  };
  const lines = parsed.lines ?? [];

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("OpenRouter dialog optimizer bos veya gecersiz lines listesi dondu.");
  }

  return lines.map((line) => ({
    speaker: normalizeSpeaker(line.speaker),
    text: normalizeDialogueText(line.text),
    delivery: normalizeDeliveryCue(line.delivery),
  }));
}

function buildDialogueOptimizationInstruction(): string {
  return [
    "You are a Hollywood-grade Turkish dialogue performance director for cinematic voice synthesis.",
    "Your job is minimal dialogue polishing and precise actor direction — not rewriting.",
    "Rewrite each line into more natural spoken Turkish only when necessary for fluency, pacing, pronunciation, or punctuation.",
    "Preserve the exact speaker order, wording intent, names, ranks, commands, story facts, tactical meaning, and emotional truth.",
    "Never paraphrase, summarize, expand, omit, intensify, soften, reinterpret, or change subtext.",
    "Do not change what the character means. Only make the line easier to say aloud naturally.",
    "Do not return the exact same line if you can improve fluency with punctuation, clause breaks, vocative pauses, or tiny speech-shaping edits that preserve meaning.",
    "If the source line already sounds natural, keep it almost unchanged but still clean obvious punctuation or breath-flow issues.",
    "Use natural spoken rhythm, pauses, interruptions, punctuation, and idiomatic Turkish only when they do not alter meaning.",
    "Shot duration is contextual only, not a target spoken duration.",
    "Never stretch dialogue to fill the whole shot. Reaction beats, silence, and nonverbal acting may occupy the rest of the shot.",
    "Use estimated_natural_dialogue_duration_seconds as the main pacing anchor.",
    "If prompt_detected_dialogue_window_seconds is present, treat it as the strongest timing constraint because the dialogue belongs only to that prompt segment, not the full shot.",
    "effective_dialogue_window_seconds is the usable cinematic speech window, not the total shot runtime.",
    "Only compress wording if estimated_natural_dialogue_duration_seconds materially exceeds recommended_dialogue_window_seconds.",
    "If the line would sound rushed for the available time, compress only by removing redundancy, not by changing meaning.",
    "If the scene should breathe emotionally, allow slightly longer phrasing, pauses, or hesitation markers, but stay natural.",
    "Avoid drawn-out delivery. Cinematic dialogue should sound intentional, crisp, and actor-like rather than slowly narrated.",
    "Keep emotional delivery grounded, restrained, and psychologically believable.",
    "Default vocal projection is natural, audible, clear, and present.",
    "Do not default to quiet, calm, soft, whispered, or slow delivery.",
    "Use low-volume or hushed delivery only when the source line or prompt explicitly demands it.",
    "Do not make the acting melodramatic unless the source line and scene clearly demand it.",
    "Do not make tense scenes sound sanitized, serene, polite, audiobook-like, or voiceover-clean.",
    "Do not make commands, threats, oaths, grief, or battlefield pressure sound customer-service calm.",
    "Prefer subtle human irregularity, pressure, clipped resolve, and emotional friction over pristine synthetic smoothness.",
    "Control pace through word choice, punctuation, ellipses, dashes, sentence length, and breath-friendly phrasing.",
    "Use em-dashes for interrupted thoughts, ellipses for trailing hesitation, commas for breath beats.",
    "Infer emotional delivery from the scene summary and video prompt cues, but do not add new plot information.",
    "If a custom performance note is provided, follow it as scene direction without changing the line's meaning.",
    "Keep one coherent vocal identity across the whole shot. Do not reinvent accent, age, projection, or acting approach line by line.",
    "If style_consistency_lock is true, stay very close to scene_performance_profile.baseline_delivery and vary only when the text absolutely requires it.",
    "If is_voiceover is true, prioritize narrator consistency over theatrical variation. Keep the same vocal persona from first line to last.",
    "Keep each line concise, highly speakable, and very close in wording to the original.",
    "Return strict JSON only with this shape:",
    '{"lines":[{"speaker":"Speaker Name","text":"optimized spoken Turkish line","delivery":"English actor-direction cue"}]}',
    "delivery is an English actor-direction cue that will be injected into TTS emotional prompting, maximum 12 words.",
    "Write delivery as if you are a film director whispering to the actor right before the take.",
    "delivery must describe HOW to say the line physically: what the jaw does, where the breath catches, what the body is doing.",
    "Include pace, projection, and physical acting cues when useful.",
    "Examples of excellent delivery cues:",
    "- 'jaw clenched, words bitten off short, controlled fury underneath'",
    "- 'quiet and steady, but throat tightens on the last word'",
    "- 'breath catches, recovers, pushes through with grounded resolve'",
    "- 'low chest voice, slow deliberate pace, each word a weight'",
    "- 'conversational warmth, slight smile audible, unhurried'",
    "- 'clipped and urgent through radio static, no wasted breath'",
    "- 'held back tears, voice drops low, fights to stay steady'",
    "Avoid generic cues like 'emotional', 'intense', 'dramatic', 'powerful'. Be specific about the physical performance.",
    "If a line already sounds natural, improve it minimally instead of rewriting aggressively.",
    "Do not use markdown fences. Do not include explanations.",
  ].join(" ");
}

export function createDialogueOptimizationSourceHash(input: {
  shotNumber?: string | null;
  durationS?: number | null;
  summaryTr?: string | null;
  promptVideo?: string | null;
  dialogueTranscript?: string | null;
  audioContentHash?: string | null;
  performancePreset?: DialoguePerformancePreset | string | null;
  performanceNote?: string | null;
  useOptimizer?: boolean;
  lockVoiceStyle?: boolean;
  isVoiceover?: boolean;
}): string | null {
  const transcript = input.dialogueTranscript?.trim();

  if (!transcript) {
    return null;
  }

  return createStableHash(
    [
      input.shotNumber?.trim() ?? "",
      String(input.durationS ?? ""),
      input.summaryTr?.trim() ?? "",
      input.promptVideo?.trim() ?? "",
      transcript,
      input.audioContentHash?.trim() ?? "",
      String(input.useOptimizer ?? true),
      input.performancePreset ?? "auto",
      input.performanceNote?.trim() ?? "",
      String(input.lockVoiceStyle ?? false),
      String(input.isVoiceover ?? false),
      DEFAULT_DIALOGUE_OPTIMIZER_MODEL,
      DIALOGUE_OPTIMIZER_VERSION,
    ].join("\n---\n"),
  );
}

function buildInstruction(mode: PromptAssistMode): string {
  if (mode === "refine") {
    return "Improve the prompt for production image or video generation. Preserve intent, concrete details, tone, and constraints. Return only the improved prompt.";
  }

  if (mode === "shorten") {
    return "Shorten the prompt while preserving all critical visual, cinematic, and constraint information. Return only the shortened prompt.";
  }

  if (mode === "translate-tr") {
    return "Translate the prompt to Turkish. Preserve structure, tone, and all cinematic details. Return only the translated prompt.";
  }

  return "Translate the prompt to English. Preserve structure, tone, and all cinematic details. Return only the translated prompt.";
}

function normalizePromptTextOutput(content: string): string {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:text|md|markdown)?\s*([\s\S]*?)\s*```$/i);
  return (fencedMatch?.[1] ?? trimmed).trim();
}

function normalizePromptForComparison(content: string): string {
  return normalizePromptTextOutput(content)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[`"'“”‘’.,;:!?()[\]{}<>\\/|*_+=-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasMaterialPromptChange(originalPrompt: string, candidatePrompt: string): boolean {
  return normalizePromptForComparison(originalPrompt) !== normalizePromptForComparison(candidatePrompt);
}

function buildSurgicalPromptEditInstruction(forceMaterialChange = false): string {
  const baseInstruction = [
    "You are a senior cinematic prompt editor.",
    "Your task is to surgically revise an existing generation prompt.",
    "Preserve the original prompt's structure, intent, visual continuity, camera logic, tone, and constraints unless the user instruction explicitly asks to change them.",
    "Apply only the requested changes.",
    "Do not widen scope.",
    "Do not add new characters, props, actions, camera moves, locations, or stylistic flourishes unless explicitly requested.",
    "Do not rewrite the whole prompt just to make it different.",
    "Keep wording as close to the original as possible while making the requested fix cleanly.",
    "If the requested change conflicts with the original prompt, resolve only that conflict and preserve everything else.",
    "Return only the revised prompt text.",
    "Do not include explanations, bullets, labels, markdown fences, or surrounding quotes.",
  ];

  if (forceMaterialChange) {
    baseInstruction.push(
      "Your previous draft was rejected because it did not materially change the prompt.",
      "A no-op rewrite is not acceptable.",
      "Make the requested change explicit in the returned prompt while preserving everything else.",
    );
  }

  return baseInstruction.join(" ");
}

function buildSurgicalPromptEditUserPrompt(
  params: SurgicalPromptEditParams,
): string {
  return JSON.stringify(
    {
      shot_number: params.shotNumber?.trim() || null,
      prompt_kind: params.promptKind,
      shot_context: {
        shot_type: params.shotType?.trim() || null,
        camera_angle: params.cameraAngle?.trim() || null,
        summary_tr: params.summaryTr?.trim() || null,
      },
      original_prompt: params.originalPrompt.trim(),
      requested_change: params.editInstruction.trim(),
    },
    null,
    2,
  );
}

export async function runPromptAssist(
  mode: PromptAssistMode,
  content: string,
): Promise<string> {
  const apiKey = (await getApiKey("OPENROUTER_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key bulunamadi. Ayarlardan ekleyin.");
  }

  if (!content.trim()) {
    throw new Error("Bos prompt yardimci islemine gonderilemez.");
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cineai.local",
      "X-Title": "CineAI Studio",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENROUTER_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: buildInstruction(mode),
        },
        {
          role: "user",
          content: content.trim(),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter istegi basarisiz oldu (${response.status}).`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const output = payload.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("OpenRouter yanitinda icerik bulunamadi.");
  }

  return normalizePromptTextOutput(output);
}

export async function runSurgicalPromptEdit(
  params: SurgicalPromptEditParams,
): Promise<string> {
  if (!params.originalPrompt.trim()) {
    throw new Error("Duzenlenecek prompt bos olamaz.");
  }

  if (!params.editInstruction.trim()) {
    throw new Error("Prompt duzeltme talimati bos olamaz.");
  }

  const normalizedOriginalPrompt = normalizePromptTextOutput(params.originalPrompt);
  let lastOutput = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await runScenarioLLM({
      systemPrompt: buildSurgicalPromptEditInstruction(attempt > 0),
      userPrompt: buildSurgicalPromptEditUserPrompt(params),
      model: params.model ?? undefined,
      temperature: attempt > 0 ? 0.2 : 0.1,
    });
    const output = normalizePromptTextOutput(result.content);

    if (!output) {
      throw new Error("OpenRouter prompt duzeltme yanitinda icerik bulunamadi.");
    }

    lastOutput = output;

    if (hasMaterialPromptChange(normalizedOriginalPrompt, output)) {
      return output;
    }
  }

  throw new Error(
    `AI duzeltme talimati promptta olculebilir bir degisiklik uretemedi. Talimati daha net yaz ve tekrar dene.${lastOutput ? " Son yanit mevcut promptla neredeyse ayniydi." : ""}`,
  );
}

export async function optimizeDialogueForSpeech(params: {
  shotNumber: string;
  durationS?: number | null;
  summaryTr?: string | null;
  promptVideo?: string | null;
  lines: DialogueOptimizationInputLine[];
  performancePreset?: DialoguePerformancePreset;
  performanceNote?: string | null;
  lockVoiceStyle?: boolean;
  isVoiceover?: boolean;
}): Promise<DialogueOptimizationResult> {
  const apiKey = (await getApiKey("OPENROUTER_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key bulunamadi. Dialog optimizasyonu icin Ayarlardan ekleyin.");
  }

  const normalizedLines = params.lines
    .map((line) => ({
      speaker: normalizeSpeaker(line.speaker),
      text: normalizeDialogueText(line.text),
    }))
    .filter((line) => line.speaker && line.text);

  if (normalizedLines.length === 0) {
    throw new Error("Dialog optimizasyonu icin en az bir gecerli satir gerekli.");
  }

  const timingGuidance = estimateDialogueTimingGuidance({
    lines: normalizedLines,
    shotDurationS: params.durationS,
    promptVideo: params.promptVideo,
  });
  const performanceProfile = resolveDialoguePerformanceProfile({
    lines: normalizedLines,
    summaryTr: params.summaryTr,
    promptVideo: params.promptVideo,
    preset: params.performancePreset,
    note: params.performanceNote,
  });

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cineai.local",
      "X-Title": "CineAI Studio",
    },
    body: JSON.stringify({
      model: DEFAULT_DIALOGUE_OPTIMIZER_MODEL,
      temperature: 0.12,
      messages: [
        {
          role: "system",
          content: buildDialogueOptimizationInstruction(),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              shot_number: params.shotNumber,
              shot_duration_seconds: timingGuidance.shotDurationSeconds,
              prompt_detected_dialogue_window_seconds:
                timingGuidance.promptDetectedDialogueWindowSeconds,
              effective_dialogue_window_seconds: timingGuidance.effectiveDialogueWindowSeconds,
              estimated_natural_dialogue_duration_seconds:
                timingGuidance.estimatedNaturalDialogueDurationSeconds,
              recommended_dialogue_window_seconds:
                timingGuidance.recommendedDialogueWindowSeconds,
              should_compress_for_time: timingGuidance.shouldCompressForTime,
              scene_performance_profile: {
                preset: performanceProfile.preset,
                intensity: performanceProfile.intensity,
                baseline_delivery: performanceProfile.baselineCue,
                recommended_stability: performanceProfile.recommendedStability,
                direction_note: performanceProfile.directionNote,
              },
              performance_preset: params.performancePreset ?? "auto",
              performance_note: params.performanceNote?.trim() || null,
              style_consistency_lock: Boolean(params.lockVoiceStyle),
              is_voiceover: Boolean(params.isVoiceover),
              scene_summary_tr: params.summaryTr?.trim() || null,
              video_prompt: params.promptVideo?.trim() || null,
              lines: normalizedLines,
            },
            null,
            2,
          ),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter dialog optimizasyon istegi basarisiz oldu (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }

  const payload = (await response.json()) as {
    model?: string;
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter dialog optimizer yanitinda icerik bulunamadi.");
  }

  const optimizedLines = parseOptimizedDialoguePayload(content).map((line, index) => ({
    ...line,
    text: polishTurkishDialogueFluency(
      preserveDialogueMeaning(normalizedLines[index]?.text ?? line.text, line.text),
    ),
    delivery: stabilizeDialogueDeliveryCue({
      delivery: line.delivery,
      sourceText: normalizedLines[index]?.text ?? line.text,
      summaryTr: params.summaryTr,
      promptVideo: params.promptVideo,
      preset: params.performancePreset,
      note: params.performanceNote,
      lockVoiceStyle: params.lockVoiceStyle,
      isVoiceover: params.isVoiceover,
    }),
  }));

  if (optimizedLines.length !== normalizedLines.length) {
    throw new Error("OpenRouter dialog optimizer satir sayisini degistirdi.");
  }

  for (let index = 0; index < optimizedLines.length; index += 1) {
    const optimizedLine = optimizedLines[index];
    const sourceLine = normalizedLines[index];

    if (!optimizedLine.speaker || !optimizedLine.text) {
      throw new Error("OpenRouter dialog optimizer bazi satirlari eksik dondurdu.");
    }

    if (optimizedLine.speaker.toLowerCase() !== sourceLine.speaker.toLowerCase()) {
      throw new Error("OpenRouter dialog optimizer speaker sirasini veya etiketlerini degistirdi.");
    }
  }

  return {
    model: payload.model?.trim() || DEFAULT_DIALOGUE_OPTIMIZER_MODEL,
    optimizedLines,
  };
}

export async function runScenarioLLM(params: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<{ content: string; model: string; finishReason: string | null }> {
  const apiKey = (await getApiKey("OPENROUTER_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key bulunamadi. Ayarlardan ekleyin.");
  }

  const model = params.model?.trim() || DEFAULT_OPENROUTER_MODEL;

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cineai.local",
      "X-Title": "CineAI Studio",
    },
    body: JSON.stringify({
      model,
      temperature: params.temperature ?? 0.15,
      max_tokens: params.maxTokens,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
    }),
    signal: params.abortSignal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter istegi basarisiz oldu (${response.status}). ${errorBody.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
    model?: string;
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter yanitinda icerik bulunamadi.");
  }

  return { content, model: payload.model ?? model, finishReason: choice?.finish_reason ?? null };
}

function normalizePricePerMillion(value: unknown): number | null {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return numeric * 1_000_000;
}

function normalizeOpenRouterModels(payload: unknown): OpenRouterModelOption[] {
  const rows = (payload as { data?: unknown[] })?.data;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      const model = row as {
        id?: unknown;
        name?: unknown;
        context_length?: unknown;
        pricing?: {
          prompt?: unknown;
          completion?: unknown;
        };
      };
      const id = typeof model.id === "string" ? model.id.trim() : "";

      if (!id) {
        return null;
      }

      return {
        id,
        name:
          typeof model.name === "string" && model.name.trim()
            ? model.name.trim()
            : id,
        provider: inferOpenRouterProvider(id),
        contextLength:
          Number.isFinite(Number(model.context_length))
            ? Number(model.context_length)
            : null,
        promptPricePerM: normalizePricePerMillion(model.pricing?.prompt),
        completionPricePerM: normalizePricePerMillion(model.pricing?.completion),
      } satisfies OpenRouterModelOption;
    })
    .filter((model): model is OpenRouterModelOption => Boolean(model))
    .sort((left, right) => {
      const leftPrompt = left.promptPricePerM ?? Number.POSITIVE_INFINITY;
      const rightPrompt = right.promptPricePerM ?? Number.POSITIVE_INFINITY;

      if (leftPrompt !== rightPrompt) {
        return leftPrompt - rightPrompt;
      }

      return left.name.localeCompare(right.name);
    });
}

export async function listOpenRouterModels(
  apiKeyOverride?: string,
): Promise<OpenRouterModelOption[]> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey("OPENROUTER_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key bulunamadi. Ayarlardan ekleyin.");
  }

  const response = await fetch(OPENROUTER_MODELS_API_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://cineai.local",
      "X-Title": "CineAI Studio",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter model listesi alinamadi (${response.status}).`);
  }

  const payload = await response.json();
  const models = normalizeOpenRouterModels(payload);

  return [
    {
      id: DEFAULT_OPENROUTER_MODEL,
      name: "OpenRouter Auto",
      provider: "openrouter",
      contextLength: null,
      promptPricePerM: null,
      completionPricePerM: null,
    },
    ...models.filter((model) => model.id !== DEFAULT_OPENROUTER_MODEL),
  ];
}

export async function testOpenRouterConnection(
  apiKeyOverride?: string,
): Promise<{ modelCount: number }> {
  return {
    modelCount: (await listOpenRouterModels(apiKeyOverride)).length,
  };
}
