import { motion } from "framer-motion";

const shimmerKeyframes = {
  initial: { backgroundPosition: "-200% 0" },
  animate: { backgroundPosition: "200% 0" },
} as const;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
} as const;

export function ProjectGridSkeleton() {
  return (
    <motion.div
      className="project-grid"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <motion.div
          key={index}
          variants={itemVariants}
          style={{
            minHeight: 228,
            borderRadius: 22,
            border: "1px solid var(--border-subtle)",
            background: "rgba(17,17,19,0.72)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Media skeleton with shimmer */}
          <motion.div
            initial={shimmerKeyframes.initial}
            animate={shimmerKeyframes.animate}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "linear",
              delay: index * 0.12,
            }}
            style={{
              height: 138,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.02) 80%)",
              backgroundSize: "200% 100%",
            }}
          />

          {/* Body skeleton */}
          <div style={{ padding: 18, display: "grid", gap: 12 }}>
            {/* Title shimmer */}
            <motion.div
              initial={shimmerKeyframes.initial}
              animate={shimmerKeyframes.animate}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "linear",
                delay: index * 0.12 + 0.1,
              }}
              style={{
                width: "65%",
                height: 14,
                borderRadius: 6,
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.04) 80%)",
                backgroundSize: "200% 100%",
              }}
            />

            {/* Date shimmer */}
            <motion.div
              initial={shimmerKeyframes.initial}
              animate={shimmerKeyframes.animate}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "linear",
                delay: index * 0.12 + 0.15,
              }}
              style={{
                width: "40%",
                height: 10,
                borderRadius: 4,
                background:
                  "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.03) 80%)",
                backgroundSize: "200% 100%",
              }}
            />

            {/* Tags shimmer */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <motion.div
                initial={shimmerKeyframes.initial}
                animate={shimmerKeyframes.animate}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "linear",
                  delay: index * 0.12 + 0.2,
                }}
                style={{
                  width: 72,
                  height: 24,
                  borderRadius: 999,
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.03) 80%)",
                  backgroundSize: "200% 100%",
                }}
              />
              <motion.div
                initial={shimmerKeyframes.initial}
                animate={shimmerKeyframes.animate}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "linear",
                  delay: index * 0.12 + 0.25,
                }}
                style={{
                  width: 56,
                  height: 24,
                  borderRadius: 999,
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.03) 80%)",
                  backgroundSize: "200% 100%",
                }}
              />
            </div>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
