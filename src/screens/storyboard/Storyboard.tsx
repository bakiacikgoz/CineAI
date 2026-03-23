import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { open, message } from "@tauri-apps/plugin-dialog";
import { Archive, Download, Minus, Plus, Scan, Sparkles } from "lucide-react";
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
import { Portal } from "@/components/Portal";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";
import { useScreenStateStore } from "@/store/screen-state.store";

const TIMELINE_GROUP_WIDTH = 340;
const CONNECTOR_WIDTH = 72;
const BOARD_SIDE_PADDING = 28;
const COVERAGE_GRID_GAP = 12;
const DEFAULT_ZOOM = 0.88;
const MIN_ZOOM = 0.62;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.12;
const FIT_CANVAS_MARGIN = 24;

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
  const restoreViewportRef = useRef(true);
  const viewportPersistFrameRef = useRef<number | null>(null);
  const queueJobs = useQueueStore((state) => state.jobs);
  const setStoryboardState = useScreenStateStore((state) => state.setStoryboardState);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<ImportPreview | null>(null);
  const [importFolder, setImportFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [importing, setImporting] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [detailModalView, setDetailModalView] = useState<DetailModalView>("start");
  const [showArchived, setShowArchived] = useState(false);
  const activeProjectId = activeProject?.id ?? null;
  const savedStoryboardState = useScreenStateStore((state) =>
    activeProjectId ? state.storyboardByProject[activeProjectId] ?? null : null,
  );
  const queueRefreshMarker = queueJobs
    .filter((job) => job.projectId === activeProjectId)
    .map((job) => `${job.id}:${job.status}:${job.resultPath ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!activeProjectId) {
      setSelectedShotId(null);
      setDetailModalView("start");
      setShowArchived(false);
      setZoom(DEFAULT_ZOOM);
      zoomRef.current = DEFAULT_ZOOM;
      setHasLoadedOnce(false);
      setLoading(true);
      return;
    }

    const nextState = useScreenStateStore.getState().storyboardByProject[activeProjectId];
    setSelectedShotId(nextState?.selectedShotId ?? null);
    setDetailModalView(nextState?.detailModalView ?? "start");
    setShowArchived(nextState?.showArchived ?? false);
    const nextZoom = nextState?.zoom ?? DEFAULT_ZOOM;
    setZoom(nextZoom);
    zoomRef.current = nextZoom;
    restoreViewportRef.current = true;
    setHasLoadedOnce(false);
    setLoading(true);
  }, [activeProjectId]);

  const loadShots = useCallback(async () => {
    if (!activeProject) {
      setShots([]);
      setLoading(false);
      setHasLoadedOnce(false);
      return;
    }

    const showInitialLoader = !hasLoadedOnce;
    if (showInitialLoader) {
      setLoading(true);
    }

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
      if (showInitialLoader) {
        setLoading(false);
      }
      setHasLoadedOnce(true);
    }
  }, [activeProject, hasLoadedOnce]);

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

  const persistViewportState = useCallback(() => {
    if (!activeProjectId) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport && restoreViewportRef.current) {
      return;
    }

    setStoryboardState(activeProjectId, {
      zoom: zoomRef.current,
      scrollLeft: viewport?.scrollLeft ?? 0,
      scrollTop: viewport?.scrollTop ?? 0,
      showArchived,
      selectedShotId,
      detailModalView,
    });
  }, [activeProjectId, detailModalView, selectedShotId, setStoryboardState, showArchived]);

  const scheduleViewportPersist = useCallback(() => {
    if (viewportPersistFrameRef.current !== null) {
      cancelAnimationFrame(viewportPersistFrameRef.current);
    }

    viewportPersistFrameRef.current = requestAnimationFrame(() => {
      viewportPersistFrameRef.current = null;
      persistViewportState();
    });
  }, [persistViewportState]);

  useEffect(
    () => () => {
      if (viewportPersistFrameRef.current !== null) {
        cancelAnimationFrame(viewportPersistFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    persistViewportState();
  }, [persistViewportState, selectedShotId, detailModalView, showArchived, zoom]);

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

      if (preview.files.length === 0 || preview.parsedShotCount === 0) {
        await message(
          "Bu klasorde parse edilebilir SHOT*.md dosyasi bulunamadi.\nFilm-kit shots/outputs klasorunu sectiginden emin ol.",
          {
            title: "Storyboard",
            kind: "warning",
          },
        );
        return;
      }

      setImportPreviewData(preview);
      setShowImportModal(true);
    } catch (error) {
      console.error("Import hatasi:", error);
      await message(
        error instanceof Error ? error.message : String(error),
        {
          title: "Storyboard",
          kind: "error",
        },
      );
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
  const coverageCount = visibleShots.filter((shot) => Boolean(shot.parentShotId)).length;
  const linkedShotCount = mainShots.filter(
    (shot) => shot.chainStatus === "continue" && shot.prevShotId,
  ).length;
  const readyMainFrameCount = mainShots.filter(
    (shot) => Boolean(shot.imageStartPath || shot.imageEndPath),
  ).length;
  const coverageMap = visibleShots
    .filter((shot) => Boolean(shot.parentShotId))
    .reduce<Record<string, ShotRow[]>>((accumulator, shot) => {
      const parentId = shot.parentShotId!;
      accumulator[parentId] ??= [];
      accumulator[parentId].push(shot);
      return accumulator;
    }, {});
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? null;
  const maxCoverageRows = Math.max(
    1,
    ...mainShots.map((shot) => Math.max(1, Math.ceil((coverageMap[shot.id]?.length ?? 0) / 2))),
  );
  const boardWidth = Math.max(
    1320,
    BOARD_SIDE_PADDING * 2 +
      mainShots.length * TIMELINE_GROUP_WIDTH +
      Math.max(0, mainShots.length - 1) * CONNECTOR_WIDTH,
  );
  const boardHeight = 520 + maxCoverageRows * 170;

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
        scheduleViewportPersist();
      });
    },
    [scheduleViewportPersist, setZoom],
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

    const widthRatio = (viewport.clientWidth - FIT_CANVAS_MARGIN) / boardWidth;
    const heightRatio = (viewport.clientHeight - FIT_CANVAS_MARGIN) / boardHeight;
    const nextZoom = Math.min(1, widthRatio, heightRatio);

    setZoomFromViewport(nextZoom);

    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
      scheduleViewportPersist();
    });
  }, [boardHeight, boardWidth, scheduleViewportPersist, setZoomFromViewport]);

  useEffect(() => {
    if (
      !activeProjectId ||
      !savedStoryboardState ||
      !hasLoadedOnce ||
      mainShots.length === 0 ||
      !restoreViewportRef.current
    ) {
      return;
    }

    const nextZoom = savedStoryboardState.zoom || DEFAULT_ZOOM;
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    setZoom(nextZoom);
    zoomRef.current = nextZoom;

    requestAnimationFrame(() => {
      const nextViewport = viewportRef.current;
      if (!nextViewport) {
        return;
      }

      nextViewport.scrollLeft = savedStoryboardState.scrollLeft;
      nextViewport.scrollTop = savedStoryboardState.scrollTop;
      restoreViewportRef.current = false;
      scheduleViewportPersist();
    });
  }, [
    activeProjectId,
    hasLoadedOnce,
    mainShots.length,
    savedStoryboardState,
    scheduleViewportPersist,
  ]);

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
          position: "relative",
          display: "grid",
          gap: 22,
          overflow: "hidden",
          padding: 28,
          borderRadius: 32,
          border: "1px solid var(--border-default)",
          background:
            "radial-gradient(circle at top left, rgba(245, 158, 11, 0.14), transparent 28%), linear-gradient(135deg, rgba(24, 24, 28, 0.97), rgba(10, 10, 12, 0.98))",
          boxShadow: "0 30px 100px rgba(0, 0, 0, 0.34)",
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            <span>{activeProject.name}</span>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span>Storyboard</span>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span style={{ color: "var(--accent)" }}>Flow Timeline</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <HeroInfoPill label={showArchived ? "Archive visible" : "Archive filtered"} value={String(archivedShotCount)} />
            <HeroInfoPill
              accent
              label={selectedShot ? "Focus shot" : "Main ready"}
              value={selectedShot ? selectedShot.shotNumber : `${readyMainFrameCount}/${mainShots.length}`}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 22,
            alignItems: "stretch",
          }}
        >
          <div style={{ display: "grid", alignContent: "start", gap: 10 }}>
            <span
              style={{
                display: "inline-flex",
                width: "fit-content",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                borderRadius: 999,
                border: "1px solid rgba(245, 158, 11, 0.24)",
                background: "rgba(245, 158, 11, 0.08)",
                color: "var(--accent)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
              }}
            >
              <Sparkles size={13} />
              Story Canvas
            </span>
            <div style={{ fontSize: "clamp(34px, 5vw, 54px)", fontWeight: 700, letterSpacing: "-0.06em", lineHeight: 0.96 }}>
              Storyboard Flow
            </div>
            <p
              style={{
                margin: 0,
                maxWidth: 760,
                color: "var(--text-secondary)",
                fontSize: 14,
                lineHeight: 1.8,
              }}
            >
              Ana shot kolonlari ust lane&apos;de, coverage bloklari alt lane&apos;de akiyor.
              Detail modal, media preview ve bulk production akislari korunuyor; sadece
              board hiyerarsisi daha sinematik bir ritimle yeniden kuruldu.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              alignContent: "space-between",
              gap: 18,
              padding: 20,
              borderRadius: 24,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              background:
                "linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015))",
            }}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Production Controls
              </span>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.03em" }}>
                Import, archive ve toplu uretim ayni board yuzeyinde.
              </div>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.7 }}>
                Bu panel storyboard akisini daha net okuturken mevcut islevleri aynen
                korur. Shot secimi yine detail modalini acar.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <SurfaceActionButton onClick={() => setShowArchived((current) => !current)} type="secondary">
                <Archive size={15} />
                {showArchived ? `Archived on (${archivedShotCount})` : `Archived off (${archivedShotCount})`}
              </SurfaceActionButton>
              <SurfaceActionButton onClick={() => void handleImportClick()} type="secondary">
                <Download size={15} />
                Film-kit Import
              </SurfaceActionButton>
              <SurfaceActionButton
                disabled={mainShots.length === 0}
                onClick={() => setShowBulkModal(true)}
                type="primary"
              >
                <Sparkles size={15} />
                Bulk Production
              </SurfaceActionButton>
            </div>
          </div>
        </div>
      </header>

      <section style={{ display: "grid", gap: 18 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 14,
          }}
        >
          <MetricCard
            caption="Master continuity beats"
            label="Main Shot"
            tone="accent"
            value={mainShots.length}
          />
          <MetricCard
            caption="Auxiliary inserts and reactions"
            label="Coverage"
            tone="info"
            value={coverageCount}
          />
          <MetricCard
            caption="Shots with explicit continue handoff"
            emphasized
            label="Chain Link"
            tone="accent"
            value={linkedShotCount}
          />
          <MetricCard
            caption={
              missingExternalReferenceCount === 0
                ? "Reference gaps closed"
                : "Needs external handoff"
            }
            label="Missing Ref"
            tone={missingExternalReferenceCount === 0 ? "success" : "danger"}
            value={missingExternalReferenceCount}
          />
        </div>

        <div
          style={{
            minWidth: 0,
            display: "grid",
            gap: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
              paddingInline: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <BoardMetaPill>Space + drag / +/- / 0 / F</BoardMetaPill>
              <BoardMetaPill accent>
                {selectedShot ? `Focused / ${selectedShot.shotNumber}` : `Ready / ${readyMainFrameCount} main`}
              </BoardMetaPill>
              <BoardMetaPill>
                {selectedShot
                  ? `${selectedShot.parentShotId ? "Coverage" : "Main"} / ${selectedShot.shotNumber}`
                  : `${mainShots.length} main / ${coverageCount} coverage`}
              </BoardMetaPill>
              <BoardMetaPill>{showArchived ? "Archive visible" : "Archive hidden"}</BoardMetaPill>
            </div>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-secondary)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "var(--accent)",
                    boxShadow: "0 0 16px rgba(245, 158, 11, 0.7)",
                  }}
                />
                Auto-saving storyboard changes
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px",
                  borderRadius: 999,
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  background: "rgba(255, 255, 255, 0.03)",
                }}
              >
                <ZoomControlButton label="Zoom out" onClick={() => changeZoom(-ZOOM_STEP)}>
                  <Minus size={14} />
                </ZoomControlButton>
                <div
                  style={{
                    minWidth: 62,
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    color: "var(--text-secondary)",
                  }}
                >
                  {Math.round(zoom * 100)}%
                </div>
                <ZoomControlButton label="Zoom in" onClick={() => changeZoom(ZOOM_STEP)}>
                  <Plus size={14} />
                </ZoomControlButton>
                <ZoomControlButton label="Fit canvas" onClick={fitCanvas}>
                  <Scan size={14} />
                </ZoomControlButton>
              </div>
            </div>
          </div>

          <div
            ref={viewportRef}
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={stopPanning}
            onPointerCancel={stopPanning}
            onScroll={scheduleViewportPersist}
            onWheel={handleViewportWheel}
            style={{
              minWidth: 0,
              minHeight: "calc(100vh - var(--topbar-h) - 320px)",
              overflow: "auto",
              padding: "4px 0 16px",
              cursor: isPanning ? "grabbing" : spacePressed ? "grab" : "default",
              userSelect: isPanning || spacePressed ? "none" : "auto",
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
                  width: boardWidth * zoom,
                  minHeight: boardHeight * zoom,
                }}
              >
                <div
                  style={{
                    width: boardWidth,
                    minHeight: boardHeight,
                    borderRadius: 30,
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    background:
                      "linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(180deg, rgba(17,17,19,0.96), rgba(8,8,10,0.98))",
                    backgroundSize: "108px 108px, 108px 108px, auto",
                    overflow: "hidden",
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    pointerEvents: spacePressed ? "none" : "auto",
                    display: "grid",
                    gap: 28,
                    padding: `${BOARD_SIDE_PADDING}px`,
                  }}
                >
                  <div
                    style={{
                      height: 8,
                      margin: `-${BOARD_SIDE_PADDING}px -${BOARD_SIDE_PADDING}px 0`,
                      background:
                        "linear-gradient(90deg, rgba(245, 158, 11, 0.22), transparent 22%, transparent 78%, rgba(59, 130, 246, 0.14))",
                    }}
                  />

                  <TrackHeader
                    label="Main Shots"
                    tone="accent"
                    subtitle="Primary continuity arc"
                  />

                  <div style={{ display: "flex", alignItems: "flex-start", gap: 0, width: "max-content" }}>
                    {mainShots.map((shot, index) => {
                      const nextShot = mainShots[index + 1];
                      const isLinked =
                        nextShot?.chainStatus === "continue" && nextShot.prevShotId === shot.id;

                      return (
                        <div key={shot.id} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                          <div
                            style={{
                              width: TIMELINE_GROUP_WIDTH,
                              display: "grid",
                              alignContent: "start",
                              gap: 14,
                            }}
                          >
                            <SequenceBadge
                              index={index}
                              caption={`A${shot.act ?? "-"} / S${shot.scene ?? "-"}`}
                            />
                            <ShotCard
                              shot={shot}
                              selected={shot.id === selectedShotId}
                              archived={shot.isArchived}
                              onClick={() => openShotDetail(shot.id)}
                              onPreviewRequest={(view) => openShotDetail(shot.id, view)}
                              projectFolderPath={activeProject.folderPath}
                            />
                          </div>

                          {index < mainShots.length - 1 ? (
                            <InlineConnector isLinked={Boolean(isLinked)} />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <TrackHeader
                    label="Coverage & Inserts"
                    tone="muted"
                    subtitle="Auxiliary reactions, inserts and alternatives"
                  />

                  <div style={{ display: "flex", alignItems: "flex-start", gap: 0, width: "max-content" }}>
                    {mainShots.map((shot, index) => {
                      const coverageShots = coverageMap[shot.id] ?? [];

                      return (
                        <div key={`${shot.id}:coverage`} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                          <div
                            style={{
                              width: TIMELINE_GROUP_WIDTH,
                              display: "grid",
                              alignContent: "start",
                              gap: 12,
                            }}
                          >
                            {coverageShots.length > 0 ? (
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns:
                                    coverageShots.length === 1
                                      ? "minmax(0, 1fr)"
                                      : "repeat(2, minmax(0, 1fr))",
                                  gap: COVERAGE_GRID_GAP,
                                  alignItems: "start",
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
                            ) : (
                              <CoverageEmptyState />
                            )}
                          </div>

                          {index < mainShots.length - 1 ? (
                            <div
                              aria-hidden="true"
                              style={{
                                width: CONNECTOR_WIDTH,
                                flex: "0 0 auto",
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedShot ? (
        <Portal>
          <ShotDetailPanel
            key={`${selectedShot.id}:${detailModalView}`}
            shot={selectedShot}
            initialView={detailModalView}
            projectFolderPath={activeProject.folderPath}
            onClose={() => setSelectedShotId(null)}
            onRefresh={loadShots}
          />
        </Portal>
      ) : null}

      {showImportModal && importPreviewData ? (
        <Portal>
          <ImportPreviewModal
            importing={importing}
            preview={importPreviewData}
            onClose={() => setShowImportModal(false)}
            onConfirm={() => void handleImportConfirm()}
          />
        </Portal>
      ) : null}

      {showBulkModal ? (
        <Portal>
          <BulkProductionModal
            shots={visibleShots}
            selectedShotId={selectedShotId}
            onClose={() => setShowBulkModal(false)}
            onDone={() => void loadShots()}
          />
        </Portal>
      ) : null}
    </section>
  );
}

function SurfaceActionButton({
  children,
  disabled = false,
  onClick,
  type,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  type: "primary" | "secondary";
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minHeight: 42,
        padding: type === "primary" ? "0 18px" : "0 16px",
        borderRadius: 14,
        border:
          type === "primary"
            ? "1px solid rgba(245, 158, 11, 0.28)"
            : "1px solid rgba(255, 255, 255, 0.08)",
        background:
          type === "primary"
            ? "linear-gradient(135deg, #f59e0b, #f6c453)"
            : "rgba(255, 255, 255, 0.04)",
        color: type === "primary" ? "#140b00" : "var(--text-primary)",
        fontSize: 13,
        fontWeight: type === "primary" ? 800 : 700,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.48 : 1,
        boxShadow:
          type === "primary" && !disabled ? "0 14px 32px rgba(245, 158, 11, 0.24)" : "none",
      }}
      type="button"
    >
      {children}
    </button>
  );
}

function HeroInfoPill({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 999,
        border: `1px solid ${
          accent ? "rgba(245, 158, 11, 0.26)" : "rgba(255, 255, 255, 0.08)"
        }`,
        background: accent ? "rgba(245, 158, 11, 0.08)" : "rgba(255, 255, 255, 0.04)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
      <strong
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.02em",
          color: accent ? "var(--accent)" : "var(--text-primary)",
        }}
      >
        {value}
      </strong>
    </div>
  );
}

function BoardMetaPill({
  children,
  accent = false,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 12px",
        borderRadius: 999,
        border: `1px solid ${
          accent ? "rgba(245, 158, 11, 0.24)" : "rgba(255, 255, 255, 0.08)"
        }`,
        background: accent ? "rgba(245, 158, 11, 0.08)" : "rgba(255, 255, 255, 0.04)",
        color: accent ? "var(--accent)" : "var(--text-secondary)",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function ZoomControlButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        borderRadius: 999,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(8, 8, 10, 0.55)",
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
      type="button"
    >
      {children}
    </button>
  );
}

function MetricCard({
  caption,
  emphasized = false,
  label,
  tone,
  value,
}: {
  caption: string;
  emphasized?: boolean;
  label: string;
  tone: "accent" | "danger" | "info" | "success";
  value: number;
}) {
  const tokens =
    tone === "info"
      ? {
          border: "rgba(59, 130, 246, 0.24)",
          glow: "rgba(59, 130, 246, 0.12)",
          text: "var(--status-info)",
        }
      : tone === "danger"
        ? {
            border: "rgba(239, 68, 68, 0.24)",
            glow: "rgba(239, 68, 68, 0.12)",
            text: "var(--status-error)",
          }
        : tone === "success"
          ? {
              border: "rgba(34, 197, 94, 0.24)",
              glow: "rgba(34, 197, 94, 0.12)",
              text: "var(--status-success)",
            }
          : {
              border: "rgba(245, 158, 11, 0.24)",
              glow: "rgba(245, 158, 11, 0.12)",
              text: "var(--accent)",
            };

  return (
    <div
      style={{
        position: "relative",
        display: "grid",
        gap: 10,
        padding: "18px 18px 20px",
        borderRadius: 22,
        border: `1px solid ${tokens.border}`,
        background:
          emphasized
            ? `linear-gradient(180deg, ${tokens.glow}, rgba(255,255,255,0.02) 48%), rgba(17, 17, 19, 0.86)`
            : "rgba(17, 17, 19, 0.82)",
        boxShadow: emphasized ? `0 18px 44px ${tokens.glow}` : "none",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <strong style={{ fontSize: 34, lineHeight: 1, letterSpacing: "-0.06em" }}>{value}</strong>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: tokens.text, opacity: 0.9 }} />
      </div>
      <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>{caption}</span>
    </div>
  );
}

function TrackHeader({
  label,
  subtitle,
  tone,
}: {
  label: string;
  subtitle: string;
  tone: "accent" | "muted";
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "7px 12px",
            borderRadius: 999,
            background:
              tone === "accent" ? "rgba(245, 158, 11, 0.12)" : "rgba(255,255,255,0.04)",
            color: tone === "accent" ? "var(--accent)" : "var(--text-secondary)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background:
              tone === "accent"
                ? "linear-gradient(90deg, rgba(245, 158, 11, 0.28), rgba(255,255,255,0.04))"
                : "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))",
          }}
        />
      </div>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{subtitle}</span>
    </div>
  );
}

function SequenceBadge({ caption, index }: { caption: string; index: number }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        Sequence {String(index + 1).padStart(2, "0")}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 72,
            height: 2,
            borderRadius: 999,
            background: "linear-gradient(90deg, rgba(245, 158, 11, 0.58), rgba(255,255,255,0.1))",
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {caption}
        </span>
      </div>
    </div>
  );
}

function InlineConnector({ isLinked }: { isLinked: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: CONNECTOR_WIDTH,
        flex: "0 0 auto",
        display: "grid",
        alignItems: "center",
        justifyItems: "center",
        paddingTop: 88,
      }}
    >
      <div
        style={{
          position: "relative",
          width: 56,
          height: 42,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 8,
            top: 20,
            height: 2,
            borderRadius: 999,
            background: isLinked
              ? "linear-gradient(90deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.96))"
              : "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.24))",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 2,
            top: 14,
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
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: isLinked ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          {isLinked ? "Continue" : "Cut"}
        </span>
      </div>
    </div>
  );
}

function CoverageEmptyState() {
  return (
    <div
      style={{
        width: TIMELINE_GROUP_WIDTH,
        minHeight: 146,
        display: "grid",
        placeItems: "center",
        borderRadius: 22,
        border: "1px dashed rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.02)",
        color: "var(--text-muted)",
        textAlign: "center",
      }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          Coverage Slot Empty
        </span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Bu beat icin alternatif veya insert shot eklenmedi.
        </span>
      </div>
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
