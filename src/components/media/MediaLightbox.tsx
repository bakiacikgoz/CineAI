import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Expand, Image as ImageIcon, Video as VideoIcon, X } from "lucide-react";
import { Portal } from "@/components/Portal";

export type MediaLightboxItem = {
  kind: "image" | "video";
  src: string;
  title: string;
  subtitle?: string;
  description?: string;
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
            style={{ zIndex }}
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
                background:
                  "linear-gradient(180deg, rgba(19, 19, 24, 0.98), rgba(9, 9, 12, 0.99)), radial-gradient(circle at top right, rgba(245, 158, 11, 0.12), transparent 28%)",
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
                      border: "1px solid rgba(245, 158, 11, 0.2)",
                      background: "rgba(245, 158, 11, 0.08)",
                      color: "var(--accent)",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {item.kind === "image" ? <ImageIcon size={13} /> : <VideoIcon size={13} />}
                    Inspect Mode
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
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      borderRadius: 999,
                      border: "1px solid var(--border-subtle)",
                      background: "rgba(255,255,255,0.04)",
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
                      background: "rgba(255,255,255,0.04)",
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
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    background:
                      "radial-gradient(circle at top, rgba(245, 158, 11, 0.08), transparent 34%), #050506",
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
