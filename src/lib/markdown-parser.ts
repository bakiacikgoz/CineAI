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
  summaryTr: string | null;
  requiresExternalReference: boolean;
  externalReferenceName: string | null;
  externalReferenceNotes: string | null;
  sourceFile: string;
}

const START_PROMPT_HEADINGS = ["ILK FRAME", "İLK FRAME", "START FRAME"];
const END_PROMPT_HEADINGS = ["SON FRAME", "END FRAME"];
const VIDEO_PROMPT_HEADINGS = ["VIDEO", "VİDEO"];

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

  const parsedShots: ParsedShot[] = [
    {
      shotNumber,
      parentShotNum,
      act,
      scene,
      shotType: inferShotType(`${typeContext}\n${md}`, parentShotNum ? "wide" : "main"),
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
      durationS: null,
      tensionLevel: null,
      chainStatus: "break",
      prevShotRef: null,
      model,
      cfg,
      klingPreset,
      transitionMode: null,
      promptStart: coveragePromptStart,
      promptEnd: extractPromptAfterHeading(block, END_PROMPT_HEADINGS),
      promptVideo: coveragePromptVideo,
      summaryTr: null,
      requiresExternalReference: coverageReferenceRequirement.requiresExternalReference,
      externalReferenceName: coverageReferenceRequirement.externalReferenceName,
      externalReferenceNotes: coverageReferenceRequirement.externalReferenceNotes,
      sourceFile,
    });
  }

  return parsedShots;
}

function extractCoverageSection(markdown: string): string | null {
  const match = markdown.match(
    /^##\s+Coverage\s+Shots\b[^\n]*$(?:\n+)([\s\S]*?)(?=^##\s+|\Z)/im,
  );
  return match?.[1]?.trim() ?? null;
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
  return match?.[groupIndex]?.trim() ?? null;
}

function extractNumericValue(markdown: string, pattern: RegExp): number | null {
  const match = markdown.match(pattern);
  return match ? Number.parseFloat(match[1]) : null;
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
  const headingMatch = markdown.match(
    /^#{1,4}\s*(?:🇹🇷\s*)?(?:Turkce|Türkçe)\s+Ozet\s*$(?:\n+)([\s\S]*?)(?=^#{1,4}\s+|\Z)/im,
  );

  if (!headingMatch) {
    return null;
  }

  const firstLine = headingMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine ?? null;
}

function inferShotType(block: string, fallback: ParsedShotType): ParsedShotType {
  if (/reaction/i.test(block)) {
    return "reaction";
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

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").trim();
}
