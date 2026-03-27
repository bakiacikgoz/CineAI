import { describe, expect, it } from "vitest";
import {
  applyDialogueLineOverride,
  buildNormalizedDialogueContent,
  createAudioContentHash,
  extractAudioDirectionBlock,
  parseAudioDirection,
  resolveAudioShotStatus,
} from "@/lib/audio-direction-parser";

describe("audio direction parser", () => {
  it("parses speaker-tagged multiline dialogue blocks", () => {
    const parsed = parseAudioDirection(`
Camera moves through the bunker.

Audio direction:
- Language: TURKISH
- Type: Dialogue
- Dialogue transcript:
  Komutan: Anladim pasam. Hemen harekete geciyoruz.
  Yaver: Emirler birliklere aktarildi.
- SFX: Telephone click, paper rustling
- Ambience: Bunker acoustics, distant explosions muffled
- Music: NONE
- Mix target: Dialogue 70%, Ambience 25%, SFX 5%
- No on-screen subtitles/captions.
    `);

    expect(parsed).not.toBeNull();
    expect(parsed?.language).toBe("turkish");
    expect(parsed?.type).toBe("dialogue");
    expect(parsed?.speakerTagged).toBe(true);
    expect(parsed?.dialogueLines).toEqual([
      {
        speaker: "Komutan",
        speakerKey: "komutan",
        text: "Anladim pasam. Hemen harekete geciyoruz.",
      },
      {
        speaker: "Yaver",
        speakerKey: "yaver",
        text: "Emirler birliklere aktarildi.",
      },
    ]);
    expect(parsed?.sfx).toEqual(["Telephone click", "paper rustling"]);
    expect(parsed?.ambience).toEqual([
      "Bunker acoustics",
      "distant explosions muffled",
    ]);
    expect(parsed?.mixTarget).toEqual({
      dialogue: 70,
      ambience: 25,
      sfx: 5,
    });
    expect(parsed?.hasSubtitles).toBe(false);
    expect(resolveAudioShotStatus(parsed)).toBe("pending");
    expect(buildNormalizedDialogueContent(parsed)).toBe(
      "komutan:Anladim pasam. Hemen harekete geciyoruz.\nyaver:Emirler birliklere aktarildi.",
    );
    expect(createAudioContentHash(parsed)).toMatch(/^[a-f0-9]{8}$/);
  });

  it("keeps legacy inline dialogue visible but blocked", () => {
    const parsed = parseAudioDirection(`
Audio direction:
- Language: TURKISH
- Type: Dialogue
- Dialogue transcript: "Anladim pasam. Hemen harekete geciyoruz."
- Music: NONE
    `);

    expect(parsed?.dialogueTranscript).toBe("Anladim pasam. Hemen harekete geciyoruz.");
    expect(parsed?.speakerTagged).toBe(false);
    expect(parsed?.dialogueLines).toEqual([]);
    expect(parsed?.dialoguePreview).toContain("Anladim pasam");
    expect(resolveAudioShotStatus(parsed ?? null)).toBe("blocked");
  });

  it("returns null when there is no audio block", () => {
    expect(parseAudioDirection("Shot prompt only.")).toBeNull();
    expect(resolveAudioShotStatus(null)).toBe("none");
  });

  it("extracts audio block from prompt and preserves trailing avoid section", () => {
    const extraction = extractAudioDirectionBlock(`
Shot 1: Wide frame.

Audio direction:
- Language: TURKISH
- Type: Dialogue
- Dialogue transcript:
  Komutan: Hazir olun.

Avoid:
- blur
    `);

    expect(extraction.hasAudioDirection).toBe(true);
    expect(extraction.audioBlock).toContain("Audio direction:");
    expect(extraction.promptWithoutAudioBlock).toContain("Shot 1: Wide frame.");
    expect(extraction.promptWithoutAudioBlock).toContain("Avoid:");
    expect(extraction.promptWithoutAudioBlock).not.toContain("Dialogue transcript");
  });

  it("parses kling inline quoted dialogue lines without an explicit audio direction block", () => {
    const parsed = parseAudioDirection(`
Shot 1, Low angle close-up looking up at his face. (5s)

harsh static phone voice, "Yasananlari biliyorsun. O haini vur. Asla oraya girememeli." (with urgent, grave authority)
firmly and respectfully, "Bas ustune. Gorev anlasilmistir." (with absolute conviction)

Subtle grip tightening sound on the plastic phone case.

Avoid: blur, low quality
    `);

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("dialogue");
    expect(parsed?.speakerTagged).toBe(true);
    expect(parsed?.dialogueLines).toEqual([
      {
        speaker: "Phone Voice",
        speakerKey: "phone voice",
        text: "Yasananlari biliyorsun. O haini vur. Asla oraya girememeli.",
      },
      {
        speaker: "On-Screen Character",
        speakerKey: "on screen character",
        text: "Bas ustune. Gorev anlasilmistir.",
      },
    ]);
    expect(parsed?.dialogueTranscript).toContain("Phone Voice:");
    expect(parsed?.dialogueTranscript).toContain("On-Screen Character:");
  });

  it("treats calm performance cues as the on-screen speaker", () => {
    const parsed = parseAudioDirection(`
calmly and peacefully, "Helal olsun komutanim. Siz de hakkinizi helal edin."
    `);

    expect(parsed?.dialogueLines).toEqual([
      {
        speaker: "On-Screen Character",
        speakerKey: "on screen character",
        text: "Helal olsun komutanim. Siz de hakkinizi helal edin.",
      },
    ]);
  });

  it("applies dialogue text overrides without changing speaker routing", () => {
    const parsed = parseAudioDirection(`
Audio direction:
- Language: TURKISH
- Type: Dialogue
- Dialogue transcript:
  Komutan: Orijinal emir.
  Yaver: Orijinal cevap.
    `);

    const overridden = applyDialogueLineOverride(parsed, [
      {
        speaker: "Komutan",
        speakerKey: "komutan",
        text: "Duzenlenmis emir.",
      },
      {
        speaker: "Yaver",
        speakerKey: "yaver",
        text: "Duzenlenmis cevap.",
      },
    ]);

    expect(overridden?.speakerTagged).toBe(true);
    expect(overridden?.dialogueTranscript).toBe("Komutan: Duzenlenmis emir.\nYaver: Duzenlenmis cevap.");
    expect(overridden?.dialoguePreview).toContain("Komutan: Duzenlenmis emir.");
    expect(createAudioContentHash(overridden ?? null)).not.toBe(createAudioContentHash(parsed ?? null));
  });
});
