import { describe, expect, it } from "vitest";
import { computeProjectPresentationSummary } from "@/lib/project-summary";

describe("project presentation summary", () => {
  it("computes dashboard metadata and chooses the latest visible thumbnail", () => {
    const summary = computeProjectPresentationSummary([
      {
        parentShotId: null,
        isArchived: false,
        imageStartPath: null,
        imageEndPath: "older-end.png",
        videoPath: null,
        video4kPath: null,
        updatedAt: 10,
      },
      {
        parentShotId: null,
        isArchived: false,
        imageStartPath: "latest-start.png",
        imageEndPath: "latest-end.png",
        videoPath: "latest-video.mp4",
        video4kPath: null,
        updatedAt: 20,
      },
      {
        parentShotId: "main-1",
        isArchived: false,
        imageStartPath: "coverage.png",
        imageEndPath: null,
        videoPath: null,
        video4kPath: null,
        updatedAt: 30,
      },
      {
        parentShotId: null,
        isArchived: true,
        imageStartPath: "archived-start.png",
        imageEndPath: null,
        videoPath: null,
        video4kPath: null,
        updatedAt: 40,
      },
    ], {
      characterCount: 3,
      assetCount: 9,
    });

    expect(summary).toEqual({
      metadata: {
        mainShotCount: 3,
        coverageShotCount: 1,
        archivedShotCount: 1,
        readyStartCount: 2,
        readyEndCount: 2,
        readyVideoCount: 1,
        characterCount: 3,
        assetCount: 9,
      },
      thumbnail: "latest-start.png",
    });
  });
});
