import { useMemo, useState } from "react";
import { ModalShell, ToggleSwitch } from "@/components/ui";
import { type ShotRow } from "@/services/import.service";
import {
  DEFAULT_STORYBOARD_EXPORT_OPTIONS,
  hasStoryboardExportContentSelection,
  hasStoryboardExportShotSelection,
  resolveStoryboardExportShots,
  type StoryboardExportOptions,
} from "@/services/storyboard-export.service";

interface StoryboardExportModalProps {
  shots: ShotRow[];
  exporting: boolean;
  showArchived: boolean;
  onClose: () => void;
  onConfirm: (options: StoryboardExportOptions) => void;
}

export function StoryboardExportModal({
  shots,
  exporting,
  showArchived,
  onClose,
  onConfirm,
}: StoryboardExportModalProps) {
  const [options, setOptions] = useState<StoryboardExportOptions>(() => ({
    ...DEFAULT_STORYBOARD_EXPORT_OPTIONS,
  }));

  const mainShotCount = useMemo(
    () => shots.filter((shot) => !shot.parentShotId).length,
    [shots],
  );
  const coverageShotCount = shots.length - mainShotCount;
  const selectedShots = useMemo(
    () => resolveStoryboardExportShots(shots, options),
    [shots, options],
  );
  const canSubmit =
    hasStoryboardExportShotSelection(options) &&
    hasStoryboardExportContentSelection(options) &&
    selectedShots.length > 0 &&
    !exporting;

  const actionButtons = (
    <>
      <button className="btn-secondary" onClick={onClose} type="button">
        Iptal
      </button>
      <button
        className="btn-primary"
        disabled={!canSubmit}
        onClick={() => onConfirm(options)}
        type="button"
      >
        {exporting ? "Export ediliyor..." : "Klasor sec ve export et"}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Storyboard Export"
      subtitle="Hangi shot tiplerini ve hangi icerikleri disa aktaracagini sec"
      onClose={onClose}
      width="min(560px, 100%)"
      footer={actionButtons}
    >
      <div style={{ display: "grid", gap: 20, padding: 20 }}>
        <section style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Shot Tipleri
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <ToggleSwitch
              label="Ana shotlar"
              description={`${mainShotCount} gorunen ana shot export kapsamina dahil edilir.`}
              checked={options.includeMainShots}
              onChange={(checked) =>
                setOptions((current) => ({ ...current, includeMainShots: checked }))
              }
            />
            <ToggleSwitch
              label="Kurgu / coverage shotlari"
              description={`${coverageShotCount} gorunen coverage shot export kapsamina dahil edilir.`}
              checked={options.includeCoverageShots}
              onChange={(checked) =>
                setOptions((current) => ({ ...current, includeCoverageShots: checked }))
              }
            />
          </div>
        </section>

        <section style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Icerikler
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <ToggleSwitch
              label="Video dosyalari"
              description="Video, 4K video ve lipsync ciktilari kopyalanir."
              checked={options.includeVideos}
              onChange={(checked) =>
                setOptions((current) => ({ ...current, includeVideos: checked }))
              }
            />
            <ToggleSwitch
              label="Ses dosyalari"
              description="Audio master ciktilari kopyalanir."
              checked={options.includeAudio}
              onChange={(checked) =>
                setOptions((current) => ({ ...current, includeAudio: checked }))
              }
            />
            <ToggleSwitch
              label="Gorseller ve referanslar"
              description="START, END ve effective external reference gorselleri kopyalanir."
              checked={options.includeVisuals}
              onChange={(checked) =>
                setOptions((current) => ({ ...current, includeVisuals: checked }))
              }
            />
            <ToggleSwitch
              label="Karakter referanslari"
              description="Shot'a bagli look gorselleri karakter klasoru altina kopyalanir."
              checked={options.includeCharacters}
              onChange={(checked) =>
                setOptions((current) => ({ ...current, includeCharacters: checked }))
              }
            />
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gap: 8,
            padding: 14,
            borderRadius: 16,
            border: "1px solid var(--border-default)",
            background: "var(--surface-hover)",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>Secim ozeti</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.7 }}>
            {selectedShots.length} shot export edilecek. Gorunen shot listesi baz alinir;{" "}
            {showArchived ? "arsivlenenler de dahil." : "arsivlenenler disarida kalir."}
          </div>
          {!hasStoryboardExportShotSelection(options) ? (
            <div style={{ fontSize: 12, color: "var(--status-warning)" }}>
              En az bir shot tipi secmelisin.
            </div>
          ) : null}
          {!hasStoryboardExportContentSelection(options) ? (
            <div style={{ fontSize: 12, color: "var(--status-warning)" }}>
              En az bir icerik kategorisi secmelisin.
            </div>
          ) : null}
          {selectedShots.length === 0 && hasStoryboardExportShotSelection(options) ? (
            <div style={{ fontSize: 12, color: "var(--status-warning)" }}>
              Bu filtreyle export edilecek gorunen shot yok.
            </div>
          ) : null}
        </section>
      </div>
    </ModalShell>
  );
}
