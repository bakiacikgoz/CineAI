import type { ReactNode } from "react";

interface ProCardProps {
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  borderColor?: string;
  noPadding?: boolean;
}

export function ProCard({ title, subtitle, headerRight, footer, children, borderColor, noPadding }: ProCardProps) {
  return (
    <div style={{ borderRadius: 16, border: `1px solid ${borderColor ?? "var(--border-subtle)"}`, overflow: "hidden" }}>
      {title ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", background: "var(--gradient-header)", borderBottom: "1px solid var(--surface-hover)" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>{title}</h3>
            {subtitle ? <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{subtitle}</p> : null}
          </div>
          {headerRight ?? null}
        </div>
      ) : null}
      <div style={noPadding ? undefined : { padding: "16px 20px" }}>{children}</div>
      {footer ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--surface-hover)" }}>{footer}</div>
      ) : null}
    </div>
  );
}
