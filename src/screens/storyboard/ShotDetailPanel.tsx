import {
  useEffect,
  useMemo,
  useState,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
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
  ImageEditModal,
  type ImageEditModalDraft,
  type ImageEditSubmitPayload,
} from "@/components/media/ImageEditModal";
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
type RightPanelTab = "genel" | "uretim" | "prompt" | "ses";
type CandidateGroups = Record<AutonomousStage, AutonomousCandidateAsset[]>;
type VariantBurstView = DetailView;

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


const EMPTY_GROUPS: CandidateGroups = { start: [], end: [], video: [] };

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
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("genel");
  const [prodTargets, setProdTargets] = useState<Record<DetailView, boolean>>({ start: true, end: true, video: false });
  const [prodMode, setProdMode] = useState<"single" | "multi">("single");
  const [prodVariantCount, setProdVariantCount] = useState(3);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [activePromptTab, setActivePromptTab] = useState<DetailView>(initialView);
  const [producing, setProducing] = useState<DetailView | null>(null);
  const [burstProducing, setBurstProducing] = useState<VariantBurstView | null>(null);
  const [groups, setGroups] = useState<CandidateGroups>(EMPTY_GROUPS);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [shotAssets, setShotAssets] = useState<AssetWithTags[]>([]);
  const [, setLoadingShotAssets] = useState(true);
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
  const [imageEditDraft, setImageEditDraft] = useState<ImageEditModalDraft | null>(null);
  const [submittingImageEdit, setSubmittingImageEdit] = useState(false);
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

      onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
  const imageModel = resolveImageModel(shot.model);
  const resolvedVideoDuration = videoDuration;
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
    if (variant.stage === "video" || variant.kind !== "image" || !variant.path || !variant.url) return;
    setImageEditDraft({
      id: variant.id,
      label: variant.filename,
      absolutePath: toAbsoluteProjectPath(projectFolderPath, variant.path),
      previewUrl: variant.url,
      width: variant.width,
      height: variant.height,
    });
  }

  function closeImageEditModal() {
    if (!submittingImageEdit) setImageEditDraft(null);
  }

  async function handleImageEditSubmit(payload: ImageEditSubmitPayload) {
    if (!imageEditDraft) return;
    setSubmittingImageEdit(true);
    try {
      const stage = activeMediaView === "end" ? "end" as const : "start" as const;
      const batchKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const existingStagePath = stage === "start" ? effectiveStartPath : effectiveEndPath;
      await enqueueStoryboardFrameJob({
        shotId: shot.id,
        prompt: payload.prompt,
        mode: stage,
        model: "fal-ai/nano-banana-2",
        aspectRatio: payload.aspectRatio,
        cfg: shot.cfg ?? 7,
        steps: 28,
        priority: 148,
        outputSuffix: `edit_${stage}_${batchKey}`,
        assetTags: [`stage:${stage}`, "edited"],
        persistToShotPath: false,
        completeStatus: existingStagePath ? "done" : "review",
        referenceImagePaths: payload.referenceImagePaths,
      });
      setActiveMediaView(stage);
      setVariantIndexByView((current) => ({ ...current, [stage]: 0 }));
      setImageEditDraft(null);
      await refreshAll();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Gorsel duzenleme kuyruga eklenemedi.", { title: shot.shotNumber, kind: "error" });
    } finally {
      setSubmittingImageEdit(false);
    }
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

  async function handleUnifiedProduce() {
    const targets = prodTargets;
    const isMulti = prodMode === "multi";
    if (isMulti) {
      if (targets.start && promptDrafts.start.trim() && !startReferenceMissing) {
        setVariantBurstCount((c) => ({ ...c, start: prodVariantCount }));
        await queueFrameVariants("start");
      }
      if (targets.end && promptDrafts.end.trim() && !endReferenceMissing) {
        setVariantBurstCount((c) => ({ ...c, end: prodVariantCount }));
        await queueFrameVariants("end");
      }
      if (targets.video && promptDrafts.video.trim()) {
        setVariantBurstCount((c) => ({ ...c, video: prodVariantCount }));
        await queueVideoVariants();
      }
    } else {
      if (targets.start && promptDrafts.start.trim() && !startReferenceMissing) await queueStartFrame();
      if (targets.end && promptDrafts.end.trim() && !endReferenceMissing) await queueEndFrame();
      if (targets.video && promptDrafts.video.trim()) await queueVideo();
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

  function openImageGeneratorWithReference(referencePath: string) {
    navigate("/image-generator", {
      state: {
        referenceAssetPath: referencePath,
      },
    });
    onClose();
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 160, display: "grid", placeItems: "center", padding: 28, background: "var(--backdrop-bg)", backdropFilter: "blur(12px)" }}>
        <div onClick={(event) => event.stopPropagation()} style={{ width: "min(1360px, calc(100vw - 56px))", height: "min(920px, calc(100vh - 56px))", minHeight: 660, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", borderRadius: 28, overflow: "hidden", border: "1px solid var(--glass-border)", background: "var(--bg-base)", boxShadow: "var(--shadow-modal)" }}>

        {/* ── HEADER ─────────────────────────────────────────── */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "14px 22px", borderBottom: "1px solid var(--surface-active)", background: "var(--surface-tint)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: "var(--surface-hover)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}><Clapperboard size={12} />Shot Inspector</div>
            <strong style={{ fontSize: 22, letterSpacing: "-0.04em", color: "var(--text-primary)" }}>{shot.shotNumber}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ padding: "3px 8px", borderRadius: 6, background: "var(--surface-hover)", fontWeight: 600, fontSize: 10, letterSpacing: "0.06em" }}>{shot.shotType.toUpperCase()}</span>
              <span>{shot.durationS ?? "--"}s</span>
              <span style={{ color: "var(--border-strong)" }}>·</span>
              <span>A{shot.act ?? "-"} S{shot.scene ?? "-"}</span>
            </div>
            {shot.isArchived ? (
              <span style={{ padding: "3px 8px", borderRadius: 6, background: "rgba(239,68,68,0.08)", color: "var(--status-error)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Arsivde</span>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn-secondary" type="button" onClick={() => void handleArchiveToggle()} style={{ padding: "7px 12px", fontSize: 11, borderRadius: 8 }}>
              {shot.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              {shot.isArchived ? "Geri al" : "Arsivle"}
            </button>
            <button type="button" onClick={onClose} className="icon-button" style={{ width: 36, height: 36, borderRadius: 10 }} aria-label="Kapat"><X size={15} /></button>
          </div>
        </header>

        {/* ── BODY: SOL + SAG ────────────────────────────────── */}
        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(370px, 0.85fr)" }}>

          {/* ════════ SOL PANEL: MEDYA ════════ */}
          <section style={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(320px, 1fr) auto", borderRight: "1px solid var(--surface-active)", overflow: "hidden" }}>

            {/* ── Medya Tab Bar ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--surface-tint)" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {([
                  { key: "start" as MediaView, label: "START", status: mediaByView.start.status },
                  { key: "end" as MediaView, label: "END", status: mediaByView.end.status },
                  { key: "video" as MediaView, label: "VIDEO", status: mediaByView.video.status },
                  { key: "audio" as MediaView, label: "SES", status: shot.audioStatus },
                ]).map((view) => (
                  <button
                    key={view.key}
                    type="button"
                    onClick={() => setActiveMediaView(view.key)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "7px 12px", borderRadius: 8,
                      border: "none",
                      background: activeMediaView === view.key ? "var(--glass-border)" : "transparent",
                      color: activeMediaView === view.key ? "var(--text-primary)" : "var(--text-muted)",
                      cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em",
                      transition: "all 120ms ease",
                    }}
                  >
                    {view.label}
                    <span style={{
                      width: 7, height: 7, borderRadius: 999,
                      background: statusColor(view.status),
                      opacity: view.status === "none" || view.status === "pending" ? 0.35 : 1,
                    }} />
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activePreviewPath ? activePreviewFilename : `${activeMedia.label} bekleniyor`}
              </span>
            </div>

            {/* ── Preview Alani ── */}
            <div style={{ position: "relative", minHeight: 320, background: "var(--surface-tint)", overflow: "hidden", display: "grid" }}>
              {!activePreviewUrl ? (
                <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text-muted)", gap: 10 }}>
                  {activePreviewKind === "video" ? <PlayCircle size={36} strokeWidth={1.5} /> : activePreviewKind === "audio" ? <AudioLines size={36} strokeWidth={1.5} /> : <ImageIcon size={36} strokeWidth={1.5} />}
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{activeMedia.label} henuz hazir degil</div>
                </div>
              ) : activePreviewKind === "audio" ? (
                <div style={{ height: "100%", display: "grid", alignContent: "center", justifyItems: "center", gap: 14, padding: 28, textAlign: "center" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    <AudioLines size={14} />Shot diyalog sesi
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 480 }}>
                    {dialogueAudioDetail?.audioDirection?.dialoguePreview ?? shot.audioDialoguePreview ?? "Bu shot icin dialogue transcript bulunmuyor."}
                  </div>
                  <audio controls src={activePreviewUrl} style={{ width: "min(520px, 100%)" }} />
                </div>
              ) : activePreviewKind === "video" ? (
                <video key={activePreviewUrl} src={activePreviewUrl} controls playsInline poster={videoPosterUrl} style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--surface-tint)" }} />
              ) : (
                <img src={activePreviewUrl} alt={`${shot.shotNumber} ${activeMedia.label}`} style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--surface-tint)" }} />
              )}

              {/* Overlay kontrolleri */}
              {activePreviewUrl ? (
                <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
                  {activePreviewPath ? (
                    <button className="btn-secondary" onClick={() => void handleDownloadMedia(activePreviewPath, activePreviewFilename, shot.shotNumber)} style={{ padding: "6px 10px", borderRadius: 8, background: "var(--glass-bg)", borderColor: "var(--glass-border)", color: "var(--text-primary)", backdropFilter: "blur(10px)", fontSize: 11 }} type="button">
                      <Download size={12} />Indir
                    </button>
                  ) : null}
                  <button className="btn-secondary" onClick={openActiveMediaPreview} disabled={activePreviewKind === "audio"} style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,0.72)", borderColor: "rgba(255,255,255,0.15)", color: "var(--on-accent)", backdropFilter: "blur(10px)", fontSize: 11 }} type="button">
                    <Expand size={12} />Buyut
                  </button>
                </div>
              ) : null}

              {/* Varyant ok'lari */}
              {activeVariants.length > 1 ? (
                <>
                  <button type="button" onClick={() => stepActiveVariant(-1)} className="icon-button" aria-label="Onceki" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", backdropFilter: "blur(10px)" }}>
                    <ChevronLeft size={15} />
                  </button>
                  <button type="button" onClick={() => stepActiveVariant(1)} className="icon-button" aria-label="Sonraki" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", backdropFilter: "blur(10px)" }}>
                    <ChevronRight size={15} />
                  </button>
                  <div style={{ position: "absolute", left: 12, bottom: 12, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em" }}>
                    {activeVariantIndex + 1} / {activeVariants.length} varyant
                  </div>
                </>
              ) : null}
            </div>

            {/* ── Varyant Seridi + Aksiyonlar ── */}
            <div style={{ minHeight: 0, maxHeight: 280, overflowY: "auto", overscrollBehavior: "contain", padding: "12px 20px 16px", display: "grid", gap: 10, alignContent: "start", borderTop: "1px solid var(--surface-hover)" }}>
              {/* Aksiyon bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                  {isAudioMediaView ? "Ses islemleri" : `${activeMediaView.toUpperCase()} varyantlari`}
                </span>
                {isAudioMediaView ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {shot.audioMasterPath ? (
                      <button type="button" className="btn-secondary" onClick={() => void handleDownloadMedia(shot.audioMasterPath, activePreviewFilename, `${shot.shotNumber} SES`)} style={{ padding: "5px 10px", fontSize: 10, borderRadius: 7 }}>
                        <Download size={11} />Indir
                      </button>
                    ) : null}
                    <button type="button" className="btn-primary" onClick={() => void handleQueueDialogueAudio()} disabled={queueingDialogueAudio || loadingDialogueAudioDetail} style={{ padding: "5px 10px", fontSize: 10, borderRadius: 7 }}>
                      <PlayCircle size={11} />
                      {queueingDialogueAudio ? "Kuyrukta..." : shot.audioMasterPath ? "Yeniden uret" : "Seslendir"}
                    </button>
                  </div>
                ) : activeVariant ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {activeVariant.isSelected ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: "rgba(34,197,94,0.1)", color: "var(--status-success)", fontSize: 10, fontWeight: 700 }}>
                        <Check size={10} />Aktif
                      </span>
                    ) : (
                      <button type="button" className="btn-primary" onClick={() => void handleUseVariant(activeVariant)} disabled={assigningVariantId === activeVariant.id} style={{ padding: "4px 10px", fontSize: 10, borderRadius: 7 }}>
                        {assigningVariantId === activeVariant.id ? "..." : "Kullan"}
                      </button>
                    )}
                    {activeVariant.path ? (
                      <button type="button" className="btn-secondary" onClick={() => void handleDownloadMedia(activeVariant.path, activeVariant.filename, `${shot.shotNumber} ${activeMediaView.toUpperCase()}`)} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 7 }}>
                        <Download size={10} />
                      </button>
                    ) : null}
                    {canEditActiveVariant ? (
                      <button type="button" className="btn-secondary" onClick={() => openImageEditModal(activeVariant)} disabled={submittingImageEdit} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 7 }}>
                        <Pencil size={10} />
                      </button>
                    ) : null}
                    {activeVariant.isSelected ? (
                      <button type="button" className="btn-secondary" onClick={() => void handleDisableActiveMedia(activeMediaView)} disabled={clearingMediaView === activeMediaView} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 7 }}>
                        <X size={10} />
                      </button>
                    ) : null}
                    {canDeleteActiveVariant ? (
                      <button type="button" className="btn-secondary" onClick={() => void handleDeleteVariant(activeVariant)} disabled={deletingVariantId === activeVariant.id} style={{ padding: "4px 8px", fontSize: 10, borderRadius: 7, borderColor: "rgba(239,68,68,0.2)", color: "var(--status-error)" }}>
                        <Trash2 size={10} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Varyant thumbnailleri */}
              {!isAudioMediaView && activeVariants.length > 0 ? (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                  {activeVariants.map((variant, index) => (
                    <button key={variant.id} type="button" onClick={() => selectVariant(activeMediaView, index)} style={{ flex: "0 0 88px", display: "grid", gap: 4, padding: 5, borderRadius: 10, border: activeVariantIndex === index ? "2px solid var(--border-default)" : variant.isSelected ? "2px solid rgba(34,197,94,0.3)" : "1px solid var(--surface-active)", background: activeVariantIndex === index ? "var(--surface-hover)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ borderRadius: 7, overflow: "hidden", aspectRatio: "16 / 10", background: "var(--canvas-bg)" }}>
                        {variant.url ? (
                          variant.kind === "video" ? (
                            <video src={variant.url} muted playsInline preload="metadata" poster={videoPosterUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          ) : (
                            <img src={variant.url} alt={variant.filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          )
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
                            {variant.kind === "video" ? <PlayCircle size={14} /> : <ImageIcon size={14} />}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 600, color: variant.isSelected ? "var(--status-success)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {variant.isSelected ? "Aktif" : `V${index + 1}`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Varyant detay */}
              {!isAudioMediaView && activeVariant ? (
                <div style={{ display: "flex", alignItems: "start", gap: 8 }}>
                  <div style={{ flex: 1, maxHeight: 64, overflowY: "auto", fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>
                    {activeVariant.modelUsed ? `${activeVariant.modelUsed} · ` : ""}{activeVariant.resolution ? `${activeVariant.resolution} · ` : ""}{activeVariant.prompt ?? getShotPromptForView(shot, activeMediaView) ?? "Prompt kaydi yok."}
                  </div>
                  {activeVariant.kind === "image" && activeVariant.path ? (
                    <button className="btn-secondary" onClick={() => openImageGeneratorWithReference(toAbsoluteProjectPath(projectFolderPath, activeVariant.path!))} style={{ flex: "0 0 auto", padding: "4px 8px", fontSize: 10, borderRadius: 7 }} type="button">
                      <ImageIcon size={10} />Referans yap
                    </button>
                  ) : null}
                </div>
              ) : isAudioMediaView && dialogueAudioDetail?.resolvedLines.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {dialogueAudioDetail.resolvedLines.map((line, index) => (
                    <span key={`${line.speakerKey}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: "var(--surface-hover)", fontSize: 10, color: "var(--text-secondary)" }}>
                      <strong style={{ color: "var(--text-primary)" }}>{line.speaker}</strong>
                      <span style={{ color: "var(--text-muted)" }}>{line.voiceName ?? "ses yok"}</span>
                    </span>
                  ))}
                </div>
              ) : isAudioMediaView && dialogueAudioDetail?.blockerReason ? (
                <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.06)", color: "var(--text-secondary)", fontSize: 10, lineHeight: 1.6 }}>
                  {dialogueAudioDetail.blockerReason}
                </div>
              ) : null}
            </div>
          </section>

          {/* ════════ SAG PANEL: KONTROL TAB'LARI ════════ */}
          <section style={{ minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>

            {/* ── Tab Bar ── */}
            <nav style={{ display: "flex", gap: 0, padding: "0 20px", borderBottom: "1px solid var(--surface-active)", background: "var(--surface-tint)" }}>
              {([
                { key: "genel" as RightPanelTab, label: "Genel", icon: Clapperboard },
                { key: "uretim" as RightPanelTab, label: "\u00DCretim", icon: Sparkles },
                { key: "prompt" as RightPanelTab, label: "Prompt", icon: Pencil },
                { key: "ses" as RightPanelTab, label: "Ses", icon: AudioLines },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setRightPanelTab(tab.key)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "12px 16px 10px", border: "none",
                    borderBottom: rightPanelTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
                    background: "transparent",
                    color: rightPanelTab === tab.key ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 12, fontWeight: rightPanelTab === tab.key ? 600 : 500,
                    cursor: "pointer", transition: "all 120ms ease",
                  }}
                >
                  <tab.icon size={13} />{tab.label}
                </button>
              ))}
            </nav>

            {/* ── Tab Icerik (Scrollable) ── */}
            <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "20px 20px 28px" }}>

              {/* ━━━━ GENEL TAB ━━━━ */}
              {rightPanelTab === "genel" && (
                <div style={{ display: "grid", gap: 20 }}>

                  {/* ── Shot Ozet ── */}
                  <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "var(--gradient-header)", borderBottom: "1px solid var(--surface-hover)" }}>
                      <div style={{ display: "grid", gap: 2 }}>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>Shot ozeti</h3>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{shot.summaryTr ?? "Turkce ozet bulunmuyor."}</p>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[{ l: "IMG", s: shot.imageStatus }, { l: "VID", s: shot.videoStatus }, { l: "SES", s: shot.audioStatus }].map((x) => (
                          <span key={x.l} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: x.s === "done" ? "rgba(34,197,94,0.08)" : x.s === "generating" ? "rgba(245,158,11,0.1)" : "var(--surface-hover)", fontSize: 10, fontWeight: 600, color: x.s === "done" ? "var(--status-success)" : x.s === "generating" ? "var(--status-warning)" : "var(--text-muted)" }}>
                            <span style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor" }} />{x.l}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--surface-hover)" }}>
                      {[{ l: "Gorsel model", v: imageModel }, { l: "Video model", v: "Kling v3 Pro" }, { l: "CFG", v: shot.cfg ? String(shot.cfg) : "--" }, { l: "Preset", v: shot.klingPreset ?? "Varsayilan" }].map((m, i) => (
                        <div key={m.l} style={{ padding: "12px 16px", borderRight: i < 3 ? "1px solid var(--surface-hover)" : "none" }}>
                          <div style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)", marginBottom: 3 }}>{m.l}</div>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, padding: "14px 20px" }}>
                      <button className="btn-primary" onClick={() => void handleBootstrap()} disabled={stageAction !== null} type="button" style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 10 }}>
                        <Sparkles size={14} />{stageAction ? "Hazirlaniyor..." : `Otonom x${AUTONOMOUS_VARIANT_COUNT}`}
                      </button>
                      <button className="btn-secondary" onClick={() => void refreshAll()} type="button" style={{ padding: "8px 14px", fontSize: 12, fontWeight: 500, borderRadius: 10 }}>
                        <RefreshCw size={14} />Yenile
                      </button>
                    </div>
                  </div>

                  {/* ── Uretim Durumu ── */}
                  {shouldShowProductionState ? (
                    <div style={{ borderRadius: 16, border: "1px solid rgba(245,158,11,0.18)", background: "linear-gradient(135deg, rgba(245,158,11,0.04) 0%, rgba(245,158,11,0.02) 100%)", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(245,158,11,0.1)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(245,158,11,0.12)", display: "grid", placeItems: "center" }}><LoaderCircle className="spin-slow" size={14} style={{ color: "var(--status-warning)" }} /></div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Uretim aktif</div>
                            {productionNotice ? <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 1 }}>{productionNotice}</div> : null}
                          </div>
                        </div>
                        {shotQueueJobs.length > 1 ? <button className="btn-secondary" type="button" onClick={handleCancelAllShotJobs} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 500, borderRadius: 8 }}><X size={12} />Tumunu iptal</button> : null}
                      </div>
                      {shotQueueJobs.length > 0 ? (
                        <div style={{ padding: "12px 20px 16px", display: "grid", gap: 8 }}>
                          {shotQueueJobs.slice(0, 4).map((job) => {
                            const pv = job.status === "queued" ? 12 : Math.max(8, Math.min(100, Math.round(job.progress || 0)));
                            return (
                              <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ flex: 1, display: "grid", gap: 4 }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{describeShotQueueJob(job)}</span>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: job.status === "queued" ? "var(--text-muted)" : "var(--status-warning)", fontVariantNumeric: "tabular-nums" }}>{job.status === "queued" ? "Sirada" : `%${pv}`}</span>
                                  </div>
                                  <div style={{ height: 3, borderRadius: 999, background: "var(--surface-active)" }}><div style={{ width: `${pv}%`, height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #f59e0b, #d97706)", transition: "width 400ms cubic-bezier(0.4,0,0.2,1)" }} /></div>
                                </div>
                                <button type="button" onClick={() => handleCancelShotJob(job.id)} className="icon-button" style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0 }}><X size={11} /></button>
                              </div>
                            );
                          })}
                          {shotQueueJobs.length > 4 ? <div style={{ fontSize: 11, color: "var(--text-muted)", paddingTop: 4 }}>+{shotQueueJobs.length - 4} ek is kuyrukta</div> : null}
                        </div>
                      ) : (shot.imageStatus === "generating" || shot.videoStatus === "generating" || shot.audioStatus === "generating") ? (
                        <div style={{ padding: "12px 20px 16px", fontSize: 12, color: "var(--text-secondary)" }}>Uretim aktif, durum guncelleniyor...</div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* ── Zincir Devam ── */}
                  {shot.chainStatus === "continue" ? (
                    <div style={{ display: "flex", alignItems: "start", gap: 12, padding: "14px 18px", borderRadius: 12, background: "var(--surface-hover)", border: "1px solid var(--surface-hover)" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--surface-hover)", display: "grid", placeItems: "center", flexShrink: 0 }}><Link2 size={15} style={{ color: "var(--text-secondary)" }} /></div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>Zincir devam</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>START referansi onceki shot&apos;in END karesinden otomatik alinir.</div>
                      </div>
                    </div>
                  ) : null}

                  {/* ── Harici Referans ── */}
                  {shot.requiresExternalReference ? (
                    <div style={{ borderRadius: 16, border: `1px solid ${missingExternalReference ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)"}`, background: missingExternalReference ? "linear-gradient(135deg, rgba(239,68,68,0.03) 0%, rgba(239,68,68,0.01) 100%)" : "linear-gradient(135deg, rgba(34,197,94,0.04) 0%, rgba(34,197,94,0.01) 100%)", overflow: "hidden" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: missingExternalReference ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)", display: "grid", placeItems: "center", flexShrink: 0 }}><AlertTriangle size={16} style={{ color: missingExternalReference ? "var(--status-error)" : "var(--status-success)" }} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>Harici referans {missingExternalReference ? "gerekli" : "hazir"}</div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>{shot.externalReferenceName ? `Beklenen: ${shot.externalReferenceName}` : "Bu shot harici referans gorseli bekliyor."}</div>
                        </div>
                        {externalReferenceUrl ? (
                          <button onClick={() => setLightboxItem({ kind: "image", src: externalReferenceUrl, title: `${shot.shotNumber} / Harici referans`, subtitle: shot.externalReferenceName ?? "Referans", description: shot.externalReferenceNotes ?? "Yuklu referans gorseli.", downloadPath: shot.externalReferencePath ? toAbsoluteProjectPath(projectFolderPath, shot.externalReferencePath) : null, downloadName: shot.externalReferenceName ?? shot.externalReferencePath?.split(/[\\/]/).pop() ?? null })} style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", flexShrink: 0 }} type="button">
                            <img src={externalReferenceUrl} alt="ref" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", border: "1px solid var(--glass-border)" }} />
                          </button>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 6, padding: "0 20px 16px" }}>
                        <button className="btn-secondary" type="button" disabled={updatingReference} onClick={() => void handleUploadReference()} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8 }}><Upload size={13} />{shot.externalReferencePath ? "Degistir" : "Yukle"}</button>
                        <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("reference", shot.externalReferencePath)} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8 }}><Link2 size={13} />Kutuphane</button>
                        {shot.externalReferencePath ? <button className="btn-secondary" type="button" disabled={updatingReference} onClick={() => void handleClearReference()} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8, borderColor: "rgba(239,68,68,0.18)", color: "var(--status-error)" }}><Trash2 size={13} />Kaldir</button> : null}
                      </div>
                    </div>
                  ) : null}

                  {/* ── Karakter Baglama (Card Pattern) ── */}
                  <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--gradient-header)" }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Karakter</h3>
                    </div>
                    <div style={{ padding: "16px 20px" }}>
                      {loadingCharacters ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "20px 0", justifyContent: "center" }}><LoaderCircle className="spin-slow" size={16} style={{ color: "var(--text-muted)" }} /><span style={{ fontSize: 12, color: "var(--text-muted)" }}>Yukleniyor...</span></div>
                      ) : characters.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "24px 16px" }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--surface-hover)", display: "grid", placeItems: "center", margin: "0 auto 10px" }}><Sparkles size={18} style={{ color: "var(--text-muted)" }} /></div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>Karakter bulunamadi</div>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Karakterler ekranindan profil olusturun.</div>
                        </div>
                      ) : selectedLook && !characterPickerOpen ? (
                        /* Bound character card */
                        <div style={{ display: "grid", gap: 12 }}>
                          <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 16px", borderRadius: 14, background: "var(--surface-hover)", border: "1px solid var(--surface-hover)" }}>
                            {selectedCharacterPreview ? (
                              <button onClick={() => setLightboxItem({ kind: "image", src: selectedCharacterPreview, title: `${selectedCharacter?.name ?? "Karakter"} / ${selectedLook.name}`, subtitle: "Continuity onizleme", description: selectedLook.promptHint ?? selectedCharacter?.promptHint ?? "Hint hazir degil.", downloadPath: selectedLook.primaryImage || selectedLook.refImages[0] ? toAbsoluteProjectPath(projectFolderPath, selectedLook.primaryImage ?? selectedLook.refImages[0]) : null, downloadName: (selectedLook.primaryImage ?? selectedLook.refImages[0])?.split(/[\\/]/).pop() ?? null })} style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", flexShrink: 0 }} type="button">
                                <img alt={selectedLook.name} src={selectedCharacterPreview} style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", border: "1px solid var(--surface-active)" }} />
                              </button>
                            ) : (
                              <div style={{ width: 52, height: 52, borderRadius: 12, background: "var(--surface-active)", display: "grid", placeItems: "center", flexShrink: 0 }}><Sparkles size={18} style={{ color: "var(--text-muted)" }} /></div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{selectedCharacter?.name}</div>
                              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>{selectedLook.name}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                                <span style={{ fontSize: 10, fontWeight: 500, padding: "2px 8px", borderRadius: 5, background: includeCharacterPrompt ? "rgba(34,197,94,0.08)" : "var(--surface-hover)", color: includeCharacterPrompt ? "var(--status-success)" : "var(--text-muted)" }}>
                                  Prompt hint {includeCharacterPrompt ? "aktif" : "kapali"}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                              <button className="btn-secondary" onClick={() => setCharacterPickerOpen(true)} type="button" style={{ padding: "6px 10px", fontSize: 11, fontWeight: 500, borderRadius: 7 }}>Degistir</button>
                              <button className="btn-secondary" disabled={bindingCharacter} onClick={() => void handleClearCharacterBinding()} type="button" style={{ padding: "6px 10px", fontSize: 11, fontWeight: 500, borderRadius: 7, borderColor: "rgba(239,68,68,0.15)", color: "var(--status-error)" }}>Kaldir</button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Character picker */
                        <div style={{ display: "grid", gap: 12 }}>
                          {selectedLook && characterPickerOpen ? (
                            <button type="button" onClick={() => setCharacterPickerOpen(false)} className="btn-secondary" style={{ justifySelf: "end", padding: "5px 10px", fontSize: 11, borderRadius: 7 }}><X size={12} />Kapat</button>
                          ) : null}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div style={{ display: "grid", gap: 4 }}>
                              <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>Karakter</label>
                              <select onChange={(e) => { const nid = e.target.value; setSelectedCharacterId(nid); const nc = characters.find((c) => c.id === nid); setSelectedLookId(nc?.defaultLookId ?? nc?.looks[0]?.id ?? ""); }} style={{ ...panelInputStyle, padding: "9px 12px", borderRadius: 10, fontSize: 12, fontWeight: 500 }} value={selectedCharacterId}>
                                <option value="">Sec...</option>
                                {characters.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                              </select>
                            </div>
                            <div style={{ display: "grid", gap: 4 }}>
                              <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>Gorunum</label>
                              <select disabled={!selectedCharacter} onChange={(e) => setSelectedLookId(e.target.value)} style={{ ...panelInputStyle, padding: "9px 12px", borderRadius: 10, fontSize: 12, fontWeight: 500 }} value={selectedLookId}>
                                <option value="">Sec...</option>
                                {selectedCharacter?.looks.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
                              </select>
                            </div>
                          </div>
                          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "var(--surface-hover)", cursor: "pointer" }}>
                            <input checked={includeCharacterPrompt} onChange={(e) => setIncludeCharacterPrompt(e.target.checked)} type="checkbox" style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Prompt hint ekle</span>
                          </label>
                          <button className="btn-primary" disabled={!selectedCharacterId || !selectedLookId || bindingCharacter} onClick={() => { void handleApplyCharacterBinding(); setCharacterPickerOpen(false); }} type="button" style={{ padding: "9px 16px", fontSize: 12, fontWeight: 600, borderRadius: 10 }}>
                            <Link2 size={13} />{bindingCharacter ? "Kaydediliyor..." : "Bagla"}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ━━━━ URETIM TAB ━━━━ */}
              {rightPanelTab === "uretim" && (
                <div style={{ display: "grid", gap: 20 }}>

                  {/* ── Unified Production Panel ── */}
                  <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--gradient-header)" }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>Uretim merkezi</h3>
                      <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Hedef sec, mod belirle, tek tikla uret</p>
                    </div>

                    {/* Hedef secimi */}
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--surface-hover)" }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginBottom: 10 }}>Ne uretilsin?</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        {(["start", "end", "video"] as DetailView[]).map((target) => {
                          const active = prodTargets[target];
                          const hasPrompt = target === "start" ? Boolean(promptDrafts.start.trim()) : target === "end" ? Boolean(promptDrafts.end.trim()) : Boolean(promptDrafts.video.trim());
                          const blocked = target === "start" ? startReferenceMissing : target === "end" ? endReferenceMissing : false;
                          return (
                            <button
                              key={target}
                              type="button"
                              onClick={() => setProdTargets((c) => ({ ...c, [target]: !c[target] }))}
                              style={{
                                display: "grid", gap: 4, padding: "12px 10px", borderRadius: 12, textAlign: "center", cursor: "pointer",
                                border: active ? "2px solid var(--accent)" : "1.5px solid var(--glass-border)",
                                background: active ? "var(--surface-hover)" : "transparent",
                                transition: "all 120ms ease",
                                opacity: !hasPrompt || blocked ? 0.45 : 1,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                {target === "video" ? <Video size={18} style={{ color: active ? "var(--accent)" : "var(--text-muted)" }} /> : <ImageIcon size={18} style={{ color: active ? "var(--accent)" : "var(--text-muted)" }} />}
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--accent)" : "var(--text-secondary)" }}>{target.toUpperCase()}</span>
                              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                {blocked ? "Ref gerekli" : !hasPrompt ? "Prompt yok" : "Hazir"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Mod secimi */}
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--surface-hover)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ display: "flex", borderRadius: 10, border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                        {([{ key: "single" as const, label: "Tekli" }, { key: "multi" as const, label: "Coklu" }]).map((m) => (
                          <button key={m.key} type="button" onClick={() => setProdMode(m.key)} style={{ padding: "8px 18px", border: "none", fontSize: 12, fontWeight: prodMode === m.key ? 600 : 500, background: prodMode === m.key ? "var(--accent)" : "transparent", color: prodMode === m.key ? "var(--on-accent)" : "var(--text-secondary)", cursor: "pointer", transition: "all 120ms ease" }}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                      {prodMode === "multi" ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Adet:</span>
                          <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                            {[2, 3, 4, 6].map((n) => (
                              <button key={n} type="button" onClick={() => setProdVariantCount(n)} style={{ padding: "6px 12px", border: "none", fontSize: 12, fontWeight: prodVariantCount === n ? 600 : 400, background: prodVariantCount === n ? "var(--accent)" : "transparent", color: prodVariantCount === n ? "var(--on-accent)" : "var(--text-secondary)", cursor: "pointer", transition: "all 100ms ease", minWidth: 36 }}>
                              {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Ana aksiyon */}
                    <div style={{ padding: "16px 20px" }}>
                      <button
                        className="btn-primary"
                        disabled={!prodTargets.start && !prodTargets.end && !prodTargets.video || producing !== null || burstProducing !== null}
                        onClick={() => void handleUnifiedProduce()}
                        type="button"
                        style={{ width: "100%", padding: "11px 20px", fontSize: 14, fontWeight: 600, borderRadius: 12, justifyContent: "center", letterSpacing: "-0.01em" }}
                      >
                        {producing !== null || burstProducing !== null ? (
                          <><LoaderCircle className="spin-slow" size={16} />Kuyruga ekleniyor...</>
                        ) : (
                          <><Sparkles size={16} />
                            {prodMode === "multi"
                              ? `${prodVariantCount} varyant uret`
                              : `${[prodTargets.start && "Start", prodTargets.end && "End", prodTargets.video && "Video"].filter(Boolean).join(" + ") || "Hedef sec"} uret`}
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* ── Video Ayarlari + 4K (collapsible) ── */}
                  <details style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <summary style={{ padding: "14px 20px", cursor: "pointer", background: "var(--gradient-header)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      Video ayarlari
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{resolvedVideoDuration}s · Ses {videoGenerateAudio ? "acik" : "kapali"}</span>
                    </summary>
                    <div style={{ padding: "16px 20px", borderTop: "1px solid var(--surface-hover)", display: "grid", gap: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div><div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Sure</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Shot: {shot.durationS ?? "--"}s</div></div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--glass-border)", overflow: "hidden" }}>
                            {KLING_V3_DURATION_VALUES.map((v) => (
                              <button key={v} type="button" onClick={() => setVideoDuration(v)} style={{ padding: "6px 10px", border: "none", fontSize: 11, fontWeight: resolvedVideoDuration === v ? 600 : 400, background: resolvedVideoDuration === v ? "var(--accent)" : "transparent", color: resolvedVideoDuration === v ? "var(--on-accent)" : "var(--text-secondary)", cursor: "pointer", minWidth: 34 }}>{v}s</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div style={{ height: 1, background: "var(--surface-hover)" }} />
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, cursor: "pointer" }}>
                        <div><div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>Yerel ses</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>generate_audio=true</div></div>
                        <div style={{ position: "relative", width: 40, height: 22, borderRadius: 11, background: videoGenerateAudio ? "var(--accent)" : "var(--border-default)", transition: "background 200ms ease" }}>
                          <div style={{ position: "absolute", top: 2, left: videoGenerateAudio ? 20 : 2, width: 18, height: 18, borderRadius: 9, background: "var(--toggle-knob)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transition: "left 200ms cubic-bezier(0.4,0,0.2,1)" }} />
                          <input checked={videoGenerateAudio} onChange={(e) => setVideoGenerateAudio(e.target.checked)} type="checkbox" style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: "pointer", margin: 0 }} />
                        </div>
                      </label>
                      {videoPromptAnalysis.detectedMultiShot ? (<><div style={{ height: 1, background: "var(--surface-hover)" }} /><div><div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 8 }}>Coklu sahne ({videoPromptAnalysis.shotCount} bolum)</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>{(["customize", "intelligent"] as KlingShotType[]).map((v) => (<button key={v} className={videoShotType === v ? "btn-primary" : "btn-secondary"} onClick={() => setVideoShotType(v)} style={{ padding: "9px 14px", fontSize: 12, fontWeight: 600, borderRadius: 10, justifyContent: "center" }} type="button">{v === "customize" ? "Ozel" : "Akilli"}</button>))}</div></div></>) : null}
                      <div style={{ height: 1, background: "var(--surface-hover)" }} />
                      <button className="btn-secondary" disabled={!shot.videoPath || upscaling || producing !== null} onClick={() => void queueUpscale()} type="button" style={{ padding: "9px 14px", fontSize: 12, fontWeight: 500, borderRadius: 10, justifyContent: "center" }}>
                        <ArrowUpToLine size={14} />{upscaling ? "4K kuyrukta..." : "4K yukseltme uygula"}
                      </button>
                    </div>
                  </details>

                  {/* ── Varlik Slotlari ── */}
                  <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--gradient-header)" }}>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Varlik slotlari</h3>
                    </div>
                    <div style={{ display: "grid", gap: 0 }}>
                      {([
                        { key: "start" as const, label: "START", path: effectiveStartPath, icon: ImageIcon },
                        { key: "end" as const, label: "END", path: effectiveEndPath, icon: ImageIcon },
                        { key: "video" as const, label: "VIDEO", path: effectiveVideoPath, icon: Video },
                        { key: "reference" as const, label: "REFERANS", path: shot.externalReferencePath, icon: Link2 },
                      ]).map((slot, i) => (
                        <div key={slot.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: i < 3 ? "1px solid var(--surface-hover)" : "none" }}>
                          <slot.icon size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", width: 60, flexShrink: 0 }}>{slot.label}</span>
                          <span style={{ flex: 1, fontSize: 11, color: slot.path ? "var(--text-primary)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: slot.path ? "monospace" : "inherit", fontWeight: slot.path ? 500 : 400 }}>
                            {slot.path ? slot.path.split("/").pop() : "Bos"}
                          </span>
                          <button className="btn-secondary" type="button" onClick={() => openAssetLibrary(slot.key, slot.key === "reference" ? shot.externalReferencePath : slot.key === "video" ? (shot.video4kPath ?? shot.videoPath) : slot.key === "start" ? shot.imageStartPath : shot.imageEndPath)} style={{ padding: "5px 10px", fontSize: 10, fontWeight: 500, borderRadius: 7, flexShrink: 0 }}>
                            {slot.path ? "Degistir" : "Sec"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Otonom Adaylar ── */}
                  <details style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }} open>
                    <summary style={{ padding: "14px 20px", cursor: "pointer", background: "var(--gradient-header)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      Otonom adaylar
                      {loadingGroups ? <LoaderCircle className="spin-slow" size={14} style={{ color: "var(--text-muted)" }} /> : <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>{groups.start.length + groups.end.length + groups.video.length} toplam</span>}
                    </summary>
                    <div style={{ padding: "12px 16px", display: "grid", gap: 12, borderTop: "1px solid var(--surface-hover)" }}>
                      {(["start", "end", "video"] as AutonomousStage[]).map((stage) => (
                        <div key={stage} style={{ borderRadius: 12, border: "1px solid var(--surface-hover)", overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface-hover)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: "var(--text-primary)" }}>{stage}</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{groups[stage].length > 0 ? `${groups[stage].length} aday` : "Bos"}</span>
                            </div>
                            <button className="btn-secondary" onClick={() => void handleRegenerate(stage)} disabled={stageAction !== null} type="button" style={{ padding: "6px 12px", fontSize: 11, fontWeight: 500, borderRadius: 8 }}>
                              <RefreshCw size={12} />{stageAction === stage ? "Kuyrukta..." : "Uret x4"}
                            </button>
                          </div>
                          {groups[stage].length === 0 ? (
                            <div style={{ padding: "16px 14px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>{loadingGroups ? "Yukleniyor..." : "Henuz aday yok."}</div>
                          ) : (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8, padding: "10px 12px" }}>
                              {groups[stage].map((asset) => {
                                const au = convertFileSrc(toAbsoluteProjectPath(projectFolderPath, asset.file_path));
                                const iv = asset.type === "video";
                                return (
                                  <div key={asset.id} style={{ borderRadius: 12, border: `1.5px solid ${asset.isSelected ? "var(--accent)" : "var(--surface-active)"}`, overflow: "hidden", background: asset.isSelected ? "var(--surface-hover)" : "var(--surface-card)", transition: "border-color 120ms ease" }}>
                                    <button type="button" onClick={() => setLightboxItem({ kind: iv ? "video" : "image", src: au, title: `${shot.shotNumber} / ${stage.toUpperCase()}`, subtitle: `V${String(asset.variant ?? 0).padStart(2, "0")}`, description: asset.prompt ?? `${stage.toUpperCase()} adayi.`, downloadPath: toAbsoluteProjectPath(projectFolderPath, asset.file_path), downloadName: asset.filename })} style={{ padding: 0, border: "none", width: "100%", background: "var(--canvas-bg)", cursor: "pointer", aspectRatio: "16 / 10", display: "block" }}>
                                      {iv ? <video src={au} muted playsInline preload="none" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <img src={au} alt={asset.filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                                    </button>
                                    <div style={{ padding: "8px 8px 10px", display: "grid", gap: 6 }}>
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)" }}>V{String(asset.variant ?? 0).padStart(2, "0")}</span>
                                        {asset.isSelected ? <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase" }}>Aktif</span> : null}
                                      </div>
                                      <button className={asset.isSelected ? "btn-secondary" : "btn-primary"} disabled={selectingAssetId === asset.id} onClick={() => void handleSelect(asset.id, stage)} type="button" style={{ padding: "6px 8px", fontSize: 10, fontWeight: 600, borderRadius: 7, justifyContent: "center" }}>{selectingAssetId === asset.id ? "..." : asset.isSelected ? "Secili" : "Bu varyanti sec"}</button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* ━━━━ PROMPT TAB ━━━━ */}
              {rightPanelTab === "prompt" && (
                <div style={{ display: "grid", gap: 0, borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px", background: "var(--gradient-header)", borderBottom: "1px solid var(--surface-hover)" }}>
                    <div style={{ display: "flex", gap: 2 }}>
                      {(["start", "end", "video"] as DetailView[]).map((tab) => (
                        <button key={tab} type="button" onClick={() => setActivePromptTab(tab)} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: activePromptTab === tab ? "var(--surface-active)" : "transparent", color: activePromptTab === tab ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: activePromptTab === tab ? 600 : 500, transition: "all 100ms ease" }}>{tab.toUpperCase()}</button>
                      ))}
                    </div>
                    {activePromptTab === "video" && videoPromptAnalysis.detectedMultiShot ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "var(--surface-hover)", fontSize: 11, fontWeight: 600, color: "var(--accent)" }}><Sparkles size={11} />{videoPromptAnalysis.shotCount} bolum</span>
                    ) : null}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--surface-hover)", background: "var(--surface-hover)" }}>
                    <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} style={{ ...panelInputStyle, padding: "8px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500 }}>
                      <option value="">Sablon sec...</option>
                      {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                    </select>
                    <button className="btn-secondary" type="button" onClick={openPromptLibrary} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 500, borderRadius: 8 }}>Kutuphane</button>
                    <button className="btn-primary" type="button" disabled={!selectedTemplateId || applyingTemplate} onClick={() => void handleApplyTemplate()} style={{ padding: "8px 14px", fontSize: 11, fontWeight: 600, borderRadius: 8 }}>{applyingTemplate ? "..." : "Uygula"}</button>
                  </div>
                  <div style={{ padding: "16px 16px 12px" }}>
                    <textarea value={promptContent} onChange={(e) => setPromptDrafts((c) => ({ ...c, [activePromptTab]: e.target.value }))} placeholder={`${activePromptTab.toUpperCase()} promptunu burada duzenle...`} style={{ width: "100%", minHeight: 300, resize: "vertical", padding: "14px 16px", borderRadius: 12, border: "1px solid var(--glass-border)", background: "var(--bg-base)", color: "var(--text-primary)", fontSize: 13, lineHeight: 1.8, fontFamily: '"IBM Plex Mono", "SF Mono", "Menlo", monospace', outline: "none" }} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 14px", borderTop: "1px solid var(--surface-hover)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: activePromptChanged ? "var(--status-warning)" : "var(--status-success)" }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: activePromptChanged ? "var(--status-warning)" : "var(--text-muted)" }}>{activePromptChanged ? "Degisiklik var" : "Senkron"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn-secondary" type="button" onClick={() => setPromptDrafts({ start: shot.promptStart ?? "", end: shot.promptEnd ?? "", video: shot.promptVideo ?? "" })} disabled={!activePromptChanged} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8 }}><RefreshCw size={13} />Geri al</button>
                      <button className="btn-primary" type="button" disabled={savingPrompt || !activePromptChanged} onClick={() => void handleSavePrompt()} style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8 }}>{savingPrompt ? "Kaydediliyor..." : `${activePromptTab.toUpperCase()} kaydet`}</button>
                    </div>
                  </div>
                </div>
              )}

              {/* ━━━━ SES TAB ━━━━ */}
              {rightPanelTab === "ses" && (
                <div style={{ display: "grid", gap: 20 }}>
                  <div style={{ borderRadius: 16, border: "1px solid rgba(59,130,246,0.12)", background: "linear-gradient(135deg, rgba(59,130,246,0.03) 0%, rgba(59,130,246,0.01) 100%)", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "start", gap: 14, padding: "18px 20px" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(59,130,246,0.1)", display: "grid", placeItems: "center", flexShrink: 0 }}><AudioLines size={17} style={{ color: "var(--status-info)" }} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Diyalog seslendirme</span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: activeDialogueShot.audioStatus === "done" ? "rgba(34,197,94,0.1)" : activeDialogueShot.audioStatus === "generating" ? "rgba(245,158,11,0.1)" : "var(--surface-hover)", fontSize: 10, fontWeight: 600, color: statusColor(activeDialogueShot.audioStatus) }}>
                            <span style={{ width: 5, height: 5, borderRadius: 999, background: "currentColor" }} />{activeDialogueShot.audioStatus}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{dialogueAudioDetail?.audioDirection?.dialoguePreview ?? shot.audioDialoguePreview ?? "Diyalog transcript bulunmuyor."}</div>
                      </div>
                    </div>
                    {loadingDialogueAudioDetail ? <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 20px 14px", justifyContent: "center" }}><LoaderCircle className="spin-slow" size={14} style={{ color: "var(--text-muted)" }} /><span style={{ fontSize: 12, color: "var(--text-muted)" }}>Yukleniyor...</span></div> : null}
                    {dialogueAudioDetail?.resolvedLines.length ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 20px 16px" }}>
                        {dialogueAudioDetail.resolvedLines.map((line, idx) => (
                          <span key={`${line.speakerKey}-${idx}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: "var(--surface-card)", border: "1px solid rgba(59,130,246,0.1)", fontSize: 11 }}>
                            <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{line.speaker}</strong>
                            <span style={{ width: 1, height: 12, background: "var(--glass-border)" }} />
                            <span style={{ color: line.voiceName ? "var(--status-info)" : "var(--status-error)", fontSize: 10, fontWeight: 500 }}>{line.voiceName ?? "ses yok"}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {dialogueAudioDetail?.blockerReason ? <div style={{ margin: "0 20px 16px", padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.1)", fontSize: 12, color: "var(--status-error)", lineHeight: 1.5 }}>{dialogueAudioDetail.blockerReason}</div> : null}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 20px 18px" }}>
                      <button className="btn-primary" disabled={queueingDialogueAudio || loadingDialogueAudioDetail} onClick={() => void handleQueueDialogueAudio()} type="button" style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600, borderRadius: 10 }}>
                        <PlayCircle size={15} />{queueingDialogueAudio ? "Kuyrukta..." : activeDialogueTake ? "Yeniden seslendir" : "Seslendir"}
                      </button>
                      {dialogueAudioDetail?.characterCount ? <span style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(59,130,246,0.06)", fontSize: 11, fontWeight: 500, color: "var(--status-info)" }}>{dialogueAudioDetail.characterCount} karakter</span> : null}
                    </div>
                  </div>

                  <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--gradient-header)" }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Seslendirme metni</h3><p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Replikleri duzenle, speaker etiketleri sabit kalir</p></div>
                    <div style={{ padding: "16px 20px" }}>
                      <DialogueTextEditor busy={queueingDialogueAudio || loadingDialogueAudioDetail} description="" hasOverride={Boolean(dialogueAudioDetail?.hasDialogueOverride)} lines={dialogueAudioDetail?.audioDirection?.dialogueLines ?? []} onClear={handleClearDialogueOverride} onSave={handleSaveDialogueOverride} title="" />
                    </div>
                  </div>

                  <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                    <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--gradient-header)" }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Duygu tonu ve optimizer</h3><p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Pacing preset, yonetmen notu, OpenRouter ayari</p></div>
                    <div style={{ padding: "16px 20px" }}>
                      <DialoguePerformanceEditor busy={queueingDialogueAudio || loadingDialogueAudioDetail} description="" hasOverride={Boolean(dialogueAudioDetail?.hasGenerationProfileOverride)} onClear={handleClearDialogueGenerationProfile} onSave={handleSaveDialogueGenerationProfile} profile={dialogueAudioDetail?.generationProfile ?? { useOptimizer: true, performancePreset: "auto", performanceNote: null }} title="" />
                    </div>
                  </div>

                  {dialogueAudioUrl ? (
                    <div style={{ borderRadius: 16, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--surface-hover)", background: "var(--gradient-header)" }}><h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Master ses</h3></div>
                      <div style={{ padding: "16px 20px", display: "grid", gap: 12 }}>
                        <audio controls src={dialogueAudioUrl} style={{ width: "100%", borderRadius: 8 }} />
                        {activeDialogueTake ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {[`Master ${formatAudioTakeLabel(activeDialogueTake)}`, formatAudioTakeCreatedAt(activeDialogueTake.createdAt), activeDialogueTake.outputFormat].filter(Boolean).map((t, i) => (
                              <span key={i} style={{ padding: "5px 10px", borderRadius: 7, background: "var(--surface-hover)", fontSize: 11, fontWeight: 500, color: "var(--text-secondary)" }}>{t}</span>
                            ))}
                          </div>
                        ) : null}
                        {historicalDialogueTakes.length > 0 ? (
                          <details style={{ borderRadius: 12, border: "1px solid var(--surface-active)", overflow: "hidden" }}>
                            <summary style={{ cursor: "pointer", padding: "10px 14px", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", background: "var(--surface-hover)" }}>Onceki take&apos;ler ({historicalDialogueTakes.length})</summary>
                            <div style={{ display: "grid", gap: 0 }}>
                              {historicalDialogueTakes.map((take) => {
                                const tUrl = convertFileSrc(toAbsoluteProjectPath(projectFolderPath, take.relativePath));
                                return (
                                  <div key={take.id} style={{ padding: "12px 14px", borderTop: "1px solid var(--surface-hover)", display: "grid", gap: 8 }}>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                      {[formatAudioTakeLabel(take), formatAudioTakeCreatedAt(take.createdAt), take.outputFormat].filter(Boolean).map((tx, i) => (<span key={i} style={{ padding: "3px 8px", borderRadius: 6, background: "var(--surface-hover)", fontSize: 10, fontWeight: 500, color: "var(--text-muted)" }}>{tx}</span>))}
                                    </div>
                                    <audio controls src={tUrl} style={{ width: "100%" }} />
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "32px 20px", textAlign: "center" }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-hover)", display: "grid", placeItems: "center" }}><AudioLines size={20} style={{ color: "var(--text-muted)" }} /></div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>{activeDialogueShot.audioStatus === "done" ? "Master dosyasi bekleniyor." : "Henuz uretilmis ses yok."}</div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </section>
        </div>
      </div>
      </div>

      <ImageEditModal
        draft={imageEditDraft}
        projectFolderPath={projectFolderPath}
        dialogTitle={shot.shotNumber}
        submitting={submittingImageEdit}
        guideFilePrefix={`guide_${activeMediaView === "end" ? "end" : "start"}`}
        onClose={closeImageEditModal}
        onSubmit={handleImageEditSubmit}
      />

      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} zIndex={220} />
    </>
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
