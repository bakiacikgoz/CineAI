import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpToLine,
  Archive,
  ArchiveRestore,
  Clapperboard,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { getAppSetting } from "@/lib/store";
import {
  analyzeKlingVideoPrompt,
  clampKlingDuration,
  resolveImageModel,
} from "@/services/fal.service";
import {
  enqueueUpscaleJobs,
  enqueueStoryboardFrameJob,
  enqueueVideoJobs,
} from "@/services/jobqueue.service";
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
import { clearShotExternalReference, updateShotPromptFields, saveShotExternalReference, setShotArchived, type ShotRow } from "@/services/import.service";
import {
  listPromptTemplates,
  type PromptTemplateRecord,
} from "@/services/prompt-template.service";

type DetailView = "start" | "end" | "video";
type CandidateGroups = Record<AutonomousStage, AutonomousCandidateAsset[]>;

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

function statusColor(status: string) {
  if (status === "done") return "var(--status-success)";
  if (status === "review") return "var(--accent)";
  if (status === "generating") return "var(--status-warning)";
  if (status === "error") return "var(--status-error)";
  return "var(--text-muted)";
}

export function ShotDetailPanel({
  shot,
  initialView = "start",
  projectFolderPath,
  onClose,
  onRefresh,
}: ShotDetailPanelProps) {
  const navigate = useNavigate();
  const [activeMediaView, setActiveMediaView] = useState<DetailView>(initialView);
  const [activePromptTab, setActivePromptTab] = useState<DetailView>(initialView);
  const [producing, setProducing] = useState<DetailView | null>(null);
  const [groups, setGroups] = useState<CandidateGroups>(EMPTY_GROUPS);
  const [loadingGroups, setLoadingGroups] = useState(true);
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
  const [promptDrafts, setPromptDrafts] = useState<Record<DetailView, string>>({
    start: shot.promptStart ?? "",
    end: shot.promptEnd ?? "",
    video: shot.promptVideo ?? "",
  });

  useEffect(() => {
    setActiveMediaView(initialView);
    setActivePromptTab(initialView);
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
  }, [shot.characterId, shot.characterLookId, shot.id, shot.includeCharacterPrompt, shot.promptEnd, shot.promptStart, shot.promptVideo]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function refreshAll() {
    await onRefresh();
    const next = await getAutonomousCandidateGroups(shot.id);
    setGroups(next);
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

  const startImageUrl = shot.imageStartPath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, shot.imageStartPath))
    : null;
  const endImageUrl = shot.imageEndPath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, shot.imageEndPath))
    : null;
  const videoUrl = shot.video4kPath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, shot.video4kPath))
    : shot.videoPath
      ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, shot.videoPath))
      : null;
  const externalReferenceUrl = shot.externalReferencePath
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, shot.externalReferencePath))
    : null;
  const missingExternalReference =
    shot.requiresExternalReference && !shot.externalReferencePath;
  const mediaByView = {
    start: { url: startImageUrl, label: "START", kind: "image" as const, status: shot.imageStatus, path: shot.imageStartPath },
    end: { url: endImageUrl, label: "END", kind: "image" as const, status: shot.imageStatus, path: shot.imageEndPath },
    video: { url: videoUrl, label: shot.video4kPath ? "VIDEO 4K" : "VIDEO", kind: "video" as const, status: shot.videoStatus, path: shot.video4kPath ?? shot.videoPath },
  };
  const activeMedia = mediaByView[activeMediaView];
  const imageModel = resolveImageModel(shot.model);
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
  const startReferenceMissing = missingExternalReference && shot.chainStatus !== "continue";
  const endReferenceMissing = missingExternalReference;
  const activePromptChanged =
    (activePromptTab === "start" && promptDrafts.start !== (shot.promptStart ?? "")) ||
    (activePromptTab === "end" && promptDrafts.end !== (shot.promptEnd ?? "")) ||
    (activePromptTab === "video" && promptDrafts.video !== (shot.promptVideo ?? ""));
  const activePromptEmpty = !promptContent.trim();

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
      await enqueueVideoJobs({
        model: "fal-ai/kling-video/v3/pro/image-to-video",
        prompt: promptDrafts.video.trim(),
        duration: clampKlingDuration(shot.durationS),
        aspectRatio: "16:9",
        cfg: 0.45,
        generateAudio: videoPromptAnalysis.hasAudioDirection,
        shotType: videoPromptAnalysis.detectedMultiShot ? "customize" : undefined,
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

  function openVideoGenerator() {
    navigate("/video-generator", {
      state: {
        shotId: shot.id,
      },
    });
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 160, display: "grid", placeItems: "center", padding: 28, background: "rgba(4,4,6,0.8)", backdropFilter: "blur(16px)" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(1320px, calc(100vw - 56px))", height: "min(900px, calc(100vh - 56px))", minHeight: 660, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", borderRadius: 32, overflow: "hidden", border: "1px solid var(--border-default)", background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent 12%), var(--bg-surface)", boxShadow: "0 38px 120px rgba(0,0,0,0.52)" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "18px 22px", borderBottom: "1px solid var(--border-subtle)", background: "linear-gradient(140deg, rgba(245,158,11,0.08), transparent 34%), rgba(255,255,255,0.01)" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "inline-flex", width: "fit-content", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(245,158,11,0.22)", background: "rgba(245,158,11,0.1)", color: "var(--accent)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}><Clapperboard size={13} />Shot inspector</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 24, letterSpacing: "-0.04em" }}>{shot.shotNumber}</strong>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{shot.shotType.toUpperCase()} / {shot.durationS ?? "--"}s / A{shot.act ?? "-"} S{shot.scene ?? "-"}</span>
              {shot.isArchived ? (
                <span style={{ padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
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
          <section style={{ minWidth: 0, minHeight: 0, padding: 22, display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", gap: 16, borderRight: "1px solid var(--border-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                {(["start", "end", "video"] as DetailView[]).map((view) => (
                  <button key={view} type="button" onClick={() => setActiveMediaView(view)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 999, border: `1px solid ${activeMediaView === view ? "rgba(245,158,11,0.26)" : "rgba(255,255,255,0.08)"}`, background: activeMediaView === view ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.03)", color: activeMediaView === view ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {view}<span style={{ padding: "2px 7px", borderRadius: 999, background: "rgba(0,0,0,0.2)", color: statusColor(mediaByView[view].status), fontSize: 9 }}>{mediaByView[view].status}</span>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "8px 12px", borderRadius: 999, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.03)" }}>
                {activeMedia.path ? activeMedia.path.split(/[\\/]/).pop() : `${activeMedia.label} henuz uretilmedi`}
              </div>
            </div>

            <div style={{ minHeight: 0, borderRadius: 28, border: "1px solid var(--border-subtle)", background: "radial-gradient(circle at top, rgba(245,158,11,0.08), transparent 34%), var(--bg-elevated)", overflow: "hidden" }}>
              {!activeMedia.url ? (
                <div style={{ height: "100%", minHeight: 420, display: "grid", placeItems: "center", padding: 28, textAlign: "center", color: "var(--text-muted)", gap: 12 }}>
                  {activeMedia.kind === "video" ? <PlayCircle size={40} /> : <ImageIcon size={40} />}
                  <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-secondary)" }}>{activeMedia.label} preview hazir degil</div>
                </div>
              ) : activeMedia.kind === "video" ? (
                <video key={activeMedia.url} src={activeMedia.url} controls playsInline poster={startImageUrl ?? undefined} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#050506" }} />
              ) : (
                <img src={activeMedia.url} alt={`${shot.shotNumber} ${activeMedia.label}`} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#050506" }} />
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {(["start", "end", "video"] as DetailView[]).map((view) => (
                <button key={view} type="button" onClick={() => setActiveMediaView(view)} style={{ display: "grid", gap: 8, padding: "12px 14px", borderRadius: 18, border: `1px solid ${activeMediaView === view ? "rgba(245,158,11,0.26)" : "var(--border-subtle)"}`, background: activeMediaView === view ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)", textAlign: "left", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{view === "video" ? <PlayCircle size={15} /> : <ImageIcon size={15} />}<strong style={{ fontSize: 12 }}>{view.toUpperCase()}</strong></div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{mediaByView[view].url ? "Hazir preview" : "Henuz uretilmedi"}</div>
                </button>
              ))}
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
            <section style={{ display: "grid", gap: 10, padding: "14px 16px", borderRadius: 22, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}><span>Shot capsule</span><span>{shot.imageStatus} / {shot.videoStatus}</span></div>
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

            {shot.chainStatus === "continue" ? (
              <section style={{ display: "grid", gap: 6, padding: "12px 14px", borderRadius: 18, border: "1px solid rgba(245,158,11,0.22)", background: "rgba(245,158,11,0.08)", color: "var(--accent)" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}><Link2 size={13} />Chain continue</div>
                <div style={{ fontSize: 12, lineHeight: 1.65 }}>START adaylari onceki shot&apos;in secilen END sonucuna gore acilir.</div>
              </section>
            ) : null}

            {shot.requiresExternalReference ? (
              <section
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 18,
                  border: `1px solid ${missingExternalReference ? "rgba(245,158,11,0.24)" : "rgba(34,197,94,0.22)"}`,
                  background: missingExternalReference
                    ? "rgba(245,158,11,0.08)"
                    : "rgba(34,197,94,0.08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: missingExternalReference ? "var(--accent)" : "var(--status-success)" }}>
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
                  <div style={{ fontSize: 11, color: "var(--accent)", lineHeight: 1.6 }}>
                    Bu shot icin START, END veya coverage gorseli uretmeden once referans gorsel yuklenmeli.
                    {shot.chainStatus === "continue"
                      ? " Zincir START continuity onceki END ile kurulur; ama sahne referansi yine END ve coverage icin gerekli olabilir."
                      : ""}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--status-success)", lineHeight: 1.6 }}>
                    Harici referans gorseli hazir. Uretim bu referansi kullanabilir.
                  </div>
                )}
              </section>
            ) : null}

            <section style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.02)" }}>
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
                    <div style={{ display: "grid", gap: 8, padding: "12px 12px 14px", borderRadius: 16, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.03)" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        {selectedCharacterPreview ? (
                          <img
                            alt={selectedLook.name}
                            src={selectedCharacterPreview}
                            style={{ width: 72, aspectRatio: "4 / 3", borderRadius: 12, objectFit: "cover", border: "1px solid var(--border-subtle)" }}
                          />
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
                <button className="btn-secondary" disabled={activePromptTab === "start" ? activePromptEmpty : !promptDrafts.start.trim() || producing !== null || startReferenceMissing} onClick={() => void queueStartFrame()} type="button"><Clapperboard size={14} />{producing === "start" ? "Queueing..." : "Start"}</button>
                <button className="btn-secondary" disabled={!promptDrafts.end.trim() || producing !== null || endReferenceMissing} onClick={() => void queueEndFrame()} type="button"><Clapperboard size={14} />{producing === "end" ? "Queueing..." : "End"}</button>
              </div>
              <button className="btn-primary" disabled={!promptDrafts.video.trim() || producing !== null} onClick={() => void queueVideo()} type="button"><Video size={15} />{producing === "video" ? "Queueing video..." : "Produce video"}</button>
              <button className="btn-secondary" disabled={!shot.videoPath || upscaling || producing !== null} onClick={() => void queueUpscale()} type="button"><ArrowUpToLine size={15} />{upscaling ? "Queueing 4K..." : "Produce 4K upscale"}</button>
              {videoPromptAnalysis.detectedMultiShot ? (
                <div style={{ fontSize: 11, color: "var(--accent)", lineHeight: 1.6 }}>
                  Multi-shot algilandi: {videoPromptAnalysis.shotCount} alt shot / kling shot_type=
                  customize
                  {videoPromptAnalysis.hasAudioDirection ? " / native audio acik" : ""}
                </div>
              ) : videoPromptAnalysis.hasAudioDirection ? (
                <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  Audio direction algilandi. Bu shot video isteginde native audio acik gonderilecek.
                </div>
              ) : null}
            </section>

            <section style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.02)" }}>
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

            <section style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.02)" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Workflow links</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button className="btn-secondary" type="button" onClick={() => openAssetLibrary("start", shot.imageStartPath)}>
                  <Link2 size={14} />
                  Asset Library
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
                  <div key={stage} style={{ display: "grid", gap: 10, padding: "12px 12px 14px", borderRadius: 18, border: "1px solid var(--border-subtle)", background: "rgba(255,255,255,0.02)" }}>
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
                            <div key={asset.id} style={{ display: "grid", gap: 8, padding: 8, borderRadius: 16, border: `1px solid ${asset.isSelected ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)"}`, background: asset.isSelected ? "rgba(245,158,11,0.08)" : "rgba(255,255,255,0.03)" }}>
                              <button type="button" onClick={() => setActiveMediaView(stage)} style={{ padding: 0, border: "none", borderRadius: 12, overflow: "hidden", background: "var(--bg-overlay)", cursor: "pointer", aspectRatio: "16 / 10" }}>
                                {isVideo ? <video src={assetUrl} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <img src={assetUrl} alt={asset.filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                              </button>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>V{String(asset.variant ?? 0).padStart(2, "0")}</span>
                                {asset.isSelected ? <span style={{ fontSize: 9, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Selected</span> : null}
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                                <button className="btn-secondary" onClick={() => setActiveMediaView(stage)} type="button" style={{ padding: "6px 8px", fontSize: 11 }}>{isVideo ? <PlayCircle size={13} /> : <ImageIcon size={13} />}View</button>
                                <button className="btn-primary" disabled={selectingAssetId === asset.id} onClick={() => void handleSelect(asset.id, stage)} type="button" style={{ padding: "6px 10px", fontSize: 11 }}>{selectingAssetId === asset.id ? "..." : asset.isSelected ? "Picked" : "Pick"}</button>
                              </div>
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
                    <button key={tab} type="button" onClick={() => setActivePromptTab(tab)} style={{ padding: "7px 10px", borderRadius: 999, border: `1px solid ${activePromptTab === tab ? "rgba(245,158,11,0.24)" : "var(--border-subtle)"}`, background: activePromptTab === tab ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.03)", color: activePromptTab === tab ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{tab}</button>
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
        background: "rgba(255,255,255,0.03)",
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
