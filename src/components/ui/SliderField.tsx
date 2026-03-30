interface SliderFieldProps {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
}

export function SliderField({ label, min, max, step = 1, value, onChange, unit }: SliderFieldProps) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", fontVariantNumeric: "tabular-nums", padding: "2px 8px", borderRadius: 6, background: "var(--surface-hover)" }}>
          {value}{unit ?? ""}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", minWidth: 20 }}>{min}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: "var(--accent)" }}
        />
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", minWidth: 20, textAlign: "right" }}>{max}</span>
      </div>
    </div>
  );
}
