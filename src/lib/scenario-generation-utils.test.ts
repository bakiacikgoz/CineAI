import { describe, expect, it } from "vitest";
import {
  buildContinuityGroups,
  mergeScenarioChunkPlans,
  splitScenarioIntoChunks,
} from "@/lib/scenario-generation-utils";
import type { ShotPlan } from "@/lib/scenario-types";

describe("scenario generation utils", () => {
  it("splits long scenario text on paragraph boundaries", () => {
    const text = [
      "SCENE 1\nA short opening paragraph with setup details and room tone.",
      "SCENE 2\n" + "Action beat ".repeat(120),
      "SCENE 3\nA quiet reset paragraph that should not be lost.",
    ].join("\n\n");

    const chunks = splitScenarioIntoChunks(text, {
      maxChars: 420,
      maxWords: 80,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("\n\n")).toContain("SCENE 1");
    expect(chunks.join("\n\n")).toContain("SCENE 3");
  });

  it("merges chunk plans and renumbers shots while preserving continuity", () => {
    const merged = mergeScenarioChunkPlans({
      targetModel: "veo31",
      plans: [
        {
          scenes: [
            {
              sceneNumber: 1,
              title: "Chunk One",
              summaryTr: "Ilk bolum",
              tensionLevel: 2,
              shots: [
                {
                  shotNumber: "SHOT01",
                  type: "main",
                  durationS: 8,
                  hasDialogue: false,
                  chainStatus: "first",
                  summaryTr: "Acilis",
                  tensionLevel: 2,
                },
                {
                  shotNumber: "SHOT01A",
                  type: "coverage",
                  coverageType: "wide",
                  parentShotNumber: "SHOT01",
                  durationS: 4,
                  hasDialogue: false,
                  chainStatus: "first",
                  summaryTr: "Coverage",
                  tensionLevel: 2,
                },
                {
                  shotNumber: "SHOT02",
                  type: "main",
                  durationS: 8,
                  hasDialogue: false,
                  chainStatus: "chained",
                  prevShotRef: "SHOT01",
                  summaryTr: "Devam",
                  tensionLevel: 3,
                },
              ],
            },
          ],
          totalMainShots: 2,
          totalCoverageShots: 1,
          estimatedDurationS: 20,
          tensionArc: [2, 3],
          dialogueNamePolicy: "preserve",
          targetModel: "veo31",
        },
        {
          scenes: [
            {
              sceneNumber: 1,
              title: "Chunk Two",
              summaryTr: "Ikinci bolum",
              tensionLevel: 4,
              shots: [
                {
                  shotNumber: "SHOT01",
                  type: "main",
                  durationS: 7,
                  hasDialogue: true,
                  chainStatus: "chained",
                  prevShotRef: "SHOT00",
                  summaryTr: "Yeni parcada devam",
                  tensionLevel: 4,
                },
              ],
            },
          ],
          totalMainShots: 1,
          totalCoverageShots: 0,
          estimatedDurationS: 7,
          tensionArc: [4],
          dialogueNamePolicy: "preserve",
          targetModel: "veo31",
        },
      ],
    });

    const mergedShots = merged.scenes.flatMap((scene) => scene.shots);

    expect(mergedShots.map((shot) => shot.shotNumber)).toEqual([
      "SHOT01",
      "SHOT01A",
      "SHOT02",
      "SHOT03",
    ]);
    expect(mergedShots[2]).toMatchObject({
      shotNumber: "SHOT02",
      chainStatus: "chained",
      prevShotRef: "SHOT01",
    });
    expect(mergedShots[3]).toMatchObject({
      shotNumber: "SHOT03",
      chainStatus: "chained",
      prevShotRef: "SHOT02",
    });
  });

  it("groups main shots by continuity chain breaks", () => {
    const plan: ShotPlan = {
      scenes: [
        {
          sceneNumber: 1,
          title: "One",
          summaryTr: "Bir",
          tensionLevel: 2,
          shots: [
            {
              shotNumber: "SHOT01",
              type: "main",
              durationS: 8,
              hasDialogue: false,
              chainStatus: "first",
              summaryTr: "Bir",
              tensionLevel: 2,
            },
            {
              shotNumber: "SHOT02",
              type: "main",
              durationS: 8,
              hasDialogue: false,
              chainStatus: "chained",
              prevShotRef: "SHOT01",
              summaryTr: "Iki",
              tensionLevel: 3,
            },
            {
              shotNumber: "SHOT03",
              type: "main",
              durationS: 8,
              hasDialogue: false,
              chainStatus: "break",
              chainBreakReason: "scene reset",
              summaryTr: "Uc",
              tensionLevel: 2,
            },
            {
              shotNumber: "SHOT04",
              type: "main",
              durationS: 8,
              hasDialogue: false,
              chainStatus: "chained",
              prevShotRef: "SHOT03",
              summaryTr: "Dort",
              tensionLevel: 3,
            },
          ],
        },
      ],
      totalMainShots: 4,
      totalCoverageShots: 0,
      estimatedDurationS: 32,
      tensionArc: [2, 3, 2, 3],
      dialogueNamePolicy: "preserve",
      targetModel: "veo31",
    };

    const groups = buildContinuityGroups(plan);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.map((entry) => entry.shot.shotNumber)).toEqual(["SHOT01", "SHOT02"]);
    expect(groups[1]?.map((entry) => entry.shot.shotNumber)).toEqual(["SHOT03", "SHOT04"]);
  });
});
