import { describe, expect, it } from "vitest";
import {
  calcLipSyncCost,
  deriveLipSyncState,
  resolveLipSyncPlan,
} from "@/lib/lipsync";

describe("lipsync plan selection", () => {
  it("selects 2.0 Pro for strong close-up shots", () => {
    const plan = resolveLipSyncPlan({
      shotType: "close",
      cameraAngle: "85mm close-up",
      summaryTr: "Yuz tamamen kadrajda",
      promptVideo: "tight portrait with visible lips",
      videoDurationS: 5,
      audioDurationS: 5.1,
      preferredVideoPath: "videos/shot_4k.mp4",
      fallbackVideoPath: "videos/shot_hd.mp4",
    });

    expect(plan.modelId).toBe("fal-ai/sync-lipsync/v2/pro");
    expect(plan.syncMode).toBeNull();
  });

  it("selects 2.0 for medium close-up signals", () => {
    const plan = resolveLipSyncPlan({
      shotType: "reaction",
      cameraAngle: "tight portrait",
      summaryTr: "Karakter yakin planda dinliyor",
      promptVideo: "portrait framing",
      videoDurationS: 6,
      audioDurationS: 6,
      preferredVideoPath: "videos/shot_4k.mp4",
      fallbackVideoPath: "videos/shot_hd.mp4",
    });

    expect(plan.modelId).toBe("fal-ai/sync-lipsync/v2");
    expect(plan.syncMode).toBeNull();
  });

  it("selects 1.9 remap for duration mismatch", () => {
    const plan = resolveLipSyncPlan({
      shotType: "wide",
      cameraAngle: "24mm wide",
      summaryTr: "Genis plan",
      promptVideo: "cinematic wide shot",
      videoDurationS: 4,
      audioDurationS: 5.2,
      preferredVideoPath: "videos/shot_4k.mp4",
      fallbackVideoPath: "videos/shot_hd.mp4",
    });

    expect(plan.modelId).toBe("fal-ai/sync-lipsync");
    expect(plan.syncMode).toBe("remap");
  });

  it("falls back to LatentSync for standard shots", () => {
    const plan = resolveLipSyncPlan({
      shotType: "wide",
      cameraAngle: "35mm",
      summaryTr: "Iki karakter ayakta",
      promptVideo: "medium wide dialogue shot",
      videoDurationS: 5,
      audioDurationS: 5.1,
      preferredVideoPath: "videos/shot_4k.mp4",
      fallbackVideoPath: "videos/shot_hd.mp4",
    });

    expect(plan.modelId).toBe("fal-ai/latentsync");
    expect(plan.syncMode).toBeNull();
  });
});

describe("lipsync cost calculation", () => {
  it("applies LatentSync threshold pricing", () => {
    expect(calcLipSyncCost("fal-ai/latentsync", 40)).toBeCloseTo(0.2, 6);
    expect(calcLipSyncCost("fal-ai/latentsync", 41)).toBeCloseTo(0.205, 6);
  });

  it("applies 1.9, 2.0 and 2.0 Pro minute rates", () => {
    expect(calcLipSyncCost("fal-ai/sync-lipsync", 60)).toBeCloseTo(0.7, 6);
    expect(calcLipSyncCost("fal-ai/sync-lipsync/v2", 60)).toBeCloseTo(3, 6);
    expect(calcLipSyncCost("fal-ai/sync-lipsync/v2/pro", 60)).toBeCloseTo(5, 6);
  });
});

describe("lipsync stale and blocker state", () => {
  it("marks missing source inputs as blocked when there is no master", () => {
    const state = deriveLipSyncState({
      persistedStatus: "none",
      hasMaster: false,
      blockerReasons: ["Master video yok."],
      sourceVideoPath: null,
      sourceAudioPath: null,
      currentVideoPath: null,
      currentAudioPath: "audio/shot.wav",
    });

    expect(state.status).toBe("blocked");
    expect(state.isStale).toBe(false);
  });

  it("marks changed source inputs as stale without deleting the master", () => {
    const state = deriveLipSyncState({
      persistedStatus: "done",
      hasMaster: true,
      blockerReasons: [],
      sourceVideoPath: "videos/old.mp4",
      sourceAudioPath: "audio/old.wav",
      currentVideoPath: "videos/new.mp4",
      currentAudioPath: "audio/new.wav",
    });

    expect(state.status).toBe("stale");
    expect(state.isStale).toBe(true);
    expect(state.staleReasons).toEqual([
      "Kaynak video degisti.",
      "Kaynak ses degisti.",
    ]);
  });
});
