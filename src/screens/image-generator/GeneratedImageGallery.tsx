import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownUp,
  Check,
  Clapperboard,
  Copy,
  Download,
  Expand,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  List,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { MediaLightbox, type MediaLightboxItem } from "@/components/media/MediaLightbox";
import { MediaPaginationControls } from "@/components/media/MediaPaginationControls";
import { getAssetGroupName, normalizeAssetGroupName } from "@/lib/asset-tags";
import { downloadMediaFile } from "@/lib/media-download";
import {
  deleteAssetsBatch,
  getAssets,
  updateAssetGroups,
  type AssetWithTags,
} from "@/services/asset.service";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore, type Job } from "@/store/queue.store";
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

type GalleryViewMode = "grid" | "list";
type GallerySortBy = "date-desc" | "date-asc" | "model" | "size";

function inferImageMimeType(filePath: string): string {
  const normalized = filePath.trim().toLowerCase();
  if (normalized.endsWith(".png")) return "image/png";
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) return "image/jpeg";
  if (normalized.endsWith(".webp")) return "image/webp";
  if (normalized.endsWith(".gif")) return "image/gif";
  if (normalized.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

async function toPngClipboardBlob(asset: GalleryAsset): Promise<Blob> {
  const bytes = await readFile(asset.absolutePath);
  const sourceBlob = new Blob([bytes], { type: inferImageMimeType(asset.absolutePath) });
  const bitmap = await createImageBitmap(sourceBlob);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Gorsel panoya hazirlanamadi.");
    }

    context.drawImage(bitmap, 0, 0);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Gorsel PNG olarak olusturulamadi."));
      }, "image/png");
    });

    return pngBlob;
  } finally {
    bitmap.close();
  }
}

function resolveAssetAspectRatio(asset: GalleryAsset, listMode: boolean): number {
  if (listMode) return 1;
  if (typeof asset.width === "number" && typeof asset.height === "number" && asset.width > 0 && asset.height > 0) {
    return Math.min(1.85, Math.max(1, asset.width / asset.height));
  }
  return 16 / 10;
}

function formatAssetDimensions(asset: GalleryAsset): string {
  if (typeof asset.width === "number" && typeof asset.height === "number" && asset.width > 0 && asset.height > 0) {
    return `${asset.width} x ${asset.height}`;
  }
  return "Boyut okunmadi";
}

type GeneratedImageGalleryProps = {
  projectFolderPath: string;
  onUseAsReference: (absolutePath: string) => void;
  onReuseGeneration: (asset: GalleryAsset) => void;
  onEditAsset: (asset: GalleryAsset) => void;
};

export function GeneratedImageGallery({
  projectFolderPath,
  onUseAsReference,
  onReuseGeneration,
  onEditAsset,
}: GeneratedImageGalleryProps) {
  const activeProject = useProjectStore((state) => state.activeProject);
  const queueJobs = useQueueStore((state) => state.jobs);
  const setImageGeneratorState = useScreenStateStore(
    (state) => state.setImageGeneratorState,
  );
  const [assets, setAssets] = useState<GalleryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [groupDraft, setGroupDraft] = useState("");
  const [selectedGroupTarget, setSelectedGroupTarget] = useState<string>(UNGROUPED_GROUP_KEY);
  const [activeGroupKey, setActiveGroupKey] = useState<string>(ALL_GROUP_KEY);
  const [page, setPage] = useState(1);
  const [movingSelection, setMovingSelection] = useState(false);
  const [deletingSelection, setDeletingSelection] = useState(false);
  const [groupRefreshTick, setGroupRefreshTick] = useState(0);
  const [galleryViewMode, setGalleryViewMode] = useState<GalleryViewMode>("grid");
  const [gallerySortBy, setGallerySortBy] = useState<GallerySortBy>("date-desc");
  const [gallerySearchQuery, setGallerySearchQuery] = useState("");
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth,
  );
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
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
    setGalleryViewMode(nextState?.galleryViewMode ?? "grid");
    setGallerySortBy(nextState?.gallerySortBy ?? "date-desc");
    setGallerySearchQuery(nextState?.gallerySearchQuery ?? "");
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
    const scopedAssets =
      activeGroupKey === ALL_GROUP_KEY
        ? assets
        : assets.filter(
            (asset) => (getAssetGroupName(asset.tagsList) ?? UNGROUPED_GROUP_KEY) === activeGroupKey,
          );
    const searchNeedle = gallerySearchQuery.trim().toLocaleLowerCase("tr");
    const searchedAssets = !searchNeedle
      ? scopedAssets
      : scopedAssets.filter((asset) => {
          const filename = asset.filename.toLocaleLowerCase("tr");
          const prompt = (asset.prompt ?? "").toLocaleLowerCase("tr");
          const model = (asset.model_used ?? "").toLocaleLowerCase("tr");
          return (
            filename.includes(searchNeedle) ||
            prompt.includes(searchNeedle) ||
            model.includes(searchNeedle)
          );
        });

    return [...searchedAssets].sort((left, right) => {
      if (gallerySortBy === "date-asc") {
        return left.created_at - right.created_at;
      }

      if (gallerySortBy === "model") {
        return (left.model_used ?? "").localeCompare(right.model_used ?? "", "tr");
      }

      if (gallerySortBy === "size") {
        return (right.width ?? 0) * (right.height ?? 0) - (left.width ?? 0) * (left.height ?? 0);
      }

      return right.created_at - left.created_at;
    });
  }, [activeGroupKey, assets, gallerySearchQuery, gallerySortBy]);

  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const normalizedGroupDraft = normalizeAssetGroupName(groupDraft);
  const totalPages = Math.max(1, Math.ceil(activeGroupAssets.length / IMAGES_PER_PAGE));
  const pageStartIndex = (page - 1) * IMAGES_PER_PAGE;
  const pagedAssets = useMemo(
    () => activeGroupAssets.slice(pageStartIndex, pageStartIndex + IMAGES_PER_PAGE),
    [activeGroupAssets, pageStartIndex],
  );
  const lightboxItems = useMemo<MediaLightboxItem[]>(
    () =>
      pagedAssets.map((asset) => ({
        kind: "image",
        src: asset.assetUrl,
        title: asset.filename,
        subtitle: `${(asset.model_used ?? "bilinmiyor").split("/").pop()} / ${asset.width ?? "-"} x ${asset.height ?? "-"}`,
        description: asset.prompt ?? "Prompt kaydi yok.",
        downloadPath: asset.absolutePath,
        downloadName: asset.filename,
      })),
    [pagedAssets],
  );
  const rangeStart = pagedAssets.length > 0 ? pageStartIndex + 1 : 0;
  const rangeEnd = pageStartIndex + pagedAssets.length;
  const activeGroupLabel =
    galleryGroups.find((group) => group.key === activeGroupKey)?.label ?? "Tum kartlar";
  const gridColumns =
    viewportWidth >= 1600
      ? "repeat(auto-fill, minmax(260px, 1fr))"
      : viewportWidth >= 1200
        ? "repeat(auto-fill, minmax(220px, 1fr))"
        : "repeat(auto-fill, minmax(180px, 1fr))";

  useEffect(() => {
    if (restoringGalleryStateRef.current) {
      restoringGalleryStateRef.current = false;
      return;
    }

    setPage(1);
  }, [activeGroupKey, gallerySearchQuery, gallerySortBy, galleryViewMode]);

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
      galleryViewMode,
      gallerySortBy,
      gallerySearchQuery,
    });
  }, [
    activeGroupKey,
    activeProjectId,
    gallerySearchQuery,
    gallerySortBy,
    galleryViewMode,
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

  async function handleDeleteSelectedAssets() {
    if (selectedAssetIds.length === 0) {
      return;
    }

    const confirmed = await confirm(
      `${selectedAssetIds.length} secili gorsel kalici olarak silinecek. Bagli slotlar varsa temizlenecek. Devam edilsin mi?`,
      {
        title: "Secili gorselleri sil",
        kind: "warning",
        okLabel: "Sil",
        cancelLabel: "Vazgec",
      },
    );

    if (!confirmed) {
      return;
    }

    setDeletingSelection(true);

    try {
      const impact = await deleteAssetsBatch(
        selectedAssetIds.map((assetId) => ({ assetId })),
      );
      setSelectedAssetIds([]);
      setLightboxIndex(null);
      setGroupRefreshTick((value) => value + 1);

      const impactSummary =
        impact.slotCount > 0 ? ` ${impact.slotCount} slot baglantisi kaldirildi.` : "";
      const cleanupSummary = impact.fileDeletePending
        ? " Bazi dosyalar kilitli; fiziksel temizleme daha sonra tekrar denenecek."
        : "";

      await message(
        `${impact.deletedCount} gorsel silindi.${impactSummary}${cleanupSummary}`,
        {
          title: "Galeri",
          kind: "info",
        },
      );
    } catch (error) {
      console.error("Failed to delete selected image assets", error);
      await message(
        error instanceof Error ? error.message : "Secili gorseller silinemedi.",
        {
          title: "Galeri",
          kind: "error",
        },
      );
    } finally {
      setDeletingSelection(false);
    }
  }

  async function handleDownloadAsset(asset: GalleryAsset) {
    try {
      await downloadMediaFile({
        sourcePath: asset.absolutePath,
        suggestedName: asset.filename,
        dialogTitle: asset.filename,
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Gorsel indirilemedi.", {
        title: "Galeri",
        kind: "error",
      });
    }
  }

  async function handleCopyAsset(asset: GalleryAsset) {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("Bu ortam gorsel panoya kopyalamayi desteklemiyor.");
      }

      const pngBlob = await toPngClipboardBlob(asset);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      await message("Gorsel panoya kopyalandi.", {
        title: "Galeri",
        kind: "info",
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Gorsel panoya kopyalanamadi.", {
        title: "Galeri",
        kind: "error",
      });
    }
  }

  function handleSelectAllVisible() {
    setSelectedAssetIds(Array.from(new Set([...selectedAssetIds, ...pagedAssets.map((asset) => asset.id)])));
  }

  function handleInvertVisibleSelection() {
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      for (const asset of pagedAssets) {
        if (next.has(asset.id)) {
          next.delete(asset.id);
        } else {
          next.add(asset.id);
        }
      }
      return Array.from(next);
    });
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
          background: "linear-gradient(180deg, var(--surface-hover), transparent 22%), var(--bg-surface)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <header
          style={{
            display: "grid",
            gap: 16,
            padding: "18px 20px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  width: "fit-content",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--border-default)",
                  background: "var(--surface-hover)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                <Clapperboard size={13} />
                Uretilen kareler
              </span>
              <div style={{ fontSize: 22, fontWeight: 600 }}>Galeri</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {rangeStart}-{rangeEnd} / {activeGroupAssets.length} gorunuyor • {assets.length} toplam asset
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 220,
                  padding: "0 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-elevated)",
                }}
              >
                <Search size={14} style={{ color: "var(--text-muted)" }} />
                <input
                  aria-label="Galeride ara"
                  onChange={(event) => setGallerySearchQuery(event.target.value)}
                  placeholder="Prompt veya dosya adi ara..."
                  style={{
                    width: "100%",
                    height: 38,
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary)",
                    outline: "none",
                    fontSize: 12,
                  }}
                  value={gallerySearchQuery}
                />
              </label>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  minWidth: 176,
                  padding: "0 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-elevated)",
                }}
              >
                <ArrowDownUp size={14} style={{ color: "var(--text-muted)" }} />
                <select
                  aria-label="Galeri siralamasi"
                  onChange={(event) => setGallerySortBy(event.target.value as GallerySortBy)}
                  style={{
                    width: "100%",
                    height: 38,
                    border: "none",
                    background: "transparent",
                    color: "var(--text-primary)",
                    outline: "none",
                    fontSize: 12,
                  }}
                  value={gallerySortBy}
                >
                  <option value="date-desc">Tarih: yeni → eski</option>
                  <option value="date-asc">Tarih: eski → yeni</option>
                  <option value="model">Model adi</option>
                  <option value="size">Boyut</option>
                </select>
              </label>

              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: 4,
                  borderRadius: 14,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-elevated)",
                }}
              >
                <button
                  aria-label="Grid gorunumu"
                  onClick={() => setGalleryViewMode("grid")}
                  style={galleryViewMode === "grid" ? activeViewButtonStyle : viewButtonStyle}
                  type="button"
                >
                  <LayoutGrid size={14} />
                  Grid
                </button>
                <button
                  aria-label="Liste gorunumu"
                  onClick={() => setGalleryViewMode("list")}
                  style={galleryViewMode === "list" ? activeViewButtonStyle : viewButtonStyle}
                  type="button"
                >
                  <List size={14} />
                  Liste
                </button>
              </div>
            </div>
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
                      gridTemplateColumns: gridColumns,
                      gap: 14,
                    }}
                  >
                    {activeJobs.map((job) => (
                      <ImageSkeleton
                        key={job.id}
                        aspectRatio={resolveJobAspectRatio(job)}
                        progress={job.progress}
                      />
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
                        style={{
                          padding: "8px 12px",
                          fontSize: 11,
                          borderRadius: 999,
                          boxShadow:
                            activeGroupKey === group.key ? "var(--shadow-card)" : "none",
                        }}
                        type="button"
                      >
                        <FolderOpen size={13} />
                        {group.label}
                        <span
                          style={{
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "var(--surface-hover)",
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
                          Grid ve liste modlari ayni secim sistemini paylasir. Arama ve siralama
                          yalnizca bu grup icinde uygulanir.
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
                      <button
                        className="btn-secondary"
                        onClick={handleSelectAllVisible}
                        style={{ padding: "9px 12px", fontSize: 11 }}
                        type="button"
                      >
                        Tumunu sec
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={handleInvertVisibleSelection}
                        style={{ padding: "9px 12px", fontSize: 11 }}
                        type="button"
                      >
                        Ters secim
                      </button>
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
                      <motion.div
                        layout
                        role="grid"
                        aria-label="Uretilen gorseller"
                        style={{
                          display: "grid",
                          gridTemplateColumns: galleryViewMode === "grid" ? gridColumns : "1fr",
                          gap: 14,
                        }}
                      >
                        <AnimatePresence initial={false}>
                          {pagedAssets.map((asset) => (
                            <ImageCard
                              asset={asset}
                              groupName={getAssetGroupName(asset.tagsList)}
                              key={asset.id}
                              onOpen={() => setLightboxIndex(pagedAssets.findIndex((entry) => entry.id === asset.id))}
                              onDownload={() => void handleDownloadAsset(asset)}
                              onCopy={() => void handleCopyAsset(asset)}
                              onUseAsReference={() => onUseAsReference(asset.absolutePath)}
                              onReuseGeneration={() => onReuseGeneration(asset)}
                              onEdit={() => onEditAsset(asset)}
                              onToggleSelect={() => toggleSelectedAsset(asset.id)}
                              selected={selectedAssetIdSet.has(asset.id)}
                              viewMode={galleryViewMode}
                            />
                          ))}
                        </AnimatePresence>
                      </motion.div>

                      <MediaPaginationControls
                        onPageChange={setPage}
                        page={page}
                        summary={`${rangeStart}-${rangeEnd} arasi kartlar gosteriliyor / toplam ${activeGroupAssets.length}`}
                        totalPages={totalPages}
                      />

                      <AnimatePresence>
                        {selectedAssetIds.length > 0 ? (
                          <motion.div
                            animate={{ opacity: 1, y: 0 }}
                            className="floating-glass"
                            exit={{ opacity: 0, y: 48 }}
                            initial={{ opacity: 0, y: 48 }}
                            style={{
                              position: "sticky",
                              bottom: 0,
                              zIndex: 2,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              flexWrap: "wrap",
                              padding: 12,
                              borderRadius: 18,
                            }}
                            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  minWidth: 84,
                                  height: 32,
                                  padding: "0 12px",
                                  borderRadius: 999,
                                  background: "var(--accent)",
                                  color: "var(--on-accent)",
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {selectedAssetIds.length} secili
                              </span>
                              <button className="btn-secondary" onClick={() => setSelectedAssetIds([])} type="button">
                                Secimi temizle
                              </button>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <button
                                className="btn-secondary"
                                disabled={movingSelection}
                                onClick={() => void handleMoveSelectedAssets()}
                                type="button"
                              >
                                <FolderOpen size={14} />
                                Tasi
                              </button>
                              <button
                                className="btn-primary"
                                disabled={deletingSelection}
                                onClick={() => void handleDeleteSelectedAssets()}
                                type="button"
                              >
                                <Trash2 size={14} />
                                {deletingSelection ? "Siliniyor..." : "Sil"}
                              </button>
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </>
                  )}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </section>
      <MediaLightbox
        activeIndex={lightboxIndex ?? undefined}
        item={lightboxIndex === null ? null : (lightboxItems[lightboxIndex] ?? null)}
        items={lightboxItems}
        onClose={() => setLightboxIndex(null)}
        onNavigate={(nextIndex) => setLightboxIndex(nextIndex)}
      />
    </>
  );
}

function ImageSkeleton({ progress, aspectRatio }: { progress: number; aspectRatio: number }) {
  const progressValue = Math.round(progress);

  return (
    <div
      style={{
        display: "grid",
        gap: 0,
        borderRadius: 20,
        border: "1px solid var(--border-subtle)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--surface-hover) 92%, transparent), var(--bg-surface))",
        overflow: "hidden",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div
        style={{
          aspectRatio: String(aspectRatio),
          position: "relative",
          overflow: "hidden",
          background: "radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 12%, transparent), transparent 40%), linear-gradient(180deg, var(--bg-base), color-mix(in srgb, var(--bg-elevated) 88%, transparent))",
        }}
      >
        <div
          aria-hidden="true"
          className="shimmer-skeleton"
          style={{ position: "absolute", inset: 0, opacity: 0.72 }}
        />
        <div
          style={{
            position: "absolute",
            inset: 14,
            borderRadius: 18,
            border: "1px solid color-mix(in srgb, var(--border-default) 72%, transparent)",
            background: "color-mix(in srgb, var(--bg-base) 72%, transparent)",
            backdropFilter: "blur(10px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 22,
            display: "grid",
            gridTemplateRows: "auto 1fr auto",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 11px",
                borderRadius: 999,
                background: "color-mix(in srgb, var(--bg-base) 84%, transparent)",
                border: "1px solid var(--border-subtle)",
                color: "var(--text-secondary)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              <LoaderCircle className="spin-slow" size={14} style={{ color: "var(--accent)" }} />
              Uretiliyor
            </div>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              %{progressValue} tamam
            </span>
          </div>
          <div style={{ display: "grid", justifyItems: "center", alignContent: "center", gap: 12 }}>
            <div
              style={{
                width: 92,
                height: 92,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: `conic-gradient(var(--accent) 0deg ${Math.max(12, progressValue) * 3.6}deg, color-mix(in srgb, var(--surface-active) 86%, transparent) ${Math.max(12, progressValue) * 3.6}deg 360deg)`,
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div
                style={{
                  width: 74,
                  height: 74,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: "color-mix(in srgb, var(--bg-base) 94%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--border-default) 78%, transparent)",
                }}
              >
                <span
                  style={{
                    fontSize: 23,
                    fontWeight: 800,
                    color: "var(--text-primary)",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.03em",
                  }}
                >
                  %{progressValue}
                </span>
              </div>
            </div>
            <div style={{ display: "grid", justifyItems: "center", gap: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", textAlign: "center" }}>
                Sahne uretiliyor
              </div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", textAlign: "center", maxWidth: 200, lineHeight: 1.55 }}>
                Kompozisyon ve ayrintilar sahneye isleniyor.
              </div>
            </div>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: "color-mix(in srgb, var(--surface-active) 78%, transparent)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max(6, progressValue)}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 82%, white), var(--accent))",
                transition: "width var(--duration-slow) var(--ease-out)",
              }}
            />
          </div>
        </div>
      </div>
      <div
        style={{
          padding: "14px 15px 15px",
          display: "grid",
          gap: 8,
          background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--surface-hover) 85%, transparent))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Gorsel uretiliyor</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Son kareler toparlaniyor</span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            %{progressValue} tamam
          </span>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="shimmer-skeleton" style={{ width: "64%", height: 7, borderRadius: 999 }} />
          <div className="shimmer-skeleton" style={{ width: "42%", height: 7, borderRadius: 999, opacity: 0.7 }} />
        </div>
      </div>
    </div>
  );
}

const ImageCard = memo(function ImageCard({
  asset,
  groupName,
  onOpen,
  onDownload,
  onCopy,
  onUseAsReference,
  onReuseGeneration,
  onEdit,
  onToggleSelect,
  selected,
  viewMode,
}: {
  asset: GalleryAsset;
  groupName: string | null;
  onOpen: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onUseAsReference: () => void;
  onReuseGeneration: () => void;
  onEdit: () => void;
  onToggleSelect: () => void;
  selected: boolean;
  viewMode: GalleryViewMode;
}) {
  const [hovered, setHovered] = useState(false);
  const listMode = viewMode === "list";

  return (
    <motion.article
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      initial={{ opacity: 0, scale: 0.96 }}
      layout
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="gridcell"
      style={{
        display: "grid",
        gridTemplateColumns: listMode ? "140px minmax(0, 1fr)" : undefined,
        gap: 0,
        overflow: "hidden",
        minWidth: 0,
        borderRadius: 20,
        border: selected ? "1.5px solid var(--accent)" : "1px solid var(--border-default)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--surface-hover) 92%, transparent), var(--bg-surface))",
        boxShadow: selected
          ? "var(--shadow-card-selected)"
          : hovered
            ? "var(--shadow-card-hover)"
            : "var(--shadow-card)",
        transition: "box-shadow var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)",
      }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      whileHover={{ y: -3 }}
    >
      <div style={{ position: "relative", overflow: "hidden", background: "var(--bg-base)" }}>
        <button
          aria-label={`${asset.filename} onizlemesini ac`}
          onClick={onOpen}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            border: "none",
            padding: 0,
            background: "transparent",
            cursor: "pointer",
          }}
          type="button"
        >
          <LazyGalleryImage
            alt={asset.filename}
            src={asset.assetUrl}
            aspectRatio={resolveAssetAspectRatio(asset, listMode)}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: hovered
                ? "linear-gradient(180deg, transparent 14%, transparent 46%, var(--backdrop-bg) 100%)"
                : "linear-gradient(180deg, transparent 40%, var(--backdrop-bg) 100%)",
              pointerEvents: "none",
              transition: "background var(--duration-fast) var(--ease-out)",
            }}
          />
        </button>

        <button
          aria-label={selected ? "Kart secimini kaldir" : "Karti sec"}
          className={selected ? "btn-primary" : "btn-secondary"}
          onClick={onToggleSelect}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 30,
            height: 30,
            minWidth: 30,
            padding: 0,
            borderRadius: 999,
            background: selected ? "var(--accent)" : "var(--glass-bg)",
            borderColor: selected ? "var(--accent)" : "var(--glass-border)",
            color: selected ? "var(--on-accent)" : "var(--text-primary)",
            backdropFilter: "blur(12px)",
            opacity: selected || hovered ? 1 : 0,
            transition: "all var(--duration-fast) var(--ease-out)",
            fontSize: 11,
            fontWeight: 700,
          }}
          type="button"
        >
          <Check size={12} />
        </button>

        <button
          aria-label="Gorseli buyut"
          className="btn-secondary"
          onClick={onOpen}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            ...overlayIconButtonStyle,
            opacity: hovered ? 1 : 0,
            transition: "all var(--duration-fast) var(--ease-out)",
          }}
          title="Buyut"
          type="button"
        >
          <Expand size={12} />
        </button>

        <div style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          zIndex: 2,
          display: "inline-flex",
          gap: 6,
          justifyContent: "center",
          width: "fit-content",
          maxWidth: "calc(100% - 16px)",
          marginInline: "auto",
          padding: 5,
          borderRadius: 999,
          background: "color-mix(in srgb, var(--bg-elevated) 86%, transparent)",
          border: "1px solid var(--glass-border)",
          backdropFilter: "blur(12px)",
          boxShadow: "var(--shadow-card)",
          opacity: hovered ? 1 : 0,
          transform: hovered ? "translateY(0)" : "translateY(6px)",
          transition: "all var(--duration-normal) var(--ease-out)",
          flexWrap: "nowrap",
          pointerEvents: hovered ? "auto" : "none",
        }}>
          <button aria-label="Referans olarak kullan" onClick={(e) => { e.stopPropagation(); onUseAsReference(); }}
            style={hoverActionBtnStyle} title="Referans olarak kullan" type="button">
            <ImagePlus size={13} />
          </button>
          <button aria-label="Gorseli duzenle" onClick={(e) => { e.stopPropagation(); onEdit(); }}
            style={hoverActionBtnStyle} title="Gorseli duzenle" type="button">
            <Pencil size={13} />
          </button>
          <button aria-label="Gorseli indir" onClick={(e) => { e.stopPropagation(); onDownload(); }}
            style={hoverActionBtnStyle} title="Gorseli indir" type="button">
            <Download size={13} />
          </button>
          <button aria-label="Gorseli kopyala" onClick={(e) => { e.stopPropagation(); onCopy(); }}
            style={hoverActionBtnStyle} title="Gorseli kopyala" type="button">
            <Copy size={13} />
          </button>
          <button aria-label="Ayarlari geri yukle" onClick={(e) => { e.stopPropagation(); onReuseGeneration(); }}
            style={hoverActionBtnStyle} title="Ayarlari geri yukle" type="button">
            <RotateCcw size={13} />
          </button>
        </div>

      </div>

      <div
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        style={{
          display: "grid",
          gap: 10,
          minWidth: 0,
          alignContent: "start",
          padding: "14px 14px 15px",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
        role="button"
        tabIndex={0}
      >
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              minWidth: 0,
              fontSize: 13,
              fontWeight: 800,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            {asset.filename}
          </span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
            <span style={{
              fontSize: 10,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}>
              {new Date(asset.created_at).toLocaleString("tr-TR")}
            </span>
            <span style={{
              fontSize: 10,
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            }}>
              {formatAssetDimensions(asset)}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            maxWidth: "100%",
            fontSize: 10,
            color: "var(--text-secondary)",
            padding: "5px 8px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--surface-hover) 88%, transparent)",
            border: "1px solid var(--border-subtle)",
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {(asset.model_used ?? "bilinmiyor").split("/").pop()}
          </span>
          {groupName ? (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              maxWidth: "100%",
              fontSize: 10,
              color: "var(--text-muted)",
              padding: "5px 8px",
              borderRadius: 999,
              background: "color-mix(in srgb, var(--bg-base) 88%, transparent)",
              border: "1px solid var(--border-subtle)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              <FolderOpen size={10} />
              {groupName}
            </span>
          ) : null}
          <span style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            padding: "5px 8px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 20%, var(--border-subtle))",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}>
            Uretildi
          </span>
        </div>
        <p
          style={{
            margin: 0,
            minHeight: listMode ? 62 : 48,
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--text-muted)",
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: listMode ? 3 : 3,
          }}
        >
          {asset.prompt ?? "Prompt kaydi yok."}
        </p>
      </div>
    </motion.article>
  );
});

function LazyGalleryImage({
  src,
  alt,
  aspectRatio,
}: {
  src: string;
  alt: string;
  aspectRatio: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        aspectRatio: String(aspectRatio),
        minHeight: 180,
        position: "relative",
        overflow: "hidden",
        background: "var(--bg-elevated)",
      }}
    >
      {visible ? (
        <img
          alt={alt}
          decoding="async"
          loading="lazy"
          src={src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          className="shimmer-skeleton"
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 0,
          }}
        />
      )}
    </div>
  );
}

function resolveJobAspectRatio(job: Job): number {
  const ratio = typeof job.params?.aspectRatio === "string" ? job.params.aspectRatio : "16:9";
  switch (ratio) {
    case "1:1":
      return 1;
    case "9:16":
      return 9 / 16;
    case "4:3":
      return 4 / 3;
    case "3:2":
      return 3 / 2;
    default:
      return 16 / 10;
  }
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
} satisfies CSSProperties;
const overlayIconButtonStyle = {
  width: 34,
  minWidth: 34,
  height: 34,
  padding: 0,
  borderRadius: 999,
  background: "var(--glass-bg)",
  borderColor: "var(--border-default)",
  color: "var(--text-primary)",
  backdropFilter: "blur(10px)",
} satisfies CSSProperties;

const hoverActionBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  minWidth: 28,
  padding: 0,
  borderRadius: 999,
  border: "1px solid var(--glass-border)",
  background: "var(--glass-bg)",
  backdropFilter: "blur(12px)",
  color: "var(--text-primary)",
  cursor: "pointer",
  transition: "all var(--duration-instant) var(--ease-out)",
} satisfies CSSProperties;

const viewButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  borderRadius: 10,
  border: "none",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
} satisfies CSSProperties;

const activeViewButtonStyle = {
  ...viewButtonStyle,
  background: "var(--surface-hover)",
  color: "var(--text-primary)",
  boxShadow: "var(--shadow-card)",
} satisfies CSSProperties;
