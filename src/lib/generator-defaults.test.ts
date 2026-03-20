import { describe, expect, it } from "vitest";
import {
  resolveImageGeneratorDefaults,
  resolveVideoGeneratorDefaults,
} from "@/lib/generator-defaults";

describe("generator defaults", () => {
  it("applies image precedence as inbound preset > inbound state > default preset > settings", () => {
    const result = resolveImageGeneratorDefaults({
      appDefaults: {
        defaultImageModel: "settings-model",
      },
      defaultPreset: {
        imageModel: "default-preset-model",
        imageParams: JSON.stringify({
          cfg: 9,
          steps: 32,
          aspectRatio: "1:1",
        }),
      },
      inboundState: {
        model: "explicit-model",
      },
      inboundPreset: {
        imageModel: "inbound-preset-model",
        imageParams: JSON.stringify({
          cfg: 11,
          aspectRatio: "9:16",
        }),
      },
    });

    expect(result).toEqual({
      model: "inbound-preset-model",
      aspectRatio: "9:16",
      cfg: 11,
      steps: 32,
    });
  });

  it("falls back safely when preset json is malformed", () => {
    const result = resolveVideoGeneratorDefaults({
      appDefaults: {
        defaultVideoModel: "settings-video-model",
      },
      defaultPreset: {
        videoModel: "broken-default-preset",
        videoParams: "{not json",
      },
    });

    expect(result).toEqual({
      model: "broken-default-preset",
      duration: 5,
      aspectRatio: "16:9",
      cfg: 0.45,
      generateAudio: false,
      shotType: "customize",
    });
  });
});
