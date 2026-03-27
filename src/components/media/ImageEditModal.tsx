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
import { LoaderCircle, Pencil, RefreshCw, Trash2, X } from "lucide-react";

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

type ImageEditPoint = {
  x: number;
  y: number;
};

type ImageEditStroke = {
  id: string;
  color: string;
  size: number;
  points: ImageEditPoint[];
};

type ImageEditModalProps = {
  draft: ImageEditModalDraft | null;
  projectFolderPath: string;
  dialogTitle: string;
  submitting: boolean;
  guideFilePrefix?: string;
  onClose: () => void;
  onSubmit: (payload: ImageEditSubmitPayload) => Promise<void>;
};

const IMAGE_EDIT_COLORS = [
  "rgba(245,158,11,0.96)",
  "rgba(59,130,246,0.94)",
  "rgba(239,68,68,0.94)",
  "rgba(34,197,94,0.94)",
  "rgba(255,255,255,0.96)",
] as const;

const IMAGE_ASPECT_RATIOS: ImageEditAspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:2"];
const IMAGE_ASPECT_RATIO_VALUES: Record<ImageEditAspectRatio, number> = {
  "1:1": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:2": 3 / 2,
};

function createLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function clampNormalizedCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function strokePointsToSvgPoints(points: ImageEditPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function inferImageMimeType(path: string): string {
  const normalizedPath = path.toLowerCase();

  if (normalizedPath.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalizedPath.endsWith(".webp")) {
    return "image/webp";
  }

  if (normalizedPath.endsWith(".gif")) {
    return "image/gif";
  }

  return "application/octet-stream";
}

function inferAspectRatioFromDimensions(
  width: number | null,
  height: number | null,
): ImageEditAspectRatio {
  if (!width || !height) {
    return "16:9";
  }

  const assetRatio = width / height;
  let bestMatch: ImageEditAspectRatio = "16:9";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const distance = Math.abs(IMAGE_ASPECT_RATIO_VALUES[ratio] - assetRatio);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = ratio;
    }
  }

  return bestMatch;
}

export function buildDefaultImageEditPrompt(prompt: string): string {
  const trimmedPrompt = prompt.trim();
  const preserveInstruction =
    "Preserve the original image composition, subject identity, camera angle, lighting, and all unmarked regions. Apply only subtle local edits that follow the markup and keep the rest of the frame unchanged.";

  return trimmedPrompt.length > 0
    ? `${trimmedPrompt}\n${preserveInstruction}`
    : "Apply only the local changes indicated by the markup overlay and keep the rest of the image exactly as it is. Do not redesign the frame.";
}

export function ImageEditModal({
  draft,
  projectFolderPath,
  dialogTitle,
  submitting,
  guideFilePrefix = "guide_still",
  onClose,
  onSubmit,
}: ImageEditModalProps) {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<ImageEditAspectRatio>("16:9");
  const [strokes, setStrokes] = useState<ImageEditStroke[]>([]);
  const [brushColor, setBrushColor] = useState<string>(IMAGE_EDIT_COLORS[0]);
  const [brushSize, setBrushSize] = useState(18);
  const [resolvedWidth, setResolvedWidth] = useState<number | null>(draft?.width ?? null);
  const [resolvedHeight, setResolvedHeight] = useState<number | null>(draft?.height ?? null);
  const activeStrokeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!draft) {
      return;
    }

    setPrompt("");
    setAspectRatio(inferAspectRatioFromDimensions(draft.width, draft.height));
    setStrokes([]);
    setBrushColor(IMAGE_EDIT_COLORS[0]);
    setBrushSize(18);
    setResolvedWidth(draft.width);
    setResolvedHeight(draft.height);
  }, [draft?.absolutePath, draft?.height, draft?.id, draft?.width]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || submitting) {
        return;
      }

      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, onClose, submitting]);

  if (!draft) {
    return null;
  }

  const activeDraft = draft;
  const canSubmit = prompt.trim().length > 0 || strokes.length > 0;

  function getPoint(event: ReactPointerEvent<HTMLDivElement>): ImageEditPoint | null {
    const rect = event.currentTarget.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: clampNormalizedCoordinate((event.clientX - rect.left) / rect.width),
      y: clampNormalizedCoordinate((event.clientY - rect.top) / rect.height),
    };
  }

  function handlePreviewLoad(event: SyntheticEvent<HTMLImageElement>) {
    const nextWidth = event.currentTarget.naturalWidth;
    const nextHeight = event.currentTarget.naturalHeight;

    if (!nextWidth || !nextHeight) {
      return;
    }

    setResolvedWidth(nextWidth);
    setResolvedHeight(nextHeight);
    setAspectRatio((current) =>
      strokes.length > 0 || prompt.trim().length > 0
        ? current
        : inferAspectRatioFromDimensions(nextWidth, nextHeight),
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (submitting) {
      return;
    }

    const point = getPoint(event);

    if (!point) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const strokeId = createLocalId();
    activeStrokeIdRef.current = strokeId;

    setStrokes((current) => [
      ...current,
      {
        id: strokeId,
        color: brushColor,
        size: brushSize / Math.max(rect.width, rect.height),
        points: [point],
      },
    ]);

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const activeStrokeId = activeStrokeIdRef.current;

    if (!activeStrokeId || submitting) {
      return;
    }

    const point = getPoint(event);

    if (!point) {
      return;
    }

    setStrokes((current) =>
      current.map((stroke) =>
        stroke.id === activeStrokeId
          ? { ...stroke, points: [...stroke.points, point] }
          : stroke,
      ),
    );
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    activeStrokeIdRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function buildReferenceImagePaths(): Promise<string[]> {
    if (strokes.length === 0) {
      return [activeDraft.absolutePath];
    }

    const imageBytes = await readFile(activeDraft.absolutePath);
    const sourceUrl = URL.createObjectURL(
      new Blob([imageBytes], { type: inferImageMimeType(activeDraft.absolutePath) }),
    );

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new window.Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Referans gorseli yuklenemedi."));
      nextImage.src = sourceUrl;
    });

    try {
      const width = resolvedWidth ?? image.naturalWidth;
      const height = resolvedHeight ?? image.naturalHeight;

      if (!width || !height) {
        throw new Error("Referans gorsel boyutu okunamadi.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Gorsel duzenleme tuvali hazirlanamadi.");
      }

      context.drawImage(image, 0, 0, width, height);
      context.lineCap = "round";
      context.lineJoin = "round";

      for (const stroke of strokes) {
        if (stroke.points.length === 0) {
          continue;
        }

        context.beginPath();
        context.strokeStyle = stroke.color;
        context.lineWidth = Math.max(3, stroke.size * Math.max(width, height));
        context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);

        for (const point of stroke.points.slice(1)) {
          context.lineTo(point.x * width, point.y * height);
        }

        if (stroke.points.length === 1) {
          context.lineTo(stroke.points[0].x * width, stroke.points[0].y * height);
        }

        context.stroke();
      }

      const guideFolder = await join(projectFolderPath, "assets", "images", "_edit-guides");
      await mkdir(guideFolder, { recursive: true });
      const guidePath = await join(
        guideFolder,
        `${guideFilePrefix}_${createLocalId().slice(0, 8)}.png`,
      );
      const bytes = dataUrlToBytes(canvas.toDataURL("image/png"));
      await writeFile(guidePath, bytes);

      return [activeDraft.absolutePath, guidePath];
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    try {
      const referenceImagePaths = await buildReferenceImagePaths();
      await onSubmit({
        prompt: buildDefaultImageEditPrompt(prompt),
        aspectRatio,
        referenceImagePaths,
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Gorsel duzenleme kuyruga eklenemedi.", {
        title: dialogTitle,
        kind: "error",
      });
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 210,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "min(1120px, calc(100vw - 48px))",
          maxHeight: "min(860px, calc(100vh - 48px))",
          borderRadius: 28,
          border: "1px solid var(--border-default)",
          background: "#ffffff",
          boxShadow: "0 24px 64px rgba(0,0,0,0.12)",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.28fr) minmax(320px, 360px)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateRows: "auto auto minmax(0, 1fr) auto",
            borderRight: "1px solid var(--border-subtle)",
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "18px 20px 14px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                }}
              >
                Nano Banana 2 Edit
              </div>
              <strong style={{ fontSize: 18, letterSpacing: "-0.03em" }}>
                Isaretleyerek duzenle
              </strong>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Referans: {activeDraft.label}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="icon-button"
              style={{ width: 38, height: 38, borderRadius: 999 }}
              aria-label="Duzenleme modalini kapat"
              disabled={submitting}
            >
              <X size={15} />
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto 1fr auto auto",
              gap: 12,
              alignItems: "center",
              padding: "14px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              background: "rgba(0,0,0,0.02)",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Markup
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {IMAGE_EDIT_COLORS.map((color) => {
                const active = color === brushColor;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setBrushColor(color)}
                    aria-label={`Renk sec ${color}`}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      border: active
                        ? "2px solid rgba(0,0,0,0.8)"
                        : "1px solid rgba(0,0,0,0.12)",
                      boxShadow: active ? "0 0 0 2px rgba(0,0,0,0.18)" : "none",
                      background: color,
                      cursor: "pointer",
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                Firca boyutu: {brushSize}px
              </div>
              <input
                type="range"
                min={8}
                max={38}
                step={1}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                disabled={submitting}
              />
            </div>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => setStrokes((current) => current.slice(0, -1))}
              disabled={strokes.length === 0 || submitting}
              style={{ padding: "8px 12px", fontSize: 11 }}
            >
              <RefreshCw size={13} />
              Geri al
            </button>
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                activeStrokeIdRef.current = null;
                setStrokes([]);
              }}
              disabled={strokes.length === 0 || submitting}
              style={{ padding: "8px 12px", fontSize: 11 }}
            >
              <Trash2 size={13} />
              Isaretleri temizle
            </button>
          </div>

          <div style={{ minHeight: 0, padding: 20, display: "grid" }}>
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                minHeight: 380,
                borderRadius: 24,
                overflow: "hidden",
                border: "1px solid #e8e8e8",
                background: "#f3f3f4",
                cursor: "default",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  padding: 18,
                }}
              >
                <div
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{
                    position: "relative",
                    maxWidth: "100%",
                    maxHeight: "100%",
                    width: "fit-content",
                    height: "fit-content",
                    display: "grid",
                    placeItems: "center",
                    overflow: "hidden",
                    borderRadius: 18,
                    cursor: submitting ? "progress" : "crosshair",
                    touchAction: "none",
                  }}
                >
                  <img
                    src={activeDraft.previewUrl}
                    alt={activeDraft.label}
                    onLoad={handlePreviewLoad}
                    style={{
                      display: "block",
                      width: "auto",
                      height: "auto",
                      maxWidth: "100%",
                      maxHeight: "100%",
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                  />
                  <svg
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: "100%",
                      height: "100%",
                      overflow: "visible",
                      pointerEvents: "none",
                    }}
                  >
                    {strokes.map((stroke) =>
                      stroke.points.length === 1 ? (
                        <circle
                          key={stroke.id}
                          cx={stroke.points[0].x}
                          cy={stroke.points[0].y}
                          r={stroke.size * 0.5}
                          fill={stroke.color}
                        />
                      ) : (
                        <polyline
                          key={stroke.id}
                          points={strokePointsToSvgPoints(stroke.points)}
                          fill="none"
                          stroke={stroke.color}
                          strokeWidth={stroke.size}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ),
                    )}
                  </svg>
                </div>
              </div>

              <div
                style={{
                  position: "absolute",
                  left: 16,
                  top: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.88)",
                  border: "1px solid #e8e8e8",
                  color: "#1a1c1c",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {strokes.length} markup
              </div>

              <div
                style={{
                  position: "absolute",
                  right: 16,
                  bottom: 16,
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.88)",
                  border: "1px solid #e8e8e8",
                  color: "#6b7280",
                  fontSize: 11,
                  lineHeight: 1.55,
                  maxWidth: 280,
                }}
              >
                Foto ustune serbestce ciz. Isaretler ikinci referans olarak gonderilir; model
                sadece bu bolgelerde lokal degisiklik yapmaya zorlanir.
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 20px 18px",
              borderTop: "1px solid var(--border-subtle)",
              background: "rgba(0,0,0,0.02)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Yeni sonuc galeriye yeni bir kare olarak eklenir; ister yeniden referans yapabilir
              ister ayarlari geri yukleyebilirsin.
            </span>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              <span>Mod</span>
              <strong style={{ color: "var(--accent)" }}>Preserve edit</strong>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr) auto",
            minWidth: 0,
            background: "#f9f9f9",
          }}
        >
          <div
            style={{
              padding: "18px 20px 14px",
              borderBottom: "1px solid var(--border-subtle)",
              display: "grid",
              gap: 6,
            }}
          >
            <strong style={{ fontSize: 16, letterSpacing: "-0.02em" }}>Degisiklik talimati</strong>
            <span style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Prompt alani bilerek bos gelir. Sadece kucuk degisiklik notunu yazabilir veya hic
              yazmadan yalnizca markup ile devam edebilirsin.
            </span>
          </div>

          <div style={{ padding: 20, display: "grid", gap: 16, minHeight: 0, alignContent: "start" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Edit prompt
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ornek: Sol taraftaki sis yogunlugunu azalt. Koprunun neonlarini biraz daha belirginlestir. Kadraji koru."
                style={{
                  width: "100%",
                  minHeight: 220,
                  resize: "vertical",
                  padding: "14px 16px",
                  borderRadius: 16,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-surface)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                  lineHeight: 1.75,
                  fontFamily: '"IBM Plex Sans", "Inter", system-ui, sans-serif',
                  outline: "none",
                }}
                disabled={submitting}
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                Bos birakirsan sistem arka planda otomatik olarak sadece isaretli bolgeleri
                degistirip diger her seyi koruyan bir talimat kurar.
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Aspect ratio
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {IMAGE_ASPECT_RATIOS.map((ratio) => {
                  const active = ratio === aspectRatio;
                  return (
                    <button
                      key={ratio}
                      type="button"
                      className={active ? "btn-primary" : "btn-secondary"}
                      onClick={() => setAspectRatio(ratio)}
                      style={{ minWidth: 62, padding: "8px 12px", fontSize: 11 }}
                      disabled={submitting}
                    >
                      {ratio}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
                padding: "14px 14px 16px",
                borderRadius: 18,
                border: "1px solid var(--border-subtle)",
                background: "rgba(0,0,0,0.02)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Edit behavior
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Kaynak kare ana referans olarak kalir. Markup varsa ayni kareye cizilmis ikinci bir
                guide da gonderilir. Bu sayede model kompozisyonu yeniden kurmak yerine lokal
                degisiklige odaklanir.
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "16px 20px 20px",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {strokes.length > 0 ? `${strokes.length} isaret cizildi.` : "Henuz isaret yok."}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-secondary"
                type="button"
                onClick={onClose}
                disabled={submitting}
              >
                Vazgec
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || submitting}
              >
                {submitting ? <LoaderCircle className="spin-slow" size={14} /> : <Pencil size={14} />}
                {submitting ? "Queueing..." : "Duzenleme uret"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
