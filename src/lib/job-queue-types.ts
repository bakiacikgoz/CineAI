export type VideoQueueJobType = "video" | "coverage_video";

export function isVideoQueueJobType(type: string): type is VideoQueueJobType {
  return type === "video" || type === "coverage_video";
}

export function getBulkVideoJobType(parentShotId?: string | null): VideoQueueJobType {
  return parentShotId ? "coverage_video" : "video";
}
