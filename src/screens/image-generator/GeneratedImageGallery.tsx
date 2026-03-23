import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { message } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Clapperboard,
  Expand,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { MediaLightbox, type MediaLightboxItem } from "@/components/media/MediaLightbox";
import { MediaPaginationControls } from "@/components/media/MediaPaginationControls";
import { getAssetGroupName, normalizeAssetGroupName } from "@/lib/asset-tags";
import { getAssets, updateAssetGroups, type AssetWithTags } from "@/services/asset.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";
import { useScreenStateStore } from "@/store/screen-state.store";

const ALL_GROUP_KEY = "__all__";
const UNGROUPED_GROUP_KEY = "__ungrouped__";
const IMAGES_PER_PAGE = 18;

export type GalleryAsset = AssetWithTags & {
  absolutePath: string;
  assetUrl: string;
};

type GalleryGroup = {
  key: string;
  label: string;
  count: number;
};

type GeneratedImageGalleryProps = {
  projectFolderPath: string;
  onUseAsReference: (absolutePath: string) => void;
  onReuseGeneration: (asset: GalleryAsset) => void;
};

export function GeneratedImageGallery({
  projectFolderPath,
  onUseAsReference,
  onReuseGeneration,
}: GeneratedImageGalleryProps) {
  const activeProject = useProjectStore((state) => state.activeProject);
  const queueJobs = useQueueStore((state) => state.jobs);
  const setImageGeneratorState = useScreenStateStore(
    (state) => state.setImageGeneratorState,
  );
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [groupDraft, setGroupDraft] = useState("");
  const [selectedGroupTarget, setSelectedGroupTarget] = useState<string>(UNGROUPED_GROUP_KEY);
  const [activeGroupKey, setActiveGroupKey] = useState<string>(ALL_GROUP_KEY);
  const [page, setPage] = useState(1);
  const [movingSelection, setMovingSelection] = useState(false);
  const [groupRefreshTick, setGroupRefreshTick] = useState(0);
  const restoringGalleryStateRef = useRef(false);
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
    restoringGalleryStateRef.current = true;

    if (!activeProjectId) {
      setGroupDraft("");
      setSelectedGroupTarget(UNGROUPED_GROUP_KEY);
      setActiveGroupKey(ALL_GROUP_KEY);
      setPage(1);
      return;
    }

    const nextState =
      useScreenStateStore.getState().imageGeneratorByProject[activeProjectId] ?? null;
    setGroupDraft(nextState?.galleryGroupDraft ?? "");
    setSelectedGroupTarget(nextState?.gallerySelectedGroupTarget ?? UNGROUPED_GROUP_KEY);
    setActiveGroupKey(nextState?.galleryActiveGroupKey ?? ALL_GROUP_KEY);
    setPage(nextState?.galleryPage ?? 1);
  }, [activeProjectId]);

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
  }, [activeProject, groupRefreshTick, projectFolderPath, refreshMarker]);

  useEffect(() => {
    setSelectedAssetIds((current) =>
      current.filter((assetId) => assets.some((asset) => asset.id === assetId)),
    );
  }, [assets]);

  const galleryGroups = useMemo<GalleryGroup[]>(() => {
    const groupedCounts = new Map<string, number>();

    for (const asset of assets) {
      const key = getAssetGroupName(asset.tagsList) ?? UNGROUPED_GROUP_KEY;
      groupedCounts.set(key, (groupedCounts.get(key) ?? 0) + 1);
    }

    const namedGroups = Array.from(groupedCounts.entries())
      .filter(([key]) => key !== UNGROUPED_GROUP_KEY)
      .sort(([left], [right]) => left.localeCompare(right, "tr"))
      .map(([key, count]) => ({ key, label: key, count }));

    return [
      { key: ALL_GROUP_KEY, label: "Tum kartlar", count: assets.length },
      { key: UNGROUPED_GROUP_KEY, label: "Klasorsuz", count: groupedCounts.get(UNGROUPED_GROUP_KEY) ?? 0 },
      ...namedGroups,
    ];
  }, [assets]);

  const activeGroupAssets = useMemo(() => {
    if (activeGroupKey === ALL_GROUP_KEY) {
      return assets;
    }

    return assets.filter(
      (asset) => (getAssetGroupName(asset.tagsList) ?? UNGROUPED_GROUP_KEY) === activeGroupKey,
    );
  }, [activeGroupKey, assets]);

  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const normalizedGroupDraft = normalizeAssetGroupName(groupDraft);
  const totalPages = Math.max(1, Math.ceil(activeGroupAssets.length / IMAGES_PER_PAGE));
  const pageStartIndex = (page - 1) * IMAGES_PER_PAGE;
  const pagedAssets = activeGroupAssets.slice(pageStartIndex, pageStartIndex + IMAGES_PER_PAGE);
  const rangeStart = pagedAssets.length > 0 ? pageStartIndex + 1 : 0;
  const rangeEnd = pageStartIndex + pagedAssets.length;
  const activeGroupLabel =
    galleryGroups.find((group) => group.key === activeGroupKey)?.label ?? "Tum kartlar";

  useEffect(() => {
    if (restoringGalleryStateRef.current) {
      restoringGalleryStateRef.current = false;
      return;
    }

    setPage(1);
  }, [activeGroupKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (activeGroupKey === ALL_GROUP_KEY) {
      return;
    }

    if (!galleryGroups.some((group) => group.key === activeGroupKey)) {
      setActiveGroupKey(ALL_GROUP_KEY);
    }
  }, [activeGroupKey, galleryGroups]);

  useEffect(() => {
    if (
      selectedGroupTarget !== UNGROUPED_GROUP_KEY &&
      !galleryGroups.some((group) => group.key === selectedGroupTarget)
    ) {
      setSelectedGroupTarget(UNGROUPED_GROUP_KEY);
    }
  }, [galleryGroups, selectedGroupTarget]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setImageGeneratorState(activeProjectId, {
      galleryGroupDraft: groupDraft,
      gallerySelectedGroupTarget: selectedGroupTarget,
      galleryActiveGroupKey: activeGroupKey,
      galleryPage: page,
    });
  }, [
    activeGroupKey,
    activeProjectId,
    groupDraft,
    page,
    selectedGroupTarget,
    setImageGeneratorState,
  ]);

  function toggleSelectedAsset(assetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((entry) => entry !== assetId)
        : [...current, assetId],
    );
  }

  async function handleMoveSelectedAssets() {
    if (selectedAssetIds.length === 0) {
      return;
    }

    const targetGroupName =
      normalizedGroupDraft ??
      (selectedGroupTarget === UNGROUPED_GROUP_KEY ? null : selectedGroupTarget);

    setMovingSelection(true);

    try {
      await updateAssetGroups(selectedAssetIds, targetGroupName);
      setGroupDraft("");
      setSelectedAssetIds([]);
      setSelectedGroupTarget(targetGroupName ?? UNGROUPED_GROUP_KEY);
      setActiveGroupKey(targetGroupName ?? UNGROUPED_GROUP_KEY);
      setGroupRefreshTick((value) => value + 1);
    } catch (error) {
      console.error("Failed to regroup image assets", error);
      await message(
        error instanceof Error ? error.message : "Secilen kartlar klasore tasinamadi.",
        {
          title: "Galeri",
          kind: "error",
        },
      );
    } finally {
      setMovingSelection(false);
    }
  }

  return (
    <>
      <section
        style={{
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
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
                <section style={{ display: "grid", gap: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
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
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Kartlari buyut, sec ve klasorlerde grupla
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {galleryGroups.map((group) => (
                      <button
                        className={activeGroupKey === group.key ? "btn-primary" : "btn-secondary"}
                        key={group.key}
                        onClick={() => setActiveGroupKey(group.key)}
                        style={{ padding: "8px 12px", fontSize: 11 }}
                        type="button"
                      >
                        <FolderOpen size={13} />
                        {group.label}
                        <span
                          style={{
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(0, 0, 0, 0.22)",
                            fontSize: 10,
                          }}
                        >
                          {group.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: 12,
                      padding: 14,
                      borderRadius: 20,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {activeGroupLabel} / {rangeStart}-{rangeEnd} / {activeGroupAssets.length}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                          Yalnizca aktif klasorun aktif sayfasi render ediliyor. Bu nedenle
                          yuzlerce karede bile arayuz ayni anda tum kartlari acmiyor.
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {selectedAssetIds.length} kart secili
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        className="studio-field"
                        onChange={(event) => setGroupDraft(event.target.value)}
                        placeholder="Yeni klasor adi"
                        style={collectionInputStyle}
                        value={groupDraft}
                      />
                      <select
                        className="studio-field"
                        onChange={(event) => setSelectedGroupTarget(event.target.value)}
                        style={collectionInputStyle}
                        value={selectedGroupTarget}
                      >
                        <option value={UNGROUPED_GROUP_KEY}>Klasorsuz</option>
                        {galleryGroups
                          .filter(
                            (group) =>
                              group.key !== ALL_GROUP_KEY && group.key !== UNGROUPED_GROUP_KEY,
                          )
                          .map((group) => (
                            <option key={group.key} value={group.key}>
                              {group.label}
                            </option>
                          ))}
                      </select>
                      <button
                        className="btn-secondary"
                        disabled={selectedAssetIds.length === 0 || movingSelection}
                        onClick={() => void handleMoveSelectedAssets()}
                        style={{ padding: "9px 12px", fontSize: 11 }}
                        type="button"
                      >
                        <FolderOpen size={13} />
                        {movingSelection
                          ? "Tasiniyor..."
                          : normalizedGroupDraft
                            ? `"${normalizedGroupDraft}" klasorune tasi`
                            : selectedGroupTarget === UNGROUPED_GROUP_KEY
                              ? "Klasorden cikar"
                              : "Secilenleri tasi"}
                      </button>
                      {selectedAssetIds.length > 0 ? (
                        <button
                          className="btn-secondary"
                          onClick={() => setSelectedAssetIds([])}
                          style={{ padding: "9px 12px", fontSize: 11 }}
                          type="button"
                        >
                          Secimi temizle
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {activeGroupAssets.length === 0 ? (
                    <div
                      style={{
                        display: "grid",
                        placeItems: "center",
                        minHeight: 220,
                        borderRadius: 20,
                        border: "1px dashed var(--border-default)",
                        background: "var(--bg-elevated)",
                        color: "var(--text-secondary)",
                        textAlign: "center",
                        padding: 24,
                      }}
                    >
                      Bu klasorde henuz kart yok.
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                          gap: 14,
                        }}
                      >
                        {pagedAssets.map((asset) => (
                          <ImageCard
                            asset={asset}
                            groupName={getAssetGroupName(asset.tagsList)}
                            key={asset.id}
                            onOpen={() =>
                              setLightboxItem({
                                kind: "image",
                                src: asset.assetUrl,
                                title: asset.filename,
                                subtitle: `${(asset.model_used ?? "unknown").split("/").pop()} / ${asset.width ?? "-"} x ${asset.height ?? "-"}`,
                                description: asset.prompt ?? "Prompt kaydi yok.",
                              })
                            }
                            onUseAsReference={() => onUseAsReference(asset.absolutePath)}
                            onReuseGeneration={() => onReuseGeneration(asset)}
                            onToggleSelect={() => toggleSelectedAsset(asset.id)}
                            selected={selectedAssetIdSet.has(asset.id)}
                          />
                        ))}
                      </div>

                      <MediaPaginationControls
                        onPageChange={setPage}
                        page={page}
                        summary={`${rangeStart}-${rangeEnd} arasi kartlar gosteriliyor / toplam ${activeGroupAssets.length}`}
                        totalPages={totalPages}
                      />
                    </>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </section>
      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </>
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

function ImageCard({
  asset,
  groupName,
  onOpen,
  onUseAsReference,
  onReuseGeneration,
  onToggleSelect,
  selected,
}: {
  asset: GalleryAsset;
  groupName: string | null;
  onOpen: () => void;
  onUseAsReference: () => void;
  onReuseGeneration: () => void;
  onToggleSelect: () => void;
  selected: boolean;
}) {
  return (
    <article
      style={{
        display: "grid",
        gap: 0,
        overflow: "hidden",
        borderRadius: 18,
        border: selected ? "1px solid rgba(245, 158, 11, 0.35)" : "1px solid var(--border-subtle)",
        background: "var(--bg-elevated)",
        boxShadow: selected
          ? "0 0 0 1px rgba(245, 158, 11, 0.18), 0 24px 70px rgba(0, 0, 0, 0.22)"
          : "0 24px 70px rgba(0, 0, 0, 0.2)",
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          onClick={onOpen}
          style={{
            display: "block",
            width: "100%",
            border: "none",
            padding: 0,
            background: "transparent",
            cursor: "pointer",
          }}
          type="button"
        >
          <img
            alt={asset.filename}
            decoding="async"
            loading="lazy"
            src={asset.assetUrl}
            style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, transparent 36%, rgba(0, 0, 0, 0.62))",
              pointerEvents: "none",
            }}
          />
        </button>

        <button
          className={selected ? "btn-primary" : "btn-secondary"}
          onClick={onToggleSelect}
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            minWidth: 34,
            padding: "6px 10px",
            borderRadius: 999,
            background: selected ? "rgba(245, 158, 11, 0.92)" : "rgba(10, 10, 12, 0.72)",
            borderColor: selected ? "rgba(245, 158, 11, 0.96)" : "rgba(255, 255, 255, 0.12)",
            color: selected ? "#140c00" : "#f3f4f6",
            backdropFilter: "blur(10px)",
          }}
          type="button"
        >
          {selected ? <Check size={13} /> : "Sec"}
        </button>

        <button
          className="btn-secondary"
          onClick={onOpen}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(10, 10, 12, 0.72)",
            borderColor: "rgba(255, 255, 255, 0.12)",
            color: "#f3f4f6",
            backdropFilter: "blur(10px)",
          }}
          type="button"
        >
          <Expand size={12} />
        </button>

        <button
          aria-label="Referans olarak kullan"
          className="btn-secondary"
          onClick={onUseAsReference}
          style={{
            position: "absolute",
            top: 10,
            right: 52,
            width: 34,
            minWidth: 34,
            height: 34,
            padding: 0,
            borderRadius: 999,
            background: "rgba(10, 10, 12, 0.72)",
            borderColor: "rgba(255, 255, 255, 0.12)",
            color: "#f3f4f6",
            backdropFilter: "blur(10px)",
          }}
          title="Referans olarak kullan"
          type="button"
        >
          <ImagePlus size={13} />
        </button>

        <button
          aria-label="Tum ayarlari geri yukle"
          className="btn-secondary"
          onClick={onReuseGeneration}
          style={{
            position: "absolute",
            top: 10,
            right: 94,
            width: 34,
            minWidth: 34,
            height: 34,
            padding: 0,
            borderRadius: 999,
            background: "rgba(10, 10, 12, 0.72)",
            borderColor: "rgba(255, 255, 255, 0.12)",
            color: "#f3f4f6",
            backdropFilter: "blur(10px)",
          }}
          title="Tum ayarlari geri yukle"
          type="button"
        >
          <RotateCcw size={13} />
        </button>

        {groupName ? (
          <span
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              borderRadius: 999,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              background: "rgba(0, 0, 0, 0.58)",
              padding: "6px 10px",
              color: "#f3f4f6",
              fontSize: 11,
            }}
          >
            <FolderOpen size={12} />
            {groupName}
          </span>
        ) : null}
      </div>

      <button
        onClick={onOpen}
        style={{
          display: "grid",
          gap: 8,
          padding: 14,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
        type="button"
        >
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
          {(asset.model_used ?? "unknown").split("/").pop()} / {asset.width ?? "-"} x{" "}
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
      </button>

    </article>
  );
}

const collectionInputStyle = {
  minWidth: 180,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  fontSize: 12,
  outline: "none",
} satisfies React.CSSProperties;
