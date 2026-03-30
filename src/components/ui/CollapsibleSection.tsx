import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({ title, subtitle, defaultOpen, headerRight, children }: CollapsibleSectionProps) {
  return (
    <details style={{ borderRadius: 16, border: "1px solid var(--border-subtle)", overflow: "hidden" }} open={defaultOpen}>
      <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 20px", cursor: "pointer", background: "var(--gradient-header)", fontSize: 14, fontWeight: 600, color: "var(--text-primary)", listStyle: "none" }}>
        <div style={{ minWidth: 0 }}>
          <span>{title}</span>
          {subtitle ? <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginLeft: 10 }}>{subtitle}</span> : null}
        </div>
        {headerRight ?? null}
      </summary>
      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--surface-hover)" }}>{children}</div>
    </details>
  );
}
