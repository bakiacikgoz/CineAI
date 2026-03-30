import { useState, type CSSProperties } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { Sparkles } from "lucide-react";
import { ModalShell, ToggleSwitch, SegmentGroup } from "@/components/ui";
import { countPlannedBulkJobs, resolveBulkScope } from "@/lib/bulk-production";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  type ImageModelId,
  type VideoModelId,
} from "@/services/fal.service";
import {
  enqueueBulkProduction,
  type BulkProductionOptions,
} from "@/services/jobqueue.service";
import { type ShotRow } from "@/services/import.service";
import { bootstrapAutonomousBulk } from "@/services/storyboard-autonomous.service";

interface BulkProductionModalProps {
  shots: ShotRow[];
  selectedShotId: string | null;
  onClose: () => void;
  onDone: () => void;
}

export function BulkProductionModal({
  shots,
  selectedShotId,
  onClose,
  onDone,
}: BulkProductionModalProps) {
  const [produceStart, setProduceStart] = useState(true);
  const [produceEnd, setProduceEnd] = useState(true);
  const [produceCoverage, setProduceCoverage] = useState(false);
  const [produceVideos, setProduceVideos] = useState(false);
  const [autonomousMode, setAutonomousMode] = useState(false);
  const [imageModel, setImageModel] = useState<ImageModelId | "shot-default">("shot-default");
  const [videoModel, setVideoModel] = useState<VideoModelId>("fal-ai/kling-video/v3/pro/image-to-video");
  const [filter, setFilter] = useState<BulkProductionOptions["filter"]>("all");
  const [queuing, setQueuing] = useState(false);
  const [result, setResult] = useState<{ jobCount: number; estimatedCost: number } | null>(null);
  const scopePreview = resolveBulkScope(shots, {
    produceStartFrames: produceStart,
    produceEndFrames: produceEnd,
    produceCoverageImages: produceCoverage,
    produceVideos,
    filter,
    selectedShotIds: selectedShotId ? [selectedShotId] : [],
  });

  const roughJobCount =
    autonomousMode
      ? scopePreview.mainShots.length * 8
      : countPlannedBulkJobs(shots, {
          produceStartFrames: produceStart,
          produceEndFrames: produceEnd,
          produceCoverageImages: produceCoverage,
          produceVideos,
          filter,
          selectedShotIds: selectedShotId ? [selectedShotId] : [],
        });

  async function handleQueue() {
    setQueuing(true);

    try {
      const scope = resolveBulkScope(shots, {
        produceStartFrames: produceStart,
        produceEndFrames: produceEnd,
        produceCoverageImages: produceCoverage,
        produceVideos,
        filter,
        selectedShotIds: selectedShotId ? [selectedShotId] : [],
      });
      const nextResult = autonomousMode
        ? {
            ...(await bootstrapAutonomousBulk(
              scope.mainShots.map((shot) => shot.id),
              {
                imageModel,
                videoModel,
              },
            )),
            estimatedCost: 0,
          }
        : await enqueueBulkProduction({
            produceStartFrames: produceStart,
            produceEndFrames: produceEnd,
            produceCoverageImages: produceCoverage,
            produceVideos,
            imageModel,
            videoModel,
            filter,
            selectedShotIds: scope.selectedMainShotIds,
          });
      setResult(nextResult);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Toplu uretim kuyruga alinamadi.",
        {
          title: "Toplu Uretim",
          kind: "error",
        },
      );
    } finally {
      setQueuing(false);
    }
  }

  const selectedLabel =
    scopePreview.selectedMainShotIds.length > 0
      ? `Secili ana shot (${scopePreview.selectedMainShotIds.length})`
      : "Secili ana shot yok";

  if (result) {
    return (
      <ModalShell title="Toplu Uretim" subtitle="Isler kuyruga eklendi" onClose={onClose} width="min(520px, 100%)">
        <div style={{ display: "grid", gap: 14, textAlign: "center", padding: 24 }}>
          <div
            style={{
              width: 68,
              height: 68,
              display: "grid",
              placeItems: "center",
              justifySelf: "center",
              borderRadius: 999,
              background: "rgba(34, 197, 94, 0.12)",
              color: "var(--status-success)",
            }}
          >
            <Sparkles size={28} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Isler kuyruga eklendi</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            {result.jobCount} is kuyruga gonderildi.
            {result.estimatedCost > 0
              ? ` Tahmini maliyet $${result.estimatedCost.toFixed(3)}.`
              : ""}
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              onDone();
              onClose();
            }}
            type="button"
          >
            Tamam
          </button>
        </div>
      </ModalShell>
    );
  }

  const actionButtons = (
    <>
      <button className="btn-secondary" onClick={onClose} type="button">
        Iptal
      </button>
      <button
        className="btn-primary"
        disabled={
          (!produceStart && !produceEnd && !produceCoverage && !produceVideos) ||
          (filter === "selected" && scopePreview.selectedMainShotIds.length === 0) ||
          queuing
        }
        onClick={() => void handleQueue()}
        type="button"
      >
        {queuing ? "Hazirlaniyor..." : "Isleri kuyruga ekle"}
      </button>
    </>
  );

  return (
    <ModalShell
      title="Toplu Uretim"
      subtitle="Secili shot'lar icin toplu is kuyrugu olustur"
      onClose={onClose}
      width="min(520px, 100%)"
      footer={actionButtons}
    >
      <div style={{ display: "grid", gap: 20, padding: 20 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <ToggleSwitch
            label="Otonom x4 modu"
            description="Her shot icin 4 START + 4 END adayi uretilir. Secimlerinizden sonra video adaylari otomatik akar."
            checked={autonomousMode}
            onChange={setAutonomousMode}
          />
          <ToggleSwitch
            label="Baslangic karesi"
            description="Her ana shot icin baslangic karesi"
            checked={produceStart}
            onChange={setProduceStart}
          />
          <ToggleSwitch
            label="Bitis karesi"
            description="Her ana shot icin bitis karesi"
            checked={produceEnd}
            onChange={setProduceEnd}
          />
          <ToggleSwitch
            label="Coverage gorsel"
            description="Coverage shot kartlari icin still kareler"
            checked={produceCoverage}
            onChange={setProduceCoverage}
          />
          <ToggleSwitch
            label="Video"
            description="Prompt video alanlari icin mp4 uretilir"
            checked={produceVideos}
            onChange={setProduceVideos}
          />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Modeller
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>Gorsel modeli</span>
              <select
                value={imageModel}
                onChange={(event) => setImageModel(event.target.value as ImageModelId | "shot-default")}
                style={selectStyle}
              >
                <option value="shot-default">Shot varsayilanini kullan</option>
                {(Object.entries(IMAGE_MODELS) as [ImageModelId, (typeof IMAGE_MODELS)[ImageModelId]][]).map(
                  ([modelId, meta]) => (
                    <option key={modelId} value={modelId}>
                      {meta.label}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>Video modeli</span>
              <select
                value={videoModel}
                onChange={(event) => setVideoModel(event.target.value as VideoModelId)}
                style={selectStyle}
              >
                {(Object.entries(VIDEO_MODELS) as [VideoModelId, (typeof VIDEO_MODELS)[VideoModelId]][]).map(
                  ([modelId, meta]) => (
                    <option key={modelId} value={modelId}>
                      {meta.label}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Filtre
          </div>
          <SegmentGroup
            options={[
              { key: "all", label: `Tumu (${shots.filter((shot) => !shot.parentShotId).length})` },
              { key: "missing", label: "Eksik" },
              { key: "selected", label: selectedLabel },
            ]}
            value={filter}
            onChange={(key) => setFilter(key as BulkProductionOptions["filter"])}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderRadius: 16,
            border: "1px solid var(--surface-active)",
            background: "rgba(0, 0, 0, 0.02)",
            color: "var(--text-secondary)",
            fontSize: 13,
          }}
        >
          <span>Tahmini is sayisi</span>
          <strong style={{ color: "var(--text-primary)" }}>{roughJobCount}</strong>
        </div>
      </div>
    </ModalShell>
  );
}

const selectStyle: CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid var(--border-subtle)",
  background: "rgba(255, 255, 255, 0.03)",
  color: "var(--text-primary)",
  outline: "none",
};
