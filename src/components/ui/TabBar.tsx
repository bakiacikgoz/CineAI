import type { LucideIcon } from "lucide-react";

interface TabOption {
  key: string;
  label: string;
  icon?: LucideIcon;
}

interface TabBarProps {
  tabs: TabOption[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function TabBar({ tabs, activeKey, onChange }: TabBarProps) {
  return (
    <nav style={{ display: "flex", gap: 0, padding: "0 20px", borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-tint)" }}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "12px 16px 10px",
              border: "none",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              background: "transparent",
              color: active ? "var(--accent)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
              transition: "all 120ms ease",
              whiteSpace: "nowrap",
            }}
          >
            {Icon ? <Icon size={13} /> : null}
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
