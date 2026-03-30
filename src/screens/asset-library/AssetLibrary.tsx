import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { message, open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpToLine,
  ChevronDown,
  Download,
  Expand,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  Search,
  Sparkles,
  Video,
} from "lucide-react";
import { ProEmptyState } from "@/components/ui";
import {
  MediaLightbox,
  type MediaLightboxItem,
} from "@/components/media/MediaLightbox";
import { downloadMediaFile } from "@/lib/media-download";
import {
  assignAssetToShot,
  getAssets,
  importProjectAsset,
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

/* ------------------------------------------------------------------ */
/*  Grid stagger animation variants                                    */
/* ------------------------------------------------------------------ */

const gridContainerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04 },
  },
} as const;

const gridItemVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: "easeOut" },
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

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
  const [lightboxItem, setLightboxItem] = useState<MediaLightboxItem | null>(null);
  const [shotTargetId, setShotTargetId] = useState<string>("");
  const [assignmentTarget, setAssignmentTarget] = useState<AssignmentTarget>("start");
  const [upscaling, setUpscaling] = useState(false);
  const [importing, setImporting] = useState(false);
  const hasAnimatedRef = useRef(false);
  const activeProjectId = activeProject?.id ?? null;
  const refreshMarker = queueJobs
    .filter((job) => job.projectId === activeProjectId)
    .map((job) => `${job.id}:${job.status}:${job.resultPath ?? ""}`)
    .join("|");

  /* ---- effects ---- */

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
          setSelectedAssetId((current) =>
            current && resolvedAssets.some((asset) => asset.id === current)
              ? current
              : (resolvedAssets[0]?.id ?? null),
          );
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
  }, [activeProject, refreshMarker]);

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

  /* ---- handlers ---- */

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
        `${settings.defaultUpscaleFactor === 4 ? "4K" : "2x"} upscale kuyruga alindi.`,
        {
          title: "Asset Library",
          kind: "info",
        },
      );
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Upscale kuyruga alinamadi.",
        { title: "Asset Library", kind: "error" },
      );
    } finally {
      setUpscaling(false);
    }
  }

  async function handleImportAssets() {
    const selected = await open({
      multiple: true,
      directory: false,
      title: "Asset Library icin medya dosyalari sec",
      filters: [
        {
          name: "Media",
          extensions: [
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
            "bmp",
            "avif",
            "mp4",
            "mov",
            "webm",
            "m4v",
            "avi",
            "mkv",
          ],
        },
      ],
    });

    const selectedPaths = Array.isArray(selected)
      ? selected
      : selected
        ? [selected]
        : [];

    if (selectedPaths.length === 0) {
      return;
    }

    setImporting(true);

    try {
      const importedAssets = [];

      for (const selectedPath of selectedPaths) {
        importedAssets.push(await importProjectAsset({ sourcePath: selectedPath }));
      }

      if (importedAssets[0]) {
        setSelectedAssetId(importedAssets[0].assetId);
      }

      await message(`${importedAssets.length} asset kutuphaneye eklendi.`, {
        title: "Asset Library",
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Asset ice aktarilamadi.",
        { title: "Asset Library", kind: "error" },
      );
    } finally {
      setImporting(false);
    }
  }

  function openAssetPreview(asset: LibraryAsset) {
    setLightboxItem({
      kind: asset.type === "image" ? "image" : "video",
      src: asset.assetUrl,
      title: asset.filename,
      subtitle: `${asset.type.toUpperCase()} / ${(asset.model_used ?? "unknown").split("/").pop()}`,
      description: asset.prompt ?? "Prompt kaydi yok.",
      downloadPath: asset.absolutePath,
      downloadName: asset.filename,
    });
  }

  async function handleDownloadAsset(asset: LibraryAsset) {
    try {
      await downloadMediaFile({
        sourcePath: asset.absolutePath,
        suggestedName: asset.filename,
        dialogTitle: asset.filename,
      });
    } catch (error) {
      await message(error instanceof Error ? error.message : "Asset indirilemedi.", {
        title: "Asset Library",
        kind: "error",
      });
    }
  }

  /* ---- render: no project ---- */

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <ProEmptyState
          icon={ImageIcon}
          title="Varlik Kutuphanesi hazir"
          description="Asset arsivi proje baglaminda calisir. Devam etmek icin once bir proje ac."
        />
      </section>
    );
  }

  /* ---- handoff mode check ---- */
  const isHandoffMode = Boolean(shotTargetId);

  /* ---- render: main layout ---- */

  return (
    <>
      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="screen-shell"
        initial={{ opacity: 0, y: 14 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
      {/* Handoff mode banner */}
      <AnimatePresence>
        {isHandoffMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: "hidden" }}
          >
            <div style={handoffBannerStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link2 size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <span>
                  <strong>Atama Modu</strong> -- Secilen asset{" "}
                  <strong style={{ color: "var(--accent)" }}>
                    {shots.find((shot) => shot.id === shotTargetId)?.shotNumber ?? "secili shot"}
                  </strong>{" "}
                  icindeki{" "}
                  <strong style={{ color: "var(--accent)" }}>
                    {assignmentTarget.toUpperCase()}
                  </strong>{" "}
                  slotuna baglanacak.
                </span>
              </div>
              <button
                className="btn-secondary"
                onClick={() => setShotTargetId("")}
                style={{ padding: "6px 12px", fontSize: 11, flexShrink: 0 }}
                type="button"
              >
                Modu kapat
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section style={mainLayoutStyle}>
        {/* =========== LEFT COLUMN: Header + Grid =========== */}
        <section style={{ display: "grid", gap: 18, minWidth: 0, alignContent: "start" }}>
          {/* Header with filter bar */}
          <header style={headerStyle}>
            <div style={{ display: "grid", gap: 8 }}>
              <span style={eyebrowStyle}>
                <Sparkles size={13} />
                Varlik Kasasi
              </span>
              <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
                Varlik Kutuphanesi
              </div>
              <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7, maxWidth: 560 }}>
                Uretilen ve ice aktarilan medya dosyalarini tek yerde ara, onizle,
                shot'lara bagla ve 4K islemlerini tetikle.
              </p>
            </div>

            {/* Filter bar */}
            <div style={filterBarStyle}>
              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>Ara</span>
                <div style={searchInputWrapStyle}>
                  <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <input
                    className="studio-field"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Dosya adi, prompt, tag..."
                    style={searchInputStyle}
                    value={search}
                  />
                </div>
              </label>

              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>Tip</span>
                <select
                  className="studio-field"
                  onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
                  style={selectStyle}
                  value={typeFilter}
                >
                  <option value="all">Tum tipler</option>
                  <option value="image">Gorsel</option>
                  <option value="video">Video</option>
                </select>
              </label>

              <label style={filterFieldStyle}>
                <span style={filterLabelStyle}>Model</span>
                <select
                  className="studio-field"
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

            {/* Asset count */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {filteredAssets.length} / {assets.length} asset
              </div>
              <button
                className="btn-secondary"
                disabled={importing}
                onClick={() => void handleImportAssets()}
                type="button"
              >
                <ArrowUpToLine size={14} />
                {importing ? "Ice aktariliyor..." : "Dosya ice aktar"}
              </button>
            </div>
          </header>

          {/* Grid area */}
          <section style={gridContainerStyle}>
            {loading ? (
              <ProEmptyState
                icon={LoaderCircle}
                title="Yukleniyor"
                description="Asset kayitlari yukleniyor..."
              />
            ) : filteredAssets.length === 0 ? (
              <ProEmptyState
                icon={ImageIcon}
                title="Asset bulunamadi"
                description="Su anki filtrelere uyan asset bulunamadi. Generator ekranlari, storyboard import veya 'Dosya ice aktar' aksiyonu ile kutuphaneyi doldur."
              />
            ) : (
              <motion.div
                style={gridStyle}
                variants={hasAnimatedRef.current ? undefined : gridContainerVariants}
                initial={hasAnimatedRef.current ? "visible" : "hidden"}
                animate="visible"
                onAnimationComplete={() => { hasAnimatedRef.current = true; }}
                key={`${typeFilter}-${modelFilter}-${search}`}
              >
                {filteredAssets.map((asset) => {
                  const isSelected = selectedAssetId === asset.id;
                  return (
                    <motion.div
                      key={asset.id}
                      variants={hasAnimatedRef.current ? undefined : gridItemVariants}
                      whileHover={{ y: -3, scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => setSelectedAssetId(asset.id)}
                      onDoubleClick={() => openAssetPreview(asset)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedAssetId(asset.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      style={{
                        ...cardStyle,
                        border: isSelected
                          ? "1.5px solid var(--accent)"
                          : "1px solid var(--border-default)",
                        boxShadow: isSelected
                          ? "var(--shadow-lg)"
                          : "0 1px 3px var(--surface-hover)",
                      }}
                    >
                      {/* Media with gradient overlay */}
                      <div style={cardMediaWrapStyle}>
                        {asset.type === "image" ? (
                          <img
                            alt={asset.filename}
                            loading="lazy"
                            src={asset.assetUrl}
                            style={cardMediaStyle}
                          />
                        ) : (
                          <video
                            muted
                            playsInline
                            preload="none"
                            src={asset.assetUrl}
                            style={cardMediaStyle}
                          />
                        )}
                        {/* Bottom gradient */}
                        <div style={cardMediaGradientStyle} />
                        {/* Badges positioned over media */}
                        <div style={cardBadgeRowStyle}>
                          <span style={assetTypeBadgeStyle(asset.type)}>
                            {asset.type === "image" ? <ImageIcon size={10} /> : <Video size={10} />}
                            {asset.type.toUpperCase()}
                          </span>
                          {asset.resolution ? (
                            <span style={mutedBadgeStyle}>{asset.resolution}</span>
                          ) : null}
                        </div>
                        <button
                          className="btn-secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            openAssetPreview(asset);
                          }}
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: "var(--glass-bg)",
                            borderColor: "var(--border-default)",
                            color: "var(--text-primary)",
                            backdropFilter: "blur(10px)",
                          }}
                          type="button"
                        >
                          <Expand size={12} />
                          Buyut
                        </button>
                        {/* Selection indicator */}
                        {isSelected && <div style={cardSelectionRingStyle} />}
                      </div>

                      {/* Card info */}
                      <div style={cardInfoStyle}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {asset.filename}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {asset.model_used ?? "bilinmeyen model"}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </section>
        </section>

        {/* =========== RIGHT COLUMN: Detail Sidebar =========== */}
        <aside style={sidebarStyle}>
          <AnimatePresence mode="wait">
            {selectedAsset ? (
              <motion.div
                key={selectedAsset.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                style={{ display: "grid", gap: 14, alignContent: "start" }}
              >
                {/* Asset title + prompt excerpt */}
                <div style={{ display: "grid", gap: 8, padding: "0 2px" }}>
                  <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>
                    {selectedAsset.filename}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.7,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {selectedAsset.prompt?.slice(0, 180) ?? "Prompt kaydi yok."}
                  </div>
                </div>

                {/* Preview media */}
                <div style={{ ...previewMediaWrapStyle, position: "relative" }}>
                  {selectedAsset.type === "image" ? (
                    <img
                      alt={selectedAsset.filename}
                      src={selectedAsset.assetUrl}
                      style={previewMediaStyle}
                    />
                  ) : (
                    <video
                      controls
                      src={selectedAsset.assetUrl}
                      style={{ ...previewMediaStyle, background: "#000" }}
                    />
                  )}
                  <button
                    className="btn-secondary"
                    onClick={() => openAssetPreview(selectedAsset)}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      padding: "7px 10px",
                      borderRadius: 999,
                      background: "var(--glass-bg)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                      backdropFilter: "blur(10px)",
                    }}
                    type="button"
                  >
                    <Expand size={13} />
                    Buyut
                  </button>
                </div>

                {/* Collapsible: Metadata */}
                <SidebarSection title="Metadata" defaultOpen>
                  <DetailRow label="Tip" value={selectedAsset.type} />
                  <DetailRow label="Model" value={selectedAsset.model_used ?? "unknown"} />
                  <DetailRow label="Bagli shot" value={selectedAsset.shot_id ?? "-"} />
                  <DetailRow label="Hedef slot" value={assignmentTarget.toUpperCase()} />
                  <DetailRow
                    label="Olusma"
                    value={new Date(selectedAsset.created_at).toLocaleString("tr-TR")}
                  />
                  {selectedAsset.tagsList.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 4 }}>
                      {selectedAsset.tagsList.map((tag) => (
                        <span key={tag} style={tagChipStyle}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </SidebarSection>

                {/* Collapsible: Shot Assignment */}
                <SidebarSection title="Shot Atama" defaultOpen>
                  <label style={sidebarFieldLabelStyle}>
                    <span style={sidebarFieldLabelTextStyle}>Shot</span>
                    <select
                      className="studio-field"
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
                  </label>

                  <label style={sidebarFieldLabelStyle}>
                    <span style={sidebarFieldLabelTextStyle}>Slot</span>
                    <select
                      className="studio-field"
                      onChange={(event) =>
                        setAssignmentTarget(event.target.value as AssignmentTarget)
                      }
                      style={selectStyle}
                      value={assignmentTarget}
                    >
                      {selectedAsset.type === "image" ? (
                        <>
                          <option value="start">Baslangic karesi</option>
                          <option value="end">Bitis karesi</option>
                          <option value="reference">Harici referans</option>
                        </>
                      ) : (
                        <option value="video">Video slotu</option>
                      )}
                    </select>
                  </label>

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
                </SidebarSection>

                {/* Collapsible: Quick Actions */}
                <SidebarSection title="Hizli Islemler" defaultOpen>
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
                    onClick={() => void handleDownloadAsset(selectedAsset)}
                    type="button"
                  >
                    <Download size={14} />
                    Indir
                  </button>

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
                    {selectedAsset.type === "image" ? (
                      <ImageIcon size={14} />
                    ) : (
                      <Video size={14} />
                    )}
                    Varsayilan uygulamada ac
                  </button>

                  {selectedAsset.type === "video" ? (
                    <button
                      className="btn-primary"
                      disabled={upscaling}
                      onClick={() => void handleUpscale()}
                      type="button"
                    >
                      {upscaling ? (
                        <LoaderCircle className="spin-slow" size={14} />
                      ) : (
                        <ArrowUpToLine size={14} />
                      )}
                      {upscaling ? "Kuyruga aliniyor..." : "4K upscale"}
                    </button>
                  ) : null}
                </SidebarSection>
              </motion.div>
            ) : (
              <motion.div
                key="empty-sidebar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ProEmptyState
                  icon={ImageIcon}
                  title="Asset sec"
                  description="Onizleme ve shot atama aksiyonlari icin soldan bir asset sec."
                />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </section>
      </motion.section>
      <MediaLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible sidebar section                                        */
/* ------------------------------------------------------------------ */

function SidebarSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section style={sectionWrapStyle}>
      <button
        onClick={() => setOpen(!open)}
        style={sectionHeaderBtnStyle}
        type="button"
      >
        <span style={sectionTitleStyle}>{title}</span>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.2 }}
          style={{ display: "inline-flex", color: "var(--text-muted)" }}
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ display: "grid", gap: 10, paddingTop: 12 }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  DetailRow                                                          */
/* ------------------------------------------------------------------ */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={detailRowStyle}>
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: "var(--text-secondary)",
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Style objects                                                      */
/* ------------------------------------------------------------------ */

const handoffBannerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  padding: "12px 18px",
  borderRadius: 16,
  border: "1px solid var(--border-default)",
  background: "linear-gradient(135deg, var(--surface-hover), rgba(0, 0, 0, 0.02))",
  color: "var(--text-secondary)",
  fontSize: 13,
  lineHeight: 1.5,
} satisfies React.CSSProperties;

const mainLayoutStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 360px",
  gap: 18,
  minHeight: "calc(100vh - var(--topbar-h) - 110px)",
} satisfies React.CSSProperties;

const headerStyle = {
  display: "grid",
  gap: 16,
  padding: 24,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(140deg, rgba(0, 0, 0, 0.02), transparent 32%), var(--bg-surface)",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  background: "var(--surface-hover)",
  border: "1px solid var(--border-default)",
  color: "var(--accent)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies React.CSSProperties;

const filterBarStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(220px, 1fr) repeat(2, 160px)",
  gap: 10,
} satisfies React.CSSProperties;

const filterFieldStyle = {
  display: "grid",
  gap: 6,
} satisfies React.CSSProperties;

const filterLabelStyle = {
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  paddingLeft: 2,
} satisfies React.CSSProperties;

const searchInputWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  transition: "border-color 0.15s, box-shadow 0.15s",
} satisfies React.CSSProperties;

const searchInputStyle = {
  flex: 1,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--text-primary)",
  padding: "11px 0",
  fontSize: 13,
} satisfies React.CSSProperties;

const selectStyle = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  outline: "none",
  fontSize: 13,
  transition: "border-color 0.15s, box-shadow 0.15s",
} satisfies React.CSSProperties;

const gridContainerStyle = {
  minWidth: 0,
  padding: 18,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
  gap: 14,
} satisfies React.CSSProperties;

const cardStyle = {
  display: "grid",
  gap: 0,
  overflow: "hidden",
  padding: 0,
  textAlign: "left",
  borderRadius: 18,
  background: "var(--bg-elevated)",
  cursor: "pointer",
  transition: "box-shadow 0.2s, border-color 0.2s",
} satisfies React.CSSProperties;

const cardMediaWrapStyle = {
  position: "relative",
  overflow: "hidden",
} satisfies React.CSSProperties;

const cardMediaStyle = {
  width: "100%",
  aspectRatio: "16 / 10",
  objectFit: "cover",
  display: "block",
} satisfies React.CSSProperties;

const cardMediaGradientStyle = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  height: 40,
  background: "linear-gradient(transparent, rgba(0,0,0,0.3))",
  pointerEvents: "none",
} satisfies React.CSSProperties;

const cardBadgeRowStyle = {
  position: "absolute",
  bottom: 8,
  left: 8,
  display: "flex",
  gap: 6,
} satisfies React.CSSProperties;

const cardSelectionRingStyle = {
  position: "absolute",
  inset: 0,
  borderRadius: 18,
  border: "2px solid rgba(0, 0, 0, 0.25)",
  pointerEvents: "none",
} satisfies React.CSSProperties;

const cardInfoStyle = {
  display: "grid",
  gap: 4,
  padding: "10px 12px 12px",
} satisfies React.CSSProperties;

const sidebarStyle = {
  display: "grid",
  alignContent: "start",
  gap: 0,
  padding: 18,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(180deg, rgba(0, 0, 0, 0.02), transparent 24%), var(--bg-surface)",
  overflowY: "auto",
  maxHeight: "calc(100vh - var(--topbar-h) - 110px)",
} satisfies React.CSSProperties;

const previewMediaWrapStyle = {
  borderRadius: 18,
  overflow: "hidden",
  border: "1px solid var(--border-subtle)",
} satisfies React.CSSProperties;

const previewMediaStyle = {
  width: "100%",
  display: "block",
  objectFit: "cover",
} satisfies React.CSSProperties;

const sectionWrapStyle = {
  display: "grid",
  gap: 0,
  padding: 14,
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const sectionHeaderBtnStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  color: "var(--text-primary)",
} satisfies React.CSSProperties;

const sectionTitleStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
} satisfies React.CSSProperties;

const sidebarFieldLabelStyle = {
  display: "grid",
  gap: 6,
} satisfies React.CSSProperties;

const sidebarFieldLabelTextStyle = {
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-muted)",
  letterSpacing: "0.04em",
  paddingLeft: 2,
} satisfies React.CSSProperties;


const detailRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 12,
} satisfies React.CSSProperties;

const tagChipStyle = {
  display: "inline-flex",
  padding: "3px 8px",
  borderRadius: 999,
  background: "var(--surface-active)",
  color: "var(--text-primary)",
  fontSize: 10,
  fontWeight: 600,
} satisfies React.CSSProperties;

function assetTypeBadgeStyle(type: string) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 8px",
    borderRadius: 999,
    background:
      type === "image"
        ? "rgba(34, 197, 94, 0.18)"
        : "rgba(59, 130, 246, 0.18)",
    color: type === "image" ? "var(--status-success)" : "var(--status-info)",
    fontSize: 10,
    fontWeight: 700,
    backdropFilter: "blur(8px)",
  } satisfies React.CSSProperties;
}

const mutedBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 8px",
  borderRadius: 999,
  background: "var(--surface-active)",
  color: "var(--text-secondary)",
  fontSize: 10,
  fontWeight: 700,
  backdropFilter: "blur(8px)",
} satisfies React.CSSProperties;
