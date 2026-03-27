import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  AudioLines,
  ArrowUpToLine,
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Expand,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Pencil,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { DialoguePerformanceEditor } from "@/components/audio/DialoguePerformanceEditor";
import { DialogueTextEditor } from "@/components/audio/DialogueTextEditor";
import {
  MediaLightbox,
  type MediaLightboxItem,
} from "@/components/media/MediaLightbox";
import { getAppSetting } from "@/lib/store";
import { downloadMediaFile } from "@/lib/media-download";
import {
  deleteAssetPath,
  deleteAssetRecord,
  getShotAssets,
  type AssetWithTags,
} from "@/services/asset.service";
import {
  analyzeKlingVideoPrompt,
  clampKlingDuration,
  distributeKlingMultiShotDurations,
  getKlingMultiPromptValidationMessage,
  KLING_V3_DURATION_VALUES,
  resolveImageModel,
  type KlingDuration,
  type KlingShotType,
} from "@/services/fal.service";
import {
  enqueueAudioDialogueJob,
  cancelJob,
  enqueueUpscaleJobs,
  enqueueStoryboardFrameJob,
  enqueueVideoJobs,
} from "@/services/jobqueue.service";
import {
  clearDialogueTextOverride,
  clearDialogueGenerationProfile,
  getDialogueAudioShotById,
  saveDialogueTextOverride,
  saveDialogueGenerationProfile,
  type DialogueAudioTake,
  type DialogueAudioShot,
  type DialogueGenerationProfile,
  type DialogueOverrideLine,
} from "@/services/audio-pipeline.service";
import {
  AUTONOMOUS_VARIANT_COUNT,
  bootstrapAutonomousShot,
  getAutonomousCandidateGroups,
  regenerateAutonomousStage,
  selectAutonomousCandidate,
  type AutonomousCandidateAsset,
  type AutonomousStage,
} from "@/services/storyboard-autonomous.service";
import {
  assignCharacterLookToShot,
  clearShotCharacterLookBinding,
  listCharacters,
  type CharacterRecord,
} from "@/services/character.service";
import { clearShotExternalReference, updateShotPromptFields, saveShotExternalReference, setShotArchived, updateShotPaths, type ShotRow } from "@/services/import.service";
import {
  listPromptTemplates,
  type PromptTemplateRecord,
} from "@/services/prompt-template.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore, type Job } from "@/store/queue.store";

type DetailView = "start" | "end" | "video";
type MediaView = DetailView | "audio";
type CandidateGroups = Record<AutonomousStage, AutonomousCandidateAsset[]>;
type VariantBurstView = DetailView;
type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:2";

type StoryboardMediaVariant = {
  id: string;
  assetId?: string;
  stage: DetailView;
  kind: "image" | "video";
  url: string | null;
  path: string | null;
  filename: string;
  prompt: string | null;
  modelUsed: string | null;
  status: string;
  createdAt: number;
  isSelected: boolean;
  isFallback: boolean;
  resolution: string | null;
  width: number | null;
  height: number | null;
};

type ImageEditDraft = {
  stage: "start" | "end";
  variantId: string;
  variantLabel: string;
  absolutePath: string;
  previewUrl: string;
  width: number | null;
  height: number | null;
};

type ImageEditPoint = {
  x: number;
  y: number;
};

type ImageEditStroke = {
  id: string;
  color: string;
  size: number;
  points: ImageEditPoint[];
};

const EMPTY_GROUPS: CandidateGroups = { start: [], end: [], video: [] };
const VARIANT_BURST_OPTIONS = [2, 3, 4, 6] as const;
const IMAGE_ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:2"];
const IMAGE_EDIT_COLORS = [
  "rgba(245,158,11,0.96)",
  "rgba(59,130,246,0.94)",
  "rgba(239,68,68,0.94)",
  "rgba(34,197,94,0.94)",
  "rgba(255,255,255,0.96)",
] as const;
const IMAGE_ASPECT_RATIO_VALUES: Record<ImageAspectRatio, number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
};

interface ShotDetailPanelProps {
  shot: ShotRow;
  initialView?: DetailView;
  projectFolderPath: string;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

function toAbsoluteProjectPath(projectFolderPath: string, relativePath: string): string {
  const normalizedBase = projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

function formatAudioTakeLabel(take: DialogueAudioTake): string {
  return `Take ${String(take.takeNumber).padStart(2, "0")}`;
}

function formatAudioTakeCreatedAt(value: number): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function statusColor(status: string) {
  if (status === "done") return "var(--status-success)";
  if (status === "review") return "var(--text-primary)";
  if (status === "generating") return "var(--status-warning)";
  if (status === "error") return "var(--status-error)";
  return "var(--text-muted)";
}

function normalizeStoredPath(path: string | null | undefined): string | null {
  return path ? path.replace(/\\/g, "/") : null;
}

function getShotPromptForView(shot: ShotRow, view: DetailView): string | null {
  if (view === "start") {
    return shot.promptStart;
  }

  if (view === "end") {
    return shot.promptEnd;
  }

  return shot.promptVideo;
}

function inferStoryboardVariantStage(
  asset: AssetWithTags,
  shot: ShotRow,
): DetailView | null {
  if (asset.tagsList.includes("autonomous") || asset.tagsList.includes("candidate")) {
    return null;
  }

  if (asset.tagsList.includes("stage:start")) {
    return "start";
  }

  if (asset.tagsList.includes("stage:end")) {
    return "end";
  }

  if (asset.tagsList.includes("stage:video")) {
    return "video";
  }

  const normalizedPath = normalizeStoredPath(asset.file_path);

  if (normalizedPath && normalizedPath === normalizeStoredPath(shot.imageStartPath)) {
    return "start";
  }

  if (normalizedPath && normalizedPath === normalizeStoredPath(shot.imageEndPath)) {
    return "end";
  }

  if (
    normalizedPath &&
    (normalizedPath === normalizeStoredPath(shot.video4kPath) ||
      normalizedPath === normalizeStoredPath(shot.videoPath))
  ) {
    return "video";
  }

  const filename = asset.filename.toLowerCase();

  if (asset.type === "image") {
    if (filename.includes("_start")) {
      return "start";
    }

    if (filename.includes("_end")) {
      return "end";
    }
  }

  if (asset.type === "video" && filename.includes("_video")) {
    return "video";
  }

  return null;
}

function buildManualVariantOutputSuffix(
  mode: VariantBurstView,
  batchKey: string,
  index: number,
): string {
  return `manual_${mode}_${batchKey}_v${String(index + 1).padStart(2, "0")}`;
}

function inferImageAspectRatioFromVariant(
  variant: Pick<StoryboardMediaVariant, "width" | "height">,
): ImageAspectRatio {
  if (!variant.width || !variant.height) {
    return "16:9";
  }

  const assetRatio = variant.width / variant.height;
  let bestMatch: ImageAspectRatio = "16:9";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const distance = Math.abs(IMAGE_ASPECT_RATIO_VALUES[ratio] - assetRatio);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = ratio;
    }
  }

  return bestMatch;
}

function createLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultImageEditPrompt(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  const preserveInstruction =
    "Preserve the original image composition, subject identity, camera angle, lighting, and all unmarked regions. Apply only subtle local edits that follow the markup and keep the rest of the frame unchanged.";

  return trimmedPrompt.length > 0
    ? `${trimmedPrompt}\n${preserveInstruction}`
    : "Apply only the local changes indicated by the markup overlay and keep the rest of the image exactly as it is. Do not redesign the frame.";
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function inferImageMimeType(path: string): string {
  const normalizedPath = path.toLowerCase();

  if (normalizedPath.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalizedPath.endsWith(".webp")) {
    return "image/webp";
  }

  if (normalizedPath.endsWith(".gif")) {
    return "image/gif";
  }

  return "application/octet-stream";
}

function clampNormalizedCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function strokePointsToSvgPoints(points: ImageEditPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function describeShotQueueJob(job: Job): string {
  switch (job.type) {
    case "image_start":
      return "START frame";
    case "image_end":
      return "END frame";
    case "video":
      return "Video";
    case "coverage_image":
      return "Coverage frame";
    case "coverage_video":
      return "Coverage video";
    case "upscale":
      return "4K upscale";
    case "audio_dialogue":
      return "Dialogue audio";
    case "character_image":
      return "Character candidate";
    default:
      return "Queue job";
  }
}

export function ShotDetailPanel({
  shot,
  initialView = "start",
  projectFolderPath,
  onClose,
  onRefresh,
}: ShotDetailPanelProps) {
  const navigate = useNavigate();
  const activeProject = useProjectStore((state) => state.activeProject);
  const [activeMediaView, setActiveMediaView] = useState<MediaView>(initialView);
  const [activePromptTab, setActivePromptTab] = useState<DetailView>(initialView);
  const [producing, setProducing] = useState<DetailView | null>(null);
  const [burstProducing, setBurstProducing] = useState<VariantBurstView | null>(null);
  const [groups, setGroups] = useState<CandidateGroups>(EMPTY_GROUPS);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [shotAssets, setShotAssets] = useState<AssetWithTags[]>([]);
  const [loadingShotAssets, setLoadingShotAssets] = useState(true);
  const [variantIndexByView, setVariantIndexByView] = useState<Record<DetailView, number>>({
    start: 0,
    end: 0,
    video: 0,
  });
  const [variantBurstCount, setVariantBurstCount] = useState<Record<VariantBurstView, number>>({
    start: 3,
    end: 3,
    video: 2,
  });
  const [mediaPathOverrides, setMediaPathOverrides] = useState<
    Partial<Record<DetailView, string | null>>
  >({});
  const [assigningVariantId, setAssigningVariantId] = useState<string | null>(null);
  const [deletingVariantId, setDeletingVariantId] = useState<string | null>(null);
  const [clearingMediaView, setClearingMediaView] = useState<DetailView | null>(null);
  const [stageAction, setStageAction] = useState<AutonomousStage | null>(null);
  const [selectingAssetId, setSelectingAssetId] = useState<string | null>(null);
  const [updatingReference, setUpdatingReference] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [templates, setTemplates] = useState<PromptTemplateRecord[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [bindingCharacter, setBindingCharacter] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [selectedCharacterId, setSelectedCharacterId] = useState(shot.characterId ?? "");
  const [selectedLookId, setSelectedLookId] = useState(shot.characterLookId ?? "");
  const [includeCharacterPrompt, setIncludeCharacterPrompt] = useState(Boolean(shot.includeCharacterPrompt));
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null);
  const [imageEditDraft, setImageEditDraft] = useState<ImageEditDraft | null>(null);
  const [imageEditPrompt, setImageEditPrompt] = useState("");
  const [imageEditAspectRatio, setImageEditAspectRatio] = useState<ImageAspectRatio>("16:9");
  const [imageEditStrokes, setImageEditStrokes] = useState<ImageEditStroke[]>([]);
  const [imageEditBrushColor, setImageEditBrushColor] = useState<string>(IMAGE_EDIT_COLORS[0]);
  const [imageEditBrushSize, setImageEditBrushSize] = useState(18);
  const [submittingImageEdit, setSubmittingImageEdit] = useState(false);
  const activeImageEditStrokeIdRef = useRef<string | null>(null);
  const imageEditStageRef = useRef<HTMLDivElement | null>(null);
  const [videoGenerateAudio, setVideoGenerateAudio] = useState(true);
  const [videoShotType, setVideoShotType] = useState<KlingShotType>("customize");
  const [videoDuration, setVideoDuration] = useState<KlingDuration>(clampKlingDuration(shot.durationS));
  const [dialogueAudioDetail, setDialogueAudioDetail] = useState<DialogueAudioShot | null>(null);
  const [loadingDialogueAudioDetail, setLoadingDialogueAudioDetail] = useState(false);
  const [queueingDialogueAudio, setQueueingDialogueAudio] = useState(false);
  const queueJobs = useQueueStore((state) => state.jobs);
  const [promptDrafts, setPromptDrafts] = useState<Record<DetailView, string>>({
    start: shot.promptStart ?? "",
    end: shot.promptEnd ?? "",
    video: shot.promptVideo ?? "",
  });

  useEffect(() => {
    setActiveMediaView(initialView);
    setActivePromptTab(initialView);
    setVariantIndexByView({ start: 0, end: 0, video: 0 });
  }, [initialView, shot.id]);

  useEffect(() => {
    setPromptDrafts({
      start: shot.promptStart ?? "",
      end: shot.promptEnd ?? "",
      video: shot.promptVideo ?? "",
    });
    setSelectedCharacterId(shot.characterId ?? "");
    setSelectedLookId(shot.characterLookId ?? "");
    setIncludeCharacterPrompt(Boolean(shot.includeCharacterPrompt));
    setLightboxItem(null);
    setImageEditDraft(null);
    setImageEditPrompt("");
    setImageEditAspectRatio("16:9");
    setImageEditStrokes([]);
    setImageEditBrushColor(IMAGE_EDIT_COLORS[0]);
    setImageEditBrushSize(18);
  }, [shot.characterId, shot.characterLookId, shot.id, shot.includeCharacterPrompt, shot.promptEnd, shot.promptStart, shot.promptVideo]);

  useEffect(() => {
    setVideoGenerateAudio(true);
    setVideoShotType("customize");
    setVideoDuration(clampKlingDuration(shot.durationS));
  }, [shot.durationS, shot.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadDialogueAudioDetail() {
      setLoadingDialogueAudioDetail(true);

      try {
        const detail = await getDialogueAudioShotById(shot.id);
        if (!cancelled) {
          setDialogueAudioDetail(detail);
        }
      } catch (error) {
        console.error("Failed to load dialogue audio detail", error);
        if (!cancelled) {
          setDialogueAudioDetail(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingDialogueAudioDetail(false);
        }
      }
    }

    void loadDialogueAudioDetail();

    return () => {
      cancelled = true;
    };
  }, [shot.id, shot.audioDirectionJson, shot.audioMasterPath, shot.audioStatus, shot.updatedAt]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (imageEditDraft) {
        if (submittingImageEdit) {
          return;
        }

        closeImageEditModal();
        return;
      }

      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageEditDraft, onClose, submittingImageEdit]);

  async function refreshAll() {
    await onRefresh();
    const [nextGroups, nextAssets, nextDialogueAudioDetail] = await Promise.all([
      getAutonomousCandidateGroups(shot.id),
      activeProject ? getShotAssets(activeProject.id, shot.id) : Promise.resolve<AssetWithTags[]>([]),
      getDialogueAudioShotById(shot.id),
    ]);
    setGroups(nextGroups);
    setShotAssets(nextAssets);
    setDialogueAudioDetail(nextDialogueAudioDetail);
  }

  async function handleQueueDialogueAudio() {
    setQueueingDialogueAudio(true);

    try {
      await enqueueAudioDialogueJob({ shotId: shot.id });
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Dialogue audio kuyruga eklenemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setQueueingDialogueAudio(false);
    }
  }

  async function handleSaveDialogueOverride(lines: DialogueOverrideLine[]) {
    setQueueingDialogueAudio(true);

    try {
      await saveDialogueTextOverride({ shotId: shot.id, lines });
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Seslendirme metni kaydedilemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setQueueingDialogueAudio(false);
    }
  }

  async function handleClearDialogueOverride() {
    setQueueingDialogueAudio(true);

    try {
      await clearDialogueTextOverride(shot.id);
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Seslendirme metni sifirlanamadi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setQueueingDialogueAudio(false);
    }
  }

  async function handleSaveDialogueGenerationProfile(profile: DialogueGenerationProfile) {
    setQueueingDialogueAudio(true);

    try {
      await saveDialogueGenerationProfile(shot.id, profile);
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Duygu tonu ayari kaydedilemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setQueueingDialogueAudio(false);
    }
  }

  async function handleClearDialogueGenerationProfile() {
    setQueueingDialogueAudio(true);

    try {
      await clearDialogueGenerationProfile(shot.id);
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Duygu tonu ayari sifirlanamadi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setQueueingDialogueAudio(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      setLoadingGroups(true);
      try {
        const next = await getAutonomousCandidateGroups(shot.id);
        if (!cancelled) setGroups(next);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    }
    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, [shot.id, shot.updatedAt]);

  useEffect(() => {
    let cancelled = false;

    async function loadShotAssetsForModal() {
      if (!activeProject) {
        setShotAssets([]);
        setLoadingShotAssets(false);
        return;
      }

      setLoadingShotAssets(true);
      try {
        const assets = await getShotAssets(activeProject.id, shot.id);
        if (!cancelled) {
          setShotAssets(assets);
        }
      } catch (error) {
        console.error("Failed to load shot assets for storyboard modal", error);
        if (!cancelled) {
          setShotAssets([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingShotAssets(false);
        }
      }
    }

    void loadShotAssetsForModal();

    return () => {
      cancelled = true;
    };
  }, [activeProject, shot.id, shot.updatedAt]);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      try {
        const nextTemplates = await listPromptTemplates();
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      } catch (error) {
        console.error("Failed to load prompt templates for shot detail", error);
        if (!cancelled) {
          setTemplates([]);
        }
      }
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [shot.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadCharacters() {
      setLoadingCharacters(true);
      try {
        const nextCharacters = await listCharacters();
        if (!cancelled) {
          setCharacters(nextCharacters);
        }
      } catch (error) {
        console.error("Failed to load characters for shot detail", error);
        if (!cancelled) {
          setCharacters([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingCharacters(false);
        }
      }
    }

    void loadCharacters();

    return () => {
      cancelled = true;
    };
  }, [shot.id, shot.updatedAt]);

  useEffect(() => {
    setMediaPathOverrides({});
  }, [shot.id, shot.imageEndPath, shot.imageStartPath, shot.video4kPath, shot.videoPath]);

  const effectiveStartPath =
    mediaPathOverrides.start !== undefined
      ? mediaPathOverrides.start
      : shot.imageStartPath;
  const effectiveEndPath =
    mediaPathOverrides.end !== undefined ? mediaPathOverrides.end : shot.imageEndPath;
  const effectiveVideoPath =
    mediaPathOverrides.video !== undefined
      ? mediaPathOverrides.video
      : shot.video4kPath ?? shot.videoPath;
  const startImageUrl = effectiveStartPath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, effectiveStartPath))
    : null;
  const endImageUrl = effectiveEndPath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, effectiveEndPath))
    : null;
  const videoUrl = effectiveVideoPath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, effectiveVideoPath))
    : null;
  const activeDialogueShot = dialogueAudioDetail?.shot ?? shot;
  const activeDialogueTake =
    dialogueAudioDetail?.audioTakes.find((take) => take.isMaster) ??
    dialogueAudioDetail?.audioTakes[0] ??
    null;
  const historicalDialogueTakes = dialogueAudioDetail?.audioTakes.filter(
    (take) => !activeDialogueTake || take.relativePath !== activeDialogueTake.relativePath,
  ) ?? [];
  const dialogueAudioRelativePath =
    activeDialogueTake?.relativePath ?? activeDialogueShot.audioMasterPath;
  const dialogueAudioUrl = dialogueAudioRelativePath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, dialogueAudioRelativePath))
    : null;
  const externalReferenceUrl = shot.externalReferencePath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, shot.externalReferencePath))
    : null;
  const missingExternalReference =
    shot.requiresExternalReference && !shot.externalReferencePath;
  const mediaByView = {
    start: { url: startImageUrl, label: "START", kind: "image" as const, status: shot.imageStatus, path: effectiveStartPath },
    end: { url: endImageUrl, label: "END", kind: "image" as const, status: shot.imageStatus, path: effectiveEndPath },
    video: { url: videoUrl, label: effectiveVideoPath && effectiveVideoPath === shot.video4kPath ? "VIDEO 4K" : "VIDEO", kind: "video" as const, status: shot.videoStatus, path: effectiveVideoPath },
  };
  const audioMedia = {
    url: dialogueAudioUrl,
    label: "AUDIO",
    kind: "audio" as const,
    status: activeDialogueShot.audioStatus,
    path: dialogueAudioRelativePath,
  };
  const storyboardVariants = useMemo<Record<DetailView, StoryboardMediaVariant[]>>(() => {
    const collections: Record<DetailView, StoryboardMediaVariant[]> = {
      start: [],
      end: [],
      video: [],
    };
    const seenByView: Record<DetailView, Set<string>> = {
      start: new Set<string>(),
      end: new Set<string>(),
      video: new Set<string>(),
    };

    for (const asset of shotAssets) {
      const stage = inferStoryboardVariantStage(asset, shot);

      if (!stage) {
        continue;
      }

      const path = normalizeStoredPath(asset.file_path);
      const key = path ?? asset.id;

      if (seenByView[stage].has(key)) {
        continue;
      }

      seenByView[stage].add(key);
      const selectedStagePath = normalizeStoredPath(mediaByView[stage].path);
      collections[stage].push({
        id: asset.id,
        assetId: asset.id,
        stage,
        kind: asset.type === "video" ? "video" : "image",
        url: convertFileSrc(toAbsoluteProjectPath(projectFolderPath, asset.file_path)),
        path,
        filename: asset.filename,
        prompt: asset.prompt,
        modelUsed: asset.model_used,
        status:
          path === selectedStagePath
            ? mediaByView[stage].status
            : "review",
        createdAt: asset.created_at,
        isSelected: path === selectedStagePath,
        isFallback: false,
        resolution: asset.resolution,
        width: asset.width,
        height: asset.height,
      });
    }

    (["start", "end", "video"] as DetailView[]).forEach((view) => {
      const canonicalPath = normalizeStoredPath(mediaByView[view].path);
      const canonicalUrl = mediaByView[view].url;

      if (
        canonicalPath &&
        canonicalUrl &&
        !seenByView[view].has(canonicalPath)
      ) {
        collections[view].push({
          id: `selected:${view}:${canonicalPath}`,
          stage: view,
          kind: mediaByView[view].kind,
          url: canonicalUrl,
          path: canonicalPath,
          filename: canonicalPath.split("/").pop() ?? `${view}.media`,
          prompt: getShotPromptForView(shot, view),
          modelUsed: view === "video" ? shot.videoModelUsed : shot.imageModelUsed,
          status: mediaByView[view].status,
          createdAt: shot.updatedAt,
          isSelected: true,
          isFallback: true,
          resolution:
            view === "video" && canonicalPath === normalizeStoredPath(shot.video4kPath)
              ? "4K"
              : "HD",
          width: null,
          height: null,
        });
      }

      collections[view].sort((left, right) => {
        if (left.isSelected !== right.isSelected) {
          return left.isSelected ? -1 : 1;
        }

        return right.createdAt - left.createdAt;
      });
    });

    return collections;
  }, [mediaByView, projectFolderPath, shot, shotAssets]);
  const isAudioMediaView = activeMediaView === "audio";
  const activeVariants = isAudioMediaView ? [] : storyboardVariants[activeMediaView];
  const activeVariantIndex =
    !isAudioMediaView && activeVariants.length > 0
      ? Math.min(variantIndexByView[activeMediaView], activeVariants.length - 1)
      : 0;
  const activeVariant = activeVariants[activeVariantIndex] ?? null;
  useEffect(() => {
    setVariantIndexByView((current) => ({
      start:
        storyboardVariants.start.length === 0
          ? 0
          : Math.min(current.start, storyboardVariants.start.length - 1),
      end:
        storyboardVariants.end.length === 0
          ? 0
          : Math.min(current.end, storyboardVariants.end.length - 1),
      video:
        storyboardVariants.video.length === 0
          ? 0
          : Math.min(current.video, storyboardVariants.video.length - 1),
    }));
  }, [
    storyboardVariants.end.length,
    storyboardVariants.start.length,
    storyboardVariants.video.length,
  ]);
  const activeMedia = isAudioMediaView ? audioMedia : mediaByView[activeMediaView];
  const selectedStartVariant =
    storyboardVariants.start.find((variant) => variant.isSelected) ?? null;
  const selectedEndVariant =
    storyboardVariants.end.find((variant) => variant.isSelected) ?? null;
  const selectedStartAbsolutePath = selectedStartVariant?.path
    ? toAbsoluteProjectPath(projectFolderPath, selectedStartVariant.path)
    : undefined;
  const selectedEndAbsolutePath = selectedEndVariant?.path
    ? toAbsoluteProjectPath(projectFolderPath, selectedEndVariant.path)
    : undefined;
  const videoPosterUrl =
    selectedStartVariant?.url ??
    storyboardVariants.start[0]?.url ??
    startImageUrl ??
    endImageUrl ??
    undefined;
  const activePreviewUrl = isAudioMediaView ? dialogueAudioUrl : activeVariant?.url ?? activeMedia.url;
  const activePreviewKind = isAudioMediaView ? "audio" : activeVariant?.kind ?? activeMedia.kind;
  const activePreviewPath = isAudioMediaView ? shot.audioMasterPath : activeVariant?.path ?? activeMedia.path;
  const activePreviewStatus = isAudioMediaView ? shot.audioStatus : activeVariant?.status ?? activeMedia.status;
  const activePreviewFilename =
    (isAudioMediaView
      ? shot.audioMasterPath?.split(/[\\/]/).pop()
      : activeVariant?.filename) ??
    activeMedia.path?.split(/[\\/]/).pop() ??
    `${activeMedia.label.toLowerCase()}_preview`;
  const canDeleteActiveVariant = !isAudioMediaView && Boolean(activeVariant?.assetId || activeVariant?.path);
  const canEditActiveVariant =
    !isAudioMediaView &&
    Boolean(activeVariant?.path) &&
    activePreviewKind === "image" &&
    activeMediaView !== "video";
  const canSubmitImageEdit =
    Boolean(imageEditDraft) &&
    (imageEditPrompt.trim().length > 0 || imageEditStrokes.length > 0);
  const imageModel = resolveImageModel(shot.model);
  const defaultVideoDuration = clampKlingDuration(shot.durationS);
  const resolvedVideoDuration = videoDuration;
  const isVideoDurationOverridden = resolvedVideoDuration !== defaultVideoDuration;
  const promptContent = promptDrafts[activePromptTab];
  const videoPromptAnalysis = analyzeKlingVideoPrompt(promptDrafts.video);
  const selectedCharacter =
    characters.find((character) => character.id === selectedCharacterId) ?? null;
  const selectedLook =
    selectedCharacter?.looks.find((look) => look.id === selectedLookId) ??
    selectedCharacter?.looks.find((look) => look.id === selectedCharacter?.defaultLookId) ??
    selectedCharacter?.looks[0] ??
    null;
  const selectedCharacterPreview = selectedLook?.primaryImage
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, selectedLook.primaryImage))
    : null;
  const startReferenceMissing =
    missingExternalReference &&
    !(shot.chainStatus === "continue" && shot.usePreviousEndForStart);
  const endReferenceMissing = missingExternalReference;
  const shotQueueJobs = useMemo(
    () =>
      queueJobs.filter(
        (job) =>
          job.shotId === shot.id &&
          (job.status === "queued" || job.status === "active") &&
          (job.type === "image_start" ||
            job.type === "image_end" ||
            job.type === "video" ||
            job.type === "coverage_image" ||
            job.type === "coverage_video" ||
            job.type === "audio_dialogue" ||
            job.type === "upscale"),
      ),
    [queueJobs, shot.id],
  );
  const productionNotice =
    producing === "start"
      ? "START frame kuyruga aliniyor."
      : producing === "end"
        ? "END frame kuyruga aliniyor."
        : producing === "video"
          ? "Video kuyruga aliniyor."
        : burstProducing === "start"
          ? `${variantBurstCount.start} START varyanti kuyruga aliniyor.`
          : burstProducing === "end"
            ? `${variantBurstCount.end} END varyanti kuyruga aliniyor.`
            : burstProducing === "video"
              ? `${variantBurstCount.video} video varyanti kuyruga aliniyor.`
          : upscaling
            ? "4K upscale kuyruga aliniyor."
            : null;
  const shouldShowProductionState =
    Boolean(productionNotice) ||
    shotQueueJobs.length > 0 ||
    shot.imageStatus === "generating" ||
    shot.videoStatus === "generating" ||
    shot.audioStatus === "generating";
  const activePromptChanged =
    (activePromptTab === "start" && promptDrafts.start !== (shot.promptStart ?? "")) ||
    (activePromptTab === "end" && promptDrafts.end !== (shot.promptEnd ?? "")) ||
    (activePromptTab === "video" && promptDrafts.video !== (shot.promptVideo ?? ""));
  const activePromptEmpty = !promptContent.trim();

  function openActiveMediaPreview() {
    if (!activePreviewUrl || activePreviewKind === "audio") {
      return;
    }

    setLightboxItem({
      kind: activePreviewKind,
      src: activePreviewUrl,
      title: `${shot.shotNumber} / ${activeMedia.label} / ${activeVariantIndex + 1}`,
      subtitle: `${activePreviewStatus.toUpperCase()} / ${activePreviewFilename}`,
      description:
        activeVariant?.prompt ??
        (activeMediaView === "audio"
          ? dialogueAudioDetail?.audioDirection?.dialoguePreview ?? shot.audioDialoguePreview ?? "Dialogue transcript yok."
          : getShotPromptForView(shot, activeMediaView)) ??
        "Prompt kaydi yok.",
      downloadPath: activePreviewPath
        ? toAbsoluteProjectPath(projectFolderPath, activePreviewPath)
        : null,
      downloadName: activePreviewFilename,
    });
  }

  async function handleDownloadMedia(path: string | null | undefined, fileName: string, title: string) {
    if (!path) {
      return;
    }

    try {
      await downloadMediaFile({
        sourcePath: toAbsoluteProjectPath(projectFolderPath, path),
        suggestedName: fileName,
        dialogTitle: title,
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Medya indirilemedi.", {
        title,
        kind: "error",
      });
    }
  }

  function openImageEditModal(variant: StoryboardMediaVariant) {
    if (variant.stage === "video" || variant.kind !== "image" || !variant.path || !variant.url) {
      return;
    }

    setImageEditDraft({
      stage: variant.stage,
      variantId: variant.id,
      variantLabel: variant.filename,
      absolutePath: toAbsoluteProjectPath(projectFolderPath, variant.path),
      previewUrl: variant.url,
      width: variant.width,
      height: variant.height,
    });
    setImageEditPrompt("");
    setImageEditAspectRatio(inferImageAspectRatioFromVariant(variant));
    setImageEditStrokes([]);
    setImageEditBrushColor(IMAGE_EDIT_COLORS[0]);
    setImageEditBrushSize(18);
  }

  function closeImageEditModal() {
    if (submittingImageEdit) {
      return;
    }

    activeImageEditStrokeIdRef.current = null;
    setImageEditDraft(null);
    setImageEditPrompt("");
    setImageEditStrokes([]);
    setImageEditBrushColor(IMAGE_EDIT_COLORS[0]);
    setImageEditBrushSize(18);
  }

  function getImageEditPoint(
    event: ReactPointerEvent<HTMLDivElement>,
  ): ImageEditPoint | null {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: clampNormalizedCoordinate((event.clientX - rect.left) / rect.width),
      y: clampNormalizedCoordinate((event.clientY - rect.top) / rect.height),
    };
  }

  function handleImageEditPreviewLoad(event: SyntheticEvent<HTMLImageElement>) {
    const nextWidth = event.currentTarget.naturalWidth;
    const nextHeight = event.currentTarget.naturalHeight;

    if (!nextWidth || !nextHeight) {
      return;
    }

    setImageEditDraft((current) => {
      if (!current) {
        return current;
      }

      if (current.width === nextWidth && current.height === nextHeight) {
        return current;
      }

      return {
        ...current,
        width: nextWidth,
        height: nextHeight,
      };
    });
  }

  function handleImageEditPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!imageEditDraft || submittingImageEdit) {
      return;
    }

    const point = getImageEditPoint(event);

    if (!point) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const strokeId = createLocalId();
    activeImageEditStrokeIdRef.current = strokeId;

    setImageEditStrokes((current) => [
      ...current,
      {
        id: strokeId,
        color: imageEditBrushColor,
        size: imageEditBrushSize / Math.max(rect.width, rect.height),
        points: [point],
      },
    ]);

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleImageEditPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const activeStrokeId = activeImageEditStrokeIdRef.current;

    if (!activeStrokeId || submittingImageEdit) {
      return;
    }

    const point = getImageEditPoint(event);

    if (!point) {
      return;
    }

    setImageEditStrokes((current) =>
      current.map((stroke) =>
        stroke.id === activeStrokeId
          ? { ...stroke, points: [...stroke.points, point] }
          : stroke,
      ),
    );
  }

  function handleImageEditPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    activeImageEditStrokeIdRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function buildImageEditReferencePaths(): Promise<string[]> {
    if (!imageEditDraft) {
      throw new Error("Duzenlenecek kare bulunamadi.");
    }

    if (imageEditStrokes.length === 0) {
      return [imageEditDraft.absolutePath];
    }

    const imageBytes = await readFile(imageEditDraft.absolutePath);
    const sourceUrl = URL.createObjectURL(
      new Blob([imageBytes], { type: inferImageMimeType(imageEditDraft.absolutePath) }),
    );

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new window.Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Referans gorseli yuklenemedi."));
      nextImage.src = sourceUrl;
    });

    try {
      const width = imageEditDraft.width ?? image.naturalWidth;
      const height = imageEditDraft.height ?? image.naturalHeight;

      if (!width || !height) {
        throw new Error("Referans gorsel boyutu okunamadi.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Gorsel duzenleme tuvali hazirlanamadi.");
      }

      context.drawImage(image, 0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";

      for (const stroke of imageEditStrokes) {
        if (stroke.points.length === 0) {
          continue;
        }

        context.beginPath();
        context.strokeStyle = stroke.color;
        context.lineWidth = Math.max(3, stroke.size * Math.max(width, height));
        context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);

        for (const point of stroke.points.slice(1)) {
          context.lineTo(point.x * width, point.y * height);
        }

        if (stroke.points.length === 1) {
          context.lineTo(stroke.points[0].x * width, stroke.points[0].y * height);
        }

        context.stroke();
      }

      const guideFolder = await join(projectFolderPath, "assets", "images", "_edit-guides");
      await mkdir(guideFolder, { recursive: true });
      const guidePath = await join(
        guideFolder,
        `guide_${imageEditDraft.stage}_${createLocalId().slice(0, 8)}.png`,
      );
      const bytes = dataUrlToBytes(canvas.toDataURL("image/png"));
      await writeFile(guidePath, bytes);

      return [imageEditDraft.absolutePath, guidePath];
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  function undoImageEditStroke() {
    setImageEditStrokes((current) => current.slice(0, -1));
  }

  function clearImageEditStrokes() {
    activeImageEditStrokeIdRef.current = null;
    setImageEditStrokes([]);
  }

  function selectVariant(view: DetailView, index: number) {
    setActiveMediaView(view);
    setVariantIndexByView((current) => ({
      ...current,
      [view]: index,
    }));
  }

  function stepActiveVariant(direction: -1 | 1) {
    if (isAudioMediaView || activeVariants.length <= 1) {
      return;
    }

    setVariantIndexByView((current) => {
      const total = activeVariants.length;
      const activeDetailView = activeMediaView as DetailView;
      const nextIndex = (current[activeDetailView] + direction + total) % total;
      return {
        ...current,
        [activeDetailView]: nextIndex,
      };
    });
  }

  async function submitImageEdit() {
    if (!imageEditDraft || (!imageEditPrompt.trim() && imageEditStrokes.length === 0)) {
      return;
    }

    setSubmittingImageEdit(true);

    try {
      const referenceImagePaths = await buildImageEditReferencePaths();
      const batchKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const existingStagePath =
        imageEditDraft.stage === "start" ? effectiveStartPath : effectiveEndPath;

      await enqueueStoryboardFrameJob({
        shotId: shot.id,
        prompt: buildDefaultImageEditPrompt(imageEditPrompt),
        mode: imageEditDraft.stage,
        model: "fal-ai/nano-banana-2",
        aspectRatio: imageEditAspectRatio,
        cfg: shot.cfg ?? 7,
        steps: 28,
        priority: 148,
        outputSuffix: `edit_${imageEditDraft.stage}_${batchKey}`,
        assetTags: [`stage:${imageEditDraft.stage}`, "edited"],
        persistToShotPath: false,
        completeStatus: existingStagePath ? "done" : "review",
        referenceImagePaths,
      });

      setActiveMediaView(imageEditDraft.stage);
      setVariantIndexByView((current) => ({
        ...current,
        [imageEditDraft.stage]: 0,
      }));
      closeImageEditModal();

      await refreshAll();
      await message(
        `${imageEditDraft.stage.toUpperCase()} duzenleme isi Nano Banana 2 ile kuyruga alindi.`,
        {
          title: shot.shotNumber,
          kind: "info",
        },
      );
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Gorsel duzenleme kuyruga eklenemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setSubmittingImageEdit(false);
    }
  }

  async function queueStartFrame() {
    if (!promptDrafts.start.trim()) return;
    setProducing("start");
    try {
      await enqueueStoryboardFrameJob({ shotId: shot.id, prompt: promptDrafts.start.trim(), mode: "start", model: imageModel, cfg: shot.cfg ?? 7, steps: 28 });
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "START frame kuyruga eklenemedi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setProducing(null);
    }
  }

  async function queueFrameVariants(mode: VariantBurstView) {
    if (mode === "video") {
      return;
    }

    const prompt = mode === "start" ? promptDrafts.start.trim() : promptDrafts.end.trim();

    if (!prompt) {
      return;
    }

    setBurstProducing(mode);

    try {
      const quantity = variantBurstCount[mode];
      const batchKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

      for (let index = 0; index < quantity; index += 1) {
        await enqueueStoryboardFrameJob({
          shotId: shot.id,
          prompt,
          mode,
          model: imageModel,
          cfg: shot.cfg ?? 7,
          steps: 28,
          priority: 144 - index,
          persistToShotPath: false,
          completeStatus:
            mode === "start"
              ? (shot.imageStartPath ? "done" : "review")
              : (shot.imageEndPath ? "done" : "review"),
          outputSuffix: buildManualVariantOutputSuffix(mode, batchKey, index),
          assetTags: [`stage:${mode}`],
        });
      }

      setActiveMediaView(mode);
      setVariantIndexByView((current) => ({
        ...current,
        [mode]: 0,
      }));
      await refreshAll();
      await message(`${quantity} ${mode.toUpperCase()} varyanti kuyruga alindi.`, {
        title: shot.shotNumber,
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : `${mode.toUpperCase()} varyantlari kuyruga eklenemedi.`,
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setBurstProducing(null);
    }
  }

  async function queueVideoVariants() {
    if (!promptDrafts.video.trim()) {
      return;
    }

    setBurstProducing("video");

    try {
      const quantity = variantBurstCount.video;
      const batchKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const videoDuration = resolvedVideoDuration;

      if (videoPromptAnalysis.detectedMultiShot) {
        distributeKlingMultiShotDurations(videoDuration, videoPromptAnalysis.shotCount);
        const validationMessage = getKlingMultiPromptValidationMessage(videoPromptAnalysis);

        if (validationMessage) {
          throw new Error(validationMessage);
        }
      }

      for (let index = 0; index < quantity; index += 1) {
        await enqueueVideoJobs({
          model: "fal-ai/kling-video/v3/pro/image-to-video",
          prompt: promptDrafts.video.trim(),
          imageStartPath: selectedStartAbsolutePath,
          imageEndPath: selectedEndAbsolutePath,
          resolveStartDependencies: false,
          resolveEndDependencies: false,
          duration: videoDuration,
          aspectRatio: "16:9",
          cfg: 0.45,
          generateAudio: videoGenerateAudio,
          shotType: videoPromptAnalysis.detectedMultiShot ? videoShotType : undefined,
          quantity: 1,
          shotId: shot.id,
          priority: 132 - index,
          persistToShotPath: false,
          completeStatus: shot.videoPath || shot.video4kPath ? "done" : "review",
          outputSuffix: buildManualVariantOutputSuffix("video", batchKey, index),
          assetTags: ["stage:video"],
        });
      }

      setActiveMediaView("video");
      setVariantIndexByView((current) => ({
        ...current,
        video: 0,
      }));
      await refreshAll();
      await message(`${quantity} video varyanti kuyruga alindi.`, {
        title: shot.shotNumber,
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Video varyantlari kuyruga eklenemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setBurstProducing(null);
    }
  }

  async function queueEndFrame() {
    if (!promptDrafts.end.trim()) return;
    setProducing("end");
    try {
      await enqueueStoryboardFrameJob({ shotId: shot.id, prompt: promptDrafts.end.trim(), mode: "end", model: imageModel, cfg: shot.cfg ?? 7, steps: 28 });
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "END frame kuyruga eklenemedi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setProducing(null);
    }
  }

  async function queueVideo() {
    if (!promptDrafts.video.trim()) return;
    setProducing("video");
    try {
      const videoDuration = resolvedVideoDuration;

      if (videoPromptAnalysis.detectedMultiShot) {
        distributeKlingMultiShotDurations(videoDuration, videoPromptAnalysis.shotCount);
        const validationMessage = getKlingMultiPromptValidationMessage(videoPromptAnalysis);

        if (validationMessage) {
          throw new Error(validationMessage);
        }
      }

      await enqueueVideoJobs({
        model: "fal-ai/kling-video/v3/pro/image-to-video",
        prompt: promptDrafts.video.trim(),
        imageStartPath: selectedStartAbsolutePath,
        imageEndPath: selectedEndAbsolutePath,
        resolveStartDependencies: false,
        resolveEndDependencies: false,
        duration: videoDuration,
        aspectRatio: "16:9",
        cfg: 0.45,
        generateAudio: videoGenerateAudio,
        shotType: videoPromptAnalysis.detectedMultiShot ? videoShotType : undefined,
        quantity: 1,
        shotId: shot.id,
      });
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Video kuyruga eklenemedi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setProducing(null);
    }
  }

  async function handleUseVariant(variant: StoryboardMediaVariant) {
    if (!variant.path || variant.isSelected) {
      return;
    }

    setAssigningVariantId(variant.id);

    try {
      if (variant.stage === "start") {
        await updateShotPaths(shot.id, {
          imageStartPath: variant.path,
          imageStatus: "done",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          start: variant.path,
        }));
      } else if (variant.stage === "end") {
        await updateShotPaths(shot.id, {
          imageEndPath: variant.path,
          imageStatus: "done",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          end: variant.path,
        }));
      } else if (variant.resolution === "4K") {
        await updateShotPaths(shot.id, {
          video4kPath: variant.path,
          upscaleStatus: "done",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          video: variant.path,
        }));
      } else {
        await updateShotPaths(shot.id, {
          videoPath: variant.path,
          videoStatus: "done",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          video: variant.path,
        }));
      }

      setVariantIndexByView((current) => ({
        ...current,
        [variant.stage]: 0,
      }));
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : `${variant.stage.toUpperCase()} secimi kaydedilemedi.`,
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setAssigningVariantId(null);
    }
  }

  async function handleDisableActiveMedia(view: DetailView) {
    setClearingMediaView(view);

    try {
      if (view === "start") {
        await updateShotPaths(shot.id, {
          imageStartPath: null,
          imageStatus: effectiveEndPath ? "done" : "pending",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          start: null,
        }));
      } else if (view === "end") {
        await updateShotPaths(shot.id, {
          imageEndPath: null,
          imageStatus: effectiveStartPath ? "done" : "pending",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          end: null,
        }));
      } else if (activeVariant?.resolution === "4K" || activeVariant?.path === normalizeStoredPath(shot.video4kPath)) {
        await updateShotPaths(shot.id, {
          video4kPath: null,
          upscaleStatus: "none",
          videoStatus: shot.videoPath ? "done" : "pending",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          video: shot.videoPath ?? null,
        }));
      } else {
        await updateShotPaths(shot.id, {
          videoPath: null,
          videoStatus: shot.video4kPath ? "done" : "pending",
        });
        setMediaPathOverrides((current) => ({
          ...current,
          video: shot.video4kPath ?? null,
        }));
      }

      setVariantIndexByView((current) => ({
        ...current,
        [view]: 0,
      }));
      await refreshAll();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : `${view.toUpperCase()} slotu temizlenemedi.`,
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setClearingMediaView(null);
    }
  }

  async function handleDeleteVariant(variant: StoryboardMediaVariant) {
    if (!variant.path) {
      return;
    }

    const confirmed = await confirm(
      variant.isSelected
        ? `${shot.shotNumber} icin aktif ${variant.stage.toUpperCase()} medyasi silinecek ve slot bosalacak. Devam edilsin mi?`
        : `${variant.stage.toUpperCase()} varyanti kalici olarak silinecek. Devam edilsin mi?`,
      {
        title: "Varyanti sil",
        kind: "warning",
        okLabel: "Sil",
        cancelLabel: "Vazgec",
      },
    );

    if (!confirmed) {
      return;
    }

    setDeletingVariantId(variant.id);

    try {
      const normalizedVariantPath = normalizeStoredPath(variant.path);

      if (variant.isSelected && variant.stage === "start") {
        setMediaPathOverrides((current) => ({
          ...current,
          start: null,
        }));
      }

      if (variant.isSelected && variant.stage === "end") {
        setMediaPathOverrides((current) => ({
          ...current,
          end: null,
        }));
      }

      if (variant.isSelected && variant.stage === "video") {
        setMediaPathOverrides((current) => ({
          ...current,
          video:
            variant.path === normalizeStoredPath(shot.video4kPath)
              ? shot.videoPath ?? null
              : shot.video4kPath ?? null,
        }));
      }

      if (normalizedVariantPath) {
        setShotAssets((current) =>
          current.filter((asset) => normalizeStoredPath(asset.file_path) !== normalizedVariantPath),
        );
      }
      setLightboxItem(null);
      await new Promise((resolve) => setTimeout(resolve, variant.kind === "video" ? 180 : 40));

      const impact = variant.assetId
        ? await deleteAssetRecord(variant.assetId)
        : await deleteAssetPath(variant.path);

      setVariantIndexByView((current) => ({
        ...current,
        [variant.stage]: 0,
      }));
      await refreshAll();

      const impactSummary =
        impact && impact.slotCount > 0
          ? ` ${impact.slotCount} slot baglantisi kaldirildi.`
          : "";
      const cleanupSummary =
        impact?.fileDeletePending
          ? " Kaynak dosya su anda kilitli; diskten temizleme daha sonra tekrar denenecek."
          : "";

      await message(`${variant.stage.toUpperCase()} varyanti silindi.${impactSummary}${cleanupSummary}`, {
        title: shot.shotNumber,
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : `${variant.stage.toUpperCase()} varyanti silinemedi.`,
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setDeletingVariantId(null);
    }
  }

  function handleCancelShotJob(jobId: string) {
    cancelJob(jobId);
  }

  function handleCancelAllShotJobs() {
    shotQueueJobs.forEach((job) => cancelJob(job.id));
  }

  async function queueUpscale() {
    if (!shot.videoPath) return;

    setUpscaling(true);

    try {
      const savedFilter = await getAppSetting("DEFAULT_TENSORPIX_FILTER");
      await enqueueUpscaleJobs({
        shotId: shot.id,
        filterId: savedFilter ? Number.parseInt(savedFilter, 10) : undefined,
      });
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "4K upscale kuyruga eklenemedi.", {
        title: shot.shotNumber,
        kind: "error",
      });
    } finally {
      setUpscaling(false);
    }
  }

  async function handleApplyCharacterBinding() {
    if (!selectedCharacter || !selectedLook) {
      return;
    }

    setBindingCharacter(true);
    try {
      await assignCharacterLookToShot(
        shot.id,
        selectedCharacter.id,
        selectedLook.id,
        includeCharacterPrompt,
      );
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Karakter baglantisi kaydedilemedi.", {
        title: shot.shotNumber,
        kind: "error",
      });
    } finally {
      setBindingCharacter(false);
    }
  }

  async function handleClearCharacterBinding() {
    setBindingCharacter(true);
    try {
      await clearShotCharacterLookBinding(shot.id);
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Karakter baglantisi temizlenemedi.", {
        title: shot.shotNumber,
        kind: "error",
      });
    } finally {
      setBindingCharacter(false);
    }
  }

  async function handleBootstrap() {
    setStageAction("start");
    try {
      const result = await bootstrapAutonomousShot(shot.id);
      await message(`${result.jobCount} aday is kuyruga alindi.`, { title: shot.shotNumber, kind: "info" });
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Otonom mod baslatilamadi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setStageAction(null);
    }
  }

  async function handleRegenerate(stage: AutonomousStage) {
    setStageAction(stage);
    try {
      const result = await regenerateAutonomousStage(shot.id, stage);
      await message(`${result.jobCount} yeni ${stage.toUpperCase()} adayi kuyruga alindi.`, { title: shot.shotNumber, kind: "info" });
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Adaylar uretilmedi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setStageAction(null);
    }
  }

  async function handleSelect(assetId: string, stage: AutonomousStage) {
    setSelectingAssetId(assetId);
    try {
      const result = await selectAutonomousCandidate(shot.id, assetId);
      setActiveMediaView(stage);
      if (result.queuedJobs > 0) {
        await message(`${result.queuedJobs} takip isi otomatik kuyruga alindi.`, { title: shot.shotNumber, kind: "info" });
      }
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Aday secimi kaydedilemedi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setSelectingAssetId(null);
    }
  }

  async function handleArchiveToggle() {
    const shouldArchive = !shot.isArchived;
    const confirmed = await confirm(
      shouldArchive
        ? `${shot.shotNumber} ve coverage alt kartlari arsive alinsin mi?`
        : `${shot.shotNumber} arsivden geri alinsin mi?`,
      {
        title: shouldArchive ? "Shot archive" : "Shot restore",
        kind: "warning",
        okLabel: shouldArchive ? "Archive" : "Restore",
        cancelLabel: "Vazgec",
      },
    );

    if (!confirmed) {
      return;
    }

    try {
      await setShotArchived(shot.id, shouldArchive);
      await onRefresh();
      onClose();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Shot archive durumu guncellenemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    }
  }

  async function handleUploadReference() {
    const selected = await open({
      title: `${shot.shotNumber} referans gorselini sec`,
      multiple: false,
      filters: [{ name: "Gorsel", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    setUpdatingReference(true);

    try {
      await saveShotExternalReference(shot.id, selected);
      await onRefresh();
      await message("Referans gorseli kaydedildi.", {
        title: shot.shotNumber,
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Referans gorseli kaydedilemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setUpdatingReference(false);
    }
  }

  async function handleClearReference() {
    const confirmed = await confirm(
      `${shot.shotNumber} icin yuklu harici referans gorseli kaldirilsin mi?`,
      {
        title: "Referans kaldir",
        kind: "warning",
        okLabel: "Kaldir",
        cancelLabel: "Vazgec",
      },
    );

    if (!confirmed) {
      return;
    }

    setUpdatingReference(true);

    try {
      await clearShotExternalReference(shot.id);
      await onRefresh();
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Referans gorseli kaldirilamadi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setUpdatingReference(false);
    }
  }

  async function handleApplyTemplate() {
    if (!selectedTemplateId) {
      return;
    }

    const template = templates.find((entry) => entry.id === selectedTemplateId);
    if (!template) {
      return;
    }

    setApplyingTemplate(true);

    try {
      setPromptDrafts((current) => ({
        ...current,
        [activePromptTab]: template.content,
      }));
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Prompt template uygulanamadi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setApplyingTemplate(false);
    }
  }

  async function handleSavePrompt() {
    setSavingPrompt(true);

    try {
      await updateShotPromptFields(shot.id, {
        promptStart: activePromptTab === "start" ? promptDrafts.start : undefined,
        promptEnd: activePromptTab === "end" ? promptDrafts.end : undefined,
        promptVideo: activePromptTab === "video" ? promptDrafts.video : undefined,
      });
      await onRefresh();
      await message(`${activePromptTab.toUpperCase()} promptu kaydedildi.`, {
        title: shot.shotNumber,
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Prompt kaydedilemedi.",
        { title: shot.shotNumber, kind: "error" },
      );
    } finally {
      setSavingPrompt(false);
    }
  }

  function openAssetLibrary(
    target: "start" | "end" | "video" | "reference" = "start",
    selectedFilePath?: string | null,
  ) {
    navigate("/asset-library", {
      state: {
        shotId: shot.id,
        assignmentTarget: target,
        selectedFilePath: selectedFilePath ?? undefined,
        search: target === "reference" ? shot.externalReferenceName ?? shot.shotNumber : shot.shotNumber,
        typeFilter: target === "video" ? "video" : "image",
      },
    });
    onClose();
  }

  function openPromptLibrary() {
    navigate("/prompt-library");
    onClose();
  }

  function openModelManager() {
    navigate("/model-manager");
    onClose();
  }

  function openImageGenerator(stage: "start" | "end" = activeMediaView === "end" ? "end" : "start") {
    navigate("/image-generator", {
      state: {
        shotId: shot.id,
        shotStage: stage,
      },
    });
    onClose();
  }

  function openImageGeneratorWithReference(referencePath: string) {
    navigate("/image-generator", {
      state: {
        referenceAssetPath: referencePath,
      },
    });
    onClose();
  }

  function openVideoGenerator() {
    navigate("/video-generator", {
      state: {
        shotId: shot.id,
      },
    });
    onClose();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 160, display: "grid", placeItems: "center", padding: 28, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)" }}>
        <div onClick={(event) => event.stopPropagation()} style={{ width: "min(1320px, calc(100vw - 56px))", height: "min(900px, calc(100vh - 56px))", minHeight: 660, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", borderRadius: 32, overflow: "hidden", border: "1px solid #e8e8e8", background: "#ffffff", boxShadow: "0 24px 64px rgba(0,0,0,0.12)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "18px 22px", borderBottom: "1px solid #e8e8e8", background: "#ffffff" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "inline-flex", width: "fit-content", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.1)", background: "rgba(0,0,0,0.04)", color: "var(--accent)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}><Clapperboard size={13} />Shot inspector</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 24, letterSpacing: "-0.04em" }}>{shot.shotNumber}</strong>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{shot.shotType.toUpperCase()} / {shot.durationS ?? "--"}s / A{shot.act ?? "-"} S{shot.scene ?? "-"}</span>
              {shot.isArchived ? (
                <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(0,0,0,0.06)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Archived
                </span>
              ) : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn-secondary" type="button" onClick={() => void handleArchiveToggle()} style={{ padding: "8px 12px", fontSize: 12 }}>
              {shot.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              {shot.isArchived ? "Restore" : "Archive"}
            </button>
            <button type="button" onClick={onClose} className="icon-button" style={{ width: 40, height: 40, borderRadius: 999 }} aria-label="Detay modalini kapat"><X size={16} /></button>
          </div>
        </header>

        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(390px, 0.92fr)" }}>
          <section style={{ minWidth: 0, minHeight: 0, padding: 22, display: "grid", gridTemplateRows: "auto minmax(360px, 1.05fr) minmax(0, 1fr)", gap: 16, borderRight: "1px solid var(--border-subtle)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                {([
                  { key: "start", status: mediaByView.start.status },
                  { key: "end", status: mediaByView.end.status },
                  { key: "video", status: mediaByView.video.status },
                  { key: "audio", status: shot.audioStatus },
                ] as Array<{ key: MediaView; status: string }>).map((view) => (
                  <button key={view.key} type="button" onClick={() => setActiveMediaView(view.key)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 999, border: `1px solid ${activeMediaView === view.key ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.06)"}`, background: activeMediaView === view.key ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.02)", color: activeMediaView === view.key ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {view.key}<span style={{ padding: "2px 7px", borderRadius: 999, background: "rgba(0,0,0,0.06)", color: statusColor(view.status), fontSize: 9 }}>{view.status}</span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "8px 12px", borderRadius: 999, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.02)" }}>
                {activePreviewPath
                  ? `${activeVariantIndex + 1}/${Math.max(activeVariants.length, 1)} - ${activePreviewFilename}`
                  : `${activeMedia.label} henuz uretilmedi`}
              </div>
            </div>

            <div style={{ position: "relative", minHeight: 360, borderRadius: 28, border: "1px solid #e8e8e8", background: "#f3f3f4", overflow: "hidden", display: "grid" }}>
              {!activePreviewUrl ? (
                <div style={{ height: "100%", minHeight: 420, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text-muted)", gap: 12 }}>
                  {activePreviewKind === "video" ? <PlayCircle size={40} /> : activePreviewKind === "audio" ? <AudioLines size={40} /> : <ImageIcon size={40} />}
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-secondary)" }}>{activeMedia.label} preview hazir degil</div>
                </div>
              ) : activePreviewKind === "audio" ? (
                <div style={{ height: "100%", minHeight: 420, display: "grid", alignContent: "center", justifyItems: "center", gap: 16, padding: 28, textAlign: "center" }}>
                  <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
                    <div style={{ display: "inline-flex", justifyContent: "center", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)" }}>
                      <AudioLines size={16} />
                      Shot dialogue audio
                    </div>
                    <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                      {dialogueAudioDetail?.audioDirection?.dialoguePreview ??
                        shot.audioDialoguePreview ??
                        "Bu shot icin dialogue transcript bulunmuyor."}
                    </div>
                  </div>
                  <audio controls src={activePreviewUrl} style={{ width: "min(560px, 100%)" }} />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <button
                      className="btn-primary"
                      disabled={queueingDialogueAudio || loadingDialogueAudioDetail}
                      onClick={() => void handleQueueDialogueAudio()}
                      type="button"
                    >
                      <PlayCircle size={14} />
                      {queueingDialogueAudio ? "Queueing..." : "Bu shot'i yeniden seslendir"}
                    </button>
                    {dialogueAudioDetail?.characterCount ? (
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "7px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.02)", fontSize: 11, color: "var(--text-secondary)" }}>
                        {dialogueAudioDetail.characterCount} chars
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : activePreviewKind === "video" ? (
                <video key={activePreviewUrl} src={activePreviewUrl} controls playsInline poster={videoPosterUrl} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#f3f3f4" }} />
              ) : (
                <img src={activePreviewUrl} alt={`${shot.shotNumber} ${activeMedia.label}`} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#f3f3f4" }} />
              )}
              {activePreviewUrl ? (
                <div
                  style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    display: "flex",
                    gap: 8,
                  }}
                >
                  {activePreviewPath ? (
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        void handleDownloadMedia(activePreviewPath, activePreviewFilename, shot.shotNumber)
                      }
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        background: "rgba(255, 255, 255, 0.88)",
                        borderColor: "rgba(0, 0, 0, 0.1)",
                        color: "#1a1c1c",
                        backdropFilter: "blur(10px)",
                      }}
                      type="button"
                    >
                      <Download size={13} />
                      Indir
                    </button>
                  ) : null}
                  <button
                    className="btn-secondary"
                    onClick={openActiveMediaPreview}
                    disabled={activePreviewKind === "audio"}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "rgba(0, 0, 0, 0.78)",
                      borderColor: "rgba(255, 255, 255, 0.2)",
                      color: "#ffffff",
                      backdropFilter: "blur(10px)",
                    }}
                    type="button"
                  >
                    <Expand size={13} />
                    Buyut
                  </button>
                </div>
              ) : null}
              {activeVariants.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => stepActiveVariant(-1)}
                    className="icon-button"
                    aria-label="Onceki varyant"
                    style={{
                      position: "absolute",
                      left: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 42,
                      height: 42,
                      borderRadius: 999,
                      background: "rgba(255, 255, 255, 0.88)",
                      border: "1px solid rgba(0, 0, 0, 0.1)",
                      color: "#1a1c1c",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepActiveVariant(1)}
                    className="icon-button"
                    aria-label="Sonraki varyant"
                    style={{
                      position: "absolute",
                      right: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 42,
                      height: 42,
                      borderRadius: 999,
                      background: "rgba(255, 255, 255, 0.88)",
                      border: "1px solid rgba(0, 0, 0, 0.1)",
                      color: "#1a1c1c",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <div
                    style={{
                      position: "absolute",
                      left: 16,
                      bottom: 16,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "rgba(255, 255, 255, 0.88)",
                      border: "1px solid rgba(0, 0, 0, 0.1)",
                      color: "#1a1c1c",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {activeVariantIndex + 1} / {activeVariants.length} varyant
                  </div>
                </>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 12, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", paddingRight: 4 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {([
                  { key: "start", kind: "image" },
                  { key: "end", kind: "image" },
                  { key: "video", kind: "video" },
                  { key: "audio", kind: "audio" },
                ] as Array<{ key: MediaView; kind: "image" | "video" | "audio" }>).map((view) => (
                  <button key={view.key} type="button" onClick={() => setActiveMediaView(view.key)} style={{ display: "grid", gap: 8, padding: "12px 14px", borderRadius: 18, border: `1px solid ${activeMediaView === view.key ? "rgba(0,0,0,0.12)" : "var(--border-subtle)"}`, background: activeMediaView === view.key ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.02)", textAlign: "left", cursor: "pointer" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{view.kind === "video" ? <PlayCircle size={15} /> : view.kind === "audio" ? <AudioLines size={15} /> : <ImageIcon size={15} />}<strong style={{ fontSize: 12 }}>{view.key.toUpperCase()}</strong></div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                      {view.key === "audio"
                        ? dialogueAudioUrl
                          ? "Hazir preview"
                          : "Henuz uretilmedi"
                        : storyboardVariants[view.key].length > 0
                          ? `${storyboardVariants[view.key].length} varyant`
                          : mediaByView[view.key].url
                            ? "Hazir preview"
                            : "Henuz uretilmedi"}
                    </div>
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gap: 10, padding: "12px 14px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.02)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      {activeMediaView === "audio" ? "AUDIO actions" : `${activeMediaView.toUpperCase()} slider`}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {isAudioMediaView
                        ? dialogueAudioUrl
                          ? "Shot audio hazir"
                          : "Bu shot icin audio henuz uretilmedi."
                        : activeVariants.length > 0
                        ? `${activeVariants.length} kayit bulundu`
                        : loadingShotAssets
                          ? "Shot assetleri yukleniyor..."
                          : "Bu slot icin varyant yok."}
                    </div>
                  </div>
                  {isAudioMediaView ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {shot.audioMasterPath ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() =>
                            void handleDownloadMedia(
                              shot.audioMasterPath,
                              activePreviewFilename,
                              `${shot.shotNumber} AUDIO`,
                            )
                          }
                          style={{ padding: "8px 12px", fontSize: 11 }}
                        >
                          <Download size={13} />
                          Indir
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void handleQueueDialogueAudio()}
                        disabled={queueingDialogueAudio || loadingDialogueAudioDetail}
                        style={{ padding: "8px 12px", fontSize: 11 }}
                      >
                        <PlayCircle size={13} />
                        {queueingDialogueAudio ? "Queueing..." : shot.audioMasterPath ? "Regenerate AUDIO" : "Generate AUDIO"}
                      </button>
                    </div>
                  ) : activeVariant ? (
                    activeVariant.isSelected ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(34,197,94,0.22)", background: "rgba(34,197,94,0.12)", color: "var(--status-success)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          <Check size={13} />
                          Aktif {activeMediaView.toUpperCase()}
                        </div>
                        {activeVariant.path ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              void handleDownloadMedia(
                                activeVariant.path,
                                activeVariant.filename,
                                `${shot.shotNumber} ${activeMediaView.toUpperCase()}`,
                              )
                            }
                            style={{ padding: "8px 12px", fontSize: 11 }}
                          >
                            <Download size={13} />
                            Indir
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void handleDisableActiveMedia(activeMediaView)}
                          disabled={clearingMediaView === activeMediaView}
                          style={{ padding: "8px 12px", fontSize: 11 }}
                        >
                          <X size={13} />
                          {clearingMediaView === activeMediaView
                            ? "Temizleniyor..."
                            : "Devre disi birak"}
                        </button>
                        {canEditActiveVariant ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => openImageEditModal(activeVariant)}
                            disabled={submittingImageEdit}
                            style={{ padding: "8px 12px", fontSize: 11 }}
                          >
                            <Pencil size={13} />
                            Duzenle
                          </button>
                        ) : null}
                        {canDeleteActiveVariant ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void handleDeleteVariant(activeVariant)}
                            disabled={deletingVariantId === activeVariant.id}
                            style={{ padding: "8px 12px", fontSize: 11, borderColor: "rgba(239,68,68,0.28)", color: "var(--status-error)" }}
                          >
                            <Trash2 size={13} />
                            {deletingVariantId === activeVariant.id ? "Siliniyor..." : "Sil"}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {activeVariant.path ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              void handleDownloadMedia(
                                activeVariant.path,
                                activeVariant.filename,
                                `${shot.shotNumber} ${activeMediaView.toUpperCase()}`,
                              )
                            }
                            style={{ padding: "8px 12px", fontSize: 11 }}
                          >
                            <Download size={13} />
                            Indir
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => void handleUseVariant(activeVariant)}
                          disabled={assigningVariantId === activeVariant.id}
                          style={{ padding: "8px 12px", fontSize: 11 }}
                        >
                          {assigningVariantId === activeVariant.id
                            ? "Kaydediliyor..."
                            : `${activeMediaView.toUpperCase()} olarak kullan`}
                        </button>
                        {canEditActiveVariant ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => openImageEditModal(activeVariant)}
                            disabled={submittingImageEdit}
                            style={{ padding: "8px 12px", fontSize: 11 }}
                          >
                            <Pencil size={13} />
                            Duzenle
                          </button>
                        ) : null}
                        {canDeleteActiveVariant ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => void handleDeleteVariant(activeVariant)}
                            disabled={deletingVariantId === activeVariant.id}
                            style={{ padding: "8px 12px", fontSize: 11, borderColor: "rgba(239,68,68,0.28)", color: "var(--status-error)" }}
                          >
                            <Trash2 size={13} />
                            {deletingVariantId === activeVariant.id ? "Siliniyor..." : "Sil"}
                          </button>
                        ) : null}
                      </div>
                    )
                  ) : null}
                </div>

                {!isAudioMediaView && activeVariants.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                      {activeVariants.map((variant, index) => (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => selectVariant(activeMediaView, index)}
                          style={{
                            flex: "0 0 108px",
                            display: "grid",
                            gap: 8,
                            padding: 8,
                            borderRadius: 14,
                            border:
                              activeVariantIndex === index
                                ? "1px solid rgba(0,0,0,0.14)"
                                : variant.isSelected
                                  ? "1px solid rgba(34,197,94,0.24)"
                                  : "1px solid rgba(0,0,0,0.06)",
                            background:
                              activeVariantIndex === index
                                ? "rgba(0,0,0,0.04)"
                                : "rgba(0,0,0,0.02)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div style={{ borderRadius: 10, overflow: "hidden", aspectRatio: "4 / 3", background: "#eeeeee" }}>
                            {variant.url ? (
                              variant.kind === "video" ? (
                                <video src={variant.url} muted playsInline preload="metadata" poster={videoPosterUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : (
                                <img src={variant.url} alt={variant.filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              )
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
                                {variant.kind === "video" ? <PlayCircle size={18} /> : <ImageIcon size={18} />}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "grid", gap: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: variant.isSelected ? "var(--status-success)" : "var(--text-primary)" }}>
                              {variant.isSelected ? "Aktif secim" : `Varyant ${index + 1}`}
                            </span>
                            <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {variant.filename}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    {activeVariant ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ maxHeight: 108, overflowY: "auto", fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.7, paddingRight: 6 }}>
                          {activeVariant.modelUsed ? `${activeVariant.modelUsed} / ` : ""}
                          {activeVariant.resolution ? `${activeVariant.resolution} / ` : ""}
                          {activeVariant.prompt ?? getShotPromptForView(shot, activeMediaView) ?? "Prompt kaydi yok."}
                        </div>
                        {activeVariant.kind === "image" && activeVariant.path ? (
                          <button
                            className="btn-secondary"
                            onClick={() =>
                              openImageGeneratorWithReference(
                                toAbsoluteProjectPath(projectFolderPath, activeVariant.path!),
                              )
                            }
                            style={{ width: "fit-content", padding: "7px 10px", fontSize: 11 }}
                            type="button"
                          >
                            <ImageIcon size={13} />
                            Still Lab'e referans yap
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : isAudioMediaView ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {dialogueAudioDetail?.blockerReason ? (
                      <div style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(0,0,0,0.12)", background: "rgba(0,0,0,0.04)", color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>
                        {dialogueAudioDetail.blockerReason}
                      </div>
                    ) : null}
                    {dialogueAudioDetail?.resolvedLines.length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {dialogueAudioDetail.resolvedLines.map((line, index) => (
                          <span key={`${line.speakerKey}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(0,0,0,0.08)", background: "rgba(0,0,0,0.04)", fontSize: 11, color: "var(--text-secondary)" }}>
                            <strong style={{ color: "var(--text-primary)" }}>{line.speaker}</strong>
                            <span>{line.resolvedTargetLabel ?? "unresolved"}</span>
                            <span>{line.voiceName ?? line.voiceId ?? "voice missing"}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                        Bu shot icin parse edilen dialogue line yok.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section
            style={{
              minWidth: 0,
              minHeight: 0,
              padding: 22,
              display: "grid",
              alignContent: "start",
              gap: 14,
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            <section style={{ display: "grid", gap: 10, padding: "14px 16px", borderRadius: 22, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.01)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}><span>Shot capsule</span><span>{shot.imageStatus} / {shot.videoStatus} / {shot.audioStatus}</span></div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>{shot.summaryTr ?? "Bu shot icin Turkce ozet bulunmuyor."}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                <MetaChip label="Image model" value={imageModel} />
                <MetaChip label="Video model" value="kling-video/v3/pro" />
                <MetaChip label="CFG" value={shot.cfg ? String(shot.cfg) : "--"} />
                <MetaChip label="Preset" value={shot.klingPreset ?? "Shot default"} />
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn-primary" onClick={() => void handleBootstrap()} disabled={stageAction !== null} type="button"><Sparkles size={15} />{stageAction ? "Preparing..." : `Autonomous x${AUTONOMOUS_VARIANT_COUNT}`}</button>
                <button className="btn-secondary" onClick={() => void refreshAll()} type="button"><RefreshCw size={14} />Refresh</button>
              </div>
            </section>

            {shouldShowProductionState ? (
              <section
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 18,
                  border: "1px solid rgba(0,0,0,0.1)",
                  background: "rgba(0,0,0,0.03)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--accent)",
                    }}
                  >
                    <LoaderCircle className="spin-slow" size={13} />
                    Production status
                  </div>
                  {shotQueueJobs.length > 1 ? (
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={handleCancelAllShotJobs}
                      style={{ padding: "7px 10px", fontSize: 11 }}
                    >
                      <X size={13} />
                      Tumunu iptal et
                    </button>
                  ) : null}
                </div>

                {productionNotice ? (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {productionNotice}
                  </div>
                ) : null}

                {shotQueueJobs.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {shotQueueJobs.slice(0, 3).map((job) => {
                      const progressValue =
                        job.status === "queued"
                          ? 12
                          : Math.max(8, Math.min(100, Math.round(job.progress || 0)));

                      return (
                        <div
                          key={job.id}
                          style={{
                            display: "grid",
                            gap: 6,
                            padding: "10px 12px",
                            borderRadius: 14,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: "rgba(0,0,0,0.02)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            <span>{describeShotQueueJob(job)}</span>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                                {job.status === "queued" ? "Sirada" : `%${progressValue}`}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCancelShotJob(job.id)}
                                className="btn-secondary"
                                style={{ padding: "5px 8px", fontSize: 11 }}
                              >
                                <X size={12} />
                                Iptal
                              </button>
                            </div>
                          </div>
                          <div
                            style={{
                              height: 6,
                              borderRadius: 999,
                              overflow: "hidden",
                              background: "rgba(0,0,0,0.06)",
                            }}
                          >
                            <div
                              style={{
                                width: `${progressValue}%`,
                                height: "100%",
                                borderRadius: 999,
                                background: "linear-gradient(90deg, #1a1c1c, #4b5563)",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {shotQueueJobs.length > 3 ? (
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        +{shotQueueJobs.length - 3} ek is kuyrukta veya calisiyor.
                      </div>
                    ) : null}
                  </div>
                ) : shot.imageStatus === "generating" ||
                  shot.videoStatus === "generating" ||
                  shot.audioStatus === "generating" ? (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    Shot uretim durumu guncelleniyor. Ilgili is queue katmaninda aktif.
                  </div>
                ) : null}
              </section>
            ) : null}

            {dialogueAudioDetail || shot.audioStatus !== "none" || shot.audioDialoguePreview ? (
              <section
                style={{
                  display: "grid",
                  gap: 12,
                  padding: "14px 16px",
                  borderRadius: 18,
                  border: "1px solid rgba(59,130,246,0.18)",
                  background: "rgba(59,130,246,0.05)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "rgba(59,130,246,0.9)",
                      }}
                    >
                      <PlayCircle size={13} />
                      Dialogue audio
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      {dialogueAudioDetail?.audioDirection?.dialoguePreview ??
                        shot.audioDialoguePreview ??
                        "Bu shot icin parse edilen diyalog transcript yok."}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(0,0,0,0.06)",
                      background: "rgba(0,0,0,0.02)",
                      fontSize: 11,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span>Status</span>
                    <strong style={{ color: statusColor(activeDialogueShot.audioStatus) }}>
                      {activeDialogueShot.audioStatus}
                    </strong>
                  </div>
                </div>

                {loadingDialogueAudioDetail ? (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Dialogue audio detayi yukleniyor.
                  </div>
                ) : null}

                {dialogueAudioDetail?.resolvedLines.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {dialogueAudioDetail.resolvedLines.map((line, index) => (
                      <span
                        key={`${line.speakerKey}-${index}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(0,0,0,0.04)",
                          fontSize: 11,
                          color: "var(--text-secondary)",
                        }}
                      >
                        <strong style={{ color: "var(--text-primary)" }}>{line.speaker}</strong>
                        <span>{line.resolvedTargetLabel ?? "unresolved"}</span>
                        <span>{line.voiceName ?? line.voiceId ?? "voice missing"}</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {dialogueAudioDetail?.blockerReason ? (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.12)",
                      background: "rgba(0,0,0,0.04)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}
                  >
                    {dialogueAudioDetail.blockerReason}
                  </div>
                ) : null}

                <DialogueTextEditor
                  busy={queueingDialogueAudio || loadingDialogueAudioDetail}
                  description="Speaker etiketleri sabit kalir. Bu shot icin seslendirilecek replikleri burada hizlica duzenleyebilirsin."
                  hasOverride={Boolean(dialogueAudioDetail?.hasDialogueOverride)}
                  lines={dialogueAudioDetail?.audioDirection?.dialogueLines ?? []}
                  onClear={handleClearDialogueOverride}
                  onSave={handleSaveDialogueOverride}
                  title="Shot seslendirme metnini duzenle"
                />

                <DialoguePerformanceEditor
                  busy={queueingDialogueAudio || loadingDialogueAudioDetail}
                  description="Bu shot icin duygu/pacing preset'i, yonetmen notu ve OpenRouter ara katmanini acik veya kapali kullanma secimi."
                  hasOverride={Boolean(dialogueAudioDetail?.hasGenerationProfileOverride)}
                  onClear={handleClearDialogueGenerationProfile}
                  onSave={handleSaveDialogueGenerationProfile}
                  profile={
                    dialogueAudioDetail?.generationProfile ?? {
                      useOptimizer: true,
                      performancePreset: "auto",
                      performanceNote: null,
                    }
                  }
                  title="Shot duygu tonu ve optimizer"
                />

                {dialogueAudioUrl ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <audio controls src={dialogueAudioUrl} style={{ width: "100%" }} />
                    {activeDialogueTake ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "7px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: "rgba(0,0,0,0.02)",
                            fontSize: 11,
                            color: "var(--text-secondary)",
                          }}
                        >
                          master {formatAudioTakeLabel(activeDialogueTake)}
                        </span>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "7px 10px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.06)",
                            background: "rgba(0,0,0,0.02)",
                            fontSize: 11,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {formatAudioTakeCreatedAt(activeDialogueTake.createdAt)}
                        </span>
                        {activeDialogueTake.outputFormat ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "7px 10px",
                              borderRadius: 999,
                              border: "1px solid rgba(0,0,0,0.06)",
                              background: "rgba(0,0,0,0.02)",
                              fontSize: 11,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {activeDialogueTake.outputFormat}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {historicalDialogueTakes.length > 0 ? (
                      <details
                        style={{
                          borderRadius: 16,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "rgba(255,255,255,0.55)",
                          padding: "10px 12px",
                        }}
                      >
                        <summary
                          style={{
                            cursor: "pointer",
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                        >
                          Onceki take&apos;ler ({historicalDialogueTakes.length})
                        </summary>
                        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                          {historicalDialogueTakes.map((take) => {
                            const takeUrl = convertFileSrc(
                              toAbsoluteProjectPath(projectFolderPath, take.relativePath),
                            );

                            return (
                              <div
                                key={take.id}
                                style={{
                                  display: "grid",
                                  gap: 8,
                                  paddingTop: 12,
                                  borderTop: "1px solid rgba(0,0,0,0.08)",
                                }}
                              >
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      border: "1px solid rgba(0,0,0,0.06)",
                                      background: "rgba(0,0,0,0.02)",
                                      fontSize: 11,
                                      color: "var(--text-secondary)",
                                    }}
                                  >
                                    {formatAudioTakeLabel(take)}
                                  </span>
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      border: "1px solid rgba(0,0,0,0.06)",
                                      background: "rgba(0,0,0,0.02)",
                                      fontSize: 11,
                                      color: "var(--text-secondary)",
                                    }}
                                  >
                                    {formatAudioTakeCreatedAt(take.createdAt)}
                                  </span>
                                  {take.outputFormat ? (
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        padding: "6px 10px",
                                        borderRadius: 999,
                                        border: "1px solid rgba(0,0,0,0.06)",
                                        background: "rgba(0,0,0,0.02)",
                                        fontSize: 11,
                                        color: "var(--text-secondary)",
                                      }}
                                    >
                                      {take.outputFormat}
                                    </span>
                                  ) : null}
                                </div>
                                <audio controls src={takeUrl} style={{ width: "100%" }} />
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {activeDialogueShot.audioStatus === "done"
                      ? "Dialogue master dosyasi bekleniyor."
                      : "Heniz uretilmis dialogue audio yok."}
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn-primary"
                    disabled={
                      queueingDialogueAudio ||
                      loadingDialogueAudioDetail
                    }
                    onClick={() => void handleQueueDialogueAudio()}
                    type="button"
                  >
                    <PlayCircle size={14} />
                    {queueingDialogueAudio
                      ? "Queueing..."
                      : activeDialogueTake
                        ? "Regenerate dialogue"
                        : "Generate dialogue"}
                  </button>
                  {dialogueAudioDetail?.characterCount ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "7px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(0,0,0,0.06)",
                        background: "rgba(0,0,0,0.02)",
                        fontSize: 11,
                        color: "var(--text-secondary)",
                      }}
                    >
                      {dialogueAudioDetail.characterCount} chars
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {shot.chainStatus === "continue" ? (
              <section style={{ display: "grid", gap: 6, padding: "12px 14px", borderRadius: 18, border: "1px solid rgba(0,0,0,0.12)", background: "rgba(0,0,0,0.04)", color: "var(--text-primary)" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}><Link2 size={13} />Chain continue</div>
                <div style={{ fontSize: 12, lineHeight: 1.65 }}>
                  START referansi onceki shot&apos;in secilen END sonucundan gelir. END yoksa sistem
                  otomatik olarak onceki shot&apos;in START karesine duser.
                </div>
              </section>
            ) : null}

            {shot.requiresExternalReference ? (
              <section
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 18,
                  border: `1px solid ${missingExternalReference ? "rgba(0,0,0,0.12)" : "rgba(34,197,94,0.22)"}`,
                  background: missingExternalReference
                    ? "rgba(0,0,0,0.04)"
                    : "rgba(34,197,94,0.08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: missingExternalReference ? "var(--text-primary)" : "var(--status-success)" }}>
                      <AlertTriangle size={13} />
                      External reference
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      {shot.externalReferenceName
                        ? `Beklenen dosya: ${shot.externalReferenceName}`
                        : "Bu shot harici referans gorseli bekliyor."}
                    </div>
                  </div>
                  {externalReferenceUrl ? (
                    <button
                      onClick={() =>
                        setLightboxItem({
                          kind: "image",
                          src: externalReferenceUrl,
                          title: `${shot.shotNumber} / External reference`,
                          subtitle: shot.externalReferenceName ?? "Harici referans",
                          description: shot.externalReferenceNotes ?? "Bu shot icin yuklu referans gorseli.",
                          downloadPath: shot.externalReferencePath
                            ? toAbsoluteProjectPath(projectFolderPath, shot.externalReferencePath)
                            : null,
                          downloadName:
                            shot.externalReferenceName ??
                            shot.externalReferencePath?.split(/[\\/]/).pop() ??
                            null,
                        })
                      }
                      style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                      type="button"
                    >
                      <img
                        src={externalReferenceUrl}
                        alt={`${shot.shotNumber} reference`}
                        style={{
                          width: 72,
                          aspectRatio: "4 / 3",
                          borderRadius: 12,
                          objectFit: "cover",
                          border: "1px solid var(--border-subtle)",
                        }}
                      />
                    </button>
                  ) : null}
                </div>

                {shot.externalReferenceNotes ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    {shot.externalReferenceNotes}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={updatingReference}
                    onClick={() => void handleUploadReference()}
                  >
                    <Upload size={14} />
                    {shot.externalReferencePath ? "Replace reference" : "Upload reference"}
                  </button>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => openAssetLibrary("reference", shot.externalReferencePath)}
                  >
                    <Link2 size={14} />
                    Asset Library
                  </button>
                  {shot.externalReferencePath ? (
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={updatingReference}
                      onClick={() => void handleClearReference()}
                    >
                      <Trash2 size={14} />
                      Clear
                    </button>
                  ) : null}
                </div>

                {missingExternalReference ? (
                  <div style={{ fontSize: 11, color: "var(--text-primary)", lineHeight: 1.6 }}>
                    Bu shot icin START, END veya coverage gorseli uretmeden once referans gorsel yuklenmeli.
                    {shot.chainStatus === "continue"
                      ? " Zincir START continuity onceki END ile kurulur; END yoksa onceki START kullanilir. Ama sahne referansi yine END ve coverage icin gerekli olabilir."
                      : ""}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--status-success)", lineHeight: 1.6 }}>
                    Harici referans gorseli hazir. Uretim bu referansi kullanabilir.
                  </div>
                )}
              </section>
            ) : null}

            <section style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.01)" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Character binding</div>
              {loadingCharacters ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Karakterler yukleniyor...</div>
              ) : characters.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Once Characters ekranindan bir continuity profili olustur.
                </div>
              ) : (
                <>
                  <select
                    onChange={(event) => {
                      const nextCharacterId = event.target.value;
                      setSelectedCharacterId(nextCharacterId);
                      const nextCharacter = characters.find((character) => character.id === nextCharacterId);
                      setSelectedLookId(nextCharacter?.defaultLookId ?? nextCharacter?.looks[0]?.id ?? "");
                    }}
                    style={panelInputStyle}
                    value={selectedCharacterId}
                  >
                    <option value="">Karakter sec</option>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>
                        {character.name}
                      </option>
                    ))}
                  </select>

                  <select
                    disabled={!selectedCharacter}
                    onChange={(event) => setSelectedLookId(event.target.value)}
                    style={panelInputStyle}
                    value={selectedLookId}
                  >
                    <option value="">Look sec</option>
                    {selectedCharacter?.looks.map((look) => (
                      <option key={look.id} value={look.id}>
                        {look.name}
                      </option>
                    ))}
                  </select>

                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-secondary)" }}>
                    <input
                      checked={includeCharacterPrompt}
                      onChange={(event) => setIncludeCharacterPrompt(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Karakter prompt hint'ini START/END/VIDEO promptlarina ekle</span>
                  </label>

                  {selectedLook ? (
                    <div style={{ display: "grid", gap: 8, padding: "12px 12px 14px", borderRadius: 16, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.02)" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        {selectedCharacterPreview ? (
                          <button
                            onClick={() =>
                              setLightboxItem({
                                kind: "image",
                                src: selectedCharacterPreview,
                                title: `${selectedCharacter?.name ?? "Character"} / ${selectedLook.name}`,
                                subtitle: "Continuity look preview",
                                description:
                                  selectedLook.promptHint ??
                                  selectedCharacter?.promptHint ??
                                  "Continuity hint hazir degil.",
                                downloadPath: selectedLook.primaryImage || selectedLook.refImages[0]
                                  ? toAbsoluteProjectPath(
                                      projectFolderPath,
                                      selectedLook.primaryImage ?? selectedLook.refImages[0],
                                    )
                                  : null,
                                downloadName:
                                  (selectedLook.primaryImage ?? selectedLook.refImages[0])
                                    ?.split(/[\\/]/)
                                    .pop() ?? null,
                              })
                            }
                            style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
                            type="button"
                          >
                            <img
                              alt={selectedLook.name}
                              src={selectedCharacterPreview}
                              style={{ width: 72, aspectRatio: "4 / 3", borderRadius: 12, objectFit: "cover", border: "1px solid var(--border-subtle)" }}
                            />
                          </button>
                        ) : null}
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {selectedCharacter?.name} / {selectedLook.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                            {selectedLook.promptHint ?? selectedCharacter?.promptHint ?? "Continuity hint hazir degil."}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn-secondary" disabled={!selectedCharacterId || !selectedLookId || bindingCharacter} onClick={() => void handleApplyCharacterBinding()} type="button">
                          <Link2 size={14} />
                          {bindingCharacter ? "Kaydediliyor..." : "Shot'a bagla"}
                        </button>
                        {shot.characterLookId ? (
                          <button className="btn-secondary" disabled={bindingCharacter} onClick={() => void handleClearCharacterBinding()} type="button">
                            <Trash2 size={14} />
                            Baglantiyi temizle
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <section style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Single actions</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="btn-secondary" disabled={activePromptTab === "start" ? activePromptEmpty : !promptDrafts.start.trim() || producing !== null || burstProducing !== null || startReferenceMissing} onClick={() => void queueStartFrame()} type="button"><Clapperboard size={14} />{producing === "start" ? "Queueing..." : "Start"}</button>
                <button className="btn-secondary" disabled={!promptDrafts.end.trim() || producing !== null || burstProducing !== null || endReferenceMissing} onClick={() => void queueEndFrame()} type="button"><Clapperboard size={14} />{producing === "end" ? "Queueing..." : "End"}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 8 }}>
                <select
                  value={variantBurstCount.start}
                  onChange={(event) =>
                    setVariantBurstCount((current) => ({
                      ...current,
                      start: Number.parseInt(event.target.value, 10),
                    }))
                  }
                  style={panelInputStyle}
                >
                  {VARIANT_BURST_OPTIONS.map((count) => (
                    <option key={`start-${count}`} value={count}>
                      x{count}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-secondary"
                  disabled={!promptDrafts.start.trim() || producing !== null || burstProducing !== null || startReferenceMissing}
                  onClick={() => void queueFrameVariants("start")}
                  type="button"
                >
                  <Sparkles size={14} />
                  {burstProducing === "start"
                    ? "START varyantlari kuyrukta..."
                    : `${variantBurstCount.start} START varyanti uret`}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 8 }}>
                <select
                  value={variantBurstCount.end}
                  onChange={(event) =>
                    setVariantBurstCount((current) => ({
                      ...current,
                      end: Number.parseInt(event.target.value, 10),
                    }))
                  }
                  style={panelInputStyle}
                >
                  {VARIANT_BURST_OPTIONS.map((count) => (
                    <option key={`end-${count}`} value={count}>
                      x{count}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-secondary"
                  disabled={!promptDrafts.end.trim() || producing !== null || burstProducing !== null || endReferenceMissing}
                  onClick={() => void queueFrameVariants("end")}
                  type="button"
                >
                  <Sparkles size={14} />
                  {burstProducing === "end"
                    ? "END varyantlari kuyrukta..."
                    : `${variantBurstCount.end} END varyanti uret`}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 8 }}>
                <select
                  value={variantBurstCount.video}
                  onChange={(event) =>
                    setVariantBurstCount((current) => ({
                      ...current,
                      video: Number.parseInt(event.target.value, 10),
                    }))
                  }
                  style={panelInputStyle}
                >
                  {VARIANT_BURST_OPTIONS.map((count) => (
                    <option key={`video-${count}`} value={count}>
                      x{count}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-secondary"
                  disabled={
                    !promptDrafts.video.trim() ||
                    producing !== null ||
                    burstProducing !== null ||
                    clearingMediaView !== null
                  }
                  onClick={() => void queueVideoVariants()}
                  type="button"
                >
                  <Sparkles size={14} />
                  {burstProducing === "video"
                    ? "Video varyantlari kuyrukta..."
                    : `${variantBurstCount.video} video varyanti uret`}
                </button>
              </div>
              <button className="btn-primary" disabled={!promptDrafts.video.trim() || producing !== null || burstProducing !== null || clearingMediaView !== null} onClick={() => void queueVideo()} type="button"><Video size={15} />{producing === "video" ? "Queueing video..." : "Produce video"}</button>
              <button className="btn-secondary" disabled={!shot.videoPath || upscaling || producing !== null || burstProducing !== null || clearingMediaView !== null} onClick={() => void queueUpscale()} type="button"><ArrowUpToLine size={15} />{upscaling ? "Queueing 4K..." : "Produce 4K upscale"}</button>
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border: "1px solid var(--border-subtle)",
                  background: "rgba(0,0,0,0.02)",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Video duration
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    Varsayilan sure shot duration alanindan gelir. Istersen bu modal icin manüel override edebilirsin.
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <select
                    onChange={(event) =>
                      setVideoDuration(Number(event.target.value) as KlingDuration)
                    }
                    style={{ ...panelInputStyle, width: 120 }}
                    value={resolvedVideoDuration}
                  >
                    {KLING_V3_DURATION_VALUES.map((value) => (
                      <option key={value} value={value}>
                        {value}s
                      </option>
                    ))}
                  </select>
                  {isVideoDurationOverridden ? (
                    <button
                      className="btn-secondary"
                      onClick={() => setVideoDuration(defaultVideoDuration)}
                      style={{ padding: "10px 12px" }}
                      type="button"
                    >
                      Shot suresine don
                    </button>
                  ) : null}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                Bu shot icin default sure {shot.durationS ?? "bos"}s. Kling tarafina su an {resolvedVideoDuration}s
                {isVideoDurationOverridden ? " (manuel override)" : " (shot default)"} gonderilecek.
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border: "1px solid var(--border-subtle)",
                  background: "rgba(0,0,0,0.02)",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Native audio
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    Bu toggle aciksa Kling istegi `generate_audio=true` ile gider.
                    {videoPromptAnalysis.hasAudioDirection
                      ? " Prompt icinde audio direction da algilandi."
                      : " Promptta audio direction yoksa bile sesi zorlayabilirsin."}
                  </span>
                </div>
                <input
                  checked={videoGenerateAudio}
                  onChange={(event) => setVideoGenerateAudio(event.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
                  type="checkbox"
                />
              </label>
              {videoPromptAnalysis.detectedMultiShot ? (
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 16,
                    border: "1px solid rgba(0, 0, 0, 0.12)",
                    background: "rgba(0, 0, 0, 0.04)",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      Multi-shot algilandi
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                      Prompt icinde {videoPromptAnalysis.shotCount} alt shot bulundu. Istek `multi_prompt`
                      ile gonderilecek.
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(["customize", "intelligent"] as KlingShotType[]).map((value) => (
                      <button
                        key={value}
                        className={videoShotType === value ? "btn-primary" : "btn-secondary"}
                        onClick={() => setVideoShotType(value)}
                        style={{ flex: 1 }}
                        type="button"
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <section style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.01)" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Asset handoff</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("start", shot.imageStartPath)}>
                  <ImageIcon size={14} />
                  Pick START
                </button>
                <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("end", shot.imageEndPath)}>
                  <ImageIcon size={14} />
                  Pick END
                </button>
                <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("video", shot.video4kPath ?? shot.videoPath)}>
                  <Video size={14} />
                  Pick VIDEO
                </button>
                <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("reference", shot.externalReferencePath)}>
                  <Link2 size={14} />
                  Pick REFERENCE
                </button>
              </div>
            </section>

            <section style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.01)" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Workflow links</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("start", shot.imageStartPath)}>
                  <Link2 size={14} />
                  Asset Library
                </button>
                <button className="btn-secondary" type="button" onClick={() => openImageGenerator(activeMediaView === "end" ? "end" : "start")}>
                  <ImageIcon size={14} />
                  Image Generator
                </button>
                <button className="btn-secondary" type="button" onClick={openVideoGenerator}>
                  <Video size={14} />
                  Video Generator
                </button>
                <button className="btn-secondary" type="button" onClick={openPromptLibrary}>
                  <Sparkles size={14} />
                  Prompt Library
                </button>
                <button className="btn-secondary" type="button" onClick={openModelManager}>
                  <RefreshCw size={14} />
                  Model Presets
                </button>
              </div>
            </section>

            <section
              style={{
                borderRadius: 22,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-elevated)",
                display: "grid",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}><Sparkles size={13} />Autonomous candidates</div>
                {loadingGroups ? <LoaderCircle className="spin-slow" size={14} /> : null}
              </div>
              <div style={{ padding: 14, display: "grid", gap: 12 }}>
                {(["start", "end", "video"] as AutonomousStage[]).map((stage) => (
                  <div key={stage} style={{ display: "grid", gap: 10, padding: "12px 12px 14px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(0,0,0,0.01)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ display: "grid", gap: 2 }}>
                        <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{stage}</span>
                        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{groups[stage].length > 0 ? `${groups[stage].length} aday` : "Aday yok"}</span>
                      </div>
                      <button className="btn-secondary" onClick={() => void handleRegenerate(stage)} disabled={stageAction !== null} type="button" style={{ padding: "7px 10px", fontSize: 11 }}><RefreshCw size={13} />{stageAction === stage ? "Queueing..." : groups[stage].length > 0 ? "Regenerate 4" : "Generate 4"}</button>
                    </div>

                    {groups[stage].length === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{loadingGroups ? "Yukleniyor..." : "Bu stage icin henuz aday yok."}</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))", gap: 10 }}>
                        {groups[stage].map((asset) => {
                          const assetUrl = convertFileSrc(toAbsoluteProjectPath(projectFolderPath, asset.file_path));
                          const isVideo = asset.type === "video";
                          return (
                            <div key={asset.id} style={{ display: "grid", gap: 8, padding: 8, borderRadius: 16, border: `1px solid ${asset.isSelected ? "rgba(0,0,0,0.14)" : "rgba(0,0,0,0.06)"}`, background: asset.isSelected ? "rgba(0,0,0,0.04)" : "rgba(0,0,0,0.02)" }}>
                              <button
                                type="button"
                                onClick={() =>
                                  setLightboxItem({
                                    kind: isVideo ? "video" : "image",
                                    src: assetUrl,
                                    title: `${shot.shotNumber} / ${stage.toUpperCase()} / ${asset.filename}`,
                                    subtitle: `Variant ${String(asset.variant ?? 0).padStart(2, "0")}`,
                                    description:
                                      asset.prompt ?? `${stage.toUpperCase()} stage adayi.`,
                                    downloadPath: toAbsoluteProjectPath(projectFolderPath, asset.file_path),
                                    downloadName: asset.filename,
                                  })
                                }
                                style={{ padding: 0, border: "none", borderRadius: 12, overflow: "hidden", background: "var(--bg-overlay)", cursor: "pointer", aspectRatio: "16 / 10" }}
                              >
                                {isVideo ? <video src={assetUrl} muted playsInline preload="none" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <img src={assetUrl} alt={asset.filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                              </button>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>V{String(asset.variant ?? 0).padStart(2, "0")}</span>
                                {asset.isSelected ? <span style={{ fontSize: 9, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Selected</span> : null}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                                <button className="btn-secondary" onClick={() => setActiveMediaView(stage)} type="button" style={{ padding: "6px 8px", fontSize: 11 }}>{isVideo ? <PlayCircle size={13} /> : <ImageIcon size={13} />}Panele al</button>
                                <button className="btn-primary" disabled={selectingAssetId === asset.id} onClick={() => void handleSelect(asset.id, stage)} type="button" style={{ padding: "6px 10px", fontSize: 11 }}>{selectingAssetId === asset.id ? "..." : asset.isSelected ? "Picked" : "Pick"}</button>
                              </div>
                              <button
                                className="btn-secondary"
                                onClick={() =>
                                  void handleDownloadMedia(
                                    asset.file_path,
                                    asset.filename,
                                    `${shot.shotNumber} ${stage.toUpperCase()}`,
                                  )
                                }
                                style={{ padding: "6px 8px", fontSize: 11 }}
                                type="button"
                              >
                                <Download size={13} />
                                Indir
                              </button>
                              {!isVideo ? (
                                <button
                                  className="btn-secondary"
                                  onClick={() =>
                                    openImageGeneratorWithReference(
                                      toAbsoluteProjectPath(projectFolderPath, asset.file_path),
                                    )
                                  }
                                  style={{ padding: "6px 8px", fontSize: 11 }}
                                  type="button"
                                >
                                  <ImageIcon size={13} />
                                  Still Lab'e referans yap
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section
              style={{
                borderRadius: 22,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-elevated)",
                display: "grid",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}><Sparkles size={13} />Prompt viewport</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["start", "end", "video"] as DetailView[]).map((tab) => (
                    <button key={tab} type="button" onClick={() => setActivePromptTab(tab)} style={{ padding: "7px 10px", borderRadius: 999, border: `1px solid ${activePromptTab === tab ? "rgba(0,0,0,0.12)" : "var(--border-subtle)"}`, background: activePromptTab === tab ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.02)", color: activePromptTab === tab ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{tab}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border-default)", background: "var(--bg-surface)", color: "var(--text-primary)", fontSize: 12 }}
                >
                  <option value="">Prompt template sec</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary" type="button" onClick={openPromptLibrary} style={{ padding: "8px 12px", fontSize: 11 }}>
                  Library
                </button>
                <button className="btn-primary" type="button" disabled={!selectedTemplateId || applyingTemplate} onClick={() => void handleApplyTemplate()} style={{ padding: "8px 12px", fontSize: 11 }}>
                  {applyingTemplate ? "Applying..." : `Use ${activePromptTab.toUpperCase()}`}
                </button>
              </div>
              <div style={{ padding: "16px 16px 18px", display: "grid", gap: 12 }}>
                <textarea
                  value={promptContent}
                  onChange={(event) =>
                    setPromptDrafts((current) => ({
                      ...current,
                      [activePromptTab]: event.target.value,
                    }))
                  }
                  placeholder={`${activePromptTab.toUpperCase()} promptunu burada duzenle veya template uygula.`}
                  style={{
                    width: "100%",
                    minHeight: 220,
                    resize: "vertical",
                    padding: "14px 16px",
                    borderRadius: 16,
                    border: "1px solid var(--border-default)",
                    background: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    lineHeight: 1.75,
                    fontFamily: '"IBM Plex Sans", "Inter", system-ui, sans-serif',
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: activePromptChanged ? "var(--accent)" : "var(--text-muted)" }}>
                    {activePromptChanged ? "Kaydedilmemis degisiklik var." : "Prompt shot kaydiyla senkron."}
                  </span>
                  {activePromptTab === "video" && videoPromptAnalysis.detectedMultiShot ? (
                    <span style={{ fontSize: 11, color: "var(--accent)" }}>
                      {videoPromptAnalysis.shotCount} bolumlu multi-shot prompt
                    </span>
                  ) : null}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() =>
                        setPromptDrafts({
                          start: shot.promptStart ?? "",
                          end: shot.promptEnd ?? "",
                          video: shot.promptVideo ?? "",
                        })
                      }
                      disabled={!activePromptChanged}
                    >
                      <RefreshCw size={14} />
                      Revert
                    </button>
                    <button
                      className="btn-primary"
                      type="button"
                      disabled={savingPrompt || !activePromptChanged}
                      onClick={() => void handleSavePrompt()}
                    >
                      {savingPrompt ? "Saving..." : `Save ${activePromptTab.toUpperCase()}`}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </section>
        </div>
      </div>
      </div>
      {imageEditDraft ? (
        <div
          onClick={closeImageEditModal}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 210,
            display: "grid",
            placeItems: "center",
            padding: 24,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(1120px, calc(100vw - 48px))",
              maxHeight: "min(860px, calc(100vh - 48px))",
              borderRadius: 28,
              border: "1px solid var(--border-default)",
              background: "#ffffff",
              boxShadow: "0 24px 64px rgba(0,0,0,0.12)",
              overflow: "hidden",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.28fr) 360px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateRows: "auto auto minmax(0, 1fr) auto",
                borderRight: "1px solid var(--border-subtle)",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "18px 20px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--accent)",
                    }}
                  >
                    Nano Banana 2 Edit
                  </div>
                  <strong style={{ fontSize: 18, letterSpacing: "-0.03em" }}>
                    Isaretleyerek duzenle
                  </strong>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Referans: {imageEditDraft.variantLabel}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={closeImageEditModal}
                  className="icon-button"
                  style={{ width: 38, height: 38, borderRadius: 999 }}
                  aria-label="Duzenleme modalini kapat"
                >
                  <X size={15} />
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto auto 1fr auto auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: "rgba(0,0,0,0.01)",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Markup
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {IMAGE_EDIT_COLORS.map((color) => {
                    const active = color === imageEditBrushColor;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setImageEditBrushColor(color)}
                        aria-label={`Renk sec ${color}`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          border: active
                            ? "2px solid rgba(0,0,0,0.7)"
                            : "1px solid rgba(0,0,0,0.18)",
                          boxShadow: active ? "0 0 0 2px rgba(0,0,0,0.24)" : "none",
                          background: color,
                          cursor: "pointer",
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    Firca boyutu: {imageEditBrushSize}px
                  </div>
                  <input
                    type="range"
                    min={8}
                    max={38}
                    step={1}
                    value={imageEditBrushSize}
                    onChange={(event) => setImageEditBrushSize(Number(event.target.value))}
                  />
                </div>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={undoImageEditStroke}
                  disabled={imageEditStrokes.length === 0 || submittingImageEdit}
                  style={{ padding: "8px 12px", fontSize: 11 }}
                >
                  <RefreshCw size={13} />
                  Geri al
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={clearImageEditStrokes}
                  disabled={imageEditStrokes.length === 0 || submittingImageEdit}
                  style={{ padding: "8px 12px", fontSize: 11 }}
                >
                  <Trash2 size={13} />
                  Isaretleri temizle
                </button>
              </div>

              <div style={{ minHeight: 0, padding: 20, display: "grid" }}>
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    minHeight: 380,
                    borderRadius: 24,
                    overflow: "hidden",
                    border: "1px solid rgba(0,0,0,0.08)",
                    background: "#eeeeee",
                    cursor: "default",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      padding: 18,
                    }}
                  >
                    <div
                      ref={imageEditStageRef}
                      onPointerDown={handleImageEditPointerDown}
                      onPointerMove={handleImageEditPointerMove}
                      onPointerUp={handleImageEditPointerUp}
                      onPointerCancel={handleImageEditPointerUp}
                      style={{
                        position: "relative",
                        maxWidth: "100%",
                        maxHeight: "100%",
                        width: "fit-content",
                        height: "fit-content",
                        display: "grid",
                        placeItems: "center",
                        overflow: "hidden",
                        borderRadius: 18,
                        cursor: submittingImageEdit ? "progress" : "crosshair",
                        touchAction: "none",
                      }}
                    >
                      <img
                        src={imageEditDraft.previewUrl}
                        alt={imageEditDraft.variantLabel}
                        onLoad={handleImageEditPreviewLoad}
                        style={{
                          display: "block",
                          width: "auto",
                          height: "auto",
                          maxWidth: "100%",
                          maxHeight: "100%",
                          userSelect: "none",
                          pointerEvents: "none",
                        }}
                      />
                      <svg
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          overflow: "visible",
                          pointerEvents: "none",
                        }}
                      >
                        {imageEditStrokes.map((stroke) =>
                          stroke.points.length === 1 ? (
                            <circle
                              key={stroke.id}
                              cx={stroke.points[0].x}
                              cy={stroke.points[0].y}
                              r={stroke.size * 0.5}
                              fill={stroke.color}
                            />
                          ) : (
                            <polyline
                              key={stroke.id}
                              points={strokePointsToSvgPoints(stroke.points)}
                              fill="none"
                              stroke={stroke.color}
                              strokeWidth={stroke.size}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          ),
                        )}
                      </svg>
                    </div>
                  </div>

                  <div
                    style={{
                      position: "absolute",
                      left: 16,
                      top: 16,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.88)",
                      border: "1px solid rgba(0,0,0,0.1)",
                      color: "#1a1c1c",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {imageEditStrokes.length} markup
                  </div>

                  <div
                    style={{
                      position: "absolute",
                      right: 16,
                      bottom: 16,
                      padding: "10px 12px",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.92)",
                      border: "1px solid rgba(0,0,0,0.1)",
                      color: "#6b7280",
                      fontSize: 11,
                      lineHeight: 1.55,
                      maxWidth: 280,
                    }}
                  >
                    Foto ustune serbestce ciz. Isaretler ikinci referans olarak gonderilir; model
                    sadece bu bolgelerde lokal degisiklik yapmaya zorlanir.
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 20px 18px",
                  borderTop: "1px solid var(--border-subtle)",
                  background: "rgba(0,0,0,0.01)",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  Yeni sonuc varyant olarak eklenir; aktif secime donusturmek istersen sonra slider'dan alirsin.
                </span>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-muted)" }}>
                  <span>Mod</span>
                  <strong style={{ color: "var(--accent)" }}>Preserve edit</strong>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr) auto",
                minWidth: 0,
                background: "rgba(0,0,0,0.015)",
              }}
            >
              <div
                style={{
                  padding: "18px 20px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "grid",
                  gap: 6,
                }}
              >
                <strong style={{ fontSize: 16, letterSpacing: "-0.02em" }}>Degisiklik talimati</strong>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  Prompt alanı bilerek bos gelir. Sadece kucuk degisiklik notunu yazabilir veya
                  hic yazmadan yalnizca markup ile devam edebilirsin.
                </span>
              </div>

              <div style={{ padding: 20, display: "grid", gap: 16, minHeight: 0, alignContent: "start" }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Edit prompt
                  </div>
                  <textarea
                    value={imageEditPrompt}
                    onChange={(event) => setImageEditPrompt(event.target.value)}
                    placeholder="Ornek: Sag eldeki bayragi buyut. Sol arka plandaki tabelayi kaldir. Yuzu koru."
                    style={{
                      width: "100%",
                      minHeight: 220,
                      resize: "vertical",
                      padding: "14px 16px",
                      borderRadius: 16,
                      border: "1px solid var(--border-default)",
                      background: "var(--bg-surface)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      lineHeight: 1.75,
                      fontFamily: '"IBM Plex Sans", "Inter", system-ui, sans-serif',
                      outline: "none",
                    }}
                  />
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    Bos birakirsan sistem arka planda otomatik olarak "yalnizca isaretli bolgeleri degistir, diger her seyi koru"
                    talimati kurar.
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Aspect ratio
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {IMAGE_ASPECT_RATIOS.map((ratio) => {
                      const active = ratio === imageEditAspectRatio;
                      return (
                        <button
                          key={ratio}
                          type="button"
                          className={active ? "btn-primary" : "btn-secondary"}
                          onClick={() => setImageEditAspectRatio(ratio)}
                          style={{ minWidth: 62, padding: "8px 12px", fontSize: 11 }}
                        >
                          {ratio}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    padding: "14px 14px 16px",
                    borderRadius: 18,
                    border: "1px solid var(--border-subtle)",
                    background: "rgba(0,0,0,0.02)",
                  }}
                >
                  <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Edit behavior
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                    Kaynak kare ana referans olarak kalir. Markup varsa ayni kareye cizilmis ikinci
                    bir guide da gonderilir. Bu sayede model kompozisyonu yeniden kurmak yerine
                    lokal degisiklige odaklanir.
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "16px 20px 20px",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {imageEditStrokes.length > 0
                    ? `${imageEditStrokes.length} isaret cizildi.`
                    : "Henuz isaret yok."}
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={closeImageEditModal}
                    disabled={submittingImageEdit}
                  >
                    Vazgec
                  </button>
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() => void submitImageEdit()}
                    disabled={!canSubmitImageEdit || submittingImageEdit}
                  >
                    {submittingImageEdit ? <LoaderCircle className="spin-slow" size={14} /> : <Pencil size={14} />}
                    {submittingImageEdit ? "Queueing..." : "Duzenleme uret"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} zIndex={220} />
    </>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid var(--border-subtle)",
        background: "rgba(0,0,0,0.02)",
      }}
    >
      <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}

const panelInputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: 12,
  outline: "none",
} satisfies React.CSSProperties;
