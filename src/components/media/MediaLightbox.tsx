import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Image as ImageIcon,
  LoaderCircle,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import { Portal } from "@/components/Portal";
import { downloadMediaFile } from "@/lib/media-download";

export type MediaLightboxItem = {
  kind: "image" | "video";
  src: string;
  title: string;
  subtitle?: string;
  description?: string;
  downloadPath?: string | null;
  downloadName?: string | null;
};

type MediaLightboxProps = {
  item: MediaLightboxItem | null;
  items?: MediaLightboxItem[];
  activeIndex?: number;
  onNavigate?: (nextIndex: number) => void;
  onClose: () => void;
  zIndex?: number;
};

export function MediaLightbox({
  item,
  items,
  activeIndex,
  onNavigate,
  onClose,
  zIndex = 140,
}: MediaLightboxProps) {
  const [downloading, setDownloading] = useState(false);

  const navigationItems = useMemo(
    () => (Array.isArray(items) && items.length > 0 ? items : item ? [item] : []),
    [item, items],
  );
  const resolvedIndex = useMemo(() => {
    if (!item) {
      return -1;
    }

    if (typeof activeIndex === "number" && activeIndex >= 0 && activeIndex < navigationItems.length) {
      return activeIndex;
    }

    return navigationItems.findIndex((entry) => entry.src === item.src && entry.title === item.title);
  }, [activeIndex, item, navigationItems]);
  const activeItem =
    item ?? (resolvedIndex >= 0 && resolvedIndex < navigationItems.length ? navigationItems[resolvedIndex] : null);
  const canNavigate = navigationItems.length > 1 && resolvedIndex >= 0;

  function navigateBy(delta: number) {
    if (!canNavigate || !onNavigate) {
      return;
    }

    const nextIndex = (resolvedIndex + delta + navigationItems.length) % navigationItems.length;
    onNavigate(nextIndex);
  }

  useEffect(() => {
    if (!activeItem) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        navigateBy(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        navigateBy(1);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeItem, onClose, canNavigate, navigationItems.length, resolvedIndex]);

  async function handleDownload() {
    if (!activeItem?.downloadPath || downloading) {
      return;
    }

    setDownloading(true);

    try {
      await downloadMediaFile({
        sourcePath: activeItem.downloadPath,
        suggestedName: activeItem.downloadName ?? activeItem.title,
        dialogTitle: activeItem.title,
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Medya indirilemedi.", {
        title: activeItem.title,
        kind: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AnimatePresence mode="wait">
      {activeItem ? (
        <Portal>
          <motion.div
            animate={{ opacity: 1 }}
            className="project-modal-backdrop"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={onClose}
            role="presentation"
            style={{
              zIndex,
              background: "var(--backdrop-bg)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              aria-modal="true"
              className="project-modal-panel"
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              style={{
                width: "min(1180px, 100%)",
                maxHeight: "calc(100vh - 40px)",
                padding: 18,
                gap: 16,
                overflow: "hidden",
                borderRadius: 20,
                background: "var(--bg-base)",
                boxShadow: "var(--shadow-modal)",
              }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                  <span
                    style={{
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
                    }}
                  >
                    {activeItem.kind === "image" ? <ImageIcon size={13} /> : <VideoIcon size={13} />}
                    Inceleme Modu
                  </span>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      letterSpacing: "-0.03em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activeItem.title}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {activeItem.subtitle ? (
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {activeItem.subtitle}
                      </div>
                    ) : null}
                    {canNavigate ? (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          borderRadius: 999,
                          border: "1px solid var(--border-subtle)",
                          background: "var(--bg-surface)",
                          padding: "4px 8px",
                        }}
                      >
                        {resolvedIndex + 1} / {navigationItems.length}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {activeItem.downloadPath ? (
                    <button
                      aria-label="Medyayi indir"
                      onClick={() => void handleDownload()}
                      style={chipButtonStyle}
                      type="button"
                      disabled={downloading}
                    >
                      {downloading ? <LoaderCircle className="spin-slow" size={14} /> : <Download size={14} />}
                      {downloading ? "Indiriliyor..." : "Indir"}
                    </button>
                  ) : null}
                  <span style={chipButtonStyle}>
                    <Expand size={14} />
                    Esc ile kapa
                  </span>
                  <button
                    aria-label="Lightboxi kapat"
                    onClick={onClose}
                    style={{
                      ...chipButtonStyle,
                      width: 34,
                      height: 34,
                      padding: 0,
                      justifyContent: "center",
                    }}
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  display: "grid",
                  gap: 12,
                  minHeight: 0,
                }}
              >
                {canNavigate ? (
                  <>
                    <button
                      aria-label="Onceki gorsele gec"
                      onClick={() => navigateBy(-1)}
                      style={{ ...navButtonStyle, left: 18 }}
                      type="button"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button
                      aria-label="Sonraki gorsele gec"
                      onClick={() => navigateBy(1)}
                      style={{ ...navButtonStyle, right: 18 }}
                      type="button"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </>
                ) : null}

                <motion.div
                  key={`${activeItem.kind}:${activeItem.src}`}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  initial={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  style={{
                    display: "grid",
                    placeItems: "center",
                    minHeight: "min(72vh, 760px)",
                    borderRadius: 24,
                    border: "1px solid var(--border-default)",
                    background: "var(--canvas-bg)",
                    overflow: "hidden",
                  }}
                >
                  {activeItem.kind === "image" ? (
                    <img
                      alt={activeItem.title}
                      src={activeItem.src}
                      style={{
                        width: "100%",
                        height: "100%",
                        maxWidth: "100%",
                        maxHeight: "min(72vh, 760px)",
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <video
                      autoPlay
                      controls
                      preload="metadata"
                      src={activeItem.src}
                      style={{
                        width: "100%",
                        height: "100%",
                        maxWidth: "100%",
                        maxHeight: "min(72vh, 760px)",
                        objectFit: "contain",
                        background: "#000",
                      }}
                    />
                  )}
                </motion.div>

                {activeItem.description ? (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.7,
                      color: "var(--text-secondary)",
                      padding: "0 4px",
                    }}
                  >
                    {activeItem.description}
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        </Portal>
      ) : null}
    </AnimatePresence>
  );
}

const chipButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-hover)",
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const navButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  zIndex: 2,
  display: "inline-flex",
  width: 42,
  height: 42,
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--glass-border)",
  borderRadius: 999,
  background: "var(--glass-bg)",
  color: "var(--text-primary)",
  boxShadow: "var(--shadow-float)",
  transform: "translateY(-50%)",
  cursor: "pointer",
};
