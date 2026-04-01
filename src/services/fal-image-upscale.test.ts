import { describe, expect, it } from "vitest";
import {
  buildCrystalUpscaleInput,
  extractFalImageOutput,
} from "@/services/fal.service";

describe("crystal upscaler helpers", () => {
  it("builds the expected fal input with the default 2x scale factor", () => {
    expect(buildCrystalUpscaleInput("https://example.com/source.png")).toEqual({
      image_url: "https://example.com/source.png",
      scale_factor: 2,
    });
  });

  it("parses object-based image outputs from fal results", () => {
    expect(
      extractFalImageOutput({
        images: [
          {
            url: "https://example.com/upscaled.png",
            width: 2048,
            height: 1152,
          },
        ],
      }),
    ).toEqual({
      url: "https://example.com/upscaled.png",
      width: 2048,
      height: 1152,
    });
  });

  it("falls back to string image urls when fal omits width and height", () => {
    expect(
      extractFalImageOutput({
        images: ["https://example.com/upscaled.png"],
      }),
    ).toEqual({
      url: "https://example.com/upscaled.png",
      width: 0,
      height: 0,
    });
  });
});
