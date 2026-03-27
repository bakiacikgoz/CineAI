import { describe, expect, it } from "vitest";
import {
  analyzeKlingVideoPrompt,
  distributeKlingMultiShotDurations,
} from "@/services/fal.service";

describe("kling multi-shot helpers", () => {
  it("detects multiple shot blocks and distributes duration across them", () => {
    const analysis = analyzeKlingVideoPrompt(`
Shot 1: Wide opening frame.

Shot 2: Push in to the subject.

Shot 3: Close detail on the reaction.
    `);

    expect(analysis.detectedMultiShot).toBe(true);
    expect(analysis.shotCount).toBe(3);
    expect(analysis.multiPrompt?.[0]?.prompt).not.toContain("Shot 1:");
    expect(analysis.multiPrompt?.[1]?.prompt).not.toContain("Shot 2:");
    expect(distributeKlingMultiShotDurations(8, analysis.shotCount)).toEqual(["3", "3", "2"]);
  });

  it("rejects multi-shot prompts that do not fit into the selected duration", () => {
    expect(() => distributeKlingMultiShotDurations(5, 6)).toThrow(
      "Multi-shot prompt 6 bolum iceriyor. Sure en az 6s olmali.",
    );
  });

  it("strips shared audio direction blocks while keeping detection enabled", () => {
    const analysis = analyzeKlingVideoPrompt(`
Shot 1: Wide opening frame.

Shot 2: Push in to the subject.

Audio direction:
- Language: TURKISH
- Type: Dialogue
- Dialogue transcript:
  Komutan: Hazir olun.
  Yaver: Emirler gonderildi.
    `);

    expect(analysis.hasAudioDirection).toBe(true);
    expect(analysis.prompt).not.toContain("Audio direction:");
    expect(analysis.multiPrompt?.[0]?.prompt).not.toContain("Dialogue transcript:");
    expect(analysis.multiPrompt?.[1]?.prompt).not.toContain("Dialogue transcript:");
  });
});
