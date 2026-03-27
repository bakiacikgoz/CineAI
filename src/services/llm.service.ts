import { getApiKey } from "@/lib/store";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_API_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_OPENROUTER_MODEL = "openrouter/auto";
const DEFAULT_DIALOGUE_OPTIMIZER_MODEL = "openrouter/auto";
const DIALOGUE_OPTIMIZER_VERSION = "dialogue-optimizer-v6-human-performance";
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
  recommendedStability: 0 | 0.5 | 1;
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

function createStableHash(value: string): string {
  let hash = 5381;

  for (const char of value) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }

  return Math.abs(hash >>> 0).toString(16);
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const startIndex = trimmed.indexOf("{");
  const endIndex = trimmed.lastIndexOf("}");

  if (startIndex >= 0 && endIndex > startIndex) {
    return trimmed.slice(startIndex, endIndex + 1);
  }

  throw new Error("OpenRouter dialog optimizer yanitinda JSON bulunamadi.");
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
      baselineCue: "clipped military command",
      recommendedStability: 0,
      directionNote: "Hard command delivery. Immediate, clipped, fully committed, never serene.",
    });
  }

  if (preset === "threat") {
    return withNote({
      intensity: "high",
      baselineCue: "cold threat, tightly controlled",
      recommendedStability: 0,
      directionNote: "Threat delivery. Dangerous restraint, cold authority, not theatrical.",
    });
  }

  if (preset === "controlled_grief") {
    return withNote({
      intensity: "medium",
      baselineCue: "held emotion, barely steady",
      recommendedStability: 0.5,
      directionNote: "Controlled grief. Emotion is contained but audible, never melodramatic or sleepy.",
    });
  }

  if (preset === "oath") {
    return withNote({
      intensity: "medium",
      baselineCue: "firm resolve, fully present",
      recommendedStability: 0.5,
      directionNote: "Oath or acceptance. Human conviction, pressure, and commitment, not politeness.",
    });
  }

  if (preset === "tense") {
    return withNote({
      intensity: "high",
      baselineCue: "under pressure, still controlled",
      recommendedStability: 0,
      directionNote: "Tense scene. Pressure should be felt in the voice without sounding synthetic.",
    });
  }

  if (preset === "conversation") {
    return withNote({
      intensity: "low",
      baselineCue: "conversational and present",
      recommendedStability: 0.5,
      directionNote: "Natural conversation. Human, present, and believable rather than polished.",
    });
  }

  if (PHONE_CONTEXT_REGEX.test(context) && COMMAND_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "high",
      baselineCue: "clipped command through static",
      recommendedStability: 0,
      directionNote: "High-pressure phone command. Human, clipped, tense, not calm.",
    });
  }

  if (HIGH_PRESSURE_CONTEXT_REGEX.test(context) && COMMAND_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "high",
      baselineCue: "urgent, tightly controlled",
      recommendedStability: 0,
      directionNote: "Hard command under pressure. Present, dangerous, controlled, not narrated.",
    });
  }

  if (CONTROLLED_GRIEF_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "medium",
      baselineCue: "held emotion, steady",
      recommendedStability: 0.5,
      directionNote: "Controlled grief or farewell. Emotional truth without melodrama or softness.",
    });
  }

  if (OATH_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "medium",
      baselineCue: "firm resolve, fully present",
      recommendedStability: 0.5,
      directionNote: "Oath or mission acceptance. Human resolve, not polite or serene.",
    });
  }

  if (HIGH_PRESSURE_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "high",
      baselineCue: "under pressure, still controlled",
      recommendedStability: 0,
      directionNote: "Tense scene. Audible strain and pressure, but still believable.",
    });
  }

  if (PHONE_CONTEXT_REGEX.test(context)) {
    return withNote({
      intensity: "medium",
      baselineCue: "tense through static",
      recommendedStability: 0.5,
      directionNote: "Phone/static context. Slight grit and tension, not clean narration.",
    });
  }

  return withNote({
    intensity: "low",
    baselineCue: "conversational and present",
    recommendedStability: 0.5,
    directionNote: "Natural human conversation. Present and believable, not announcer-clean.",
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

  if (!normalizedDelivery) {
    return baselineCue;
  }

  const trimmedWords = normalizedDelivery
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
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
    "You are a Turkish dialogue doctor for cinematic voice synthesis.",
    "Your job is minimal dialogue polishing, not rewriting.",
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
    "Infer emotional delivery from the scene summary and video prompt cues, but do not add new plot information.",
    "If a custom performance note is provided, follow it as scene direction without changing the line's meaning.",
    "Keep each line concise, highly speakable, and very close in wording to the original.",
    "Return strict JSON only with this shape:",
    '{"lines":[{"speaker":"Speaker Name","text":"optimized spoken Turkish line","delivery":"short English delivery cue"}]}',
    "delivery must be a very short English actor-direction cue for Eleven v3 emotional prompting, maximum 6 words.",
    "delivery should include pace when useful, but stay subtle and believable.",
    "Prefer grounded cues such as: clipped command through static, urgent and controlled, firm resolve, held emotion, tense through static, under pressure, shaken but steady, cold authority, breath held.",
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

  return output;
}

export async function optimizeDialogueForSpeech(params: {
  shotNumber: string;
  durationS?: number | null;
  summaryTr?: string | null;
  promptVideo?: string | null;
  lines: DialogueOptimizationInputLine[];
  performancePreset?: DialoguePerformancePreset;
  performanceNote?: string | null;
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

export async function testOpenRouterConnection(
  apiKeyOverride?: string,
): Promise<{ modelCount: number }> {
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
    throw new Error(`OpenRouter baglanti testi basarisiz oldu (${response.status}).`);
  }

  const payload = (await response.json()) as {
    data?: unknown[];
  };

  return {
    modelCount: Array.isArray(payload.data) ? payload.data.length : 0,
  };
}
