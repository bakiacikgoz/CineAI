import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ImagePlus, Layers3, SlidersHorizontal, Sparkles, WandSparkles, X } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { message, open } from "@tauri-apps/plugin-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveImageGeneratorDefaults } from "@/lib/generator-defaults";
import { IMAGE_MODELS, calcImageCost, type ImageModelId } from "@/services/fal.service";
import { getAppSettings } from "@/lib/store";
import { enqueueImageJobs } from "@/services/jobqueue.service";
import { getDefaultModelPreset, getModelPreset } from "@/services/model-preset.service";
import { GeneratedImageGallery } from "@/screens/image-generator/GeneratedImageGallery";
import { useProjectStore } from "@/store/project.store";
import { motion } from "framer-motion";

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:2"] as const;

type ImageGeneratorLocationState = {
  promptTemplateContent?: string;
  promptTemplateName?: string;
  promptTemplateModel?: string;
  modelPresetId?: string;
  referenceAssetPath?: string;
};

export function ImageGenerator() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const location = useLocation();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<ImageModelId>("fal-ai/nano-banana-2");
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>("16:9");
  const [cfg, setCfg] = useState(7);
  const [steps, setSteps] = useState(28);
  const [quantity, setQuantity] = useState(4);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [inboundNotice, setInboundNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!IMAGE_MODELS[model].supportsImg2Img) {
      setRefImage(null);
    }
  }, [model]);

  useEffect(() => {
    const state = location.state as ImageGeneratorLocationState | null;
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
            ? `Template applied: ${inboundState.promptTemplateName}`
            : "Prompt template applied",
        );
      }

      if (inboundState?.referenceAssetPath) {
        setRefImage(inboundState.referenceAssetPath);
        notices.push("Reference frame attached");
      }

      if (inboundState?.modelPresetId && !cancelled && inboundPreset) {
        notices.push(`Preset loaded: ${inboundPreset.name}`);
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
  }, [location.pathname, location.state, navigate]);

  const estimatedCost = calcImageCost(model, quantity);

  async function handleGenerate() {
    if (!prompt.trim() || !activeProject) {
      return;
    }

    setGenerating(true);

    try {
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
              "radial-gradient(circle at top, rgba(245, 158, 11, 0.14), transparent 38%), var(--bg-surface)",
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
            <div style={{ fontSize: 24, fontWeight: 600 }}>Image Generator hazir</div>
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
          gridTemplateColumns: "340px minmax(0, 1fr)",
          gap: 22,
          minHeight: "calc(100vh - var(--topbar-h) - 112px)",
        }}
      >
        <aside
          style={{
            display: "grid",
            alignContent: "start",
            gap: 16,
            padding: 18,
            borderRadius: 24,
            border: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(180deg, rgba(245, 158, 11, 0.08), transparent 26%), var(--bg-surface)",
            boxShadow: "0 30px 90px rgba(0, 0, 0, 0.26)",
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
                border: "1px solid rgba(245, 158, 11, 0.24)",
                background: "rgba(245, 158, 11, 0.1)",
                padding: "6px 10px",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              <Sparkles size={13} />
              Still Image Lab
            </span>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Gorsel Uret
            </div>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Promptu, model secimini ve referans kareyi ayarla. Isler kuyruga
              duser, galeri tarafinda ilerleme aninda gorunur.
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
          </div>

          <FieldGroup label="Prompt" icon={<WandSparkles size={14} />}>
            <textarea
              className="studio-field"
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Sahneyi, lens dilini, isik ve atmosferi tarif et..."
              rows={7}
              style={textareaStyle}
              value={prompt}
            />
          </FieldGroup>

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
                        active ? "rgba(245, 158, 11, 0.34)" : "var(--border-subtle)"
                      }`,
                      background: active ? "rgba(245, 158, 11, 0.08)" : "var(--bg-elevated)",
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
                        {info.costPerImage > 0 ? `$${info.costPerImage.toFixed(2)}` : "Custom"}
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
                        active ? "rgba(245, 158, 11, 0.34)" : "var(--border-default)"
                      }`,
                      background: active ? "var(--accent)" : "var(--bg-elevated)",
                      color: active ? "#140b00" : "var(--text-secondary)",
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

          <FieldGroup label={`CFG ${cfg.toFixed(1)}`}>
            <input
              max={20}
              min={1}
              onChange={(event) => setCfg(Number(event.target.value))}
              step={0.5}
              style={{ width: "100%", accentColor: "var(--accent)" }}
              type="range"
              value={cfg}
            />
          </FieldGroup>

          <FieldGroup label={`Adim ${steps}`}>
            <input
              max={50}
              min={20}
              onChange={(event) => setSteps(Number(event.target.value))}
              step={1}
              style={{ width: "100%", accentColor: "var(--accent)" }}
              type="range"
              value={steps}
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

          <FieldGroup label="Referans Kare">
            <RefImagePicker
              disabled={!IMAGE_MODELS[model].supportsImg2Img}
              value={refImage}
              onChange={setRefImage}
            />
          </FieldGroup>

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

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>Tahmini maliyet</span>
              <strong style={{ color: "var(--accent)", fontSize: 15 }}>
                ${estimatedCost.toFixed(3)}
              </strong>
            </div>

            <button
              className="btn-primary"
              disabled={!prompt.trim() || generating}
              onClick={() => void handleGenerate()}
              style={{ width: "100%", padding: "12px 16px" }}
              type="button"
            >
              {generating ? "Kuyruga aliniyor..." : `Uret (${quantity} gorsel)`}
            </button>
          </div>
        </aside>

        <GeneratedImageGallery projectFolderPath={activeProject.folderPath} />
      </section>
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
    <section style={{ display: "grid", gap: 8 }}>
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
        width: "100%",
        padding: 14,
        borderRadius: 16,
        border: `1px dashed ${disabled ? "var(--border-subtle)" : "var(--border-default)"}`,
        background: value ? "rgba(245, 158, 11, 0.08)" : "var(--bg-elevated)",
        color: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      type="button"
    >
      {previewUrl ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            alt="Ref image"
            src={previewUrl}
            style={{
              width: 56,
              height: 56,
              borderRadius: 10,
              objectFit: "cover",
              border: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          />
          <div style={{ display: "grid", gap: 4, textAlign: "left" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{fileName}</span>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Img2img referansi olarak gonderilecek.
            </span>
          </div>
          <span
            onClick={(event) => {
              event.stopPropagation();
              onChange(null);
            }}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              border: "1px solid var(--border-default)",
              background: "var(--bg-surface)",
            }}
          >
            <X size={14} />
          </span>
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
