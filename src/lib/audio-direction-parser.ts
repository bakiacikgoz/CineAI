export type AudioDirectionLanguage = "turkish" | "english" | "none" | "mixed";
export type AudioDirectionType =
  | "dialogue"
  | "voiceover"
  | "sfx"
  | "mixed"
  | "sfx_only"
  | "ambience"
  | "none";

export type AudioShotStatus =
  | "none"
  | "blocked"
  | "pending"
  | "queued"
  | "generating"
  | "done"
  | "error";

export interface ParsedDialogueLine {
  speaker: string;
  speakerKey: string;
  text: string;
}

export interface ParsedAudioDirection {
  language: AudioDirectionLanguage;
  type: AudioDirectionType;
  dialogueTranscript: string | null;
  dialogueLines: ParsedDialogueLine[];
  dialoguePreview: string | null;
  speakerTagged: boolean;
  sfx: string[];
  ambience: string[];
  music: string | null;
  mixTarget: {
    dialogue: number | null;
    sfx: number | null;
    ambience: number | null;
  } | null;
  hasSubtitles: boolean;
  blockText: string;
}

export interface AudioDirectionExtraction {
  audioBlock: string | null;
  promptWithoutAudioBlock: string;
  hasAudioDirection: boolean;
}

type ScratchFields = {
  language: string | null;
  type: string | null;
  dialogueTranscript: string | null;
  sfx: string | null;
  ambience: string | null;
  music: string | null;
  mixTarget: string | null;
};

const AUDIO_DIRECTION_HEADER_REGEX = /^\s*Audio direction\s*:/im;
const AVOID_HEADER_REGEX = /^\s*Avoid\s*:/im;
const FIELD_NAME_MAP = new Map<string, keyof ScratchFields>([
  ["language", "language"],
  ["type", "type"],
  ["dialogue transcript", "dialogueTranscript"],
  ["dialogue", "dialogueTranscript"],
  ["sfx", "sfx"],
  ["ambience", "ambience"],
  ["ambiance", "ambience"],
  ["music", "music"],
  ["mix target", "mixTarget"],
]);

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function cleanContinuationLine(value: string): string {
  return value.replace(/^\s*[-*]\s*/, "").trim();
}

function appendFieldValue(current: string | null, nextValue: string): string {
  return current ? `${current}\n${nextValue}` : nextValue;
}

function trimWrappedQuotes(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function isNoneValue(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "none" || normalized === "\"none\"";
}

function normalizeFieldName(value: string): keyof ScratchFields | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return FIELD_NAME_MAP.get(normalized) ?? null;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeSpeakerKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLanguage(value: string | null): AudioDirectionLanguage {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized || normalized === "none") {
    return "none";
  }

  if (normalized.includes("mixed")) {
    return "mixed";
  }

  if (normalized.includes("turk")) {
    return "turkish";
  }

  if (normalized.includes("english")) {
    return "english";
  }

  return "mixed";
}

function inferLanguageFromDialogue(dialogueLines: ParsedDialogueLine[]): AudioDirectionLanguage {
  const combined = dialogueLines.map((line) => line.text).join(" ");

  if (!combined.trim()) {
    return "none";
  }

  if (/[çğıöşüÇĞİÖŞÜ]/.test(combined)) {
    return "turkish";
  }

  if (/[A-Za-z]/.test(combined)) {
    return "english";
  }

  return "mixed";
}

function normalizeType(value: string | null): AudioDirectionType {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized || normalized === "none") {
    return "none";
  }

  if (normalized.includes("voiceover") || normalized.includes("narration") || normalized.includes("seslendirme")) {
    return "voiceover";
  }

  if (normalized.includes("sfx only") || normalized.includes("sfx-only")) {
    return "sfx_only";
  }

  if (normalized.includes("sfx/ambience") || normalized.includes("sfx/ambiance")) {
    return "mixed";
  }

  if (normalized.includes("amplified sfx") || normalized.includes("amplified-sfx")) {
    return "sfx";
  }

  if (normalized.includes("mixed")) {
    return "mixed";
  }

  if (normalized.includes("dialogue")) {
    return "dialogue";
  }

  if (normalized.includes("ambience only") || normalized.includes("ambiance only")) {
    return "ambience";
  }

  if (normalized.includes("ambience") || normalized.includes("ambiance")) {
    return "ambience";
  }

  if (normalized.includes("sfx")) {
    return "sfx";
  }

  return "none";
}

function parseListField(value: string | null): string[] {
  if (isNoneValue(value)) {
    return [];
  }

  return Array.from(
    new Set(
      (value ?? "")
        .split(/\n|,/)
        .map((part) => trimWrappedQuotes(part).trim())
        .filter((part) => Boolean(part) && part.toLowerCase() !== "none"),
    ),
  );
}

function parseMixTarget(
  value: string | null,
): ParsedAudioDirection["mixTarget"] {
  if (!value) {
    return null;
  }

  const parsed: NonNullable<ParsedAudioDirection["mixTarget"]> = {
    dialogue: null,
    sfx: null,
    ambience: null,
  };

  let matched = false;

  for (const match of value.matchAll(/([a-z]+)\s+(\d+)%/gi)) {
    const key = match[1]?.trim().toLowerCase();
    const amount = Number.parseInt(match[2] ?? "", 10);

    if (!Number.isFinite(amount)) {
      continue;
    }

    if (key === "dialogue") {
      parsed.dialogue = amount;
      matched = true;
      continue;
    }

    if (key === "sfx") {
      parsed.sfx = amount;
      matched = true;
      continue;
    }

    if (key === "ambience" || key === "ambiance") {
      parsed.ambience = amount;
      matched = true;
    }
  }

  return matched ? parsed : null;
}

function parseDialogueLines(transcript: string | null): {
  dialogueLines: ParsedDialogueLine[];
  speakerTagged: boolean;
} {
  if (isNoneValue(transcript)) {
    return { dialogueLines: [], speakerTagged: false };
  }

  const normalizedTranscript = trimWrappedQuotes(transcript ?? "");
  const lines = normalizedTranscript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { dialogueLines: [], speakerTagged: false };
  }

  const parsedLines: ParsedDialogueLine[] = [];

  for (const line of lines) {
    const match = line.match(/^([^:]{1,120})\s*:\s*(.+)$/);

    if (!match) {
      return { dialogueLines: [], speakerTagged: false };
    }

    const speaker = trimWrappedQuotes(match[1] ?? "");
    const text = trimWrappedQuotes(match[2] ?? "");

    if (!speaker || !text) {
      return { dialogueLines: [], speakerTagged: false };
    }

    parsedLines.push({
      speaker,
      speakerKey: normalizeSpeakerKey(speaker),
      text,
    });
  }

  return {
    dialogueLines: parsedLines,
    speakerTagged: parsedLines.length > 0,
  };
}

export function buildSpeakerTaggedDialogueTranscript(
  dialogueLines: ParsedDialogueLine[],
): string | null {
  const normalizedLines = dialogueLines
    .map((line) => ({
      speaker: trimWrappedQuotes(line.speaker ?? "").trim(),
      speakerKey: normalizeSpeakerKey(line.speakerKey ?? line.speaker ?? ""),
      text: trimWrappedQuotes(line.text ?? "").trim(),
    }))
    .filter((line) => line.speaker && line.speakerKey && line.text);

  if (normalizedLines.length === 0) {
    return null;
  }

  return normalizedLines.map((line) => `${line.speaker}: ${line.text}`).join("\n");
}

export function buildDialoguePreview(
  transcript: string | null,
  dialogueLines: ParsedDialogueLine[],
): string | null {
  if (dialogueLines.length > 0) {
    return dialogueLines
      .slice(0, 2)
      .map((line) => `${line.speaker}: ${line.text}`)
      .join(" / ")
      .slice(0, 220);
  }

  if (isNoneValue(transcript)) {
    return null;
  }

  return trimWrappedQuotes(transcript ?? "").replace(/\s+/g, " ").slice(0, 220) || null;
}

function deriveInlineDialogueSpeaker(prefix: string, lineIndex: number): string {
  const cleaned = prefix
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,:;\-.–—\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = cleaned.toLowerCase();

  if (!cleaned) {
    return "On-Screen Character";
  }

  if (/\b(phone|telefon)\b/.test(normalized)) {
    return "Phone Voice";
  }

  if (/\bradio\b/.test(normalized)) {
    return "Radio Voice";
  }

  if (/\bintercom\b/.test(normalized)) {
    return "Intercom Voice";
  }

  if (/\boff[- ]screen\b/.test(normalized)) {
    return "Off-Screen Voice";
  }

  if (/\b(komutan|commander)\b/.test(normalized)) {
    return /\bkomutan\b/.test(normalized) ? "Komutan" : "Commander";
  }

  if (/\b(asker|soldier)\b/.test(normalized)) {
    return /\basker\b/.test(normalized) ? "Asker" : "Soldier";
  }

  if (/\b(omer|ömer)\b/.test(normalized)) {
    return "Omer";
  }

  if (
    /^(steadily|firmly|quietly|softly|coldly|slowly|calmly|gravely|harshly|sharply|flatly|coldly|angrily|whispering|whispers|murmurs|replies|responds|says)$/i.test(
      normalized,
    )
  ) {
    return "On-Screen Character";
  }

  const cueOnly = normalized
    .replace(/[^\w\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const performanceCueWords = new Set([
    "and",
    "firmly",
    "respectfully",
    "peacefully",
    "quietly",
    "softly",
    "coldly",
    "slowly",
    "calmly",
    "gravely",
    "harshly",
    "sharply",
    "flatly",
    "angrily",
    "hesitantly",
    "steadily",
    "carefully",
    "solemnly",
    "tensely",
    "bitterly",
    "grimly",
    "fiercely",
    "breathlessly",
    "urgently",
    "gently",
    "cold",
    "firm",
    "respectful",
    "steady",
    "with",
    "absolute",
    "conviction",
    "without",
    "hesitation",
  ]);

  if (
    cueOnly.length > 0 &&
    cueOnly.every((word) => performanceCueWords.has(word))
  ) {
    return "On-Screen Character";
  }

  return cleaned.length <= 48 ? titleCase(cleaned) : `Speaker ${lineIndex + 1}`;
}

function parseInlineKlingDialogue(promptVideo: string): ParsedAudioDirection | null {
  const normalized = normalizeText(promptVideo);
  const withoutAvoid = normalized.replace(/\n?Avoid:\s*[\s\S]*$/i, "").trim();
  const lines = withoutAvoid
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const dialogueLines: ParsedDialogueLine[] = [];
  const blockLines: string[] = [];

  for (const line of lines) {
    const firstQuoteIndex = line.indexOf("\"");
    const secondQuoteIndex =
      firstQuoteIndex >= 0 ? line.indexOf("\"", firstQuoteIndex + 1) : -1;

    if (firstQuoteIndex < 0 || secondQuoteIndex <= firstQuoteIndex + 1) {
      continue;
    }

    const spokenText = line.slice(firstQuoteIndex + 1, secondQuoteIndex).trim();

    if (!spokenText) {
      continue;
    }

    const prefix = line.slice(0, firstQuoteIndex).trim();
    const speaker = deriveInlineDialogueSpeaker(prefix, dialogueLines.length);

    dialogueLines.push({
      speaker,
      speakerKey: normalizeSpeakerKey(speaker),
      text: spokenText,
    });
    blockLines.push(line);
  }

  if (dialogueLines.length === 0) {
    return null;
  }

  const dialogueTranscript = dialogueLines
    .map((line) => `${line.speaker}: ${line.text}`)
    .join("\n");

  return {
    language: inferLanguageFromDialogue(dialogueLines),
    type: "dialogue",
    dialogueTranscript,
    dialogueLines,
    dialoguePreview: buildDialoguePreview(dialogueTranscript, dialogueLines),
    speakerTagged: true,
    sfx: [],
    ambience: [],
    music: null,
    mixTarget: null,
    hasSubtitles: !/captions|subtitles/i.test(normalized),
    blockText: blockLines.join("\n"),
  };
}

export function extractAudioDirectionBlock(promptVideo: string): AudioDirectionExtraction {
  const normalizedPrompt = normalizeText(promptVideo);
  const headerMatch = AUDIO_DIRECTION_HEADER_REGEX.exec(normalizedPrompt);

  if (!headerMatch || typeof headerMatch.index !== "number") {
    return {
      audioBlock: null,
      promptWithoutAudioBlock: normalizedPrompt.trim(),
      hasAudioDirection: false,
    };
  }

  const audioStart = headerMatch.index;
  const afterAudioStart = normalizedPrompt.slice(audioStart);
  const avoidMatch = AVOID_HEADER_REGEX.exec(afterAudioStart);
  const audioEnd =
    avoidMatch && typeof avoidMatch.index === "number"
      ? audioStart + avoidMatch.index
      : normalizedPrompt.length;
  const beforeAudio = normalizedPrompt.slice(0, audioStart).trimEnd();
  const afterAudio = normalizedPrompt.slice(audioEnd).trimStart();
  const promptWithoutAudioBlock = [beforeAudio, afterAudio].filter(Boolean).join("\n\n").trim();

  return {
    audioBlock: normalizedPrompt.slice(audioStart, audioEnd).trim(),
    promptWithoutAudioBlock,
    hasAudioDirection: true,
  };
}

export function parseAudioDirection(promptVideo: string): ParsedAudioDirection | null {
  const extraction = extractAudioDirectionBlock(promptVideo);

  if (!extraction.audioBlock) {
    return parseInlineKlingDialogue(promptVideo);
  }

  const lines = extraction.audioBlock.split("\n");
  const fields: ScratchFields = {
    language: null,
    type: null,
    dialogueTranscript: null,
    sfx: null,
    ambience: null,
    music: null,
    mixTarget: null,
  };
  let hasSubtitles = true;
  let currentField: keyof ScratchFields | null = null;

  for (const rawLine of lines.slice(1)) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    const cleanLine = cleanContinuationLine(rawLine);

    if (/^No on-screen subtitles\/captions\.?$/i.test(cleanLine)) {
      hasSubtitles = false;
      currentField = null;
      continue;
    }

    const fieldMatch = rawLine.match(/^\s*(?:[-*]\s*)?([^:]+?)\s*:\s*(.*)$/);

    if (fieldMatch) {
      const nextField = normalizeFieldName(fieldMatch[1] ?? "");

      if (nextField) {
        currentField = nextField;
        const nextValue = cleanContinuationLine(fieldMatch[2] ?? "");

        if (nextValue) {
          fields[currentField] = appendFieldValue(fields[currentField], nextValue);
        }

        continue;
      }
    }

    if (currentField) {
      fields[currentField] = appendFieldValue(
        fields[currentField],
        cleanContinuationLine(rawLine),
      );
    }
  }

  const resolvedType = normalizeType(fields.type);
  const normalizedTranscript = isNoneValue(fields.dialogueTranscript)
    ? null
    : trimWrappedQuotes(fields.dialogueTranscript ?? "");
  let { dialogueLines, speakerTagged } = parseDialogueLines(normalizedTranscript);

  const isVoiceableType =
    resolvedType === "voiceover" ||
    resolvedType === "dialogue" ||
    resolvedType === "mixed";

  if (isVoiceableType && normalizedTranscript && !speakerTagged) {
    const paragraphs = normalizedTranscript
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\n/g, " ").trim())
      .filter(Boolean);
    const voiceoverLines =
      paragraphs.length > 0
        ? paragraphs
        : [normalizedTranscript.trim()];

    dialogueLines = voiceoverLines.map((text) => ({
      speaker: "Anlatici",
      speakerKey: "anlatici",
      text,
    }));
    speakerTagged = true;
  }

  return {
    language: normalizeLanguage(fields.language),
    type: resolvedType,
    dialogueTranscript: normalizedTranscript,
    dialogueLines,
    dialoguePreview: buildDialoguePreview(normalizedTranscript, dialogueLines),
    speakerTagged,
    sfx: parseListField(fields.sfx),
    ambience: parseListField(fields.ambience),
    music: isNoneValue(fields.music) ? null : trimWrappedQuotes(fields.music ?? ""),
    mixTarget: parseMixTarget(fields.mixTarget),
    hasSubtitles,
    blockText: extraction.audioBlock,
  };
}

export function applyDialogueLineOverride(
  audioDirection: ParsedAudioDirection | null,
  overrideLines: ParsedDialogueLine[] | null | undefined,
): ParsedAudioDirection | null {
  if (!audioDirection) {
    return null;
  }

  const normalizedLines = (overrideLines ?? [])
    .map((line) => ({
      speaker: trimWrappedQuotes(line.speaker ?? "").trim(),
      speakerKey: normalizeSpeakerKey(line.speakerKey ?? line.speaker ?? ""),
      text: trimWrappedQuotes(line.text ?? "").trim(),
    }))
    .filter((line) => line.speaker && line.speakerKey && line.text);

  if (normalizedLines.length === 0) {
    return audioDirection;
  }

  const dialogueTranscript = buildSpeakerTaggedDialogueTranscript(normalizedLines);

  return {
    ...audioDirection,
    dialogueTranscript,
    dialogueLines: normalizedLines,
    dialoguePreview: buildDialoguePreview(dialogueTranscript, normalizedLines),
    speakerTagged: true,
  };
}

export function buildNormalizedDialogueContent(
  audioDirection: ParsedAudioDirection | null,
): string | null {
  if (!audioDirection?.dialogueTranscript) {
    return null;
  }

  if (audioDirection.speakerTagged && audioDirection.dialogueLines.length > 0) {
    return audioDirection.dialogueLines
      .map((line) => `${line.speakerKey}:${line.text.trim().replace(/\s+/g, " ")}`)
      .join("\n");
  }

  return audioDirection.dialogueTranscript.trim().replace(/\s+/g, " ");
}

export function createAudioContentHash(
  audioDirection: ParsedAudioDirection | null,
): string | null {
  const normalizedContent = buildNormalizedDialogueContent(audioDirection);

  if (!normalizedContent) {
    return null;
  }

  const seed = `${audioDirection?.language ?? "none"}|${audioDirection?.type ?? "none"}|${normalizedContent}`;
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0).toString(16).padStart(8, "0");
}

export function buildVoiceoverAudioDirection(
  voiceoverText: string,
  existingDirection?: ParsedAudioDirection | null,
): ParsedAudioDirection {
  const paragraphs = voiceoverText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  const lines: ParsedDialogueLine[] =
    paragraphs.length > 0
      ? paragraphs.map((text) => ({
          speaker: "Anlatici",
          speakerKey: "anlatici",
          text,
        }))
      : [
          {
            speaker: "Anlatici",
            speakerKey: "anlatici",
            text: voiceoverText.trim(),
          },
        ];
  const transcript = lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");

  return {
    language: inferLanguageFromDialogue(lines),
    type: "voiceover",
    dialogueTranscript: transcript,
    dialogueLines: lines,
    dialoguePreview: buildDialoguePreview(transcript, lines),
    speakerTagged: true,
    sfx: existingDirection?.sfx ?? [],
    ambience: existingDirection?.ambience ?? [],
    music: existingDirection?.music ?? null,
    mixTarget: existingDirection?.mixTarget ?? null,
    hasSubtitles: false,
    blockText: voiceoverText,
  };
}

export function resolveAudioShotStatus(
  audioDirection: ParsedAudioDirection | null,
): AudioShotStatus {
  if (!audioDirection?.dialogueTranscript) {
    return "none";
  }

  if (audioDirection.type === "voiceover") {
    return "pending";
  }

  if (!audioDirection.speakerTagged || audioDirection.dialogueLines.length === 0) {
    return "blocked";
  }

  return "pending";
}

export function normalizeAudioSpeakerKey(value: string): string {
  return normalizeSpeakerKey(value);
}
