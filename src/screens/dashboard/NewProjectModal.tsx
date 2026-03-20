import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Plus, X } from "lucide-react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { toProjectFolderName } from "@/services/project.service";

type NewProjectModalProps = {
  onClose: () => void;
  onCreate: (name: string, folderPath: string) => Promise<void>;
};

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.18, delay: 0.05 } },
} as const;

const panelVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 340,
      damping: 28,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    y: 16,
    scale: 0.97,
    transition: { duration: 0.18, ease: "easeIn" },
  },
} as const;

const treeItems: ReadonlyArray<{ label: string; depth: number; delay: number; isFile?: boolean }> = [
  { label: "storyboard/", depth: 2, delay: 0.04 },
  { label: "assets/images/", depth: 2, delay: 0.08 },
  { label: "assets/videos/", depth: 2, delay: 0.12 },
  { label: "assets/characters/", depth: 2, delay: 0.16 },
  { label: "prompts/", depth: 2, delay: 0.2 },
  { label: "exports/", depth: 2, delay: 0.24 },
  { label: "project.json", depth: 2, delay: 0.28, isFile: true },
];

export function NewProjectModal({ onClose, onCreate }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !creating) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [creating, onClose]);

  const previewFolderName = name.trim() ? toProjectFolderName(name) : "cineai-project";

  async function handleSelectFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Yeni proje icin ana klasoru sec",
    });

    if (selected && !Array.isArray(selected)) {
      setFolderPath(selected);
    }
  }

  async function handleCreate() {
    if (!name.trim() || !folderPath) {
      return;
    }

    setCreating(true);

    try {
      await onCreate(name.trim(), folderPath);
    } catch (error) {
      console.error("Failed to create project", error);
      await message(error instanceof Error ? error.message : "Proje olusturulamadi.", {
        title: "Proje olusturulamadi",
        kind: "error",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <motion.div
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="project-modal-backdrop"
      onClick={() => {
        if (!creating) {
          onClose();
        }
      }}
      role="presentation"
    >
      <motion.div
        variants={panelVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        aria-modal="true"
        className="project-modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        style={{ position: "relative", overflow: "hidden" }}
      >
        {/* Subtle top-right glow */}
        <div
          style={{
            position: "absolute",
            top: -60,
            right: -60,
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(245,158,11,0.12), transparent 65%)",
            filter: "blur(30px)",
            pointerEvents: "none",
          }}
        />

        {/* Close button */}
        <motion.button
          onClick={() => {
            if (!creating) onClose();
          }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 2,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            border: "1px solid var(--border-subtle)",
            borderRadius: 999,
            background: "rgba(255,255,255,0.03)",
            color: "var(--text-muted)",
            cursor: creating ? "not-allowed" : "pointer",
            transition: "color 150ms ease, border-color 150ms ease",
          }}
          type="button"
        >
          <X size={14} />
        </motion.button>

        {/* Header */}
        <div className="project-modal-header">
          <motion.span
            className="project-modal-eyebrow"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.3 }}
          >
            Yeni Proje
          </motion.span>
          <motion.h2
            className="project-modal-title"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
          >
            CineAI produksiyonu baslat
          </motion.h2>
          <motion.p
            className="project-modal-copy"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.3 }}
          >
            Secilen ana klasor altinda yeni bir proje koku, asset klasorleri ve
            `project.json` olusturulur.
          </motion.p>
        </div>

        {/* Form */}
        <motion.div
          className="project-form-grid"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.3 }}
        >
          <label className="project-field">
            <span
              className="project-field-label"
              style={{ fontWeight: 600, fontSize: 12, color: "var(--text-secondary)" }}
            >
              Proje adi
            </span>
            <input
              className="project-input"
              onChange={(event) => setName(event.target.value)}
              placeholder="Orn: Kirmizi Orman"
              value={name}
            />
          </label>

          <div className="project-field">
            <span
              className="project-field-label"
              style={{ fontWeight: 600, fontSize: 12, color: "var(--text-secondary)" }}
            >
              Proje konumu
            </span>
            <div className="project-picker">
              <div
                className="project-picker-value"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Folder
                  size={14}
                  style={{
                    flexShrink: 0,
                    color: folderPath ? "var(--accent)" : "var(--text-muted)",
                    opacity: 0.7,
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: folderPath ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {folderPath || "Ana klasor secilmedi"}
                </span>
              </div>
              <button
                className="btn-secondary"
                onClick={() => void handleSelectFolder()}
                type="button"
              >
                <FolderOpen size={15} />
                Sec
              </button>
            </div>
          </div>
        </motion.div>

        {/* Folder tree preview */}
        <motion.div
          className="project-preview"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.3 }}
          style={{ position: "relative", overflow: "hidden" }}
        >
          {/* Accent bar */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 3,
              height: "100%",
              borderRadius: "3px 0 0 3px",
              background: "linear-gradient(180deg, var(--accent), transparent)",
              opacity: 0.4,
            }}
          />

          <div className="project-preview-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Folder size={13} style={{ color: "var(--accent)", opacity: 0.7 }} />
            Olusacak yapi
          </div>
          <div className="project-preview-tree">
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-secondary)" }}>
              <ChevronRight size={10} style={{ opacity: 0.5 }} />
              <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 11 }}>
                {folderPath || "..."}
              </span>
            </div>
            <div
              className="project-preview-indent"
              style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)" }}
            >
              <ChevronRight size={10} style={{ opacity: 0.5 }} />
              <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 11 }}>
                {previewFolderName}/
              </span>
            </div>
            {treeItems.map((item) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + item.delay, duration: 0.25 }}
                className="project-preview-indent-double"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: 11,
                  color: item.isFile ? "var(--text-secondary)" : "var(--text-muted)",
                }}
              >
                {item.isFile ? (
                  <span style={{ width: 10, textAlign: "center", opacity: 0.5 }}>`</span>
                ) : (
                  <span style={{ width: 10, textAlign: "center", opacity: 0.3 }}>|</span>
                )}
                {item.label}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div
          className="project-modal-actions"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.3 }}
        >
          <button className="btn-secondary" disabled={creating} onClick={onClose} type="button">
            Iptal
          </button>
          <motion.button
            className="btn-primary"
            disabled={!name.trim() || !folderPath || creating}
            onClick={() => void handleCreate()}
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Plus size={15} />
            {creating ? "Olusturuluyor..." : "Olustur"}
          </motion.button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
