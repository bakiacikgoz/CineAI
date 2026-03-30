import { describe, expect, it } from "vitest";
import { buildAssetDetachUpdates } from "@/lib/asset-detach";

describe("asset detach planning", () => {
  it("clears linked slots and updates statuses conservatively", () => {
    const updates = buildAssetDetachUpdates(
      [
        {
          id: "shot-1",
          shotNumber: "A01",
          imageStartPath: "asset.png",
          imageEndPath: null,
          videoPath: "asset.mp4",
          video4kPath: "asset-4k.mp4",
          lipsyncVideoPath: null,
          externalReferencePath: "asset.png",
        },
        {
          id: "shot-2",
          shotNumber: "A02",
          imageStartPath: "asset.png",
          imageEndPath: "asset.png",
          videoPath: null,
          video4kPath: null,
          lipsyncVideoPath: null,
          externalReferencePath: null,
        },
      ],
      "asset.png",
    );

    expect(updates).toEqual([
      {
        shotId: "shot-1",
        shotNumber: "A01",
        slots: ["start", "reference"],
        updates: {
          imageStartPath: null,
          externalReferencePath: null,
          imageStatus: "pending",
        },
      },
      {
        shotId: "shot-2",
        shotNumber: "A02",
        slots: ["start", "end"],
        updates: {
          imageStartPath: null,
          imageEndPath: null,
          imageStatus: "pending",
        },
      },
    ]);
  });

  it("resets upscale state when the 4k asset is detached", () => {
    const updates = buildAssetDetachUpdates(
      [
        {
          id: "shot-3",
          shotNumber: "A03",
          imageStartPath: null,
          imageEndPath: null,
          videoPath: "base.mp4",
          video4kPath: "asset-4k.mp4",
          lipsyncVideoPath: null,
          externalReferencePath: null,
        },
      ],
      "asset-4k.mp4",
    );

    expect(updates[0]).toEqual({
      shotId: "shot-3",
      shotNumber: "A03",
      slots: ["video4k"],
      updates: {
        video4kPath: null,
        upscaleStatus: "none",
      },
    });
  });

  it("matches paths even when slash styles differ", () => {
    const updates = buildAssetDetachUpdates(
      [
        {
          id: "shot-4",
          shotNumber: "A04",
          imageStartPath: "assets\\images\\start.png",
          imageEndPath: "assets/images/end.png",
          videoPath: "assets\\videos\\clip.mp4",
          video4kPath: null,
          lipsyncVideoPath: "assets\\videos\\lipsync.mp4",
          externalReferencePath: "assets\\images\\ref.png",
        },
      ],
      "assets/images/start.png",
    );

    expect(updates[0]).toEqual({
      shotId: "shot-4",
      shotNumber: "A04",
      slots: ["start"],
      updates: {
        imageStartPath: null,
      },
    });
  });

  it("clears lipsync slot without touching the source video slots", () => {
    const updates = buildAssetDetachUpdates(
      [
        {
          id: "shot-5",
          shotNumber: "A05",
          imageStartPath: null,
          imageEndPath: null,
          videoPath: "base.mp4",
          video4kPath: "base-4k.mp4",
          lipsyncVideoPath: "lipsync.mp4",
          externalReferencePath: null,
        },
      ],
      "lipsync.mp4",
    );

    expect(updates[0]).toEqual({
      shotId: "shot-5",
      shotNumber: "A05",
      slots: ["lipsync"],
      updates: {
        lipsyncVideoPath: null,
        lipsyncStatus: "none",
        lipsyncModelUsed: null,
        lipsyncCostUsd: null,
        lipsyncError: null,
        lipsyncSourceVideoPath: null,
        lipsyncSourceAudioPath: null,
        lipsyncMetadataJson: null,
      },
    });
  });
});
