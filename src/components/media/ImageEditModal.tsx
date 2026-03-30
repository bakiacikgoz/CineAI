import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { join } from "@tauri-apps/api/path";
import { message } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  LoaderCircle,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";

/* ═══════════ EXPORTED TYPES ═══════════ */

export type ImageEditAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:2";

export type ImageEditModalDraft = {
  id: string;
  label: string;
  absolutePath: string;
  previewUrl: string;
  width: number | null;
  height: number | null;
};

export type ImageEditSubmitPayload = {
  prompt: string;
  aspectRatio: ImageEditAspectRatio;
  referenceImagePaths: string[];
};

/* ═══════════ INTERNAL TYPES ═══════════ */

type Point = { x: number; y: number };
type Stroke = { id: string; color: string; size: number; points: Point[] };

type ImageEditModalProps = {
  draft: ImageEditModalDraft | null;
  projectFolderPath: string;
  dialogTitle: string;
  submitting: boolean;
  guideFilePrefix?: string;
  onClose: () => void;
  onSubmit: (payload: ImageEditSubmitPayload) => Promise<void>;
};

/* ═══════════ CONSTANTS ═══════════ */

const COLORS: Array<{ value: string; label: string }> = [
  { value: "rgba(245,158,11,0.96)", label: "Amber" },
  { value: "rgba(59,130,246,0.94)", label: "Mavi" },
  { value: "rgba(239,68,68,0.94)", label: "Kirmizi" },
  { value: "rgba(34,197,94,0.94)", label: "Yesil" },
  { value: "rgba(168,85,247,0.94)", label: "Mor" },
  { value: "rgba(236,72,153,0.94)", label: "Pembe" },
  { value: "rgba(255,255,255,0.96)", label: "Beyaz" },
  { value: "rgba(30,30,30,0.96)", label: "Siyah" },
];

const ASPECT_RATIOS: ImageEditAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:2"];
const ASPECT_RATIO_VALUES: Record<ImageEditAspectRatio, number> = {
  "1:1": 1, "16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3, "3:2": 3 / 2,
};

const PRESET_PROMPTS: Array<{ label: string; prompts: string[] }> = [
  { label: "Duzeltme", prompts: ["Isigi dogal hale getir", "Renkleri canlandir", "Kontrasti artir", "Lens bozulmasini duzelt"] },
  { label: "Ekleme", prompts: ["Atmosferik sis ekle", "Lens flare ekle", "Doku ve grain ekle", "Dramatik gokyuzu ekle"] },
  { label: "Cikarma", prompts: ["Isaretli nesneyi kaldir", "Golgeleri temizle", "Dagitici ogeleri sil", "Logo veya metin kaldir"] },
  { label: "Karakter", prompts: ["Yuz detayini iyilestir", "Goz parlakligi artir", "Cilt tonunu duzelt", "Sac detayi artir"] },
];

const MIN_BRUSH = 4;
const MAX_BRUSH = 48;

/* ═══════════ HELPERS ═══════════ */

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

function svgPts(pts: Point[]): string { return pts.map((p) => `${p.x},${p.y}`).join(" "); }

function d2b(dataUrl: string): Uint8Array {
  const b = atob(dataUrl.split(",")[1] ?? "");
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

function mime(p: string): string {
  const l = p.toLowerCase();
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  if (l.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function inferAR(w: number | null, h: number | null): ImageEditAspectRatio {
  if (!w || !h) return "16:9";
  const r = w / h;
  let best: ImageEditAspectRatio = "16:9";
  let d = Infinity;
  for (const ar of ASPECT_RATIOS) { const dd = Math.abs(ASPECT_RATIO_VALUES[ar] - r); if (dd < d) { d = dd; best = ar; } }
  return best;
}

export function buildDefaultImageEditPrompt(prompt: string): string {
  const t = prompt.trim();
  const p = "Preserve the original image composition, subject identity, camera angle, lighting, and all unmarked regions. Apply only subtle local edits that follow the markup and keep the rest of the frame unchanged.";
  return t.length > 0 ? `${t}\n${p}` : "Apply only the local changes indicated by the markup overlay and keep the rest of the image exactly as it is. Do not redesign the frame.";
}

/* ═══════════ COMPONENT ═══════════ */

export function ImageEditModal({
  draft, projectFolderPath, dialogTitle, submitting, guideFilePrefix = "guide_still", onClose, onSubmit,
}: ImageEditModalProps) {
  const [prompt, setPrompt] = useState("");
  const [ar, setAr] = useState<ImageEditAspectRatio>("16:9");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(16);
  const [zoom, setZoom] = useState(1);
  const [rw, setRw] = useState<number | null>(null);
  const [rh, setRh] = useState<number | null>(null);
  const [presetCat, setPresetCat] = useState("Duzeltme");
  const ref = useRef<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setPrompt(""); setAr(inferAR(draft.width, draft.height)); setStrokes([]); setColor(COLORS[0].value); setSize(16); setZoom(1); setRw(draft.width); setRh(draft.height);
  }, [draft?.id, draft?.absolutePath, draft?.width, draft?.height]);

  useEffect(() => {
    if (!draft) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !submitting) { e.preventDefault(); setStrokes((c) => c.slice(0, -1)); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [draft, onClose, submitting]);

  if (!draft) return null;
  const d = draft;
  const canSubmit = prompt.trim().length > 0 || strokes.length > 0;
  const dims = rw && rh ? `${rw} x ${rh}` : null;
  const presets = PRESET_PROMPTS.find((c) => c.label === presetCat)?.prompts ?? [];

  function gp(e: ReactPointerEvent<HTMLDivElement>): Point | null {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }

  function pd(e: ReactPointerEvent<HTMLDivElement>) {
    if (submitting) return;
    const pt = gp(e); if (!pt) return;
    const rc = e.currentTarget.getBoundingClientRect();
    const id = createId(); ref.current = id;
    setStrokes((c) => [...c, { id, color, size: size / Math.max(rc.width, rc.height), points: [pt] }]);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function pm(e: ReactPointerEvent<HTMLDivElement>) {
    const id = ref.current; if (!id || submitting) return;
    const pt = gp(e); if (!pt) return;
    setStrokes((c) => c.map((s) => s.id === id ? { ...s, points: [...s.points, pt] } : s));
  }

  function pu(e: ReactPointerEvent<HTMLDivElement>) {
    ref.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function ol(e: SyntheticEvent<HTMLImageElement>) {
    const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
    if (!w || !h) return;
    setRw(w); setRh(h);
    setAr((c) => strokes.length > 0 || prompt.trim().length > 0 ? c : inferAR(w, h));
  }

  async function buildRefs(): Promise<string[]> {
    if (strokes.length === 0) return [d.absolutePath];
    const bytes = await readFile(d.absolutePath);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime(d.absolutePath) }));
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new window.Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Gorsel yuklenemedi.")); i.src = url; });
    try {
      const w = rw ?? img.naturalWidth, h = rh ?? img.naturalHeight;
      if (!w || !h) throw new Error("Boyut okunamadi.");
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); if (!ctx) throw new Error("Tuval olusturulamadi.");
      ctx.drawImage(img, 0, 0, w, h); ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const s of strokes) {
        if (s.points.length === 0) continue;
        ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(3, s.size * Math.max(w, h));
        ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
        for (const p of s.points.slice(1)) ctx.lineTo(p.x * w, p.y * h);
        if (s.points.length === 1) ctx.lineTo(s.points[0].x * w, s.points[0].y * h);
        ctx.stroke();
      }
      const folder = await join(projectFolderPath, "assets", "images", "_edit-guides");
      await mkdir(folder, { recursive: true });
      const path = await join(folder, `${guideFilePrefix}_${createId().slice(0, 8)}.png`);
      await writeFile(path, d2b(c.toDataURL("image/png")));
      return [d.absolutePath, path];
    } finally { URL.revokeObjectURL(url); }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      const refs = await buildRefs();
      await onSubmit({ prompt: buildDefaultImageEditPrompt(prompt), aspectRatio: ar, referenceImagePaths: refs });
    } catch (err) {
      await message(err instanceof Error ? err.message : "Duzenleme kuyruga eklenemedi.", { title: dialogTitle, kind: "error" });
    }
  }

  /* ═══════════ RENDER ═══════════ */
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 210, display: "grid", placeItems: "center", padding: 16, background: "var(--backdrop-bg)", backdropFilter: "blur(14px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(1340px, calc(100vw - 32px))", height: "min(920px, calc(100vh - 32px))", borderRadius: 20, border: "1px solid var(--glass-border)", background: "var(--bg-base)", boxShadow: "var(--shadow-modal)", overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto" }}>

        {/* ── HEADER ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "10px 16px", borderBottom: "1px solid var(--surface-active)", background: "var(--surface-tint)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface-hover)", display: "grid", placeItems: "center" }}><Pencil size={13} style={{ color: "var(--text-secondary)" }} /></div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Gorsel Duzenleme</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}{dims ? ` · ${dims}` : ""}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "3px 4px", borderRadius: 8, border: "1px solid var(--glass-border)", background: "var(--bg-base)" }}>
              <button type="button" onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))} style={hdrBtn}><Minus size={12} /></button>
              <button type="button" onClick={() => setZoom(1)} style={{ ...hdrBtn, width: 42, fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{Math.round(zoom * 100)}%</button>
              <button type="button" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} style={hdrBtn}><Plus size={12} /></button>
              <button type="button" onClick={() => setZoom(1)} title="Sigdir" style={hdrBtn}><ZoomIn size={12} /></button>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} className="icon-button" style={{ width: 32, height: 32, borderRadius: 8 }} aria-label="Kapat"><X size={14} /></button>
          </div>
        </div>

        {/* ── BODY ── */}
        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px" }}>

          {/* Canvas */}
          <div style={{ position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--canvas-bg)" }}>

            {/* Floating toolbar */}
            <div style={{ position: "absolute", left: 12, top: 12, zIndex: 2, display: "grid", gap: 8, padding: 10, borderRadius: 14, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", backdropFilter: "blur(12px)", boxShadow: "var(--shadow-lg)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3 }}>
                {COLORS.map((c) => (
                  <button key={c.value} type="button" onClick={() => setColor(c.value)} title={c.label} style={{ width: 22, height: 22, borderRadius: 6, border: c.value === color ? "2px solid var(--accent)" : "1px solid var(--border-default)", background: c.value, cursor: "pointer", transition: "transform 80ms ease", transform: c.value === color ? "scale(1.15)" : "scale(1)" }} />
                ))}
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--text-muted)" }}><span>Boyut</span><span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{size}px</span></div>
                <input type="range" min={MIN_BRUSH} max={MAX_BRUSH} step={1} value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={submitting} style={{ width: "100%", accentColor: "var(--accent)" }} />
              </div>
              <div style={{ height: 1, background: "var(--surface-active)" }} />
              <button type="button" onClick={() => setStrokes((c) => c.slice(0, -1))} disabled={strokes.length === 0 || submitting} style={toolBtn}><RotateCcw size={11} />Geri al</button>
              <button type="button" onClick={() => { ref.current = null; setStrokes([]); }} disabled={strokes.length === 0 || submitting} style={toolBtn}><Trash2 size={11} />Temizle</button>
            </div>

            {/* Stroke counter */}
            {strokes.length > 0 ? (
              <div style={{ position: "absolute", right: 12, top: 12, zIndex: 2, display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{strokes.length} isaret</span>
              </div>
            ) : null}

            {/* Canvas */}
            <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "grid", placeItems: zoom <= 1 ? "center" : "start", padding: zoom > 1 ? 20 : 16 }}>
              <div
                onPointerDown={pd}
                onPointerMove={pm}
                onPointerUp={pu}
                onPointerCancel={pu}
                style={{ position: "relative", maxWidth: zoom <= 1 ? "100%" : undefined, maxHeight: zoom <= 1 ? "100%" : undefined, width: zoom <= 1 ? "fit-content" : undefined, display: "grid", placeItems: "center", borderRadius: 10, overflow: "hidden", cursor: submitting ? "progress" : "crosshair", touchAction: "none", transform: `scale(${zoom})`, transformOrigin: zoom <= 1 ? "center" : "top left", boxShadow: "var(--shadow-lg)" }}
              >
                <img src={d.previewUrl} alt={d.label} onLoad={ol} draggable={false} style={{ display: "block", width: "auto", height: "auto", maxWidth: zoom <= 1 ? "calc(100vw - 420px)" : undefined, maxHeight: zoom <= 1 ? "calc(100vh - 140px)" : undefined, userSelect: "none", pointerEvents: "none" }} />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
                  {strokes.map((s) =>
                    s.points.length === 1
                      ? <circle key={s.id} cx={s.points[0].x} cy={s.points[0].y} r={s.size * 0.5} fill={s.color} />
                      : <polyline key={s.id} points={svgPts(s.points)} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" />,
                  )}
                </svg>
              </div>
            </div>

            {/* Hint */}
            {strokes.length === 0 && !submitting ? (
              <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2, padding: "7px 14px", borderRadius: 10, background: "var(--glass-bg)", border: "1px solid var(--surface-active)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", pointerEvents: "none" }}>
                Gorselin uzerine cizerek degisiklik bolgesini isaretleyin · <strong style={{ color: "var(--text-secondary)" }}>Cmd+Z</strong> geri al
              </div>
            ) : null}
          </div>

          {/* Right panel */}
          <div style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", borderLeft: "1px solid var(--surface-active)", background: "var(--surface-tint)", minWidth: 0 }}>
            <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 16, display: "grid", gap: 16, alignContent: "start" }}>

              {/* Presets */}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Hazir talimatlar</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {PRESET_PROMPTS.map((cat) => (
                    <button key={cat.label} type="button" onClick={() => setPresetCat(cat.label)} style={{ padding: "4px 10px", borderRadius: 7, border: "1px solid " + (presetCat === cat.label ? "var(--accent)" : "var(--glass-border)"), background: presetCat === cat.label ? "var(--surface-hover)" : "var(--bg-base)", color: presetCat === cat.label ? "var(--accent)" : "var(--text-muted)", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 100ms ease" }}>
                      {cat.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "grid", gap: 4 }}>
                  {presets.map((p) => (
                    <button key={p} type="button" onClick={() => setPrompt((prev) => prev ? `${prev}\n${p}` : p)} disabled={submitting} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 9, border: "1px solid var(--surface-active)", background: "var(--bg-base)", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.4, cursor: "pointer", transition: "background 80ms ease" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Ozel talimat</div>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Degisiklik talimatini yaz veya hazir talimatlardan sec..." disabled={submitting} style={{ width: "100%", minHeight: 100, resize: "vertical", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--glass-border)", background: "var(--bg-base)", color: "var(--text-primary)", fontSize: 12, lineHeight: 1.7, fontFamily: '"IBM Plex Mono", "Menlo", monospace', outline: "none" }} />
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>Bos birakirsan sistem otomatik koruma talimati olusturur.</div>
              </div>

              {/* Aspect ratio */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>En boy orani</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {ASPECT_RATIOS.map((r) => (
                    <button key={r} type="button" onClick={() => setAr(r)} disabled={submitting} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid " + (r === ar ? "var(--accent)" : "var(--glass-border)"), background: r === ar ? "var(--surface-hover)" : "var(--bg-base)", color: r === ar ? "var(--accent)" : "var(--text-muted)", fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 100ms ease" }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--surface-active)", background: "var(--bg-base)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nasil calisir?</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>Kaynak gorsel korunur. Isaretler rehber olarak gonderilir. Model yalnizca isaretli bolgelerde degisiklik yapar.</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--surface-active)" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{strokes.length > 0 ? `${strokes.length} isaret` : "Koruyarak duzenle"}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary" style={{ padding: "8px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8 }}>Vazgec</button>
                <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting} className="btn-primary" style={{ padding: "8px 18px", fontSize: 12, fontWeight: 600, borderRadius: 8 }}>
                  {submitting ? <LoaderCircle className="spin-slow" size={14} /> : <Pencil size={14} />}
                  {submitting ? "Kuyrukta..." : "Duzenleme uret"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── STATUS BAR ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 16px", borderTop: "1px solid var(--surface-hover)", background: "var(--surface-tint)", fontSize: 10, color: "var(--text-muted)" }}>
          <div style={{ display: "flex", gap: 12 }}><span>Nano Banana 2</span>{dims ? <span>{dims}</span> : null}<span>{ar}</span></div>
          <div style={{ display: "flex", gap: 12 }}><span>{strokes.length} isaret</span><span>Zum {Math.round(zoom * 100)}%</span></div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ STYLES ═══════════ */

const hdrBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 26, height: 26, borderRadius: 6, border: "none", background: "transparent",
  color: "var(--text-secondary)", cursor: "pointer", padding: 0,
};

const toolBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "5px 8px", borderRadius: 7, border: "none",
  background: "var(--surface-hover)", color: "var(--text-secondary)",
  cursor: "pointer", fontSize: 10, fontWeight: 500, width: "100%",
  transition: "background 80ms ease",
};
