import { describe, expect, it } from "vitest";
import {
  buildFalCharacterElements,
  buildFalVideoRequestInput,
  injectEvoLinkElementReferences,
  injectFalElementReferences,
  summarizeFalApiError,
} from "@/services/fal.service";

describe("injectEvoLinkElementReferences", () => {
  it("prepends an element anchor when the prompt does not already reference one", () => {
    const prompt = injectEvoLinkElementReferences(
      "A woman walks into frame and looks at camera.",
      1,
    );

    expect(prompt).toContain("<<<element_1>>>");
    expect(prompt).toContain("primary character identity anchor");
    expect(prompt).toContain("A woman walks into frame and looks at camera.");
  });

  it("keeps prompts unchanged when the element token is already present", () => {
    const prompt = "<<<element_1>>> walks into frame and looks at camera.";

    expect(injectEvoLinkElementReferences(prompt, 1)).toBe(prompt);
  });
});

describe("injectFalElementReferences", () => {
  it("prepends a fal element anchor when the prompt does not already reference one", () => {
    const prompt = injectFalElementReferences(
      "A soldier listens to the order and hardens into resolve.",
      1,
    );

    expect(prompt).toContain("@Element1");
    expect(prompt).toContain("primary character identity anchor");
    expect(prompt).toContain("A soldier listens to the order and hardens into resolve.");
  });

  it("keeps prompts unchanged when the fal element token is already present", () => {
    const prompt = "@Element1 listens to the order and hardens into resolve.";

    expect(injectFalElementReferences(prompt, 1)).toBe(prompt);
  });
});

describe("buildFalCharacterElements", () => {
  it("maps the first image to frontal_image_url and the rest to reference_image_urls", () => {
    expect(
      buildFalCharacterElements([
        "https://cdn.example.com/omer-front.png",
        "https://cdn.example.com/omer-side.png",
        "https://cdn.example.com/omer-back.png",
      ]),
    ).toEqual([
      {
        frontal_image_url: "https://cdn.example.com/omer-front.png",
        reference_image_urls: [
          "https://cdn.example.com/omer-side.png",
          "https://cdn.example.com/omer-back.png",
        ],
      },
    ]);
  });

  it("duplicates the frontal image when only one reference image is available", () => {
    expect(buildFalCharacterElements(["https://cdn.example.com/omer-front.png"])).toEqual([
      {
        frontal_image_url: "https://cdn.example.com/omer-front.png",
        reference_image_urls: ["https://cdn.example.com/omer-front.png"],
      },
    ]);
  });
});

describe("buildFalVideoRequestInput", () => {
  it("builds a reference-to-video payload with fal character elements", () => {
    const input = buildFalVideoRequestInput({
      model: "fal-ai/kling-video/o3/standard/reference-to-video",
      prompt: "@Element1 slowly turns toward camera.",
      startImageUrl: "https://cdn.example.com/start.png",
      endImageUrl: "https://cdn.example.com/end.png",
      characterReferenceImageUrls: [
        "https://cdn.example.com/omer-front.png",
        "https://cdn.example.com/omer-side.png",
      ],
      duration: 5,
      aspectRatio: "16:9",
      cfg: 0.45,
      generateAudio: false,
      negativePrompt: "watermark",
    });

    expect(input).toMatchObject({
      start_image_url: "https://cdn.example.com/start.png",
      end_image_url: "https://cdn.example.com/end.png",
      duration: 5,
      aspect_ratio: "16:9",
      cfg_scale: 0.45,
      generate_audio: false,
      prompt: "@Element1 slowly turns toward camera.",
      elements: [
        {
          frontal_image_url: "https://cdn.example.com/omer-front.png",
          reference_image_urls: ["https://cdn.example.com/omer-side.png"],
        },
      ],
    });
    expect(input.negative_prompt).toContain("blur, distort, and low quality");
    expect(input.negative_prompt).toContain("watermark");
  });

  it("builds multi-prompt payloads for fal reference models", () => {
    const input = buildFalVideoRequestInput({
      model: "fal-ai/kling-video/o3/pro/reference-to-video",
      prompt: [
        "Shot 1: @Element1 listens in silence.",
        "Shot 2: @Element1 hardens into resolve.",
      ].join("\n"),
      startImageUrl: "https://cdn.example.com/start.png",
      duration: 8,
      aspectRatio: "16:9",
      cfg: 0.45,
      generateAudio: true,
      shotType: "customize",
    });

    expect(input.prompt).toBeUndefined();
    expect(input.shot_type).toBe("customize");
    expect(Array.isArray(input.multi_prompt)).toBe(true);
    expect(input.multi_prompt).toHaveLength(2);
  });

  it("does not block long multi-shot prompts before submitting to fal", () => {
    const longShot = "A deliberate cinematic action beat with layered camera, motion, emotion, and staging details. ".repeat(7).trim();

    const input = buildFalVideoRequestInput({
      model: "fal-ai/kling-video/v3/pro/image-to-video",
      prompt: [
        `Shot 1: ${longShot}`,
        `Shot 2: ${longShot}`,
      ].join("\n"),
      startImageUrl: "https://cdn.example.com/start.png",
      duration: 8,
      aspectRatio: "16:9",
      cfg: 0.45,
      generateAudio: true,
      shotType: "customize",
    });

    expect(input.prompt).toBeUndefined();
    expect(Array.isArray(input.multi_prompt)).toBe(true);
    expect(input.multi_prompt).toHaveLength(2);
    expect((input.multi_prompt as Array<{ prompt: string }>)[0]?.prompt.length).toBeGreaterThan(512);
  });
});

describe("summarizeFalApiError", () => {
  it("normalizes exhausted FAL balance errors", () => {
    const summary = summarizeFalApiError(
      new Error(
        'FAL upload baslatma istegi basarisiz oldu (403 Forbidden): {"detail":"User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing"}',
      ),
    );

    expect(summary).toContain("FAL bakiyesi tukenmis veya hesap kilitlenmis.");
    expect(summary).toContain("Exhausted balance");
  });

  it("keeps EvoLink quota normalization intact", () => {
    const summary = summarizeFalApiError(
      new Error(
        "Insufficient credits: Pre-deduction failed: insufficient quota: need 135.0270 credits, available 10.0000 credits (HTTP 402)",
      ),
    );

    expect(summary).toContain("EvoLink kredisi yetersiz.");
    expect(summary).toContain("available 10.0000 credits");
  });
});
