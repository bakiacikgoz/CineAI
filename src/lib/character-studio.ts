export interface CharacterProfile {
  role: string;
  perceivedAge: string;
  genderExpression: string;
  ethnicity: string;
  skinTone: string;
  bodyType: string;
  faceShape: string;
  eyeDetails: string;
  hairStyle: string;
  hairColor: string;
  facialHair: string;
  marks: string;
  posture: string;
  continuityNotes: string;
  avoidList: string;
  globalNotes: string;
}

export interface CharacterLookAttributes {
  wardrobe: string;
  palette: string;
  materials: string;
  accessories: string;
  hairOverride: string;
  makeupOverride: string;
  mood: string;
  sceneContext: string;
  continuityNotes: string;
}

export const EMPTY_CHARACTER_PROFILE: CharacterProfile = {
  role: "",
  perceivedAge: "",
  genderExpression: "",
  ethnicity: "",
  skinTone: "",
  bodyType: "",
  faceShape: "",
  eyeDetails: "",
  hairStyle: "",
  hairColor: "",
  facialHair: "",
  marks: "",
  posture: "",
  continuityNotes: "",
  avoidList: "",
  globalNotes: "",
};

export const EMPTY_CHARACTER_LOOK_ATTRIBUTES: CharacterLookAttributes = {
  wardrobe: "",
  palette: "",
  materials: "",
  accessories: "",
  hairOverride: "",
  makeupOverride: "",
  mood: "",
  sceneContext: "",
  continuityNotes: "",
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCharacterProfile(
  input?: Partial<CharacterProfile> | null,
): CharacterProfile {
  return {
    role: normalizeString(input?.role),
    perceivedAge: normalizeString(input?.perceivedAge),
    genderExpression: normalizeString(input?.genderExpression),
    ethnicity: normalizeString(input?.ethnicity),
    skinTone: normalizeString(input?.skinTone),
    bodyType: normalizeString(input?.bodyType),
    faceShape: normalizeString(input?.faceShape),
    eyeDetails: normalizeString(input?.eyeDetails),
    hairStyle: normalizeString(input?.hairStyle),
    hairColor: normalizeString(input?.hairColor),
    facialHair: normalizeString(input?.facialHair),
    marks: normalizeString(input?.marks),
    posture: normalizeString(input?.posture),
    continuityNotes: normalizeString(input?.continuityNotes),
    avoidList: normalizeString(input?.avoidList),
    globalNotes: normalizeString(input?.globalNotes),
  };
}

export function normalizeCharacterLookAttributes(
  input?: Partial<CharacterLookAttributes> | null,
): CharacterLookAttributes {
  return {
    wardrobe: normalizeString(input?.wardrobe),
    palette: normalizeString(input?.palette),
    materials: normalizeString(input?.materials),
    accessories: normalizeString(input?.accessories),
    hairOverride: normalizeString(input?.hairOverride),
    makeupOverride: normalizeString(input?.makeupOverride),
    mood: normalizeString(input?.mood),
    sceneContext: normalizeString(input?.sceneContext),
    continuityNotes: normalizeString(input?.continuityNotes),
  };
}

function withPeriod(value: string): string {
  return value ? `${value.replace(/[.]+$/g, "")}.` : "";
}

function joinSentence(parts: string[]): string {
  const filtered = parts.filter(Boolean);
  return filtered.length > 0 ? withPeriod(filtered.join(", ")) : "";
}

function buildIdentitySentence(
  characterName: string,
  profile: CharacterProfile,
): string {
  const identityParts = [
    profile.role && `${characterName} is a ${profile.role}`,
    profile.perceivedAge && `appears ${profile.perceivedAge}`,
    profile.genderExpression && `with ${profile.genderExpression} presentation`,
    profile.ethnicity && `ethnicity/background: ${profile.ethnicity}`,
    profile.skinTone && `skin tone: ${profile.skinTone}`,
  ].filter(Boolean) as string[];

  return withPeriod(identityParts.join(", "));
}

export function buildCharacterGenerationPrompt(
  characterName: string,
  profileInput?: Partial<CharacterProfile> | null,
  lookInput?: Partial<CharacterLookAttributes> | null,
): string {
  const profile = normalizeCharacterProfile(profileInput);
  const look = normalizeCharacterLookAttributes(lookInput);
  const safeName = normalizeString(characterName) || "The character";
  const paragraphs = [
    buildIdentitySentence(safeName, profile),
    joinSentence([
      profile.bodyType && `body type: ${profile.bodyType}`,
      profile.faceShape && `face shape: ${profile.faceShape}`,
      profile.eyeDetails && `eyes: ${profile.eyeDetails}`,
      profile.hairStyle && `hair style: ${profile.hairStyle}`,
      profile.hairColor && `hair color: ${profile.hairColor}`,
      profile.facialHair && `facial hair: ${profile.facialHair}`,
      profile.marks && `distinct marks: ${profile.marks}`,
      profile.posture && `posture/body language: ${profile.posture}`,
    ]),
    joinSentence([
      look.wardrobe && `wardrobe: ${look.wardrobe}`,
      look.palette && `color palette: ${look.palette}`,
      look.materials && `materials/textures: ${look.materials}`,
      look.accessories && `accessories: ${look.accessories}`,
      look.hairOverride && `hair styling for this look: ${look.hairOverride}`,
      look.makeupOverride && `makeup/grooming: ${look.makeupOverride}`,
      look.mood && `mood/energy: ${look.mood}`,
      look.sceneContext && `scene context: ${look.sceneContext}`,
    ]),
    withPeriod(
      [
        profile.continuityNotes && `Continuity anchors: ${profile.continuityNotes}`,
        look.continuityNotes && `Look-specific continuity: ${look.continuityNotes}`,
        profile.globalNotes && `Additional notes: ${profile.globalNotes}`,
        profile.avoidList && `Avoid: ${profile.avoidList}`,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    "Generate a cinematic, production-ready character reference portrait with realistic anatomy, clean facial detail, clear costume readability, and consistent identity across future shots.",
  ].filter(Boolean);

  return paragraphs.join("\n\n").trim();
}

export function buildCharacterPromptHint(
  characterName: string,
  profileInput?: Partial<CharacterProfile> | null,
  lookInput?: Partial<CharacterLookAttributes> | null,
): string {
  const profile = normalizeCharacterProfile(profileInput);
  const look = normalizeCharacterLookAttributes(lookInput);
  const safeName = normalizeString(characterName) || "Character";

  return [
    `${safeName}:`,
    [
      profile.role,
      profile.perceivedAge,
      profile.genderExpression,
      profile.ethnicity,
      profile.skinTone,
      profile.bodyType,
      profile.faceShape,
      profile.eyeDetails,
      profile.hairStyle && [profile.hairStyle, profile.hairColor].filter(Boolean).join(", "),
      profile.facialHair,
      profile.marks,
      look.wardrobe,
      look.palette,
      look.accessories,
      look.mood,
      look.sceneContext,
      look.continuityNotes || profile.continuityNotes,
    ]
      .filter(Boolean)
      .join(" | "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function composeShotCharacterPrompt(
  basePrompt: string,
  characterPromptHint: string | null | undefined,
  includeCharacterPrompt: boolean,
): string {
  const normalizedBasePrompt = normalizeString(basePrompt);

  if (!includeCharacterPrompt || !normalizeString(characterPromptHint)) {
    return normalizedBasePrompt;
  }

  return `${normalizeString(characterPromptHint)}\n\n${normalizedBasePrompt}`.trim();
}

export function summarizeCharacterProfile(
  profileInput?: Partial<CharacterProfile> | null,
  fallback?: string | null,
): string {
  const profile = normalizeCharacterProfile(profileInput);
  const summary = [
    profile.role,
    profile.perceivedAge,
    profile.skinTone,
    profile.hairStyle && [profile.hairStyle, profile.hairColor].filter(Boolean).join(" "),
    profile.globalNotes,
  ]
    .filter(Boolean)
    .join(" | ");

  return summary || normalizeString(fallback);
}
