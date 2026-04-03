import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORYBOARD_EXPORT_OPTIONS,
  buildStoryboardExportFolderName,
  hasStoryboardExportContentSelection,
  hasStoryboardExportShotSelection,
  resolveStoryboardExportShots,
  sanitizeExportSegment,
} from "@/services/storyboard-export.service";

describe("storyboard export helpers", () => {
  it("sanitizes Windows-hostile folder names", () => {
    expect(sanitizeExportSegment('SHOT:01 / "Final"?*', "fallback")).toBe("SHOT 01 Final");
    expect(sanitizeExportSegment("...", "fallback")).toBe("fallback");
  });

  it("builds a stable export root name", () => {
    expect(
      buildStoryboardExportFolderName(
        "CineAI: Demo",
        new Date(2026, 2, 31, 10, 45, 9).getTime(),
      ),
    ).toBe(
      "CineAI Demo_storyboard_export_20260331_104509",
    );
  });

  it("filters visible shots by export scope", () => {
    const shots = [
      { id: "main", parentShotId: null },
      { id: "coverage", parentShotId: "main" },
    ];

    expect(
      resolveStoryboardExportShots(shots, {
        includeMainShots: true,
        includeCoverageShots: false,
      }).map((shot) => shot.id),
    ).toEqual(["main"]);

    expect(
      resolveStoryboardExportShots(shots, {
        includeMainShots: false,
        includeCoverageShots: true,
      }).map((shot) => shot.id),
    ).toEqual(["coverage"]);
  });

  it("requires at least one shot type and one content category", () => {
    expect(hasStoryboardExportShotSelection(DEFAULT_STORYBOARD_EXPORT_OPTIONS)).toBe(true);
    expect(hasStoryboardExportContentSelection(DEFAULT_STORYBOARD_EXPORT_OPTIONS)).toBe(true);

    expect(
      hasStoryboardExportShotSelection({
        includeMainShots: false,
        includeCoverageShots: false,
      }),
    ).toBe(false);

    expect(
      hasStoryboardExportContentSelection({
        includeVideos: false,
        includeAudio: false,
        includeVisuals: false,
        includeCharacters: false,
      }),
    ).toBe(false);
  });
});
