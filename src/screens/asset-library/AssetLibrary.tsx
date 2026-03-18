import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { message } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpToLine,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Search,
  Sparkles,
  Video,
} from "lucide-react";
import {
  assignAssetToShot,
  getAssets,
  type AssetWithTags,
} from "@/services/asset.service";
import { enqueueUpscaleJobs } from "@/services/jobqueue.service";
import { getAppSetting, getAppSettings } from "@/lib/store";
import { getShots, type ShotRow } from "@/services/import.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";

type LibraryAsset = AssetWithTags & {
  absolutePath: string;
  assetUrl: string;
};

type AssignmentTarget = "start" | "end" | "video" | "reference";
type AssetLibraryLocationState = {
  shotId?: string;
  assignmentTarget?: AssignmentTarget;
  selectedAssetId?: string;
  selectedFilePath?: string;
  search?: string;
  typeFilter?: "all" | "image" | "video";
};

export function AssetLibrary() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const location = useLocation();
  const navigate = useNavigate();
  const queueJobs = useQueueStore((state) => state.jobs);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [shotTargetId, setShotTargetId] = useState<string>("");
  const [assignmentTarget, setAssignmentTarget] = useState<AssignmentTarget>("start");
  const [upscaling, setUpscaling] = useState(false);
  const activeProjectId = activeProject?.id ?? null;
  const refreshMarker = queueJobs
    .filter((job) => job.projectId === activeProjectId)
    .map((job) => `${job.id}:${job.status}:${job.resultPath ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!activeProject) {
      setAssets([]);
      setShots([]);
      setLoading(false);
      return;
    }

    const project = activeProject;
    let cancelled = false;

    async function loadData() {
      setLoading(true);

      try {
        const [assetRows, shotRows] = await Promise.all([
          getAssets(project.id),
          getShots(project.id, { includeArchived: true }),
        ]);
        const resolvedAssets = await Promise.all(
          assetRows.map(async (asset) => {
            const absolutePath = await join(
              project.folderPath,
              ...asset.file_path.split(/[\\/]+/).filter(Boolean),
            );
            return {
              ...asset,
              absolutePath,
              assetUrl: convertFileSrc(absolutePath),
            };
          }),
        );

        if (!cancelled) {
          setAssets(resolvedAssets);
          setShots(shotRows);
          if (!selectedAssetId && resolvedAssets[0]) {
            setSelectedAssetId(resolvedAssets[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to load asset library", error);
        if (!cancelled) {
          setAssets([]);
          setShots([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [activeProject, refreshMarker, selectedAssetId]);

  const models = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.model_used).filter(Boolean))).sort(),
    [assets],
  );

  const filteredAssets = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return assets.filter((asset) => {
      if (typeFilter !== "all" && asset.type !== typeFilter) {
        return false;
      }

      if (modelFilter !== "all" && asset.model_used !== modelFilter) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      return [
        asset.filename,
        asset.model_used ?? "",
        asset.prompt ?? "",
        asset.tagsList.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });
  }, [assets, modelFilter, search, typeFilter]);

  const selectedAsset =
    filteredAssets.find((asset) => asset.id === selectedAssetId) ??
    assets.find((asset) => asset.id === selectedAssetId) ??
    null;
  const shotOptions = shots.filter((shot) => !shot.parentShotId);
  const selectedShot = selectedAsset?.shot_id
    ? shots.find((shot) => shot.id === selectedAsset.shot_id) ?? null
    : null;

  useEffect(() => {
    const state = location.state as AssetLibraryLocationState | null;
    if (!state) {
      return;
    }

    if (state.shotId) {
      setShotTargetId(state.shotId);
    }

    if (state.assignmentTarget) {
      setAssignmentTarget(state.assignmentTarget);
    }

    if (state.selectedAssetId) {
      setSelectedAssetId(state.selectedAssetId);
    } else if (state.selectedFilePath) {
      const matchingAsset = assets.find((asset) => asset.file_path === state.selectedFilePath);
      if (matchingAsset) {
        setSelectedAssetId(matchingAsset.id);
      }
    }

    if (state.search) {
      setSearch(state.search);
    }

    if (state.typeFilter) {
      setTypeFilter(state.typeFilter);
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [assets, location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!selectedAsset) {
      return;
    }

    if (selectedAsset.shot_id) {
      setShotTargetId(selectedAsset.shot_id);
    }
  }, [selectedAsset]);

  async function handleAssign() {
    if (!selectedAsset || !shotTargetId) {
      return;
    }

    try {
      await assignAssetToShot(selectedAsset.id, shotTargetId, assignmentTarget);
      await message("Asset shot'a baglandi.", {
        title: "Asset Library",
        kind: "info",
      });
      setSelectedAssetId(selectedAsset.id);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Asset shot'a atanamadi.",
        { title: "Asset Library", kind: "error" },
      );
    }
  }

  async function handleUpscale() {
    if (!selectedAsset || selectedAsset.type !== "video") {
      return;
    }

    setUpscaling(true);

    try {
      const settings = await getAppSettings();
      const savedFilter = await getAppSetting<string>("DEFAULT_TENSORPIX_FILTER");
      await enqueueUpscaleJobs({
        assetId: selectedAsset.id,
        shotId: selectedAsset.shot_id ?? undefined,
        sourcePath: selectedAsset.absolutePath,
        sourceRelativePath: selectedAsset.file_path,
        priority: 75,
        outputSuffix: "library",
        filterId: savedFilter ? Number.parseInt(savedFilter, 10) : undefined,
      });
      await message(
        `${settings.defaultUpscaleFactor === 4 ? "4K" : "2x"} upscale kuyruğa alindi.`,
        {
          title: "Asset Library",
          kind: "info",
        },
      );
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Upscale kuyruğa alinamadi.",
        { title: "Asset Library", kind: "error" },
      );
    } finally {
      setUpscaling(false);
    }
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <EmptyPanel
          copy="Asset arsivi proje baglaminda calisir. Devam etmek icin once bir proje ac."
          title="Asset Library hazir"
        />
      </section>
    );
  }

  return (
    <section className="screen-shell">
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: 18,
          minHeight: "calc(100vh - var(--topbar-h) - 110px)",
        }}
      >
        <section
          style={{
            display: "grid",
            gap: 18,
            minWidth: 0,
          }}
        >
          <header
            style={{
              display: "grid",
              gap: 16,
              padding: 24,
              borderRadius: 28,
              border: "1px solid var(--border-subtle)",
              background:
                "linear-gradient(140deg, rgba(245, 158, 11, 0.08), transparent 32%), var(--bg-surface)",
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <span style={eyebrowStyle}>
                <Sparkles size={13} />
                Asset Vault
              </span>
              <div style={{ fontSize: 28, fontWeight: 600 }}>Asset Library</div>
              <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Uretilen ve ice aktarilan medya dosyalarini tek yerde ara, onizle,
                shot'lara bagla ve 4K islemlerini tetikle.
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(220px, 1fr) repeat(2, 180px)",
                gap: 10,
              }}
            >
              <label style={filterFieldStyle}>
                <span>Ara</span>
                <div style={searchInputWrapStyle}>
                  <Search size={14} />
                  <input
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Dosya adi, prompt, tag..."
                    style={searchInputStyle}
                    value={search}
                  />
                </div>
              </label>

              <label style={filterFieldStyle}>
                <span>Tip</span>
                <select
                  onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
                  style={selectStyle}
                  value={typeFilter}
                >
                  <option value="all">Tum tipler</option>
                  <option value="image">Image</option>
                  <option value="video">Video</option>
                </select>
              </label>

              <label style={filterFieldStyle}>
                <span>Model</span>
                <select
                  onChange={(event) => setModelFilter(event.target.value)}
                  style={selectStyle}
                  value={modelFilter}
                >
                  <option value="all">Tum modeller</option>
                  {models.map((model) => (
                    <option key={model} value={model ?? "unknown"}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          <section
            style={{
              minWidth: 0,
              padding: 18,
              borderRadius: 28,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-surface)",
            }}
          >
            {loading ? (
              <EmptyPanel copy="Asset kayitlari yukleniyor..." title="Yukleniyor" loading />
            ) : filteredAssets.length === 0 ? (
              <EmptyPanel
                copy="Su anki filtrelere uyan asset bulunamadi. Generator ekranlari ya da storyboard import ile veri olustur."
                title="Asset bulunamadi"
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                {filteredAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    style={{
                      display: "grid",
                      gap: 0,
                      overflow: "hidden",
                      padding: 0,
                      textAlign: "left",
                      borderRadius: 18,
                      border: `1px solid ${
                        selectedAssetId === asset.id
                          ? "rgba(245, 158, 11, 0.3)"
                          : "var(--border-subtle)"
                      }`,
                      background: "var(--bg-elevated)",
                      cursor: "pointer",
                    }}
                    type="button"
                  >
                    {asset.type === "image" ? (
                      <img
                        alt={asset.filename}
                        src={asset.assetUrl}
                        style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover" }}
                      />
                    ) : (
                      <video
                        muted
                        playsInline
                        preload="metadata"
                        src={asset.assetUrl}
                        style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover" }}
                      />
                    )}

                    <div style={{ display: "grid", gap: 8, padding: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={assetTypeBadgeStyle(asset.type)}>
                          {asset.type === "image" ? <ImageIcon size={11} /> : <Video size={11} />}
                          {asset.type.toUpperCase()}
                        </span>
                        {asset.resolution ? (
                          <span style={mutedBadgeStyle}>{asset.resolution}</span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{asset.filename}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {asset.model_used ?? "unknown model"}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </section>

        <aside
          style={{
            display: "grid",
            alignContent: "start",
            gap: 14,
            padding: 18,
            borderRadius: 28,
            border: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(180deg, rgba(245, 158, 11, 0.06), transparent 24%), var(--bg-surface)",
          }}
        >
          {selectedAsset ? (
            <>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{selectedAsset.filename}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  {selectedAsset.prompt?.slice(0, 180) ?? "Prompt kaydi yok."}
                </div>
              </div>

              {selectedAsset.type === "image" ? (
                <img
                  alt={selectedAsset.filename}
                  src={selectedAsset.assetUrl}
                  style={{ width: "100%", borderRadius: 20, objectFit: "cover" }}
                />
              ) : (
                <video
                  controls
                  src={selectedAsset.assetUrl}
                  style={{ width: "100%", borderRadius: 20, background: "#000" }}
                />
              )}

              <section style={detailSectionStyle}>
                <div style={detailLabelStyle}>Metadata</div>
                <DetailRow label="Tip" value={selectedAsset.type} />
                <DetailRow label="Model" value={selectedAsset.model_used ?? "unknown"} />
                <DetailRow label="Bagli shot" value={selectedAsset.shot_id ?? "-"} />
                <DetailRow label="Hedef slot" value={assignmentTarget.toUpperCase()} />
                <DetailRow
                  label="Olusma"
                  value={new Date(selectedAsset.created_at).toLocaleString("tr-TR")}
                />
              </section>

              <section style={detailSectionStyle}>
                <div style={detailLabelStyle}>Shot assignment</div>
                {shotTargetId ? (
                  <div
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(245, 158, 11, 0.22)",
                      background: "rgba(245, 158, 11, 0.08)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}
                  >
                    Bu panel storyboard handoff modunda. Sececegin asset{" "}
                    <strong style={{ color: "var(--accent)" }}>
                      {shots.find((shot) => shot.id === shotTargetId)?.shotNumber ?? "selected shot"}
                    </strong>{" "}
                    icindeki <strong style={{ color: "var(--accent)" }}>{assignmentTarget.toUpperCase()}</strong>{" "}
                    slotuna baglanacak.
                  </div>
                ) : null}
                <select
                  onChange={(event) => setShotTargetId(event.target.value)}
                  style={selectStyle}
                  value={shotTargetId}
                >
                  <option value="">Shot sec</option>
                  {shotOptions.map((shot) => (
                    <option key={shot.id} value={shot.id}>
                      {shot.shotNumber}
                    </option>
                  ))}
                </select>
                <select
                  onChange={(event) => setAssignmentTarget(event.target.value as AssignmentTarget)}
                  style={selectStyle}
                  value={assignmentTarget}
                >
                  {selectedAsset.type === "image" ? (
                    <>
                      <option value="start">Start frame</option>
                      <option value="end">End frame</option>
                      <option value="reference">External reference</option>
                    </>
                  ) : (
                    <option value="video">Video slot</option>
                  )}
                </select>
                <button
                  className="btn-primary"
                  disabled={!shotTargetId}
                  onClick={() => void handleAssign()}
                  type="button"
                >
                  <Link2 size={14} />
                  Shot'a bagla
                </button>
                {shotTargetId ? (
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      navigate("/storyboard", {
                        state: {
                          focusShotId: shotTargetId,
                          previewTarget:
                            assignmentTarget === "video"
                              ? "video"
                              : assignmentTarget === "end"
                                ? "end"
                                : "start",
                        },
                      })
                    }
                    type="button"
                  >
                    <Link2 size={14} />
                    Storyboard'a don
                  </button>
                ) : null}
              </section>

              <section style={detailSectionStyle}>
                <div style={detailLabelStyle}>Quick actions</div>
                {selectedAsset.type === "image" ? (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        navigate("/image-generator", {
                          state: {
                            referenceAssetPath: selectedAsset.absolutePath,
                          },
                        })
                      }
                      type="button"
                    >
                      <ImageIcon size={14} />
                      Image Generator'da referans kullan
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        navigate("/video-generator", {
                          state: {
                            startAssetId: selectedAsset.id,
                          },
                        })
                      }
                      type="button"
                    >
                      <Video size={14} />
                      Video Generator'a START gonder
                    </button>
                  </>
                ) : null}
                {selectedAsset.shot_id ? (
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      navigate("/storyboard", {
                        state: {
                          focusShotId: selectedAsset.shot_id,
                          previewTarget:
                            selectedAsset.type === "video"
                              ? "video"
                              : selectedShot?.imageEndPath === selectedAsset.file_path
                                ? "end"
                                : "start",
                        },
                      })
                    }
                    type="button"
                  >
                    <Link2 size={14} />
                    Storyboard'da ac
                  </button>
                ) : null}
                <button
                  className="btn-secondary"
                  onClick={() => void revealItemInDir(selectedAsset.absolutePath)}
                  type="button"
                >
                  <FolderOpen size={14} />
                  Klasorde goster
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => void openPath(selectedAsset.absolutePath)}
                  type="button"
                >
                  {selectedAsset.type === "image" ? <ImageIcon size={14} /> : <Video size={14} />}
                  Varsayilan uygulamada ac
                </button>
                {selectedAsset.type === "video" ? (
                  <button
                    className="btn-primary"
                    disabled={upscaling}
                    onClick={() => void handleUpscale()}
                    type="button"
                  >
                    {upscaling ? <LoaderCircle className="spin-slow" size={14} /> : <ArrowUpToLine size={14} />}
                    {upscaling ? "Kuyruga aliniyor..." : "4K upscale"}
                  </button>
                ) : null}
              </section>
            </>
          ) : (
            <EmptyPanel
              copy="Onizleme ve shot assignment aksiyonlari icin soldan bir asset sec."
              title="Asset sec"
            />
          )}
        </aside>
      </section>
    </section>
  );
}

function EmptyPanel({
  title,
  copy,
  loading = false,
}: {
  title: string;
  copy: string;
  loading?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 320,
        borderRadius: 24,
        border: "1px dashed var(--border-default)",
        background: "var(--bg-elevated)",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ display: "grid", gap: 12, justifyItems: "center", maxWidth: 340 }}>
        {loading ? <LoaderCircle className="spin-slow" size={28} /> : <Sparkles size={28} />}
        <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>{copy}</div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span style={{ color: "var(--text-secondary)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(245, 158, 11, 0.1)",
  border: "1px solid rgba(245, 158, 11, 0.24)",
  color: "var(--accent)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} as const;

const filterFieldStyle = {
  display: "grid",
  gap: 6,
  fontSize: 12,
  color: "var(--text-secondary)",
} as const;

const searchInputWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-secondary)",
} as const;

const searchInputStyle = {
  flex: 1,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--text-primary)",
  padding: "12px 0",
  fontSize: 13,
} as const;

const selectStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 13,
} as const;

const detailSectionStyle = {
  display: "grid",
  gap: 10,
  padding: 14,
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} as const;

const detailLabelStyle = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
} as const;

function assetTypeBadgeStyle(type: string) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 999,
    background: type === "image" ? "rgba(34, 197, 94, 0.12)" : "rgba(59, 130, 246, 0.12)",
    color: type === "image" ? "var(--status-success)" : "var(--status-info)",
    fontSize: 10,
    fontWeight: 700,
  } as const;
}

const mutedBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.05)",
  color: "var(--text-muted)",
  fontSize: 10,
  fontWeight: 700,
} as const;
