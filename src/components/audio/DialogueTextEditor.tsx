import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { PencilLine, RotateCcw, Save, Undo2 } from "lucide-react";
import { type DialogueOverrideLine } from "@/services/audio-pipeline.service";

type DialogueTextEditorProps = {
  lines: DialogueOverrideLine[];
  hasOverride: boolean;
  busy?: boolean;
  title?: string;
  description?: string;
  emptyCopy?: string;
  onSave: (lines: DialogueOverrideLine[]) => Promise<void> | void;
  onClear: () => Promise<void> | void;
};

export function DialogueTextEditor({
  lines,
  hasOverride,
  busy = false,
  title = "Seslendirme metnini duzenle",
  description = "Konusmaci etiketleri sabit kalir. Sadece replikleri daha akici veya daha dogru hale getirebilirsin.",
  emptyCopy = "Duzenlenebilir speaker-tagged transcript bulunmuyor.",
  onSave,
  onClear,
}: DialogueTextEditorProps) {
  const [draftLines, setDraftLines] = useState<DialogueOverrideLine[]>(lines);

  useEffect(() => {
    setDraftLines(lines);
  }, [lines]);

  const normalizedSource = useMemo(
    () =>
      lines.map((line) => ({
        speaker: line.speaker.trim(),
        speakerKey: line.speakerKey.trim(),
        text: line.text.replace(/\s+/g, " ").trim(),
      })),
    [lines],
  );
  const normalizedDraft = useMemo(
    () =>
      draftLines.map((line) => ({
        speaker: line.speaker.trim(),
        speakerKey: line.speakerKey.trim(),
        text: line.text.replace(/\s+/g, " ").trim(),
      })),
    [draftLines],
  );
  const hasEmptyLine = normalizedDraft.some((line) => !line.text);
  const isDirty =
    normalizedDraft.length === normalizedSource.length &&
    normalizedDraft.some((line, index) => line.text !== normalizedSource[index]?.text);

  if (lines.length === 0) {
    return <div style={emptyStateStyle}>{emptyCopy}</div>;
  }

  return (
    <details open={hasOverride} style={rootStyle}>
      <summary style={summaryStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <PencilLine size={14} />
          {title}
        </span>
        {hasOverride ? <span style={pillStyle}>override aktif</span> : null}
      </summary>

      <div style={bodyStyle}>
        <div style={descriptionStyle}>{description}</div>
        <div style={{ display: "grid", gap: 12 }}>
          {draftLines.map((line, index) => (
            <label key={`${line.speakerKey}-${index}`} style={lineBlockStyle}>
              <span style={speakerStyle}>{line.speaker}</span>
              <textarea
                disabled={busy}
                onChange={(event) =>
                  setDraftLines((current) =>
                    current.map((item, currentIndex) =>
                      currentIndex === index
                        ? {
                            ...item,
                            text: event.target.value,
                          }
                        : item,
                    ),
                  )
                }
                rows={3}
                style={textareaStyle}
                value={line.text}
              />
            </label>
          ))}
        </div>

        <div style={actionsStyle}>
          <button
            className="btn-primary"
            disabled={busy || !isDirty || hasEmptyLine}
            onClick={() => void onSave(normalizedDraft)}
            type="button"
          >
            <Save size={14} />
            Kaydet
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !isDirty}
            onClick={() => setDraftLines(lines)}
            type="button"
          >
            <Undo2 size={14} />
            Geri al
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !hasOverride}
            onClick={() => void onClear()}
            type="button"
          >
            <RotateCcw size={14} />
            Orijinale don
          </button>
          {hasEmptyLine ? <span style={errorStyle}>Bos replik kaydedilemez.</span> : null}
        </div>
      </div>
    </details>
  );
}

const rootStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(0,0,0,0.02)",
  overflow: "hidden",
};

const summaryStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  cursor: "pointer",
  listStyle: "none",
  padding: "12px 14px",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-primary)",
};

const bodyStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: "0 14px 14px",
};

const descriptionStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  color: "var(--text-secondary)",
};

const lineBlockStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const speakerStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text-primary)",
};

const textareaStyle: CSSProperties = {
  width: "100%",
  resize: "vertical",
  borderRadius: 14,
  border: "1px solid rgba(0,0,0,0.1)",
  background: "rgba(255,255,255,0.9)",
  padding: "12px 14px",
  font: "inherit",
  lineHeight: 1.6,
  color: "var(--text-primary)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid rgba(245,158,11,0.22)",
  background: "rgba(245,158,11,0.12)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-primary)",
};

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--status-error)",
};

const emptyStateStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};
