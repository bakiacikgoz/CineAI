import type { CSSProperties, ReactNode } from "react";
import {
  ArrowUpToLine,
  AudioLines,
  Film,
  Image as ImageIcon,
  ListOrdered,
  RotateCcw,
  X,
} from "lucide-react";

import { SegmentGroup, ProEmptyState } from "@/components/ui";
import { persistQueueParallelLimit } from "@/lib/store";
import { cancelJob, resumeJobQueue, retryJob } from "@/services/jobqueue.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore, type Job } from "@/store/queue.store";

const JOB_TYPE_LABELS: Record<string, string> = {
  image_start: "START Kare",
  image_end: "END Kare",
  character_image: "Karakter Adayi",
  video: "Video",
  upscale: "4K Yukseltme",
  coverage_image: "Coverage Gorsel",
  coverage_video: "Coverage Video",
  audio_dialogue: "Diyalog Ses",
};

export function JobQueue() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const jobs = useQueueStore((state) => state.jobs);
  const parallelLimit = useQueueStore((state) => state.parallelLimit);
  const setParallelLimit = useQueueStore((state) => state.setParallelLimit);

  const scopedJobs = activeProject
    ? jobs.filter((job) => job.projectId === activeProject.id)
    : jobs;
  const active = scopedJobs.filter((job) => job.status === "active");
  const pending = scopedJobs.filter((job) => job.status === "queued");
  const completed = scopedJobs.filter(
    (job) =>
      job.status === "done" ||
      job.status === "error" ||
      job.status === "cancelled",
  );

  async function updateParallelLimit(nextLimit: number) {
    const normalized = await persistQueueParallelLimit(nextLimit);
    setParallelLimit(normalized);
    resumeJobQueue();
  }

  return (
    <section className="screen-shell">
      <section
        style={{
          display: "grid",
          gap: 18,
          maxWidth: 980,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: 20,
            borderRadius: 24,
            border: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(140deg, rgba(0, 0, 0, 0.02), transparent 34%), var(--bg-surface)",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Kuyruk Izleyici
            </span>
            <div style={{ fontSize: 26, fontWeight: 600 }}>Is Kuyrugu</div>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {activeProject
                ? `${activeProject.name} projesinin aktif ve bekleyen isleri`
                : "Genel kuyruk gorunumu. Bir proje acildiginda liste aktif projeye gore filtrelenir."}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderRadius: 999,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-elevated)",
              padding: "10px 12px",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Paralel limit</span>
            <SegmentGroup
              options={[
                { key: "1", label: "1" },
                { key: "2", label: "2" },
                { key: "3", label: "3" },
                { key: "4", label: "4" },
                { key: "5", label: "5" },
              ]}
              value={String(parallelLimit)}
              onChange={(k) => void updateParallelLimit(Number(k))}
              size="sm"
            />
          </div>
        </header>

        {scopedJobs.length === 0 ? (
          <div
            style={{
              borderRadius: 24,
              border: "1px dashed var(--border-default)",
              background: "var(--bg-surface)",
            }}
          >
            <ProEmptyState
              icon={ListOrdered}
              title="Kuyruk bos"
              description="Uretim islemleri burada gorunecek."
            />
          </div>
        ) : (
          <>
            {active.length > 0 ? (
              <QueueSection title={`Aktif (${active.length})`}>
                {active.map((job) => (
                  <JobRow job={job} key={job.id} />
                ))}
              </QueueSection>
            ) : null}

            {pending.length > 0 ? (
              <QueueSection title={`Bekleyen (${pending.length})`}>
                {pending.map((job) => (
                  <JobRow job={job} key={job.id} />
                ))}
              </QueueSection>
            ) : null}

            {completed.length > 0 ? (
              <QueueSection title={`Tamamlanan (${completed.length})`}>
                {completed
                  .slice()
                  .sort((left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0))
                  .slice(0, 50)
                  .map((job) => (
                    <JobRow job={job} key={job.id} />
                  ))}
              </QueueSection>
            ) : null}
          </>
        )}
      </section>
    </section>
  );
}

function QueueSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 10 }}>{children}</div>
    </section>
  );
}

function JobRow({ job }: { job: Job }) {
  const statusColor: Record<Job["status"], string> = {
    active: "var(--status-warning)",
    queued: "var(--text-muted)",
    done: "var(--status-success)",
    error: "var(--status-error)",
    cancelled: "var(--text-secondary)",
  };

  const statusLabel: Record<Job["status"], string> = {
    active: "Isleniyor",
    queued: "Bekliyor",
    done: "Tamamlandi",
    error: "Hata",
    cancelled: "Iptal",
  };

  const Icon =
    job.type === "video"
      ? Film
      : job.type === "audio_dialogue"
        ? AudioLines
      : job.type === "upscale"
        ? ArrowUpToLine
        : ImageIcon;

  return (
    <article
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: 16,
        borderRadius: 18,
        border: `1px solid ${
          job.status === "error" ? "rgba(239, 68, 68, 0.34)" : "var(--border-subtle)"
        }`,
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          width: 42,
          height: 42,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 14,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-elevated)",
          color: job.status === "active" ? "var(--accent)" : "var(--text-primary)",
        }}
      >
        <Icon size={18} />
      </div>

      <div style={{ display: "grid", flex: 1, gap: 4, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {job.shotId ? `${job.shotId.slice(0, 6)}... -> ` : ""}
            {JOB_TYPE_LABELS[job.type] ?? job.type}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {(job.model ?? "unknown").split("/").pop()}
          </span>
        </div>

        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {job.prompt?.slice(0, 88) || "Prompt kaydi yok."}
        </div>

        {job.status === "active" ? (
          <div
            style={{
              height: 6,
              overflow: "hidden",
              borderRadius: 999,
              background: "var(--surface-active)",
              marginTop: 4,
            }}
          >
            <div
              style={{
                width: `${Math.max(4, job.progress)}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #fff))",
                transition: "width 0.35s ease",
              }}
            />
          </div>
        ) : null}

        {job.status === "error" && job.errorMsg ? (
          <div style={{ fontSize: 12, color: "var(--status-error)" }}>{job.errorMsg}</div>
        ) : null}
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
          padding: "6px 10px",
          borderRadius: 999,
          background: "var(--surface-hover)",
          color: statusColor[job.status],
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {statusLabel[job.status]}
        {job.status === "active" ? `${Math.round(job.progress)}%` : null}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {job.status === "error" ? (
          <button
            className="hover-glow"
            onClick={() => void retryJob(job.id)}
            style={miniButtonStyle}
            type="button"
          >
            <RotateCcw size={13} />
            Tekrarla
          </button>
        ) : null}

        {job.status === "queued" || job.status === "active" ? (
          <button
            className="hover-glow"
            onClick={() => cancelJob(job.id)}
            style={miniButtonStyle}
            type="button"
          >
            <X size={13} />
            Iptal
          </button>
        ) : null}
      </div>
    </article>
  );
}

const miniButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
  transition: "all 150ms ease",
};
