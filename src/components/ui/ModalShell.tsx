import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  width?: string;
  footer?: ReactNode;
}

export function ModalShell({ title, subtitle, children, onClose, width = "min(560px, calc(100vw - 48px))", footer }: ModalShellProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--backdrop-bg)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxHeight: "min(860px, calc(100vh - 48px))",
          borderRadius: 20,
          border: "1px solid var(--glass-border)",
          background: "var(--bg-base)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          display: "grid",
          gridTemplateRows: footer ? "auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", background: "var(--gradient-header)" }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>{title}</h2>
            {subtitle ? <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="icon-button" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }} aria-label="Kapat">
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
          {children}
        </div>

        {/* Footer */}
        {footer ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border-subtle)" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
