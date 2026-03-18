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
  const width = isCoverage ? 136 : 196;
  const height = isCoverage ? 152 : 244;
  const thumbnail = resolveThumbnailPath(shot);
  const imageCardStatus = resolveImageCardStatus(shot);
  const missingExternalReference =
    shot.requiresExternalReference && !shot.externalReferencePath;
  const imageModelLabel = getImageModelLabel(shot);
  const videoModelLabel = getVideoModelLabel(shot);
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
        minHeight: height,
        display: "grid",
        gridTemplateRows: "1fr auto",
        borderRadius: 20,
        overflow: "hidden",
        border: `1px solid ${selected ? accentColor : "var(--border-subtle)"}`,
        background: "var(--bg-surface)",
        color: "inherit",
        cursor: "pointer",
        opacity: archived ? 0.58 : 1,
        boxShadow: selected
          ? `0 0 0 1px ${accentColor}33, 0 26px 60px rgba(0, 0, 0, 0.28)`
          : hovered
            ? "0 28px 68px rgba(0, 0, 0, 0.3)"
            : "0 20px 48px rgba(0, 0, 0, 0.18)",
        transform: selected ? "translateY(-2px)" : hovered ? "translateY(-3px)" : "translateY(0)",
        transition: "transform 150ms ease, border-color 150ms ease, box-shadow 150ms ease",
        textAlign: "left",
        outline: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          minHeight: isCoverage ? 88 : 154,
          overflow: "hidden",
          background: resolvedThumbUrl
            ? "linear-gradient(180deg, transparent 32%, rgba(0, 0, 0, 0.5))"
            : "linear-gradient(160deg, rgba(245, 158, 11, 0.12), transparent 56%), var(--bg-overlay)",
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
            inset: 10,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: isCoverage ? "4px 6px" : "5px 8px",
              borderRadius: 999,
              background: "rgba(0, 0, 0, 0.58)",
              color: "#f8f7f2",
              fontSize: isCoverage ? 8 : 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
            }}
          >
            {shot.shotNumber}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: isCoverage ? "4px 6px" : "5px 8px",
              borderRadius: 999,
              background: `${accentColor}cc`,
              color: "#100800",
              fontSize: isCoverage ? 8 : 9,
              fontWeight: 800,
              letterSpacing: "0.08em",
            }}
          >
            {TYPE_LABELS[shot.shotType] ?? shot.shotType.toUpperCase()}
          </span>
        </div>

        {archived ? (
          <div
            style={{
              position: "absolute",
              left: 10,
              top: isCoverage ? 36 : 44,
              padding: "4px 8px",
              borderRadius: 999,
              background: "rgba(0, 0, 0, 0.62)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "var(--text-secondary)",
              fontSize: isCoverage ? 8 : 9,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Archived
          </div>
        ) : null}

        {thumbnail.source === "end" ? (
          <div
            style={{
              position: "absolute",
              left: 10,
              top: isCoverage ? 58 : 82,
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
            End preview
          </div>
        ) : null}

        {missingExternalReference ? (
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: isCoverage ? 34 : 40,
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
          </div>
        ) : null}

        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            top: isCoverage ? 36 : 56,
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

        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {isCoverage ? (
            <>
              <CompactStatus icon={<ImageIcon size={10} />} status={imageCardStatus} />
              <CompactStatus icon={<Video size={10} />} status={shot.videoStatus} />
              {shot.upscaleStatus === "done" ? (
                <CompactStatus label="4K" status="done" />
              ) : null}
            </>
          ) : (
            <>
              <StatusPill icon={<ImageIcon size={11} />} label="IMG" status={imageCardStatus} />
              <StatusPill icon={<Video size={11} />} label="VID" status={shot.videoStatus} />
              {shot.upscaleStatus === "done" ? (
                <span
                  style={{
                    marginLeft: "auto",
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

      <div
        style={{
          display: "grid",
          gap: isCoverage ? 6 : 8,
          padding: isCoverage ? "8px 9px 9px" : "12px 14px 14px",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        {!isCoverage ? (
          <>
            <div
              style={{
                minHeight: 34,
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text-secondary)",
                display: "-webkit-box",
                overflow: "hidden",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
              }}
            >
              {shot.summaryTr ?? "Prompt ve continuity detaylari detay modalinda gorunur."}
            </div>
            <div
              style={{
                display: "grid",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  letterSpacing: "0.04em",
                }}
              >
                IMG / {imageModelLabel}
              </span>
              {videoModelLabel ? (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    letterSpacing: "0.04em",
                  }}
                >
                  VID / {videoModelLabel}
                </span>
              ) : null}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                fontSize: 10,
                color: "var(--text-muted)",
                letterSpacing: "0.04em",
              }}
            >
              <span>
                A{shot.act ?? "-"} S{shot.scene ?? "-"}
              </span>
              <span>
                {shot.durationS ? `${shot.durationS}s` : "--"}
                {shot.tensionLevel ? ` / T${shot.tensionLevel}` : ""}
              </span>
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
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              <span>{TYPE_LABELS[shot.shotType] ?? shot.shotType.toUpperCase()}</span>
              <span>{shot.shotNumber.replace(/^SHOT/i, "")}</span>
            </div>
            <span
              style={{
                fontSize: 9,
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
