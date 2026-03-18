import { useEffect, useMemo, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { Bot, Copy, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
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
            title: "Model Manager",
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
        title: "Model Manager",
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
        title: "Model Manager",
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
        title: "Model Manager",
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
        title: "Model Manager",
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
    return <SimpleState title="Model Manager" copy="Preset yonetimi icin once bir proje ac." />;
  }

  return (
    <section className="screen-shell">
      <section style={{ display: "grid", gap: 18 }}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <Bot size={13} />
              Provider presets
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Model Manager
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
          <MetricCard label="Image ready" value={String(stats.imageCapable)} />
          <MetricCard label="Video ready" value={String(stats.videoCapable)} />
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
            <option value="image">Image model olanlar</option>
            <option value="video">Video model olanlar</option>
            <option value="default">Varsayilan presetler</option>
          </select>
        </section>

        {loading ? (
          <SimpleState title="Yukleniyor..." copy="Model presetleri okunuyor." />
        ) : error ? (
          <SimpleState title="Yuklenemedi" copy={error} />
        ) : filteredPresets.length === 0 ? (
          <SimpleState
            title={presets.length === 0 ? "Preset yok" : "Sonuc bulunamadi"}
            copy={
              presets.length === 0
                ? "Ilk model preset kaydini olusturup generator akislariyla baglayabilirsin."
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
                      {preset.isDefault ? <span style={defaultTagStyle}>Default</span> : null}
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
                  <JsonPreview title="Image params" value={preset.imageParams} />
                  <JsonPreview title="Video params" value={preset.videoParams} />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-secondary" onClick={() => applyPreset(preset, "image")} type="button">
                    <Sparkles size={14} />
                    Image Generator
                  </button>
                  <button className="btn-secondary" onClick={() => applyPreset(preset, "video")} type="button">
                    <Bot size={14} />
                    Video Generator
                  </button>
                  <button className="btn-secondary" onClick={() => void handleDuplicate(preset.id)} type="button">
                    <Copy size={14} />
                    Cogalt
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
  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={(event) => event.stopPropagation()} style={modalPanelStyle}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {editor.id ? "Preset duzenle" : "Yeni preset"}
          </div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Parametre JSON alanlari generator ekranlarinda form durumuna uygulanacak sekilde saklanir.
          </p>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
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
              <option value="">Image model sec</option>
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
              <option value="">Video model sec</option>
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

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-secondary" disabled={saving} onClick={onClose} type="button">
            Iptal
          </button>
          <button className="btn-primary" disabled={saving} onClick={onSave} type="button">
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>
    </div>
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
  background: "linear-gradient(135deg, rgba(245,158,11,0.08), transparent 28%), var(--bg-surface)",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(245, 158, 11, 0.24)",
  background: "rgba(245, 158, 11, 0.1)",
  color: "var(--accent)",
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
  background: "rgba(245, 158, 11, 0.1)",
  color: "var(--accent)",
  fontSize: 11,
} satisfies React.CSSProperties;

const mutedTagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.04)",
  color: "var(--text-secondary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const defaultTagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(34,197,94,0.12)",
  color: "var(--status-success)",
  fontSize: 11,
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

const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 240,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(0, 0, 0, 0.72)",
  backdropFilter: "blur(10px)",
} satisfies React.CSSProperties;

const modalPanelStyle = {
  width: "min(760px, 100%)",
  display: "grid",
  gap: 18,
  padding: 24,
  borderRadius: 24,
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
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
