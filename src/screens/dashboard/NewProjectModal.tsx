import { useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { toProjectFolderName } from "@/services/project.service";

type NewProjectModalProps = {
  onClose: () => void;
  onCreate: (name: string, folderPath: string) => Promise<void>;
};

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
    <div
      className="project-modal-backdrop"
      onClick={() => {
        if (!creating) {
          onClose();
        }
      }}
      role="presentation"
    >
      <motion.div
        animate={{ opacity: 1, y: 0, scale: 1 }}
        aria-modal="true"
        className="project-modal-panel"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <div className="project-modal-header">
          <span className="project-modal-eyebrow">Yeni Proje</span>
          <h2 className="project-modal-title">CineAI produksiyonu baslat</h2>
          <p className="project-modal-copy">
            Secilen ana klasor altinda yeni bir proje koku, asset klasorleri ve
            `project.json` olusturulur.
          </p>
        </div>

        <div className="project-form-grid">
          <label className="project-field">
            <span className="project-field-label">Proje adi</span>
            <input
              className="project-input"
              onChange={(event) => setName(event.target.value)}
              placeholder="Orn: Kirmizi Orman"
              value={name}
            />
          </label>

          <div className="project-field">
            <span className="project-field-label">Proje konumu</span>
            <div className="project-picker">
              <div className="project-picker-value">
                {folderPath || "Ana klasor secilmedi"}
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
        </div>

        <div className="project-preview">
          <div className="project-preview-title">Olusacak yapi</div>
          <div className="project-preview-tree">
            <div>{folderPath || "..."}</div>
            <div className="project-preview-indent">|-- {previewFolderName}/</div>
            <div className="project-preview-indent-double">|-- storyboard/</div>
            <div className="project-preview-indent-double">|-- assets/images/</div>
            <div className="project-preview-indent-double">|-- assets/videos/</div>
            <div className="project-preview-indent-double">|-- assets/characters/</div>
            <div className="project-preview-indent-double">|-- prompts/</div>
            <div className="project-preview-indent-double">|-- exports/</div>
            <div className="project-preview-indent-double">`-- project.json</div>
          </div>
        </div>

        <div className="project-modal-actions">
          <button className="btn-secondary" disabled={creating} onClick={onClose} type="button">
            Iptal
          </button>
          <button
            className="btn-primary"
            disabled={!name.trim() || !folderPath || creating}
            onClick={() => void handleCreate()}
            type="button"
          >
            <Plus size={15} />
            {creating ? "Olusturuluyor..." : "Olustur"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
