import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ImagePlus, Layers3, SlidersHorizontal, Sparkles, WandSparkles, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { message, open } from "@tauri-apps/plugin-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveImageGeneratorDefaults } from "@/lib/generator-defaults";
import { IMAGE_MODELS, calcImageCost, type ImageModelId } from "@/services/fal.service";
import { getAppSettings } from "@/lib/store";
import { getShots, type ShotRow } from "@/services/import.service";
import {
  enqueueImageJobs,
  enqueueStoryboardFrameJob,
  resolveStoryboardVideoFrameFallbackPermission,
} from "@/services/jobqueue.service";
import { getDefaultModelPreset, getModelPreset } from "@/services/model-preset.service";
import {
  ImageEditModal,
  type ImageEditModalDraft,
  type ImageEditSubmitPayload,
} from "@/components/media/ImageEditModal";
import {
  GeneratedImageGallery,
  type GalleryAsset,
} from "@/screens/image-generator/GeneratedImageGallery";
import { CollapsibleSection, SliderField } from "@/components/ui";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore, type Job } from "@/store/queue.store";
import {
  useScreenStateStore,
  type ImageGeneratorScreenState,
} from "@/store/screen-state.store";
import { motion } from "framer-motion";

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:2"] as const;
type GeneratorMode = "shot-linked" | "freeform";
type ShotStage = "start" | "end";

type ImageGeneratorLocationState = {
  promptTemplateContent?: string;
  promptTemplateName?: string;
  promptTemplateModel?: string;
  modelPresetId?: string;
  referenceAssetPath?: string;
  shotId?: string;
  shotStage?: ShotStage;
};

const DEFAULT_IMAGE_GENERATOR_STATE: ImageGeneratorScreenState = {
  mode: "freeform",
  selectedShotId: "",
  shotStage: "start",
  prompt: "",
  model: "fal-ai/nano-banana-2",
  aspectRatio: "16:9",
  cfg: 7,
  steps: 28,
  quantity: 4,
  refImage: null,
  galleryActiveGroupKey: "__all__",
  galleryGroupDraft: "",
  gallerySelectedGroupTarget: "__ungrouped__",
  galleryPage: 1,
};

const ASPECT_RATIO_VALUES: Record<(typeof ASPECT_RATIOS)[number], number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
};

type ImageAspectRatio = (typeof ASPECT_RATIOS)[number];

function getNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getQuantityValue(value: unknown): number | null {
  const nextValue = getFiniteNumber(value);
  return nextValue === null ? null : Math.max(1, Math.min(50, Math.round(nextValue)));
}

function getAspectRatioValue(value: unknown): ImageAspectRatio | null {
  return typeof value === "string" && ASPECT_RATIOS.includes(value as ImageAspectRatio)
    ? (value as ImageAspectRatio)
    : null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function getPrimaryReferencePath(value: unknown): string | null {
  return getNonEmptyString(value) ?? getStringArray(value)[0] ?? null;
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function buildStoryboardImageVariantSuffix(stage: ShotStage, batchKey: string, index: number): string {
  return `manual_${stage}_${batchKey}_v${String(index + 1).padStart(2, "0")}`;
}

function findMatchingImageJob(asset: GalleryAsset, jobs: Job[]): Job | null {
  const normalizedAssetPath = normalizePathForMatch(asset.absolutePath);
  const normalizedRelativePath = normalizePathForMatch(asset.file_path);

  return (
    jobs.find((job) => {
      if (job.assetId === asset.id) {
        return true;
      }

      if (asset.fal_job_id && job.falJobId === asset.fal_job_id) {
        return true;
      }

      const resultPath = getNonEmptyString(job.resultPath);

      if (!resultPath) {
        return false;
      }

      const normalizedResultPath = normalizePathForMatch(resultPath);
      return (
        normalizedResultPath === normalizedAssetPath ||
        normalizedResultPath.endsWith(`/${normalizedRelativePath}`)
      );
    }) ?? null
  );
}

export function ImageGenerator() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const queueJobs = useQueueStore((state) => state.jobs);
  const location = useLocation();
  const navigate = useNavigate();
  const activeProjectId = activeProject?.id ?? null;
  const setImageGeneratorState = useScreenStateStore(
    (state) => state.setImageGeneratorState,
  );
  const [mode, setMode] = useState<GeneratorMode>("freeform");
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [selectedShotId, setSelectedShotId] = useState("");
  const [shotStage, setShotStage] = useState<ShotStage>("start");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModelId>("fal-ai/nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>("16:9");
  const [cfg, setCfg] = useState(7);
  const [steps, setSteps] = useState(28);
  const [quantity, setQuantity] = useState(4);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [imageEditDraft, setImageEditDraft] = useState<ImageEditModalDraft | null>(null);
  const [submittingImageEdit, setSubmittingImageEdit] = useState(false);
  const [inboundNotice, setInboundNotice] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );

  const imageQueueJobs = useMemo(
    () =>
      [...queueJobs]
        .filter(
          (job) =>
            job.projectId === activeProjectId &&
            (job.type === "image_start" ||
              job.type === "image_end" ||
              job.type === "coverage_image"),
        )
        .sort(
          (left, right) =>
            (right.completedAt ?? right.queuedAt) - (left.completedAt ?? left.queuedAt),
        ),
    [activeProjectId, queueJobs],
  );
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? null;

  useEffect(() => {
    if (mode !== "shot-linked" || !selectedShot) {
      return;
    }

    setPrompt(shotStage === "end" ? selectedShot.promptEnd ?? "" : selectedShot.promptStart ?? "");
  }, [mode, selectedShot?.id, selectedShot?.promptEnd, selectedShot?.promptStart, shotStage]);

  function inferAspectRatioFromAsset(asset: GalleryAsset): ImageAspectRatio {
    if (!asset.width || !asset.height) {
      return aspectRatio;
    }

    const assetRatio = asset.width / asset.height;
    let bestMatch: ImageAspectRatio = "16:9";
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const ratio of ASPECT_RATIOS) {
      const distance = Math.abs(ASPECT_RATIO_VALUES[ratio] - assetRatio);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = ratio;
      }
    }

    return bestMatch;
  }

  function applyGeneratorState(nextState: ImageGeneratorScreenState) {
    setMode(nextState.mode);
    setSelectedShotId(nextState.selectedShotId);
    setShotStage(nextState.shotStage);
    setPrompt(nextState.prompt);
    setModel(
      nextState.model in IMAGE_MODELS
        ? (nextState.model as ImageModelId)
        : (DEFAULT_IMAGE_GENERATOR_STATE.model as ImageModelId),
    );
    setAspectRatio(
      ASPECT_RATIOS.includes(nextState.aspectRatio as (typeof ASPECT_RATIOS)[number])
        ? (nextState.aspectRatio as (typeof ASPECT_RATIOS)[number])
        : (DEFAULT_IMAGE_GENERATOR_STATE.aspectRatio as (typeof ASPECT_RATIOS)[number]),
    );
    setCfg(nextState.cfg);
    setSteps(nextState.steps);
    setQuantity(nextState.quantity);
    setRefImage(nextState.refImage);
  }

  useEffect(() => {
    if (!IMAGE_MODELS[model].supportsImg2Img) {
      setRefImage(null);
    }
  }, [model]);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setImageEditDraft(null);
    setSubmittingImageEdit(false);
  }, [activeProjectId]);

  useEffect(() => {
    let cancelled = false;

    async function initializeGeneratorState() {
      if (!activeProjectId) {
        applyGeneratorState(DEFAULT_IMAGE_GENERATOR_STATE);
        setInboundNotice(null);
        return;
      }

      const nextState =
        useScreenStateStore.getState().imageGeneratorByProject[activeProjectId] ?? null;

      if (nextState) {
        applyGeneratorState({
          ...DEFAULT_IMAGE_GENERATOR_STATE,
          ...nextState,
        });
        setInboundNotice(null);
        return;
      }

      const [settings, defaultPreset] = await Promise.all([
        getAppSettings(),
        getDefaultModelPreset(),
      ]);
      const resolvedDefaults = resolveImageGeneratorDefaults({
        appDefaults: settings,
        defaultPreset,
        inboundState: null,
        inboundPreset: null,
      });

      if (cancelled) {
        return;
      }

      applyGeneratorState({
        ...DEFAULT_IMAGE_GENERATOR_STATE,
        model:
          resolvedDefaults.model in IMAGE_MODELS
            ? resolvedDefaults.model
            : DEFAULT_IMAGE_GENERATOR_STATE.model,
        aspectRatio: resolvedDefaults.aspectRatio,
        cfg: resolvedDefaults.cfg,
        steps: resolvedDefaults.steps,
      });
      setInboundNotice(null);
    }

    void initializeGeneratorState();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProject) {
      setShots([]);
      setSelectedShotId("");
      return;
    }

    const project = activeProject;
    let cancelled = false;

    async function loadShotsForGenerator() {
      try {
        const shotRows = await getShots(project.id, { includeArchived: false });

        if (cancelled) {
          return;
        }

        const mainShots = shotRows.filter((shot) => !shot.parentShotId);
        setShots(mainShots);
        setSelectedShotId((current) =>
          current && mainShots.some((shot) => shot.id === current)
            ? current
            : (mainShots[0]?.id ?? ""),
        );
      } catch (error) {
        console.error("Failed to load storyboard shots for image generator", error);

        if (!cancelled) {
          setShots([]);
          setSelectedShotId("");
        }
      }
    }

    void loadShotsForGenerator();

    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  useEffect(() => {
    const state = location.state as ImageGeneratorLocationState | null;

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

      const resolvedDefaults = resolveImageGeneratorDefaults({
        appDefaults: settings,
        defaultPreset,
        inboundState: inboundState?.promptTemplateModel
          ? { model: inboundState.promptTemplateModel }
          : null,
        inboundPreset,
      });

      if (!cancelled && resolvedDefaults.model in IMAGE_MODELS) {
        setModel(resolvedDefaults.model as ImageModelId);
        setCfg(resolvedDefaults.cfg);
        setSteps(resolvedDefaults.steps);
        setAspectRatio(resolvedDefaults.aspectRatio);
      }

      if (inboundState?.promptTemplateContent) {
        setPrompt(inboundState.promptTemplateContent);
        notices.push(
          inboundState.promptTemplateName
            ? `Sablon uygulandi: ${inboundState.promptTemplateName}`
            : "Prompt sablonu uygulandi",
        );
      }

      if (inboundState?.referenceAssetPath) {
        setRefImage(inboundState.referenceAssetPath);
        notices.push("Referans kare eklendi");
      }

      if (inboundState?.shotId) {
        setMode("shot-linked");
        setSelectedShotId(inboundState.shotId);
        setShotStage(inboundState.shotStage ?? "start");
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
  }, [activeProjectId, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setImageGeneratorState(activeProjectId, {
      mode,
      selectedShotId,
      shotStage,
      prompt,
      model,
      aspectRatio,
      cfg,
      steps,
      quantity,
      refImage,
    });
  }, [
    activeProjectId,
    aspectRatio,
    cfg,
    model,
    mode,
    prompt,
    quantity,
    refImage,
    selectedShotId,
    setImageGeneratorState,
    shotStage,
    steps,
  ]);

  const estimatedCost = calcImageCost(model, quantity);
  const hasStoryboardShots = shots.length > 0;
  const isCompactLayout = viewportWidth < 1240;
  const canGenerate =
    Boolean(prompt.trim()) &&
    !generating &&
    (mode !== "shot-linked" || Boolean(selectedShot));
  const generateButtonLabel = generating
    ? "Kuyruga aliniyor..."
    : mode === "shot-linked"
      ? selectedShot
        ? `${selectedShot.shotNumber} ${shotStage.toUpperCase()} uret${quantity > 1 ? ` (${quantity})` : ""}`
        : "Once shot sec"
      : `Uret (${quantity} gorsel)`;

  function handleUseGalleryReference(absolutePath: string) {
    if (!IMAGE_MODELS[model].supportsImg2Img) {
      setModel("fal-ai/nano-banana-2");
      setInboundNotice(
        "Galeri karesi referans olarak eklendi. Img2img icin model Nano Banana 2'ye alindi.",
      );
    } else {
      setInboundNotice("Galeri karesi referans olarak eklendi.");
    }

    setRefImage(absolutePath);
  }

  function handleReuseGeneration(asset: GalleryAsset) {
    const metadata = asset.metadata ?? null;
    const matchingJob = findMatchingImageJob(asset, imageQueueJobs);
    const jobParams = matchingJob?.params;
    const metadataPrompt = getNonEmptyString(metadata?.basePrompt);
    const jobPrompt = getNonEmptyString(jobParams?.basePrompt) ?? getNonEmptyString(matchingJob?.prompt);
    const metadataModel =
      typeof asset.model_used === "string" && asset.model_used in IMAGE_MODELS
        ? (asset.model_used as ImageModelId)
        : null;
    const jobModel =
      typeof matchingJob?.model === "string" && matchingJob.model in IMAGE_MODELS
        ? (matchingJob.model as ImageModelId)
        : null;
    const nextAspectRatio =
      getAspectRatioValue(metadata?.aspectRatio) ??
      getAspectRatioValue(jobParams?.aspectRatio) ??
      inferAspectRatioFromAsset(asset);
    const nextCfg = getFiniteNumber(metadata?.cfg) ?? getFiniteNumber(jobParams?.cfg) ?? cfg;
    const nextSteps = getFiniteNumber(metadata?.steps) ?? getFiniteNumber(jobParams?.steps) ?? steps;
    const nextQuantity =
      getQuantityValue(metadata?.quantity) ?? getQuantityValue(jobParams?.quantity) ?? quantity;
    const nextRefImage =
      getPrimaryReferencePath(metadata?.refImagePath) ??
      getPrimaryReferencePath(metadata?.referenceImagePaths) ??
      getPrimaryReferencePath(matchingJob?.refImagePath) ??
      getPrimaryReferencePath(jobParams?.referenceImagePaths);
    const requestedModel = metadataModel ?? jobModel ?? (nextRefImage ? "fal-ai/nano-banana-2" : model);
    const nextModel =
      nextRefImage && !IMAGE_MODELS[requestedModel].supportsImg2Img
        ? "fal-ai/nano-banana-2"
        : requestedModel;
    const nextPrompt = metadataPrompt ?? jobPrompt ?? getNonEmptyString(asset.prompt);

    if (nextPrompt) {
      setPrompt(nextPrompt);
    }

    setModel(nextModel);
    setAspectRatio(nextAspectRatio);
    setCfg(nextCfg);
    setSteps(nextSteps);
    setQuantity(nextQuantity);
    setRefImage(nextRefImage);

    setInboundNotice(
      nextRefImage
        ? requestedModel !== nextModel
          ? `${asset.filename} icin prompt, ayarlar ve referans kare geri yuklendi. Referans destegi icin model Nano Banana 2'ye alindi.`
          : `${asset.filename} icin prompt, ayarlar ve referans kare geri yuklendi.`
        : metadata || matchingJob
          ? `${asset.filename} icin prompt ve ayarlar geri yuklendi; bu kayit icin referans kare bulunamadi.`
          : `${asset.filename} icin mevcut kayittan prompt/model geri yuklendi; referans kare kaydi bulunamadi.`,
    );
  }

  function handleEditAsset(asset: GalleryAsset) {
    setImageEditDraft({
      id: asset.id,
      label: asset.filename,
      absolutePath: asset.absolutePath,
      previewUrl: asset.assetUrl,
      width: asset.width,
      height: asset.height,
    });
  }

  async function handleSubmitImageEdit(payload: ImageEditSubmitPayload) {
    const draft = imageEditDraft;

    if (!draft) {
      throw new Error("Duzenlenecek kare bulunamadi.");
    }

    setSubmittingImageEdit(true);

    try {
      await enqueueImageJobs({
        model: "fal-ai/nano-banana-2",
        prompt: payload.prompt,
        aspectRatio: payload.aspectRatio,
        cfg,
        steps,
        quantity: 1,
        refImagePath: payload.referenceImagePaths[0],
        referenceImagePaths: payload.referenceImagePaths,
        assetTags: ["edited"],
      });

      setImageEditDraft(null);
      setInboundNotice(
        `${draft.label} icin isaretlemeli duzenleme Nano Banana 2 ile kuyruga alindi.`,
      );
      await message(`${draft.label} icin duzenleme isi kuyruga eklendi.`, {
        title: "Image Generator",
        kind: "info",
      });
    } catch (error) {
      console.error("Failed to enqueue edited image job", error);
      throw error;
    } finally {
      setSubmittingImageEdit(false);
    }
  }

  async function handleGenerate() {
    if (!prompt.trim() || !activeProject) {
      return;
    }

    setGenerating(true);

    try {
      if (mode === "shot-linked") {
        if (!selectedShot) {
          await message("Shot-linked uretim icin once bir storyboard shot sec.", {
            title: "Image Generator",
            kind: "warning",
          });
          return;
        }

        const allowVideoFrameFallback =
          shotStage === "start"
            ? await resolveStoryboardVideoFrameFallbackPermission({
                shot: selectedShot,
                mode: "start",
                explicitReferenceImagePaths: refImage ? [refImage] : undefined,
              })
            : undefined;

        if (quantity === 1) {
          await enqueueStoryboardFrameJob({
            shotId: selectedShot.id,
            prompt: prompt.trim(),
            mode: shotStage,
            model,
            aspectRatio,
            cfg,
            steps,
            referenceImagePaths: refImage ? [refImage] : undefined,
            allowVideoFrameFallback,
          });
        } else {
          const batchKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

          for (let index = 0; index < quantity; index += 1) {
            await enqueueStoryboardFrameJob({
              shotId: selectedShot.id,
              prompt: prompt.trim(),
              mode: shotStage,
              model,
              aspectRatio,
              cfg,
              steps,
              priority: 120 - index,
              outputSuffix: buildStoryboardImageVariantSuffix(shotStage, batchKey, index),
              assetTags: [`stage:${shotStage}`],
              persistToShotPath: false,
              completeStatus: shotStage === "start"
                ? (selectedShot.imageStartPath ? "done" : "review")
                : (selectedShot.imageEndPath ? "done" : "review"),
              referenceImagePaths: refImage ? [refImage] : undefined,
              allowVideoFrameFallback,
            });
          }
        }

        await message(
          quantity === 1
            ? `${selectedShot.shotNumber} icin ${shotStage.toUpperCase()} isi kuyruga eklendi.`
            : `${selectedShot.shotNumber} icin ${quantity} ${shotStage.toUpperCase()} varyanti kuyruga eklendi.`,
          {
            title: "Image Generator",
            kind: "info",
          },
        );
      } else {
        await enqueueImageJobs({
          model,
          prompt: prompt.trim(),
          aspectRatio,
          cfg,
          steps,
          quantity,
          refImagePath: refImage ?? undefined,
        });
        await message(`${quantity} gorsel is kuyruguna eklendi.`, {
          title: "Image Generator",
          kind: "info",
        });
      }
    } catch (error) {
      console.error("Failed to enqueue image jobs", error);
      await message(
        error instanceof Error ? error.message : "Gorsel uretim joblari eklenemedi.",
        {
          title: "Image Generator",
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
        <div
          style={{
            display: "grid",
            placeItems: "center",
            minHeight: 420,
            borderRadius: 24,
            border: "1px solid var(--border-subtle)",
            background:
              "radial-gradient(circle at top, rgba(0, 0, 0, 0.03), transparent 38%), var(--bg-surface)",
          }}
        >
          <div
            style={{
              display: "grid",
              justifyItems: "center",
              gap: 12,
              maxWidth: 420,
              textAlign: "center",
            }}
          >
            <ImagePlus size={40} strokeWidth={1.6} style={{ color: "var(--accent)" }} />
            <div style={{ fontSize: 24, fontWeight: 600 }}>Gorsel Uretici hazir</div>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Prompt paneli ve job kuyrugu calisiyor. Devam etmeden once Dashboard
              ekranindan bir proje sec.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <motion.section
      className="screen-shell"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <section
        style={{
          display: "grid",
          gridTemplateColumns: isCompactLayout
            ? "minmax(0, 1fr)"
            : "minmax(360px, 390px) minmax(0, 1fr)",
          gap: 22,
          minHeight: "calc(100vh - var(--topbar-h) - 112px)",
        }}
      >
        <aside
          style={{
            display: "grid",
            alignContent: "start",
            gap: 16,
            minWidth: 0,
            padding: 18,
            borderRadius: 24,
            border: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(180deg, rgba(0, 0, 0, 0.02), transparent 26%), var(--bg-surface)",
            boxShadow: "0 1px 3px var(--surface-hover)",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 8,
              paddingBottom: 16,
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
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
              }}
            >
              <Sparkles size={13} />
              Gorsel Uretim
            </span>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Gorsel Uret
            </div>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Shot-linked mod storyboard promptlarini kullanir. Freeform modda promptu,
              modeli ve referans kareyi serbest ayarlayabilirsin.
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
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {inboundNotice}
            </div>
          ) : null}
          </div>

          {/* --- Model ve Prompt (always visible) --- */}
          <FieldGroup label="Model" icon={<Layers3 size={14} />}>
            <div style={{ display: "grid", gap: 8 }}>
              {(Object.entries(IMAGE_MODELS) as Array<
                [ImageModelId, (typeof IMAGE_MODELS)[ImageModelId]]
              >).map(([modelId, info]) => {
                const active = modelId === model;

                return (
                  <button
                    className="hover-glow"
                    key={modelId}
                    onClick={() => setModel(modelId)}
                    style={{
                      display: "grid",
                      gap: 6,
                      padding: 12,
                      borderRadius: 14,
                      border: `1px solid ${
                        active ? "rgba(0, 0, 0, 0.2)" : "var(--border-subtle)"
                      }`,
                      background: active ? "var(--surface-hover)" : "var(--bg-elevated)",
                      color: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    type="button"
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{info.label}</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: active ? "var(--accent)" : "var(--text-muted)",
                        }}
                      >
                        {info.costPerImage > 0 ? `$${info.costPerImage.toFixed(2)}` : "Ozel"}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {info.supportsImg2Img
                        ? "Prompt + referans kare ile calisir"
                        : "Yalnizca text to image"}
                    </span>
                  </button>
                );
              })}
            </div>
          </FieldGroup>

          <FieldGroup label="Prompt" icon={<WandSparkles size={14} />}>
            <textarea
              className="studio-field"
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={
                mode === "shot-linked"
                  ? "Secili shot promptu burada yuklenir; istersen duzenleyebilirsin..."
                  : "Sahneyi, lens dilini, isik ve atmosferi tarif et..."
              }
              rows={7}
              style={textareaStyle}
              value={prompt}
            />
          </FieldGroup>

          <FieldGroup label="Adet">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderRadius: 14,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-elevated)",
                padding: 8,
              }}
            >
              <button
                className="hover-glow"
                onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                style={stepperButtonStyle}
                type="button"
              >
                -
              </button>
              <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.04em" }}>
                {quantity}
              </span>
              <button
                className="hover-glow"
                onClick={() => setQuantity((current) => Math.min(50, current + 1))}
                style={stepperButtonStyle}
                type="button"
              >
                +
              </button>
            </div>
          </FieldGroup>

          {/* --- Gorsel Ayarlari (collapsible, default closed) --- */}
          <CollapsibleSection title="Gorsel Ayarlari" subtitle="Oran, CFG, Adim">
            <div style={{ display: "grid", gap: 16 }}>
              <FieldGroup label="En Boy Orani" icon={<SlidersHorizontal size={14} />}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {ASPECT_RATIOS.map((ratio) => {
                    const active = ratio === aspectRatio;

                    return (
                      <button
                        className="hover-glow"
                        key={ratio}
                        onClick={() => setAspectRatio(ratio)}
                        style={{
                          minWidth: 64,
                          padding: "7px 12px",
                          borderRadius: 999,
                          border: `1px solid ${
                            active ? "#000000" : "var(--border-default)"
                          }`,
                          background: active ? "#000000" : "var(--bg-elevated)",
                          color: active ? "var(--on-accent)" : "var(--text-secondary)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                        type="button"
                      >
                        {ratio}
                      </button>
                    );
                  })}
                </div>
              </FieldGroup>

              <SliderField label="CFG" min={1} max={20} step={0.5} value={cfg} onChange={setCfg} />
              <SliderField label="Adim sayisi" min={10} max={50} value={steps} onChange={setSteps} />
            </div>
          </CollapsibleSection>

          {/* --- Referans Gorsel (collapsible, default closed) --- */}
          <CollapsibleSection title="Referans Gorsel" subtitle={refImage ? "Secili" : "Yok"}>
            <RefImagePicker
              disabled={!IMAGE_MODELS[model].supportsImg2Img}
              value={refImage}
              onChange={setRefImage}
            />
          </CollapsibleSection>

          {/* --- Shot Baglantisi (collapsible, default closed) --- */}
          <CollapsibleSection title="Shot Baglantisi" subtitle={mode === "shot-linked" && selectedShot ? selectedShot.shotNumber : "Kapalı"}>
            <div style={{ display: "grid", gap: 14 }}>
              <FieldGroup label="Mod" icon={<Sparkles size={14} />}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  {([
                    ["shot-linked", "Shot-linked"],
                    ["freeform", "Serbest"],
                  ] as const).map(([value, label]) => (
                    <button
                      className={mode === value ? "btn-primary" : "btn-secondary"}
                      key={value}
                      onClick={() => setMode(value)}
                      style={{ flex: 1 }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </FieldGroup>

              {mode === "shot-linked" ? (
                <>
                  <FieldGroup label="Shot" icon={<Layers3 size={14} />}>
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
                    {!hasStoryboardShots ? (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: 14,
                          border: "1px solid var(--border-subtle)",
                          background: "rgba(0, 0, 0, 0.02)",
                          color: "var(--text-secondary)",
                          fontSize: 12,
                          lineHeight: 1.6,
                        }}
                      >
                        Bu projede henuz storyboard shot'i yok. Storyboard ekranindan shot import
                        edip sonra shot-linked uretime gecebilirsin.
                      </div>
                    ) : selectedShot ? (
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
                        {selectedShot.shotNumber} secili. {shotStage.toUpperCase()} promptu otomatik
                        yuklenir; istersen burada degistirip varyant uretebilirsin.
                      </div>
                    ) : null}
                  </FieldGroup>

                  <FieldGroup label="Hedef Kare">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                      {(["start", "end"] as const).map((value) => (
                        <button
                          className={shotStage === value ? "btn-primary" : "btn-secondary"}
                          key={value}
                          onClick={() => setShotStage(value)}
                          style={{ flex: 1 }}
                          type="button"
                        >
                          {value.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </FieldGroup>
                </>
              ) : null}
            </div>
          </CollapsibleSection>

          {/* --- Generate button area --- */}
          <div
            style={{
              display: "grid",
              gap: 10,
              marginTop: 8,
              paddingTop: 16,
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>Proje klasoru</span>
              <span
                style={{
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text-primary)",
                }}
              >
                {activeProject.name}
              </span>
            </div>

            <button
              className="btn-primary"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
              style={{ width: "100%", padding: "14px 16px", fontSize: 14, fontWeight: 600 }}
              type="button"
            >
              {generateButtonLabel}
            </button>
            <div
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              Tahmini maliyet: <strong style={{ color: "var(--accent)" }}>${estimatedCost.toFixed(3)}</strong>
            </div>
          </div>
        </aside>

        <GeneratedImageGallery
          onEditAsset={handleEditAsset}
          onReuseGeneration={handleReuseGeneration}
          onUseAsReference={handleUseGalleryReference}
          projectFolderPath={activeProject.folderPath}
        />
      </section>
      <ImageEditModal
        dialogTitle="Image Generator"
        draft={imageEditDraft}
        guideFilePrefix="guide_still"
        onClose={() => {
          if (submittingImageEdit) {
            return;
          }

          setImageEditDraft(null);
        }}
        onSubmit={handleSubmitImageEdit}
        projectFolderPath={activeProject.folderPath}
        submitting={submittingImageEdit}
      />
    </motion.section>
  );
}

function FieldGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </section>
  );
}

function RefImagePicker({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: string | null;
  onChange: (nextValue: string | null) => void;
}) {
  async function handleSelectImage() {
    if (disabled) {
      return;
    }

    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });

    if (selected && !Array.isArray(selected)) {
      onChange(selected);
    }
  }

  const previewUrl = value ? convertFileSrc(value) : null;
  const fileName = value?.split(/[\\/]/).pop() ?? "";

  return (
    <button
      className="hover-glow"
      onClick={() => void handleSelectImage()}
      style={{
        display: "grid",
        gap: 10,
        minWidth: 0,
        width: "100%",
        padding: 14,
        borderRadius: 16,
        border: `1px dashed ${disabled ? "var(--border-subtle)" : "var(--border-default)"}`,
        background: value ? "rgba(0, 0, 0, 0.03)" : "var(--bg-elevated)",
        color: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      type="button"
    >
      {previewUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <img
            alt="Referans gorsel"
            src={previewUrl}
            style={{
              flexShrink: 0,
              width: 56,
              height: 56,
              borderRadius: 10,
              objectFit: "cover",
              border: "1px solid var(--glass-border)",
            }}
          />
          <div style={{ display: "grid", gap: 4, minWidth: 0, flex: 1, textAlign: "left" }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={fileName}
            >
              {fileName}
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Img2img referansi olarak gonderilecek.
            </span>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              flexShrink: 0,
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              border: "1px solid var(--border-default)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
          <ImagePlus size={26} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {disabled
              ? "Secili model referans kare desteklemiyor."
              : "Gorsel sec. Secilen kare prompt ile birlikte fal.ai'ye gider."}
          </span>
        </div>
      )}
    </button>
  );
}

const textareaStyle: CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  resize: "vertical",
  outline: "none",
  font: "inherit",
  lineHeight: 1.7,
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

const stepperButtonStyle: CSSProperties = {
  display: "inline-flex",
  width: 36,
  height: 36,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 18,
  lineHeight: 1,
};
