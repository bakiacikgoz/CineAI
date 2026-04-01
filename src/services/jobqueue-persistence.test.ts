import { describe, expect, it } from "vitest";
import { buildImageUpscaleRequeueParams } from "@/services/jobqueue-persistence.service";
import type { Job } from "@/store/queue.store";

function createJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    projectId: "project-1",
    type: "image_upscale",
    status: "error",
    priority: 123,
    shotId: "shot-1",
    assetId: "asset-1",
    model: "clarityai/crystal-upscaler",
    prompt: "Crystal image upscale",
    params: {
      stage: "start",
      outputMode: "autonomous_replace",
      scaleFactor: 2,
      sourceRelativePath: "storyboard/act-01/scene-01/shot01_start.png",
      outputSuffix: "auto_start_v01_crystal",
      assetTags: ["stage:start", "upscaled", "clarity-upscale"],
    },
    progress: 0,
    queuedAt: Date.now(),
    ...overrides,
  };
}

describe("jobqueue persistence image upscale mapping", () => {
  it("rebuilds the enqueue params for persisted image-upscale jobs", () => {
    expect(buildImageUpscaleRequeueParams(createJob())).toEqual({
      shotId: "shot-1",
      assetId: "asset-1",
      sourceRelativePath: "storyboard/act-01/scene-01/shot01_start.png",
      sourcePath: undefined,
      stage: "start",
      outputMode: "autonomous_replace",
      priority: 123,
      outputSuffix: "auto_start_v01_crystal",
      scaleFactor: 2,
      assetTags: ["stage:start", "upscaled", "clarity-upscale"],
    });
  });

  it("returns null when the persisted params do not include a valid stage", () => {
    expect(
      buildImageUpscaleRequeueParams(
        createJob({
          params: {
            stage: "video",
          },
        }),
      ),
    ).toBeNull();
  });
});
