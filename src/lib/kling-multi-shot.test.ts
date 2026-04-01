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

  it("compacts shared prompt context so each shot stays within fal limits", () => {
    const analysis = analyzeKlingVideoPrompt(`
Photorealistic traditional Turkish kahvehane, summer night. PRECISELY match reference environment: pale blue-green plaster walls, dark wooden window frames, old family photographs, old B&W photos, brass tea trays, industrial samovar. TV mounted high on upper-left wall near ceiling. Same environment throughout, stable background, consistent lighting.

Shot 1: Wide master. Two men sit at the center table under tungsten practicals while the camera slowly drifts forward and the room feels quiet, observational, and grounded.

Shot 2: Medium push-in on the older man as he raises the tea glass, glances toward the television, then turns back to the table with restrained concern and natural breathing motion.
    `);

    expect(analysis.multiPrompt?.every((element) => element.prompt.length <= 512)).toBe(true);
    expect(analysis.multiPrompt?.[0]?.prompt).toContain("Photorealistic traditional Turkish kahvehane");
    expect(analysis.multiPrompt?.[1]?.prompt).toContain("Medium push-in on the older man");
  });
});
