import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  Download,
  Expand,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Sparkles,
  Video as VideoIcon,
} from "lucide-react";
import { message, open } from "@tauri-apps/plugin-dialog";
import {
  MediaLightbox,
  type MediaLightboxItem,
} from "@/components/media/MediaLightbox";
import { MediaPaginationControls } from "@/components/media/MediaPaginationControls";
import {
  getAssetGroupName,
  normalizeAssetGroupName,
  replaceAssetGroupTag,
} from "@/lib/asset-tags";
import { downloadMediaFile } from "@/lib/media-download";
import { resolveVideoGeneratorDefaults } from "@/lib/generator-defaults";
import { getAppSettings } from "@/lib/store";
import {
  analyzeKlingVideoPrompt,
  clampKlingDuration,
  distributeKlingMultiShotDurations,
  getKlingMultiPromptValidationMessage,
  KLING_V3_DURATION_VALUES,
  VIDEO_MODELS,
  type KlingDuration,
  type KlingShotType,
  type VideoAspectRatio,
  type VideoModelId,
} from "@/services/fal.service";
import { getAssets, updateAssetGroups, type AssetWithTags } from "@/services/asset.service";
import { getShots, type ShotRow } from "@/services/import.service";
import { enqueueVideoJobs } from "@/services/jobqueue.service";
import { getDefaultModelPreset, getModelPreset } from "@/services/model-preset.service";
import { CollapsibleSection, SliderField, ToggleSwitch } from "@/components/ui";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";
import {
  useScreenStateStore,
  type VideoGeneratorScreenState,
} from "@/store/screen-state.store";

type GeneratorMode = "shot-linked" | "freeform";
const ALL_GROUP_KEY = "__all__";
const UNGROUPED_GROUP_KEY = "__ungrouped__";
const VIDEO_PAGE_SIZE = 9;

type VideoAsset = AssetWithTags & {
  absolutePath: string;
  assetUrl: string;
};

type VideoSource = {
  absolutePath: string;
  assetUrl: string;
  filename: string;
  sourceKind: "asset" | "local";
};

type VideoGeneratorLocationState = {
  promptTemplateContent?: string;
  promptTemplateName?: string;
  promptTemplateModel?: string;
  modelPresetId?: string;
  startAssetId?: string;
  endAssetId?: string;
  shotId?: string;
};

type AssetGroup = {
  key: string;
  label: string;
  count: number;
};

const DEFAULT_VIDEO_GENERATOR_STATE: VideoGeneratorScreenState = {
  mode: "shot-linked",
  selectedShotId: "",
  startAssetId: "",
  endAssetId: "",
  localStartPath: null,
  localEndPath: null,
  prompt: "",
  model: "fal-ai/kling-video/v3/pro/image-to-video",
  duration: 5,
  aspectRatio: "16:9",
  cfg: 0.45,
  generateAudio: true,
  shotType: "customize",
  galleryActiveGroupKey: ALL_GROUP_KEY,
  galleryGroupDraft: "",
  gallerySelectedGroupTarget: UNGROUPED_GROUP_KEY,
  galleryPage: 1,
};

export function VideoGenerator() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const location = useLocation();
  const navigate = useNavigate();
  const queueJobs = useQueueStore((state) => state.jobs);
  const activeProjectId = activeProject?.id ?? null;
  const setVideoGeneratorState = useScreenStateStore(
    (state) => state.setVideoGeneratorState,
  );
  const [mode, setMode] = useState<GeneratorMode>("shot-linked");
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [imageAssets, setImageAssets] = useState<VideoAsset[]>([]);
  const [videoAssets, setVideoAssets] = useState<VideoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShotId, setSelectedShotId] = useState<string>("");
  const [startAssetId, setStartAssetId] = useState<string>("");
  const [endAssetId, setEndAssetId] = useState<string>("");
  const [localStartPath, setLocalStartPath] = useState<string | null>(null);
  const [localEndPath, setLocalEndPath] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<VideoModelId>("fal-ai/kling-video/v3/pro/image-to-video");
  const [duration, setDuration] = useState<KlingDuration>(5);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [cfg, setCfg] = useState(0.45);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [shotType, setShotType] = useState<KlingShotType>("customize");
  const [generating, setGenerating] = useState(false);
  const [inboundNotice, setInboundNotice] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null);
  const promptAnalysis = useMemo(() => analyzeKlingVideoPrompt(prompt), [prompt]);

  function applyVideoGeneratorState(nextState: VideoGeneratorScreenState) {
    setMode(nextState.mode);
    setSelectedShotId(nextState.selectedShotId);
    setStartAssetId(nextState.startAssetId);
    setEndAssetId(nextState.endAssetId);
    setLocalStartPath(nextState.localStartPath);
    setLocalEndPath(nextState.localEndPath);
    setPrompt(nextState.prompt);
    setModel(
      nextState.model in VIDEO_MODELS
        ? (nextState.model as VideoModelId)
        : DEFAULT_VIDEO_GENERATOR_STATE.model,
    );
    setDuration(clampKlingDuration(nextState.duration));
    setAspectRatio(nextState.aspectRatio);
    setCfg(nextState.cfg);
    setGenerateAudio(nextState.generateAudio);
    setShotType(nextState.shotType);
  }

  useEffect(() => {
    let cancelled = false;

    async function initializeVideoGeneratorState() {
      if (!activeProjectId) {
        applyVideoGeneratorState(DEFAULT_VIDEO_GENERATOR_STATE);
        setInboundNotice(null);
        return;
      }

      const nextState =
        useScreenStateStore.getState().videoGeneratorByProject[activeProjectId] ?? null;

      if (nextState) {
        applyVideoGeneratorState({
          ...DEFAULT_VIDEO_GENERATOR_STATE,
          ...nextState,
        });
        setInboundNotice(null);
        return;
      }

      const [settings, defaultPreset] = await Promise.all([
        getAppSettings(),
        getDefaultModelPreset(),
      ]);
      const resolvedDefaults = resolveVideoGeneratorDefaults({
        appDefaults: settings,
        defaultPreset,
        inboundState: null,
        inboundPreset: null,
      });

      if (cancelled) {
        return;
      }

      applyVideoGeneratorState({
        ...DEFAULT_VIDEO_GENERATOR_STATE,
        model:
          resolvedDefaults.model in VIDEO_MODELS
            ? (resolvedDefaults.model as VideoModelId)
            : DEFAULT_VIDEO_GENERATOR_STATE.model,
        aspectRatio: resolvedDefaults.aspectRatio,
        cfg: resolvedDefaults.cfg,
        duration: resolvedDefaults.duration,
        generateAudio: true,
        shotType: resolvedDefaults.shotType,
      });
      setInboundNotice(null);
    }

    void initializeVideoGeneratorState();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProject) {
      setShots([]);
      setImageAssets([]);
      setVideoAssets([]);
      setLoading(false);
      return;
    }

    const project = activeProject;
    let cancelled = false;

    async function loadData() {
      setLoading(true);

      try {
        const [shotRows, imageRows, videoRows] = await Promise.all([
          getShots(project.id, { includeArchived: false }),
          getAssets(project.id, "image"),
          getAssets(project.id, "video"),
        ]);

        const [hydratedImages, hydratedVideos] = await Promise.all([
          Promise.all(
            imageRows.map(async (asset) => {
              const absolutePath = await join(project.folderPath, asset.file_path);
              return {
                ...asset,
                absolutePath,
                assetUrl: convertFileSrc(absolutePath),
              };
            }),
          ),
          Promise.all(
            videoRows.map(async (asset) => {
              const absolutePath = await join(project.folderPath, asset.file_path);
              return {
                ...asset,
                absolutePath,
                assetUrl: convertFileSrc(absolutePath),
              };
            }),
          ),
        ]);

        if (!cancelled) {
          const mainShots = shotRows.filter((shot) => !shot.parentShotId);
          setShots(mainShots);
          setImageAssets(hydratedImages);
          setVideoAssets(hydratedVideos);
          setSelectedShotId((current) =>
            current && mainShots.some((shot) => shot.id === current)
              ? current
              : (mainShots[0]?.id ?? ""),
          );
        }
      } catch (error) {
        console.error("Failed to load video generator state", error);

        if (!cancelled) {
          setShots([]);
          setImageAssets([]);
          setVideoAssets([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? null;

  useEffect(() => {
    if (mode !== "shot-linked" || !selectedShot) {
      return;
    }

    setLocalStartPath(null);
    setLocalEndPath(null);
    setPrompt(selectedShot.promptVideo ?? "");
    setDuration(clampKlingDuration(selectedShot.durationS));
  }, [mode, selectedShot?.durationS, selectedShot?.id, selectedShot?.promptVideo]);

  useEffect(() => {
    if (mode !== "shot-linked" || !selectedShot) {
      return;
    }

    const startMatch = imageAssets.find((asset) => asset.file_path === selectedShot.imageStartPath);
    const endMatch = imageAssets.find((asset) => asset.file_path === selectedShot.imageEndPath);
    setStartAssetId(startMatch?.id ?? "");
    setEndAssetId(endMatch?.id ?? "");
  }, [mode, selectedShot?.id, selectedShot?.imageStartPath, selectedShot?.imageEndPath, imageAssets]);

  useEffect(() => {
    const state = location.state as VideoGeneratorLocationState | null;

    if (!activeProjectId || !state) {
      return;
    }

    let cancelled = false;

    async function applyInboundState() {
      const inboundState = state;
      const notices: string[] = [];
      const [settings, defaultPreset, inboundPreset] = await Promise.all([
        getAppSettings(),
        getDefaultModelPreset(),
        inboundState?.modelPresetId ? getModelPreset(inboundState.modelPresetId) : Promise.resolve(null),
      ]);

      const resolvedDefaults = resolveVideoGeneratorDefaults({
        appDefaults: settings,
        defaultPreset,
        inboundState: inboundState?.promptTemplateModel
          ? { model: inboundState.promptTemplateModel }
          : null,
        inboundPreset,
      });

      if (!cancelled && resolvedDefaults.model in VIDEO_MODELS) {
        setModel(resolvedDefaults.model as VideoModelId);
        setAspectRatio(resolvedDefaults.aspectRatio);
        setCfg(resolvedDefaults.cfg);
        setShotType(resolvedDefaults.shotType);
        if (!selectedShot || inboundState?.modelPresetId) {
          setDuration(clampKlingDuration(resolvedDefaults.duration));
        }
      }

      if (inboundState?.promptTemplateContent) {
        setPrompt(inboundState.promptTemplateContent);
        notices.push(
          inboundState.promptTemplateName
            ? `Sablon uygulandi: ${inboundState.promptTemplateName}`
            : "Prompt sablonu uygulandi",
        );
      }

      if (inboundState?.startAssetId) {
        setMode("freeform");
        setStartAssetId(inboundState.startAssetId);
        notices.push("START gorseli baglandi");
      }

      if (inboundState?.endAssetId) {
        setMode("freeform");
        setEndAssetId(inboundState.endAssetId);
        notices.push("END gorseli baglandi");
      }

      if (inboundState?.shotId) {
        setMode("shot-linked");
        setSelectedShotId(inboundState.shotId);
        notices.push("Storyboard shot odaklandi");
      }

      if (inboundState?.modelPresetId && !cancelled && inboundPreset) {
        notices.push(`Preset yuklendi: ${inboundPreset.name}`);
      }

      if (!cancelled && inboundState) {
        setInboundNotice(notices.length > 0 ? notices.join(" • ") : null);
        navigate(location.pathname, { replace: true, state: null });
      }
    }

    void applyInboundState();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, location.pathname, location.state, navigate, selectedShot]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setVideoGeneratorState(activeProjectId, {
      mode,
      selectedShotId,
      startAssetId,
      endAssetId,
      localStartPath,
      localEndPath,
      prompt,
      model,
      duration,
      aspectRatio,
      cfg,
      generateAudio,
      shotType,
    });
  }, [
    activeProjectId,
    aspectRatio,
    cfg,
    duration,
    endAssetId,
    generateAudio,
    localEndPath,
    localStartPath,
    mode,
    model,
    prompt,
    selectedShotId,
    setVideoGeneratorState,
    shotType,
    startAssetId,
  ]);

  const selectedStartAsset = imageAssets.find((asset) => asset.id === startAssetId) ?? null;
  const selectedEndAsset = imageAssets.find((asset) => asset.id === endAssetId) ?? null;
  const selectedStartSource: VideoSource | null = selectedStartAsset
    ? {
        absolutePath: selectedStartAsset.absolutePath,
        assetUrl: selectedStartAsset.assetUrl,
        filename: selectedStartAsset.filename,
        sourceKind: "asset",
      }
    : localStartPath
      ? {
          absolutePath: localStartPath,
          assetUrl: convertFileSrc(localStartPath),
          filename: localStartPath.split(/[\\/]/).pop() ?? "start-image",
          sourceKind: "local",
        }
      : null;
  const selectedEndSource: VideoSource | null = selectedEndAsset
    ? {
        absolutePath: selectedEndAsset.absolutePath,
        assetUrl: selectedEndAsset.assetUrl,
        filename: selectedEndAsset.filename,
        sourceKind: "asset",
      }
    : localEndPath
      ? {
          absolutePath: localEndPath,
          assetUrl: convertFileSrc(localEndPath),
          filename: localEndPath.split(/[\\/]/).pop() ?? "end-image",
          sourceKind: "local",
        }
      : null;

  const activeJobs = queueJobs.filter(
    (job) =>
      job.projectId === activeProject?.id &&
      (job.type === "video" || job.type === "coverage_video" || job.type === "upscale") &&
      (job.status === "queued" || job.status === "active"),
  );

  function handleVideoAssetsRegrouped(assetIds: string[], groupName: string | null) {
    const assetIdSet = new Set(assetIds);
    setVideoAssets((current) =>
      current.map((asset) =>
        assetIdSet.has(asset.id)
          ? { ...asset, tagsList: replaceAssetGroupTag(asset.tagsList, groupName) }
          : asset,
      ),
    );
  }

  async function handlePickLocalSource(target: "start" | "end") {
    const selected = await open({
      title: target === "start" ? "START gorselini sec" : "END gorselini sec",
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    if (target === "start") {
      setStartAssetId("");
      setLocalStartPath(selected);
      return;
    }

    setEndAssetId("");
    setLocalEndPath(selected);
  }

  function handleClearLocalSource(target: "start" | "end") {
    if (target === "start") {
      setLocalStartPath(null);

      if (mode === "shot-linked" && selectedShot?.imageStartPath) {
        const startMatch = imageAssets.find((asset) => asset.file_path === selectedShot.imageStartPath);
        setStartAssetId(startMatch?.id ?? "");
      }

      return;
    }

    setLocalEndPath(null);

    if (mode === "shot-linked" && selectedShot?.imageEndPath) {
      const endMatch = imageAssets.find((asset) => asset.file_path === selectedShot.imageEndPath);
      setEndAssetId(endMatch?.id ?? "");
    }
  }

  async function handleDownloadMedia(path: string, fileName: string, title: string) {
    try {
      await downloadMediaFile({
        sourcePath: path,
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

  async function handleGenerate() {
    if (!activeProject || !prompt.trim()) {
      return;
    }

    const startPath = selectedStartSource?.absolutePath;
    const endPath = selectedEndSource?.absolutePath;

    if (!startPath) {
      await message("Video uretimi icin bir START gorseli secilmeli.", {
        title: "Video Generator",
        kind: "warning",
      });
      return;
    }

    if (promptAnalysis.detectedMultiShot) {
      try {
        distributeKlingMultiShotDurations(duration, promptAnalysis.shotCount);
      } catch (error) {
        await message(
          error instanceof Error ? error.message : "Multi-shot sure dagilimi gecersiz.",
          {
            title: "Video Generator",
            kind: "warning",
          },
        );
        return;
      }

      const validationMessage = getKlingMultiPromptValidationMessage(promptAnalysis);

      if (validationMessage) {
        await message(validationMessage, {
          title: "Video Generator",
          kind: "warning",
        });
        return;
      }
    }

    setGenerating(true);

    try {
      await enqueueVideoJobs({
        model,
        prompt: prompt.trim(),
        imageStartPath: startPath,
        imageEndPath: endPath ?? undefined,
        resolveStartDependencies: false,
        resolveEndDependencies: false,
        duration,
        aspectRatio,
        cfg,
        generateAudio,
        shotType: promptAnalysis.detectedMultiShot ? shotType : undefined,
        quantity: 1,
        shotId: mode === "shot-linked" ? selectedShot?.id : undefined,
      });

      await message("Video isi kuyruga eklendi.", {
        title: "Video Generator",
        kind: "info",
      });
    } catch (error) {
      console.error("Failed to enqueue video job", error);
      await message(
        error instanceof Error ? error.message : "Video kuyruga eklenemedi.",
        {
          title: "Video Generator",
          kind: "error",
        },
      );
    } finally {
      setGenerating(false);
    }
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <EmptyProjectState
          description="Video uretimi storyboard shot'lari veya asset library gorselleri uzerinden calisir. Devam etmeden once bir proje sec."
          icon={<Film size={40} strokeWidth={1.6} style={{ color: "var(--accent)" }} />}
          title="Video Generator hazir"
        />
      </section>
    );
  }

  return (
    <>
      <section className="screen-shell">
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "360px minmax(0, 1fr)",
            gap: 22,
            minHeight: "calc(100vh - var(--topbar-h) - 112px)",
          }}
        >
        <aside style={panelStyle}>
          <header style={{ display: "grid", gap: 8 }}>
            <span style={eyebrowStyle}>
              <Sparkles size={13} />
              Motion Stage
            </span>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Video Uret
            </div>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Shot bagli mod storyboard karelerini kullanir. Serbest modda asset
              library'den secim yapabilir veya dosyadan dogrudan gorsel yukleyebilirsin.
            </p>
            {inboundNotice ? (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid var(--glass-border)",
                  background: "rgba(0, 0, 0, 0.03)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {inboundNotice}
              </div>
            ) : null}
          </header>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={fieldLabelStyle}>Mod</span>
            <div style={{ display: "flex", gap: 8 }}>
              {([
                ["shot-linked", "Shot bagli"],
                ["freeform", "Serbest mod"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={mode === value ? "btn-primary" : "btn-secondary"}
                  onClick={() => setMode(value)}
                  style={{ flex: 1 }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "shot-linked" ? (
            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>Shot</span>
              <select
                className="studio-field"
                onChange={(event) => setSelectedShotId(event.target.value)}
                style={selectStyle}
                value={selectedShotId}
              >
                {shots.map((shot) => (
                  <option key={shot.id} value={shot.id}>
                    {shot.shotNumber} - {shot.summaryTr ?? "Storyboard shot"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>
              START gorsel
              {mode === "shot-linked" && selectedShot?.imageStartPath && startAssetId
                ? " (shot'tan yuklendi)"
                : ""}
            </span>
            <select
              className="studio-field"
              onChange={(event) => {
                setStartAssetId(event.target.value);
                setLocalStartPath(null);
              }}
              style={selectStyle}
              value={startAssetId}
            >
              <option value="">Bir gorsel sec</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-secondary"
                onClick={() => void handlePickLocalSource("start")}
                type="button"
              >
                Dosyadan sec
              </button>
              {localStartPath ? (
                <button
                  className="btn-secondary"
                  onClick={() => handleClearLocalSource("start")}
                  type="button"
                >
                  Yerel secimi kaldir
                </button>
              ) : null}
            </div>
          </label>

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>END gorsel (opsiyonel)</span>
            <select
              className="studio-field"
              onChange={(event) => {
                setEndAssetId(event.target.value);
                setLocalEndPath(null);
              }}
              style={selectStyle}
              value={endAssetId}
            >
              <option value="">BOS</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.filename}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-secondary"
                onClick={() => void handlePickLocalSource("end")}
                type="button"
              >
                Dosyadan sec
              </button>
              {localEndPath ? (
                <button
                  className="btn-secondary"
                  onClick={() => handleClearLocalSource("end")}
                  type="button"
                >
                  Yerel secimi kaldir
                </button>
              ) : null}
            </div>
          </label>

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Prompt</span>
            <textarea
              className="studio-field"
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              style={textareaStyle}
              value={prompt}
            />
          </label>

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Model</span>
            <select
              className="studio-field"
              onChange={(event) => setModel(event.target.value as VideoModelId)}
              style={selectStyle}
              value={model}
            >
              {(Object.entries(VIDEO_MODELS) as [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]][]).map(
                ([modelId, info]) => (
                  <option key={modelId} value={modelId}>
                    {info.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <CollapsibleSection title="Video ayarlari" subtitle={`${duration}s · Ses ${generateAudio ? "acik" : "kapali"}`} defaultOpen>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>Sure</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                  {KLING_V3_DURATION_VALUES.map((value) => (
                    <button
                      key={value}
                      className={duration === value ? "btn-primary" : "btn-secondary"}
                      onClick={() => setDuration(value)}
                      style={{ flex: 1 }}
                      type="button"
                    >
                    {value}s
                  </button>
                ))}
              </div>
            </div>

            <ToggleSwitch
              label="Yerel ses uretimi"
              description="Kling'e generate_audio=true gonderilir"
              checked={generateAudio}
              onChange={setGenerateAudio}
            />

            {promptAnalysis.detectedMultiShot ? (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 16,
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  background: "rgba(59, 130, 246, 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Film size={14} style={{ color: "rgba(59, 130, 246, 0.8)", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Multi-shot algilandi</span>
                </div>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  Prompt icinde {promptAnalysis.shotCount} alt shot bulundu. Istek
                  {" "}<code style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, background: "rgba(59, 130, 246, 0.1)" }}>multi_prompt</code> + <code style={{ fontSize: 11, padding: "1px 5px", borderRadius: 4, background: "rgba(59, 130, 246, 0.1)" }}>shot_type</code> ile gonderilecek.
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["customize", "intelligent"] as KlingShotType[]).map((value) => (
                    <button
                      key={value}
                      className={shotType === value ? "btn-primary" : "btn-secondary"}
                      onClick={() => setShotType(value)}
                      style={{ flex: 1 }}
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Gelismis ayarlar">
            <div style={{ display: "grid", gap: 12 }}>
              <SliderField
                label="CFG"
                min={0}
                max={1}
                step={0.05}
                value={cfg}
                onChange={setCfg}
              />

              <div style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>En-boy orani</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["16:9", "9:16", "1:1"] as const).map((value) => (
                    <button
                      key={value}
                      className={aspectRatio === value ? "btn-primary" : "btn-secondary"}
                      onClick={() => setAspectRatio(value)}
                      style={{ flex: 1 }}
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <button
            className="btn-primary"
            disabled={!prompt.trim() || generating || loading}
            onClick={() => void handleGenerate()}
            style={{ width: "100%", fontSize: 14, fontWeight: 600, borderRadius: 12, padding: "14px 20px" }}
            type="button"
          >
            <Film size={16} />
            {generating ? "Kuyruga ekleniyor..." : "Video Uret"}
          </button>
        </aside>

          <section style={panelStyle}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <span style={eyebrowStyle}>
                <VideoIcon size={13} />
                Output Rail
              </span>
              <div style={{ fontSize: 22, fontWeight: 600 }}>Video Sonuclari</div>
            </div>
            <div style={badgeStyle}>
              <LoaderCircle className="spin-slow" size={14} />
              {activeJobs.length} aktif is
            </div>
          </header>

          {loading ? (
            <LoadingRail copy="Video varliklari yukleniyor..." />
          ) : (
            <div style={{ display: "grid", gap: 18 }}>
              <SourcePreviewSection
                endSource={selectedEndSource}
                onDownloadEnd={
                  selectedEndSource
                    ? () =>
                        void handleDownloadMedia(
                          selectedEndSource.absolutePath,
                          selectedEndSource.filename,
                          "END",
                        )
                    : undefined
                }
                onPickEnd={() => void handlePickLocalSource("end")}
                onPreviewEnd={
                  selectedEndSource
                    ? () => setLightboxItem(buildSourcePreviewLightboxItem(selectedEndSource, "END"))
                    : undefined
                }
                onPickStart={() => void handlePickLocalSource("start")}
                onPreviewStart={
                  selectedStartSource
                    ? () => setLightboxItem(buildSourcePreviewLightboxItem(selectedStartSource, "START"))
                    : undefined
                }
                onDownloadStart={
                  selectedStartSource
                    ? () =>
                        void handleDownloadMedia(
                          selectedStartSource.absolutePath,
                          selectedStartSource.filename,
                          "START",
                        )
                    : undefined
                }
                startSource={selectedStartSource}
              />
              <VideoGallery
                assets={videoAssets}
                onAssetsRegrouped={handleVideoAssetsRegrouped}
                onDownload={(asset) =>
                  void handleDownloadMedia(asset.absolutePath, asset.filename, asset.filename)
                }
                onPreview={(asset) =>
                  setLightboxItem({
                    kind: "video",
                    src: asset.assetUrl,
                    title: asset.filename,
                    subtitle: `${(asset.model_used ?? "unknown").split("/").pop()} / ${asset.resolution ?? "HD"}`,
                    description: asset.prompt ?? "Prompt kaydi yok.",
                    downloadPath: asset.absolutePath,
                    downloadName: asset.filename,
                  })
                }
                projectId={activeProject.id}
              />
            </div>
          )}
          </section>
        </section>
      </section>
      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </>
  );
}

function SourcePreviewSection({
  startSource,
  endSource,
  onDownloadStart,
  onDownloadEnd,
  onPickStart,
  onPickEnd,
  onPreviewStart,
  onPreviewEnd,
}: {
  startSource: VideoSource | null;
  endSource: VideoSource | null;
  onDownloadStart?: () => void;
  onDownloadEnd?: () => void;
  onPickStart: () => void;
  onPickEnd: () => void;
  onPreviewStart?: () => void;
  onPreviewEnd?: () => void;
}) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Kaynak kareler
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <PreviewCard
          label="START"
          onDownload={onDownloadStart}
          onPick={onPickStart}
          onPreview={onPreviewStart}
          source={startSource}
        />
        <PreviewCard
          label="END"
          onDownload={onDownloadEnd}
          onPick={onPickEnd}
          onPreview={onPreviewEnd}
          source={endSource}
        />
      </div>
    </section>
  );
}

function PreviewCard({
  source,
  label,
  onPick,
  onDownload,
  onPreview,
}: {
  source: VideoSource | null;
  label: string;
  onPick: () => void;
  onDownload?: () => void;
  onPreview?: () => void;
}) {
  return (
    <article
      style={{
        display: "grid",
        gap: 10,
        padding: 14,
        borderRadius: 18,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div
        onClick={onPick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPick();
          }
        }}
        role="button"
        style={{
          display: "grid",
          gap: 10,
          border: "none",
          padding: 0,
          background: "transparent",
          cursor: "pointer",
          color: "inherit",
          textAlign: "left",
        }}
        tabIndex={0}
      >
        {source ? (
          <>
            <div style={{ position: "relative" }}>
              <img
                alt={source.filename}
                loading="lazy"
                src={source.assetUrl}
                style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", borderRadius: 14 }}
              />
              {onPreview || onDownload ? (
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    display: "flex",
                    gap: 8,
                  }}
                >
                  {onDownload ? (
                    <button
                      className="btn-secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDownload();
                      }}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 999,
                        background: "var(--glass-bg)",
                        borderColor: "var(--border-default)",
                        color: "var(--text-primary)",
                        backdropFilter: "blur(10px)",
                      }}
                      type="button"
                    >
                      <Download size={13} />
                      Indir
                    </button>
                  ) : null}
                  {onPreview ? (
                    <button
                      className="btn-secondary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPreview();
                      }}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 999,
                        background: "var(--glass-bg)",
                        borderColor: "var(--border-default)",
                        color: "var(--text-primary)",
                        backdropFilter: "blur(10px)",
                      }}
                      type="button"
                    >
                      <Expand size={13} />
                      Buyut
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{source.filename}</div>
              <div style={{ fontSize: 11, color: "var(--accent)" }}>
                {source.sourceKind === "local" ? "Yerel dosya secildi" : "Asset library secimi"} / tikla ve degistir
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 180,
              borderRadius: 14,
              border: "1px dashed var(--border-default)",
              background: "var(--bg-base)",
              color: "var(--text-muted)",
              gap: 10,
            }}
          >
            <ImageIcon size={24} />
            <span style={{ fontSize: 12 }}>Gorsel secilmedi</span>
            <span style={{ fontSize: 11, color: "var(--accent)" }}>Tikla ve dosyadan sec</span>
          </div>
        )}
      </div>
    </article>
  );
}

function VideoGallery({
  assets,
  onAssetsRegrouped,
  onDownload,
  onPreview,
  projectId,
}: {
  assets: VideoAsset[];
  onAssetsRegrouped: (assetIds: string[], groupName: string | null) => void;
  onDownload: (asset: VideoAsset) => void;
  onPreview: (asset: VideoAsset) => void;
  projectId: string;
}) {
  const setVideoGeneratorState = useScreenStateStore(
    (state) => state.setVideoGeneratorState,
  );
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [groupDraft, setGroupDraft] = useState("");
  const [selectedGroupTarget, setSelectedGroupTarget] = useState<string>(UNGROUPED_GROUP_KEY);
  const [activeGroupKey, setActiveGroupKey] = useState<string>(ALL_GROUP_KEY);
  const [page, setPage] = useState(1);
  const [movingSelection, setMovingSelection] = useState(false);
  const restoringGalleryStateRef = useRef(false);

  useEffect(() => {
    restoringGalleryStateRef.current = true;
    const nextState = useScreenStateStore.getState().videoGeneratorByProject[projectId] ?? null;
    setGroupDraft(nextState?.galleryGroupDraft ?? "");
    setSelectedGroupTarget(nextState?.gallerySelectedGroupTarget ?? UNGROUPED_GROUP_KEY);
    setActiveGroupKey(nextState?.galleryActiveGroupKey ?? ALL_GROUP_KEY);
    setPage(nextState?.galleryPage ?? 1);
  }, [projectId]);

  useEffect(() => {
    setSelectedAssetIds((current) =>
      current.filter((assetId) => assets.some((asset) => asset.id === assetId)),
    );
  }, [assets]);

  const groups = useMemo<AssetGroup[]>(() => {
    const groupedCounts = new Map<string, number>();

    for (const asset of assets) {
      const key = getAssetGroupName(asset.tagsList) ?? UNGROUPED_GROUP_KEY;
      groupedCounts.set(key, (groupedCounts.get(key) ?? 0) + 1);
    }

    const namedGroups = Array.from(groupedCounts.entries())
      .filter(([key]) => key !== UNGROUPED_GROUP_KEY)
      .sort(([left], [right]) => left.localeCompare(right, "tr"))
      .map(([key, count]) => ({ key, label: key, count }));

    return [
      { key: ALL_GROUP_KEY, label: "Tum videolar", count: assets.length },
      { key: UNGROUPED_GROUP_KEY, label: "Klasorsuz", count: groupedCounts.get(UNGROUPED_GROUP_KEY) ?? 0 },
      ...namedGroups,
    ];
  }, [assets]);

  const activeGroupAssets = useMemo(() => {
    if (activeGroupKey === ALL_GROUP_KEY) {
      return assets;
    }

    return assets.filter(
      (asset) => (getAssetGroupName(asset.tagsList) ?? UNGROUPED_GROUP_KEY) === activeGroupKey,
    );
  }, [activeGroupKey, assets]);

  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const normalizedGroupDraft = normalizeAssetGroupName(groupDraft);
  const totalPages = Math.max(1, Math.ceil(activeGroupAssets.length / VIDEO_PAGE_SIZE));
  const pageStartIndex = (page - 1) * VIDEO_PAGE_SIZE;
  const pagedAssets = activeGroupAssets.slice(pageStartIndex, pageStartIndex + VIDEO_PAGE_SIZE);
  const rangeStart = pagedAssets.length > 0 ? pageStartIndex + 1 : 0;
  const rangeEnd = pageStartIndex + pagedAssets.length;
  const activeGroupLabel =
    groups.find((group) => group.key === activeGroupKey)?.label ?? "Tum videolar";

  useEffect(() => {
    if (restoringGalleryStateRef.current) {
      restoringGalleryStateRef.current = false;
      return;
    }

    setPage(1);
  }, [activeGroupKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (activeGroupKey === ALL_GROUP_KEY) {
      return;
    }

    if (!groups.some((group) => group.key === activeGroupKey)) {
      setActiveGroupKey(ALL_GROUP_KEY);
    }
  }, [activeGroupKey, groups]);

  useEffect(() => {
    if (
      selectedGroupTarget !== UNGROUPED_GROUP_KEY &&
      !groups.some((group) => group.key === selectedGroupTarget)
    ) {
      setSelectedGroupTarget(UNGROUPED_GROUP_KEY);
    }
  }, [groups, selectedGroupTarget]);

  useEffect(() => {
    setVideoGeneratorState(projectId, {
      galleryGroupDraft: groupDraft,
      gallerySelectedGroupTarget: selectedGroupTarget,
      galleryActiveGroupKey: activeGroupKey,
      galleryPage: page,
    });
  }, [
    activeGroupKey,
    groupDraft,
    page,
    projectId,
    selectedGroupTarget,
    setVideoGeneratorState,
  ]);

  async function handleMoveSelectedAssets() {
    if (selectedAssetIds.length === 0) {
      return;
    }

    const targetGroupName =
      normalizedGroupDraft ??
      (selectedGroupTarget === UNGROUPED_GROUP_KEY ? null : selectedGroupTarget);

    setMovingSelection(true);

    try {
      await updateAssetGroups(selectedAssetIds, targetGroupName);
      onAssetsRegrouped(selectedAssetIds, targetGroupName);
      setGroupDraft("");
      setSelectedAssetIds([]);
      setSelectedGroupTarget(targetGroupName ?? UNGROUPED_GROUP_KEY);
      setActiveGroupKey(targetGroupName ?? UNGROUPED_GROUP_KEY);
    } catch (error) {
      console.error("Failed to regroup video assets", error);
      await message(
        error instanceof Error ? error.message : "Secilen videolar klasore tasinamadi.",
        {
          title: "Video Generator",
          kind: "error",
        },
      );
    } finally {
      setMovingSelection(false);
    }
  }

  if (assets.length === 0) {
    return (
      <EmptyProjectState
        description="Uretilen videolar burada listelenir. Ilk is kuyruga gonderildiginde bu panel canlanir."
        icon={<VideoIcon size={38} style={{ color: "var(--accent)" }} />}
        title="Henuz video yok"
      />
    );
  }

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Kayitli videolar ({assets.length})
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {groups.map((group) => (
          <button
            className={activeGroupKey === group.key ? "btn-primary" : "btn-secondary"}
            key={group.key}
            onClick={() => setActiveGroupKey(group.key)}
            style={{ padding: "8px 12px", fontSize: 11 }}
            type="button"
          >
            <FolderOpen size={13} />
            {group.label}
            <span
              style={{
                padding: "2px 7px",
                borderRadius: 999,
                background: "rgba(0, 0, 0, 0.22)",
                fontSize: 10,
              }}
            >
              {group.count}
            </span>
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          padding: 14,
          borderRadius: 20,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-elevated)",
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
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {activeGroupLabel} / {rangeStart}-{rangeEnd} / {activeGroupAssets.length}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Her sayfada yalnizca {VIDEO_PAGE_SIZE} video karti render ediliyor ve kart videolari
              `preload=none` ile geliyor. Bu sayede cok yuksek output sayisinda rail akici kalir.
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {selectedAssetIds.length} video secili
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="studio-field"
            onChange={(event) => setGroupDraft(event.target.value)}
            placeholder="Yeni klasor adi"
            style={collectionFieldStyle}
            value={groupDraft}
          />
          <select
            className="studio-field"
            onChange={(event) => setSelectedGroupTarget(event.target.value)}
            style={collectionFieldStyle}
            value={selectedGroupTarget}
          >
            <option value={UNGROUPED_GROUP_KEY}>Klasorsuz</option>
            {groups
              .filter((group) => group.key !== ALL_GROUP_KEY && group.key !== UNGROUPED_GROUP_KEY)
              .map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
          </select>
          <button
            className="btn-secondary"
            disabled={selectedAssetIds.length === 0 || movingSelection}
            onClick={() => void handleMoveSelectedAssets()}
            style={{ padding: "9px 12px", fontSize: 11 }}
            type="button"
          >
            <FolderOpen size={13} />
            {movingSelection
              ? "Tasiniyor..."
              : normalizedGroupDraft
                ? `"${normalizedGroupDraft}" klasorune tasi`
                : selectedGroupTarget === UNGROUPED_GROUP_KEY
                  ? "Klasorden cikar"
                  : "Secilenleri tasi"}
          </button>
          {selectedAssetIds.length > 0 ? (
            <button
              className="btn-secondary"
              onClick={() => setSelectedAssetIds([])}
              style={{ padding: "9px 12px", fontSize: 11 }}
              type="button"
            >
              Secimi temizle
            </button>
          ) : null}
        </div>
      </div>

      {activeGroupAssets.length === 0 ? (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            minHeight: 220,
            borderRadius: 20,
            border: "1px dashed var(--border-default)",
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            textAlign: "center",
            padding: 24,
          }}
        >
          Bu klasorde henuz video yok.
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            {pagedAssets.map((asset) => (
              <VideoCard
                asset={asset}
                groupName={getAssetGroupName(asset.tagsList)}
                key={asset.id}
                onDownload={() => onDownload(asset)}
                onPreview={() => onPreview(asset)}
                onToggleSelect={() =>
                  setSelectedAssetIds((current) =>
                    current.includes(asset.id)
                      ? current.filter((entry) => entry !== asset.id)
                      : [...current, asset.id],
                  )
                }
                selected={selectedAssetIdSet.has(asset.id)}
              />
            ))}
          </div>

          <MediaPaginationControls
            onPageChange={setPage}
            page={page}
            summary={`${rangeStart}-${rangeEnd} arasi videolar gosteriliyor / toplam ${activeGroupAssets.length}`}
            totalPages={totalPages}
          />
        </>
      )}
    </section>
  );
}

function VideoCard({
  asset,
  groupName,
  onDownload,
  onPreview,
  onToggleSelect,
  selected,
}: {
  asset: VideoAsset;
  groupName: string | null;
  onDownload: () => void;
  onPreview: () => void;
  onToggleSelect: () => void;
  selected: boolean;
}) {
  return (
    <article
      style={{
        display: "grid",
        gap: 12,
        padding: 14,
        borderRadius: 18,
        border: selected ? "1.5px solid var(--accent)" : "1px solid var(--border-default)",
        background: "var(--surface-card)",
        boxShadow: selected
          ? "var(--shadow-lg)"
          : "0 1px 3px var(--surface-hover)",
      }}
    >
      <div style={{ position: "relative" }}>
        <video
          controls
          preload="none"
          src={asset.assetUrl}
          style={{ width: "100%", aspectRatio: "16 / 10", borderRadius: 14, background: "#000" }}
        />
        <button
          className={selected ? "btn-primary" : "btn-secondary"}
          onClick={onToggleSelect}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            minWidth: 34,
            padding: "6px 10px",
            borderRadius: 999,
            background: selected ? "var(--accent)" : "var(--glass-bg)",
            borderColor: selected ? "var(--accent)" : "var(--border-default)",
            color: selected ? "var(--on-accent)" : "var(--text-primary)",
            backdropFilter: "blur(10px)",
          }}
          type="button"
        >
          {selected ? <Check size={13} /> : "Sec"}
        </button>
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            display: "flex",
            gap: 8,
          }}
        >
          <button
            className="btn-secondary"
            onClick={onDownload}
            style={{
              padding: "7px 10px",
              borderRadius: 999,
              background: "var(--glass-bg)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
              backdropFilter: "blur(10px)",
            }}
            type="button"
          >
            <Download size={13} />
            Indir
          </button>
          <button
            className="btn-secondary"
            onClick={onPreview}
            style={{
              padding: "7px 10px",
              borderRadius: 999,
              background: "var(--glass-bg)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
              backdropFilter: "blur(10px)",
            }}
            type="button"
          >
            <Expand size={13} />
            Buyut
          </button>
        </div>
        {groupName ? (
          <span
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              border: "1px solid var(--border-default)",
              background: "var(--glass-bg)",
              padding: "6px 10px",
              color: "var(--text-primary)",
              fontSize: 11,
            }}
          >
            <FolderOpen size={12} />
            {groupName}
          </span>
        ) : null}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{asset.filename}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {(asset.model_used ?? "unknown").split("/").pop()} / {asset.resolution ?? "HD"}
        </div>
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {asset.prompt ?? "Prompt kaydi yok."}
        </div>
      </div>
    </article>
  );
}

function buildSourcePreviewLightboxItem(
  source: VideoSource,
  label: "START" | "END",
): MediaLightboxItem {
  return {
    kind: "image",
    src: source.assetUrl,
    title: `${label} / ${source.filename}`,
    subtitle: source.sourceKind === "local" ? "Yerel secim" : "Asset library secimi",
    description:
      source.sourceKind === "local"
        ? "Bu kare disaridan dosya secilerek eklendi."
        : "Bu kare proje asset library icinden secildi.",
    downloadPath: source.absolutePath,
    downloadName: source.filename,
  };
}

function EmptyProjectState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 360,
        borderRadius: 24,
        border: "1px dashed var(--border-default)",
        background: "var(--bg-surface)",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ display: "grid", gap: 12, justifyItems: "center", maxWidth: 420 }}>
        {icon}
        <div style={{ fontSize: 22, fontWeight: 600 }}>{title}</div>
        <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>{description}</p>
      </div>
    </div>
  );
}

function LoadingRail({ copy }: { copy: string }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 360,
        color: "var(--text-muted)",
        gap: 10,
      }}
    >
      <LoaderCircle className="spin-slow" size={28} />
      <span style={{ fontSize: 13 }}>{copy}</span>
    </div>
  );
}

const panelStyle: CSSProperties = {
  display: "grid",
  alignContent: "start",
  gap: 16,
  padding: 18,
  borderRadius: 24,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(180deg, rgba(0, 0, 0, 0.02), transparent 22%), var(--bg-surface)",
  boxShadow: "0 1px 3px var(--surface-hover)",
};

const eyebrowStyle: CSSProperties = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  border: "1px solid var(--border-default)",
  background: "var(--surface-hover)",
  padding: "6px 10px",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--accent)",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
};

const collectionFieldStyle: CSSProperties = {
  minWidth: 180,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 12,
};

const textareaStyle: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
  resize: "vertical",
  minHeight: 160,
  lineHeight: 1.7,
  fontFamily: "inherit",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  padding: "8px 12px",
  color: "var(--text-secondary)",
  fontSize: 12,
};
