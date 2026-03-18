import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { Archive, Clapperboard, Download, Minus, Plus, Scan, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ShotCard, type ShotCardPreviewTarget } from "@/components/shot-card";
import {
  executeImport,
  getShots,
  previewImport,
  type ImportPreview,
  type ShotRow,
} from "@/services/import.service";
import { BulkProductionModal } from "@/screens/storyboard/BulkProductionModal";
import { ImportPreviewModal } from "@/screens/storyboard/ImportPreviewModal";
import { ShotDetailPanel } from "@/screens/storyboard/ShotDetailPanel";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";

const BOARD_PADDING_X = 160;
const BOARD_MAIN_Y = 128;
const BOARD_COVERAGE_Y = 452;
const CLUSTER_WIDTH = 308;
const MAIN_CARD_WIDTH = 196;
const COVERAGE_GRID_GAP = 10;
const COVERAGE_CARD_WIDTH = 136;
const COVERAGE_GRID_WIDTH = COVERAGE_CARD_WIDTH * 2 + COVERAGE_GRID_GAP;
const BOARD_HEIGHT = 724;
const DEFAULT_ZOOM = 0.92;
const MIN_ZOOM = 0.68;
const MAX_ZOOM = 1.65;
const ZOOM_STEP = 0.12;

type PanState = {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

type DetailModalView = ShotCardPreviewTarget;
type StoryboardLocationState = {
  focusShotId?: string;
  previewTarget?: DetailModalView;
};

export function Storyboard() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const location = useLocation();
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const panStateRef = useRef<PanState | null>(null);
  const queueJobs = useQueueStore((state) => state.jobs);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<ImportPreview | null>(null);
  const [importFolder, setImportFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [detailModalView, setDetailModalView] = useState<DetailModalView>("start");
  const [showArchived, setShowArchived] = useState(false);
  const activeProjectId = activeProject?.id ?? null;
  const queueRefreshMarker = queueJobs
    .filter((job) => job.projectId === activeProjectId)
    .map((job) => `${job.id}:${job.status}:${job.resultPath ?? ""}`)
    .join("|");

  const loadShots = useCallback(async () => {
    if (!activeProject) {
      setShots([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const nextShots = await getShots(activeProject.id, { includeArchived: true });
      setShots(nextShots);
    } catch (error) {
      console.error("Failed to load storyboard shots", error);
      await message(
        error instanceof Error ? error.message : "Storyboard verisi yuklenemedi.",
        {
          title: "Storyboard",
          kind: "error",
        },
      );
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    void loadShots();
  }, [loadShots, queueRefreshMarker]);

  useEffect(() => {
    if (selectedShotId && !shots.some((shot) => shot.id === selectedShotId)) {
      setSelectedShotId(null);
    }
  }, [shots, selectedShotId]);

  useEffect(() => {
    const state = location.state as StoryboardLocationState | null;

    if (!state?.focusShotId) {
      return;
    }

    if (!shots.some((shot) => shot.id === state.focusShotId)) {
      return;
    }

    setDetailModalView(state.previewTarget ?? "start");
    setSelectedShotId(state.focusShotId);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate, shots]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  async function handleImportClick() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Film-Kit outputs klasorunu sec",
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setImportFolder(selected);
      const preview = await previewImport(selected);

      console.log("Import preview:", preview);

      if (preview.files.length === 0 || preview.parsedShotCount === 0) {
        window.alert(
          "Bu klasorde parse edilebilir SHOT*.md dosyasi bulunamadi.\nFilm-kit shots/outputs klasorunu sectiginden emin ol.",
        );
        return;
      }

      setImportPreviewData(preview);
      setShowImportModal(true);
    } catch (error) {
      console.error("Import hatasi:", error);
      window.alert(`Hata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleImportConfirm() {
    if (!importFolder) {
      return;
    }

    setImporting(true);

    try {
      await executeImport(importFolder);
      await loadShots();
      setShowImportModal(false);
      await message("Storyboard import tamamlandi.", {
        title: "Storyboard",
        kind: "info",
      });
    } catch (error) {
      console.error("Failed to import storyboard", error);
      await message(
        error instanceof Error ? error.message : "Storyboard importu tamamlanamadi.",
        {
          title: "Storyboard",
          kind: "error",
        },
      );
    } finally {
      setImporting(false);
    }
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <StoryboardEmptyState onImport={handleImportClick} />
      </section>
    );
  }

  const visibleShots = shots.filter((shot) => (showArchived ? true : !shot.isArchived));
  const archivedShotCount = shots.filter((shot) => shot.isArchived).length;
  const missingExternalReferenceCount = visibleShots.filter(
    (shot) => shot.requiresExternalReference && !shot.externalReferencePath,
  ).length;
  const mainShots = visibleShots.filter((shot) => !shot.parentShotId);
  const coverageMap = visibleShots
    .filter((shot) => Boolean(shot.parentShotId))
    .reduce<Record<string, ShotRow[]>>((accumulator, shot) => {
      const parentId = shot.parentShotId!;
      accumulator[parentId] ??= [];
      accumulator[parentId].push(shot);
      return accumulator;
    }, {});
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? null;
  const boardWidth = Math.max(1320, BOARD_PADDING_X * 2 + mainShots.length * CLUSTER_WIDTH);

  function openShotDetail(shotId: string, view: DetailModalView = "start") {
    setDetailModalView(view);
    setSelectedShotId(shotId);
  }

  const setZoomFromViewport = useCallback(
    (nextZoom: number) => {
      const viewport = viewportRef.current;
      const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
      const previousZoom = zoomRef.current;

      if (!viewport || Math.abs(clampedZoom - previousZoom) < 0.001) {
        setZoom(clampedZoom);
        return;
      }

      const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
      const centerY = viewport.scrollTop + viewport.clientHeight / 2;
      const ratio = clampedZoom / previousZoom;

      setZoom(clampedZoom);

      requestAnimationFrame(() => {
        viewport.scrollLeft = centerX * ratio - viewport.clientWidth / 2;
        viewport.scrollTop = centerY * ratio - viewport.clientHeight / 2;
      });
    },
    [setZoom],
  );

  const changeZoom = useCallback(
    (delta: number) => {
      setZoomFromViewport(zoomRef.current + delta);
    },
    [setZoomFromViewport],
  );

  const resetZoom = useCallback(() => {
    setZoomFromViewport(1);
  }, [setZoomFromViewport]);

  const fitCanvas = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const widthRatio = (viewport.clientWidth - 72) / boardWidth;
    const heightRatio = (viewport.clientHeight - 72) / BOARD_HEIGHT;
    const nextZoom = Math.min(1, widthRatio, heightRatio);

    setZoomFromViewport(nextZoom);

    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  }, [boardWidth, setZoomFromViewport]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || mainShots.length === 0) {
      return;
    }

    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }, [mainShots.length]);

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (selectedShotId) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(ZOOM_STEP);
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        changeZoom(-ZOOM_STEP);
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fitCanvas();
        return;
      }

      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        viewport.scrollBy({ left: -120, behavior: "smooth" });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        viewport.scrollBy({ left: 120, behavior: "smooth" });
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        viewport.scrollBy({ top: -120, behavior: "smooth" });
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        viewport.scrollBy({ top: 120, behavior: "smooth" });
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (selectedShotId) {
        return;
      }

      if (event.code === "Space") {
        setSpacePressed(false);
        setIsPanning(false);
        panStateRef.current = null;
      }
    }

    function handleWindowBlur() {
      setSpacePressed(false);
      setIsPanning(false);
      panStateRef.current = null;
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [changeZoom, fitCanvas, resetZoom, selectedShotId]);

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!spacePressed || event.button !== 0) {
      return;
    }

    const viewport = event.currentTarget;
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    setIsPanning(true);
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleViewportPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    const viewport = event.currentTarget;
    viewport.scrollLeft = panState.startScrollLeft - (event.clientX - panState.startX);
    viewport.scrollTop = panState.startScrollTop - (event.clientY - panState.startY);
  }

  function stopPanning(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event && panStateRef.current && panStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    panStateRef.current = null;
    setIsPanning(false);
  }

  function handleViewportWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  return (
    <section className="screen-shell">
      <header
        style={{
          display: "grid",
          gap: 18,
          padding: 24,
          borderRadius: 28,
          border: "1px solid var(--border-default)",
          background:
            "linear-gradient(140deg, rgba(245, 158, 11, 0.1), transparent 34%), var(--bg-surface)",
          boxShadow: "0 28px 80px rgba(0, 0, 0, 0.26)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span
              style={{
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
              }}
            >
              <Sparkles size={13} />
              Story Canvas
            </span>
            <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.04em" }}>
              Storyboard Flow
            </div>
            <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Timeline artik board mantiginda calisiyor: ana shot'lar ust lane'de, coverage
              katmanlari alt lane'de. Kart secimi artik detay modalini ve hizli medya preview
              aksiyonlarini acar.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={() => setShowArchived((current) => !current)} type="button">
              <Archive size={15} />
              {showArchived ? `Archived on (${archivedShotCount})` : `Archived off (${archivedShotCount})`}
            </button>
            <button className="btn-secondary" onClick={() => void handleImportClick()} type="button">
              <Download size={15} />
              Film-kit Import
            </button>
            <button
              className="btn-primary"
              disabled={mainShots.length === 0}
              onClick={() => setShowBulkModal(true)}
              type="button"
            >
              <Sparkles size={15} />
              Bulk Production
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <MetricCard label="Main Shot" value={mainShots.length} />
          <MetricCard
            label="Coverage"
            value={shots.filter((shot) => Boolean(shot.parentShotId)).length}
          />
          <MetricCard
            label="Chain Link"
            value={
              mainShots.filter((shot) => shot.chainStatus === "continue" && shot.prevShotId).length
            }
          />
          <MetricCard label="Missing Ref" value={missingExternalReferenceCount} />
        </div>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 18,
          height: "calc(100vh - var(--topbar-h) - 260px)",
          minHeight: 640,
        }}
      >
        <div
          style={{
            minWidth: 0,
            overflow: "hidden",
            borderRadius: 30,
            border: "1px solid var(--border-subtle)",
            background:
              "linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 12%), var(--bg-surface)",
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.22)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "18px 20px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Board canvas
              </span>
              <div style={{ fontSize: 22, fontWeight: 600 }}>Timeline</div>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-elevated)",
                  color: "var(--text-secondary)",
                  fontSize: 12,
                }}
              >
                <Clapperboard size={14} />
                Space + drag / +/- / 0 / F
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px",
                  borderRadius: 999,
                  border: "1px solid var(--border-subtle)",
                  background: "rgba(255, 255, 255, 0.03)",
                }}
              >
                <button className="icon-button" onClick={() => changeZoom(-ZOOM_STEP)} type="button">
                  <Minus size={14} />
                </button>
                <div
                  style={{
                    minWidth: 56,
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}
                >
                  {Math.round(zoom * 100)}%
                </div>
                <button className="icon-button" onClick={() => changeZoom(ZOOM_STEP)} type="button">
                  <Plus size={14} />
                </button>
                <button className="icon-button" onClick={fitCanvas} type="button">
                  <Scan size={14} />
                </button>
              </div>
            </div>
          </div>

          <div
            ref={viewportRef}
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={stopPanning}
            onPointerCancel={stopPanning}
            onWheel={handleViewportWheel}
            style={{
              minWidth: 0,
              minHeight: 0,
              overflow: "auto",
              padding: 18,
              cursor: isPanning ? "grabbing" : spacePressed ? "grab" : "default",
              userSelect: isPanning || spacePressed ? "none" : "auto",
              background:
                "linear-gradient(180deg, rgba(255, 255, 255, 0.012), transparent), radial-gradient(circle at top left, rgba(245, 158, 11, 0.05), transparent 26%)",
            }}
          >
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13, padding: 12 }}>
                Storyboard yukleniyor...
              </div>
            ) : mainShots.length === 0 ? (
              <StoryboardEmptyState onImport={handleImportClick} />
            ) : (
              <div
                style={{
                  position: "relative",
                  width: boardWidth * zoom,
                  minHeight: BOARD_HEIGHT * zoom,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: boardWidth,
                    minHeight: BOARD_HEIGHT,
                    borderRadius: 26,
                    border: "1px solid rgba(255, 255, 255, 0.04)",
                    background:
                      "linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(180deg, rgba(17,17,19,0.92), rgba(10,10,11,0.96))",
                    backgroundSize: "120px 120px, 120px 120px, auto",
                    overflow: "hidden",
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    pointerEvents: spacePressed ? "none" : "auto",
                  }}
                >
                  <BoardRuler boardWidth={boardWidth} />
                  <BoardLane
                    title="Main Frames"
                    subtitle="Primary continuity arc"
                    height={286}
                    top={BOARD_MAIN_Y - 52}
                  />
                  <BoardLane
                    title="Coverage Blocks"
                    subtitle="Auxiliary inserts and reactions"
                    height={214}
                    top={BOARD_COVERAGE_Y - 52}
                  />

                  {mainShots.map((shot, index) => {
                    const clusterLeft = BOARD_PADDING_X + index * CLUSTER_WIDTH;
                    const coverageShots = coverageMap[shot.id] ?? [];
                    const nextShot = mainShots[index + 1];
                    const isLinked =
                      nextShot?.chainStatus === "continue" && nextShot.prevShotId === shot.id;
                    const coverageColumns = coverageShots.length <= 1 ? 1 : 2;
                    const coverageWidth =
                      coverageColumns === 1 ? COVERAGE_CARD_WIDTH : COVERAGE_GRID_WIDTH;
                    const mainCardRight = clusterLeft + (CLUSTER_WIDTH + MAIN_CARD_WIDTH) / 2;
                    const nextCardLeft =
                      clusterLeft + CLUSTER_WIDTH + (CLUSTER_WIDTH - MAIN_CARD_WIDTH) / 2;

                    return (
                      <div key={shot.id}>
                        <div
                          style={{
                            position: "absolute",
                            left: clusterLeft,
                            top: BOARD_MAIN_Y,
                            width: CLUSTER_WIDTH,
                            display: "grid",
                            justifyItems: "center",
                          }}
                        >
                          <ShotCard
                            shot={shot}
                            selected={shot.id === selectedShotId}
                            archived={shot.isArchived}
                            onClick={() => openShotDetail(shot.id)}
                            onPreviewRequest={(view) => openShotDetail(shot.id, view)}
                            projectFolderPath={activeProject.folderPath}
                          />
                        </div>

                        {coverageShots.length > 0 ? (
                          <div
                            style={{
                              position: "absolute",
                              left: clusterLeft,
                              top: BOARD_COVERAGE_Y,
                              width: CLUSTER_WIDTH,
                              display: "grid",
                              justifyItems: "center",
                            }}
                          >
                            <div
                              style={{
                                width: coverageWidth,
                                display: "grid",
                                gridTemplateColumns:
                                  coverageColumns === 1
                                    ? "1fr"
                                    : "repeat(2, minmax(0, 1fr))",
                                gap: COVERAGE_GRID_GAP,
                                justifyItems: "center",
                              }}
                            >
                              {coverageShots.map((coverageShot) => (
                                <ShotCard
                                  key={coverageShot.id}
                                  shot={coverageShot}
                                  selected={coverageShot.id === selectedShotId}
                                  isCoverage
                                  archived={coverageShot.isArchived}
                                  onClick={() => openShotDetail(coverageShot.id)}
                                  onPreviewRequest={(view) => openShotDetail(coverageShot.id, view)}
                                  projectFolderPath={activeProject.folderPath}
                                />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              position: "absolute",
                              left: clusterLeft,
                              top: BOARD_COVERAGE_Y + 26,
                              width: CLUSTER_WIDTH,
                              display: "grid",
                              justifyItems: "center",
                            }}
                          >
                            <div
                              style={{
                                width: 170,
                                padding: "12px 14px",
                                borderRadius: 16,
                                border: "1px dashed rgba(255, 255, 255, 0.08)",
                                color: "var(--text-muted)",
                                fontSize: 11,
                                letterSpacing: "0.05em",
                                textTransform: "uppercase",
                                textAlign: "center",
                              }}
                            >
                              No coverage
                            </div>
                          </div>
                        )}

                        {index < mainShots.length - 1 ? (
                          <BoardConnector
                            fromX={mainCardRight}
                            isLinked={Boolean(isLinked)}
                            toX={nextCardLeft}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

      </section>

      {selectedShot ? (
        <ShotDetailPanel
          key={`${selectedShot.id}:${detailModalView}`}
          shot={selectedShot}
          initialView={detailModalView}
          projectFolderPath={activeProject.folderPath}
          onClose={() => setSelectedShotId(null)}
          onRefresh={loadShots}
        />
      ) : null}

      {showImportModal && importPreviewData ? (
        <ImportPreviewModal
          importing={importing}
          preview={importPreviewData}
          onClose={() => setShowImportModal(false)}
          onConfirm={() => void handleImportConfirm()}
        />
      ) : null}

      {showBulkModal ? (
        <BulkProductionModal
          shots={mainShots}
          onClose={() => setShowBulkModal(false)}
          onDone={() => void loadShots()}
        />
      ) : null}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: "14px 16px",
        borderRadius: 18,
        border: "1px solid var(--border-subtle)",
        background: "rgba(255, 255, 255, 0.03)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
      <strong style={{ fontSize: 24, letterSpacing: "-0.03em" }}>{value}</strong>
    </div>
  );
}

function BoardRuler({ boardWidth }: { boardWidth: number }) {
  const columns = Math.max(1, Math.floor((boardWidth - BOARD_PADDING_X * 2) / CLUSTER_WIDTH));

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: 54,
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent)",
      }}
    >
      {Array.from({ length: columns }).map((_, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: BOARD_PADDING_X + index * CLUSTER_WIDTH,
            top: 16,
            display: "grid",
            gap: 6,
            color: "var(--text-muted)",
          }}
        >
          <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Beat {index + 1}
          </span>
          <div
            style={{
              width: 48,
              height: 2,
              borderRadius: 999,
              background: "rgba(255, 255, 255, 0.12)",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function BoardLane({
  title,
  subtitle,
  height,
  top,
}: {
  title: string;
  subtitle: string;
  height: number;
  top: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: BOARD_PADDING_X - 20,
        right: 28,
        top,
        height,
        borderRadius: 28,
        border: "1px solid rgba(255, 255, 255, 0.03)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.006) 44%, transparent 100%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -(BOARD_PADDING_X - 36),
          top: 14,
          width: BOARD_PADDING_X - 54,
          display: "grid",
          gap: 3,
          zIndex: 1,
          padding: "12px 14px",
          borderRadius: 18,
          border: "1px solid rgba(255, 255, 255, 0.06)",
          background:
            "linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02))",
          boxShadow: "0 14px 34px rgba(0, 0, 0, 0.18)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {title}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{subtitle}</span>
      </div>
    </div>
  );
}

function BoardConnector({
  fromX,
  toX,
  isLinked,
}: {
  fromX: number;
  toX: number;
  isLinked: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: fromX,
        top: BOARD_MAIN_Y + 92,
        width: Math.max(20, toX - fromX - 20),
        height: 66,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 22,
          height: 2,
          borderRadius: 999,
          background: isLinked
            ? "linear-gradient(90deg, rgba(245, 158, 11, 0.2), rgba(245, 158, 11, 0.95))"
            : "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.18))",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 17,
          width: 12,
          height: 12,
          borderTop: `2px solid ${isLinked ? "var(--accent)" : "rgba(255,255,255,0.24)"}`,
          borderRight: `2px solid ${isLinked ? "var(--accent)" : "rgba(255,255,255,0.24)"}`,
          transform: "rotate(45deg)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: isLinked ? "var(--accent)" : "var(--text-muted)",
        }}
      >
        {isLinked ? "continue" : "cut"}
      </span>
    </div>
  );
}

function StoryboardEmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: 420,
        padding: 24,
      }}
    >
      <div
        style={{
          display: "grid",
          justifyItems: "center",
          gap: 14,
          maxWidth: 360,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            display: "grid",
            placeItems: "center",
            borderRadius: 999,
            background: "rgba(245, 158, 11, 0.08)",
            color: "var(--accent)",
          }}
        >
          <Download size={28} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>Storyboard bos</div>
        <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          Film-kit ile uretilen outputs klasorunu import ederek shot zincirini ve
          coverage katmanlarini olustur.
        </p>
        <button className="btn-primary" onClick={() => void onImport()} type="button">
          <Download size={15} />
          Film-kit Import
        </button>
      </div>
    </div>
  );
}
