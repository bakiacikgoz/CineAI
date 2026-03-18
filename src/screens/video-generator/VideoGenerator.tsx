import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Sparkles,
  Video as VideoIcon,
} from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import { getAppSetting } from "@/lib/store";
import {
  analyzeKlingVideoPrompt,
  clampKlingDuration,
  isKlingDuration,
  KLING_V3_DURATION_VALUES,
  VIDEO_MODELS,
  type KlingDuration,
  type KlingShotType,
  type VideoAspectRatio,
  type VideoModelId,
} from "@/services/fal.service";
import { getAssets, type AssetWithTags } from "@/services/asset.service";
import { getShots, type ShotRow } from "@/services/import.service";
import { enqueueVideoJobs } from "@/services/jobqueue.service";
import { getModelPreset } from "@/services/model-preset.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";

type GeneratorMode = "shot-linked" | "freeform";

type VideoAsset = AssetWithTags & {
  absolutePath: string;
  assetUrl: string;
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

export function VideoGenerator() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const location = useLocation();
  const navigate = useNavigate();
  const queueJobs = useQueueStore((state) => state.jobs);
  const [mode, setMode] = useState<GeneratorMode>("shot-linked");
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [imageAssets, setImageAssets] = useState<VideoAsset[]>([]);
  const [videoAssets, setVideoAssets] = useState<VideoAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShotId, setSelectedShotId] = useState<string>("");
  const [startAssetId, setStartAssetId] = useState<string>("");
  const [endAssetId, setEndAssetId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<VideoModelId>("fal-ai/kling-video/v3/pro/image-to-video");
  const [duration, setDuration] = useState<KlingDuration>(5);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [cfg, setCfg] = useState(0.45);
  const [generateAudio, setGenerateAudio] = useState(false);
  const [shotType, setShotType] = useState<KlingShotType>("customize");
  const [generating, setGenerating] = useState(false);
  const [inboundNotice, setInboundNotice] = useState<string | null>(null);
  const promptAnalysis = useMemo(() => analyzeKlingVideoPrompt(prompt), [prompt]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateDefaults() {
      const saved = await getAppSetting("DEFAULT_VIDEO_MODEL");

      if (!cancelled && saved && saved in VIDEO_MODELS) {
        setModel(saved as VideoModelId);
      }
    }

    void hydrateDefaults();

    return () => {
      cancelled = true;
    };
  }, []);

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

          if (!selectedShotId && mainShots[0]) {
            setSelectedShotId(mainShots[0].id);
          }
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
  }, [activeProject, selectedShotId]);

  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? null;

  useEffect(() => {
    if (!selectedShot) {
      return;
    }

    setPrompt(selectedShot.promptVideo ?? "");
    setDuration(clampKlingDuration(selectedShot.durationS));
    setGenerateAudio(analyzeKlingVideoPrompt(selectedShot.promptVideo ?? "").hasAudioDirection);
    setEndAssetId("");
  }, [selectedShot?.id]);

  useEffect(() => {
    const state = location.state as VideoGeneratorLocationState | null;

    if (!state) {
      return;
    }

    const inboundState = state;
    let cancelled = false;

    async function applyInboundState() {
      const notices: string[] = [];

      if (inboundState.promptTemplateContent) {
        setPrompt(inboundState.promptTemplateContent);
        notices.push(
          inboundState.promptTemplateName
            ? `Template applied: ${inboundState.promptTemplateName}`
            : "Prompt template applied",
        );
      }

      if (inboundState.promptTemplateModel && inboundState.promptTemplateModel in VIDEO_MODELS) {
        setModel(inboundState.promptTemplateModel as VideoModelId);
      }

      if (inboundState.startAssetId) {
        setMode("freeform");
        setStartAssetId(inboundState.startAssetId);
        notices.push("START asset linked");
      }

      if (inboundState.endAssetId) {
        setMode("freeform");
        setEndAssetId(inboundState.endAssetId);
        notices.push("END asset linked");
      }

      if (inboundState.shotId) {
        setMode("shot-linked");
        setSelectedShotId(inboundState.shotId);
        notices.push("Storyboard shot focused");
      }

      if (inboundState.modelPresetId) {
        const preset = await getModelPreset(inboundState.modelPresetId);

        if (!cancelled && preset) {
          if (preset.videoModel && preset.videoModel in VIDEO_MODELS) {
            setModel(preset.videoModel as VideoModelId);
          }

          if (preset.videoParams) {
            try {
              const parsed = JSON.parse(preset.videoParams) as {
                duration?: number;
                cfg?: number;
                aspectRatio?: VideoAspectRatio;
                generateAudio?: boolean;
                shotType?: KlingShotType;
              };

              if (typeof parsed.duration === "number" && isKlingDuration(parsed.duration)) {
                setDuration(parsed.duration);
              }

              if (typeof parsed.cfg === "number") {
                setCfg(parsed.cfg);
              }

              if (
                parsed.aspectRatio === "16:9" ||
                parsed.aspectRatio === "9:16" ||
                parsed.aspectRatio === "1:1"
              ) {
                setAspectRatio(parsed.aspectRatio);
              }

              if (typeof parsed.generateAudio === "boolean") {
                setGenerateAudio(parsed.generateAudio);
              }

              if (
                parsed.shotType === "customize" ||
                parsed.shotType === "intelligent"
              ) {
                setShotType(parsed.shotType);
              }
            } catch {
              // Preset JSON is validated on write; ignore stale malformed rows.
            }
          }

          notices.push(`Preset loaded: ${preset.name}`);
        }
      }

      if (!cancelled) {
        setInboundNotice(notices.length > 0 ? notices.join(" • ") : null);
        navigate(location.pathname, { replace: true, state: null });
      }
    }

    void applyInboundState();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.state, navigate]);

  const shotStartAsset = useMemo(
    () =>
      selectedShot?.imageStartPath
        ? imageAssets.find((asset) => asset.file_path === selectedShot.imageStartPath) ?? null
        : null,
    [imageAssets, selectedShot],
  );

  const shotEndAsset = useMemo(
    () =>
      selectedShot?.imageEndPath
        ? imageAssets.find((asset) => asset.file_path === selectedShot.imageEndPath) ?? null
        : null,
    [imageAssets, selectedShot],
  );

  const selectedStartAsset = imageAssets.find((asset) => asset.id === startAssetId) ?? null;
  const selectedEndAsset = imageAssets.find((asset) => asset.id === endAssetId) ?? null;

  const activeJobs = queueJobs.filter(
    (job) =>
      job.projectId === activeProject?.id &&
      (job.type === "video" || job.type === "upscale") &&
      (job.status === "queued" || job.status === "active"),
  );

  async function handleGenerate() {
    if (!activeProject || !prompt.trim()) {
      return;
    }

    const startPath =
      mode === "shot-linked"
        ? shotStartAsset?.absolutePath
        : selectedStartAsset?.absolutePath;
    const endPath =
      mode === "shot-linked"
        ? shotEndAsset?.absolutePath
        : selectedEndAsset?.absolutePath;

    if (!startPath) {
      await message("Video uretimi icin bir START gorseli secilmeli.", {
        title: "Video Generator",
        kind: "warning",
      });
      return;
    }

    setGenerating(true);

    try {
      await enqueueVideoJobs({
        model,
        prompt: prompt.trim(),
        imageStartPath: startPath,
        imageEndPath: endPath ?? undefined,
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
              Shot-linked mod storyboard karelerini, freeform mod ise asset library
              referanslarini kullanir.
            </p>
            {inboundNotice ? (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid rgba(245, 158, 11, 0.22)",
                  background: "rgba(245, 158, 11, 0.08)",
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
                ["shot-linked", "Shot-linked"],
                ["freeform", "Freeform"],
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
          ) : (
            <>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>START asset</span>
                <select
                  onChange={(event) => setStartAssetId(event.target.value)}
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
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>END asset (opsiyonel)</span>
                <select
                  onChange={(event) => setEndAssetId(event.target.value)}
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
              </label>
            </>
          )}

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Prompt</span>
            <textarea
              onChange={(event) => setPrompt(event.target.value)}
              rows={8}
              style={textareaStyle}
              value={prompt}
            />
          </label>

          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Model</span>
            <select
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

          <div style={{ display: "grid", gap: 10 }}>
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

            <div style={{ display: "grid", gap: 6 }}>
              <span style={fieldLabelStyle}>Aspect ratio</span>
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

            <label style={fieldStyle}>
              <span style={fieldLabelStyle}>CFG {cfg.toFixed(2)}</span>
              <input
                max={1}
                min={0.1}
                onChange={(event) => setCfg(Number(event.target.value))}
                step={0.05}
                style={{ width: "100%", accentColor: "var(--accent)" }}
                type="range"
                value={cfg}
              />
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 16,
                border: "1px solid var(--border-subtle)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <span style={fieldLabelStyle}>Native audio</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Audio direction bulunan promptlarda Kling ses uretimini acabilirsin.
                </span>
              </div>
              <input
                checked={generateAudio}
                onChange={(event) => setGenerateAudio(event.target.checked)}
                style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
                type="checkbox"
              />
            </label>

            {promptAnalysis.detectedMultiShot ? (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 16,
                  border: "1px solid rgba(245, 158, 11, 0.2)",
                  background: "rgba(245, 158, 11, 0.08)",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <span style={fieldLabelStyle}>Multi-shot algilandi</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    Prompt icinde {promptAnalysis.shotCount} alt shot bulundu. Istek
                    `multi_prompt` + `shot_type` ile gonderilecek.
                  </span>
                </div>
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

          <button
            className="btn-primary"
            disabled={!prompt.trim() || generating || loading}
            onClick={() => void handleGenerate()}
            style={{ width: "100%" }}
            type="button"
          >
            <Film size={15} />
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
                endAsset={mode === "shot-linked" ? shotEndAsset : selectedEndAsset}
                startAsset={mode === "shot-linked" ? shotStartAsset : selectedStartAsset}
              />
              <VideoGallery assets={videoAssets} />
            </div>
          )}
        </section>
      </section>
    </section>
  );
}

function SourcePreviewSection({
  startAsset,
  endAsset,
}: {
  startAsset: VideoAsset | null;
  endAsset: VideoAsset | null;
}) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Source frames
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        <PreviewCard asset={startAsset} label="START" />
        <PreviewCard asset={endAsset} label="END" />
      </div>
    </section>
  );
}

function PreviewCard({ asset, label }: { asset: VideoAsset | null; label: string }) {
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
      {asset ? (
        <>
          <img
            alt={asset.filename}
            src={asset.assetUrl}
            style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", borderRadius: 14 }}
          />
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{asset.filename}</div>
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
        </div>
      )}
    </article>
  );
}

function VideoGallery({ assets }: { assets: VideoAsset[] }) {
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
    <section style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Kayitli videolar ({assets.length})
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        {assets.map((asset) => (
          <article
            key={asset.id}
            style={{
              display: "grid",
              gap: 12,
              padding: 14,
              borderRadius: 18,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-elevated)",
            }}
          >
            <video
              controls
              preload="metadata"
              src={asset.assetUrl}
              style={{ width: "100%", aspectRatio: "16 / 10", borderRadius: 14, background: "#000" }}
            />
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{asset.filename}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {(asset.model_used ?? "unknown").split("/").pop()} / {asset.resolution ?? "HD"}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
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
    "linear-gradient(180deg, rgba(245, 158, 11, 0.06), transparent 22%), var(--bg-surface)",
  boxShadow: "0 30px 90px rgba(0, 0, 0, 0.24)",
};

const eyebrowStyle: CSSProperties = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  border: "1px solid rgba(245, 158, 11, 0.24)",
  background: "rgba(245, 158, 11, 0.1)",
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
