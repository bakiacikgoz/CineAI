import { Download, FileText, Film, Link } from "lucide-react";
import { type ImportPreview } from "@/services/import.service";
import { ModalShell, MetricCard } from "@/components/ui";

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
  const isUpdateFlow = preview.existingShotCount > 0;

  const actionButtons = (
    <>
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
        {importing
          ? (isUpdateFlow ? "Guncelleniyor..." : "Ice aktariliyor...")
          : (isUpdateFlow ? "Shot'lari guncelle" : "Ice aktar")}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Storyboard Ice Aktar"
      subtitle={isUpdateFlow
        ? "Shot'lari guncelle veya yenilerini ekle"
        : "Shot'lari ice aktar"}
      onClose={onClose}
      width="min(460px, 100%)"
      footer={actionButtons}
    >
      <div style={{ display: "grid", gap: 20, padding: 20 }}>
        <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7, fontSize: 13 }}>
          SHOT markdown dosyalari parse edilip storyboard tablosuna uygulanacak.
          {isUpdateFlow
            ? " Ayni shot numarasina sahip kayitlar yeni markdown icerigiyle guncellenecek."
            : " Ilk ice aktarmada yeni shot kayitlari olusturulacak."}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <MetricCard icon={FileText} label="Ana shot" value={preview.totalShots} />
          <MetricCard icon={Film} label="Coverage" value={preview.coverageShots} />
          <MetricCard icon={Link} label="Zincir" value={preview.chainLinks} />
        </div>

        <div
          style={{
            padding: "14px 16px",
            borderRadius: 16,
            border: "1px solid rgba(0, 0, 0, 0.06)",
            background: "rgba(0, 0, 0, 0.02)",
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {preview.files.length} markdown dosyasi islenecek. Mevcut storyboardda{" "}
          {preview.existingShotCount} shot var. Bu ice aktarmada {preview.matchedShotCount} shot
          guncellenecek, {preview.newShotCount} yeni shot eklenecek.
        </div>
      </div>
    </ModalShell>
  );
}
