import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getApiKey: vi.fn(async () => "test-fal-key"),
}));

vi.mock("@/services/evolink.service", () => ({
  generateVideoOnEvoLink: vi.fn(),
  testEvoLinkConnection: vi.fn(),
}));

import { generateVideo } from "@/services/fal.service";

describe("generateVideo on fal", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("submits multi-shot requests with end_image_url when an END frame is provided", async () => {
    const submittedInputs: Array<Record<string, unknown>> = [];

    invokeMock.mockImplementation(async (command: string, payload: Record<string, unknown>) => {
      if (command === "fal_upload_file") {
        const filePath = String(payload.filePath);
        return `https://cdn.example.com/${filePath.includes("end") ? "end" : "start"}.png`;
      }

      if (command === "fal_queue_submit") {
        submittedInputs.push(payload.input as Record<string, unknown>);
        return { requestId: "req-1" };
      }

      if (command === "fal_queue_status") {
        return { status: "COMPLETED" };
      }

      if (command === "fal_queue_result") {
        return {
          requestId: "req-1",
          data: { video: { url: "https://cdn.example.com/out.mp4" } },
        };
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await generateVideo({
      jobId: "job-1",
      model: "fal-ai/kling-video/v3/pro/image-to-video",
      prompt: [
        "Photorealistic traditional Turkish kahvehane, summer night. Stable background and consistent lighting.",
        "Shot 1: Wide master on the room as the camera slowly glides inward.",
        "Shot 2: Gentle push toward the older man as he lifts the tea glass and looks toward the television.",
      ].join("\n\n"),
      imageStartPath: "C:/shots/start.png",
      imageEndPath: "C:/shots/end.png",
      duration: 8,
      aspectRatio: "16:9",
      cfg: 0.45,
      generateAudio: true,
      shotType: "customize",
    });

    expect(result.url).toBe("https://cdn.example.com/out.mp4");
    expect(invokeMock).toHaveBeenCalledWith(
      "fal_upload_file",
      expect.objectContaining({ filePath: "C:/shots/end.png" }),
    );
    expect(submittedInputs).toHaveLength(1);
    expect(submittedInputs[0]).toMatchObject({
      start_image_url: "https://cdn.example.com/start.png",
      end_image_url: "https://cdn.example.com/end.png",
      shot_type: "customize",
    });
    expect(Array.isArray(submittedInputs[0]?.multi_prompt)).toBe(true);
  });
});
