import { parseAudioDirection, type ParsedAudioDirection } from "@/lib/audio-direction-parser";

export type ParsedShotType =
  | "main"
  | "wide"
  | "ots"
  | "close"
  | "detail"
  | "reaction";

export interface ParsedShot {
  shotNumber: string;
  parentShotNum: string | null;
  act: number | null;
  scene: number | null;
  shotType: ParsedShotType;
  cameraAngle: string | null;
  durationS: number | null;
  tensionLevel: number | null;
  chainStatus: "continue" | "break";
  prevShotRef: string | null;
  model: string | null;
  cfg: number | null;
  klingPreset: string | null;
  transitionMode: string | null;
  promptStart: string | null;
  promptEnd: string | null;
  promptVideo: string | null;
  audioDirection: ParsedAudioDirection | null;
  summaryTr: string | null;
  requiresExternalReference: boolean;
  externalReferenceName: string | null;
  externalReferenceNotes: string | null;
  sourceFile: string;
}

const START_PROMPT_HEADINGS = ["ILK FRAME", "\u0130LK FRAME", "Ä°LK FRAME", "START FRAME"];
const END_PROMPT_HEADINGS = ["SON FRAME", "END FRAME"];
const VIDEO_PROMPT_HEADINGS = ["VIDEO", "V\u0130DEO", "VÄ°DEO"];
const SUMMARY_HEADINGS = [
  "TR Summary",
  "Turkce Ozet",
  "Turkce Özet",
  "T\u00fcrk\u00e7e Ozet",
  "T\u00fcrk\u00e7e \u00d6zet",
  "TÃ¼rkÃ§e Ozet",
];

export function parseShot(markdown: string, sourceFile: string): ParsedShot[] {
  const md = normalizeMarkdown(markdown);
  const headerMatch = md.match(
    /^#\s+(SHOT[A-Z0-9]+)(?:\s*\|\s*(\d+)\s*(?:s|sn))?(?:[\s\S]{0,120}?Tension:\s*(\d+))?/im,
  );

  if (!headerMatch) {
    return [];
  }

  const shotNumber = headerMatch[1].toUpperCase();
  const durationS = headerMatch[2] ? Number.parseInt(headerMatch[2], 10) : null;
  const tensionLevel = headerMatch[3] ? Number.parseInt(headerMatch[3], 10) : null;
  let promptStart: string | null = null;
  let promptEnd: string | null = null;
  let promptVideo: string | null = null;
  const parentShotNum = getParentShotNumber(shotNumber);
  const typeContext = headerMatch[0];
  const { act, scene } = extractActScene(sourceFile);
  const cameraAngle = extractSingleLineValue(md, /Camera(?:\s+Angle)?\s*:\s*([^\n]+)/i);
  const model = extractSingleLineValue(md, /Model\s*:\s*([^\n]+)/i);
  const cfg = extractNumericValue(md, /CFG\s*:\s*([\d.]+)/i);
  const klingPreset = extractSingleLineValue(md, /(Kling\s+)?Preset\s*:\s*([^\n]+)/i, 2);
  const transitionMode = extractSingleLineValue(
    md,
    /Transition(?:\s+Mode)?\s*:\s*([^\n]+)/i,
  );
  const chainStatus = extractChainStatus(md);
  const prevShotRef = extractPrevShotRef(md, chainStatus);
  const summaryTr = extractSummary(md);
  const mainReferenceRequirement = extractExternalReferenceRequirement(md);
  promptStart = extractPromptAfterHeading(md, START_PROMPT_HEADINGS);
  promptEnd = extractPromptAfterHeading(md, END_PROMPT_HEADINGS);
  promptVideo = extractPromptAfterHeading(md, VIDEO_PROMPT_HEADINGS);
  const audioDirection = promptVideo ? parseAudioDirection(promptVideo) : null;

  const parsedShots: ParsedShot[] = [
    {
      shotNumber,
      parentShotNum,
      act,
      scene,
      shotType: inferShotType(typeContext, parentShotNum ? "wide" : "main"),
      cameraAngle,
      durationS,
      tensionLevel,
      chainStatus,
      prevShotRef,
      model,
      cfg,
      klingPreset,
      transitionMode,
      promptStart,
      promptEnd,
      promptVideo,
      audioDirection,
      summaryTr,
      requiresExternalReference: mainReferenceRequirement.requiresExternalReference,
      externalReferenceName: mainReferenceRequirement.externalReferenceName,
      externalReferenceNotes: mainReferenceRequirement.externalReferenceNotes,
      sourceFile,
    },
  ];

  const coverageSection = extractCoverageSection(md);

  if (!coverageSection) {
    return parsedShots;
  }

  const coverageBlocks = coverageSection
    .split(/(?=^###\s+)/m)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of coverageBlocks) {
    const coverageShotMatch = block.match(/\b(SHOT[A-Z0-9]+)\b/i);

    if (!coverageShotMatch) {
      continue;
    }

    const coverageShotNumber = coverageShotMatch[1].toUpperCase();
    const coverageDurationS = extractShotDuration(block);
    const coverageTensionLevel = extractShotTension(block);

    const fallbackCodeBlocks = extractCodeBlocks(block);
    const coveragePromptStart =
      extractPromptAfterHeading(block, START_PROMPT_HEADINGS) ?? fallbackCodeBlocks[0] ?? null;
    const coveragePromptVideo =
      extractPromptAfterHeading(block, VIDEO_PROMPT_HEADINGS) ?? fallbackCodeBlocks[1] ?? null;
    const coverageReferenceRequirement = extractExternalReferenceRequirement(block);

    parsedShots.push({
      shotNumber: coverageShotNumber,
      parentShotNum: shotNumber,
      act,
      scene,
      shotType: inferShotType(block, "wide"),
      cameraAngle: extractSingleLineValue(block, /Camera(?:\s+Angle)?\s*:\s*([^\n]+)/i),
      durationS: coverageDurationS,
      tensionLevel: coverageTensionLevel,
      chainStatus: "break",
      prevShotRef: null,
      model,
      cfg,
      klingPreset,
      transitionMode: null,
      promptStart: coveragePromptStart,
      promptEnd: extractPromptAfterHeading(block, END_PROMPT_HEADINGS),
      promptVideo: coveragePromptVideo,
      audioDirection: coveragePromptVideo ? parseAudioDirection(coveragePromptVideo) : null,
      summaryTr: extractSummary(block),
      requiresExternalReference: coverageReferenceRequirement.requiresExternalReference,
      externalReferenceName: coverageReferenceRequirement.externalReferenceName,
      externalReferenceNotes: coverageReferenceRequirement.externalReferenceNotes,
      sourceFile,
    });
  }

  return parsedShots;
}

function extractCoverageSection(markdown: string): string | null {
  const headingMatch = markdown.match(/^##\s+Coverage\s+Shots\b[^\n]*$/im);

  if (!headingMatch || headingMatch.index === undefined) {
    return null;
  }

  const contentStart = headingMatch.index + headingMatch[0].length;
  const remainder = markdown.slice(contentStart).replace(/^\s+/, "");
  const nextSectionMatch = remainder.match(/^##\s+/m);
  const section = nextSectionMatch?.index !== undefined
    ? remainder.slice(0, nextSectionMatch.index)
    : remainder;

  return section.trim() || null;
}

function getParentShotNumber(shotNumber: string): string | null {
  const match = shotNumber.match(/^(SHOT\d+)([A-Z]+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function extractActScene(sourceFile: string): { act: number | null; scene: number | null } {
  const match = sourceFile.match(/act[-_ ]?(\d+)[\\/]+scene[-_ ]?(\d+)/i);
  return {
    act: match ? Number.parseInt(match[1], 10) : null,
    scene: match ? Number.parseInt(match[2], 10) : null,
  };
}

function extractSingleLineValue(
  markdown: string,
  pattern: RegExp,
  groupIndex = 1,
): string | null {
  const match = markdown.match(pattern);
  return match?.[groupIndex] ? normalizeInlineMarkdownValue(match[groupIndex]) : null;
}

function extractNumericValue(markdown: string, pattern: RegExp): number | null {
  const match = markdown.match(pattern);
  return match ? Number.parseFloat(match[1]) : null;
}

function extractShotDuration(markdown: string): number | null {
  const headerMatch = markdown.match(/^\s*#{1,4}\s+SHOT[A-Z0-9]+(?:[^\n|]*\|\s*(\d+)\s*(?:s|sn))/im);
  return headerMatch?.[1] ? Number.parseInt(headerMatch[1], 10) : null;
}

function extractShotTension(markdown: string): number | null {
  const inlineMatch = markdown.match(/\bTension\s*:\s*(\d+)/i);

  if (inlineMatch?.[1]) {
    return Number.parseInt(inlineMatch[1], 10);
  }

  const frontmatterMatch = markdown.match(/^\s*tension\s*:\s*(\d+)\s*$/im);
  return frontmatterMatch?.[1] ? Number.parseInt(frontmatterMatch[1], 10) : null;
}

function extractPrevShotRef(
  markdown: string,
  chainStatus: ParsedShot["chainStatus"],
): string | null {
  if (chainStatus !== "continue") {
    return null;
  }

  const chainedFromMatch = markdown.match(
    /CHAIN(?:ED)?\s+FROM\s+(SHOT[A-Z0-9]+)_END/i,
  );

  if (chainedFromMatch) {
    return chainedFromMatch[1].toUpperCase();
  }

  const explicitChainMatch = markdown.match(/=\s*(SHOT[A-Z0-9]+)_END/i);

  if (explicitChainMatch) {
    return explicitChainMatch[1].toUpperCase();
  }

  const fallbackMatch = markdown.match(/Prev(?:ious)?\s+Shot\s*:\s*(SHOT[A-Z0-9]+)/i);
  return fallbackMatch?.[1]?.toUpperCase() ?? null;
}

function extractChainStatus(markdown: string): ParsedShot["chainStatus"] {
  if (/CHAIN\s+BREAK/i.test(markdown)) {
    return "break";
  }

  if (/CHAIN(?:ED)?\s+FROM\s+SHOT[A-Z0-9]+_END/i.test(markdown)) {
    return "continue";
  }

  if (/CHAIN\s+CONTINUE/i.test(markdown)) {
    return "continue";
  }

  return "break";
}

function extractExternalReferenceRequirement(markdown: string): {
  requiresExternalReference: boolean;
  externalReferenceName: string | null;
  externalReferenceNotes: string | null;
} {
  const referenceLockLine = markdown.match(/\[REFERENCE LOCK\][^\n]*/i)?.[0]?.trim() ?? null;
  const referenceFileMatch =
    markdown.match(
      /uploaded\s+reference(?:\s+image)?(?:\s*[:(]\s*|\s+)([a-z0-9._-]+\.(?:png|jpe?g|webp))/i,
    ) ??
    markdown.match(
      /reference\s+image(?:\s*[:(]\s*|\s+)([a-z0-9._-]+\.(?:png|jpe?g|webp))/i,
    ) ??
    markdown.match(
      /\b([a-z0-9._-]+\.(?:png|jpe?g|webp))\b/i,
    );

  const externalReferenceName = referenceFileMatch?.[1]?.trim() ?? null;
  const requiresExternalReference =
    /\[REFERENCE LOCK\]/i.test(markdown) ||
    /uploaded\s+reference(?:\s+image)?/i.test(markdown);

  return {
    requiresExternalReference,
    externalReferenceName,
    externalReferenceNotes: referenceLockLine,
  };
}

function extractSummary(markdown: string): string | null {
  const lines = markdown.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";

    if (!/^#{1,4}\s+/.test(line)) {
      continue;
    }

    if (!isSummaryHeadingLine(line)) {
      continue;
    }

    const summaryBlockLines: string[] = [];

    for (let contentIndex = index + 1; contentIndex < lines.length; contentIndex += 1) {
      const contentLine = lines[contentIndex] ?? "";

      if (/^#{1,4}\s+/.test(contentLine.trim())) {
        break;
      }

      summaryBlockLines.push(contentLine);
    }

    const firstLine = summaryBlockLines
      .map((entry) => entry.trim())
      .find((entry) => entry.length > 0);

    if (firstLine) {
      return firstLine;
    }
  }

  const inlineSummary = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) =>
      /^(?:TR(?:\s+Summary)?|Turkce\s+Ozet|T\u00fcrk\u00e7e\s+Ozet|TÃ¼rkÃ§e\s+Ozet)\s*:/i.test(line),
    );

  if (inlineSummary) {
    return (
      inlineSummary.replace(
        /^(?:TR(?:\s+Summary)?|Turkce\s+Ozet|T\u00fcrk\u00e7e\s+Ozet|TÃ¼rkÃ§e\s+Ozet)\s*:\s*/i,
        "",
      ).trim() || null
    );
  }

  const emojiSummaryLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^🇹🇷\s*/u.test(line));

  if (emojiSummaryLine) {
    const normalizedLine = emojiSummaryLine.replace(/^🇹🇷\s*/u, "").trim();
    const colonIndex = normalizedLine.indexOf(":");

    if (colonIndex >= 0) {
      const afterColon = normalizedLine.slice(colonIndex + 1).trim();

      if (afterColon) {
        return afterColon;
      }
    }

    if (normalizedLine) {
      return normalizedLine;
    }
  }

  const blockQuoteLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(">") && !/^>\s*START IMAGE\s*:/i.test(line));

  return blockQuoteLine ? blockQuoteLine.replace(/^>\s*/, "").trim() || null : null;
}

function inferShotType(block: string, fallback: ParsedShotType): ParsedShotType {
  if (/reaction/i.test(block)) {
    return "reaction";
  }

  if (/\bECU\b|extreme close[- ]up/i.test(block)) {
    return "close";
  }

  if (/insert/i.test(block)) {
    return "detail";
  }

  if (/cutaway/i.test(block)) {
    return "wide";
  }

  if (/detail/i.test(block)) {
    return "detail";
  }

  if (/close/i.test(block)) {
    return "close";
  }

  if (/\bOTS\b/i.test(block) || /over[- ]the[- ]shoulder/i.test(block)) {
    return "ots";
  }

  if (/wide/i.test(block)) {
    return "wide";
  }

  return fallback;
}

function extractPromptAfterHeading(markdown: string, headings: string[]): string | null {
  const headingRegex = new RegExp(
    `^#{2,4}\\s*(?:${headings.map(escapeRegex).join("|")})\\b[^\\n]*$`,
    "im",
  );
  const headingMatch = headingRegex.exec(markdown);

  if (!headingMatch || headingMatch.index === undefined) {
    return null;
  }

  const section = markdown.slice(headingMatch.index);
  const codeBlockMatch = section.match(/```(?:[\w-]+)?\n?([\s\S]*?)```/);
  return codeBlockMatch?.[1]?.trim() ?? null;
}

function extractCodeBlocks(markdown: string): string[] {
  return Array.from(markdown.matchAll(/```(?:[\w-]+)?\n?([\s\S]*?)```/g))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeInlineMarkdownValue(value: string): string {
  return value
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^`+/, "")
    .replace(/`+$/, "")
    .trim();
}

function normalizeSummaryHeadingLabel(value: string): string {
  return value
    .replace(/^[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSummaryHeadingLine(value: string): boolean {
  const normalizedLine = value
    .replace(/^#{1,4}\s+/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return SUMMARY_HEADINGS.some((heading) =>
    normalizedLine.includes(normalizeSummaryHeadingLabel(heading)),
  );
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").trim();
}
