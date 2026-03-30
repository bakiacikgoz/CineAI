export interface AssetDetachShot {
  id: string;
  shotNumber: string;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  video4kPath: string | null;
  lipsyncVideoPath: string | null;
  externalReferencePath: string | null;
}

export interface AssetDetachUpdate {
  shotId: string;
  shotNumber: string;
  slots: Array<"start" | "end" | "video" | "video4k" | "lipsync" | "reference">;
  updates: Partial<{
    imageStartPath: string | null;
    imageEndPath: string | null;
    videoPath: string | null;
    video4kPath: string | null;
    lipsyncVideoPath: string | null;
    externalReferencePath: string | null;
    imageStatus: string;
    videoStatus: string;
    upscaleStatus: string;
    lipsyncStatus: string;
    lipsyncModelUsed: string | null;
    lipsyncCostUsd: number | null;
    lipsyncError: string | null;
    lipsyncSourceVideoPath: string | null;
    lipsyncSourceAudioPath: string | null;
    lipsyncMetadataJson: string | null;
  }>;
}

function normalizeAssetPath(path: string | null | undefined): string | null {
  return path ? path.replace(/\\/g, "/") : null;
}

export function buildAssetDetachUpdates(
  shots: AssetDetachShot[],
  assetPath: string,
): AssetDetachUpdate[] {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  const updates: AssetDetachUpdate[] = [];

  for (const shot of shots) {
    const slots: AssetDetachUpdate["slots"] = [];
    const nextUpdates: AssetDetachUpdate["updates"] = {};
    const startPath = normalizeAssetPath(shot.imageStartPath);
    const endPath = normalizeAssetPath(shot.imageEndPath);
    const videoPath = normalizeAssetPath(shot.videoPath);
    const video4kPath = normalizeAssetPath(shot.video4kPath);
    const lipsyncVideoPath = normalizeAssetPath(shot.lipsyncVideoPath);
    const referencePath = normalizeAssetPath(shot.externalReferencePath);
    const nextImageStartPath = startPath === normalizedAssetPath ? null : shot.imageStartPath;
    const nextImageEndPath = endPath === normalizedAssetPath ? null : shot.imageEndPath;
    const nextVideo4kPath = video4kPath === normalizedAssetPath ? null : shot.video4kPath;

    if (startPath === normalizedAssetPath) {
      slots.push("start");
      nextUpdates.imageStartPath = null;
    }

    if (endPath === normalizedAssetPath) {
      slots.push("end");
      nextUpdates.imageEndPath = null;
    }

    if (slots.includes("start") || slots.includes("end")) {
      if (!nextImageStartPath && !nextImageEndPath) {
        nextUpdates.imageStatus = "pending";
      }
    }

    if (videoPath === normalizedAssetPath) {
      slots.push("video");
      nextUpdates.videoPath = null;
      if (!nextVideo4kPath) {
        nextUpdates.videoStatus = "pending";
      }
    }

    if (video4kPath === normalizedAssetPath) {
      slots.push("video4k");
      nextUpdates.video4kPath = null;
      nextUpdates.upscaleStatus = "none";
    }

    if (lipsyncVideoPath === normalizedAssetPath) {
      slots.push("lipsync");
      nextUpdates.lipsyncVideoPath = null;
      nextUpdates.lipsyncStatus = "none";
      nextUpdates.lipsyncModelUsed = null;
      nextUpdates.lipsyncCostUsd = null;
      nextUpdates.lipsyncError = null;
      nextUpdates.lipsyncSourceVideoPath = null;
      nextUpdates.lipsyncSourceAudioPath = null;
      nextUpdates.lipsyncMetadataJson = null;
    }

    if (referencePath === normalizedAssetPath) {
      slots.push("reference");
      nextUpdates.externalReferencePath = null;
    }

    if (slots.length > 0) {
      updates.push({
        shotId: shot.id,
        shotNumber: shot.shotNumber,
        slots,
        updates: nextUpdates,
      });
    }
  }

  return updates;
}
