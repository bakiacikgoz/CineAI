import { Film, FolderOpen, Plus, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

type EmptyStateProps = {
  onNew: () => void;
  onOpen: () => void;
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.15,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: "easeOut" },
  },
} as const;

export function EmptyState({ onNew, onOpen }: EmptyStateProps) {
  return (
    <motion.div
      className="dashboard-empty"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{
        position: "relative",
        overflow: "hidden",
        alignContent: "center",
      }}
    >
      {/* Atmospheric gradient orbs */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,0,0,0.03), transparent 65%)",
          filter: "blur(50px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "15%",
          left: "30%",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.06), transparent 60%)",
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />

      {/* Floating animated icon */}
      <motion.div
        variants={itemVariants}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <motion.div
          animate={{
            y: [0, -8, 0],
          }}
          transition={{
            duration: 3.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 88,
            height: 88,
            borderRadius: 24,
            border: "1px solid rgba(0,0,0,0.08)",
            background:
              "linear-gradient(135deg, rgba(0,0,0,0.03), rgba(0,0,0,0.01))",
            boxShadow: "0 20px 60px rgba(0,0,0,0.04)",
          }}
        >
          <Film size={36} strokeWidth={1.3} style={{ color: "var(--accent)", opacity: 0.7 }} />
        </motion.div>

        {/* Orbiting sparkle */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          style={{
            position: "absolute",
            width: 120,
            height: 120,
          }}
        >
          <Sparkles
            size={14}
            style={{
              position: "absolute",
              top: 0,
              left: "50%",
              transform: "translateX(-50%)",
              color: "var(--accent)",
              opacity: 0.35,
            }}
          />
        </motion.div>
      </motion.div>

      {/* Staggered text */}
      <motion.div
        variants={itemVariants}
        className="dashboard-empty-copy"
      >
        <h2
          className="dashboard-empty-title"
          style={{
            color: "var(--text-primary)",
            fontSize: 26,
          }}
        >
          Henuz proje yok
        </h2>
        <p className="dashboard-empty-description">
          Yeni bir produksiyon baslat ya da mevcut bir CineAI proje klasorunu ac.
          Tum sahneler, karakterler ve asset&apos;ler tek bir yerde.
        </p>
      </motion.div>

      {/* Staggered buttons */}
      <motion.div variants={itemVariants} className="dashboard-empty-actions">
        <motion.button
          className="btn-secondary"
          onClick={onOpen}
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <FolderOpen size={15} />
          Klasor Ac
        </motion.button>
        <motion.button
          className="btn-primary"
          onClick={onNew}
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <Plus size={15} />
          Yeni Proje
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
