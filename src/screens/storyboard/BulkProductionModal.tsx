import { useState, type CSSProperties } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { Sparkles } from "lucide-react";
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
  onClose: () => void;
  onDone: () => void;
}

export function BulkProductionModal({
  shots,
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

  const roughJobCount =
    autonomousMode
      ? shots.length * 8
      : (produceStart ? shots.length : 0) +
        (produceEnd ? shots.length : 0) +
        (produceVideos ? shots.filter((shot) => Boolean(shot.promptVideo)).length : 0) +
        (produceCoverage ? Math.max(0, Math.round(shots.length * 0.4)) : 0);

  async function handleQueue() {
    setQueuing(true);

    try {
      const scopedShots =
        filter === "missing"
          ? shots.filter(
              (shot) =>
                !shot.imageStartPath || !shot.imageEndPath || !shot.videoPath,
            )
          : shots;
      const nextResult = autonomousMode
        ? {
            ...(await bootstrapAutonomousBulk(scopedShots.map((shot) => shot.id), {
              imageModel,
              videoModel,
            })),
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
          });
      setResult(nextResult);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Toplu uretim kuyruga alinamadi.",
        {
          title: "Bulk Production",
          kind: "error",
        },
      );
    } finally {
      setQueuing(false);
    }
  }

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
          width: "min(520px, 100%)",
          display: "grid",
          gap: 20,
          padding: 26,
          borderRadius: 26,
          border: "1px solid var(--border-default)",
          background:
            "linear-gradient(180deg, rgba(24, 24, 28, 0.98), rgba(13, 13, 16, 0.98))",
          boxShadow: "0 36px 120px rgba(0, 0, 0, 0.52)",
        }}
      >
        {result ? (
          <div style={{ display: "grid", gap: 14, textAlign: "center" }}>
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
            <div style={{ fontSize: 22, fontWeight: 600 }}>Jobs queued</div>
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
        ) : (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 24, fontWeight: 600 }}>Bulk production</div>
              <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Storyboard rails uzerinden START, END, coverage ve video islerini tek
                seferde kuyruga ekle.
              </p>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <OptionRow
                checked={autonomousMode}
                description="Her shot icin 4 START + 4 END adayi uretilir. Secimlerinizden sonra video adaylari otomatik akar."
                label="Autonomous x4 mode"
                onChange={setAutonomousMode}
              />
              <OptionRow
                checked={produceStart}
                description="Her main shot icin baslangic karesi"
                label="Start frame"
                onChange={setProduceStart}
              />
              <OptionRow
                checked={produceEnd}
                description="Her main shot icin bitis karesi"
                label="End frame"
                onChange={setProduceEnd}
              />
              <OptionRow
                checked={produceCoverage}
                description="Coverage shot kartlari icin still kareler"
                label="Coverage image"
                onChange={setProduceCoverage}
              />
              <OptionRow
                checked={produceVideos}
                description="Prompt video alanlari icin mp4 uretilir"
                label="Video"
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
                Models
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
                  <span>Image model</span>
                  <select
                    value={imageModel}
                    onChange={(event) => setImageModel(event.target.value as ImageModelId | "shot-default")}
                    style={selectStyle}
                  >
                    <option value="shot-default">Use shot default</option>
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
                  <span>Video model</span>
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
                Filter
              </div>
              {(["all", "missing"] as const).map((filterValue) => (
                <label
                  key={filterValue}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid var(--border-subtle)",
                    background: "rgba(255, 255, 255, 0.02)",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <input
                    checked={filter === filterValue}
                    onChange={() => setFilter(filterValue)}
                    style={{ accentColor: "var(--accent)" }}
                    type="radio"
                  />
                  {filterValue === "all"
                    ? `Tum shot'lar (${shots.length})`
                    : "Eksik medyasi olan shot'lar"}
                </label>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                borderRadius: 16,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-surface)",
                color: "var(--text-secondary)",
                fontSize: 13,
              }}
            >
              <span>Tahmini is sayisi</span>
              <strong style={{ color: "var(--text-primary)" }}>{roughJobCount}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="btn-secondary" onClick={onClose} type="button">
                Iptal
              </button>
              <button
                className="btn-primary"
                disabled={
                  (!produceStart && !produceEnd && !produceCoverage && !produceVideos) ||
                  queuing
                }
                onClick={() => void handleQueue()}
                type="button"
              >
                {queuing ? "Preparing..." : "Queue jobs"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OptionRow({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 16,
        border: `1px solid ${checked ? "rgba(245, 158, 11, 0.24)" : "var(--border-subtle)"}`,
        background: checked ? "rgba(245, 158, 11, 0.08)" : "rgba(255, 255, 255, 0.02)",
        cursor: "pointer",
      }}
    >
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: "var(--accent)", marginTop: 2 }}
        type="checkbox"
      />
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {description}
        </div>
      </div>
    </label>
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
