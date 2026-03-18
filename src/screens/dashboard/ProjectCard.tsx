import { useState, type MouseEvent } from "react";
import { Clapperboard, Folder, Trash2 } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { ProjectMeta } from "@/services/project.service";

type ProjectCardProps = {
  project: ProjectMeta;
  onClick: () => void;
  onRemove: () => Promise<void> | void;
};

function getFolderLabel(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? "-";
}

export function ProjectCard({ project, onClick, onRemove }: ProjectCardProps) {
  const [removing, setRemoving] = useState(false);

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
    <div
      className="project-card"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="project-card-media">
        <div className="project-card-gradient" />
        <span className="project-card-icon">
          <Clapperboard size={28} strokeWidth={1.5} />
        </span>
        <button
          className="card-remove-btn"
          disabled={removing}
          onClick={(event) => void handleRemove(event)}
          title="Listeden kaldir"
          type="button"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="project-card-body">
        <div className="project-card-topline">
          <span className="project-card-name">{project.name}</span>
          <span className="project-card-date">
            {new Date(project.updatedAt).toLocaleDateString("tr-TR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
        </div>

        <p className="project-card-path">{project.folderPath}</p>

        <div className="project-card-tags">
          <span className="project-card-tag">
            <Folder size={12} />
            {getFolderLabel(project.folderPath)}
          </span>
          <span className="project-card-tag is-muted">Storyboard hazir</span>
        </div>
      </div>
    </div>
  );
}
