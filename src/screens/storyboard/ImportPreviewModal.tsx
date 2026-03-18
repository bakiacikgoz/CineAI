import { Download } from "lucide-react";
import { type ImportPreview } from "@/services/import.service";

interface ImportPreviewModalProps {
  preview: ImportPreview;
  importing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ImportPreviewModal({
  preview,
  importing,
  onConfirm,
  onClose,
}: ImportPreviewModalProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 220,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          display: "grid",
          gap: 20,
          padding: 26,
          borderRadius: 24,
          border: "1px solid var(--border-default)",
          background:
            "linear-gradient(180deg, rgba(24, 24, 28, 0.98), rgba(13, 13, 16, 0.98))",
          boxShadow: "0 36px 120px rgba(0, 0, 0, 0.52)",
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 600 }}>Import preview</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            SHOT markdown dosyalari parse edilip mevcut storyboard tablolarina upsert
            edilecek.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <StatCard label="Main shot" value={preview.totalShots} />
          <StatCard label="Coverage" value={preview.coverageShots} />
          <StatCard label="Chain" value={preview.chainLinks} />
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: 16,
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-surface)",
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {preview.files.length} markdown dosyasi islenecek. Ayni shot number'a sahip
          kayitlar guncellenecek.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-secondary" disabled={importing} onClick={onClose} type="button">
            Iptal
          </button>
          <button
            className="btn-primary"
            disabled={importing}
            onClick={onConfirm}
            type="button"
          >
            <Download size={15} />
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: "14px 12px",
        borderRadius: 16,
        border: "1px solid var(--border-subtle)",
        background: "rgba(255, 255, 255, 0.03)",
        textAlign: "center",
      }}
    >
      <strong style={{ fontSize: 24, color: "var(--accent)" }}>{value}</strong>
      <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>
        {label}
      </span>
    </div>
  );
}
