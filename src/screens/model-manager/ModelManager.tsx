import { useEffect, useMemo, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { Bot, Copy, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { Portal } from "@/components/Portal";
import { ModalShell, ProEmptyState } from "@/components/ui";
import { useNavigate } from "react-router-dom";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/services/fal.service";
import {
  createModelPreset,
  deleteModelPreset,
  duplicateModelPreset,
  getModelPresetSummary,
  listModelPresets,
  updateModelPreset,
  type ModelPresetRecord,
} from "@/services/model-preset.service";
import { useProjectStore } from "@/store/project.store";

type PresetEditorState = {
  id: string | null;
  name: string;
  imageModel: string;
  videoModel: string;
  imageParams: string;
  videoParams: string;
  isDefault: boolean;
};

const EMPTY_EDITOR: PresetEditorState = {
  id: null,
  name: "",
  imageModel: "",
  videoModel: "",
  imageParams: "{\n  \"cfg\": 7,\n  \"steps\": 28,\n  \"aspectRatio\": \"16:9\"\n}",
  videoParams:
    "{\n  \"duration\": 8,\n  \"cfg\": 0.45,\n  \"aspectRatio\": \"16:9\",\n  \"generateAudio\": false,\n  \"shotType\": \"customize\"\n}",
  isDefault: false,
};

export function ModelManager() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const navigate = useNavigate();
  const [presets, setPresets] = useState<ModelPresetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState<"all" | "image" | "video" | "default">("all");
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<PresetEditorState>(EMPTY_EDITOR);
  const [stats, setStats] = useState({
    total: 0,
    defaults: 0,
    imageCapable: 0,
    videoCapable: 0,
  });

  const filteredPresets = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return presets.filter((preset) => {
      const matchesSearch =
        needle.length === 0 ||
        preset.name.toLowerCase().includes(needle) ||
        preset.imageModel?.toLowerCase().includes(needle) ||
        preset.videoModel?.toLowerCase().includes(needle);

      const matchesCapability =
        capabilityFilter === "all" ||
        (capabilityFilter === "image" && Boolean(preset.imageModel)) ||
        (capabilityFilter === "video" && Boolean(preset.videoModel)) ||
        (capabilityFilter === "default" && preset.isDefault);

      return matchesSearch && matchesCapability;
    });
  }, [capabilityFilter, presets, search]);

  useEffect(() => {
    if (!activeProject) {
      setPresets([]);
      setStats({
        total: 0,
        defaults: 0,
        imageCapable: 0,
        videoCapable: 0,
      });
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadPresets() {
      setLoading(true);
      setError(null);

      try {
        const [nextPresets, summary] = await Promise.all([
          listModelPresets(),
          getModelPresetSummary(),
        ]);
        if (!cancelled) {
          setPresets(nextPresets);
          setStats({
            total: summary.total,
            defaults: summary.defaultCount,
            imageCapable: summary.imageCapable,
            videoCapable: summary.videoCapable,
          });
        }
      } catch (error) {
        console.error("Failed to load model presets", error);
        if (!cancelled) {
          setError(error instanceof Error ? error.message : "Model presetleri yuklenemedi.");
          await message(error instanceof Error ? error.message : "Model presetleri yuklenemedi.", {
            title: "Model Yonetici",
            kind: "error",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPresets();

    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  async function refreshPresets() {
    const [nextPresets, summary] = await Promise.all([
      listModelPresets(),
      getModelPresetSummary(),
    ]);
    setPresets(nextPresets);
    setStats({
      total: summary.total,
      defaults: summary.defaultCount,
      imageCapable: summary.imageCapable,
      videoCapable: summary.videoCapable,
    });
    setError(null);
  }

  function openCreateEditor() {
    setEditor(EMPTY_EDITOR);
    setShowEditor(true);
  }

  function openEditEditor(preset: ModelPresetRecord) {
    setEditor({
      id: preset.id,
      name: preset.name,
      imageModel: preset.imageModel ?? "",
      videoModel: preset.videoModel ?? "",
      imageParams: preset.imageParams ?? "",
      videoParams: preset.videoParams ?? "",
      isDefault: preset.isDefault,
    });
    setShowEditor(true);
  }

  async function handleSave() {
    if (!editor.name.trim()) {
      await message("Preset adi zorunludur.", {
        title: "Model Yonetici",
        kind: "warning",
      });
      return;
    }

    setSaving(true);

    try {
      if (editor.id) {
        await updateModelPreset(editor.id, editor);
      } else {
        await createModelPreset(editor);
      }

      await refreshPresets();
      setShowEditor(false);
      setEditor(EMPTY_EDITOR);
    } catch (error) {
      console.error("Failed to save model preset", error);
      await message(error instanceof Error ? error.message : "Preset kaydedilemedi.", {
        title: "Model Yonetici",
        kind: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(presetId: string) {
    try {
      await duplicateModelPreset(presetId);
      await refreshPresets();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Preset cogaltilamadi.", {
        title: "Model Yonetici",
        kind: "error",
      });
    }
  }

  async function handleDelete(presetId: string) {
    const accepted = await confirm("Bu model preset silinecek. Devam edilsin mi?", {
      title: "Preset sil",
      kind: "warning",
      okLabel: "Sil",
      cancelLabel: "Vazgec",
    });

    if (!accepted) {
      return;
    }

    try {
      await deleteModelPreset(presetId);
      await refreshPresets();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Preset silinemedi.", {
        title: "Model Yonetici",
        kind: "error",
      });
    }
  }

  function applyPreset(preset: ModelPresetRecord, target: "image" | "video") {
    navigate(target === "image" ? "/image-generator" : "/video-generator", {
      state: {
        modelPresetId: preset.id,
      },
    });
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <ProEmptyState icon={Bot} title="Model Yonetici" description="Preset yonetimi icin once bir proje ac." />
      </section>
    );
  }

  return (
    <section className="screen-shell">
      <section style={{ display: "grid", gap: 18 }}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <Bot size={13} />
              Model Yonetici
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Model Yonetici
            </div>
            <p style={copyStyle}>
              Image ve video uretim ayarlarini preset haline getir. Presetler generator
              ekranlarina tek tikla uygulanir ve bulk override akislari icin temel olur.
            </p>
          </div>

          <button className="btn-primary" onClick={openCreateEditor} type="button">
            <Plus size={15} />
            Yeni Preset
          </button>
        </header>

        <section style={metricsGridStyle}>
          <MetricCard label="Toplam preset" value={String(stats.total)} />
          <MetricCard label="Varsayilan" value={String(stats.defaults)} />
          <MetricCard label="Gorsel hazir" value={String(stats.imageCapable)} />
          <MetricCard label="Video hazir" value={String(stats.videoCapable)} />
        </section>

        <section style={toolbarStyle}>
          <label style={searchFieldStyle}>
            <Search size={15} style={{ color: "var(--text-muted)" }} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Preset veya model ara"
              style={filterInputStyle}
              value={search}
            />
          </label>

          <select
            onChange={(event) => setCapabilityFilter(event.target.value as typeof capabilityFilter)}
            style={selectStyle}
            value={capabilityFilter}
          >
            <option value="all">Tum presetler</option>
            <option value="image">Gorsel modeli olanlar</option>
            <option value="video">Video modeli olanlar</option>
            <option value="default">Varsayilan presetler</option>
          </select>
        </section>

        {loading ? (
          <SimpleState title="Yukleniyor..." copy="Model presetleri okunuyor." />
        ) : error ? (
          <SimpleState title="Yuklenemedi" copy={error} />
        ) : filteredPresets.length === 0 ? (
          <ProEmptyState
            icon={Bot}
            title={presets.length === 0 ? "Preset yok" : "Sonuc bulunamadi"}
            description={
              presets.length === 0
                ? "Yeni bir model preset olusturun."
                : "Arama ve filtrelere uyan model preset bulunamadi."
            }
          />
        ) : (
          <div style={presetGridStyle}>
            {filteredPresets.map((preset) => (
              <article key={preset.id} style={presetCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 18 }}>{preset.name}</strong>
                      {preset.isDefault ? <span style={defaultTagStyle}>Varsayilan</span> : null}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {preset.imageModel ? <span style={tagStyle}>{preset.imageModel}</span> : null}
                      {preset.videoModel ? <span style={mutedTagStyle}>{preset.videoModel}</span> : null}
                    </div>
                  </div>

                  <button className="icon-button" onClick={() => openEditEditor(preset)} type="button">
                    <Pencil size={15} />
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <JsonPreview title="Gorsel parametreleri" value={preset.imageParams} />
                  <JsonPreview title="Video parametreleri" value={preset.videoParams} />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-secondary" onClick={() => applyPreset(preset, "image")} type="button">
                    <Sparkles size={14} />
                    Gorsele Uygula
                  </button>
                  <button className="btn-secondary" onClick={() => applyPreset(preset, "video")} type="button">
                    <Bot size={14} />
                    Videoya Uygula
                  </button>
                  <button className="btn-secondary" onClick={() => void handleDuplicate(preset.id)} type="button">
                    <Copy size={14} />
                    Kopyala
                  </button>
                  <button className="btn-secondary" onClick={() => void handleDelete(preset.id)} type="button">
                    <Trash2 size={14} />
                    Sil
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showEditor ? (
        <Portal>
          <PresetEditorModal
            editor={editor}
            onChange={setEditor}
            onClose={() => {
              if (!saving) {
                setShowEditor(false);
              }
            }}
            onSave={() => void handleSave()}
            saving={saving}
          />
        </Portal>
      ) : null}
    </section>
  );
}

function PresetEditorModal({
  editor,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  editor: PresetEditorState;
  onChange: (value: PresetEditorState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const footerButtons = (
    <>
      <button className="btn-secondary" disabled={saving} onClick={onClose} type="button">
        Iptal
      </button>
      <button className="btn-primary" disabled={saving} onClick={onSave} type="button">
        {saving ? "Kaydediliyor..." : "Kaydet"}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Model Preset"
      subtitle="Uretim parametreleri yapilandir"
      onClose={onClose}
      width="min(760px, 100%)"
      footer={footerButtons}
    >
      <div style={{ display: "grid", gap: 12, padding: 20 }}>
        <input
          onChange={(event) => onChange({ ...editor, name: event.target.value })}
          placeholder="Preset adi"
          style={formInputStyle}
          value={editor.name}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <select
            onChange={(event) => onChange({ ...editor, imageModel: event.target.value })}
            style={formInputStyle}
            value={editor.imageModel}
          >
            <option value="">Gorsel modeli sec</option>
            {Object.entries(IMAGE_MODELS).map(([modelId, meta]) => (
              <option key={modelId} value={modelId}>
                {meta.label}
              </option>
            ))}
          </select>
          <select
            onChange={(event) => onChange({ ...editor, videoModel: event.target.value })}
            style={formInputStyle}
            value={editor.videoModel}
          >
            <option value="">Video modeli sec</option>
            {Object.entries(VIDEO_MODELS).map(([modelId, meta]) => (
              <option key={modelId} value={modelId}>
                {meta.label}
              </option>
            ))}
          </select>
        </div>

        <textarea
          onChange={(event) => onChange({ ...editor, imageParams: event.target.value })}
          rows={8}
          style={textareaStyle}
          value={editor.imageParams}
        />
        <textarea
          onChange={(event) => onChange({ ...editor, videoParams: event.target.value })}
          rows={8}
          style={textareaStyle}
          value={editor.videoParams}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-secondary)" }}>
          <input
            checked={editor.isDefault}
            onChange={(event) => onChange({ ...editor, isDefault: event.target.checked })}
            style={{ accentColor: "var(--accent)" }}
            type="checkbox"
          />
          Varsayilan preset olarak kaydet
        </label>
      </div>
    </ModalShell>
  );
}

function JsonPreview({ title, value }: { title: string; value: string | null }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {title}
      </span>
      <div style={jsonPreviewStyle}>{value || "Parametre tanimi yok."}</div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricCardStyle}>
      <strong style={{ fontSize: 28 }}>{value}</strong>
      <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
    </div>
  );
}

function SimpleState({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="screen-shell">
      <div style={emptyStateStyle}>
        <div style={{ display: "grid", gap: 10, justifyItems: "center", maxWidth: 420, textAlign: "center" }}>
          <Bot size={34} style={{ color: "var(--accent)" }} />
          <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>{copy}</p>
        </div>
      </div>
    </section>
  );
}

const heroStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
  padding: 24,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background: "linear-gradient(135deg, var(--surface-hover), transparent 28%), var(--bg-surface)",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid var(--border-default)",
  background: "var(--surface-hover)",
  color: "var(--text-primary)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies React.CSSProperties;

const copyStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies React.CSSProperties;

const metricsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 12,
} satisfies React.CSSProperties;

const toolbarStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  padding: 18,
  borderRadius: 22,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const searchFieldStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minWidth: 260,
  flex: 1,
  padding: "12px 14px",
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const filterInputStyle = {
  width: "100%",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--text-primary)",
  fontSize: 13,
} satisfies React.CSSProperties;

const selectStyle = {
  minWidth: 220,
  padding: "12px 14px",
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
} satisfies React.CSSProperties;

const metricCardStyle = {
  display: "grid",
  gap: 6,
  padding: 18,
  borderRadius: 20,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const presetGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
  gap: 16,
} satisfies React.CSSProperties;

const presetCardStyle = {
  display: "grid",
  gap: 16,
  padding: 18,
  borderRadius: 22,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const tagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "var(--surface-active)",
  color: "var(--text-primary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const mutedTagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "var(--surface-hover)",
  color: "var(--text-secondary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const defaultTagStyle = {
  display: "inline-flex",
  padding: "4px 12px",
  borderRadius: 8,
  background: "var(--accent)",
  color: "var(--on-accent)",
  fontSize: 11,
  fontWeight: 600,
} satisfies React.CSSProperties;

const jsonPreviewStyle = {
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  fontFamily: '"IBM Plex Sans", monospace',
} satisfies React.CSSProperties;

const formInputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
} satisfies React.CSSProperties;

const textareaStyle = {
  ...formInputStyle,
  resize: "vertical",
  fontFamily: '"IBM Plex Sans", monospace',
  lineHeight: 1.7,
} satisfies React.CSSProperties;

const emptyStateStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 360,
  padding: 24,
  borderRadius: 24,
  border: "1px dashed var(--border-default)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;
