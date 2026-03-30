import { useState, type MouseEvent } from "react";
import { Clapperboard, Folder, Trash2, Video, Image as ImageIcon } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import type { ProjectMeta } from "@/services/project.service";

type ProjectCardProps = {
  project: ProjectMeta;
  onClick: () => void;
  onRemove: () => Promise<void> | void;
  index?: number;
};

function getFolderLabel(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "-";
}

function getProgress(ready: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((ready / total) * 100);
}

const relativeFormatter = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });

function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const then = timestamp;
  const diffMs = then - now;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (Math.abs(diffHours) < 1) {
      return relativeFormatter.format(Math.round(diffMs / (1000 * 60)), "minute");
    }
    return relativeFormatter.format(diffHours, "hour");
  }

  return relativeFormatter.format(diffDays, "day");
}

export function ProjectCard({ project, onClick, onRemove, index = 0 }: ProjectCardProps) {
  const [removing, setRemoving] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const meta = (project as unknown as Record<string, unknown>).metadata as
    | {
        mainShotCount?: number;
        readyStartCount?: number;
        readyVideoCount?: number;
        characterCount?: number;
        assetCount?: number;
      }
    | undefined;

  const mainShotCount = meta?.mainShotCount ?? 0;
  const readyStartCount = meta?.readyStartCount ?? 0;
  const readyVideoCount = meta?.readyVideoCount ?? 0;
  const videoProgress = getProgress(readyVideoCount, mainShotCount);
  const startProgress = getProgress(readyStartCount, mainShotCount);

  async function handleRemove(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();

    const accepted = await confirm(
      `'${project.name}' yalnizca son projeler listesinden kaldirilacak. Devam edilsin mi?`,
      {
        title: "Listeden kaldir",
        kind: "warning",
        okLabel: "Kaldir",
        cancelLabel: "Vazgec",
      },
    );

    if (!accepted) {
      return;
    }

    setRemoving(true);

    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <motion.div
      className="project-card"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      whileHover={{ y: -4, scale: 1.01 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      style={{ transformOrigin: "center bottom" }}
    >
      {/* Card media */}
      <div className="project-card-media" style={{ position: "relative" }}>
        <div className="project-card-gradient" />

        {/* Hover glow overlay */}
        <motion.div
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(135deg, var(--surface-hover), transparent 50%)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />

        <span className="project-card-icon">
          <Clapperboard size={28} strokeWidth={1.5} />
        </span>

        {/* Remove button with fade animation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 3,
          }}
        >
          <button
            className="card-remove-btn"
            disabled={removing}
            onClick={(event) => void handleRemove(event)}
            title="Listeden kaldir"
            type="button"
            style={{ opacity: 1 }}
          >
            <Trash2 size={13} />
          </button>
        </motion.div>

        {/* Shot count badge */}
        {meta && mainShotCount > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + index * 0.03, duration: 0.3 }}
            style={{
              position: "absolute",
              bottom: 10,
              left: 14,
              zIndex: 2,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--glass-bg)",
              backdropFilter: "blur(8px)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-primary)",
              border: "1px solid var(--surface-active)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <ImageIcon size={11} style={{ color: "var(--accent)" }} />
            {mainShotCount} sahne
          </motion.div>
        )}
      </div>

      {/* Card body */}
      <div className="project-card-body">
        <div className="project-card-topline">
          <span className="project-card-name">{project.name}</span>
          <div style={{ display: "grid", gap: 1, textAlign: "right" }}>
            <span className="project-card-date">
              {new Date(project.updatedAt).toLocaleDateString("tr-TR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                opacity: 0.7,
              }}
            >
              {getRelativeTime(project.updatedAt)}
            </span>
          </div>
        </div>

        <p className="project-card-path">{project.folderPath}</p>

        {/* Progress bars */}
        {meta && mainShotCount > 0 && (
          <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
            {/* Start image progress */}
            <div style={{ display: "grid", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ImageIcon size={10} />
                  Start kareleri
                </span>
                <span>
                  {readyStartCount}/{mainShotCount}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: 6,
                  borderRadius: 999,
                  background: "var(--surface-active)",
                  overflow: "hidden",
                }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${startProgress}%` }}
                  transition={{ delay: 0.3 + index * 0.04, duration: 0.6, ease: "easeOut" }}
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg, var(--accent), var(--text-secondary))",
                  }}
                />
              </div>
            </div>

            {/* Video progress */}
            <div style={{ display: "grid", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Video size={10} />
                  Videolar
                </span>
                <span>
                  {readyVideoCount}/{mainShotCount}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: 6,
                  borderRadius: 999,
                  background: "var(--surface-active)",
                  overflow: "hidden",
                }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${videoProgress}%` }}
                  transition={{ delay: 0.35 + index * 0.04, duration: 0.6, ease: "easeOut" }}
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background:
                      videoProgress === 100
                        ? "linear-gradient(90deg, var(--status-success), #4ade80)"
                        : "linear-gradient(90deg, var(--status-info), #60a5fa)",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Tags */}
        <div className="project-card-tags">
          <span className="project-card-tag">
            <Folder size={12} />
            {getFolderLabel(project.folderPath)}
          </span>
          {meta ? (
            <>
              {meta.characterCount != null && meta.characterCount > 0 && (
                <span className="project-card-tag is-muted">
                  {meta.characterCount} karakter
                </span>
              )}
              {meta.assetCount != null && meta.assetCount > 0 && (
                <span className="project-card-tag is-muted">
                  {meta.assetCount} asset
                </span>
              )}
              {mainShotCount > 0 && videoProgress === 100 && (
                <span
                  className="project-card-tag"
                  style={{
                    background: "rgba(34,197,94,0.12)",
                    color: "var(--status-success)",
                  }}
                >
                  Tamamlandi
                </span>
              )}
            </>
          ) : (
            <span className="project-card-tag is-muted">Metadata bekleniyor</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
