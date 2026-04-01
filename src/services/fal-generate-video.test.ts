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

  it("fails early when fal multi-shot is combined with an END frame", async () => {
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

    await expect(
      generateVideo({
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
      }),
    ).rejects.toThrow(
      "fal backend su anda END gorseli + multi-shot kombinasyonunu kabul etmiyor",
    );

    expect(invokeMock).not.toHaveBeenCalledWith(
      "fal_upload_file",
      expect.objectContaining({ filePath: "C:/shots/end.png" }),
    );
    expect(submittedInputs).toHaveLength(0);
  });
});
