import { describe, expect, it } from "vitest";
import {
  applyCharacterOutfitPreset,
  getCharacterOutfitPreset,
} from "@/lib/character-outfit-presets";
import { EMPTY_CHARACTER_LOOK_ATTRIBUTES } from "@/lib/character-studio";

describe("character outfit presets", () => {
  it("preserves source references while overriding wardrobe fields", () => {
    const preset = getCharacterOutfitPreset("suit");

    expect(preset).not.toBeNull();

    const look = applyCharacterOutfitPreset({
      sourceLook: {
        id: "look-base",
        name: "Default Look",
        attributes: {
          ...EMPTY_CHARACTER_LOOK_ATTRIBUTES,
          wardrobe: "hoodie",
          palette: "gray",
          continuityNotes: "Keep scar under left eye visible",
        },
        generationPrompt: "manual prompt",
        promptLocked: true,
        refImages: ["characters/mara/front.png", "characters/mara/side.png"],
        primaryImage: "characters/mara/front.png",
      },
      preset: preset!,
      nextId: "look-suit",
    });

    expect(look.id).toBe("look-suit");
    expect(look.name).toBe("Takim Elbise");
    expect(look.attributes.wardrobe).toContain("well-tailored suit");
    expect(look.attributes.continuityNotes).toContain("Keep scar under left eye visible");
    expect(look.generationPrompt).toBe("");
    expect(look.promptLocked).toBe(false);
    expect(look.refImages).toEqual(["characters/mara/front.png", "characters/mara/side.png"]);
    expect(look.primaryImage).toBe("characters/mara/front.png");
  });

  it("applies custom overrides deterministically without dropping identity anchors", () => {
    const preset = getCharacterOutfitPreset("profession");

    expect(preset).not.toBeNull();

    const look = applyCharacterOutfitPreset({
      sourceLook: {
        id: "look-base",
        name: "Default Look",
        attributes: {
          ...EMPTY_CHARACTER_LOOK_ATTRIBUTES,
          accessories: "signet ring",
          continuityNotes: "Same face and posture",
        },
        generationPrompt: "",
        promptLocked: false,
        refImages: ["characters/mara/front.png"],
        primaryImage: "characters/mara/front.png",
      },
      preset: preset!,
      customName: "Cerrah Uniformasi",
      customOverrides: {
        wardrobe: "sterile surgeon scrubs with surgical cap",
        sceneContext: "hospital operating room",
        continuityNotes: "Keep scar under left eye visible",
      },
    });

    expect(look.name).toBe("Cerrah Uniformasi");
    expect(look.attributes.wardrobe).toBe("sterile surgeon scrubs with surgical cap");
    expect(look.attributes.sceneContext).toBe("hospital operating room");
    expect(look.attributes.accessories).toBe("role-appropriate utility accessories and tools");
    expect(look.attributes.continuityNotes).toContain("Same face and posture");
    expect(look.attributes.continuityNotes).toContain("Keep scar under left eye visible");
  });
});
