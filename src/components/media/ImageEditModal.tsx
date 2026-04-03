import {
  useCallback,
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
  CircleDot,
  Eraser,
  Eye,
  EyeOff,
  Grid3X3,
  Hand,
  History,
  Layers,
  LoaderCircle,
  MousePointer2,
  Paintbrush,
  Pencil,
  RotateCcw,
  RotateCw,
  Send,
  SplitSquareHorizontal,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
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
  model?: string;
};

/* ═══════════ INTERNAL TYPES ═══════════ */

type Point = { x: number; y: number };
type ToolType = "brush" | "eraser" | "select";

type Stroke = {
  id: string;
  tool: ToolType;
  color: string;
  size: number;
  opacity: number;
  points: Point[];
  visible: boolean;
};

type HistoryEntry = {
  strokes: Stroke[];
  label: string;
  timestamp: number;
};

type ImageEditModalProps = {
  draft: ImageEditModalDraft | null;
  projectFolderPath: string;
  dialogTitle: string;
  submitting: boolean;
  availableModels?: Array<{ id: string; label: string }>;
  defaultModel?: string | null;
  guideFilePrefix?: string;
  onClose: () => void;
  onSubmit: (payload: ImageEditSubmitPayload) => Promise<void>;
};

/* ═══════════ CONSTANTS ═══════════ */

const COLORS: Array<{ value: string; label: string; hex: string }> = [
  { value: "rgba(245,158,11,0.96)", label: "Amber", hex: "#f59e0b" },
  { value: "rgba(59,130,246,0.94)", label: "Mavi", hex: "#3b82f6" },
  { value: "rgba(239,68,68,0.94)", label: "Kirmizi", hex: "#ef4444" },
  { value: "rgba(34,197,94,0.94)", label: "Yesil", hex: "#22c55e" },
  { value: "rgba(168,85,247,0.94)", label: "Mor", hex: "#a855f7" },
  { value: "rgba(236,72,153,0.94)", label: "Pembe", hex: "#ec4899" },
  { value: "rgba(255,255,255,0.96)", label: "Beyaz", hex: "#ffffff" },
  { value: "rgba(30,30,30,0.96)", label: "Siyah", hex: "#1e1e1e" },
  { value: "rgba(14,165,233,0.94)", label: "Cyan", hex: "#0ea5e9" },
  { value: "rgba(251,191,36,0.94)", label: "Sari", hex: "#fbbf24" },
];

const ASPECT_RATIOS: ImageEditAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:2"];
const ASPECT_RATIO_VALUES: Record<ImageEditAspectRatio, number> = {
  "1:1": 1, "16:9": 16 / 9, "9:16": 9 / 16, "4:3": 4 / 3, "3:2": 3 / 2,
};

const PRESET_PROMPTS: Array<{ label: string; icon: string; prompts: string[] }> = [
  { label: "Duzeltme", icon: "🔧", prompts: ["Isigi dogal hale getir", "Renkleri canlandir", "Kontrasti artir", "Lens bozulmasini duzelt", "Ton dengesini iyilestir", "Beyaz dengesini toparla", "Keskinligi secici olarak artir"] },
  { label: "Ekleme", icon: "✨", prompts: ["Atmosferik sis ekle", "Lens flare ekle", "Doku ve grain ekle", "Dramatik gokyuzu ekle", "Isik husmeleri ekle", "Yagmur izleri ekle", "Arka plana hafif toz parcaciklari ekle"] },
  { label: "Cikarma", icon: "🧹", prompts: ["Isaretli nesneyi kaldir", "Golgeleri temizle", "Dagitici ogeleri sil", "Logo veya metin kaldir", "Arka plan temizle", "Kenar parazitlerini kaldir", "Cift gorunumu temizle"] },
  { label: "Karakter", icon: "👤", prompts: ["Yuz detayini iyilestir", "Goz parlakligi artir", "Cilt tonunu duzelt", "Sac detayi artir", "Mimik ifadesini guclendir", "Bakis yonunu netlestir", "Yuz anatomisini koruyarak toparla"] },
  { label: "Sahne", icon: "🎬", prompts: ["Derinlik algisini artir", "Bokeh efektini guclendir", "Sinematik renk tonlamasi", "Atmosfer ve mood ekle", "Isik yonunu degistir", "Perspektifi sabit tutarak sahneyi toparla", "Kadraj dengesini bozmadan mekan dokusunu zenginlestir"] },
];

const MIN_BRUSH = 2;
const MAX_BRUSH = 64;
const MIN_OPACITY = 0.1;
const MAX_OPACITY = 1.0;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const MAX_HISTORY = 50;
const RECENT_PRESET_STORAGE_KEY = "cineai:image-edit-recent-presets";
const CANVAS_VIEWPORT_PADDING = 32;

/* ═══════════ HELPERS ═══════════ */

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clamp01(v: number): number { return clamp(v, 0, 1); }

function getFitZoom(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number | null,
  imageHeight: number | null,
): number {
  if (!imageWidth || !imageHeight || viewportWidth <= 0 || viewportHeight <= 0) return 1;
  const zoom = Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
  return clamp(zoom, ZOOM_STEPS[0], 1);
}

/** Catmull-Rom → cubic bezier SVG path for smooth strokes */
function smoothPath(pts: Point[], size = 0.01): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;

  // Simplify points if too dense
  const tolerance = Math.max(0.0002, size / 5000);
  const simplified = simplifyPoints(pts, tolerance);
  if (simplified.length < 2) return `M${pts[0].x},${pts[0].y}`;

  let d = `M${simplified[0].x},${simplified[0].y}`;
  for (let i = 0; i < simplified.length - 1; i++) {
    const p0 = simplified[Math.max(0, i - 1)];
    const p1 = simplified[i];
    const p2 = simplified[Math.min(simplified.length - 1, i + 1)];
    const p3 = simplified[Math.min(simplified.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += `C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

function simplifyPoints(pts: Point[], tolerance: number): Point[] {
  if (pts.length < 3) return pts;
  const result: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const dx = pts[i].x - result[result.length - 1].x;
    const dy = pts[i].y - result[result.length - 1].y;
    if (dx * dx + dy * dy > tolerance * tolerance) {
      result.push(pts[i]);
    }
  }
  result.push(pts[pts.length - 1]);
  return result;
}


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

function formatShortcut(key: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  return key.replace("Cmd", isMac ? "⌘" : "Ctrl");
}

export function buildDefaultImageEditPrompt(prompt: string): string {
  const t = prompt.trim();
  const p = "Preserve the original image composition, subject identity, camera angle, lighting, and all unmarked regions as closely as possible. Use the markup as strong local guidance, keep the overall frame stable, and avoid redesigning the shot.";
  return t.length > 0
    ? `${t}\n${p}`
    : "Use the markup as strong local guidance, keep the existing shot composition stable, and avoid redesigning the frame.";
}

/* ═══════════ COMPONENT ═══════════ */

export function ImageEditModal({
  draft, projectFolderPath, dialogTitle, submitting, availableModels = [], defaultModel = null, guideFilePrefix = "guide_still", onClose, onSubmit,
}: ImageEditModalProps) {
  /* ── State ── */
  const defaultEditModel = defaultModel?.trim() || availableModels[0]?.id || "";
  const [prompt, setPrompt] = useState("");
  const [ar, setAr] = useState<ImageEditAspectRatio>("16:9");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<ToolType>("brush");
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(16);
  const [opacity, setOpacity] = useState(1.0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [rw, setRw] = useState<number | null>(null);
  const [rh, setRh] = useState<number | null>(null);
  const [presetCat, setPresetCat] = useState("Duzeltme");
  const [showGrid, setShowGrid] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [strength, setStrength] = useState(0.75);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [submissionPhase, setSubmissionPhase] = useState<"idle" | "building" | "queueing">("idle");
  const [compareSplit, setCompareSplit] = useState(0.5);
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(defaultEditModel);

  /* ── Refs ── */
  const activeStrokeRef = useRef<string | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const canvasStageRef = useRef<HTMLDivElement>(null);

  /* ── History management ── */
  const pushHistory = useCallback((nextStrokes: Stroke[], label: string) => {
    const history = historyRef.current;
    const idx = historyIndexRef.current;
    // Trim future entries
    historyRef.current = history.slice(0, idx + 1);
    historyRef.current.push({ strokes: nextStrokes.map(s => ({ ...s })), label, timestamp: Date.now() });
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
  }, []);

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx <= 0) {
      setStrokes([]);
      historyIndexRef.current = -1;
      return;
    }
    historyIndexRef.current = idx - 1;
    setStrokes(historyRef.current[idx - 1].strokes.map(s => ({ ...s })));
  }, []);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    const history = historyRef.current;
    if (idx >= history.length - 1) return;
    historyIndexRef.current = idx + 1;
    setStrokes(history[idx + 1].strokes.map(s => ({ ...s })));
  }, []);

  const canUndo = historyIndexRef.current >= 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  /* ── Zoom helpers ── */
  const zoomIn = useCallback(() => {
    setZoom(z => {
      const next = ZOOM_STEPS.find(s => s > z);
      return next ?? z;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => {
      const prev = [...ZOOM_STEPS].reverse().find(s => s < z);
      return prev ?? z;
    });
  }, []);

  const zoomFit = useCallback(() => {
    const bounds = canvasStageRef.current?.getBoundingClientRect();
    const fitZoom = getFitZoom(
      Math.max(240, (bounds?.width ?? 0) - CANVAS_VIEWPORT_PADDING),
      Math.max(240, (bounds?.height ?? 0) - CANVAS_VIEWPORT_PADDING),
      rw,
      rh,
    );
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  }, [rh, rw]);

  /* ── Reset on new draft ── */
  useEffect(() => {
    if (!draft) return;
    setPrompt(""); setAr(inferAR(draft.width, draft.height)); setStrokes([]); setTool("brush");
    setColor(COLORS[0].value); setSize(16); setOpacity(1.0); setZoom(1); setPan({ x: 0, y: 0 });
    setRw(draft.width); setRh(draft.height); setShowGrid(false); setShowCompare(false);
    setShowHistory(false); setShowLayers(false); setStrength(0.75);
    setSubmissionPhase("idle"); setCompareSplit(0.5);
    setSelectedModel(defaultEditModel);
    historyRef.current = []; historyIndexRef.current = -1;
  }, [defaultEditModel, draft?.id, draft?.absolutePath, draft?.width, draft?.height]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_PRESET_STORAGE_KEY);
      const nextPrompts = raw ? JSON.parse(raw) as unknown : [];
      setRecentPrompts(
        Array.isArray(nextPrompts)
          ? nextPrompts.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 6)
          : [],
      );
    } catch {
      setRecentPrompts([]);
    }
  }, [draft?.id]);

  useEffect(() => {
    if (!draft || !rw || !rh) return;
    const raf = window.requestAnimationFrame(() => zoomFit());
    return () => window.cancelAnimationFrame(raf);
  }, [draft?.id, rh, rw, zoomFit]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    if (!draft) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) { onClose(); return; }

      const mod = e.metaKey || e.ctrlKey;

      // Cmd+Z undo, Cmd+Shift+Z redo
      if (mod && e.key === "z" && !e.shiftKey && !submitting) { e.preventDefault(); undo(); return; }
      if (mod && e.key === "z" && e.shiftKey && !submitting) { e.preventDefault(); redo(); return; }
      if (mod && e.key === "y" && !submitting) { e.preventDefault(); redo(); return; }

      // Tool shortcuts
      if (!mod && !e.shiftKey && !e.altKey) {
        if (e.key === "b" || e.key === "B") { setTool("brush"); return; }
        if (e.key === "e" || e.key === "E") { setTool("eraser"); return; }
        if (e.key === "v" || e.key === "V") { setTool("select"); return; }
        if (e.key === "g" || e.key === "G") { setShowGrid(g => !g); return; }
        if (e.key === "[") { setSize(s => Math.max(MIN_BRUSH, s - 2)); return; }
        if (e.key === "]") { setSize(s => Math.min(MAX_BRUSH, s + 2)); return; }
        if (e.key === "0") { zoomFit(); return; }
        if (e.key === "+" || e.key === "=") { zoomIn(); return; }
        if (e.key === "-") { zoomOut(); return; }
        // Space for pan mode
        if (e.key === " ") { e.preventDefault(); setIsPanning(true); return; }
      }
    };

    const hu = (e: KeyboardEvent) => {
      if (e.key === " ") { setIsPanning(false); }
    };

    window.addEventListener("keydown", h);
    window.addEventListener("keyup", hu);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("keyup", hu); };
  }, [draft, onClose, submitting, undo, redo, zoomFit, zoomIn, zoomOut]);

  /* ── Wheel zoom ── */
  useEffect(() => {
    const container = canvasStageRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn(); else zoomOut();
      }
    };
    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, [zoomIn, zoomOut]);

  if (!draft) return null;
  const d = draft;
  const canSubmit = prompt.trim().length > 0 || strokes.filter(s => s.visible).length > 0;
  const dims = rw && rh ? `${rw} x ${rh}` : null;
  const presetCategories = recentPrompts.length > 0
    ? [{ label: "Son kullanilan", icon: "🕘", prompts: recentPrompts }, ...PRESET_PROMPTS]
    : PRESET_PROMPTS;
  const presets = presetCategories.find((c) => c.label === presetCat)?.prompts ?? [];
  const strokeCount = strokes.filter(s => s.visible).length;
  const canvasSurface = canvasStageRef.current?.querySelector("[data-canvas-surface]") as HTMLElement | null;
  const canvasBounds = canvasSurface?.getBoundingClientRect();
  const maxDim = canvasBounds ? Math.max(canvasBounds.width, canvasBounds.height) : 800;
  const cursorRadius = size / maxDim / 2;

  function rememberPreset(promptText: string) {
    const normalized = promptText.trim();
    if (!normalized) return;
    const nextPrompts = [normalized, ...recentPrompts.filter((entry) => entry !== normalized)].slice(0, 6);
    setRecentPrompts(nextPrompts);
    try {
      window.localStorage.setItem(RECENT_PRESET_STORAGE_KEY, JSON.stringify(nextPrompts));
    } catch {
      // ignore storage failures in desktop runtime
    }
  }

  /* ── Pointer handlers ── */
  function gp(e: ReactPointerEvent<HTMLDivElement>): Point | null {
    const el = e.currentTarget.querySelector("[data-canvas-surface]") as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }

  function pd(e: ReactPointerEvent<HTMLDivElement>) {
    if (submitting) return;

    // Pan mode
    if (isPanning || e.button === 1) {
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (tool === "select") return;
    const pt = gp(e); if (!pt) return;
    const canvasSurface = e.currentTarget.querySelector("[data-canvas-surface]") as HTMLElement | null;
    const rc = canvasSurface?.getBoundingClientRect();
    const maxDim = rc ? Math.max(rc.width, rc.height) : 800;
    const id = createId(); activeStrokeRef.current = id;
    const newStroke: Stroke = {
      id, tool, color: tool === "eraser" ? "rgba(0,0,0,0)" : color,
      size: size / maxDim, opacity: tool === "eraser" ? 1 : opacity,
      points: [pt], visible: true,
    };
    setStrokes((c) => [...c, newStroke]);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function pm(e: ReactPointerEvent<HTMLDivElement>) {
    // Update cursor pos
    const pt = gp(e);
    if (pt) setCursorPos(pt);

    // Pan mode
    if (panStart) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const id = activeStrokeRef.current; if (!id || submitting) return;
    if (!pt) return;
    setStrokes((c) => c.map((s) => s.id === id ? { ...s, points: [...s.points, pt] } : s));
  }

  function pu(e: ReactPointerEvent<HTMLDivElement>) {
    if (panStart) {
      setPanStart(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }

    const id = activeStrokeRef.current;
    if (id) {
      activeStrokeRef.current = null;
      // Push to history
      pushHistory(strokes, tool === "eraser" ? "Silgi" : "Firca");
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function ol(e: SyntheticEvent<HTMLImageElement>) {
    const w = e.currentTarget.naturalWidth, h = e.currentTarget.naturalHeight;
    if (!w || !h) return;
    setRw(w); setRh(h);
    setAr((c) => strokes.length > 0 || prompt.trim().length > 0 ? c : inferAR(w, h));
  }

  function toggleStrokeVisibility(strokeId: string) {
    setStrokes(prev => prev.map(s => s.id === strokeId ? { ...s, visible: !s.visible } : s));
  }

  function deleteStroke(strokeId: string) {
    setStrokes(prev => prev.filter(s => s.id !== strokeId));
    pushHistory(strokes.filter(s => s.id !== strokeId), "Katman silindi");
  }

  async function buildRefs(): Promise<string[]> {
    const visibleBrushStrokes = strokes.filter(s => s.visible && s.tool === "brush");
    if (visibleBrushStrokes.length === 0) return [d.absolutePath];
    const bytes = await readFile(d.absolutePath);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime(d.absolutePath) }));
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new window.Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("Gorsel yuklenemedi.")); i.src = url; });
    try {
      const w = rw ?? img.naturalWidth, h = rh ?? img.naturalHeight;
      if (!w || !h) throw new Error("Boyut okunamadi.");
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const ctx = c.getContext("2d"); if (!ctx) throw new Error("Tuval olusturulamadi.");
      ctx.drawImage(img, 0, 0, w, h); ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const s of visibleBrushStrokes) {
        if (s.points.length === 0) continue;
        ctx.globalAlpha = s.opacity;
        ctx.beginPath(); ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(3, s.size * Math.max(w, h));
        ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
        for (const p of s.points.slice(1)) ctx.lineTo(p.x * w, p.y * h);
        if (s.points.length === 1) ctx.lineTo(s.points[0].x * w, s.points[0].y * h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
      setSubmissionPhase("building");
      const refs = await buildRefs();
      setSubmissionPhase("queueing");
      await onSubmit({
        prompt: buildDefaultImageEditPrompt(prompt),
        aspectRatio: ar,
        referenceImagePaths: refs,
        model: selectedModel || undefined,
      });
      setSubmissionPhase("idle");
    } catch (err) {
      setSubmissionPhase("idle");
      await message(err instanceof Error ? err.message : "Duzenleme kuyruga eklenemedi.", { title: dialogTitle, kind: "error" });
    }
  }

  /* ── Cursor style ── */
  const cursorStyle = isPanning
    ? "grab"
    : tool === "eraser"
      ? eraserCursor
      : tool === "brush"
        ? "crosshair"
        : "default";

  /* ═══════════ RENDER ═══════════ */
  return (
    <div onClick={onClose} style={backdropStyle}>
      <div onClick={(e) => e.stopPropagation()} style={shellStyle}>

        {/* ── HEADER ── */}
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={headerIconStyle}>
              <Pencil size={14} style={{ color: "var(--accent)" }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Gorsel Duzenleme</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}{dims ? ` · ${dims}` : ""}</div>
            </div>
          </div>

          {/* Center toolbar */}
          <div style={headerCenterStyle}>
            {/* Tool switcher */}
            <div style={toolGroupStyle}>
              <ToolButton icon={<Paintbrush size={14} />} label="Firca" shortcut="B" active={tool === "brush"} onClick={() => setTool("brush")} />
              <ToolButton icon={<Eraser size={14} />} label="Silgi" shortcut="E" active={tool === "eraser"} onClick={() => setTool("eraser")} />
              <ToolButton icon={<Hand size={14} />} label="Kaydir" shortcut="Bosluk" active={isPanning} onClick={() => setIsPanning(p => !p)} />
            </div>

            <div style={toolDividerStyle} />

            {/* View controls */}
            <div style={toolGroupStyle}>
              <ToolButton icon={<ZoomOut size={13} />} label="Kucult" onClick={zoomOut} />
              <button type="button" onClick={zoomFit} style={zoomLabelStyle} title="Sigdir (0)">
                {Math.round(zoom * 100)}%
              </button>
              <ToolButton icon={<ZoomIn size={13} />} label="Buyut" onClick={zoomIn} />
            </div>

            <div style={toolDividerStyle} />

            {/* Toggle controls */}
            <div style={toolGroupStyle}>
              <ToolButton icon={<Grid3X3 size={13} />} label="Izgara" shortcut="G" active={showGrid} onClick={() => setShowGrid(g => !g)} />
              <ToolButton icon={<SplitSquareHorizontal size={13} />} label="Karsilastir" active={showCompare} onClick={() => setShowCompare(c => !c)} />
              <ToolButton icon={<Layers size={13} />} label="Katmanlar" active={showLayers} onClick={() => setShowLayers(l => !l)} />
              <ToolButton icon={<History size={13} />} label="Gecmis" active={showHistory} onClick={() => setShowHistory(h => !h)} />
            </div>
          </div>

          {/* Right actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Undo/Redo */}
            <div style={toolGroupStyle}>
              <ToolButton icon={<RotateCcw size={13} />} label="Geri al" shortcut="Cmd+Z" onClick={undo} disabled={!canUndo || submitting} />
              <ToolButton icon={<RotateCw size={13} />} label="Ileri al" shortcut="Cmd+Shift+Z" onClick={redo} disabled={!canRedo || submitting} />
            </div>
            <button type="button" onClick={onClose} disabled={submitting} style={closeButtonStyle} aria-label="Kapat"><X size={15} /></button>
          </div>
        </header>

        {/* ── BODY ── */}
        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: showLayers || showHistory ? "minmax(0, 1fr) 320px" : "minmax(0, 1fr) 290px" }}>

          {/* ─── Canvas area ─── */}
          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              background: "var(--canvas-bg, #0c0c0e)",
              display: "grid",
              gridTemplateColumns: "196px minmax(0, 1fr)",
              gap: 16,
              padding: 16,
            }}
          >

            {/* ── Floating brush panel (left) ── */}
            <div style={{ minWidth: 0, display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
              <div style={{ ...floatingPanelStyle, position: "sticky", top: 0 }}>
              {/* Colors */}
              <div style={{ padding: "10px 10px 6px" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Renk</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
                  {COLORS.map((c) => (
                    <button key={c.value} type="button" onClick={() => setColor(c.value)} title={c.label}
                      style={{
                        width: 24, height: 24, borderRadius: 7, cursor: "pointer", transition: "all 100ms ease",
                        border: c.value === color ? "2.5px solid var(--accent)" : "2px solid rgba(255,255,255,0.06)",
                        background: c.value, transform: c.value === color ? "scale(1.12)" : "scale(1)",
                        boxShadow: c.value === color ? `0 0 12px ${c.hex}40` : "none",
                      }} />
                  ))}
                </div>
              </div>

              <div style={panelDividerStyle} />

              {/* Brush size */}
              <div style={{ padding: "6px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>Boyut</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 5 }}>{size}px</span>
                </div>
                <input type="range" min={MIN_BRUSH} max={MAX_BRUSH} step={1} value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={submitting} style={sliderStyle} />
                <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
                  <div style={{ width: Math.max(4, size * 0.6), height: Math.max(4, size * 0.6), borderRadius: 999, background: tool === "eraser" ? "rgba(255,255,255,0.3)" : color, transition: "all 120ms ease", border: "1px solid rgba(255,255,255,0.1)" }} />
                </div>
              </div>

              <div style={panelDividerStyle} />

              {/* Opacity */}
              <div style={{ padding: "6px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>Opaklik</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: 5 }}>{Math.round(opacity * 100)}%</span>
                </div>
                <input type="range" min={MIN_OPACITY} max={MAX_OPACITY} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} disabled={submitting || tool === "eraser"} style={sliderStyle} />
              </div>

              <div style={panelDividerStyle} />

              {/* Edit strength */}
              <div style={{ padding: "6px 10px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>Guc</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", fontVariantNumeric: "tabular-nums", background: "rgba(245,158,11,0.08)", padding: "2px 6px", borderRadius: 5 }}>{Math.round(strength * 100)}%</span>
                </div>
                <input type="range" min={0.1} max={1.0} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} disabled={submitting} style={sliderStyle} />
                <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>Dusuk = ince retus, Yuksek = agresif degisim</div>
              </div>

              <div style={panelDividerStyle} />

              {/* Quick actions */}
              <div style={{ padding: "6px 10px 10px", display: "grid", gap: 3 }}>
                <button type="button" onClick={() => { setStrokes([]); historyRef.current = []; historyIndexRef.current = -1; }} disabled={strokes.length === 0 || submitting} style={panelActionBtn}>
                  <Trash2 size={11} /><span>Tumu temizle</span>
                </button>
              </div>
            </div>

            {/* ── Stroke counter badge ── */}
          </div>

          <div
            ref={canvasStageRef}
            style={{
              position: "relative",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              borderRadius: 18,
              background: "color-mix(in srgb, var(--bg-base) 88%, transparent)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {strokeCount > 0 && (
              <div style={strokeBadgeStyle}>
                <CircleDot size={10} style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{strokeCount}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>isaret</span>
              </div>
            )}

            {/* ── Canvas viewport ── */}
            <div
              style={{
                position: "absolute", inset: 0, overflow: "hidden",
                display: "grid", placeItems: zoom <= 1 && pan.x === 0 && pan.y === 0 ? "center" : "start",
                padding: zoom > 1 ? 20 : 16,
              }}
            >
              <div
                onPointerDown={pd}
                onPointerMove={pm}
                onPointerUp={pu}
                onPointerCancel={pu}
                onPointerLeave={() => setCursorPos(null)}
                style={{
                  position: "relative",
                  width: rw ?? undefined,
                  height: rh ?? undefined,
                  display: "grid", placeItems: "center",
                  borderRadius: 8, overflow: "hidden",
                  cursor: cursorStyle, touchAction: "none",
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: zoom <= 1 ? "center" : "top left",
                  boxShadow: "0 8px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)",
                }}
              >
                {/* Original image */}
                <img src={d.previewUrl} alt={d.label} onLoad={ol} draggable={false}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    userSelect: "none", pointerEvents: "none",
                  }}
                />

                {/* SVG stroke canvas - data attribute for pointer calculation */}
                <svg data-canvas-surface viewBox="0 0 1 1" preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
                  {/* Eraser strokes as mask */}
                  <defs>
                    <mask id="eraserMask">
                      <rect x="0" y="0" width="1" height="1" fill="white" />
                      {strokes.filter(s => s.tool === "eraser" && s.visible).map((s) =>
                        s.points.length === 1
                          ? <circle key={s.id} cx={s.points[0].x} cy={s.points[0].y} r={s.size * 0.5} fill="black" />
                          : <path key={s.id} d={smoothPath(s.points, s.size)} fill="none" stroke="black" strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" />,
                      )}
                    </mask>
                    <clipPath id="compareClip">
                      <rect x={showCompare ? compareSplit : 0} y="0" width={showCompare ? 1 - compareSplit : 1} height="1" />
                    </clipPath>
                  </defs>

                  {/* Brush strokes with eraser mask */}
                  <g
                    clipPath={showCompare ? "url(#compareClip)" : undefined}
                    mask={strokes.some(s => s.tool === "eraser" && s.visible) ? "url(#eraserMask)" : undefined}
                  >
                    {strokes.filter(s => s.tool === "brush" && s.visible).map((s) =>
                      s.points.length === 1
                        ? <circle key={s.id} cx={s.points[0].x} cy={s.points[0].y} r={s.size * 0.5} fill={s.color} opacity={s.opacity} />
                        : <path key={s.id} d={smoothPath(s.points, s.size)} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" opacity={s.opacity} />,
                    )}
                  </g>

                  {/* Grid overlay */}
                  {showGrid && (
                    <g opacity={0.15} stroke="white" strokeWidth={0.001}>
                      {[1/3, 2/3].map(v => (
                        <line key={`gv${v}`} x1={v} y1={0} x2={v} y2={1} />
                      ))}
                      {[1/3, 2/3].map(v => (
                        <line key={`gh${v}`} x1={0} y1={v} x2={1} y2={v} />
                      ))}
                      <line x1={0.5} y1={0} x2={0.5} y2={1} strokeDasharray="0.01 0.01" opacity={0.3} />
                      <line x1={0} y1={0.5} x2={1} y2={0.5} strokeDasharray="0.01 0.01" opacity={0.3} />
                    </g>
                  )}

                  {/* Brush cursor preview */}
                  {cursorPos && !isPanning && tool !== "select" && (
                    <g>
                      <circle cx={cursorPos.x} cy={cursorPos.y} r={cursorRadius} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={0.001} />
                      {tool === "brush" && (
                        <circle cx={cursorPos.x} cy={cursorPos.y} r={cursorRadius} fill={color} opacity={opacity * 0.25} />
                      )}
                    </g>
                  )}
                </svg>

                {showCompare && (
                  <>
                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${compareSplit * 100}%`, width: 2, background: "var(--on-accent)", transform: "translateX(-1px)" }} />
                    </div>
                    <input
                      aria-label="Karsilastirma bolucu"
                      max={100}
                      min={0}
                      onChange={(e) => setCompareSplit(Number(e.target.value) / 100)}
                      style={{ position: "absolute", left: 16, right: 16, bottom: 14 }}
                      type="range"
                      value={Math.round(compareSplit * 100)}
                    />
                  </>
                )}
              </div>
            </div>

            {/* ── Hint overlay ── */}
            {strokeCount === 0 && !submitting && (
              <div style={hintStyle}>
                Gorselin uzerine cizerek degisiklik bolgesini isaretleyin · <strong style={{ color: "var(--text-secondary)" }}>{formatShortcut("Cmd+Z")}</strong> geri al · <strong style={{ color: "var(--text-secondary)" }}>B</strong> firca · <strong style={{ color: "var(--text-secondary)" }}>E</strong> silgi
              </div>
            )}
          </div>

          {/* ─── Right panel ─── */}
            {zoom > 1 && rw && rh && (
              <button
                aria-label="Mini haritayi ortala"
                className="floating-glass"
                onClick={() => setPan({ x: 0, y: 0 })}
                style={{
                  position: "absolute",
                  left: 16,
                  bottom: 16,
                  zIndex: 4,
                  padding: 8,
                  borderRadius: 14,
                  cursor: "pointer",
                }}
                type="button"
              >
                <div style={{ position: "relative", width: 120, aspectRatio: `${rw} / ${rh}`, overflow: "hidden", borderRadius: 10 }}>
                  <img src={d.previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.max(0, Math.min(100 - 100 / zoom, (-pan.x / Math.max(1, maxDim * zoom)) * 100))}%`,
                      top: `${Math.max(0, Math.min(100 - 100 / zoom, (-pan.y / Math.max(1, maxDim * zoom)) * 100))}%`,
                      width: `${100 / zoom}%`,
                      height: `${100 / zoom}%`,
                      border: "1px solid var(--accent)",
                      background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                    }}
                  />
                </div>
              </button>
            )}
          </div>
          <div style={rightPanelStyle}>
            {/* Layers panel (shown above presets when active) */}
            {showLayers && (
              <div style={rightSectionStyle}>
                <div style={sectionHeaderStyle}>
                  <Layers size={12} style={{ color: "var(--accent)" }} />
                  <span>Katmanlar</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>{strokeCount}</span>
                </div>
                <div style={{ maxHeight: 180, overflowY: "auto", display: "grid", gap: 2 }}>
                  {strokes.length === 0 ? (
                    <div style={{ padding: "14px 0", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>Henuz katman yok</div>
                  ) : (
                    [...strokes].reverse().map((s, i) => (
                      <div key={s.id} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8,
                        background: s.visible ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.01)",
                        opacity: s.visible ? 1 : 0.4,
                      }}>
                        <div style={{ width: 14, height: 14, borderRadius: 4, background: s.tool === "eraser" ? "repeating-conic-gradient(#444 0% 25%, #666 0% 50%) 50% / 6px 6px" : s.color, border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 10, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.tool === "eraser" ? "Silgi" : "Firca"} #{strokes.length - i}
                        </span>
                        <button type="button" onClick={() => toggleStrokeVisibility(s.id)} style={layerActionBtn}>
                          {s.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                        </button>
                        <button type="button" onClick={() => deleteStroke(s.id)} style={layerActionBtn}>
                          <X size={10} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* History panel */}
            {showHistory && (
              <div style={rightSectionStyle}>
                <div style={sectionHeaderStyle}>
                  <History size={12} style={{ color: "var(--accent)" }} />
                  <span>Gecmis</span>
                </div>
                <div style={{ maxHeight: 160, overflowY: "auto", display: "grid", gap: 2 }}>
                  {historyRef.current.length === 0 ? (
                    <div style={{ padding: "14px 0", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>Gecmis bos</div>
                  ) : (
                    [...historyRef.current].reverse().map((entry, i) => {
                      const realIdx = historyRef.current.length - 1 - i;
                      const isCurrent = realIdx === historyIndexRef.current;
                      return (
                        <div key={`${entry.timestamp}-${i}`} style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8,
                          background: isCurrent ? "rgba(245,158,11,0.08)" : "transparent",
                          borderLeft: isCurrent ? "2px solid var(--accent)" : "2px solid transparent",
                        }}>
                          <span style={{ fontSize: 10, color: isCurrent ? "var(--accent)" : "var(--text-secondary)" }}>{entry.label}</span>
                          <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: "auto" }}>
                            {new Date(entry.timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Scrollable content */}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "14px 14px 0", display: "grid", gap: 14, alignContent: "start" }}>

              {/* Presets */}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={sectionHeaderStyle}>
                  <MousePointer2 size={12} style={{ color: "var(--accent)" }} />
                  <span>Hazir talimatlar</span>
                </div>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {presetCategories.map((cat) => (
                    <button key={cat.label} type="button" onClick={() => setPresetCat(cat.label)}
                      style={{
                        padding: "5px 10px", borderRadius: 8, cursor: "pointer", transition: "all 120ms ease", fontSize: 11, fontWeight: 600,
                        border: presetCat === cat.label ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.06)",
                        background: presetCat === cat.label ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.02)",
                        color: presetCat === cat.label ? "var(--accent)" : "var(--text-muted)",
                      }}>
                      <span style={{ marginRight: 4 }}>{cat.icon}</span>{cat.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "grid", gap: 3 }}>
                  {presets.map((p) => (
                    <button key={p} type="button" onClick={() => { rememberPreset(p); setPrompt((prev) => prev ? `${prev}\n${p}` : p); }} disabled={submitting}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 11px", borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.02)",
                        color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.4, cursor: "pointer",
                        transition: "all 80ms ease",
                      }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={sectionHeaderStyle}>
                  <Pencil size={12} style={{ color: "var(--accent)" }} />
                  <span>Ozel talimat</span>
                  {prompt.trim().length > 0 && (
                    <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>{prompt.trim().length} karakter</span>
                  )}
                </div>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Degisiklik talimatini yaz veya hazir talimatlardan sec..." disabled={submitting}
                  style={textareaStyle} />
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>Bos birakirsan sistem otomatik koruma talimati olusturur.</div>
              </div>

              {/* Aspect ratio */}
              <div style={{ display: "grid", gap: 6 }}>
                <div style={sectionHeaderStyle}>
                  <span>En boy orani</span>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {ASPECT_RATIOS.map((r) => (
                    <button key={r} type="button" onClick={() => setAr(r)} disabled={submitting}
                      style={{
                        padding: "6px 12px", borderRadius: 8, cursor: "pointer", transition: "all 100ms ease", fontSize: 11, fontWeight: 700,
                        border: r === ar ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.06)",
                        background: r === ar ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.02)",
                        color: r === ar ? "var(--accent)" : "var(--text-muted)",
                      }}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {availableModels.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={sectionHeaderStyle}>
                    <span>Uretim modeli</span>
                  </div>
                  <select
                    aria-label="Duzenleme modeli"
                    disabled={submitting}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    style={textareaStyle}
                    value={selectedModel}
                  >
                    {availableModels.map((modelOption) => (
                      <option key={modelOption.id} value={modelOption.id}>
                        {modelOption.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Info card */}
              <div style={{
                padding: "10px 12px", borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.04)",
                background: "linear-gradient(135deg, rgba(245,158,11,0.03), rgba(59,130,246,0.02))",
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 4, letterSpacing: "0.04em" }}>Nasil calisir?</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6 }}>Kaynak gorsel taban olarak kullanilir. Isaretler guclu rehber olarak gonderilir. Model kompozisyonu korumaya calisir ama sonuc yine de yeniden uretilen bir varyanttir.</div>
              </div>

              {/* Keyboard shortcuts */}
              <div style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.03)", background: "rgba(255,255,255,0.01)" }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>Kisayollar</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 12px", fontSize: 10, color: "var(--text-muted)" }}>
                  <ShortcutRow keys="B" label="Firca" />
                  <ShortcutRow keys="E" label="Silgi" />
                  <ShortcutRow keys="[ / ]" label="Boyut" />
                  <ShortcutRow keys="G" label="Izgara" />
                  <ShortcutRow keys={formatShortcut("Cmd+Z")} label="Geri al" />
                  <ShortcutRow keys="0" label="Sigdir" />
                  <ShortcutRow keys="Bosluk" label="Kaydir" />
                  <ShortcutRow keys="Esc" label="Kapat" />
                </div>
              </div>
            </div>

            {/* ── Footer / Submit ── */}
            <div style={footerStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {strokeCount > 0 ? `${strokeCount} isaret · Guc %${Math.round(strength * 100)}` : "Koruyarak duzenle"}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{selectedModel || "Model secili degil"}</span>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 10 }}>
                {submissionPhase === "building"
                  ? "Kilavuz olusturuluyor..."
                  : submissionPhase === "queueing"
                    ? "Kuyruga ekleniyor..."
                    : "Hazir"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary" style={footerCancelBtn}>Vazgec</button>
                <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting} className="btn-primary" style={footerSubmitBtn}>
                  {submitting ? <LoaderCircle className="spin-slow" size={14} /> : <Send size={14} />}
                  {submitting ? "Kuyrukta..." : "Duzenleme uret"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ SUB-COMPONENTS ═══════════ */

function ToolButton({ icon, label, shortcut, active, onClick, disabled }: {
  icon: React.ReactNode; label: string; shortcut?: string; active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-keyshortcuts={shortcut}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 32, height: 32, borderRadius: 8, border: "none", padding: 0, cursor: disabled ? "not-allowed" : "pointer",
        background: active ? "rgba(245,158,11,0.12)" : "transparent",
        color: active ? "var(--accent)" : disabled ? "var(--text-muted)" : "var(--text-secondary)",
        opacity: disabled ? 0.4 : 1, transition: "all 100ms ease",
      }}>
      {active ? (
        <span
          style={{
            position: "absolute",
            left: "50%",
            bottom: 3,
            width: 16,
            height: 2,
            borderRadius: 999,
            background: "var(--accent)",
            transform: "translateX(-50%)",
          }}
        />
      ) : null}
      {icon}
    </button>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <kbd style={{ fontSize: 9, fontFamily: "inherit", fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.08)" }}>{keys}</kbd>
    </div>
  );
}

/* ═══════════ STYLES ═══════════ */

const backdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 210, display: "grid", placeItems: "center", padding: 12,
  background: "rgba(0,0,0,0.75)", backdropFilter: "blur(20px) saturate(0.6)",
};

const shellStyle: React.CSSProperties = {
  width: "min(1480px, calc(100vw - 24px))", height: "min(960px, calc(100vh - 24px))",
  borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)",
  background: "var(--bg-base, #111113)", boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
  overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)",
};

const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.02), transparent)",
};

const headerIconStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 9,
  background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.12)",
  display: "grid", placeItems: "center", flexShrink: 0,
};

const headerCenterStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "4px 6px", borderRadius: 12,
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
};

const toolGroupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 1,
};

const toolDividerStyle: React.CSSProperties = {
  width: 1, height: 20, background: "rgba(255,255,255,0.06)", margin: "0 4px",
};

const zoomLabelStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 48, height: 32, borderRadius: 6, border: "none", padding: "0 6px",
  background: "rgba(255,255,255,0.04)", color: "var(--text-primary)",
  fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums", cursor: "pointer",
};

const closeButtonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 34, height: 34, borderRadius: 9, border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.03)", color: "var(--text-secondary)", cursor: "pointer",
};

const floatingPanelStyle: React.CSSProperties = {
  position: "absolute", left: 12, top: 12, zIndex: 4, width: 180,
  borderRadius: 14, background: "rgba(18,18,22,0.92)", border: "1px solid rgba(255,255,255,0.06)",
  backdropFilter: "blur(20px) saturate(1.2)", boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
};

const panelDividerStyle: React.CSSProperties = {
  height: 1, background: "rgba(255,255,255,0.04)", margin: "0 10px",
};

const sliderStyle: React.CSSProperties = {
  width: "100%", accentColor: "var(--accent, #f59e0b)", height: 3, cursor: "pointer",
};

const panelActionBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "6px 8px", borderRadius: 7, border: "none",
  background: "rgba(255,255,255,0.03)", color: "var(--text-secondary)",
  cursor: "pointer", fontSize: 10, fontWeight: 600, width: "100%",
  transition: "background 80ms ease",
};

const strokeBadgeStyle: React.CSSProperties = {
  position: "absolute", right: 12, top: 12, zIndex: 4,
  display: "flex", alignItems: "center", gap: 5,
  padding: "5px 12px", borderRadius: 10,
  background: "rgba(18,18,22,0.9)", border: "1px solid rgba(255,255,255,0.06)",
  backdropFilter: "blur(12px)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
};

const hintStyle: React.CSSProperties = {
  position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)", zIndex: 4,
  padding: "8px 16px", borderRadius: 10,
  background: "rgba(18,18,22,0.9)", border: "1px solid rgba(255,255,255,0.06)",
  backdropFilter: "blur(12px)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
  fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", pointerEvents: "none",
};

const rightPanelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column",
  borderLeft: "1px solid rgba(255,255,255,0.05)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.015), transparent 40%)",
  minWidth: 0, minHeight: 0, overflow: "hidden",
};

const rightSectionStyle: React.CSSProperties = {
  padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-secondary)", marginBottom: 6,
};

const layerActionBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 20, height: 20, borderRadius: 5, border: "none", padding: 0,
  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
  transition: "color 80ms ease",
};

const textareaStyle: React.CSSProperties = {
  width: "100%", minHeight: 90, resize: "vertical", padding: "10px 12px",
  borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.02)", color: "var(--text-primary)",
  fontSize: 12, lineHeight: 1.7, fontFamily: '"IBM Plex Mono", "Menlo", monospace', outline: "none",
};

const footerStyle: React.CSSProperties = {
  padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.05)",
};

const footerCancelBtn: React.CSSProperties = {
  flex: 1, padding: "10px 14px", fontSize: 12, fontWeight: 600, borderRadius: 9,
};

const footerSubmitBtn: React.CSSProperties = {
  flex: 2, padding: "10px 18px", fontSize: 12, fontWeight: 700, borderRadius: 9,
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
};

const eraserCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Crect x='6' y='10' width='14' height='9' rx='2' fill='%23ffffff' fill-opacity='0.92' stroke='%231a1c1c' stroke-width='1.4'/%3E%3Cpath d='M18 10l4-4 3 3-5 5' fill='%23f59e0b' stroke='%231a1c1c' stroke-width='1.2' stroke-linejoin='round'/%3E%3C/svg%3E") 14 14, crosshair`;
