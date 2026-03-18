import { useEffect, useState, type CSSProperties } from "react";
import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  initFal,
  type ImageModelId,
  type VideoModelId,
} from "@/services/fal.service";
import {
  getApiKey,
  getAppSetting,
  getAppSettings,
  setApiKey,
  setAppSetting,
  setAppSettings,
  type ApiKeyName,
} from "@/lib/store";
import { getTensorPixModels, type TensorPixModel } from "@/services/tensorpix.service";
import { useQueueStore } from "@/store/queue.store";

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
    description: "LLM tabanli prompt zinciri ve agent akislarinda kullanilir.",
  },
];

export function Settings() {
  const setParallelLimit = useQueueStore((state) => state.setParallelLimit);
  const [values, setValues] = useState<Record<ApiKeyName, string>>({
    FAL_API_KEY: "",
    TENSORPIX_API_KEY: "",
    OPENROUTER_API_KEY: "",
  });
  const [defaultImageModel, setDefaultImageModel] = useState<ImageModelId>("fal-ai/nano-banana-2");
  const [defaultVideoModel, setDefaultVideoModel] = useState<VideoModelId>("fal-ai/kling-video/v3/pro/image-to-video");
  const [defaultUpscaleFactor, setDefaultUpscaleFactor] = useState<2 | 4>(4);
  const [defaultTensorPixFilter, setDefaultTensorPixFilter] = useState("");
  const [tensorPixModels, setTensorPixModels] = useState<TensorPixModel[]>([]);
  const [queueParallelLimit, setQueueParallelLimit] = useState(3);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

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

    async function loadTensorPixModels() {
      try {
        const models = await getTensorPixModels();
        if (!cancelled) {
          setTensorPixModels(models);
        }
      } catch {
        if (!cancelled) {
          setTensorPixModels([]);
        }
      }
    }

    if (values.TENSORPIX_API_KEY.trim()) {
      void loadTensorPixModels();
    } else {
      setTensorPixModels([]);
    }

    return () => {
      cancelled = true;
    };
  }, [values.TENSORPIX_API_KEY]);

  async function handleSave() {
    setSaving(true);

    try {
      await Promise.all(
        API_KEYS.map(({ key }) => setApiKey(key, values[key].trim())),
      );
      await setAppSettings({
        defaultImageModel,
        defaultVideoModel,
        defaultUpscaleFactor,
        queueParallelLimit,
      });
      await setAppSetting("DEFAULT_TENSORPIX_FILTER", defaultTensorPixFilter);
      await initFal();
      setParallelLimit(queueParallelLimit);
      setSavedAt(Date.now());
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
      <section
        style={{
          display: "grid",
          gap: 18,
          maxWidth: 920,
        }}
      >
        <header
          style={{
            display: "grid",
            gap: 10,
            padding: 22,
            borderRadius: 26,
            border: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(140deg, rgba(245, 158, 11, 0.08), transparent 28%), var(--bg-surface)",
          }}
        >
          <span
            style={{
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
            }}
          >
            <ShieldCheck size={13} />
            Local Secret Storage
          </span>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
            Settings
          </div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            API anahtarlari Tauri Store uzerinden yerel olarak saklanir. fal.ai
            kaydi guncellendiginde istemci yeniden konfigure edilir.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 14,
            padding: 20,
            borderRadius: 24,
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
          }}
        >
          {API_KEYS.map(({ key, title, description }) => (
            <label
              key={key}
              style={{
                display: "grid",
                gap: 10,
                padding: 16,
                borderRadius: 18,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-elevated)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    display: "inline-flex",
                    width: 36,
                    height: 36,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 12,
                    border: "1px solid rgba(245, 158, 11, 0.22)",
                    background: "rgba(245, 158, 11, 0.08)",
                    color: "var(--accent)",
                  }}
                >
                  <KeyRound size={16} />
                </span>
                <div style={{ display: "grid", gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {description}
                  </span>
                </div>
              </div>
              <input
                autoComplete="off"
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                placeholder={`${title} anahtarini yapistir`}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-base)",
                  color: "var(--text-primary)",
                  outline: "none",
                  fontFamily: "monospace",
                  fontSize: 13,
                }}
                type="password"
                value={values[key]}
              />
            </label>
          ))}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingTop: 6,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {loading
                ? "Anahtarlar yukleniyor..."
                : savedAt
                  ? `Son kayit ${new Date(savedAt).toLocaleTimeString("tr-TR")}`
                  : "Heniz yeni kayit yapilmadi."}
            </div>

            <button
              className="btn-primary"
              disabled={loading || saving}
              onClick={() => void handleSave()}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              type="button"
            >
              <Save size={14} />
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gap: 14,
            padding: 20,
            borderRadius: 24,
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Runtime defaults</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Generator ve queue ekranlarinin varsayilan davranisini belirler.
            </div>
          </div>

          <label style={fieldStyle}>
            <span>Varsayilan image model</span>
            <select
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

          <label style={fieldStyle}>
            <span>Varsayilan video model</span>
            <select
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

          <label style={fieldStyle}>
            <span>Varsayilan upscale</span>
            <select
              onChange={(event) => setDefaultUpscaleFactor(Number(event.target.value) as 2 | 4)}
              style={selectStyle}
              value={defaultUpscaleFactor}
            >
              <option value={2}>2x upscale</option>
              <option value={4}>4K / 4x upscale</option>
            </select>
          </label>

          <label style={fieldStyle}>
            <span>Varsayilan TensorPix filtre/modeli</span>
            <select
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

          <label style={fieldStyle}>
            <span>Varsayilan paralel limit</span>
            <select
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
        </section>
      </section>
    </section>
  );
}

const fieldStyle = {
  display: "grid",
  gap: 8,
  fontSize: 12,
  color: "var(--text-secondary)",
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
} satisfies CSSProperties;
