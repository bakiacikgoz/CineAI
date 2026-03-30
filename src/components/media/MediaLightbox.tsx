import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Expand, Image as ImageIcon, LoaderCircle, Video as VideoIcon, X } from "lucide-react";
import { Portal } from "@/components/Portal";
import { message } from "@tauri-apps/plugin-dialog";
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

export function MediaLightbox({
  item,
  onClose,
  zIndex = 140,
}: {
  item: MediaLightboxItem | null;
  onClose: () => void;
  zIndex?: number;
}) {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!item) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [item, onClose]);

  async function handleDownload() {
    if (!item?.downloadPath || downloading) {
      return;
    }

    setDownloading(true);

    try {
      await downloadMediaFile({
        sourcePath: item.downloadPath,
        suggestedName: item.downloadName ?? item.title,
        dialogTitle: item.title,
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Medya indirilemedi.", {
        title: item.title,
        kind: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AnimatePresence>
      {item ? (
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
                    {item.kind === "image" ? <ImageIcon size={13} /> : <VideoIcon size={13} />}
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
                    {item.title}
                  </div>
                  {item.subtitle ? (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {item.subtitle}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                  {item.downloadPath ? (
                    <button
                      onClick={() => void handleDownload()}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        borderRadius: 999,
                        border: "1px solid var(--border-subtle)",
                        background: "var(--surface-hover)",
                        padding: "8px 12px",
                        fontSize: 12,
                        color: "var(--text-secondary)",
                        cursor: downloading ? "progress" : "pointer",
                      }}
                      type="button"
                      disabled={downloading}
                    >
                      {downloading ? <LoaderCircle className="spin-slow" size={14} /> : <Download size={14} />}
                      {downloading ? "Indiriliyor..." : "Indir"}
                    </button>
                  ) : null}
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 999,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-hover)",
                      padding: "8px 12px",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Expand size={14} />
                    Esc ile kapa
                  </span>
                  <button
                    onClick={onClose}
                    style={{
                      display: "inline-flex",
                      width: 34,
                      height: 34,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-hover)",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                    }}
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  minHeight: 0,
                }}
              >
                <div
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
                  {item.kind === "image" ? (
                    <img
                      alt={item.title}
                      src={item.src}
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
                      src={item.src}
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
                </div>

                {item.description ? (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.7,
                      color: "var(--text-secondary)",
                      padding: "0 4px",
                    }}
                  >
                    {item.description}
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
