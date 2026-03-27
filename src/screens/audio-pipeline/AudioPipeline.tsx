import { startTransition, type CSSProperties, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import {
  AudioLines,
  Mic2,
  PlayCircle,
  RefreshCw,
  Sparkles,
  UserRound,
  Waves,
} from "lucide-react";
import { listCharacters, type CharacterRecord } from "@/services/character.service";
import { DialogueTextEditor } from "@/components/audio/DialogueTextEditor";
import { DialoguePerformanceEditor } from "@/components/audio/DialoguePerformanceEditor";
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
} from "@/services/jobqueue.service";
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

function statusColor(status: string): string {
  if (status === "done") {
    return "var(--status-success)";
  }

  if (status === "error") {
    return "var(--status-error)";
  }

  if (status === "blocked") {
    return "var(--text-primary)";
  }

  if (status === "queued" || status === "generating") {
    return "rgba(147,197,253,0.95)";
  }

  return "var(--text-muted)";
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
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [turkishVoiceCatalog, setTurkishVoiceCatalog] = useState<ElevenLabsSharedVoice[]>([]);
  const [voiceBindings, setVoiceBindings] = useState<CharacterVoiceBindingRecord[]>([]);
  const [speakerAliases, setSpeakerAliases] = useState<AudioSpeakerAliasRecord[]>([]);
  const [speakerVoiceBindings, setSpeakerVoiceBindings] = useState<AudioSpeakerVoiceBindingRecord[]>([]);
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

  async function loadScreenData(showSpinner = true) {
    if (!activeProject) {
      setShots([]);
      setCharacters([]);
      setVoices([]);
      setTurkishVoiceCatalog([]);
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
      const [nextShots, nextCharacters, nextBindings, nextAliases, nextSpeakerVoiceBindings] = await Promise.all([
        listDialogueAudioShots(activeProject.id),
        listCharacters(),
        listCharacterVoiceBindings(),
        listAudioSpeakerAliases(),
        listAudioSpeakerVoiceBindings(),
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
      setCharacters(nextCharacters.filter((character) => character.projectId === activeProject.id));
      setVoices(nextVoices);
      setVoiceBindings(nextBindings);
      setSpeakerAliases(nextAliases);
      setSpeakerVoiceBindings(nextSpeakerVoiceBindings);
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

  const readyShots = shots.filter((shot) => shot.isReady);
  const missingMasters = readyShots.filter((shot) => !shot.shot.audioMasterPath);
  const blockedShots = shots.filter((shot) => Boolean(shot.blockerReason));

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
        <section style={emptyStateStyle}>
          <AudioLines size={28} />
          <div style={{ fontSize: 22, fontWeight: 600 }}>Seslendirme</div>
          <p style={emptyCopyStyle}>Bu paneli kullanmak icin once bir proje ac.</p>
        </section>
      </section>
    );
  }

  return (
    <section className="screen-shell">
      <section style={screenStyle}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <Mic2 size={13} />
              Professional dialogue audio
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Seslendirme
            </div>
            <p style={heroCopyStyle}>
              Speaker-tagged transcript, karakter voice binding, alias mapping ve bulk queue
              akislarini bu panelden yonet. Pipeline ElevenLabs `eleven_v3` ile once
              `wav_44100` dener; plan izin vermiyorsa otomatik `mp3_44100_128` fallback kullanir.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              className="btn-secondary"
              disabled={refreshing || catalogLoading}
              onClick={() => void handleRefresh()}
              type="button"
            >
              <RefreshCw size={14} />
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
              Tum ready shotlari queue'la
            </button>
          </div>
        </header>

        <section style={summaryGridStyle}>
          <SummaryCard label="Dialogue shot" value={String(shots.length)} detail="Parse edilen toplam diyalog shot" />
          <SummaryCard label="Ready" value={String(readyShots.length)} detail="Voice ve alias blocker'i yok" />
          <SummaryCard label="Blocked" value={String(blockedShots.length)} detail="Speaker, alias veya voice mapping bekliyor" />
          <SummaryCard label="Missing WAV" value={String(missingMasters.length)} detail="Hazir ama master dosyasi eksik" />
        </section>

        {voiceWarning ? (
          <section style={warningBannerStyle}>
            <strong style={{ color: "var(--text-primary)" }}>ElevenLabs setup gerekli</strong>
            <span style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {voiceWarning} Voice binding dropdown'lari bos kalabilir; once Ayarlar ekranindan
              ElevenLabs API key ekle.
            </span>
          </section>
        ) : null}

        {!voiceWarning ? (
          <article style={panelStyle}>
            <SectionHeader
              title="Turkce Voice Katalogu"
              copy="Bu panel Voice Library icindeki Turkce-trained, Turkce aksanli veya Turkce locale dogrulanmis tum uygun sesleri toplar. Istersen tek tek, istersen topluca My Voices listene ekleyebilirsin."
            />
            <div style={catalogToolbarStyle}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <span style={metaPillStyle}>{catalogStats.totalCount} yuklenen voice</span>
                <span style={metaPillStyle}>{catalogStats.filteredCount} gorunen</span>
                <span style={metaPillStyle}>{catalogStats.missingCount} eksik</span>
                <span style={metaPillStyle}>{catalogStats.addedCount} projede var</span>
                {catalogHasMore ? <span style={metaPillStyle}>daha fazla var</span> : null}
              </div>
              <div style={toolbarActionsStyle}>
                <input
                  className="studio-field"
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Turkce voice ara"
                  style={catalogSearchStyle}
                  type="search"
                  value={catalogQuery}
                />
                <label style={checkboxLabelStyle}>
                  <input
                    checked={showOnlyMissingCatalogVoices}
                    onChange={(event) => setShowOnlyMissingCatalogVoices(event.target.checked)}
                    type="checkbox"
                  />
                  Sadece eksikler
                </label>
                <button
                  className="btn-secondary"
                  disabled={busyKey === "shared:all" || catalogStats.missingCount === 0}
                  onClick={() => void handleImportAllTurkishVoices()}
                  type="button"
                >
                  {busyKey === "shared:all" ? "Ekleniyor..." : "Tum Turkce sesleri ekle"}
                </button>
              </div>
            </div>
            <div style={catalogFiltersStyle}>
              <select
                className="studio-field"
                onChange={(event) => setCatalogGenderFilter(event.target.value)}
                style={catalogFilterSelectStyle}
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
                style={catalogFilterSelectStyle}
                value={catalogUseCaseFilter}
              >
                <option value="all">Tum use case'ler</option>
                {catalogUseCaseOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <label style={checkboxLabelStyle}>
                <input
                  checked={showOnlyFreeAllowedCatalogVoices}
                  onChange={(event) => setShowOnlyFreeAllowedCatalogVoices(event.target.checked)}
                  type="checkbox"
                />
                Sadece free allowed
              </label>
              <label style={checkboxLabelStyle}>
                <input
                  checked={showOnlyFeaturedCatalogVoices}
                  onChange={(event) => setShowOnlyFeaturedCatalogVoices(event.target.checked)}
                  type="checkbox"
                />
                Sadece featured
              </label>
              <label style={checkboxLabelStyle}>
                <input
                  checked={showOnlyPreviewableCatalogVoices}
                  onChange={(event) => setShowOnlyPreviewableCatalogVoices(event.target.checked)}
                  type="checkbox"
                />
                Preview'li
              </label>
              <button
                className="btn-secondary"
                disabled={
                  catalogGenderFilter === "all" &&
                  catalogUseCaseFilter === "all" &&
                  !showOnlyFreeAllowedCatalogVoices &&
                  !showOnlyFeaturedCatalogVoices &&
                  !showOnlyPreviewableCatalogVoices &&
                  !showOnlyMissingCatalogVoices &&
                  !catalogQuery
                }
                onClick={() => {
                  setCatalogQuery("");
                  setCatalogGenderFilter("all");
                  setCatalogUseCaseFilter("all");
                  setShowOnlyFreeAllowedCatalogVoices(false);
                  setShowOnlyFeaturedCatalogVoices(false);
                  setShowOnlyPreviewableCatalogVoices(false);
                  setShowOnlyMissingCatalogVoices(false);
                }}
                type="button"
              >
                Filtreleri temizle
              </button>
            </div>
            {catalogQuery && catalogHasMore ? (
              <div style={mutedStateStyle}>
                Arama su an yuklenen sayfalarda calisiyor. Daha fazla sonuc icin asagidan yeni sayfa yukleyebilirsin.
              </div>
            ) : null}
            {sharedVoiceWarning ? (
              <div style={mutedStateStyle}>{sharedVoiceWarning}</div>
            ) : catalogLoading && turkishVoiceCatalog.length === 0 ? (
              <div style={mutedStateStyle}>Turkce voice katalogu yukleniyor...</div>
            ) : turkishVoiceCatalog.length === 0 ? (
              <div style={mutedStateStyle}>
                Turkce uyumlu shared voice bulunamadi. Kendi Turkce voice'un varsa asagidaki dropdown'larda yine kullanabilirsin.
              </div>
            ) : (
              <>
              <div style={sharedVoiceGridStyle}>
                {filteredTurkishVoiceCatalog.map(({ voice, alreadyAdded }) => {
                  return (
                    <article key={`${voice.publicOwnerId}:${voice.voiceId}`} style={sharedVoiceCardStyle}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <strong>{voice.name}</strong>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          <span style={metaPillStyle}>TR score {voice.turkishCompatibilityScore}</span>
                          {voice.language ? <span style={metaPillStyle}>{voice.language}</span> : null}
                          {voice.locale ? <span style={metaPillStyle}>{voice.locale}</span> : null}
                          {voice.accent ? <span style={metaPillStyle}>{voice.accent}</span> : null}
                          {voice.gender ? <span style={metaPillStyle}>{voice.gender}</span> : null}
                          {voice.useCase ? <span style={metaPillStyle}>{voice.useCase}</span> : null}
                          {voice.freeUsersAllowed ? <span style={metaPillStyle}>free allowed</span> : null}
                          {voice.featured ? <span style={metaPillStyle}>featured</span> : null}
                        </div>
                        <span style={metaCopyStyle}>
                          {voice.description ?? voice.descriptive ?? "Turkce akicilik icin one cikan paylasilan ses."}
                        </span>
                        <span style={metaCopyStyle}>
                          {formatCompactCount(voice.clonedByCount)} kullanici eklemis • {formatCompactCount(voice.playApiUsageCharacterCount1y)} API char/1y
                        </span>
                        <span style={metaCopyStyle}>
                          {voice.verifiedLanguages.length > 0
                            ? `Dogrulanmis diller: ${voice.verifiedLanguages
                                .map((item) => item.locale ?? item.language ?? item.accent)
                                .filter(Boolean)
                                .join(", ")}`
                            : "Ek verified language verisi yok."}
                        </span>
                      </div>
                      <div style={rowActionsStyle}>
                        {voice.previewUrl ? (
                          <audio controls src={voice.previewUrl} style={{ width: 220 }} />
                        ) : null}
                        <button
                          className="btn-secondary"
                          disabled={alreadyAdded || busyKey === `shared:${voice.voiceId}`}
                          onClick={() => void handleImportSharedVoice(voice)}
                          type="button"
                        >
                          {alreadyAdded ? "Projede var" : "My Voices'a ekle"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {catalogHasMore ? (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
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
          </article>
        ) : null}

        {!voiceWarning && readyShots.length === 0 && shots.length > 0 ? (
          <section style={warningBannerStyle}>
            <strong style={{ color: "var(--text-primary)" }}>Ready shot yok</strong>
            <span style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Generate ve bulk queue islemleri ancak speaker alias ve karakter voice binding
              eksikleri kapandiginda ilerler. Asagidaki blocker kartlarini tamamla.
            </span>
          </section>
        ) : null}

        {loading ? (
          <section style={emptyStateStyle}>
            <RefreshCw className="spin-slow" size={28} />
            <div style={{ fontSize: 18, fontWeight: 600 }}>Audio pipeline yukleniyor</div>
          </section>
        ) : (
          <>
            <section style={layoutGridStyle}>
              <article style={panelStyle}>
                <SectionHeader
                  title="Karakter Voice Binding"
                  copy="Karakter bazli voice secimi degistiginde etkilenen shot masterlari invalid edilir."
                />
                <div style={{ display: "grid", gap: 12 }}>
                  {characters.length === 0 ? (
                    <div style={mutedStateStyle}>Projede karakter kaydi bulunmuyor.</div>
                  ) : (
                    characters.map((character) => {
                      const binding = bindingsByCharacterId.get(character.id);
                      const selectedVoice = sortedVoices.find((voice) => voice.voiceId === binding?.voiceId) ?? null;

                      return (
                        <div key={character.id} style={rowCardStyle}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <UserRound size={14} />
                              <strong>{character.name}</strong>
                            </div>
                            <span style={metaCopyStyle}>
                              {binding?.voiceName ?? "Voice baglanmadi"}
                            </span>
                          </div>
                          <div style={rowActionsStyle}>
                            <select
                              className="studio-field"
                              disabled={busyKey === `voice:${character.id}`}
                              onChange={(event) =>
                                void handleVoiceBindingChange(character.id, event.target.value)
                              }
                            style={compactSelectStyle}
                            value={binding?.voiceId ?? ""}
                          >
                              <option value="">Voice sec</option>
                              {sortedVoices.map((voice) => (
                                <option key={voice.voiceId} value={voice.voiceId}>
                                  {buildVoiceOptionLabel(voice)}
                                </option>
                              ))}
                            </select>
                            {selectedVoice?.previewUrl ? (
                              <audio controls src={selectedVoice.previewUrl} style={{ width: 220 }} />
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </article>

              <article style={panelStyle}>
                <SectionHeader
                  title="Speaker Routing"
                  copy="Speaker etiketlerini istersen karaktere, istersen dogrudan bir ElevenLabs voice'una bagla."
                />
                <div style={{ display: "grid", gap: 12 }}>
                  {speakerRoutes.length === 0 ? (
                    <div style={mutedStateStyle}>Dialogue shot'larda speaker etiketi bulunmuyor.</div>
                  ) : (
                    speakerRoutes.map((speaker) => (
                      <div key={speaker.speakerKey} style={rowCardStyle}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <strong>{speaker.speakerLabel}</strong>
                          <span style={metaCopyStyle}>
                            {speaker.shotCount} line {speaker.needsAttention ? "attention gerekiyor" : "hazir"}
                          </span>
                        </div>
                        <div style={rowActionsStyle}>
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
                            <option value="">Karakter sec</option>
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
                            <option value="">Direkt voice sec</option>
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
              </article>
            </section>

            <article style={panelStyle}>
              <SectionHeader
                title="Dialogue Shot Listesi"
                copy="Shot blocker nedeni, speaker cozumleme durumu ve uretilmis master WAV bu listede gorunur."
              />
              <div style={{ display: "grid", gap: 12 }}>
                {shots.length === 0 ? (
                  <div style={mutedStateStyle}>Dialogue transcript bulunan shot yok.</div>
                ) : (
                  shots.map((detail) => {
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

                    return (
                      <article key={detail.shot.id} style={shotCardStyle}>
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                                <strong style={{ fontSize: 16 }}>{detail.shot.shotNumber}</strong>
                                <span style={{ ...statusPillStyle, color: statusColor(detail.shot.audioStatus) }}>
                                  {detail.shot.audioStatus}
                                </span>
                              </div>
                              <span style={metaCopyStyle}>
                                {detail.audioDirection?.dialoguePreview ?? "Dialogue preview yok"}
                              </span>
                            </div>

                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              {detail.characterCount ? (
                                <span style={metaPillStyle}>{detail.characterCount} chars</span>
                              ) : null}
                              {detail.hasDialogueOverride ? (
                                <span style={metaPillStyle}>edited text</span>
                              ) : null}
                              {detail.hasGenerationProfileOverride ? (
                                <span style={metaPillStyle}>tone override</span>
                              ) : null}
                              {!detail.generationProfile.useOptimizer ? (
                                <span style={metaPillStyle}>optimizer off</span>
                              ) : null}
                              <button
                                className="btn-primary"
                                disabled={busyKey === `shot:${detail.shot.id}`}
                                onClick={() => void handleQueueSingleShot(detail.shot.id)}
                                type="button"
                              >
                                <PlayCircle size={14} />
                                {activeTake ? "Regenerate" : "Generate"}
                              </button>
                            </div>
                          </div>

                          {detail.blockerReason ? (
                            <div style={blockerStyle}>{detail.blockerReason}</div>
                          ) : null}

                          {detail.resolvedLines.length > 0 ? (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {detail.resolvedLines.map((line, index) => (
                                <span key={`${detail.shot.id}-${line.speakerKey}-${index}`} style={metaPillStyle}>
                                  {line.speaker} {"->"} {line.resolvedTargetLabel ?? "unresolved"} {"->"} {line.voiceName ?? line.voiceId ?? "voice missing"}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <DialogueTextEditor
                            busy={busyKey === `edit:${detail.shot.id}`}
                            hasOverride={detail.hasDialogueOverride}
                            lines={detail.audioDirection?.dialogueLines ?? []}
                            onClear={() => handleDialogueOverrideClear(detail.shot.id)}
                            onSave={(lines) => handleDialogueOverrideSave(detail.shot.id, lines)}
                          />

                          <DialoguePerformanceEditor
                            busy={busyKey === `profile:${detail.shot.id}`}
                            hasOverride={detail.hasGenerationProfileOverride}
                            onClear={() => handleGenerationProfileClear(detail.shot.id)}
                            onSave={(profile) =>
                              handleGenerationProfileSave(detail.shot.id, profile)
                            }
                            profile={detail.generationProfile}
                          />

                          {audioSrc ? (
                            <div style={{ display: "grid", gap: 10 }}>
                              <audio controls src={audioSrc} style={{ width: "100%" }} />
                              {activeTake ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  <span style={metaPillStyle}>
                                    master {formatAudioTakeLabel(activeTake)}
                                  </span>
                                  <span style={metaPillStyle}>
                                    {formatAudioTakeCreatedAt(activeTake.createdAt)}
                                  </span>
                                  {activeTake.outputFormat ? (
                                    <span style={metaPillStyle}>{activeTake.outputFormat}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {historicalTakes.length > 0 ? (
                                <details
                                  style={{
                                    borderRadius: 16,
                                    border: "1px solid var(--border-subtle)",
                                    background: "rgba(0,0,0,0.02)",
                                    padding: "10px 12px",
                                  }}
                                >
                                  <summary
                                    style={{
                                      cursor: "pointer",
                                      color: "var(--text-secondary)",
                                      fontSize: 12,
                                    }}
                                  >
                                    Onceki take&apos;ler ({historicalTakes.length})
                                  </summary>
                                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                                    {historicalTakes.map((take) => {
                                      const takeSrc = convertFileSrc(
                                        toAbsoluteProjectPath(activeProject.folderPath, take.relativePath),
                                      );

                                      return (
                                        <div
                                          key={take.id}
                                          style={{
                                            display: "grid",
                                            gap: 8,
                                            paddingTop: 12,
                                            borderTop: "1px solid var(--border-subtle)",
                                          }}
                                        >
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                            <span style={metaPillStyle}>{formatAudioTakeLabel(take)}</span>
                                            <span style={metaPillStyle}>
                                              {formatAudioTakeCreatedAt(take.createdAt)}
                                            </span>
                                            {take.outputFormat ? (
                                              <span style={metaPillStyle}>{take.outputFormat}</span>
                                            ) : null}
                                          </div>
                                          <audio controls src={takeSrc} style={{ width: "100%" }} />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              ) : null}
                            </div>
                          ) : (
                            <div style={mutedStateStyle}>Master WAV henuz uretilmedi.</div>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </article>
          </>
        )}
      </section>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article style={summaryCardStyle}>
      <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
        {label}
      </span>
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.04em" }}>{value}</div>
      <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 }}>{detail}</p>
    </article>
  );
}

function SectionHeader({ title, copy }: { title: string; copy: string }) {
  return (
    <header style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
      <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 }}>{copy}</p>
    </header>
  );
}

const screenStyle = {
  display: "grid",
  gap: 18,
} satisfies CSSProperties;

const heroStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  padding: 22,
  borderRadius: 26,
  border: "1px solid var(--border-subtle)",
  background:
    "linear-gradient(140deg, rgba(59,130,246,0.06), transparent 36%), var(--bg-surface)",
  flexWrap: "wrap",
} satisfies CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  borderRadius: 999,
  border: "1px solid rgba(59,130,246,0.22)",
  background: "rgba(59,130,246,0.08)",
  padding: "6px 10px",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(147,197,253,0.95)",
} satisfies CSSProperties;

const heroCopyStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies CSSProperties;

const summaryGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
} satisfies CSSProperties;

const warningBannerStyle = {
  display: "grid",
  gap: 6,
  padding: "14px 16px",
  borderRadius: 18,
  border: "1px solid rgba(245,158,11,0.18)",
  background: "rgba(245,158,11,0.08)",
} satisfies CSSProperties;

const summaryCardStyle = {
  display: "grid",
  gap: 8,
  padding: 18,
  borderRadius: 20,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies CSSProperties;

const layoutGridStyle = {
  display: "grid",
  gap: 18,
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
} satisfies CSSProperties;

const panelStyle = {
  display: "grid",
  gap: 14,
  padding: 20,
  borderRadius: 24,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies CSSProperties;

const sharedVoiceGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
} satisfies CSSProperties;

const sharedVoiceCardStyle = {
  display: "grid",
  gap: 12,
  padding: "16px 18px",
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies CSSProperties;

const catalogToolbarStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
} satisfies CSSProperties;

const catalogFiltersStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
} satisfies CSSProperties;

const toolbarActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
} satisfies CSSProperties;

const catalogSearchStyle = {
  minWidth: 220,
  padding: "10px 12px",
  borderRadius: 14,
} satisfies CSSProperties;

const catalogFilterSelectStyle = {
  minWidth: 170,
  padding: "10px 12px",
  borderRadius: 14,
} satisfies CSSProperties;

const checkboxLabelStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "var(--text-secondary)",
  fontSize: 12,
} satisfies CSSProperties;

const rowCardStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  padding: "14px 16px",
  borderRadius: 18,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  flexWrap: "wrap",
} satisfies CSSProperties;

const rowActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
} satisfies CSSProperties;

const compactSelectStyle = {
  minWidth: 220,
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
} satisfies CSSProperties;

const metaCopyStyle = {
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.6,
} satisfies CSSProperties;

const mutedStateStyle = {
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.6,
} satisfies CSSProperties;

const shotCardStyle = {
  display: "grid",
  gap: 12,
  padding: "16px 18px",
  borderRadius: 20,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies CSSProperties;

const statusPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  padding: "5px 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(0,0,0,0.03)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies CSSProperties;

const metaPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.08)",
  background: "rgba(0,0,0,0.03)",
  fontSize: 11,
  color: "var(--text-secondary)",
} satisfies CSSProperties;

const blockerStyle = {
  padding: "10px 12px",
  borderRadius: 14,
  border: "1px solid rgba(0,0,0,0.1)",
  background: "rgba(0,0,0,0.03)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.6,
} satisfies CSSProperties;

const emptyStateStyle = {
  display: "grid",
  placeItems: "center",
  gap: 12,
  minHeight: 320,
  borderRadius: 24,
  border: "1px dashed var(--border-default)",
  background: "var(--bg-surface)",
  color: "var(--text-muted)",
  textAlign: "center",
  padding: 24,
} satisfies CSSProperties;

const emptyCopyStyle = {
  margin: 0,
  maxWidth: 420,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies CSSProperties;
