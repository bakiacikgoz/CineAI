import { useEffect, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { message } from "@tauri-apps/plugin-dialog";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  initFal,
  testFalConnection,
  type ImageModelId,
  type VideoModelId,
} from "@/services/fal.service";
import { testElevenLabsConnection } from "@/services/elevenlabs.service";
import {
  getApiKey,
  getAppSetting,
  getAppSettings,
  persistQueueParallelLimit,
  setApiKey,
  setAppSetting,
  setAppSettings,
  type ApiKeyName,
} from "@/lib/store";
import {
  getTensorPixModels,
  testTensorPixConnection,
  type TensorPixModel,
} from "@/services/tensorpix.service";
import { testOpenRouterConnection } from "@/services/llm.service";
import { useQueueStore } from "@/store/queue.store";

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const API_KEYS: Array<{
  key: ApiKeyName;
  title: string;
  description: string;
}> = [
  {
    key: "FAL_API_KEY",
    title: "fal.ai",
    description: "Image Generator gercek istekleri bu anahtar ile gonderir.",
  },
  {
    key: "TENSORPIX_API_KEY",
    title: "TensorPix",
    description: "Upscale ve enhancement isleri icin saklanir.",
  },
  {
    key: "OPENROUTER_API_KEY",
    title: "OpenRouter",
    description: "LLM tabanli prompt zinciri, agent akislar ve dialogue speech optimizer burada calisir.",
  },
  {
    key: "ELEVENLABS_API_KEY",
    title: "ElevenLabs",
    description: "Profesyonel dialogue TTS ve timestamp uretileri burada calisir.",
  },
];

type ConnectionState = {
  status: "idle" | "testing" | "success" | "error";
  detail?: string;
};

const INITIAL_CONNECTION_STATE: Record<ApiKeyName, ConnectionState> = {
  FAL_API_KEY: { status: "idle" },
  TENSORPIX_API_KEY: { status: "idle" },
  OPENROUTER_API_KEY: { status: "idle" },
  ELEVENLABS_API_KEY: { status: "idle" },
};

/* ═══════════════════════════════════════════════════════════════
   Collapsible Section Component
   ═══════════════════════════════════════════════════════════════ */

function SettingsSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section style={sectionWrapStyle}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={sectionHeaderBtnStyle}
        type="button"
      >
        <span style={sectionTitleStyle}>{title}</span>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2 }}
          style={{ display: "inline-flex", color: "var(--text-muted)" }}
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "grid", gap: 14, paddingTop: 16 }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export function Settings() {
  const setParallelLimit = useQueueStore((state) => state.setParallelLimit);
  const [values, setValues] = useState<Record<ApiKeyName, string>>({
    FAL_API_KEY: "",
    TENSORPIX_API_KEY: "",
    OPENROUTER_API_KEY: "",
    ELEVENLABS_API_KEY: "",
  });
  const [defaultImageModel, setDefaultImageModel] = useState<ImageModelId>("fal-ai/nano-banana-2");
  const [defaultVideoModel, setDefaultVideoModel] = useState<VideoModelId>("fal-ai/kling-video/v3/pro/image-to-video");
  const [defaultUpscaleFactor, setDefaultUpscaleFactor] = useState<2 | 4>(4);
  const [elevenLabsEstimatedUsdPer1kChars, setElevenLabsEstimatedUsdPer1kChars] = useState("0.12");
  const [defaultTensorPixFilter, setDefaultTensorPixFilter] = useState("");
  const [tensorPixModels, setTensorPixModels] = useState<TensorPixModel[]>([]);
  const [queueParallelLimit, setQueueParallelLimit] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /* ── Visibility toggles for API key fields ── */
  const [visibleKeys, setVisibleKeys] = useState<Record<ApiKeyName, boolean>>({
    FAL_API_KEY: false,
    TENSORPIX_API_KEY: false,
    OPENROUTER_API_KEY: false,
    ELEVENLABS_API_KEY: false,
  });

  /* ── Saved indicator ── */
  const [showSavedCheck, setShowSavedCheck] = useState(false);
  const [connectionState, setConnectionState] =
    useState<Record<ApiKeyName, ConnectionState>>(INITIAL_CONNECTION_STATE);

  useEffect(() => {
    let cancelled = false;

    async function loadKeys() {
      setLoading(true);

      try {
        const [entries, appSettings, savedTensorPixFilter] = await Promise.all([
          Promise.all(
            API_KEYS.map(async ({ key }) => [key, (await getApiKey(key)) ?? ""] as const),
          ),
          getAppSettings(),
          getAppSetting<string>("DEFAULT_TENSORPIX_FILTER"),
        ]);

        if (!cancelled) {
          setValues(Object.fromEntries(entries) as Record<ApiKeyName, string>);
          setDefaultImageModel(appSettings.defaultImageModel as ImageModelId);
          setDefaultVideoModel(appSettings.defaultVideoModel as VideoModelId);
          setDefaultUpscaleFactor(appSettings.defaultUpscaleFactor);
          setElevenLabsEstimatedUsdPer1kChars(
            String(appSettings.elevenLabsEstimatedUsdPer1kChars),
          );
          setDefaultTensorPixFilter(savedTensorPixFilter ?? "");
          setQueueParallelLimit(appSettings.queueParallelLimit);
        }
      } catch (error) {
        console.error("Failed to load API keys", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadKeys();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tensorPixKey = values.TENSORPIX_API_KEY.trim();

    async function loadTensorPixModels() {
      try {
        const models = await getTensorPixModels(tensorPixKey);
        if (!cancelled) {
          setTensorPixModels(models);
        }
      } catch {
        if (!cancelled) {
          setTensorPixModels([]);
        }
      }
    }

    if (tensorPixKey) {
      const timer = setTimeout(() => {
        void loadTensorPixModels();
      }, 350);

      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    } else {
      setTensorPixModels([]);
    }

    return () => {
      cancelled = true;
    };
  }, [values.TENSORPIX_API_KEY]);

  async function handleTestConnection(key: ApiKeyName) {
    const apiKey = values[key].trim();

    if (!apiKey) {
      setConnectionState((current) => ({
        ...current,
        [key]: {
          status: "error",
          detail: "Test icin once bir API key gir.",
        },
      }));
      return;
    }

    setConnectionState((current) => ({
      ...current,
      [key]: {
        status: "testing",
        detail: "Baglanti kontrol ediliyor...",
      },
    }));

    try {
      const detail =
        key === "FAL_API_KEY"
          ? `${(await testFalConnection(apiKey)).aliasCount} endpoint alias okunabildi.`
          : key === "TENSORPIX_API_KEY"
            ? `${(await testTensorPixConnection(apiKey)).modelCount} TensorPix modeli listelendi.`
            : key === "OPENROUTER_API_KEY"
              ? `${(await testOpenRouterConnection(apiKey)).modelCount} OpenRouter modeli listelendi.`
              : `${(await testElevenLabsConnection(apiKey)).voiceCount} ElevenLabs voice listelendi.`;

      if (key === "TENSORPIX_API_KEY") {
        setTensorPixModels(await getTensorPixModels(apiKey));
      }

      setConnectionState((current) => ({
        ...current,
        [key]: {
          status: "success",
          detail,
        },
      }));
    } catch (error) {
      setConnectionState((current) => ({
        ...current,
        [key]: {
          status: "error",
          detail:
            error instanceof Error
              ? error.message
              : "Baglanti testi tamamlanamadi.",
        },
      }));
    }
  }

  async function handleSave() {
    setSaving(true);

    try {
      await Promise.all(
        API_KEYS.map(({ key }) => setApiKey(key, values[key].trim())),
      );
      const normalizedQueueLimit = await persistQueueParallelLimit(queueParallelLimit);
      await setAppSettings({
        defaultImageModel,
        defaultVideoModel,
        defaultUpscaleFactor,
        elevenLabsEstimatedUsdPer1kChars:
          Math.max(0, Number(elevenLabsEstimatedUsdPer1kChars)) || 0.12,
      });
      await setAppSetting("DEFAULT_TENSORPIX_FILTER", defaultTensorPixFilter);
      await initFal();
      setQueueParallelLimit(normalizedQueueLimit);
      setParallelLimit(normalizedQueueLimit);
      setSavedAt(Date.now());
      setShowSavedCheck(true);
      setTimeout(() => setShowSavedCheck(false), 2400);
      await message("Ayarlar kaydedildi.", {
        title: "Settings",
        kind: "info",
      });
    } catch (error) {
      console.error("Failed to save API keys", error);
      await message(
        error instanceof Error ? error.message : "Ayarlar kaydedilemedi.",
        {
          title: "Settings",
          kind: "error",
        },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="screen-shell">
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={containerStyle}
      >
        {/* ── Header Banner ─────────────────────────────── */}
        <header style={headerStyle}>
          <span style={badgeStyle}>
            <ShieldCheck size={13} />
            Local Secret Storage
          </span>
          <div style={headerTitleStyle}>Settings</div>
          <p style={headerDescStyle}>
            API anahtarlari Tauri Store uzerinden yerel olarak saklanir. fal.ai
            kaydi guncellendiginde istemci yeniden konfigure edilir.
          </p>
        </header>

        {/* ── API Keys Section ──────────────────────────── */}
        <SettingsSection title="API Keys" defaultOpen>
          {API_KEYS.map(({ key, title, description }) => {
            const isVisible = visibleKeys[key];
            const hasValue = values[key].trim().length > 0;
            const providerState = connectionState[key];

            return (
              <label
                key={key}
                style={apiKeyCardStyle}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={keyIconWrapStyle}>
                    <KeyRound size={16} />
                  </span>
                  <div style={{ display: "grid", gap: 3, flex: 1 }}>
                    <span style={keyTitleStyle}>
                      {title}
                      {hasValue && (
                        <span style={filledDotStyle} />
                      )}
                    </span>
                    <span style={keyDescStyle}>{description}</span>
                  </div>
                </div>
                <div style={inputWrapStyle}>
                  <input
                    autoComplete="off"
                    className="studio-field"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setValues((current) => ({ ...current, [key]: nextValue }));
                      setConnectionState((current) => ({
                        ...current,
                        [key]: { status: "idle" },
                      }));
                    }}
                    placeholder={`${title} anahtarini yapistir`}
                    style={apiKeyInputStyle}
                    type={isVisible ? "text" : "password"}
                    value={values[key]}
                  />
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setVisibleKeys((prev) => ({ ...prev, [key]: !prev[key] }));
                    }}
                    style={visibilityToggleBtnStyle}
                    title={isVisible ? "Gizle" : "Goster"}
                    type="button"
                  >
                    {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <div style={connectionRowStyle}>
                  <span style={connectionHintStyle(providerState.status)}>
                    {providerState.status === "idle"
                      ? "Heniz baglanti testi yapilmadi."
                      : providerState.detail}
                  </span>
                  <button
                    className="btn-secondary"
                    disabled={!hasValue || loading || providerState.status === "testing"}
                    onClick={(event) => {
                      event.preventDefault();
                      void handleTestConnection(key);
                    }}
                    style={connectionButtonStyle}
                    type="button"
                  >
                    {providerState.status === "testing" ? (
                      <LoaderCircle className="spin-slow" size={14} />
                    ) : providerState.status === "success" ? (
                      <Check size={14} />
                    ) : (
                      <ShieldCheck size={14} />
                    )}
                    {providerState.status === "testing"
                      ? "Test ediliyor..."
                      : "Baglantiyi test et"}
                  </button>
                </div>
              </label>
            );
          })}

          {/* ── Status + Save Button ── */}
          <div style={saveRowStyle}>
            <div style={statusTextStyle}>
              {loading
                ? "Anahtarlar yukleniyor..."
                : savedAt
                  ? `Son kayit ${new Date(savedAt).toLocaleTimeString("tr-TR")}`
                  : "Heniz yeni kayit yapilmadi."}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AnimatePresence>
                {showSavedCheck && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ duration: 0.3 }}
                    style={savedCheckStyle}
                  >
                    <Check size={14} />
                    Saved
                  </motion.span>
                )}
              </AnimatePresence>

              <button
                className="btn-primary"
                disabled={loading || saving}
                onClick={() => void handleSave()}
                style={saveBtnStyle}
                type="button"
              >
                {saving ? (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    style={{ display: "inline-flex" }}
                  >
                    <LoaderCircle size={14} />
                  </motion.span>
                ) : (
                  <Save size={14} />
                )}
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </div>
          </div>
        </SettingsSection>

        {/* ── Runtime Defaults Section ──────────────────── */}
        <SettingsSection title="Runtime Defaults" defaultOpen>
          <div style={sectionIntroStyle}>
            Generator ve queue ekranlarinin varsayilan davranisini belirler.
          </div>

          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>Varsayilan Image Model</span>
            <select
              className="studio-field"
              onChange={(event) => setDefaultImageModel(event.target.value as ImageModelId)}
              style={selectStyle}
              value={defaultImageModel}
            >
              {(Object.entries(IMAGE_MODELS) as [ImageModelId, (typeof IMAGE_MODELS)[ImageModelId]][]).map(
                ([modelId, model]) => (
                  <option key={modelId} value={modelId}>
                    {model.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>Varsayilan Video Model</span>
            <select
              className="studio-field"
              onChange={(event) => setDefaultVideoModel(event.target.value as VideoModelId)}
              style={selectStyle}
              value={defaultVideoModel}
            >
              {(Object.entries(VIDEO_MODELS) as [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]][]).map(
                ([modelId, model]) => (
                  <option key={modelId} value={modelId}>
                    {model.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>Varsayilan Upscale</span>
            <select
              className="studio-field"
              onChange={(event) => setDefaultUpscaleFactor(Number(event.target.value) as 2 | 4)}
              style={selectStyle}
              value={defaultUpscaleFactor}
            >
              <option value={2}>2x upscale</option>
              <option value={4}>4K / 4x upscale</option>
            </select>
          </label>

          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>Varsayilan TensorPix Filtre/Modeli</span>
            <select
              className="studio-field"
              onChange={(event) => setDefaultTensorPixFilter(event.target.value)}
              style={selectStyle}
              value={defaultTensorPixFilter}
            >
              <option value="">Automatic selection</option>
              {tensorPixModels.map((model) => (
                <option key={model.id} value={String(model.id)}>
                  {model.name} ({model.upscaleFactor}x)
                </option>
              ))}
            </select>
          </label>

          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>Varsayilan Paralel Limit</span>
            <select
              className="studio-field"
              onChange={(event) => setQueueParallelLimit(Number(event.target.value))}
              style={selectStyle}
              value={queueParallelLimit}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>ElevenLabs Tahmini USD / 1K karakter</span>
            <input
              className="studio-field"
              inputMode="decimal"
              onChange={(event) => setElevenLabsEstimatedUsdPer1kChars(event.target.value)}
              placeholder="0.12"
              style={textInputStyle}
              type="text"
              value={elevenLabsEstimatedUsdPer1kChars}
            />
          </label>

          <div style={infoCardStyle}>
            <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>
              Dialogue TTS sabitleri
            </strong>
            <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.7 }}>
              Dialogue pipeline ElevenLabs `eleven_v3` modeliyle once `wav_44100` dener;
              plan izin vermiyorsa otomatik `mp3_44100_128` fallback kullanir. Buradaki USD
              alani dashboard tahmini icindir; faturalama kaynagi degildir.
            </span>
          </div>
        </SettingsSection>
      </motion.section>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Styles
   ═══════════════════════════════════════════════════════════════ */

const containerStyle = {
  display: "grid",
  gap: 18,
  maxWidth: 920,
} satisfies CSSProperties;

/* ── Header ──────────────────────────────────────────────── */

const headerStyle = {
  display: "grid",
  gap: 10,
  padding: 22,
  borderRadius: 26,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(140deg, rgba(0, 0, 0, 0.03), transparent 28%), var(--bg-surface)",
} satisfies CSSProperties;

const badgeStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  border: "1px solid rgba(34, 197, 94, 0.18)",
  background: "rgba(34, 197, 94, 0.08)",
  padding: "6px 10px",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--status-success)",
} satisfies CSSProperties;

const headerTitleStyle = {
  fontSize: 28,
  fontWeight: 600,
  letterSpacing: "-0.03em",
} satisfies CSSProperties;

const headerDescStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies CSSProperties;

/* ── Collapsible Section ────────────────────────────────── */

const sectionWrapStyle = {
  padding: "20px 22px",
  borderRadius: 24,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies CSSProperties;

const sectionHeaderBtnStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  padding: 0,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-secondary)",
} satisfies CSSProperties;

const sectionTitleStyle = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
} satisfies CSSProperties;

const sectionIntroStyle = {
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
} satisfies CSSProperties;

/* ── API Key Cards ──────────────────────────────────────── */

const apiKeyCardStyle = {
  display: "grid",
  gap: 10,
  padding: 16,
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies CSSProperties;

const keyIconWrapStyle = {
  display: "inline-flex",
  width: 36,
  height: 36,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 12,
  border: "1px solid rgba(0, 0, 0, 0.1)",
  background: "rgba(0, 0, 0, 0.04)",
  color: "var(--text-primary)",
  flexShrink: 0,
} satisfies CSSProperties;

const keyTitleStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 15,
  fontWeight: 600,
} satisfies CSSProperties;

const keyDescStyle = {
  fontSize: 12,
  color: "var(--text-secondary)",
} satisfies CSSProperties;

const filledDotStyle = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--status-success)",
} satisfies CSSProperties;

/* ── Input with visibility toggle ────────────────────────── */

const inputWrapStyle = {
  position: "relative",
  display: "flex",
  alignItems: "center",
} satisfies CSSProperties;

const connectionRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
} satisfies CSSProperties;

const apiKeyInputStyle = {
  width: "100%",
  padding: "12px 44px 12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  outline: "none",
  fontFamily: "monospace",
  fontSize: 13,
} satisfies CSSProperties;

const visibilityToggleBtnStyle = {
  position: "absolute",
  right: 8,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: 10,
  border: "none",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "color 150ms ease, background 150ms ease",
} satisfies CSSProperties;

const connectionButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  paddingInline: 14,
  flexShrink: 0,
} satisfies CSSProperties;

function connectionHintStyle(status: ConnectionState["status"]): CSSProperties {
  return {
    fontSize: 12,
    lineHeight: 1.6,
    color:
      status === "success"
        ? "var(--status-success)"
        : status === "error"
          ? "var(--status-danger)"
          : "var(--text-muted)",
  };
}

/* ── Save Row ────────────────────────────────────────────── */

const saveRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  paddingTop: 6,
} satisfies CSSProperties;

const statusTextStyle = {
  fontSize: 12,
  color: "var(--text-muted)",
} satisfies CSSProperties;

const saveBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
} satisfies CSSProperties;

const savedCheckStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--status-success)",
  letterSpacing: "0.02em",
} satisfies CSSProperties;

/* ── Field Labels & Selects ──────────────────────────────── */

const fieldWrapStyle = {
  display: "grid",
  gap: 8,
} satisfies CSSProperties;

const fieldLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
} satisfies CSSProperties;

const selectStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 13,
  cursor: "pointer",
} satisfies CSSProperties;

const textInputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 13,
} satisfies CSSProperties;

const infoCardStyle = {
  display: "grid",
  gap: 6,
  padding: "14px 16px",
  borderRadius: 18,
  border: "1px solid rgba(59, 130, 246, 0.18)",
  background: "rgba(59, 130, 246, 0.06)",
} satisfies CSSProperties;
