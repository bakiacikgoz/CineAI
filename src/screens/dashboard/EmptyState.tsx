import { Film, FolderOpen, Plus } from "lucide-react";
import { motion } from "framer-motion";

type EmptyStateProps = {
  onNew: () => void;
  onOpen: () => void;
};

export function EmptyState({ onNew, onOpen }: EmptyStateProps) {
  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className="dashboard-empty"
      initial={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
    >
      <div className="dashboard-empty-icon">
        <Film size={44} strokeWidth={1.5} />
      </div>
      <div className="dashboard-empty-copy">
        <h2 className="dashboard-empty-title">Henuz proje yok</h2>
        <p className="dashboard-empty-description">
          Yeni bir produksiyon baslat ya da mevcut bir CineAI proje klasorunu ac.
        </p>
      </div>

      <div className="dashboard-empty-actions">
        <button className="btn-secondary" onClick={onOpen} type="button">
          <FolderOpen size={15} />
          Klasor Ac
        </button>
        <button className="btn-primary" onClick={onNew} type="button">
          <Plus size={15} />
          Yeni Proje
        </button>
      </div>
    </motion.div>
  );
}
