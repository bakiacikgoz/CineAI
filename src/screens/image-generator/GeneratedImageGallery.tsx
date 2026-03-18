import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { Clapperboard, FolderOpen, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { getAssets, type AssetRecord } from "@/services/asset.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";

type GalleryAsset = AssetRecord & {
  absolutePath: string;
  assetUrl: string;
};

type GeneratedImageGalleryProps = {
  projectFolderPath: string;
};

export function GeneratedImageGallery({
  projectFolderPath,
}: GeneratedImageGalleryProps) {
  const activeProject = useProjectStore((state) => state.activeProject);
  const queueJobs = useQueueStore((state) => state.jobs);
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const activeProjectId = activeProject?.id ?? null;
  const jobs = useMemo(
    () =>
      queueJobs.filter(
        (job) =>
          job.projectId === activeProjectId &&
          (job.type === "image_start" ||
            job.type === "image_end" ||
            job.type === "coverage_image"),
      ),
    [activeProjectId, queueJobs],
  );

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === "queued" || job.status === "active"),
    [jobs],
  );

  const refreshMarker = useMemo(
    () => jobs.map((job) => `${job.id}:${job.status}:${job.resultPath ?? ""}`).join("|"),
    [jobs],
  );

  useEffect(() => {
    if (!activeProject) {
      setAssets([]);
      setLoading(false);
      return;
    }

    const project = activeProject;
    let cancelled = false;

    async function loadAssets() {
      setLoading(true);

      try {
        const records = await getAssets(project.id, "image");
        const nextAssets = await Promise.all(
          records.map(async (record) => {
            const absolutePath = await join(projectFolderPath, record.file_path);
            return {
              ...record,
              absolutePath,
              assetUrl: convertFileSrc(absolutePath),
            };
          }),
        );

        if (!cancelled) {
          setAssets(nextAssets);
        }
      } catch (error) {
        console.error("Failed to load gallery assets", error);

        if (!cancelled) {
          setAssets([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, [activeProject, projectFolderPath, refreshMarker]);

  return (
    <section
      style={{
        display: "grid",
        minHeight: 0,
        overflow: "hidden",
        borderRadius: 28,
        border: "1px solid var(--border-subtle)",
        background:
          "linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 22%), var(--bg-surface)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "18px 20px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            <Clapperboard size={13} />
            Generated Frames
          </span>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Galeri</div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 999,
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-elevated)",
            padding: "8px 12px",
            color: "var(--text-secondary)",
            fontSize: 12,
          }}
        >
          <FolderOpen size={14} />
          <span>{assets.length} kayitli asset</span>
        </div>
      </header>

      <div style={{ overflowY: "auto", padding: 20 }}>
        {loading ? (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 280,
              color: "var(--text-muted)",
              gap: 10,
            }}
          >
            <LoaderCircle className="spin-slow" size={28} />
            <span style={{ fontSize: 13 }}>Galeri yukleniyor...</span>
          </div>
        ) : assets.length === 0 && activeJobs.length === 0 ? (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              minHeight: 420,
              borderRadius: 20,
              border: "1px dashed var(--border-default)",
              background: "var(--bg-elevated)",
              textAlign: "center",
              color: "var(--text-secondary)",
              padding: 24,
            }}
          >
            <div style={{ display: "grid", gap: 12, justifyItems: "center", maxWidth: 360 }}>
              <ImageIcon size={38} style={{ color: "var(--accent)" }} />
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)" }}>
                Henuz gorsel uretilmedi
              </div>
              <p style={{ margin: 0, lineHeight: 1.7 }}>
                Sol panelden promptu hazirla. Aktif isler bu alanin ustunde skeleton
                olarak gorunecek, tamamlanan kareler ise buraya dusurulecek.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 18 }}>
            {activeJobs.length > 0 ? (
              <section style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Islenen kareler ({activeJobs.length})
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 14,
                  }}
                >
                  {activeJobs.map((job) => (
                    <ImageSkeleton key={job.id} progress={job.progress} />
                  ))}
                </div>
              </section>
            ) : null}

            {assets.length > 0 ? (
              <section style={{ display: "grid", gap: 12 }}>
                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Kaydedilen kareler ({assets.length})
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 14,
                  }}
                >
                  {assets.map((asset) => (
                    <ImageCard asset={asset} key={asset.id} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function ImageSkeleton({ progress }: { progress: number }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        borderRadius: 18,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          aspectRatio: "16 / 10",
          display: "grid",
          placeItems: "center",
          background:
            "linear-gradient(135deg, rgba(245, 158, 11, 0.16), transparent 50%), var(--bg-overlay)",
        }}
      >
        <LoaderCircle className="spin-slow" size={24} style={{ color: "var(--accent)" }} />
      </div>
      <div style={{ display: "grid", gap: 10, padding: "0 14px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Uretiliyor</div>
        <div
          style={{
            height: 4,
            overflow: "hidden",
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.06)",
          }}
        >
          <div
            style={{
              width: `${Math.max(8, progress)}%`,
              height: "100%",
              borderRadius: 999,
              background: "var(--accent)",
              transition: "width 0.35s ease",
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          %{Math.round(progress)} tamamlandi
        </div>
      </div>
    </div>
  );
}

function ImageCard({ asset }: { asset: GalleryAsset }) {
  return (
    <article
      style={{
        display: "grid",
        gap: 0,
        overflow: "hidden",
        borderRadius: 18,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        boxShadow: "0 24px 70px rgba(0, 0, 0, 0.2)",
      }}
    >
      <img
        alt={asset.filename}
        src={asset.assetUrl}
        style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover" }}
      />
      <div style={{ display: "grid", gap: 8, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {asset.filename}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {new Date(asset.created_at).toLocaleTimeString("tr-TR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {(asset.model_used ?? "unknown").split("/").pop()} · {asset.width ?? "-"} x{" "}
          {asset.height ?? "-"}
        </div>
        <p
          style={{
            margin: 0,
            minHeight: 34,
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {asset.prompt ?? "Prompt kaydi yok."}
        </p>
      </div>
    </article>
  );
}
