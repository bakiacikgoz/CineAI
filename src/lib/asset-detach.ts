export interface AssetDetachShot {
  id: string;
  shotNumber: string;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  video4kPath: string | null;
  externalReferencePath: string | null;
}

export interface AssetDetachUpdate {
  shotId: string;
  shotNumber: string;
  slots: Array<"start" | "end" | "video" | "video4k" | "reference">;
  updates: Partial<{
    imageStartPath: string | null;
    imageEndPath: string | null;
    videoPath: string | null;
    video4kPath: string | null;
    externalReferencePath: string | null;
    imageStatus: string;
    videoStatus: string;
    upscaleStatus: string;
  }>;
}

export function buildAssetDetachUpdates(
  shots: AssetDetachShot[],
  assetPath: string,
): AssetDetachUpdate[] {
  const updates: AssetDetachUpdate[] = [];

  for (const shot of shots) {
    const slots: AssetDetachUpdate["slots"] = [];
    const nextUpdates: AssetDetachUpdate["updates"] = {};
    const nextImageStartPath = shot.imageStartPath === assetPath ? null : shot.imageStartPath;
    const nextImageEndPath = shot.imageEndPath === assetPath ? null : shot.imageEndPath;
    const nextVideo4kPath = shot.video4kPath === assetPath ? null : shot.video4kPath;

    if (shot.imageStartPath === assetPath) {
      slots.push("start");
      nextUpdates.imageStartPath = null;
    }

    if (shot.imageEndPath === assetPath) {
      slots.push("end");
      nextUpdates.imageEndPath = null;
    }

    if (slots.includes("start") || slots.includes("end")) {
      if (!nextImageStartPath && !nextImageEndPath) {
        nextUpdates.imageStatus = "pending";
      }
    }

    if (shot.videoPath === assetPath) {
      slots.push("video");
      nextUpdates.videoPath = null;
      if (!nextVideo4kPath) {
        nextUpdates.videoStatus = "pending";
      }
    }

    if (shot.video4kPath === assetPath) {
      slots.push("video4k");
      nextUpdates.video4kPath = null;
      nextUpdates.upscaleStatus = "none";
    }

    if (shot.externalReferencePath === assetPath) {
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
