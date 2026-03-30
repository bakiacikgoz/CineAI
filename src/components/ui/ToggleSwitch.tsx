interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, label, description, disabled }: ToggleSwitchProps) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{label}</div>
        {description ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{description}</div> : null}
      </div>
      <div style={{ position: "relative", width: 40, height: 22, borderRadius: 11, background: checked ? "var(--accent)" : "var(--toggle-off)", transition: "background 200ms ease", flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: 9, background: "var(--toggle-knob)", boxShadow: "0 1px 3px rgba(0,0,0,0.15)", transition: "left 200ms cubic-bezier(0.4,0,0.2,1)" }} />
        <input
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          type="checkbox"
          style={{ position: "absolute", opacity: 0, width: "100%", height: "100%", cursor: disabled ? "default" : "pointer", margin: 0 }}
        />
      </div>
    </label>
  );
}
