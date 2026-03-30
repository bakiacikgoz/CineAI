interface SegmentOption {
  key: string;
  label: string;
}

interface SegmentGroupProps {
  options: SegmentOption[];
  value: string;
  onChange: (key: string) => void;
  size?: "sm" | "md";
}

export function SegmentGroup({ options, value, onChange, size = "md" }: SegmentGroupProps) {
  const pad = size === "sm" ? "5px 10px" : "7px 14px";
  const fs = size === "sm" ? 11 : 12;

  return (
    <div style={{ display: "inline-flex", borderRadius: 10, border: "1px solid var(--glass-border)", overflow: "hidden" }}>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            style={{
              padding: pad,
              border: "none",
              fontSize: fs,
              fontWeight: active ? 600 : 500,
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--primary-foreground)" : "var(--text-secondary)",
              cursor: "pointer",
              transition: "all 120ms ease",
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
