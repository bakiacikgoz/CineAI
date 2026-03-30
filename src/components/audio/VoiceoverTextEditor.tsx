import { useEffect, useState, type CSSProperties } from "react";
import { AudioLines, Save, Trash2, Undo2 } from "lucide-react";

type VoiceoverTextEditorProps = {
  text: string | null;
  busy?: boolean;
  onSave: (text: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
};

const MAX_CHARS = 5000;

export function VoiceoverTextEditor({
  text,
  busy = false,
  onSave,
  onClear,
}: VoiceoverTextEditorProps) {
  const [draft, setDraft] = useState(text ?? "");

  useEffect(() => {
    setDraft(text ?? "");
  }, [text]);

  const normalizedSource = (text ?? "").trim();
  const normalizedDraft = draft.trim();
  const isDirty = normalizedDraft !== normalizedSource;
  const isEmpty = !normalizedDraft;
  const isOverLimit = normalizedDraft.length > MAX_CHARS;
  const hasExistingText = Boolean(normalizedSource);

  return (
    <details open={hasExistingText} style={rootStyle}>
      <summary style={summaryStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <AudioLines size={14} />
          Seslendirme metni
        </span>
        {hasExistingText ? <span style={pillStyle}>seslendirme aktif</span> : null}
      </summary>

      <div style={bodyStyle}>
        <div style={descriptionStyle}>
          Diyalog olmayan shot&apos;lar icin serbest seslendirme metni gir. Metin &quot;Anlatici&quot;
          konusmacisi ile seslendirilecek. Paragraflar arasinda bos satir birakirsan ayri
          cumle bloklari olarak islenir.
        </div>

        <div style={{ position: "relative" }}>
          <textarea
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Seslendirme metnini buraya yaz..."
            rows={5}
            style={textareaStyle}
            value={draft}
          />
          <span style={charCountStyle(isOverLimit)}>
            {normalizedDraft.length} / {MAX_CHARS}
          </span>
        </div>

        <div style={actionsStyle}>
          <button
            className="btn-primary"
            disabled={busy || !isDirty || isEmpty || isOverLimit}
            onClick={() => void onSave(normalizedDraft)}
            type="button"
          >
            <Save size={14} />
            Kaydet
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !isDirty}
            onClick={() => setDraft(text ?? "")}
            type="button"
          >
            <Undo2 size={14} />
            Geri al
          </button>
          {hasExistingText ? (
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void onClear()}
              type="button"
            >
              <Trash2 size={14} />
              Kaldir
            </button>
          ) : null}
          {isOverLimit ? (
            <span style={errorStyle}>
              Metin {MAX_CHARS} karakter limitini asiyor.
            </span>
          ) : null}
        </div>
      </div>
    </details>
  );
}

const rootStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid var(--glass-border)",
  background: "var(--surface-hover)",
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

const textareaStyle: CSSProperties = {
  width: "100%",
  resize: "vertical",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--surface-card)",
  padding: "12px 14px",
  font: "inherit",
  lineHeight: 1.6,
  color: "var(--text-primary)",
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 9px",
  borderRadius: 999,
  border: "1px solid rgba(99,102,241,0.22)",
  background: "rgba(99,102,241,0.12)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-primary)",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--status-error)",
};

function charCountStyle(isOverLimit: boolean): CSSProperties {
  return {
    position: "absolute",
    bottom: 10,
    right: 14,
    fontSize: 10,
    fontWeight: 600,
    color: isOverLimit ? "var(--status-error)" : "var(--text-tertiary)",
    pointerEvents: "none",
  };
}
