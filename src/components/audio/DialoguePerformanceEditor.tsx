import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { RotateCcw, Save, SlidersHorizontal, Undo2 } from "lucide-react";
import {
  type DialogueGenerationProfile,
} from "@/services/audio-pipeline.service";

type DialoguePerformanceEditorProps = {
  profile: DialogueGenerationProfile;
  hasOverride: boolean;
  busy?: boolean;
  title?: string;
  description?: string;
  onSave: (profile: DialogueGenerationProfile) => Promise<void> | void;
  onClear: () => Promise<void> | void;
};

const PRESET_OPTIONS: Array<{
  value: DialogueGenerationProfile["performancePreset"];
  label: string;
  description: string;
}> = [
  { value: "auto", label: "Otomatik", description: "Sahneden otomatik duygu tonu cikarir." },
  { value: "command", label: "Komut", description: "Kisa, net, sert ve askeri." },
  { value: "threat", label: "Tehdit", description: "Soguk, kontrollu ve tehlikeli." },
  { value: "oath", label: "Yemin / Kabul", description: "Kararli, mevcut ve insan gibi." },
  { value: "controlled_grief", label: "Kontrollu Keder", description: "Duygulu ama dagilmayan ton." },
  { value: "tense", label: "Yuksek Gerilim", description: "Baski hissi var, yine de kontrollu." },
  { value: "conversation", label: "Dogal Konusma", description: "Gundelik ve temiz olmayan insan tonu." },
];

export function DialoguePerformanceEditor({
  profile,
  hasOverride,
  busy = false,
  title = "Duygu tonu ve optimizer",
  description = "Shot bazinda duygu preset'i, yonetmen notu ve OpenRouter ara katmanini buradan yonetebilirsin.",
  onSave,
  onClear,
}: DialoguePerformanceEditorProps) {
  const [draft, setDraft] = useState<DialogueGenerationProfile>(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const normalizedDraft = useMemo<DialogueGenerationProfile>(
    () => ({
      useOptimizer: Boolean(draft.useOptimizer),
      performancePreset: draft.performancePreset,
      performanceNote: draft.performanceNote?.trim() || null,
    }),
    [draft],
  );
  const normalizedSource = useMemo<DialogueGenerationProfile>(
    () => ({
      useOptimizer: Boolean(profile.useOptimizer),
      performancePreset: profile.performancePreset,
      performanceNote: profile.performanceNote?.trim() || null,
    }),
    [profile],
  );
  const isDirty =
    normalizedDraft.useOptimizer !== normalizedSource.useOptimizer ||
    normalizedDraft.performancePreset !== normalizedSource.performancePreset ||
    normalizedDraft.performanceNote !== normalizedSource.performanceNote;
  const activePreset = PRESET_OPTIONS.find((option) => option.value === normalizedDraft.performancePreset);

  return (
    <details open={hasOverride} style={rootStyle}>
      <summary style={summaryStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <SlidersHorizontal size={14} />
          {title}
        </span>
        {hasOverride ? <span style={pillStyle}>override aktif</span> : null}
      </summary>

      <div style={bodyStyle}>
        <div style={descriptionStyle}>{description}</div>

        <label style={toggleWrapStyle}>
          <input
            checked={normalizedDraft.useOptimizer}
            disabled={busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                useOptimizer: event.target.checked,
              }))
            }
            style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
            type="checkbox"
          />
          <span style={{ display: "grid", gap: 3 }}>
            <strong style={{ fontSize: 12, color: "var(--text-primary)" }}>
              OpenRouter dialog optimizer aktif
            </strong>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              Kapaliysa orijinal veya elle duzenlenmis metin dogrudan kullanilir. Aciksa akicilik
              ve delivery cue katmani da calisir.
            </span>
          </span>
        </label>

        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>Duygu preset&apos;i</span>
          <select
            className="studio-field"
            disabled={busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                performancePreset: event.target.value as DialogueGenerationProfile["performancePreset"],
              }))
            }
            style={selectStyle}
            value={normalizedDraft.performancePreset}
          >
            {PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span style={hintStyle}>{activePreset?.description}</span>
        </label>

        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>Yonetmen notu</span>
          <textarea
            disabled={busy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                performanceNote: event.target.value,
              }))
            }
            placeholder="Ornek: Ses kontrollu ama icten ice ofkeli olsun. Fazla temiz veya sakin gelmesin."
            rows={3}
            style={textareaStyle}
            value={draft.performanceNote ?? ""}
          />
          <span style={hintStyle}>Opsiyonel. Anlami degistirmez, sadece performans yonu verir.</span>
        </label>

        <div style={actionsStyle}>
          <button
            className="btn-primary"
            disabled={busy || !isDirty}
            onClick={() => void onSave(normalizedDraft)}
            type="button"
          >
            <Save size={14} />
            Kaydet
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !isDirty}
            onClick={() => setDraft(profile)}
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
            Varsayilana don
          </button>
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

const toggleWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(255,255,255,0.78)",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const fieldLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text-primary)",
};

const selectStyle: CSSProperties = {
  minWidth: 220,
  padding: "10px 12px",
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

const hintStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.5,
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
