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
          externalReferencePath: "asset.png",
        },
        {
          id: "shot-2",
          shotNumber: "A02",
          imageStartPath: "asset.png",
          imageEndPath: "asset.png",
          videoPath: null,
          video4kPath: null,
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
});
