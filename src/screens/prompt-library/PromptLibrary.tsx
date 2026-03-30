import { useEffect, useMemo, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { BookText, Copy, FileText, Pencil, Plus, Search, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { Portal } from "@/components/Portal";
import { ModalShell, ProEmptyState } from "@/components/ui";
import { useNavigate } from "react-router-dom";
import { runPromptAssist, type PromptAssistMode } from "@/services/llm.service";
import {
  createPromptTemplate,
  deletePromptTemplate,
  duplicatePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
  type PromptTemplateRecord,
} from "@/services/prompt-template.service";
import { useProjectStore } from "@/store/project.store";

type PromptEditorState = {
  id: string | null;
  name: string;
  category: string;
  model: string;
  content: string;
};

const EMPTY_EDITOR: PromptEditorState = {
  id: null,
  name: "",
  category: "",
  model: "",
  content: "",
};

export function PromptLibrary() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<PromptTemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editor, setEditor] = useState<PromptEditorState>(EMPTY_EDITOR);
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          templates
            .map((template) => template.category)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [templates],
  );

  const filteredTemplates = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return templates.filter((template) => {
      const matchesCategory =
        categoryFilter === "all" || template.category === categoryFilter;
      const matchesSearch =
        needle.length === 0 ||
        template.name.toLowerCase().includes(needle) ||
        template.content.toLowerCase().includes(needle) ||
        template.category?.toLowerCase().includes(needle) ||
        template.model?.toLowerCase().includes(needle);

      return matchesCategory && matchesSearch;
    });
  }, [categoryFilter, search, templates]);

  useEffect(() => {
    if (!activeProject) {
      setTemplates([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadTemplates() {
      setLoading(true);

      try {
        const nextTemplates = await listPromptTemplates();
        if (!cancelled) {
          setTemplates(nextTemplates);
        }
      } catch (error) {
        console.error("Failed to load prompt templates", error);
        if (!cancelled) {
          await message(
            error instanceof Error ? error.message : "Prompt kutuphanesi yuklenemedi.",
            {
              title: "Prompt Kutuphanesi",
              kind: "error",
            },
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [activeProject]);

  async function refreshTemplates() {
    const nextTemplates = await listPromptTemplates();
    setTemplates(nextTemplates);
  }

  function openCreateEditor() {
    setEditor(EMPTY_EDITOR);
    setShowEditor(true);
  }

  function openEditEditor(template: PromptTemplateRecord) {
    setEditor({
      id: template.id,
      name: template.name,
      category: template.category ?? "",
      model: template.model ?? "",
      content: template.content,
    });
    setShowEditor(true);
  }

  async function handleSave() {
    if (!editor.name.trim() || !editor.content.trim()) {
      await message("Sablon adi ve prompt icerigi zorunludur.", {
        title: "Prompt Kutuphanesi",
        kind: "warning",
      });
      return;
    }

    setSaving(true);

    try {
      if (editor.id) {
        await updatePromptTemplate(editor.id, editor);
      } else {
        await createPromptTemplate(editor);
      }

      await refreshTemplates();
      setShowEditor(false);
      setEditor(EMPTY_EDITOR);
    } catch (error) {
      console.error("Failed to save prompt template", error);
      await message(error instanceof Error ? error.message : "Prompt sablonu kaydedilemedi.", {
        title: "Prompt Kutuphanesi",
        kind: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(templateId: string) {
    try {
      await duplicatePromptTemplate(templateId);
      await refreshTemplates();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Sablon kopyalanamadi.", {
        title: "Prompt Kutuphanesi",
        kind: "error",
      });
    }
  }

  async function handleDelete(templateId: string) {
    const accepted = await confirm("Bu prompt sablonu silinecek. Devam edilsin mi?", {
      title: "Prompt sablonu sil",
      kind: "warning",
      okLabel: "Sil",
      cancelLabel: "Vazgec",
    });

    if (!accepted) {
      return;
    }

    try {
      await deletePromptTemplate(templateId);
      await refreshTemplates();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Sablon silinemedi.", {
        title: "Prompt Kutuphanesi",
        kind: "error",
      });
    }
  }

  function routeTemplate(template: PromptTemplateRecord, target: "image" | "video") {
    navigate(target === "image" ? "/image-generator" : "/video-generator", {
      state: {
        promptTemplateContent: template.content,
        promptTemplateName: template.name,
        promptTemplateModel: template.model ?? undefined,
      },
    });
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <ProEmptyState icon={FileText} title="Prompt Kutuphanesi" description="Prompt sablonlarini yonetmek icin once bir proje ac." />
      </section>
    );
  }

  return (
    <section className="screen-shell">
      <section style={{ display: "grid", gap: 18 }}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <WandSparkles size={13} />
              Prompt Kutuphanesi
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Prompt Kutuphanesi
            </div>
            <p style={heroCopyStyle}>
              Projeye ozel prompt sablonlari, kategori bazli varyasyonlar ve hizli generator
              aktarimlari burada yonetilir.
            </p>
          </div>

          <button className="btn-primary" onClick={openCreateEditor} type="button">
            <Plus size={15} />
            Yeni Sablon
          </button>
        </header>

        <section style={toolbarStyle}>
          <label style={searchFieldStyle}>
            <Search size={15} style={{ color: "var(--text-muted)" }} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Isim, kategori veya model ara"
              style={filterInputStyle}
              value={search}
            />
          </label>

          <select
            onChange={(event) => setCategoryFilter(event.target.value)}
            style={selectStyle}
            value={categoryFilter}
          >
            <option value="all">Tum kategoriler</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </section>

        {loading ? (
          <DataState title="Yukleniyor..." copy="Prompt sablon kayitlari okunuyor." />
        ) : filteredTemplates.length === 0 ? (
          <ProEmptyState
            icon={FileText}
            title="Sablon bulunamadi"
            description={
              templates.length === 0
                ? "Yeni bir prompt sablonu olusturun."
                : "Arama ve filtrelere uyan prompt sablonu bulunamadi."
            }
          />
        ) : (
          <div style={gridStyle}>
            {filteredTemplates.map((template) => (
              <article key={template.id} style={cardStyle}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong style={{ fontSize: 17 }}>{template.name}</strong>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {template.category ? <span style={tagStyle}>{template.category}</span> : null}
                        {template.model ? <span style={mutedTagStyle}>{template.model}</span> : null}
                      </div>
                    </div>
                    <button className="icon-button" onClick={() => openEditEditor(template)} type="button">
                      <Pencil size={15} />
                    </button>
                  </div>

                  <div style={contentPreviewStyle}>{template.content}</div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn-secondary" onClick={() => routeTemplate(template, "image")} type="button">
                      <Sparkles size={14} />
                      Gorsel Uret
                    </button>
                    <button className="btn-secondary" onClick={() => routeTemplate(template, "video")} type="button">
                      <BookText size={14} />
                      Video Uret
                    </button>
                    <button className="btn-secondary" onClick={() => void handleDuplicate(template.id)} type="button">
                      <Copy size={14} />
                      Kopyala
                    </button>
                    <button className="btn-secondary" onClick={() => void handleDelete(template.id)} type="button">
                      <Trash2 size={14} />
                      Sil
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {showEditor ? (
        <Portal>
          <TemplateEditorModal
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

function TemplateEditorModal({
  editor,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  editor: PromptEditorState;
  onChange: (value: PromptEditorState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [assisting, setAssisting] = useState<PromptAssistMode | null>(null);

  async function handleAssist(mode: PromptAssistMode) {
    if (!editor.content.trim()) {
      await message("Yardimci aksiyon icin once bir prompt icerigi gir.", {
        title: "Prompt Kutuphanesi",
        kind: "warning",
      });
      return;
    }

    setAssisting(mode);

    try {
      const nextContent = await runPromptAssist(mode, editor.content);
      onChange({ ...editor, content: nextContent });
    } catch (error) {
      console.error("Failed to run prompt assist", error);
      await message(
        error instanceof Error ? error.message : "Prompt yardimcisi calistirilamadi.",
        {
          title: "Prompt Kutuphanesi",
          kind: "error",
        },
      );
    } finally {
      setAssisting(null);
    }
  }

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
      title="Prompt Sablonu"
      subtitle="Sablon duzenle veya yeni olustur"
      onClose={onClose}
      width="min(720px, 100%)"
      footer={footerButtons}
    >
      <div style={{ display: "grid", gap: 12, padding: 20 }}>
        <input
          onChange={(event) => onChange({ ...editor, name: event.target.value })}
          placeholder="Sablon adi"
          style={formInputStyle}
          value={editor.name}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <input
            onChange={(event) => onChange({ ...editor, category: event.target.value })}
            placeholder="Kategori"
            style={formInputStyle}
            value={editor.category}
          />
          <input
            onChange={(event) => onChange({ ...editor, model: event.target.value })}
            placeholder="Model onerisi"
            style={formInputStyle}
            value={editor.model}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            disabled={Boolean(assisting)}
            onClick={() => void handleAssist("refine")}
            type="button"
          >
            {assisting === "refine" ? "Iyilestiriliyor..." : "Iyilestir"}
          </button>
          <button
            className="btn-secondary"
            disabled={Boolean(assisting)}
            onClick={() => void handleAssist("shorten")}
            type="button"
          >
            {assisting === "shorten" ? "Kisaltiliyor..." : "Kisalt"}
          </button>
          <button
            className="btn-secondary"
            disabled={Boolean(assisting)}
            onClick={() => void handleAssist("translate-tr")}
            type="button"
          >
            {assisting === "translate-tr" ? "Cevriliyor..." : "Turkce'ye cevir"}
          </button>
          <button
            className="btn-secondary"
            disabled={Boolean(assisting)}
            onClick={() => void handleAssist("translate-en")}
            type="button"
          >
            {assisting === "translate-en" ? "Cevriliyor..." : "Ingilizce'ye cevir"}
          </button>
        </div>
        <textarea
          onChange={(event) => onChange({ ...editor, content: event.target.value })}
          placeholder="Prompt icerigi"
          rows={14}
          style={textareaStyle}
          value={editor.content}
        />
      </div>
    </ModalShell>
  );
}

function DataState({ title, copy }: { title: string; copy: string }) {
  return (
    <div style={emptyStateStyle}>
      <div style={{ display: "grid", gap: 10, justifyItems: "center", maxWidth: 420, textAlign: "center" }}>
        <BookText size={34} style={{ color: "var(--accent)" }} />
        <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
        <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>{copy}</p>
      </div>
    </div>
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
  background:
    "linear-gradient(135deg, rgba(0, 0, 0, 0.03), transparent 28%), var(--bg-surface)",
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

const heroCopyStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
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

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: 16,
} satisfies React.CSSProperties;

const cardStyle = {
  display: "grid",
  gap: 16,
  padding: 18,
  borderRadius: 22,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
  boxShadow: "0 1px 3px var(--surface-hover)",
} satisfies React.CSSProperties;

const tagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(0, 0, 0, 0.05)",
  color: "var(--text-primary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const mutedTagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(0, 0, 0, 0.03)",
  color: "var(--text-secondary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const contentPreviewStyle = {
  minHeight: 120,
  padding: 14,
  borderRadius: 16,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  display: "-webkit-box",
  WebkitLineClamp: 8,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
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
  minHeight: 240,
  resize: "vertical",
  fontFamily: "inherit",
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
