import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  headerRight,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section
      style={{
        borderRadius: 16,
        border: "1px solid var(--border-subtle)",
        overflow: "hidden",
        background: "var(--bg-base)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <button
        aria-expanded={isOpen}
        aria-label={`${title} bolumunu ${isOpen ? "kapat" : "ac"}`}
        onClick={() => setIsOpen((current) => !current)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 20px",
          cursor: "pointer",
          background: "var(--gradient-header)",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
          border: "none",
          textAlign: "left",
        }}
        type="button"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <ChevronDown
            size={16}
            style={{
              color: "var(--text-muted)",
              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform var(--duration-fast) var(--ease-out)",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <span>{title}</span>
            {subtitle ? (
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginLeft: 10 }}>
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
        {headerRight ?? null}
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--surface-hover)" }}>
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
