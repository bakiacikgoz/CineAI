import { FolderKanban, PanelLeft, Sparkles } from "lucide-react";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";
import { useUIStore } from "@/store/ui.store";

export function TopBar() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeJobsCount = useQueueStore(
    (state) => state.jobs.filter((job) => job.status === "active").length,
  );
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          aria-label="Toggle sidebar"
          className="icon-button"
          onClick={toggleSidebar}
          type="button"
        >
          <PanelLeft size={16} />
        </button>

        <div className="brand-lockup">
          <span className="brand-mark">CINEAI</span>
          <span className="brand-tagline">Cinematic AI studio workstation</span>
        </div>

        <span className="topbar-divider" />

        <div className="project-chip">
          <FolderKanban size={14} />
          <span className="project-chip-label">
            {activeProject?.name ?? "Proje secilmedi"}
          </span>
          <span className="project-chip-subtle">
            {activeProject ? "aktif proje" : "yerel workspace"}
          </span>
        </div>
      </div>

      <div className="topbar-right">
        <div className={`queue-badge${activeJobsCount > 0 ? " is-active" : ""}`}>
          <span className="queue-dot" />
          <span>{activeJobsCount} aktif is</span>
        </div>

        <div aria-hidden="true" className="icon-button">
          <Sparkles size={16} />
        </div>
      </div>
    </header>
  );
}
