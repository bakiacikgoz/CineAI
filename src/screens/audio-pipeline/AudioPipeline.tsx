import { startTransition, type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  CircleDot,
  FileAudio,
  Filter,
  Mic2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  UserRound,
  Waves,
} from "lucide-react";
import { CollapsibleSection, MetricCard, ProCard, ToggleSwitch, SegmentGroup, StatusDot, ProEmptyState } from "@/components/ui";
import { listCharacters, type CharacterRecord } from "@/services/character.service";
import { DialogueTextEditor } from "@/components/audio/DialogueTextEditor";
import { DialoguePerformanceEditor } from "@/components/audio/DialoguePerformanceEditor";
import { VoiceoverTextEditor } from "@/components/audio/VoiceoverTextEditor";
import {
  clearAudioSpeakerAlias,
  clearAudioSpeakerVoiceBinding,
  clearCharacterVoiceBinding,
  clearDialogueGenerationProfile,
  importAllTurkishElevenLabsVoices,
  importSharedElevenLabsVoice,
  listAudioSpeakerAliases,
  listAudioSpeakerVoiceBindings,
  listCharacterVoiceBindings,
  listDialogueAudioShots,
  listElevenLabsVoices,
  listRecommendedTurkishVoicesPage,
  reconcileProjectAudioState,
  saveDialogueTextOverride,
  saveDialogueGenerationProfile,
  setAudioSpeakerAlias,
  setAudioSpeakerVoiceBinding,
  setCharacterVoiceBinding,
  clearDialogueTextOverride,
  saveVoiceoverText,
  clearVoiceoverText,
  type AudioSpeakerAliasRecord,
  type AudioSpeakerVoiceBindingRecord,
  type CharacterVoiceBindingRecord,
  type DialogueAudioTake,
  type DialogueAudioShot,
  type DialogueGenerationProfile,
  type DialogueOverrideLine,
  type ElevenLabsSharedVoice,
  type ElevenLabsSharedVoicesPageResult,
  type ElevenLabsVoice,
  type ImportTurkishVoicesResult,
} from "@/services/audio-pipeline.service";
import {
  enqueueAudioDialogueJob,
  enqueueBulkAudioDialogueJobs,
  enqueueBulkLipSyncJobs,
  enqueueLipSyncJob,
} from "@/services/jobqueue.service";
import { getShots, type ShotRow } from "@/services/import.service";
import {
  listLipSyncEligibleShots,
  type LipSyncShotDetail,
} from "@/services/lipsync.service";
import { useProjectStore } from "@/store/project.store";

function toAbsoluteProjectPath(projectFolderPath: string, relativePath: string): string {
  const normalizedBase = projectFolderPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

function formatAudioTakeLabel(take: DialogueAudioTake): string {
  return `Take ${String(take.takeNumber).padStart(2, "0")}`;
}

function formatAudioTakeCreatedAt(value: number): string {
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

type AudioPlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

function resolvePlaybackButtonLabel(status: AudioPlaybackStatus): string {
  switch (status) {
    case "loading":
      return "Yukleniyor...";
    case "playing":
      return "Durdur";
    case "paused":
      return "Devam et";
    case "error":
      return "Tekrar dene";
    default:
      return "Dinle";
  }
}

function resolvePlaybackStatusLabel(status: AudioPlaybackStatus): string | null {
  switch (status) {
    case "loading":
      return "Yukleniyor";
    case "playing":
      return "Caliyor";
    case "paused":
      return "Duraklatildi";
    case "error":
      return "Oynatilamadi";
    default:
      return null;
  }
}

function resolvePlaybackBadgeStyle(status: AudioPlaybackStatus): CSSProperties {
  const accent =
    status === "playing"
      ? "var(--status-success)"
      : status === "loading"
        ? "var(--status-warning)"
        : status === "error"
          ? "var(--status-error)"
          : "var(--text-muted)";

  return {
    ...tagStyle,
    color: accent,
    border: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
    background: `color-mix(in srgb, ${accent} 10%, var(--surface-card))`,
  };
}

function resolvePlayerSurfaceStyle(isActive: boolean, status: AudioPlaybackStatus): CSSProperties {
  const accent =
    status === "playing"
      ? "var(--status-success)"
      : status === "loading"
        ? "var(--status-warning)"
        : status === "error"
          ? "var(--status-error)"
          : "var(--border-subtle)";

  return {
    display: "grid",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${
      isActive
        ? `color-mix(in srgb, ${accent} 38%, var(--border-subtle))`
        : "var(--border-subtle)"
    }`,
    background: isActive
      ? "color-mix(in srgb, var(--surface-hover) 72%, var(--surface-card))"
      : "var(--surface-hover)",
    transition: "border-color 150ms ease, background 150ms ease",
  };
}

function findAudioElement(scope: ParentNode | null): HTMLAudioElement | null {
  if (!scope) {
    return null;
  }

  const audioElement = scope.querySelector("audio");
  return audioElement instanceof HTMLAudioElement ? audioElement : null;
}


function normalizeVoiceMetadataValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function scoreVoiceForTurkish(voice: ElevenLabsVoice): number {
  const haystack = [
    voice.name,
    ...Object.entries(voice.labels).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;

  if (/\bturk(?:ish)?\b|türk/.test(haystack)) {
    score += 12;
  }

  if (/\btr\b|\btr-tr\b/.test(haystack)) {
    score += 8;
  }

  if (/\bistanbul\b|\bankara\b/.test(haystack)) {
    score += 4;
  }

  const useCase = normalizeVoiceMetadataValue(voice.labels.use_case);
  if (/\bconversational\b|\bnarration\b|\bstorytelling\b/.test(useCase)) {
    score += 2;
  }

  return score;
}

function buildVoiceOptionLabel(voice: ElevenLabsVoice): string {
  return scoreVoiceForTurkishCompatibility(voice) > 0 ? `${voice.name} [TR]` : voice.name;
}

function scoreVoiceForTurkishCompatibility(voice: ElevenLabsVoice): number {
  const haystack = [
    voice.name,
    ...Object.entries(voice.labels).flatMap(([key, value]) => [key, value]),
  ]
    .join(" ")
    .toLowerCase();

  let score = scoreVoiceForTurkish(voice);

  if (/\btürk\b|\btürkçe\b|\bturkey\b|\bturkiye\b/.test(haystack)) {
    score += 6;
  }

  if (/\blanguage\b.*\btr\b|\blocale\b.*\btr\b|\baccent\b.*\bturk/.test(haystack)) {
    score += 6;
  }

  if (/\bvoice over\b|\bconversational\b|\bnarration\b|\bstorytelling\b/.test(haystack)) {
    score += 2;
  }

  return score;
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }

  return String(value);
}

function mergeTurkishVoiceCatalogPages(
  currentVoices: ElevenLabsSharedVoice[],
  nextVoices: ElevenLabsSharedVoice[],
): ElevenLabsSharedVoice[] {
  const merged = new Map(currentVoices.map((voice) => [voice.voiceId, voice] as const));

  for (const voice of nextVoices) {
    const existing = merged.get(voice.voiceId);

    if (!existing || voice.turkishCompatibilityScore > existing.turkishCompatibilityScore) {
      merged.set(voice.voiceId, voice);
    }
  }

  return Array.from(merged.values()).sort((left, right) =>
    right.turkishCompatibilityScore - left.turkishCompatibilityScore ||
    Number(right.freeUsersAllowed) - Number(left.freeUsersAllowed) ||
    right.clonedByCount - left.clonedByCount ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

export function AudioPipeline() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const [shots, setShots] = useState<DialogueAudioShot[]>([]);
  const [allProjectShots, setAllProjectShots] = useState<ShotRow[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [turkishVoiceCatalog, setTurkishVoiceCatalog] = useState<ElevenLabsSharedVoice[]>([]);
  const [voiceBindings, setVoiceBindings] = useState<CharacterVoiceBindingRecord[]>([]);
  const [speakerAliases, setSpeakerAliases] = useState<AudioSpeakerAliasRecord[]>([]);
  const [speakerVoiceBindings, setSpeakerVoiceBindings] = useState<AudioSpeakerVoiceBindingRecord[]>([]);
  const [lipsyncDetails, setLipSyncDetails] = useState<LipSyncShotDetail[]>([]);
  const [voiceWarning, setVoiceWarning] = useState<string | null>(null);
  const [sharedVoiceWarning, setSharedVoiceWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogPage, setCatalogPage] = useState(-1);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [showOnlyMissingCatalogVoices, setShowOnlyMissingCatalogVoices] = useState(false);
  const [catalogGenderFilter, setCatalogGenderFilter] = useState("all");
  const [catalogUseCaseFilter, setCatalogUseCaseFilter] = useState("all");
  const [showOnlyFreeAllowedCatalogVoices, setShowOnlyFreeAllowedCatalogVoices] = useState(false);
  const [showOnlyFeaturedCatalogVoices, setShowOnlyFeaturedCatalogVoices] = useState(false);
  const [showOnlyPreviewableCatalogVoices, setShowOnlyPreviewableCatalogVoices] = useState(false);
  const [catalogQuickFilter, setCatalogQuickFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "blocked" | "missing" | "voiceover">("all");
  const [addVoiceoverShotId, setAddVoiceoverShotId] = useState<string | null>(null);
  const [addVoiceoverDraft, setAddVoiceoverDraft] = useState("");
  const [activePlaybackId, setActivePlaybackId] = useState<string | null>(null);
  const [activePlaybackStatus, setActivePlaybackStatus] = useState<AudioPlaybackStatus>("idle");
  const activePlaybackIdRef = useRef<string | null>(null);
  const activeAudioElementRef = useRef<HTMLAudioElement | null>(null);

  async function loadScreenData(showSpinner = true) {
    if (!activeProject) {
      setShots([]);
      setAllProjectShots([]);
      setCharacters([]);
      setVoices([]);
      setTurkishVoiceCatalog([]);
      setLipSyncDetails([]);
      setCatalogPage(-1);
      setCatalogHasMore(false);
      setVoiceBindings([]);
      setSpeakerAliases([]);
      setSpeakerVoiceBindings([]);
      setLoading(false);
      return;
    }

    if (showSpinner) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      await reconcileProjectAudioState(activeProject.id);
      const [nextShots, nextAllShots, nextCharacters, nextBindings, nextAliases, nextSpeakerVoiceBindings, nextLipSyncDetails] = await Promise.all([
        listDialogueAudioShots(activeProject.id),
        getShots(activeProject.id),
        listCharacters(),
        listCharacterVoiceBindings(),
        listAudioSpeakerAliases(),
        listAudioSpeakerVoiceBindings(),
        listLipSyncEligibleShots(),
      ]);
      let nextVoices: ElevenLabsVoice[] = [];
      let nextVoiceWarning: string | null = null;

      try {
        nextVoices = await listElevenLabsVoices();
      } catch (error) {
        nextVoiceWarning =
          error instanceof Error
            ? error.message
            : "ElevenLabs voice listesi yuklenemedi.";
      }

      setShots(nextShots);
      setAllProjectShots(nextAllShots);
      setCharacters(nextCharacters.filter((character) => character.projectId === activeProject.id));
      setVoices(nextVoices);
      setVoiceBindings(nextBindings);
      setSpeakerAliases(nextAliases);
      setSpeakerVoiceBindings(nextSpeakerVoiceBindings);
      setLipSyncDetails(nextLipSyncDetails);
      setVoiceWarning(nextVoiceWarning);
    } catch (error) {
      console.error("Failed to load audio pipeline screen", error);
      await message(
        error instanceof Error ? error.message : "Audio pipeline verileri yuklenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadTurkishVoiceCatalogPage(options?: { reset?: boolean }) {
    if (!activeProject) {
      setTurkishVoiceCatalog([]);
      setCatalogPage(-1);
      setCatalogHasMore(false);
      setSharedVoiceWarning(null);
      return;
    }

    const shouldReset = options?.reset ?? false;
    const nextPage = shouldReset ? 0 : catalogPage + 1;

    if (!shouldReset && (catalogLoading || catalogLoadingMore || !catalogHasMore)) {
      return;
    }

    if (shouldReset) {
      setCatalogLoading(true);
      setSharedVoiceWarning(null);
    } else {
      setCatalogLoadingMore(true);
    }

    try {
      const result: ElevenLabsSharedVoicesPageResult = await listRecommendedTurkishVoicesPage({
        page: nextPage,
        pageSize: 18,
      });

      startTransition(() => {
        setTurkishVoiceCatalog((currentVoices) =>
          shouldReset
            ? mergeTurkishVoiceCatalogPages([], result.voices)
            : mergeTurkishVoiceCatalogPages(currentVoices, result.voices),
        );
      });
      setCatalogPage(result.page);
      setCatalogHasMore(result.hasMore);
      setSharedVoiceWarning(null);
    } catch (error) {
      const nextWarning =
        error instanceof Error
          ? error.message
          : "Turkce voice katalogu yuklenemedi.";

      if (shouldReset) {
        setTurkishVoiceCatalog([]);
        setCatalogPage(-1);
        setCatalogHasMore(false);
      }

      setSharedVoiceWarning(nextWarning);
    } finally {
      setCatalogLoading(false);
      setCatalogLoadingMore(false);
    }
  }

  async function handleRefresh() {
    await Promise.all([
      loadScreenData(false),
      loadTurkishVoiceCatalogPage({ reset: true }),
    ]);
  }

  useEffect(() => {
    void loadScreenData(true);
    void loadTurkishVoiceCatalogPage({ reset: true });
  }, [activeProject?.id]);

  useEffect(() => {
    activeAudioElementRef.current?.pause();
    activePlaybackIdRef.current = null;
    activeAudioElementRef.current = null;
    setActivePlaybackId(null);
    setActivePlaybackStatus("idle");
  }, [activeProject?.id]);

  useEffect(() => () => {
    activeAudioElementRef.current?.pause();
  }, []);

  const bindingsByCharacterId = useMemo(
    () => new Map(voiceBindings.map((binding) => [binding.characterId, binding] as const)),
    [voiceBindings],
  );
  const aliasesBySpeakerKey = useMemo(
    () => new Map(speakerAliases.map((alias) => [alias.speakerKey, alias] as const)),
    [speakerAliases],
  );
  const speakerVoiceBindingsBySpeakerKey = useMemo(
    () => new Map(speakerVoiceBindings.map((binding) => [binding.speakerKey, binding] as const)),
    [speakerVoiceBindings],
  );
  const sortedVoices = useMemo(
    () =>
      voices
        .slice()
        .sort((left, right) =>
          scoreVoiceForTurkishCompatibility(right) - scoreVoiceForTurkishCompatibility(left) ||
          left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
        ),
    [voices],
  );
  const ownedVoiceIds = useMemo(
    () => new Set(voices.map((voice) => voice.voiceId)),
    [voices],
  );
  const ownedVoiceNames = useMemo(
    () => new Set(voices.map((voice) => normalizeVoiceMetadataValue(voice.name))),
    [voices],
  );
  const catalogGenderOptions = useMemo(
    () =>
      Array.from(
        new Set(
          turkishVoiceCatalog
            .map((voice) => normalizeVoiceMetadataValue(voice.gender))
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [turkishVoiceCatalog],
  );
  const catalogUseCaseOptions = useMemo(
    () =>
      Array.from(
        new Set(
          turkishVoiceCatalog
            .map((voice) => normalizeVoiceMetadataValue(voice.useCase))
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [turkishVoiceCatalog],
  );
  const filteredTurkishVoiceCatalog = useMemo(() => {
    const normalizedQuery = normalizeVoiceMetadataValue(catalogQuery);

    return turkishVoiceCatalog
      .map((voice) => ({
        voice,
        alreadyAdded:
          ownedVoiceIds.has(voice.voiceId) ||
          ownedVoiceNames.has(normalizeVoiceMetadataValue(voice.name)),
      }))
      .filter(({ voice, alreadyAdded }) => {
        if (catalogQuickFilter === "turkish" && voice.turkishCompatibilityScore < 4) {
          return false;
        }

        if (catalogQuickFilter === "assigned" && !alreadyAdded) {
          return false;
        }

        if (showOnlyMissingCatalogVoices && alreadyAdded) {
          return false;
        }

        if (
          catalogGenderFilter !== "all" &&
          normalizeVoiceMetadataValue(voice.gender) !== catalogGenderFilter
        ) {
          return false;
        }

        if (
          catalogUseCaseFilter !== "all" &&
          normalizeVoiceMetadataValue(voice.useCase) !== catalogUseCaseFilter
        ) {
          return false;
        }

        if (showOnlyFreeAllowedCatalogVoices && !voice.freeUsersAllowed) {
          return false;
        }

        if (showOnlyFeaturedCatalogVoices && !voice.featured) {
          return false;
        }

        if (showOnlyPreviewableCatalogVoices && !voice.previewUrl) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        const haystack = [
          voice.name,
          voice.description,
          voice.descriptive,
          voice.useCase,
          voice.accent,
          voice.locale,
          voice.language,
          ...voice.verifiedLanguages.flatMap((value) => [
            value.language,
            value.accent,
            value.locale,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
      .sort((left, right) =>
        Number(left.alreadyAdded) - Number(right.alreadyAdded) ||
        right.voice.turkishCompatibilityScore - left.voice.turkishCompatibilityScore ||
        Number(right.voice.freeUsersAllowed) - Number(left.voice.freeUsersAllowed) ||
        right.voice.clonedByCount - left.voice.clonedByCount ||
        left.voice.name.localeCompare(right.voice.name, undefined, { sensitivity: "base" }),
      );
  }, [
    catalogGenderFilter,
    catalogQuery,
    catalogQuickFilter,
    catalogUseCaseFilter,
    ownedVoiceIds,
    ownedVoiceNames,
    showOnlyFeaturedCatalogVoices,
    showOnlyFreeAllowedCatalogVoices,
    showOnlyMissingCatalogVoices,
    showOnlyPreviewableCatalogVoices,
    turkishVoiceCatalog,
  ]);
  const catalogStats = useMemo(() => {
    const addedCount = filteredTurkishVoiceCatalog.filter((item) => item.alreadyAdded).length;

    return {
      totalCount: turkishVoiceCatalog.length,
      filteredCount: filteredTurkishVoiceCatalog.length,
      addedCount,
      missingCount: Math.max(0, filteredTurkishVoiceCatalog.length - addedCount),
    };
  }, [filteredTurkishVoiceCatalog, turkishVoiceCatalog.length]);

  const speakerRoutes = useMemo(() => {
    const map = new Map<
      string,
      { speakerKey: string; speakerLabel: string; shotCount: number; needsAttention: boolean }
    >();

    for (const shot of shots) {
      for (const line of shot.resolvedLines) {
        const current = map.get(line.speakerKey);
        map.set(line.speakerKey, {
          speakerKey: line.speakerKey,
          speakerLabel: line.speaker,
          shotCount: (current?.shotCount ?? 0) + 1,
          needsAttention:
            (current?.needsAttention ?? false) || (!line.characterId && !line.voiceId),
        });
      }
    }

    return Array.from(map.values()).sort((left, right) => left.speakerLabel.localeCompare(right.speakerLabel));
  }, [shots]);
  const lipSyncDetailsByShotId = useMemo(
    () => new Map(lipsyncDetails.map((detail) => [detail.shot.id, detail] as const)),
    [lipsyncDetails],
  );

  const readyShots = shots.filter((shot) => shot.isReady);
  const missingMasters = readyShots.filter((shot) => !shot.shot.audioMasterPath);
  const blockedShots = shots.filter((shot) => Boolean(shot.blockerReason));
  const voiceoverShots = shots.filter((shot) => shot.isVoiceover);
  const readyLipSyncShots = lipsyncDetails.filter((detail) => detail.isEligible);
  const staleLipSyncShots = readyLipSyncShots.filter((detail) => detail.isStale);
  const missingLipSyncMasters = readyLipSyncShots.filter((detail) => !detail.masterVideoPath);
  const audioShotIds = useMemo(() => new Set(shots.map((s) => s.shot.id)), [shots]);
  const shotsWithoutAudio = useMemo(
    () => allProjectShots.filter((s) => !audioShotIds.has(s.id) && !s.isArchived),
    [allProjectShots, audioShotIds],
  );

  const filteredShots = useMemo(() => {
    if (statusFilter === "ready") return readyShots;
    if (statusFilter === "blocked") return blockedShots;
    if (statusFilter === "missing") return missingMasters;
    if (statusFilter === "voiceover") return voiceoverShots;
    return shots;
  }, [shots, readyShots, blockedShots, missingMasters, voiceoverShots, statusFilter]);

  function syncActivePlayback(
    playbackId: string,
    element: HTMLAudioElement,
    status: AudioPlaybackStatus,
  ) {
    const previousElement = activeAudioElementRef.current;

    activePlaybackIdRef.current = playbackId;
    activeAudioElementRef.current = element;
    setActivePlaybackId(playbackId);
    setActivePlaybackStatus(status);

    if (previousElement && previousElement !== element) {
      previousElement.pause();
    }
  }

  function clearActivePlayback(
    playbackId?: string,
    element?: HTMLAudioElement | null,
  ) {
    const matchesActivePlayback =
      (!playbackId || activePlaybackIdRef.current === playbackId) &&
      (!element || activeAudioElementRef.current === element);

    if (!matchesActivePlayback) {
      return;
    }

    activePlaybackIdRef.current = null;
    activeAudioElementRef.current = null;
    setActivePlaybackId(null);
    setActivePlaybackStatus("idle");
  }

  function resolvePlaybackState(playbackId: string): AudioPlaybackStatus {
    return activePlaybackId === playbackId ? activePlaybackStatus : "idle";
  }

  async function toggleAudioPlayback(playbackId: string, trigger: HTMLButtonElement) {
    const element = findAudioElement(trigger.closest("[data-audio-player]"));

    if (!element?.src) {
      return;
    }

    const isCurrentPlayback =
      activePlaybackIdRef.current === playbackId &&
      activeAudioElementRef.current === element;

    if (isCurrentPlayback && !element.paused && !element.ended) {
      element.pause();
      return;
    }

    if (element.ended) {
      element.currentTime = 0;
    }

    syncActivePlayback(playbackId, element, "loading");

    try {
      await element.play();
    } catch (error) {
      console.error("Audio playback failed", error);
      syncActivePlayback(playbackId, element, "error");
    }
  }

  function handleAudioPlay(playbackId: string, element: HTMLAudioElement) {
    syncActivePlayback(
      playbackId,
      element,
      element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ? "playing" : "loading",
    );
  }

  function handleAudioPlaying(playbackId: string, element: HTMLAudioElement) {
    syncActivePlayback(playbackId, element, "playing");
  }

  function handleAudioPause(playbackId: string, element: HTMLAudioElement) {
    if (
      activePlaybackIdRef.current !== playbackId ||
      activeAudioElementRef.current !== element
    ) {
      return;
    }

    if (element.ended) {
      clearActivePlayback(playbackId, element);
      return;
    }

    setActivePlaybackStatus("paused");
  }

  function handleAudioEnded(playbackId: string, element: HTMLAudioElement) {
    element.currentTime = 0;
    clearActivePlayback(playbackId, element);
  }

  function handleAudioWaiting(playbackId: string, element: HTMLAudioElement) {
    syncActivePlayback(playbackId, element, "loading");
  }

  function handleAudioError(playbackId: string, element: HTMLAudioElement) {
    syncActivePlayback(playbackId, element, "error");
  }

  function handleStatusFilterClick(filter: "all" | "ready" | "blocked" | "missing" | "voiceover") {
    setStatusFilter((current) => (current === filter ? "all" : filter));
  }

  async function handleQueueSingleShot(shotId: string) {
    setBusyKey(`shot:${shotId}`);

    try {
      await enqueueAudioDialogueJob({ shotId });
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Dialogue shot kuyruga eklenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleBulkQueue(filter: "missing" | "all") {
    setBusyKey(`bulk:${filter}`);

    try {
      const targetShots =
        filter === "missing"
          ? missingMasters
          : readyShots;

      if (targetShots.length === 0) {
        const blockerCount = blockedShots.length;
        throw new Error(
          blockerCount > 0
            ? `Queue'lanabilir ready shot yok. ${blockerCount} shot blocker durumunda. Once alias veya voice binding eksiklerini tamamla.`
            : "Queue'lanabilir ready shot yok.",
        );
      }

      const result = await enqueueBulkAudioDialogueJobs({ filter });
      await loadScreenData(false);
      await message(`${result.jobCount} dialogue shot kuyruga eklendi.`, {
        title: "Seslendirme",
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Toplu dialogue queue islemi basarisiz.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleQueueSingleLipSync(shotId: string) {
    setBusyKey(`lipsync:${shotId}`);

    try {
      await enqueueLipSyncJob({ shotId });
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Lipsync shot kuyruga eklenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleBulkLipSync(filter: "missing" | "all" | "stale") {
    setBusyKey(`bulk-lipsync:${filter}`);

    try {
      const targetShots =
        filter === "missing"
          ? missingLipSyncMasters
          : filter === "stale"
            ? staleLipSyncShots
            : readyLipSyncShots;

      if (targetShots.length === 0) {
        throw new Error("Queue'lanabilir lipsync shot yok.");
      }

      const result = await enqueueBulkLipSyncJobs({ filter });
      await loadScreenData(false);
      await message(`${result.jobCount} lipsync shot kuyruga eklendi.`, {
        title: "Seslendirme",
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Toplu lipsync queue islemi basarisiz.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVoiceBindingChange(characterId: string, voiceId: string) {
    setBusyKey(`voice:${characterId}`);

    try {
      if (!voiceId) {
        await clearCharacterVoiceBinding(characterId);
      } else {
        const voice = voices.find((item) => item.voiceId === voiceId);

        if (!voice) {
          throw new Error("Secilen voice bulunamadi.");
        }

        await setCharacterVoiceBinding(characterId, voice.voiceId, voice.name);
      }

      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Voice binding guncellenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleAliasChange(speakerKey: string, speakerLabel: string, characterId: string) {
    setBusyKey(`alias:${speakerKey}`);

    try {
      if (!characterId) {
        await clearAudioSpeakerAlias(speakerKey);
      } else {
        await setAudioSpeakerAlias(speakerLabel, characterId);
      }

      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Speaker alias guncellenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSpeakerVoiceBindingChange(
    speakerKey: string,
    speakerLabel: string,
    voiceId: string,
  ) {
    setBusyKey(`speaker-voice:${speakerKey}`);

    try {
      if (!voiceId) {
        await clearAudioSpeakerVoiceBinding(speakerKey);
      } else {
        const voice = voices.find((item) => item.voiceId === voiceId);

        if (!voice) {
          throw new Error("Secilen voice bulunamadi.");
        }

        await setAudioSpeakerVoiceBinding(speakerLabel, voice.voiceId, voice.name);
      }

      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Speaker voice binding guncellenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleImportSharedVoice(voice: ElevenLabsSharedVoice) {
    setBusyKey(`shared:${voice.voiceId}`);

    try {
      await importSharedElevenLabsVoice({
        publicOwnerId: voice.publicOwnerId,
        voiceId: voice.voiceId,
        newName: voice.name,
      });
      await loadScreenData(false);
      await message(`${voice.name} My Voices listesine eklendi.`, {
        title: "Seslendirme",
        kind: "info",
      });
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Voice Library sesi eklenemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleImportAllTurkishVoices() {
    setBusyKey("shared:all");

    try {
      const result: ImportTurkishVoicesResult = await importAllTurkishElevenLabsVoices();
      await loadScreenData(false);

      const summary = [
        `${result.importedCount} voice eklendi`,
        `${result.skippedCount} voice zaten mevcuttu`,
        result.failedCount > 0 ? `${result.failedCount} voice eklenemedi` : null,
      ]
        .filter(Boolean)
        .join(" • ");

      await message(summary, {
        title: "Turkce voice katalogu",
        kind: result.failedCount > 0 ? "warning" : "info",
      });

      if (result.failures.length > 0) {
        setSharedVoiceWarning(
          `Bazi Turkce voice import'lari basarisiz: ${result.failures.slice(0, 3).join(" | ")}`,
        );
      }
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Turkce voice toplu import islemi basarisiz.",
        { title: "Turkce voice katalogu", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDialogueOverrideSave(shotId: string, lines: DialogueOverrideLine[]) {
    setBusyKey(`edit:${shotId}`);

    try {
      await saveDialogueTextOverride({ shotId, lines });
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Seslendirme metni kaydedilemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDialogueOverrideClear(shotId: string) {
    setBusyKey(`edit:${shotId}`);

    try {
      await clearDialogueTextOverride(shotId);
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Seslendirme metni sifirlanamadi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVoiceoverSave(shotId: string, text: string) {
    setBusyKey(`voiceover:${shotId}`);

    try {
      await saveVoiceoverText({ shotId, text });
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Seslendirme metni kaydedilemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleVoiceoverClear(shotId: string) {
    setBusyKey(`voiceover:${shotId}`);

    try {
      await clearVoiceoverText(shotId);
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Seslendirme metni kaldirilmadi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGenerationProfileSave(
    shotId: string,
    profile: DialogueGenerationProfile,
  ) {
    setBusyKey(`profile:${shotId}`);

    try {
      await saveDialogueGenerationProfile(shotId, profile);
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Duygu tonu ayari kaydedilemedi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGenerationProfileClear(shotId: string) {
    setBusyKey(`profile:${shotId}`);

    try {
      await clearDialogueGenerationProfile(shotId);
      await loadScreenData(false);
    } catch (error) {
      await message(
        error instanceof Error ? error.message : "Duygu tonu ayari sifirlanamadi.",
        { title: "Seslendirme", kind: "error" },
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (!activeProject) {
    return (
      <section className="screen-shell">
        <ProEmptyState
          icon={AudioLines}
          title="Seslendirme Hatti"
          description="Bu paneli kullanmak icin once bir proje ac."
        />
      </section>
    );
  }

  return (
    <section className="screen-shell">
      <div style={screenStyle}>
        {/* ── Hero basligi ─────────────────────────────────── */}
        <header className="screen-hero">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 10, maxWidth: 680 }}>
              <span className="screen-eyebrow">
                <Mic2 size={13} />
                Seslendirme Hatti
              </span>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-primary)" }}>
                Diyalog Seslendirme
              </h1>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                Karakter ses eslestirmesi, konusmaci takma adi yonetimi ve toplu seslendirme
                uretimini bu panelden kontrol et.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <StatusDot status="success" label={`${readyShots.length} Hazir`} />
                <StatusDot status="error" label={`${blockedShots.length} Engelli`} />
                <StatusDot status="warning" label={`${missingMasters.length} Eksik`} />
                <StatusDot status="active" label={`${readyLipSyncShots.length} Lipsync uygun`} />
                {staleLipSyncShots.length > 0 ? (
                  <StatusDot status="warning" label={`${staleLipSyncShots.length} Lipsync stale`} />
                ) : null}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              <button
                className="btn-secondary"
                disabled={refreshing || catalogLoading}
                onClick={() => void handleRefresh()}
                type="button"
              >
                <RefreshCw size={14} className={refreshing ? "spin-slow" : undefined} />
                {refreshing ? "Yenileniyor..." : "Yenile"}
              </button>
              <button
                className="btn-secondary"
                disabled={busyKey === "bulk:missing"}
                onClick={() => void handleBulkQueue("missing")}
                type="button"
              >
                <Waves size={14} />
                Eksikleri uret
              </button>
              <button
                className="btn-primary"
                disabled={busyKey === "bulk:all"}
                onClick={() => void handleBulkQueue("all")}
                type="button"
              >
                <Sparkles size={14} />
                Toplu uretim baslat
              </button>
              <button
                className="btn-secondary"
                disabled={busyKey === "bulk-lipsync:missing"}
                onClick={() => void handleBulkLipSync("missing")}
                type="button"
              >
                <CircleDot size={14} />
                Eksik lipsync
              </button>
              <button
                className="btn-primary"
                disabled={busyKey === "bulk-lipsync:all"}
                onClick={() => void handleBulkLipSync("all")}
                type="button"
              >
                <Waves size={14} />
                Uygun lipsync queue
              </button>
            </div>
          </div>
        </header>

        {/* ── Durum metrikleri (tiklanabilir filtre) ──────── */}
        <section style={metricsGridStyle}>
          <div
            onClick={() => handleStatusFilterClick("all")}
            style={{ cursor: "pointer", opacity: statusFilter === "all" ? 1 : 0.65, transition: "opacity 150ms ease" }}
          >
            <MetricCard
              icon={AudioLines}
              label="Toplam Diyalog"
              value={shots.length}
              description="Ayristirilan diyalog shot sayisi"
              accentColor="var(--surface-hover)"
            />
          </div>
          <div
            onClick={() => handleStatusFilterClick("ready")}
            style={{ cursor: "pointer", opacity: statusFilter === "ready" ? 1 : 0.65, transition: "opacity 150ms ease" }}
          >
            <MetricCard
              icon={CheckCircle2}
              label="Hazir"
              value={readyShots.length}
              description="Ses ve takma ad eslemesi tamam"
              accentColor="var(--status-success)"
            />
          </div>
          <div
            onClick={() => handleStatusFilterClick("blocked")}
            style={{ cursor: "pointer", opacity: statusFilter === "blocked" ? 1 : 0.65, transition: "opacity 150ms ease" }}
          >
            <MetricCard
              icon={AlertTriangle}
              label="Engellenen"
              value={blockedShots.length}
              description="Takma ad veya ses eslesmesi bekliyor"
              accentColor="var(--status-error)"
            />
          </div>
          <div
            onClick={() => handleStatusFilterClick("missing")}
            style={{ cursor: "pointer", opacity: statusFilter === "missing" ? 1 : 0.65, transition: "opacity 150ms ease" }}
          >
            <MetricCard
              icon={FileAudio}
              label="Eksik WAV"
              value={missingMasters.length}
              description="Hazir ama master dosyasi uretilmedi"
              accentColor="var(--status-warning)"
            />
          </div>
          <div
            onClick={() => handleStatusFilterClick("voiceover")}
            style={{ cursor: "pointer", opacity: statusFilter === "voiceover" ? 1 : 0.65, transition: "opacity 150ms ease" }}
          >
            <MetricCard
              icon={Waves}
              label="Seslendirme"
              value={voiceoverShots.length}
              description="Diyalog disinda seslendirme metni olan shot"
              accentColor="rgba(99,102,241,0.7)"
            />
          </div>
        </section>

        {/* ── ElevenLabs uyarisi ──────────────────────────── */}
        {voiceWarning ? (
          <ProCard
            title="ElevenLabs Kurulumu Gerekli"
            subtitle="Ses eslestirme islemleri icin API anahtari sart"
            borderColor="var(--status-warning)"
          >
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {voiceWarning} Ses eslestirme alanlari bos kalabilir. Once <strong>Ayarlar</strong> ekranindan
              ElevenLabs API anahtarini ekle.
            </p>
          </ProCard>
        ) : null}

        {/* ── Ses katalogu ────────────────────────────────── */}
        {!voiceWarning ? (
          <CollapsibleSection
            title="Ses Katalogu"
            subtitle={`${catalogStats.totalCount} ses yuklendi`}
            defaultOpen={turkishVoiceCatalog.length > 0}
            headerRight={
              <button
                className="btn-secondary"
                disabled={busyKey === "shared:all" || catalogStats.missingCount === 0}
                onClick={() => void handleImportAllTurkishVoices()}
                type="button"
                style={{ fontSize: 11, padding: "5px 12px", minHeight: 30 }}
              >
                {busyKey === "shared:all" ? "Ekleniyor..." : "Tum Turkce sesleri ekle"}
              </button>
            }
          >
            <div style={{ display: "grid", gap: 14 }}>
              {/* Arama + hizli filtre */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
                  <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
                  <input
                    className="studio-field"
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="Ses ara..."
                    style={{ width: "100%", padding: "10px 12px 10px 34px", borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-base)", color: "var(--text-primary)" }}
                    type="search"
                    value={catalogQuery}
                  />
                </div>
                <SegmentGroup
                  options={[
                    { key: "all", label: "Tumu" },
                    { key: "turkish", label: "Turkce" },
                    { key: "assigned", label: "Atanmis" },
                  ]}
                  value={catalogQuickFilter}
                  onChange={setCatalogQuickFilter}
                  size="sm"
                />
                <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text-muted)" }}>
                  <span>{catalogStats.filteredCount} gorunen</span>
                  <span style={{ color: "var(--border-default)" }}>|</span>
                  <span>{catalogStats.missingCount} eksik</span>
                  <span style={{ color: "var(--border-default)" }}>|</span>
                  <span>{catalogStats.addedCount} mevcut</span>
                </div>
              </div>

              {/* Gelismis filtreler */}
              <CollapsibleSection
                title="Gelismis Filtreler"
                subtitle={
                  catalogGenderFilter !== "all" || catalogUseCaseFilter !== "all" || showOnlyFreeAllowedCatalogVoices || showOnlyFeaturedCatalogVoices || showOnlyPreviewableCatalogVoices || showOnlyMissingCatalogVoices
                    ? "Filtre aktif"
                    : ""
                }
                headerRight={
                  <Filter size={14} style={{ color: "var(--text-muted)" }} />
                }
              >
                <div style={{ display: "grid", gap: 16 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <select
                      className="studio-field"
                      onChange={(event) => setCatalogGenderFilter(event.target.value)}
                      style={compactSelectStyle}
                      value={catalogGenderFilter}
                    >
                      <option value="all">Tum cinsiyetler</option>
                      {catalogGenderOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      className="studio-field"
                      onChange={(event) => setCatalogUseCaseFilter(event.target.value)}
                      style={compactSelectStyle}
                      value={catalogUseCaseFilter}
                    >
                      <option value="all">Tum kullanim alanlari</option>
                      {catalogUseCaseOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    <ToggleSwitch
                      checked={showOnlyMissingCatalogVoices}
                      onChange={setShowOnlyMissingCatalogVoices}
                      label="Sadece eksikler"
                      description="Projede henuz olmayan sesleri goster"
                    />
                    <ToggleSwitch
                      checked={showOnlyFreeAllowedCatalogVoices}
                      onChange={setShowOnlyFreeAllowedCatalogVoices}
                      label="Sadece ucretsiz"
                      description="Ucretsiz planlarda kullanilabilir sesler"
                    />
                    <ToggleSwitch
                      checked={showOnlyFeaturedCatalogVoices}
                      onChange={setShowOnlyFeaturedCatalogVoices}
                      label="Sadece one cikan"
                      description="ElevenLabs tarafindan one cikarilmis sesler"
                    />
                    <ToggleSwitch
                      checked={showOnlyPreviewableCatalogVoices}
                      onChange={setShowOnlyPreviewableCatalogVoices}
                      label="Onizlemeli"
                      description="Dinlenebilir onizlemesi olan sesler"
                    />
                  </div>
                  <button
                    className="btn-secondary"
                    disabled={
                      catalogGenderFilter === "all" &&
                      catalogUseCaseFilter === "all" &&
                      !showOnlyFreeAllowedCatalogVoices &&
                      !showOnlyFeaturedCatalogVoices &&
                      !showOnlyPreviewableCatalogVoices &&
                      !showOnlyMissingCatalogVoices &&
                      !catalogQuery &&
                      catalogQuickFilter === "all"
                    }
                    onClick={() => {
                      setCatalogQuery("");
                      setCatalogQuickFilter("all");
                      setCatalogGenderFilter("all");
                      setCatalogUseCaseFilter("all");
                      setShowOnlyFreeAllowedCatalogVoices(false);
                      setShowOnlyFeaturedCatalogVoices(false);
                      setShowOnlyPreviewableCatalogVoices(false);
                      setShowOnlyMissingCatalogVoices(false);
                    }}
                    type="button"
                    style={{ justifySelf: "start" }}
                  >
                    Filtreleri temizle
                  </button>
                </div>
              </CollapsibleSection>

              {/* Katalog icerik durumu */}
              {catalogQuery && catalogHasMore ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Arama yuklenen sayfalarda calisiyor. Daha fazla sonuc icin asagidan yeni sayfa yukleyebilirsin.
                </p>
              ) : null}

              {sharedVoiceWarning ? (
                <p style={{ margin: 0, fontSize: 12, color: "var(--status-warning)", lineHeight: 1.6 }}>{sharedVoiceWarning}</p>
              ) : catalogLoading && turkishVoiceCatalog.length === 0 ? (
                <ProEmptyState
                  icon={RefreshCw}
                  title="Katalog yukleniyor"
                  description="Turkce ses katalogu hazirlaniyor..."
                />
              ) : turkishVoiceCatalog.length === 0 ? (
                <ProEmptyState
                  icon={AudioLines}
                  title="Katalog bos"
                  description="Turkce uyumlu paylasilan ses bulunamadi. Kendi seslerini asagidaki eslestirme panellerinde kullanabilirsin."
                />
              ) : (
                <>
                  <div style={voiceGridStyle}>
                    {filteredTurkishVoiceCatalog.map(({ voice, alreadyAdded }) => {
                      const previewPlaybackId = `catalog-preview:${voice.voiceId}`;
                      const previewPlaybackState = resolvePlaybackState(previewPlaybackId);
                      const previewStatusLabel = resolvePlaybackStatusLabel(previewPlaybackState);

                      return (
                        <article
                          key={`${voice.publicOwnerId}:${voice.voiceId}`}
                          style={{
                            ...voiceCardStyle,
                            borderColor: alreadyAdded ? "var(--status-success)" : "var(--border-subtle)",
                            opacity: alreadyAdded ? 0.7 : 1,
                          }}
                        >
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{voice.name}</strong>
                            {alreadyAdded ? (
                              <StatusDot status="success" label="Mevcut" />
                            ) : null}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {voice.turkishCompatibilityScore >= 10 ? (
                              <span style={tagStyle}>Turkce Uyumlu</span>
                            ) : voice.turkishCompatibilityScore >= 4 ? (
                              <span style={tagStyle}>Kismi Turkce</span>
                            ) : null}
                            {voice.gender ? <span style={tagStyle}>{voice.gender}</span> : null}
                            {voice.useCase ? <span style={tagStyle}>{voice.useCase}</span> : null}
                            {voice.freeUsersAllowed ? <span style={{ ...tagStyle, color: "var(--status-success)" }}>Ucretsiz</span> : null}
                            {voice.featured ? <span style={{ ...tagStyle, color: "var(--status-info)" }}>One cikan</span> : null}
                          </div>
                          <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
                            {voice.description ?? voice.descriptive ?? "Turkce akicilik icin uygun paylasilan ses."}
                          </p>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {formatCompactCount(voice.clonedByCount)} kullanici
                            {voice.verifiedLanguages.length > 0
                              ? ` · Dogrulanan: ${voice.verifiedLanguages
                                  .map((item) => item.locale ?? item.language ?? item.accent)
                                  .filter(Boolean)
                                  .join(", ")}`
                              : null}
                          </div>
                        </div>
                        <div
                          data-audio-player={previewPlaybackId}
                          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}
                        >
                          {voice.previewUrl ? (
                            <>
                              <audio
                                onEnded={(event) => handleAudioEnded(previewPlaybackId, event.currentTarget)}
                                onError={(event) => handleAudioError(previewPlaybackId, event.currentTarget)}
                                onPause={(event) => handleAudioPause(previewPlaybackId, event.currentTarget)}
                                onPlay={(event) => handleAudioPlay(previewPlaybackId, event.currentTarget)}
                                onPlaying={(event) => handleAudioPlaying(previewPlaybackId, event.currentTarget)}
                                onWaiting={(event) => handleAudioWaiting(previewPlaybackId, event.currentTarget)}
                                preload="none"
                                src={voice.previewUrl}
                                style={{ display: "none" }}
                              />
                              <button
                                aria-pressed={previewPlaybackState === "playing"}
                                className={previewPlaybackState === "playing" ? "btn-primary" : "btn-secondary"}
                                onClick={(event) =>
                                  void toggleAudioPlayback(previewPlaybackId, event.currentTarget)
                                }
                                type="button"
                                style={{ padding: "5px 10px", minHeight: 28, fontSize: 11 }}
                              >
                                {previewPlaybackState === "playing" ? (
                                  <PauseCircle size={12} />
                                ) : (
                                  <PlayCircle size={12} />
                                )}
                                {resolvePlaybackButtonLabel(previewPlaybackState)}
                              </button>
                              {previewStatusLabel ? (
                                <span style={resolvePlaybackBadgeStyle(previewPlaybackState)}>
                                  {previewStatusLabel}
                                </span>
                              ) : null}
                            </>
                          ) : null}
                          <button
                            className="btn-secondary"
                            disabled={alreadyAdded || busyKey === `shared:${voice.voiceId}`}
                            onClick={() => void handleImportSharedVoice(voice)}
                            type="button"
                            style={{ padding: "5px 10px", minHeight: 28, fontSize: 11 }}
                          >
                            {alreadyAdded ? "Projede mevcut" : "Seslerime ekle"}
                          </button>
                        </div>
                      </article>
                    );
                    })}
                  </div>
                  {catalogHasMore ? (
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <button
                        className="btn-secondary"
                        disabled={catalogLoadingMore}
                        onClick={() => void loadTurkishVoiceCatalogPage()}
                        type="button"
                      >
                        {catalogLoadingMore ? "Yukleniyor..." : "Daha fazla yukle"}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </CollapsibleSection>
        ) : null}

        {/* ── Hazir shot yok uyarisi ─────────────────────── */}
        {!voiceWarning && readyShots.length === 0 && shots.length > 0 ? (
          <ProCard
            title="Hazir Shot Yok"
            subtitle="Uretim baslayamaz"
            borderColor="var(--status-warning)"
          >
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              Toplu uretim islemi ancak konusmaci takma adi ve karakter ses eslestirmesi
              eksikleri tamamlandiginda calisir. Asagidaki eslestirme panellerini kontrol et.
            </p>
          </ProCard>
        ) : null}

        {/* ── Yukleniyor durumu ───────────────────────────── */}
        {loading ? (
          <ProEmptyState
            icon={RefreshCw}
            title="Seslendirme yukleniyor"
            description="Diyalog pipeline verileri hazirlaniyor..."
          />
        ) : (
          <>
            {/* ── Karakter ses eslestirme + Takma ad: yan yana grid ── */}
            <section style={bindingGridStyle}>
              <ProCard
                title="Karakter Ses Eslestirmesi"
                subtitle="Ses secimi degistiginde etkilenen shotlar gecersiz olur"
              >
                <div style={{ display: "grid", gap: 10 }}>
                  {characters.length === 0 ? (
                    <ProEmptyState
                      icon={UserRound}
                      title="Karakter yok"
                      description="Projede karakter kaydi bulunmuyor."
                    />
                  ) : (
                    characters.map((character) => {
                      const binding = bindingsByCharacterId.get(character.id);
                      const selectedVoice = sortedVoices.find((voice) => voice.voiceId === binding?.voiceId) ?? null;
                      const previewPlaybackId = selectedVoice
                        ? `character-preview:${character.id}:${selectedVoice.voiceId}`
                        : null;
                      const previewPlaybackState = previewPlaybackId
                        ? resolvePlaybackState(previewPlaybackId)
                        : "idle";
                      const previewStatusLabel = resolvePlaybackStatusLabel(previewPlaybackState);

                      return (
                        <div key={character.id} style={bindingRowStyle}>
                          <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <UserRound size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                              <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{character.name}</strong>
                            </div>
                            <span style={{ fontSize: 11, color: binding ? "var(--status-success)" : "var(--text-muted)" }}>
                              {binding?.voiceName ?? "Ses atanmadi"}
                            </span>
                          </div>
                          <div
                            data-audio-player={previewPlaybackId ?? undefined}
                            style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                          >
                            <select
                              className="studio-field"
                              disabled={busyKey === `voice:${character.id}`}
                              onChange={(event) =>
                                void handleVoiceBindingChange(character.id, event.target.value)
                              }
                              style={compactSelectStyle}
                              value={binding?.voiceId ?? ""}
                            >
                              <option value="">Ses sec...</option>
                              {sortedVoices.map((voice) => (
                                <option key={voice.voiceId} value={voice.voiceId}>
                                  {buildVoiceOptionLabel(voice)}
                                </option>
                              ))}
                            </select>
                            {selectedVoice?.previewUrl ? (
                              <>
                                <audio
                                  onEnded={(event) =>
                                    previewPlaybackId
                                      ? handleAudioEnded(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  onError={(event) =>
                                    previewPlaybackId
                                      ? handleAudioError(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  onPause={(event) =>
                                    previewPlaybackId
                                      ? handleAudioPause(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  onPlay={(event) =>
                                    previewPlaybackId
                                      ? handleAudioPlay(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  onPlaying={(event) =>
                                    previewPlaybackId
                                      ? handleAudioPlaying(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  onWaiting={(event) =>
                                    previewPlaybackId
                                      ? handleAudioWaiting(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  preload="none"
                                  src={selectedVoice.previewUrl}
                                  style={{ display: "none" }}
                                />
                                <button
                                  aria-pressed={previewPlaybackState === "playing"}
                                  className={previewPlaybackState === "playing" ? "btn-primary" : "btn-secondary"}
                                  onClick={(event) =>
                                    previewPlaybackId
                                      ? void toggleAudioPlayback(previewPlaybackId, event.currentTarget)
                                      : undefined
                                  }
                                  type="button"
                                  style={{ padding: "5px 10px", minHeight: 28, fontSize: 11 }}
                                >
                                  {previewPlaybackState === "playing" ? (
                                    <PauseCircle size={12} />
                                  ) : (
                                    <PlayCircle size={12} />
                                  )}
                                  {resolvePlaybackButtonLabel(previewPlaybackState)}
                                </button>
                                {previewStatusLabel ? (
                                  <span style={resolvePlaybackBadgeStyle(previewPlaybackState)}>
                                    {previewStatusLabel}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </ProCard>

              <ProCard
                title="Konusmaci Takma Adlari"
                subtitle="Konusmaci etiketlerini karaktere veya dogrudan sese bagla"
              >
                <div style={{ display: "grid", gap: 10 }}>
                  {speakerRoutes.length === 0 ? (
                    <ProEmptyState
                      icon={Mic2}
                      title="Konusmaci yok"
                      description="Diyalog shotlarinda konusmaci etiketi bulunmuyor."
                    />
                  ) : (
                    speakerRoutes.map((speaker) => (
                      <div key={speaker.speakerKey} style={bindingRowStyle}>
                        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{speaker.speakerLabel}</strong>
                            {speaker.needsAttention ? (
                              <StatusDot status="warning" />
                            ) : (
                              <StatusDot status="success" />
                            )}
                          </div>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {speaker.shotCount} satir
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <select
                            className="studio-field"
                            disabled={busyKey === `alias:${speaker.speakerKey}`}
                            onChange={(event) =>
                              void handleAliasChange(
                                speaker.speakerKey,
                                speaker.speakerLabel,
                                event.target.value,
                              )
                            }
                            style={compactSelectStyle}
                            value={aliasesBySpeakerKey.get(speaker.speakerKey)?.characterId ?? ""}
                          >
                            <option value="">Karakter sec...</option>
                            {characters.map((character) => (
                              <option key={character.id} value={character.id}>
                                {character.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="studio-field"
                            disabled={busyKey === `speaker-voice:${speaker.speakerKey}` || voices.length === 0}
                            onChange={(event) =>
                              void handleSpeakerVoiceBindingChange(
                                speaker.speakerKey,
                                speaker.speakerLabel,
                                event.target.value,
                              )
                            }
                            style={compactSelectStyle}
                            value={speakerVoiceBindingsBySpeakerKey.get(speaker.speakerKey)?.voiceId ?? ""}
                          >
                            <option value="">Dogrudan ses sec...</option>
                            {sortedVoices.map((voice) => (
                              <option key={voice.voiceId} value={voice.voiceId}>
                                {buildVoiceOptionLabel(voice)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ProCard>
            </section>

            {/* ── Diyalog shot listesi ────────────────────── */}
            <ProCard
              title="Diyalog & Seslendirme Shot Listesi"
              subtitle={
                statusFilter !== "all"
                  ? `${filteredShots.length} / ${shots.length} shot gorunuyor (filtre aktif)`
                  : `${shots.length} shot (${voiceoverShots.length} seslendirme)`
              }
              headerRight={
                statusFilter !== "all" ? (
                  <button
                    className="btn-secondary"
                    onClick={() => setStatusFilter("all")}
                    type="button"
                    style={{ fontSize: 11, padding: "5px 12px", minHeight: 28 }}
                  >
                    Filtreyi kaldir
                  </button>
                ) : null
              }
            >
              <div style={{ display: "grid", gap: 12 }}>
                {filteredShots.length === 0 ? (
                  <ProEmptyState
                    icon={CircleDot}
                    title="Shot bulunamadi"
                    description={statusFilter !== "all" ? "Bu filtreyle eslesen shot yok. Filtreyi kaldirmayi dene." : "Diyalog veya seslendirme metni bulunan shot yok."}
                    action={
                      statusFilter !== "all" ? (
                        <button
                          className="btn-secondary"
                          onClick={() => setStatusFilter("all")}
                          type="button"
                        >
                          Filtreyi kaldir
                        </button>
                      ) : undefined
                    }
                  />
                ) : (
                  filteredShots.map((detail) => {
                    const lipsync = lipSyncDetailsByShotId.get(detail.shot.id) ?? null;
                    const activeTake =
                      detail.audioTakes.find((take) => take.isMaster) ?? detail.audioTakes[0] ?? null;
                    const audioSrc = activeTake
                      ? convertFileSrc(
                          toAbsoluteProjectPath(activeProject.folderPath, activeTake.relativePath),
                        )
                      : null;
                    const historicalTakes = detail.audioTakes.filter(
                      (take) => !activeTake || take.relativePath !== activeTake.relativePath,
                    );
                    const masterPlaybackId = activeTake ? `take:${activeTake.id}` : null;
                    const masterPlaybackState = masterPlaybackId
                      ? resolvePlaybackState(masterPlaybackId)
                      : "idle";
                    const masterStatusLabel = resolvePlaybackStatusLabel(masterPlaybackState);

                    return (
                      <article
                        key={detail.shot.id}
                        style={{
                          ...shotCardStyle,
                          borderColor: detail.blockerReason
                            ? "var(--status-error)"
                            : detail.shot.audioMasterPath
                              ? "var(--status-success)"
                              : "var(--border-subtle)",
                        }}
                      >
                        <div style={{ display: "grid", gap: 12 }}>
                          {/* Shot basligi */}
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>{detail.shot.shotNumber}</strong>
                              <StatusDot
                                status={
                                  detail.shot.audioStatus === "done" ? "success"
                                    : detail.shot.audioStatus === "error" ? "error"
                                    : detail.shot.audioStatus === "blocked" ? "warning"
                                    : detail.shot.audioStatus === "queued" || detail.shot.audioStatus === "generating" ? "active"
                                    : "pending"
                                }
                                label={
                                  detail.shot.audioStatus === "done" ? "Tamamlandi"
                                    : detail.shot.audioStatus === "error" ? "Hata"
                                    : detail.shot.audioStatus === "blocked" ? "Engellendi"
                                    : detail.shot.audioStatus === "queued" ? "Kuyrukta"
                                    : detail.shot.audioStatus === "generating" ? "Uretiliyor"
                                    : "Bekliyor"
                                }
                              />
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              {detail.isVoiceover ? (
                                <span style={{ ...tagStyle, color: "rgba(99,102,241,0.85)", borderColor: "rgba(99,102,241,0.22)" }}>Seslendirme</span>
                              ) : null}
                              {detail.characterCount ? (
                                <span style={tagStyle}>{detail.characterCount} karakter</span>
                              ) : null}
                              {detail.hasDialogueOverride ? (
                                <span style={tagStyle}>Metin duzenlendi</span>
                              ) : null}
                              {detail.hasGenerationProfileOverride ? (
                                <span style={tagStyle}>Ton ayari</span>
                              ) : null}
                              {!detail.generationProfile.useOptimizer ? (
                                <span style={tagStyle}>Optimizer kapali</span>
                              ) : null}
                              {lipsync?.modelLabel ? (
                                <span style={{ ...tagStyle, color: "var(--status-info)", borderColor: "rgba(59,130,246,0.18)" }}>
                                  {lipsync.modelLabel}
                                </span>
                              ) : null}
                              {lipsync?.estimatedCostUsd ? (
                                <span style={tagStyle}>${lipsync.estimatedCostUsd.toFixed(3)}</span>
                              ) : null}
                              {lipsync?.status === "stale" ? (
                                <span style={{ ...tagStyle, color: "var(--status-warning)", borderColor: "rgba(245,158,11,0.18)" }}>
                                  Lipsync stale
                                </span>
                              ) : null}
                              {lipsync?.masterVideoPath ? (
                                <span style={{ ...tagStyle, color: "var(--status-success)", borderColor: "rgba(34,197,94,0.18)" }}>
                                  Lipsync master var
                                </span>
                              ) : null}
                              <button
                                className="btn-primary"
                                disabled={busyKey === `shot:${detail.shot.id}`}
                                onClick={() => void handleQueueSingleShot(detail.shot.id)}
                                type="button"
                                style={{ minHeight: 34 }}
                              >
                                <PlayCircle size={14} />
                                {activeTake ? "Yeniden uret" : "Uret"}
                              </button>
                              <button
                                className="btn-secondary"
                                disabled={
                                  busyKey === `lipsync:${detail.shot.id}` ||
                                  Boolean(lipsync?.blockerReasons.length)
                                }
                                onClick={() => void handleQueueSingleLipSync(detail.shot.id)}
                                type="button"
                                style={{ minHeight: 34 }}
                              >
                                <CircleDot size={14} />
                                {busyKey === `lipsync:${detail.shot.id}`
                                  ? "Kuyrukta..."
                                  : lipsync?.isStale || lipsync?.masterVideoPath
                                    ? "Lipsync yenile"
                                    : "Lipsync"}
                              </button>
                            </div>
                          </div>

                          {/* Diyalog onizleme */}
                          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                            {detail.audioDirection?.dialoguePreview ?? "Diyalog onizlemesi yok"}
                          </p>

                          {/* Engel nedeni */}
                          {detail.blockerReason ? (
                            <div style={blockerStyle}>
                              <AlertTriangle size={13} style={{ flexShrink: 0, color: "var(--status-error)" }} />
                              <span>{detail.blockerReason}</span>
                            </div>
                          ) : null}

                          {!detail.blockerReason && detail.shot.audioStatus === "error" && detail.shot.audioError ? (
                            <div style={blockerStyle}>
                              <AlertTriangle size={13} style={{ flexShrink: 0, color: "var(--status-error)" }} />
                              <span>{detail.shot.audioError}</span>
                            </div>
                          ) : null}

                          {lipsync?.blockerReasons.length ? (
                            <div style={blockerStyle}>
                              <AlertTriangle size={13} style={{ flexShrink: 0, color: "var(--status-error)" }} />
                              <span>{`Lipsync: ${lipsync.blockerReasons.join(" ")}`}</span>
                            </div>
                          ) : null}

                          {lipsync?.staleReasons.length ? (
                            <div
                              style={{
                                ...blockerStyle,
                                borderColor: "rgba(245,158,11,0.18)",
                                background: "rgba(245,158,11,0.06)",
                                color: "var(--status-warning)",
                              }}
                            >
                              <AlertTriangle size={13} style={{ flexShrink: 0, color: "var(--status-warning)" }} />
                              <span>{`Lipsync: ${lipsync.staleReasons.join(" ")}`}</span>
                            </div>
                          ) : null}

                          {lipsync?.resolvedPlan ? (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
                              {`Lipsync plani: ${lipsync.resolvedPlan.reason}`}
                            </div>
                          ) : null}

                          {/* Konusmaci cozumleme satirlari */}
                          {detail.resolvedLines.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {detail.resolvedLines.map((line, index) => (
                                <span
                                  key={`${detail.shot.id}-${line.speakerKey}-${index}`}
                                  style={{
                                    ...tagStyle,
                                    color: line.voiceId ? "var(--text-secondary)" : "var(--status-error)",
                                  }}
                                >
                                  {line.speaker} → {line.resolvedTargetLabel ?? "cozumlenmedi"} → {line.voiceName ?? line.voiceId ?? "ses eksik"}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          {/* Metin ve performans duzenleyicileri */}
                          {detail.isVoiceover ? (
                            <VoiceoverTextEditor
                              busy={busyKey === `voiceover:${detail.shot.id}`}
                              text={detail.shot.audioVoiceoverText}
                              onSave={(text) => handleVoiceoverSave(detail.shot.id, text)}
                              onClear={() => handleVoiceoverClear(detail.shot.id)}
                            />
                          ) : (
                            <DialogueTextEditor
                              busy={busyKey === `edit:${detail.shot.id}`}
                              hasOverride={detail.hasDialogueOverride}
                              lines={detail.audioDirection?.dialogueLines ?? []}
                              onClear={() => handleDialogueOverrideClear(detail.shot.id)}
                              onSave={(lines) => handleDialogueOverrideSave(detail.shot.id, lines)}
                            />
                          )}

                          <DialoguePerformanceEditor
                            busy={busyKey === `profile:${detail.shot.id}`}
                            hasOverride={detail.hasGenerationProfileOverride}
                            onClear={() => handleGenerationProfileClear(detail.shot.id)}
                            onSave={(profile) =>
                              handleGenerationProfileSave(detail.shot.id, profile)
                            }
                            profile={detail.generationProfile}
                          />

                          {/* Ses oynatici */}
                          {audioSrc ? (
                            <div style={{ display: "grid", gap: 8 }}>
                              {masterPlaybackId ? (
                                <div
                                  data-audio-player={masterPlaybackId}
                                  style={resolvePlayerSurfaceStyle(
                                    activePlaybackId === masterPlaybackId,
                                    masterPlaybackState,
                                  )}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                      <button
                                        aria-pressed={masterPlaybackState === "playing"}
                                        className={masterPlaybackState === "playing" ? "btn-primary" : "btn-secondary"}
                                        onClick={(event) =>
                                          void toggleAudioPlayback(masterPlaybackId, event.currentTarget)
                                        }
                                        type="button"
                                        style={{ minHeight: 30, padding: "4px 12px", fontSize: 11 }}
                                      >
                                        {masterPlaybackState === "playing" ? (
                                          <PauseCircle size={13} />
                                        ) : (
                                          <PlayCircle size={13} />
                                        )}
                                        {resolvePlaybackButtonLabel(masterPlaybackState)}
                                      </button>
                                      {masterStatusLabel ? (
                                        <span style={resolvePlaybackBadgeStyle(masterPlaybackState)}>
                                          {masterStatusLabel}
                                        </span>
                                      ) : null}
                                    </div>
                                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                      Ayni anda tek oynatici aktif olur
                                    </span>
                                  </div>
                                  <audio
                                    controls
                                    onEnded={(event) => handleAudioEnded(masterPlaybackId, event.currentTarget)}
                                    onError={(event) => handleAudioError(masterPlaybackId, event.currentTarget)}
                                    onPause={(event) => handleAudioPause(masterPlaybackId, event.currentTarget)}
                                    onPlay={(event) => handleAudioPlay(masterPlaybackId, event.currentTarget)}
                                    onPlaying={(event) => handleAudioPlaying(masterPlaybackId, event.currentTarget)}
                                    onWaiting={(event) => handleAudioWaiting(masterPlaybackId, event.currentTarget)}
                                    preload="metadata"
                                    src={audioSrc}
                                    style={{ width: "100%", borderRadius: 8 }}
                                  />
                                </div>
                              ) : null}
                              {activeTake ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  <span style={tagStyle}>
                                    Master {formatAudioTakeLabel(activeTake)}
                                  </span>
                                  <span style={tagStyle}>
                                    {formatAudioTakeCreatedAt(activeTake.createdAt)}
                                  </span>
                                  {activeTake.outputFormat ? (
                                    <span style={tagStyle}>{activeTake.outputFormat}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {historicalTakes.length > 0 ? (
                                <CollapsibleSection
                                  title={`Onceki kayitlar (${historicalTakes.length})`}
                                >
                                  <div style={{ display: "grid", gap: 12 }}>
                                    {historicalTakes.map((take) => {
                                      const takeSrc = convertFileSrc(
                                        toAbsoluteProjectPath(activeProject.folderPath, take.relativePath),
                                      );
                                      const takePlaybackId = `take:${take.id}`;
                                      const takePlaybackState = resolvePlaybackState(takePlaybackId);
                                      const takeStatusLabel = resolvePlaybackStatusLabel(takePlaybackState);

                                      return (
                                        <div
                                          key={take.id}
                                          style={{
                                            display: "grid",
                                            gap: 6,
                                            paddingTop: 12,
                                            borderTop: "1px solid var(--border-subtle)",
                                          }}
                                        >
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                            <span style={tagStyle}>{formatAudioTakeLabel(take)}</span>
                                            <span style={tagStyle}>
                                              {formatAudioTakeCreatedAt(take.createdAt)}
                                            </span>
                                            {take.outputFormat ? (
                                              <span style={tagStyle}>{take.outputFormat}</span>
                                            ) : null}
                                          </div>
                                          <div
                                            data-audio-player={takePlaybackId}
                                            style={resolvePlayerSurfaceStyle(
                                              activePlaybackId === takePlaybackId,
                                              takePlaybackState,
                                            )}
                                          >
                                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                              <button
                                                aria-pressed={takePlaybackState === "playing"}
                                                className={takePlaybackState === "playing" ? "btn-primary" : "btn-secondary"}
                                                onClick={(event) =>
                                                  void toggleAudioPlayback(takePlaybackId, event.currentTarget)
                                                }
                                                type="button"
                                                style={{ minHeight: 30, padding: "4px 12px", fontSize: 11 }}
                                              >
                                                {takePlaybackState === "playing" ? (
                                                  <PauseCircle size={13} />
                                                ) : (
                                                  <PlayCircle size={13} />
                                                )}
                                                {resolvePlaybackButtonLabel(takePlaybackState)}
                                              </button>
                                              {takeStatusLabel ? (
                                                <span style={resolvePlaybackBadgeStyle(takePlaybackState)}>
                                                  {takeStatusLabel}
                                                </span>
                                              ) : null}
                                            </div>
                                            <audio
                                              controls
                                              onEnded={(event) => handleAudioEnded(takePlaybackId, event.currentTarget)}
                                              onError={(event) => handleAudioError(takePlaybackId, event.currentTarget)}
                                              onPause={(event) => handleAudioPause(takePlaybackId, event.currentTarget)}
                                              onPlay={(event) => handleAudioPlay(takePlaybackId, event.currentTarget)}
                                              onPlaying={(event) => handleAudioPlaying(takePlaybackId, event.currentTarget)}
                                              onWaiting={(event) => handleAudioWaiting(takePlaybackId, event.currentTarget)}
                                              preload="metadata"
                                              src={takeSrc}
                                              style={{ width: "100%", borderRadius: 8 }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </CollapsibleSection>
                              ) : null}
                            </div>
                          ) : (
                            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                              Master ses dosyasi henuz uretilmedi.
                            </p>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </ProCard>

            {/* ── Seslendirme ekle (diyalogsuz shotlar) ──── */}
            {shotsWithoutAudio.length > 0 ? (
              <CollapsibleSection
                title={`Seslendirme eklenebilir shot'lar (${shotsWithoutAudio.length})`}
              >
                <div style={{ display: "grid", gap: 8 }}>
                  {shotsWithoutAudio.map((shot) => (
                    <div
                      key={shot.id}
                      style={{
                        display: "grid",
                        gap: 8,
                        padding: "10px 14px",
                        borderRadius: 12,
                        border: "1px solid var(--border-subtle)",
                        background: "var(--surface-card)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                          <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>
                            {shot.shotNumber}
                          </strong>
                          {shot.summaryTr ? (
                            <span style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {shot.summaryTr.slice(0, 100)}
                            </span>
                          ) : null}
                        </div>
                        {addVoiceoverShotId !== shot.id ? (
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              setAddVoiceoverShotId(shot.id);
                              setAddVoiceoverDraft("");
                            }}
                            type="button"
                            style={{ flexShrink: 0, fontSize: 11, minHeight: 30, padding: "4px 12px" }}
                          >
                            <Waves size={13} />
                            Seslendirme ekle
                          </button>
                        ) : null}
                      </div>
                      {addVoiceoverShotId === shot.id ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <textarea
                            autoFocus
                            onChange={(e) => setAddVoiceoverDraft(e.target.value)}
                            placeholder="Seslendirme metnini buraya yaz..."
                            rows={3}
                            style={{
                              width: "100%",
                              resize: "vertical",
                              borderRadius: 12,
                              border: "1px solid var(--border-default)",
                              background: "var(--surface-hover)",
                              padding: "10px 12px",
                              font: "inherit",
                              fontSize: 13,
                              lineHeight: 1.6,
                              color: "var(--text-primary)",
                            }}
                            value={addVoiceoverDraft}
                          />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn-primary"
                              disabled={!addVoiceoverDraft.trim() || busyKey === `voiceover:${shot.id}`}
                              onClick={async () => {
                                await handleVoiceoverSave(shot.id, addVoiceoverDraft);
                                setAddVoiceoverShotId(null);
                                setAddVoiceoverDraft("");
                              }}
                              type="button"
                              style={{ fontSize: 11, minHeight: 30, padding: "4px 12px" }}
                            >
                              <Save size={13} />
                              Kaydet
                            </button>
                            <button
                              className="btn-secondary"
                              onClick={() => {
                                setAddVoiceoverShotId(null);
                                setAddVoiceoverDraft("");
                              }}
                              type="button"
                              style={{ fontSize: 11, minHeight: 30, padding: "4px 12px" }}
                            >
                              Vazgec
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

/* ═══════════ STIL SABITLERI ═══════════ */

const screenStyle = {
  display: "grid",
  gap: 20,
} satisfies CSSProperties;

const metricsGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
} satisfies CSSProperties;

const bindingGridStyle = {
  display: "grid",
  gap: 18,
  gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
} satisfies CSSProperties;

const voiceGridStyle = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
} satisfies CSSProperties;

const voiceCardStyle = {
  display: "grid",
  gap: 8,
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-card)",
  transition: "border-color 150ms ease, opacity 150ms ease",
} satisfies CSSProperties;

const bindingRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-card)",
  flexWrap: "wrap",
} satisfies CSSProperties;

const compactSelectStyle = {
  minWidth: 180,
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  fontSize: 12,
} satisfies CSSProperties;

const shotCardStyle = {
  display: "grid",
  gap: 12,
  padding: "16px 18px",
  borderRadius: 16,
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-card)",
  transition: "border-color 150ms ease",
} satisfies CSSProperties;

const tagStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 8px",
  borderRadius: 6,
  background: "var(--surface-hover)",
  fontSize: 10,
  fontWeight: 500 as const,
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
} satisfies CSSProperties;

const blockerStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--status-error) 20%, transparent)",
  background: "color-mix(in srgb, var(--status-error) 5%, transparent)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.6,
} satisfies CSSProperties;

