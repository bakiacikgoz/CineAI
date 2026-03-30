function resolveColor(status: string): string {
  if (status === "done" || status === "success") return "var(--status-success)";
  if (status === "generating" || status === "active" || status === "warning") return "var(--status-warning)";
  if (status === "error") return "var(--status-error)";
  if (status === "queued" || status === "pending") return "var(--text-muted)";
  return "var(--text-muted)";
}

interface StatusDotProps {
  status: string;
  label?: string;
  size?: number;
}

export function StatusDot({ status, label, size = 6 }: StatusDotProps) {
  const color = resolveColor(status);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: label ? "3px 8px" : undefined, borderRadius: label ? 6 : undefined, background: label ? `color-mix(in srgb, ${color} 10%, transparent)` : undefined, fontSize: 10, fontWeight: 600, color }}>
      <span style={{ width: size, height: size, borderRadius: 999, background: "currentColor", flexShrink: 0 }} />
      {label ?? null}
    </span>
  );
}
