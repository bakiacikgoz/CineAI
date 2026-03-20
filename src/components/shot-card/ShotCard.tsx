import {
  useEffect,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Clapperboard, Image as ImageIcon, Play, Video } from "lucide-react";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  resolveImageModel,
  resolveVideoModel,
} from "@/services/fal.service";
import { type ShotRow } from "@/services/import.service";

const TYPE_LABELS: Record<string, string> = {
  main: "MASTER",
  wide: "WIDE",
  ots: "OTS",
  close: "CLOSE",
  detail: "DETAIL",
  reaction: "REACT",
};

const TYPE_COLORS: Record<string, string> = {
  main: "#f59e0b",
  wide: "#3b82f6",
  ots: "#8b5cf6",
  close: "#ec4899",
  detail: "#10b981",
  reaction: "#f97316",
};

export type ShotCardPreviewTarget = "start" | "end" | "video";

interface ShotCardProps {
  shot: ShotRow;
  selected: boolean;
  isCoverage?: boolean;
  archived?: boolean;
  onClick: () => void;
  onPreviewRequest?: (target: ShotCardPreviewTarget) => void;
  projectFolderPath: string;
}

function toAbsoluteProjectPath(projectFolderPath: string, relativePath: string): string {
  const normalizedInput = relativePath.replace(/\\/g, "/");

  if (
    /^[a-zA-Z]:\//.test(normalizedInput) ||
    normalizedInput.startsWith("//") ||
    normalizedInput.startsWith("asset:")
  ) {
    return normalizedInput;
  }

  const normalizedBase = projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRelative = normalizedInput.replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

function resolveThumbnailPath(shot: ShotRow): { path: string | null; source: "start" | "end" | null } {
  if (shot.imageStartPath) {
    return { path: shot.imageStartPath, source: "start" };
  }

  if (shot.imageEndPath) {
    return { path: shot.imageEndPath, source: "end" };
  }

  return { path: null, source: null };
}

function resolveImageCardStatus(shot: ShotRow): string {
  if (shot.imageStartPath || shot.imageEndPath) {
    return shot.imageStatus;
  }

  if (shot.imageStatus === "done") {
    return "pending";
  }

  return shot.imageStatus;
}

function getImageModelLabel(shot: ShotRow): string {
  const modelId = resolveImageModel(shot.imageModelUsed ?? shot.model);
  return IMAGE_MODELS[modelId].label;
}

function getVideoModelLabel(shot: ShotRow): string | null {
  if (!shot.promptVideo && !shot.videoPath && !shot.video4kPath && !shot.videoModelUsed) {
    return null;
  }

  const modelId = resolveVideoModel(shot.videoModelUsed);
  return VIDEO_MODELS[modelId].label;
}

export function ShotCard({
  shot,
  selected,
  isCoverage = false,
  archived = false,
  onClick,
  onPreviewRequest,
  projectFolderPath,
}: ShotCardProps) {
  const [hovered, setHovered] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const accentColor = TYPE_COLORS[shot.shotType] ?? TYPE_COLORS.main;
  const width = isCoverage ? 164 : 320;
  const previewHeight = isCoverage ? 92 : 180;
  const thumbnail = resolveThumbnailPath(shot);
  const imageCardStatus = resolveImageCardStatus(shot);
  const missingExternalReference =
    shot.requiresExternalReference && !shot.externalReferencePath;
  const imageModelLabel = getImageModelLabel(shot);
  const videoModelLabel = getVideoModelLabel(shot);
  const actSceneLabel = `A${shot.act ?? "-"} · S${shot.scene ?? "-"}`;
  const durationLabel = shot.durationS ? `${shot.durationS}s` : "--";
  const tensionLabel = shot.tensionLevel ? `T${shot.tensionLevel}` : "T--";
  const summaryCopy = shot.summaryTr ?? "Prompt ve continuity detaylari detay modalinda gorunur.";
  const thumbUrl = thumbnail.path
    ? convertFileSrc(toAbsoluteProjectPath(projectFolderPath, thumbnail.path))
    : null;
  const resolvedThumbUrl = thumbUrl && !thumbnailFailed ? thumbUrl : null;
  const showToolbar = hovered || selected;

  useEffect(() => {
    setThumbnailFailed(false);
  }, [thumbUrl]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  function handleBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setHovered(false);
  }

  function handlePreviewClick(target: ShotCardPreviewTarget) {
    if (onPreviewRequest) {
      onPreviewRequest(target);
      return;
    }

    onClick();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={handleBlur}
      style={{
        width,
        minHeight: isCoverage ? 132 : 330,
        display: "grid",
        gridTemplateRows: "auto auto",
        borderRadius: isCoverage ? 20 : 26,
        overflow: "hidden",
        border: `1px solid ${selected ? accentColor : "rgba(255,255,255,0.08)"}`,
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.012) 18%, rgba(12,12,14,0.96) 100%)",
        color: "inherit",
        cursor: "pointer",
        opacity: archived ? 0.58 : 1,
        boxShadow: selected
          ? `0 0 0 1px ${accentColor}33, 0 26px 60px rgba(0, 0, 0, 0.34)`
          : hovered
            ? "0 30px 72px rgba(0, 0, 0, 0.32)"
            : "0 18px 44px rgba(0, 0, 0, 0.22)",
        transform: selected ? "translateY(-2px)" : hovered ? "translateY(-3px)" : "translateY(0)",
        transition: "transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
        textAlign: "left",
        outline: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          minHeight: previewHeight,
          overflow: "hidden",
          background: resolvedThumbUrl
            ? "linear-gradient(180deg, transparent 22%, rgba(0, 0, 0, 0.62))"
            : "linear-gradient(160deg, rgba(245, 158, 11, 0.14), transparent 58%), var(--bg-overlay)",
        }}
      >
        {resolvedThumbUrl ? (
          <img
            alt={`${shot.shotNumber} preview`}
            onError={() => setThumbnailFailed(true)}
            src={resolvedThumbUrl}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : null}

        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.08) 34%, rgba(0,0,0,0.58) 100%)",
          }}
        />

        {!resolvedThumbUrl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "rgba(240, 238, 232, 0.18)",
            }}
          >
            <Clapperboard size={isCoverage ? 24 : 34} strokeWidth={1.6} />
          </div>
        ) : null}

        <div
          style={{
            position: "absolute",
            inset: isCoverage ? 10 : 12,
            display: "grid",
            alignContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: isCoverage ? "4px 6px" : "6px 9px",
                  borderRadius: 999,
                  background: "rgba(0, 0, 0, 0.62)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#f8f7f2",
                  fontSize: isCoverage ? 8 : 10,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                }}
              >
                {shot.shotNumber}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: isCoverage ? "4px 6px" : "6px 9px",
                  borderRadius: 999,
                  background: `${accentColor}d9`,
                  color: "#100800",
                  fontSize: isCoverage ? 8 : 9,
                  fontWeight: 800,
                  letterSpacing: "0.1em",
                }}
              >
                {TYPE_LABELS[shot.shotType] ?? shot.shotType.toUpperCase()}
              </span>
            </div>

            {thumbnail.source === "end" ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: isCoverage ? "4px 6px" : "6px 9px",
                  borderRadius: 999,
                  background: "rgba(0, 0, 0, 0.62)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--text-secondary)",
                  fontSize: isCoverage ? 7 : 9,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                End preview
              </span>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 6,
                opacity: showToolbar ? 1 : 0,
                transform: showToolbar ? "translateY(0)" : "translateY(10px)",
                transition: "opacity 150ms ease, transform 150ms ease",
                pointerEvents: showToolbar ? "auto" : "none",
              }}
            >
              <HoverActionButton
                active={Boolean(shot.imageStartPath)}
                compact={isCoverage}
                icon={<ImageIcon size={11} />}
                label="START"
                onClick={() => handlePreviewClick("start")}
              />
              <HoverActionButton
                active={Boolean(shot.imageEndPath)}
                compact={isCoverage}
                icon={<ImageIcon size={11} />}
                label="END"
                onClick={() => handlePreviewClick("end")}
              />
              <HoverActionButton
                active={Boolean(shot.videoPath || shot.video4kPath)}
                compact={isCoverage}
                icon={<Play size={11} />}
                label="VIDEO"
                onClick={() => handlePreviewClick("video")}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {archived ? (
                  <span
                    style={{
                      padding: isCoverage ? "3px 6px" : "4px 8px",
                      borderRadius: 999,
                      background: "rgba(0, 0, 0, 0.62)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "var(--text-secondary)",
                      fontSize: isCoverage ? 7 : 9,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Archived
                  </span>
                ) : null}
                {missingExternalReference ? (
                  <span
                    style={{
                      padding: isCoverage ? "3px 6px" : "4px 8px",
                      borderRadius: 999,
                      background: "rgba(245, 158, 11, 0.16)",
                      border: "1px solid rgba(245, 158, 11, 0.26)",
                      color: "var(--accent)",
                      fontSize: isCoverage ? 7 : 9,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Ref required
                  </span>
                ) : null}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isCoverage ? (
                  <>
                    <CompactStatus icon={<ImageIcon size={10} />} status={imageCardStatus} />
                    <CompactStatus icon={<Video size={10} />} status={shot.videoStatus} />
                    {shot.upscaleStatus === "done" ? <CompactStatus label="4K" status="done" /> : null}
                  </>
                ) : (
                  <>
                    <StatusPill icon={<ImageIcon size={11} />} label="IMG" status={imageCardStatus} />
                    <StatusPill icon={<Video size={11} />} label="VID" status={shot.videoStatus} />
                    {shot.upscaleStatus === "done" ? (
                      <span
                        style={{
                          padding: "3px 6px",
                          borderRadius: 999,
                          background: "rgba(167, 139, 250, 0.16)",
                          color: "var(--status-purple)",
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                        }}
                      >
                        4K
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: isCoverage ? 6 : 10,
          padding: isCoverage ? "10px 12px 12px" : "14px 16px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {!isCoverage ? (
          <>
            <div
              style={{
                minHeight: 36,
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--text-secondary)",
                display: "-webkit-box",
                overflow: "hidden",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {summaryCopy}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                {actSceneLabel}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                {durationLabel} / {tensionLabel}
              </span>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <MetadataChip label="Image" value={imageModelLabel} />
              {videoModelLabel ? <MetadataChip label="Video" value={videoModelLabel} /> : null}
            </div>
          </>
        ) : (
          <div
            style={{
              display: "grid",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 10,
                color: "var(--text-secondary)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              <span>{TYPE_LABELS[shot.shotType] ?? shot.shotType.toUpperCase()}</span>
              <span>{durationLabel}</span>
            </div>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              {imageModelLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MetadataChip({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.025)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--text-secondary)",
          letterSpacing: "0.02em",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function HoverActionButton({
  active,
  compact,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  compact: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: compact ? 24 : 28,
        padding: compact ? "0 8px" : "0 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "rgba(245, 158, 11, 0.28)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(8, 8, 10, 0.84)" : "rgba(8, 8, 10, 0.6)",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: compact ? 8 : 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        opacity: active ? 1 : 0.72,
        backdropFilter: "blur(10px)",
      }}
      title={active ? `${label} preview` : `${label} henuz uretilmedi`}
    >
      {icon}
      {label}
    </button>
  );
}

function CompactStatus({
  icon,
  label,
  status,
}: {
  icon?: ReactNode;
  label?: string;
  status: string;
}) {
  const token =
    status === "done"
      ? "var(--status-success)"
      : status === "generating"
        ? "var(--status-warning)"
        : status === "error"
          ? "var(--status-error)"
          : "var(--text-muted)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        minWidth: label ? 28 : 22,
        height: 22,
        padding: label ? "0 7px" : "0",
        borderRadius: 999,
        background: "rgba(0, 0, 0, 0.38)",
        border: `1px solid ${token}33`,
        color: token,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
      }}
    >
      {icon ?? label}
      {icon && label ? label : null}
    </span>
  );
}

function StatusPill({
  icon,
  label,
  status,
}: {
  icon: ReactNode;
  label: string;
  status: string;
}) {
  const token =
    status === "done"
      ? {
          color: "var(--status-success)",
          background: "rgba(34, 197, 94, 0.12)",
          border: "rgba(34, 197, 94, 0.22)",
        }
      : status === "generating"
        ? {
            color: "var(--status-warning)",
            background: "rgba(245, 158, 11, 0.12)",
            border: "rgba(245, 158, 11, 0.22)",
          }
        : status === "error"
          ? {
              color: "var(--status-error)",
              background: "rgba(239, 68, 68, 0.12)",
              border: "rgba(239, 68, 68, 0.22)",
            }
          : {
              color: "var(--text-muted)",
              background: "rgba(255, 255, 255, 0.04)",
              border: "rgba(255, 255, 255, 0.08)",
            };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 6px",
        borderRadius: 999,
        background: token.background,
        border: `1px solid ${token.border}`,
        color: token.color,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
      }}
    >
      {icon}
      {label}
    </span>
  );
}
