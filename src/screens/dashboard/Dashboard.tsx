import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Layers, Plus, Search, Sparkles, Video, Image as ImageIcon, Users } from "lucide-react";
import { message, open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
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
  type ProjectMeta,
} from "@/services/project.service";
import { Portal } from "@/components/Portal";
import { activateProject } from "@/services/project-session.service";
import { useProjectStore } from "@/store/project.store";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
} as const;

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 24,
    },
  },
} as const;

function AnimatedCounter({ value }: { value: number }) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (displayed === value) return;

    const step = value > displayed ? 1 : -1;
    const interval = Math.max(30, 200 / Math.abs(value - displayed));

    const timer = setInterval(() => {
      setDisplayed((prev) => {
        const next = prev + step;
        if ((step > 0 && next >= value) || (step < 0 && next <= value)) {
          clearInterval(timer);
          return value;
        }
        return next;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [value, displayed]);

  return <>{displayed}</>;
}

export function Dashboard() {
  const navigate = useNavigate();
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const setRecentProjects = useProjectStore((state) => state.setRecentProjects);
  const [showNewModal, setShowNewModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    void loadProjects();
  }, []);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return recentProjects;
    const q = searchQuery.toLowerCase().trim();
    return recentProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.folderPath.toLowerCase().includes(q),
    );
  }, [recentProjects, searchQuery]);

  const aggregatedStats = useMemo(() => {
    let totalShots = 0;
    let totalReadyVideo = 0;
    let totalCharacters = 0;
    let totalAssets = 0;

    for (const project of recentProjects) {
      const meta = project.metadata as
        | {
            mainShotCount?: number;
            readyVideoCount?: number;
            characterCount?: number;
            assetCount?: number;
          }
        | undefined;
      if (meta) {
        totalShots += meta.mainShotCount ?? 0;
        totalReadyVideo += meta.readyVideoCount ?? 0;
        totalCharacters += meta.characterCount ?? 0;
        totalAssets += meta.assetCount ?? 0;
      }
    }

    return { totalShots, totalReadyVideo, totalCharacters, totalAssets };
  }, [recentProjects]);

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
      await activateProject(meta, { touch: true });
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
      await activateProject(meta, { touch: true });
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
    await activateProject(meta);
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
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {/* --- Hero Section with gradient mesh --- */}
        <section className="dashboard-hero" style={{ position: "relative", overflow: "hidden" }}>
          {/* Gradient mesh orbs */}
          <div
            style={{
              position: "absolute",
              top: "-30%",
              left: "-10%",
              width: 340,
              height: 340,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(245,158,11,0.15), transparent 65%)",
              filter: "blur(40px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "-40%",
              right: "10%",
              width: 280,
              height: 280,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(59,130,246,0.08), transparent 65%)",
              filter: "blur(36px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "20%",
              right: "-5%",
              width: 200,
              height: 200,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(167,139,250,0.06), transparent 60%)",
              filter: "blur(30px)",
              pointerEvents: "none",
            }}
          />

          <div className="dashboard-hero-copy">
            <motion.span
              className="dashboard-eyebrow"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, duration: 0.35 }}
            >
              <Sparkles size={14} />
              Production Console
            </motion.span>
            <motion.h1
              className="dashboard-title"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.4, ease: "easeOut" }}
            >
              Projeler
            </motion.h1>
            <motion.p
              className="dashboard-description"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.4, ease: "easeOut" }}
            >
              CineAI is akisini tek yerden yonet. Yeni produksiyon baslat, mevcut
              proje klasorunu ac veya son calistigin sahneye geri don.
            </motion.p>
          </div>

          <motion.div
            className="dashboard-actions"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.35 }}
          >
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
          </motion.div>
        </section>

        {/* --- Metrics Section --- */}
        <motion.section
          className="dashboard-metrics"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
        >
          <article className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(245,158,11,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Layers size={18} style={{ color: "var(--accent)", opacity: 0.6 }} />
            </div>
            <span className="dashboard-metric-label">Projeler</span>
            <strong className="dashboard-metric-value">
              <AnimatedCounter value={recentProjects.length} />
            </strong>
            <span className="dashboard-metric-copy">Kayitli produksiyonlar</span>
          </article>

          <article className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(59,130,246,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ImageIcon size={18} style={{ color: "var(--status-info)", opacity: 0.6 }} />
            </div>
            <span className="dashboard-metric-label">Toplam sahne</span>
            <strong className="dashboard-metric-value">
              <AnimatedCounter value={aggregatedStats.totalShots} />
            </strong>
            <span className="dashboard-metric-copy">Tum projelerdeki main shot sayisi</span>
          </article>

          <article className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(34,197,94,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Video size={18} style={{ color: "var(--status-success)", opacity: 0.6 }} />
            </div>
            <span className="dashboard-metric-label">Hazir video</span>
            <strong className="dashboard-metric-value">
              <AnimatedCounter value={aggregatedStats.totalReadyVideo} />
            </strong>
            <span className="dashboard-metric-copy">Video uretimi tamamlanan sahneler</span>
          </article>

          <article className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(167,139,250,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Users size={18} style={{ color: "var(--status-purple)", opacity: 0.6 }} />
            </div>
            <span className="dashboard-metric-label">Karakterler</span>
            <strong className="dashboard-metric-value">
              <AnimatedCounter value={aggregatedStats.totalCharacters} />
            </strong>
            <span className="dashboard-metric-copy">Tanimlanan karakter referanslari</span>
          </article>

          <article className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: -8,
                right: -8,
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(245,158,11,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FolderOpen size={18} style={{ color: "var(--accent)", opacity: 0.6 }} />
            </div>
            <span className="dashboard-metric-label">Assetler</span>
            <strong className="dashboard-metric-value">
              <AnimatedCounter value={aggregatedStats.totalAssets} />
            </strong>
            <span className="dashboard-metric-copy">Kutuphane ve storyboard medya kayitlari</span>
          </article>
        </motion.section>

        {/* --- Search Bar (only when projects exist) --- */}
        {!loading && recentProjects.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.3 }}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                position: "relative",
                flex: 1,
                maxWidth: 420,
              }}
            >
              <Search
                size={15}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                  pointerEvents: "none",
                }}
              />
              <input
                className="project-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Proje ara..."
                style={{
                  width: "100%",
                  paddingLeft: 38,
                  fontSize: 13,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {filteredProjects.length} / {recentProjects.length} proje
            </span>
          </motion.div>
        )}

        {/* --- Project Content --- */}
        <section className="dashboard-content">
          {loading ? (
            <ProjectGridSkeleton />
          ) : recentProjects.length === 0 ? (
            <EmptyState onNew={() => setShowNewModal(true)} onOpen={handleOpenProject} />
          ) : filteredProjects.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                padding: "60px 24px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: 14,
              }}
            >
              <Search size={32} strokeWidth={1.2} style={{ opacity: 0.3, marginBottom: 4 }} />
              <span>
                &quot;{searchQuery}&quot; icin sonuc bulunamadi.
              </span>
            </motion.div>
          ) : (
            <motion.div
              className="project-grid"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              key={searchQuery}
            >
              <AnimatePresence mode="popLayout">
                {filteredProjects.map((project, index) => (
                  <motion.div
                    key={project.id}
                    variants={cardVariants}
                    layout
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                  >
                    <ProjectCard
                      onClick={() => void handleSelectProject(project)}
                      onRemove={() => void handleRemoveFromList(project.id)}
                      project={project}
                      index={index}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </section>
      </motion.section>

      <AnimatePresence>
        {showNewModal ? (
          <Portal>
            <NewProjectModal
              onClose={() => setShowNewModal(false)}
              onCreate={handleNewProject}
            />
          </Portal>
        ) : null}
      </AnimatePresence>
    </>
  );
}
