import {
  normalizeCharacterLookAttributes,
  type CharacterLookAttributes,
} from "@/lib/character-studio";

export type CharacterOutfitPresetCategory =
  | "casual"
  | "formal"
  | "street"
  | "professional"
  | "uniform"
  | "distressed"
  | "custom";

export interface CharacterOutfitPreset {
  id: string;
  label: string;
  category: CharacterOutfitPresetCategory;
  overrides: Partial<CharacterLookAttributes>;
  continuityNote?: string;
  promptHint?: string;
}

export interface OutfitPresetLookLike {
  id: string;
  name: string;
  attributes: CharacterLookAttributes;
  generationPrompt: string;
  promptLocked: boolean;
  refImages: string[];
  primaryImage: string | null;
}

export interface ApplyCharacterOutfitPresetParams<TLook extends OutfitPresetLookLike> {
  sourceLook: TLook;
  preset: CharacterOutfitPreset;
  nextId?: string;
  customName?: string | null;
  customOverrides?: Partial<CharacterLookAttributes> | null;
}

export const CHARACTER_OUTFIT_PRESETS: CharacterOutfitPreset[] = [
  {
    id: "home",
    label: "Ev Hali",
    category: "casual",
    overrides: {
      wardrobe: "comfortable homewear, relaxed knit layers, soft indoor clothing",
      palette: "warm neutrals, soft earth tones",
      materials: "cotton, jersey, soft knit",
      accessories: "minimal everyday accessories",
      mood: "relaxed and natural",
      sceneContext: "at home, lived-in domestic setting",
    },
    continuityNote: "Keep facial identity, body proportions, and signature features unchanged.",
  },
  {
    id: "elegant",
    label: "Sik Giyim",
    category: "formal",
    overrides: {
      wardrobe: "elegant evening wear with premium tailoring and refined silhouette",
      palette: "deep jewel tones, black, ivory, metallic accents",
      materials: "silk, satin, fine wool, premium fabric textures",
      accessories: "curated statement accessories",
      mood: "confident and polished",
      sceneContext: "formal social setting or upscale venue",
    },
    continuityNote: "Preserve the same face, hairstyle identity, and recognizable silhouette.",
  },
  {
    id: "suit",
    label: "Takim Elbise",
    category: "formal",
    overrides: {
      wardrobe: "well-tailored suit with sharp fit and clean lines",
      palette: "charcoal, navy, black, crisp white",
      materials: "structured wool suiting, pressed cotton",
      accessories: "watch, tie, pocket square, understated formal details",
      mood: "composed and authoritative",
      sceneContext: "business, ceremony, or official environment",
    },
    continuityNote: "Keep hair, facial structure, and character identity consistent across views.",
  },
  {
    id: "street",
    label: "Sokak Giyimi",
    category: "street",
    overrides: {
      wardrobe: "modern streetwear with layered casual pieces",
      palette: "urban neutrals with bold accent color pops",
      materials: "denim, cotton, technical outerwear",
      accessories: "street accessories, bag, cap, layered details",
      mood: "confident and contemporary",
      sceneContext: "city street or neighborhood exterior",
    },
    continuityNote: "Preserve the same person while changing only wardrobe styling and mood.",
  },
  {
    id: "profession",
    label: "Meslek Kiyafeti",
    category: "professional",
    overrides: {
      wardrobe: "occupation-specific workwear or professional uniform aligned with the character role",
      palette: "functional professional tones",
      materials: "durable workwear textiles suitable for the profession",
      accessories: "role-appropriate utility accessories and tools",
      mood: "capable and focused",
      sceneContext: "professional workspace or role-specific environment",
    },
    continuityNote: "Keep the same face, age, and body identity while adapting the job clothing.",
    promptHint: "Use the custom form if a specific profession or department is required.",
  },
  {
    id: "turkish-police",
    label: "Turk Polis Kiyafeti",
    category: "uniform",
    overrides: {
      wardrobe: "modern Turkish police uniform with official tactical or patrol styling",
      palette: "navy, black, and official police accents",
      materials: "structured uniform fabric, duty belt materials",
      accessories: "badge, radio, duty belt, official uniform accessories",
      mood: "alert and disciplined",
      sceneContext: "street patrol, station exterior, or official duty setting",
    },
    continuityNote: "Maintain exact facial identity and avoid changing ethnicity, age, or body proportions.",
  },
  {
    id: "distressed",
    label: "Yipranmis / Homeless",
    category: "distressed",
    overrides: {
      wardrobe: "worn layered clothing, distressed fabrics, survival-oriented mismatched outfit",
      palette: "faded earth tones, dusty neutrals, weathered colors",
      materials: "frayed cotton, worn denim, rough layers",
      accessories: "patched bag, improvised layers, worn personal items",
      mood: "tired but resilient",
      sceneContext: "street corner, shelter area, or harsh urban environment",
    },
    continuityNote: "Keep the same person recognizable under the worn clothing and harsher styling.",
  },
  {
    id: "custom",
    label: "Custom Varyant",
    category: "custom",
    overrides: {},
    continuityNote: "Keep the same character identity and continuity anchors unless explicitly changed.",
  },
];

export function getCharacterOutfitPreset(
  presetId: string,
): CharacterOutfitPreset | null {
  return CHARACTER_OUTFIT_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

function joinUniqueParts(parts: Array<string | null | undefined>): string {
  const unique = Array.from(
    new Set(
      parts
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return unique.join(" | ");
}

export function applyCharacterOutfitPreset<TLook extends OutfitPresetLookLike>(
  params: ApplyCharacterOutfitPresetParams<TLook>,
): TLook {
  const { sourceLook, preset, nextId, customName, customOverrides } = params;
  const mergedAttributes = normalizeCharacterLookAttributes({
    ...sourceLook.attributes,
    ...preset.overrides,
    ...(customOverrides ?? {}),
  });

  const continuityNotes = joinUniqueParts([
    sourceLook.attributes.continuityNotes,
    preset.continuityNote,
    customOverrides?.continuityNotes,
  ]);

  return {
    ...sourceLook,
    id: nextId ?? sourceLook.id,
    name: customName?.trim() || preset.label,
    attributes: {
      ...mergedAttributes,
      continuityNotes,
    },
    generationPrompt: "",
    promptLocked: false,
    refImages: sourceLook.refImages.slice(),
    primaryImage: sourceLook.primaryImage,
  };
}
