import { describe, expect, it } from "vitest";
import {
  buildCharacterGenerationPrompt,
  buildCharacterPromptHint,
  composeShotCharacterPrompt,
} from "@/lib/character-studio";

describe("character studio helpers", () => {
  it("builds a stable generation prompt from profile and look fields", () => {
    const prompt = buildCharacterGenerationPrompt(
      "Mara",
      {
        role: "undercover detective",
        skinTone: "olive",
        hairStyle: "shoulder-length waves",
        hairColor: "dark brown",
      },
      {
        wardrobe: "dark wool trench coat",
        accessories: "silver signet ring",
      },
    );

    expect(prompt).toContain("Mara is a undercover detective");
    expect(prompt).toContain("skin tone: olive");
    expect(prompt).toContain("wardrobe: dark wool trench coat");
    expect(prompt).toContain("silver signet ring");
  });

  it("builds a concise prompt hint for shot continuity", () => {
    const hint = buildCharacterPromptHint(
      "Mara",
      {
        perceivedAge: "early 30s",
        skinTone: "olive",
      },
      {
        wardrobe: "dark wool trench coat",
        mood: "controlled tension",
      },
    );

    expect(hint).toContain("Mara:");
    expect(hint).toContain("early 30s");
    expect(hint).toContain("dark wool trench coat");
    expect(hint).toContain("controlled tension");
  });

  it("prepends character hint to shot prompt only when enabled", () => {
    expect(
      composeShotCharacterPrompt("A quiet close-up in rain.", "Mara: olive skin | trench coat", true),
    ).toContain("Mara: olive skin | trench coat");

    expect(
      composeShotCharacterPrompt("A quiet close-up in rain.", "Mara: olive skin | trench coat", false),
    ).toBe("A quiet close-up in rain.");
  });
});
