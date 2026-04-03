import { describe, expect, it } from "vitest";
import {
  composeStoryboardReferencePaths,
  resolveStoryboardReferenceStrategy,
} from "@/lib/storyboard-reference-strategy";

describe("storyboard reference strategy", () => {
  it("defaults child start and coverage shots to parent-start-dominant", () => {
    expect(
      resolveStoryboardReferenceStrategy({
        mode: "start",
        hasParentShot: true,
      }),
    ).toBe("parent-start-dominant");

    expect(
      resolveStoryboardReferenceStrategy({
        mode: "coverage",
        hasParentShot: true,
      }),
    ).toBe("parent-start-dominant");
  });

  it("keeps main-shot and end-frame flows on augment by default", () => {
    expect(
      resolveStoryboardReferenceStrategy({
        mode: "start",
        hasParentShot: false,
      }),
    ).toBe("augment");

    expect(
      resolveStoryboardReferenceStrategy({
        mode: "end",
        hasParentShot: true,
      }),
    ).toBe("augment");
  });

  it("keeps parent START first for child-shot reference composition", () => {
    expect(
      composeStoryboardReferencePaths({
        strategy: "parent-start-dominant",
        dominantReferenceImagePath: "C:/shots/main-start.png",
        explicitReferenceImagePaths: ["C:/shots/main-start.png"],
        implicitReferenceImagePaths: [
          "C:/refs/external.png",
          "C:/refs/character.png",
        ],
      }),
    ).toEqual([
      "C:/shots/main-start.png",
      "C:/refs/external.png",
      "C:/refs/character.png",
    ]);
  });

  it("keeps manual edits explicit-only", () => {
    expect(
      composeStoryboardReferencePaths({
        strategy: "explicit-only",
        explicitReferenceImagePaths: [
          "C:/shots/base.png",
          "C:/shots/guide.png",
        ],
        implicitReferenceImagePaths: [
          "C:/refs/external.png",
          "C:/refs/character.png",
        ],
      }),
    ).toEqual(["C:/shots/base.png", "C:/shots/guide.png"]);
  });

  it("throws when parent-start-dominant is used without a parent START", () => {
    expect(() =>
      composeStoryboardReferencePaths({
        strategy: "parent-start-dominant",
        implicitReferenceImagePaths: ["C:/refs/external.png"],
      }),
    ).toThrow("Parent START referansi gerekli.");
  });
});
