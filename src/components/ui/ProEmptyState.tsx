import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface ProEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function ProEmptyState({ icon: Icon, title, description, action }: ProEmptyStateProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 24px", textAlign: "center" }}>
      <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--surface-hover)", display: "grid", placeItems: "center" }}>
        <Icon size={22} style={{ color: "var(--text-muted)" }} />
      </div>
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{description}</div>
      </div>
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}
