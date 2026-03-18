import { useEffect, useState } from "react";
import { FolderOpen, Plus, Sparkles } from "lucide-react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/screens/dashboard/EmptyState";
import { NewProjectModal } from "@/screens/dashboard/NewProjectModal";
import { ProjectCard } from "@/screens/dashboard/ProjectCard";
import { ProjectGridSkeleton } from "@/screens/dashboard/ProjectGridSkeleton";
import {
  createProject,
  deleteProjectFromRegistry,
  getRecentProjects,
  openProject,
  touchProject,
  type ProjectMeta,
} from "@/services/project.service";
import { useProjectStore } from "@/store/project.store";

export function Dashboard() {
  const navigate = useNavigate();
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const setActiveProject = useProjectStore((state) => state.setActiveProject);
  const setRecentProjects = useProjectStore((state) => state.setRecentProjects);
  const [showNewModal, setShowNewModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);

    try {
      const projects = await getRecentProjects();
      setRecentProjects(projects);
    } catch (error) {
      console.error("Failed to load recent projects", error);
      await message("Projeler yuklenemedi.", {
        title: "CineAI Studio",
        kind: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      recursive: true,
      title: "CineAI proje klasoru sec",
    });

    if (!selected || Array.isArray(selected)) {
      return;
    }

    try {
      const meta = await openProject(selected);
      await touchProject(meta.id);
      setActiveProject(meta);
      await loadProjects();
      navigate("/storyboard");
    } catch (error) {
      console.error("Failed to open project", error);
      await message("Gecerli bir CineAI proje klasoru bulunamadi.", {
        title: "Proje acilamadi",
        kind: "error",
      });
    }
  }

  async function handleSelectProject(project: ProjectMeta) {
    try {
      const meta = await openProject(project.folderPath);
      await touchProject(meta.id);
      setActiveProject(meta);
      await loadProjects();
      navigate("/storyboard");
    } catch (error) {
      console.error("Failed to select project", error);
      await message(
        "Bu proje klasorune erisilemedi. Gerekirse yeniden 'Klasor Ac' ile secin.",
        {
          title: "Proje acilamadi",
          kind: "warning",
        },
      );
    }
  }

  async function handleNewProject(name: string, folderPath: string) {
    const meta = await createProject(name, folderPath);
    setActiveProject(meta);
    await loadProjects();
    setShowNewModal(false);
    navigate("/storyboard");
  }

  async function handleRemoveFromList(projectId: string) {
    await deleteProjectFromRegistry(projectId);
    await loadProjects();
  }

  return (
    <>
      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="dashboard-shell"
        initial={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <section className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <span className="dashboard-eyebrow">
              <Sparkles size={14} />
              Project Console
            </span>
            <h1 className="dashboard-title">Projeler</h1>
            <p className="dashboard-description">
              CineAI is akisini tek yerden yonet. Yeni produksiyon baslat, mevcut
              proje klasorunu ac veya son calistigin sahneye geri don.
            </p>
          </div>

          <div className="dashboard-actions">
            <button className="btn-secondary" onClick={handleOpenProject} type="button">
              <FolderOpen size={15} />
              Klasor Ac
            </button>
            <button
              className="btn-primary"
              onClick={() => setShowNewModal(true)}
              type="button"
            >
              <Plus size={15} />
              Yeni Proje
            </button>
          </div>
        </section>

        <section className="dashboard-metrics">
          <article className="dashboard-metric-card">
            <span className="dashboard-metric-label">Son projeler</span>
            <strong className="dashboard-metric-value">{recentProjects.length}</strong>
            <span className="dashboard-metric-copy">
              Registry veritabani uzerinden hizli erisim.
            </span>
          </article>

          <article className="dashboard-metric-card">
            <span className="dashboard-metric-label">Hazir akis</span>
            <strong className="dashboard-metric-value">Yeni veya mevcut</strong>
            <span className="dashboard-metric-copy">
              Ilk kareden storyboard asamasina tek tikla gecis.
            </span>
          </article>
        </section>

        <section className="dashboard-content">
          {loading ? (
            <ProjectGridSkeleton />
          ) : recentProjects.length === 0 ? (
            <EmptyState onNew={() => setShowNewModal(true)} onOpen={handleOpenProject} />
          ) : (
            <div className="project-grid">
              {recentProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  onClick={() => void handleSelectProject(project)}
                  onRemove={() => void handleRemoveFromList(project.id)}
                  project={project}
                />
              ))}
            </div>
          )}
        </section>
      </motion.section>

      {showNewModal ? (
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreate={handleNewProject}
        />
      ) : null}
    </>
  );
}
