import { describe, expect, it } from "vitest";
import { countPlannedBulkJobs, normalizeSelectedMainShotIds, resolveBulkScope } from "@/lib/bulk-production";
import { getBulkVideoJobType, isVideoQueueJobType } from "@/lib/job-queue-types";

const shots = [
  {
    id: "main-1",
    parentShotId: null,
    imageStartPath: "start.png",
    imageEndPath: null,
    videoPath: null,
    promptStart: "start",
    promptEnd: "end",
    promptVideo: "video",
  },
  {
    id: "coverage-1",
    parentShotId: "main-1",
    imageStartPath: null,
    imageEndPath: null,
    videoPath: null,
    promptStart: "coverage start",
    promptEnd: null,
    promptVideo: "coverage video",
  },
  {
    id: "coverage-2",
    parentShotId: "main-1",
    imageStartPath: "coverage.png",
    imageEndPath: null,
    videoPath: "coverage.mp4",
    promptStart: "coverage start 2",
    promptEnd: null,
    promptVideo: "coverage video 2",
  },
  {
    id: "main-2",
    parentShotId: null,
    imageStartPath: null,
    imageEndPath: null,
    videoPath: null,
    promptStart: null,
    promptEnd: null,
    promptVideo: null,
  },
] as const;

describe("bulk production scope", () => {
  it("normalizes coverage selection to its parent main shot", () => {
    expect(normalizeSelectedMainShotIds(shots, ["coverage-1"])).toEqual(["main-1"]);
  });

  it("filters missing work and includes coverage children for selected scope", () => {
    const selectedScope = resolveBulkScope(shots, {
      produceStartFrames: true,
      produceEndFrames: true,
      produceCoverageImages: true,
      produceVideos: true,
      filter: "selected",
      selectedShotIds: ["coverage-1"],
    });

    expect(selectedScope.mainShots.map((shot) => shot.id)).toEqual(["main-1"]);
    expect(selectedScope.coverageShots.map((shot) => shot.id)).toEqual([
      "coverage-1",
      "coverage-2",
    ]);

    const missingScope = resolveBulkScope(shots, {
      produceStartFrames: true,
      produceEndFrames: true,
      produceCoverageImages: true,
      produceVideos: true,
      filter: "missing",
    });

    expect(missingScope.mainShots.map((shot) => shot.id)).toEqual(["main-1"]);
    expect(missingScope.coverageShots.map((shot) => shot.id)).toEqual(["coverage-1"]);
    expect(
      countPlannedBulkJobs(shots, {
        produceStartFrames: true,
        produceEndFrames: true,
        produceCoverageImages: true,
        produceVideos: true,
        filter: "missing",
      }),
    ).toBe(4);
  });

  it("uses coverage video job types consistently for bulk and recovery helpers", () => {
    expect(getBulkVideoJobType(null)).toBe("video");
    expect(getBulkVideoJobType("main-1")).toBe("coverage_video");
    expect(isVideoQueueJobType("coverage_video")).toBe(true);
    expect(isVideoQueueJobType("video")).toBe(true);
    expect(isVideoQueueJobType("image_start")).toBe(false);
  });
});
