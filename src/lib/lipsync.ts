export type LipSyncModelId =
  | "fal-ai/latentsync"
  | "fal-ai/sync-lipsync"
  | "fal-ai/sync-lipsync/v2"
  | "fal-ai/sync-lipsync/v2/pro";

export type LipSyncPersistedStatus =
  | "none"
  | "queued"
  | "generating"
  | "done"
  | "error";

export type LipSyncStatus = LipSyncPersistedStatus | "blocked" | "stale";

export type LipSyncSyncMode = "cut_off" | "loop" | "bounce" | "silence" | "remap";

export interface ResolveLipSyncPlanInput {
  shotType: string | null | undefined;
  cameraAngle: string | null | undefined;
  summaryTr: string | null | undefined;
  promptVideo: string | null | undefined;
  videoDurationS: number | null | undefined;
  audioDurationS: number | null | undefined;
  preferredVideoPath: string | null | undefined;
  fallbackVideoPath: string | null | undefined;
}

export interface ResolvedLipSyncPlan {
  modelId: LipSyncModelId;
  syncMode: LipSyncSyncMode | null;
  closeUpScore: number;
  videoDurationS: number | null;
  audioDurationS: number | null;
  durationDeltaS: number;
  durationDeltaRatio: number;
  estimatedCostUsd: number;
  preferredVideoPath: string | null;
  fallbackVideoPath: string | null;
  reason: string;
  reasonTags: string[];
}

export interface DerivedLipSyncStateInput {
  persistedStatus: string | null | undefined;
  hasMaster: boolean;
  blockerReasons?: string[];
  sourceVideoPath: string | null | undefined;
  sourceAudioPath: string | null | undefined;
  currentVideoPath: string | null | undefined;
  currentAudioPath: string | null | undefined;
}

export interface DerivedLipSyncState {
  status: LipSyncStatus;
  isStale: boolean;
  staleReasons: string[];
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function hasKeyword(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function toSafeDuration(durationS: number | null | undefined): number | null {
  return typeof durationS === "number" && Number.isFinite(durationS) && durationS > 0
    ? durationS
    : null;
}

export function scoreLipSyncCloseUp(input: {
  shotType: string | null | undefined;
  cameraAngle: string | null | undefined;
  summaryTr: string | null | undefined;
  promptVideo: string | null | undefined;
}): number {
  const shotType = normalizeText(input.shotType);
  const cameraAngle = normalizeText(input.cameraAngle);
  const summaryTr = normalizeText(input.summaryTr);
  const promptVideo = normalizeText(input.promptVideo);
  const mergedText = `${cameraAngle}\n${summaryTr}\n${promptVideo}`;

  let score = 0;

  if (["close", "detail"].includes(shotType)) {
    score += 3;
  } else if (["reaction", "ots"].includes(shotType)) {
    score += 1;
  }

  if (
    hasKeyword(cameraAngle, [
      /\bclose(?:-|\s)?up\b/,
      /\bextreme close\b/,
      /\becu\b/,
    ])
  ) {
    score += 3;
  }

  if (
    hasKeyword(cameraAngle, [
      /\btight\b/,
      /\bportrait\b/,
      /\b85mm\b/,
      /\b100mm\b/,
      /\b135mm\b/,
    ])
  ) {
    score += 2;
  }

  if (
    hasKeyword(mergedText, [
      /\bclose(?:-|\s)?up\b/,
      /\bextreme close\b/,
      /\becu\b/,
      /\bmouth\b/,
      /\blip\b/,
    ])
  ) {
    score += 2;
  }

  if (
    hasKeyword(mergedText, [
      /\btight\b/,
      /\bportrait\b/,
      /\bface\b/,
    ])
  ) {
    score += 1;
  }

  return score;
}

export function calcLipSyncCost(
  modelId: LipSyncModelId | string | null | undefined,
  durationS: number | null | undefined,
): number {
  const effectiveDuration = Math.max(1, toSafeDuration(durationS) ?? 1);

  switch (modelId) {
    case "fal-ai/latentsync":
      return effectiveDuration <= 40 ? 0.2 : effectiveDuration * 0.005;
    case "fal-ai/sync-lipsync":
      return (0.7 / 60) * effectiveDuration;
    case "fal-ai/sync-lipsync/v2":
      return (3 / 60) * effectiveDuration;
    case "fal-ai/sync-lipsync/v2/pro":
      return (5 / 60) * effectiveDuration;
    default:
      return (0.2 / 40) * effectiveDuration;
  }
}

export function resolveLipSyncPlan(
  input: ResolveLipSyncPlanInput,
): ResolvedLipSyncPlan {
  const closeUpScore = scoreLipSyncCloseUp(input);
  const videoDurationS = toSafeDuration(input.videoDurationS);
  const audioDurationS = toSafeDuration(input.audioDurationS);
  const durationDeltaS =
    videoDurationS !== null && audioDurationS !== null
      ? Math.abs(audioDurationS - videoDurationS)
      : 0;
  const durationDeltaRatio =
    videoDurationS !== null &&
    audioDurationS !== null &&
    Math.max(videoDurationS, audioDurationS) > 0
      ? durationDeltaS / Math.max(videoDurationS, audioDurationS)
      : 0;

  let modelId: LipSyncModelId = "fal-ai/latentsync";
  let syncMode: LipSyncSyncMode | null = null;
  const reasonTags: string[] = [];

  if (closeUpScore >= 7) {
    modelId = "fal-ai/sync-lipsync/v2/pro";
    reasonTags.push("close-up-high");
  } else if (closeUpScore >= 4) {
    modelId = "fal-ai/sync-lipsync/v2";
    reasonTags.push("close-up-medium");
  } else if (durationDeltaS > 0.35 || durationDeltaRatio > 0.07) {
    modelId = "fal-ai/sync-lipsync";
    syncMode = "remap";
    reasonTags.push("duration-mismatch");
  } else {
    reasonTags.push("default-latentsync");
  }

  const estimatedCostUsd = calcLipSyncCost(
    modelId,
    Math.max(videoDurationS ?? 0, audioDurationS ?? 0, 1),
  );
  const reason =
    modelId === "fal-ai/sync-lipsync/v2/pro"
      ? "Yakın plan önceliği nedeniyle 2.0 Pro seçildi."
      : modelId === "fal-ai/sync-lipsync/v2"
        ? "Yüz yakınlığı orta seviyede olduğu için 2.0 seçildi."
        : modelId === "fal-ai/sync-lipsync"
          ? "Ses-video süre farkı belirgin olduğu için 1.9 remap seçildi."
          : "Varsayılan fiyat/kalite dengesi için LatentSync seçildi.";

  return {
    modelId,
    syncMode,
    closeUpScore,
    videoDurationS,
    audioDurationS,
    durationDeltaS,
    durationDeltaRatio,
    estimatedCostUsd,
    preferredVideoPath: input.preferredVideoPath ?? null,
    fallbackVideoPath: input.fallbackVideoPath ?? null,
    reason,
    reasonTags,
  };
}

function normalizePersistedLipSyncStatus(
  value: string | null | undefined,
): LipSyncPersistedStatus {
  if (
    value === "queued" ||
    value === "generating" ||
    value === "done" ||
    value === "error"
  ) {
    return value;
  }

  return "none";
}

export function deriveLipSyncState(
  input: DerivedLipSyncStateInput,
): DerivedLipSyncState {
  const blockerReasons = input.blockerReasons?.filter(Boolean) ?? [];
  const staleReasons: string[] = [];
  const persistedStatus = normalizePersistedLipSyncStatus(input.persistedStatus);

  if (input.hasMaster) {
    if (
      input.sourceVideoPath &&
      input.currentVideoPath &&
      input.sourceVideoPath !== input.currentVideoPath
    ) {
      staleReasons.push("Kaynak video degisti.");
    } else if (input.sourceVideoPath && !input.currentVideoPath) {
      staleReasons.push("Kaynak video artik mevcut degil.");
    }

    if (
      input.sourceAudioPath &&
      input.currentAudioPath &&
      input.sourceAudioPath !== input.currentAudioPath
    ) {
      staleReasons.push("Kaynak ses degisti.");
    } else if (input.sourceAudioPath && !input.currentAudioPath) {
      staleReasons.push("Kaynak ses artik mevcut degil.");
    }
  }

  if (staleReasons.length > 0) {
    return {
      status: "stale",
      isStale: true,
      staleReasons,
    };
  }

  if (!input.hasMaster && blockerReasons.length > 0) {
    return {
      status: "blocked",
      isStale: false,
      staleReasons: [],
    };
  }

  return {
    status: persistedStatus,
    isStale: false,
    staleReasons: [],
  };
}
