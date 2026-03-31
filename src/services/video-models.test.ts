import { describe, expect, it } from "vitest";
import {
  getVideoModelEntries,
  getStoryboardVideoQualityOptions,
  getVideoQualityOptions,
  resolveStoryboardVideoModel,
  resolveStoryboardVideoModelForQuality,
  resolveVideoProvider,
  resolveVideoModelWithQuality,
  selectVideoModelForProvider,
} from "@/services/fal.service";

describe("video model catalog", () => {
  it("filters storyboard-compatible models away from text-only entries", () => {
    const storyboardModels = getVideoModelEntries({ storyboardCapable: true });

    expect(
      storyboardModels.every(([, meta]) => meta.storyboardCapable && meta.inputMode === "image-to-video"),
    ).toBe(true);
    expect(storyboardModels.some(([modelId]) => modelId === "evolink/kling-v3/std/image-to-video")).toBe(true);
    expect(storyboardModels.some(([modelId]) => modelId === "evolink/kling-v3/std/text-to-video")).toBe(false);
  });

  it("switches providers while preserving the current generator input mode when possible", () => {
    const nextModel = selectVideoModelForProvider({
      provider: "evolink",
      currentModel: "fal-ai/kling-video/v3/pro/image-to-video",
      generatorCapable: true,
    });

    expect(resolveVideoProvider(nextModel)).toBe("evolink");
    expect(nextModel).toBe("evolink/kling-v3/std/image-to-video");
  });

  it("falls back to a storyboard-safe model when a text-only model is used in storyboard flows", () => {
    expect(resolveStoryboardVideoModel("evolink/kling-o3/std/text-to-video")).toBe(
      "fal-ai/kling-video/v3/pro/image-to-video",
    );
  });

  it("maps a model family to the requested quality variant when available", () => {
    expect(getVideoQualityOptions("evolink/kling-v3/std/image-to-video")).toEqual([
      "720p",
      "1080p",
    ]);
    expect(
      resolveVideoModelWithQuality("evolink/kling-v3/std/image-to-video", "1080p"),
    ).toBe("evolink/kling-v3/pro/image-to-video");
  });

  it("offers storyboard quality options globally and falls back to a storyboard-safe 720p model", () => {
    expect(getStoryboardVideoQualityOptions()).toEqual(["720p", "1080p"]);
    expect(
      resolveStoryboardVideoModelForQuality("fal-ai/kling-video/v3/pro/image-to-video", "720p"),
    ).toBe("evolink/kling-v3/std/image-to-video");
  });
});
