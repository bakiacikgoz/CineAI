import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  description?: string;
  accentColor?: string;
}

export function MetricCard({ icon: Icon, label, value, description, accentColor = "var(--surface-hover)" }: MetricCardProps) {
  return (
    <div style={{ display: "grid", gap: 8, padding: "16px 18px", borderRadius: 14, border: "1px solid var(--border-subtle)", background: "var(--surface-card)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: accentColor }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, background: accentColor, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon size={16} style={{ color: "var(--text-secondary)" }} />
        </div>
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
        {description ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{description}</div> : null}
      </div>
    </div>
  );
}
