import { useState } from "react";
import { Folder, FolderOpen, Plus, FileJson } from "lucide-react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { toProjectFolderName } from "@/services/project.service";
import { ModalShell } from "@/components/ui";

type NewProjectModalProps = {
  onClose: () => void;
  onCreate: (name: string, folderPath: string) => Promise<void>;
};

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

  const footerContent = (
    <>
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
    </>
  );

  return (
    <ModalShell
      title="Yeni Proje"
      subtitle="Produksiyon klasoru olustur"
      onClose={() => {
        if (!creating) onClose();
      }}
      footer={footerContent}
    >
      <div style={{ padding: "16px 20px", display: "grid", gap: 16 }}>
        {/* Form */}
        <div style={{ display: "grid", gap: 14 }}>
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
        </div>

        {/* Folder tree preview */}
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: "14px 16px",
            borderRadius: 12,
            border: "1px solid var(--surface-active)",
            background: "var(--surface-hover)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Folder size={12} style={{ color: "var(--accent)", opacity: 0.7 }} />
            Olusacak yapi
          </div>

          {/* Root path */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 8,
              background: "var(--surface-hover)",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <Folder size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {folderPath || "..."}
            </span>
          </div>

          {/* Project folder */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              paddingLeft: 24,
              borderRadius: 8,
              background: "var(--surface-hover)",
              fontSize: 11,
              color: "var(--accent)",
              fontWeight: 600,
            }}
          >
            <Folder size={12} style={{ flexShrink: 0 }} />
            {previewFolderName}/
          </div>

          {/* Tree items */}
          {treeItems.map((item) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + item.delay, duration: 0.25 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                paddingLeft: 44,
                borderRadius: 8,
                background: "var(--surface-hover)",
                fontSize: 11,
                color: item.isFile ? "var(--text-secondary)" : "var(--text-muted)",
              }}
            >
              {item.isFile ? (
                <FileJson size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
              ) : (
                <Folder size={12} style={{ flexShrink: 0, opacity: 0.4 }} />
              )}
              {item.label}
            </motion.div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
