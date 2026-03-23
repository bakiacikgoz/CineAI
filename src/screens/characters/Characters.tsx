import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import {
  Link2,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  EMPTY_CHARACTER_LOOK_ATTRIBUTES,
  EMPTY_CHARACTER_PROFILE,
  buildCharacterGenerationPrompt,
  summarizeCharacterProfile,
  type CharacterLookAttributes,
  type CharacterProfile,
} from "@/lib/character-studio";
import {
  CharacterStudioModal,
  toProjectAssetUrl,
  CANDIDATE_ASPECT_RATIOS,
  type StudioLookDraft,
  type CharacterStudioDraft,
  type CandidateAsset,
} from "./CharacterStudioModal";
import { enqueueImageJobs } from "@/services/jobqueue.service";
import {
  appendCharacterLookReference,
  assignCharacterLookToShot,
  buildCharacterCandidateTags,
  createCharacter,
  deleteCharacter,
  getCharacterDeletionImpact,
  importCharacterReferenceFiles,
  listCharacterCandidateAssets,
  listCharacters,
  removeLookReference,
  reorderLookReference,
  setCharacterLookPrimaryImage,
  updateCharacter,
  type CharacterLookInput,
  type CharacterRecord,
  type CharacterStudioInput,
} from "@/services/character.service";
import { getShots, type ShotRow } from "@/services/import.service";
import { deleteAssetRecord } from "@/services/asset.service";
import { Portal } from "@/components/Portal";
import { useProjectStore } from "@/store/project.store";
import { useQueueStore } from "@/store/queue.store";
import {
  useScreenStateStore,
  type CharactersScreenState,
} from "@/store/screen-state.store";


function createEmptyLook(name = "Default Look"): StudioLookDraft {
  return {
    id: crypto.randomUUID(),
    name,
    attributes: { ...EMPTY_CHARACTER_LOOK_ATTRIBUTES },
    generationPrompt: "",
    promptLocked: false,
    refImages: [],
    primaryImage: null,
  };
}

function createEmptyDraft(): CharacterStudioDraft {
  const firstLook = createEmptyLook();
  return {
    id: null,
    name: "",
    description: "",
    klingElementId: "",
    profile: { ...EMPTY_CHARACTER_PROFILE },
    looks: [firstLook],
    defaultLookId: firstLook.id,
  };
}

function toStudioDraft(character: CharacterRecord): CharacterStudioDraft {
  return {
    id: character.id,
    name: character.name,
    description: character.description ?? "",
    klingElementId: character.klingElementId ?? "",
    profile: { ...character.profile },
    looks: character.looks.map((look) => ({
      id: look.id,
      name: look.name,
      attributes: { ...look.attributes },
      generationPrompt: look.generationPrompt,
      promptLocked: look.promptLocked,
      refImages: look.refImages.slice(),
      primaryImage: look.primaryImage,
    })),
    defaultLookId: character.defaultLookId ?? character.looks[0]?.id ?? null,
  };
}

function toCharacterStudioInput(draft: CharacterStudioDraft): CharacterStudioInput {
  return {
    name: draft.name,
    description: draft.description,
    klingElementId: draft.klingElementId,
    profile: draft.profile,
    defaultLookId: draft.defaultLookId,
    looks: draft.looks.map<CharacterLookInput>((look) => ({
      id: look.id,
      name: look.name,
      attributes: look.attributes,
      generationPrompt: look.generationPrompt,
      promptLocked: look.promptLocked,
      refImages: look.refImages,
      primaryImage: look.primaryImage,
      isDefault: look.id === draft.defaultLookId,
    })),
  };
}

function buildCharacterUpdateInput(
  character: CharacterRecord,
  looks: CharacterLookInput[],
): CharacterStudioInput {
  return {
    name: character.name,
    description: character.description,
    klingElementId: character.klingElementId,
    profile: character.profile,
    promptHint: character.promptHint,
    defaultLookId: character.defaultLookId,
    styleNotes: character.styleNotes,
    looks,
  };
}

function inferCharacterNameFromPath(sourcePath: string): string {
  const fileName = sourcePath.split(/[\\/]/).pop() ?? "character";
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "Imported Character";
  }

  return normalized
    .split(" ")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function buildImportedCharacterDraft(
  name: string,
  importedPaths: string[],
): CharacterStudioDraft {
  const firstLook = createEmptyLook("Default Look");
  firstLook.refImages = importedPaths;
  firstLook.primaryImage = importedPaths[0] ?? null;

  return {
    id: null,
    name,
    description: "",
    klingElementId: "",
    profile: { ...EMPTY_CHARACTER_PROFILE },
    looks: [firstLook],
    defaultLookId: firstLook.id,
  };
}

function hasFilledRecordValues<T extends object>(record: T): boolean {
  return Object.values(record).some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function hasMeaningfulLookDraft(look: StudioLookDraft, index: number): boolean {
  const defaultName = index === 0 ? "Default Look" : `Look ${index + 1}`;

  return (
    look.name.trim() !== defaultName ||
    look.generationPrompt.trim().length > 0 ||
    look.promptLocked ||
    look.refImages.length > 0 ||
    Boolean(look.primaryImage) ||
    hasFilledRecordValues(look.attributes)
  );
}

function hasMeaningfulCharacterDraft(draft: CharacterStudioDraft): boolean {
  return (
    Boolean(draft.id) ||
    draft.name.trim().length > 0 ||
    draft.description.trim().length > 0 ||
    draft.klingElementId.trim().length > 0 ||
    hasFilledRecordValues(draft.profile) ||
    draft.looks.length !== 1 ||
    draft.looks.some((look, index) => hasMeaningfulLookDraft(look, index))
  );
}

const DEFAULT_CHARACTERS_SCREEN_STATE: CharactersScreenState = {
  search: "",
  showStudio: false,
  draft: null,
  activeLookId: null,
  candidateAspectRatio: "3:4",
  candidateQuantity: 4,
  selectedCharacterId: null,
  showAssignModal: false,
  assignShotId: "",
  assignLookId: "",
  assignIncludePrompt: true,
  studioTab: "profile",
};


export function Characters() {
  const activeProject = useProjectStore((state) => state.activeProject);
  const queueJobs = useQueueStore((state) => state.jobs);
  const activeProjectId = activeProject?.id ?? null;
  const setCharactersState = useScreenStateStore((state) => state.setCharactersState);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [shots, setShots] = useState<ShotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showStudio, setShowStudio] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterRecord | null>(null);
  const [draft, setDraft] = useState<CharacterStudioDraft>(createEmptyDraft());
  const [activeLookId, setActiveLookId] = useState<string | null>(draft.defaultLookId);
  const [assignShotId, setAssignShotId] = useState("");
  const [assignLookId, setAssignLookId] = useState("");
  const [assignIncludePrompt, setAssignIncludePrompt] = useState(true);
  const [candidateAssets, setCandidateAssets] = useState<CandidateAsset[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateAspectRatio, setCandidateAspectRatio] = useState<(typeof CANDIDATE_ASPECT_RATIOS)[number]>("3:4");
  const [candidateQuantity, setCandidateQuantity] = useState(4);
  const [generatingCandidates, setGeneratingCandidates] = useState(false);
  const [studioTab, setStudioTab] =
    useState<CharactersScreenState["studioTab"]>("profile");
  const hasResumableStudioDraft = !showStudio && hasMeaningfulCharacterDraft(draft);

  const activeLook = useMemo(
    () => draft.looks.find((look) => look.id === activeLookId) ?? draft.looks[0] ?? null,
    [activeLookId, draft.looks],
  );
  const activeCharacterId = draft.id;
  const activeCandidateJobs = useMemo(
    () =>
      queueJobs.filter((job) => {
        if (job.type !== "character_image" || !activeCharacterId || !activeLook?.id) {
          return false;
        }

        const tags = Array.isArray(job.params?.assetTags)
          ? (job.params?.assetTags as string[])
          : [];

        return (
          job.projectId === activeProject?.id &&
          (job.status === "queued" || job.status === "active") &&
          tags.includes(`character:${activeCharacterId}`) &&
          tags.includes(`look:${activeLook.id}`)
        );
      }),
    [activeCharacterId, activeLook?.id, activeProject?.id, queueJobs],
  );
  const candidateRefreshMarker = useMemo(
    () => activeCandidateJobs.map((job) => `${job.id}:${job.status}:${job.assetId ?? ""}`).join("|"),
    [activeCandidateJobs],
  );

  const filteredCharacters = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return characters.filter((character) => {
      if (needle.length === 0) {
        return true;
      }

      return (
        character.name.toLowerCase().includes(needle) ||
        (character.description ?? "").toLowerCase().includes(needle) ||
        (character.promptHint ?? "").toLowerCase().includes(needle) ||
        character.looks.some(
          (look) =>
            look.name.toLowerCase().includes(needle) ||
            (look.promptHint ?? "").toLowerCase().includes(needle),
        )
      );
    });
  }, [characters, search]);

  useEffect(() => {
    if (!activeProjectId) {
      const nextDraft = createEmptyDraft();
      setSearch(DEFAULT_CHARACTERS_SCREEN_STATE.search);
      setShowStudio(DEFAULT_CHARACTERS_SCREEN_STATE.showStudio);
      setShowAssignModal(DEFAULT_CHARACTERS_SCREEN_STATE.showAssignModal);
      setSelectedCharacter(null);
      setDraft(nextDraft);
      setActiveLookId(nextDraft.defaultLookId);
      setAssignShotId(DEFAULT_CHARACTERS_SCREEN_STATE.assignShotId);
      setAssignLookId(DEFAULT_CHARACTERS_SCREEN_STATE.assignLookId);
      setAssignIncludePrompt(DEFAULT_CHARACTERS_SCREEN_STATE.assignIncludePrompt);
      setCandidateAspectRatio(
        DEFAULT_CHARACTERS_SCREEN_STATE.candidateAspectRatio as (typeof CANDIDATE_ASPECT_RATIOS)[number],
      );
      setCandidateQuantity(DEFAULT_CHARACTERS_SCREEN_STATE.candidateQuantity);
      setStudioTab(DEFAULT_CHARACTERS_SCREEN_STATE.studioTab);
      return;
    }

    const nextState =
      useScreenStateStore.getState().charactersByProject[activeProjectId] ?? null;
    const nextDraft = nextState?.draft ?? createEmptyDraft();

    setSearch(nextState?.search ?? DEFAULT_CHARACTERS_SCREEN_STATE.search);
    setShowStudio(nextState?.showStudio ?? DEFAULT_CHARACTERS_SCREEN_STATE.showStudio);
    setShowAssignModal(nextState?.showAssignModal ?? DEFAULT_CHARACTERS_SCREEN_STATE.showAssignModal);
    setSelectedCharacter(null);
    setDraft(nextDraft);
    setActiveLookId(nextState?.activeLookId ?? nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
    setAssignShotId(nextState?.assignShotId ?? DEFAULT_CHARACTERS_SCREEN_STATE.assignShotId);
    setAssignLookId(nextState?.assignLookId ?? DEFAULT_CHARACTERS_SCREEN_STATE.assignLookId);
    setAssignIncludePrompt(
      nextState?.assignIncludePrompt ?? DEFAULT_CHARACTERS_SCREEN_STATE.assignIncludePrompt,
    );
    setCandidateAspectRatio(
      (nextState?.candidateAspectRatio as (typeof CANDIDATE_ASPECT_RATIOS)[number]) ??
        DEFAULT_CHARACTERS_SCREEN_STATE.candidateAspectRatio,
    );
    setCandidateQuantity(
      nextState?.candidateQuantity ?? DEFAULT_CHARACTERS_SCREEN_STATE.candidateQuantity,
    );
    setStudioTab(nextState?.studioTab ?? DEFAULT_CHARACTERS_SCREEN_STATE.studioTab);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProject) {
      setCharacters([]);
      setShots([]);
      setLoading(false);
      return;
    }

    const project = activeProject;
    let cancelled = false;

    async function loadData() {
      setLoading(true);

      try {
        const [nextCharacters, nextShots] = await Promise.all([
          listCharacters(),
          getShots(project.id, { includeArchived: true }),
        ]);

        if (!cancelled) {
          setCharacters(nextCharacters);
          setShots(nextShots.filter((shot) => !shot.parentShotId));
        }
      } catch (error) {
        console.error("Failed to load characters", error);
        if (!cancelled) {
          await message(error instanceof Error ? error.message : "Karakterler yuklenemedi.", {
            title: "Characters",
            kind: "error",
          });
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
  }, [activeProject]);

  useEffect(() => {
    if (!showStudio || !activeProject || !activeCharacterId || !activeLook?.id) {
      setCandidateAssets([]);
      setCandidateLoading(false);
      return;
    }

    let cancelled = false;
    const project = activeProject;
    const characterId = activeCharacterId;
    const lookId = activeLook.id;

    async function loadCandidates() {
      setCandidateLoading(true);

      try {
        const assets = await listCharacterCandidateAssets(characterId, lookId);
        const nextAssets = await Promise.all(
          assets.map(async (asset) => {
            const absolutePath = await join(project.folderPath, asset.file_path);
            return {
              ...asset,
              assetUrl: convertFileSrc(absolutePath),
            };
          }),
        );

        if (!cancelled) {
          setCandidateAssets(nextAssets);
        }
      } catch (error) {
        console.error("Failed to load character candidates", error);
        if (!cancelled) {
          setCandidateAssets([]);
        }
      } finally {
        if (!cancelled) {
          setCandidateLoading(false);
        }
      }
    }

    void loadCandidates();

    return () => {
      cancelled = true;
    };
  }, [showStudio, activeProject, activeCharacterId, activeLook?.id, candidateRefreshMarker]);

  useEffect(() => {
    if (!activeProjectId) {
      setSelectedCharacter(null);
      return;
    }

    const selectedCharacterId =
      useScreenStateStore.getState().charactersByProject[activeProjectId]?.selectedCharacterId ??
      null;

    if (!selectedCharacterId) {
      setSelectedCharacter(null);
      return;
    }

    setSelectedCharacter(
      characters.find((character) => character.id === selectedCharacterId) ?? null,
    );
  }, [activeProjectId, characters]);

  useEffect(() => {
    if (draft.looks.length === 0) {
      setActiveLookId(null);
      return;
    }

    if (activeLookId && draft.looks.some((look) => look.id === activeLookId)) {
      return;
    }

    setActiveLookId(draft.defaultLookId ?? draft.looks[0]?.id ?? null);
  }, [activeLookId, draft.defaultLookId, draft.looks]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }

    setCharactersState(activeProjectId, {
      search,
      showStudio,
      draft,
      activeLookId,
      candidateAspectRatio,
      candidateQuantity,
      selectedCharacterId: selectedCharacter?.id ?? null,
      showAssignModal,
      assignShotId,
      assignLookId,
      assignIncludePrompt,
      studioTab,
    });
  }, [
    activeLookId,
    activeProjectId,
    assignIncludePrompt,
    assignLookId,
    assignShotId,
    candidateAspectRatio,
    candidateQuantity,
    draft,
    search,
    selectedCharacter,
    setCharactersState,
    showAssignModal,
    showStudio,
    studioTab,
  ]);

  async function refreshCharacters() {
    const nextCharacters = await listCharacters();
    setCharacters(nextCharacters);
    return nextCharacters;
  }

  async function handleImportCharacterFromFiles() {
    if (hasResumableStudioDraft || showStudio) {
      const accepted = await confirm(
        "Character Studio'da saklanan bir taslak var. Yeni bir karakter yuklersen mevcut taslak bununla degisecek. Devam edilsin mi?",
        {
          title: "Taslagi degistir",
          kind: "warning",
          okLabel: "Degistir",
          cancelLabel: "Taslagi koru",
        },
      );

      if (!accepted) {
        return;
      }
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });

      if (!selected) {
        return;
      }

      const inputPaths = Array.isArray(selected) ? selected : [selected];
      const inferredName = inferCharacterNameFromPath(inputPaths[0]);
      const importedPaths = await importCharacterReferenceFiles(inferredName, inputPaths);
      const nextDraft = buildImportedCharacterDraft(inferredName, importedPaths);

      setDraft(nextDraft);
      setActiveLookId(nextDraft.defaultLookId);
      setStudioTab("looks");
      setShowStudio(true);

      await message(
        `${importedPaths.length} referans gorseli ice alindi. Karakter bilgilerini kontrol edip kaydedebilirsin.`,
        {
          title: "Characters",
          kind: "info",
        },
      );
    } catch (error) {
      console.error("Failed to import external character images", error);
      await message(
        error instanceof Error ? error.message : "Karakter gorselleri ice alinamadi.",
        {
          title: "Characters",
          kind: "error",
        },
      );
    }
  }

  async function openCreateEditor(forceNew = false) {
    if (!forceNew && hasResumableStudioDraft) {
      setShowStudio(true);
      return;
    }

    if (forceNew && (hasResumableStudioDraft || showStudio)) {
      const accepted = await confirm(
        "Mevcut Character Studio taslagi yeni bir bos taslakla degisecek. Devam edilsin mi?",
        {
          title: "Yeni taslak ac",
          kind: "warning",
          okLabel: "Yeni taslak",
          cancelLabel: "Vazgec",
        },
      );

      if (!accepted) {
        return;
      }
    }

    const nextDraft = createEmptyDraft();
    setDraft(nextDraft);
    setActiveLookId(nextDraft.defaultLookId);
    setStudioTab("profile");
    setShowStudio(true);
  }

  async function openEditEditor(character: CharacterRecord) {
    if (draft.id === character.id) {
      setShowStudio(true);
      return;
    }

    if (hasResumableStudioDraft || showStudio) {
      const accepted = await confirm(
        `${character.name} karakterini acarsan mevcut Character Studio taslagi bununla degisecek. Devam edilsin mi?`,
        {
          title: "Taslagi degistir",
          kind: "warning",
          okLabel: "Karakteri ac",
          cancelLabel: "Taslagi koru",
        },
      );

      if (!accepted) {
        return;
      }
    }

    const nextDraft = toStudioDraft(character);
    setDraft(nextDraft);
    setActiveLookId(nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
    setStudioTab("profile");
    setShowStudio(true);
  }

  async function handleAttachImagesToCharacter(character: CharacterRecord) {
    const defaultLook =
      character.looks.find((look) => look.id === character.defaultLookId) ??
      character.looks[0] ??
      null;

    if (!defaultLook) {
      await message("Karakter icin once bir look tanimi olusmali.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });

      if (!selected) {
        return;
      }

      const inputPaths = Array.isArray(selected) ? selected : [selected];
      const importedPaths = await importCharacterReferenceFiles(character.name, inputPaths);
      const nextLooks = character.looks.map<CharacterLookInput>((look) =>
        look.id === defaultLook.id
          ? {
              ...look,
              refImages: Array.from(new Set([...look.refImages, ...importedPaths])),
              primaryImage: look.primaryImage ?? importedPaths[0] ?? null,
            }
          : look,
      );

      await updateCharacter(character.id, buildCharacterUpdateInput(character, nextLooks));
      const nextCharacters = await refreshCharacters();
      const updatedCharacter =
        nextCharacters.find((entry) => entry.id === character.id) ?? null;

      if (updatedCharacter && draft.id === updatedCharacter.id) {
        const nextDraft = toStudioDraft(updatedCharacter);
        setDraft(nextDraft);
        setActiveLookId(nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
      }

      await message(
        `${importedPaths.length} gorsel ${character.name} karakterine eklendi.`,
        {
          title: "Characters",
          kind: "info",
        },
      );
    } catch (error) {
      console.error("Failed to attach images to character", error);
      await message(
        error instanceof Error ? error.message : "Karakter gorselleri eklenemedi.",
        {
          title: "Characters",
          kind: "error",
        },
      );
    }
  }

  function updateDraft(patch: Partial<CharacterStudioDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateActiveLook(
    updater: (look: StudioLookDraft) => StudioLookDraft,
  ) {
    setDraft((current) => ({
      ...current,
      looks: current.looks.map((look) =>
        look.id === (activeLookId ?? current.defaultLookId) ? updater(look) : look,
      ),
    }));
  }

  function handleProfileFieldChange<K extends keyof CharacterProfile>(
    key: K,
    value: CharacterProfile[K],
  ) {
    updateDraft({
      profile: {
        ...draft.profile,
        [key]: value,
      },
    });
  }

  function handleLookFieldChange<K extends keyof CharacterLookAttributes>(
    key: K,
    value: CharacterLookAttributes[K],
  ) {
    updateActiveLook((look) => ({
      ...look,
      attributes: {
        ...look.attributes,
        [key]: value,
      },
    }));
  }

  async function ensureSavedDraft(): Promise<CharacterStudioDraft | null> {
    if (!draft.name.trim()) {
      await message("Karakter adi zorunludur.", {
        title: "Characters",
        kind: "warning",
      });
      return null;
    }

    if (draft.id) {
      return draft;
    }

    try {
      const created = await createCharacter(toCharacterStudioInput(draft));
      const nextDraft = toStudioDraft(created);
      setDraft(nextDraft);
      setActiveLookId(nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
      await refreshCharacters();
      return nextDraft;
    } catch (error) {
      console.error("Failed to persist character draft", error);
      await message(error instanceof Error ? error.message : "Karakter taslagi kaydedilemedi.", {
        title: "Characters",
        kind: "error",
      });
      return null;
    }
  }

  async function handleImportReferences() {
    if (!activeLook) {
      return;
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });

      if (!selected) {
        return;
      }

      const inputPaths = Array.isArray(selected) ? selected : [selected];
      const importedPaths = await importCharacterReferenceFiles(draft.name || "character", inputPaths);

      updateActiveLook((look) => {
        const nextRefImages = Array.from(new Set([...look.refImages, ...importedPaths]));
        return {
          ...look,
          refImages: nextRefImages,
          primaryImage: look.primaryImage ?? nextRefImages[0] ?? null,
        };
      });

      if (draft.id && activeLookId) {
        for (const relativePath of importedPaths) {
          await appendCharacterLookReference(draft.id, activeLookId, relativePath);
        }

        await refreshCharacters();
      }
    } catch (error) {
      console.error("Failed to import character references", error);
      await message(error instanceof Error ? error.message : "Referans gorselleri eklenemedi.", {
        title: "Characters",
        kind: "error",
      });
    }
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      await message("Karakter adi zorunludur.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    setSaving(true);

    try {
      if (draft.id) {
        await updateCharacter(draft.id, toCharacterStudioInput(draft));
      } else {
        const created = await createCharacter(toCharacterStudioInput(draft));
        setDraft(toStudioDraft(created));
      }

      const nextCharacters = await refreshCharacters();

      if (draft.id) {
        const refreshed = nextCharacters.find((character) => character.id === draft.id);
        if (refreshed) {
          const nextDraft = toStudioDraft(refreshed);
          setDraft(nextDraft);
          setActiveLookId(nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
        }
      }

      setShowStudio(false);
    } catch (error) {
      console.error("Failed to save character", error);
      await message(error instanceof Error ? error.message : "Karakter kaydedilemedi.", {
        title: "Characters",
        kind: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(characterId: string) {
    const impact = await getCharacterDeletionImpact(characterId);
    const accepted = await confirm(
      impact.shotCount > 0
        ? `Bu karakter silinecek ve ${impact.shotCount} shot baglantisi temizlenecek. Devam edilsin mi?`
        : "Bu karakter kaydi silinecek. Devam edilsin mi?",
      {
        title: "Karakter sil",
        kind: "warning",
        okLabel: "Sil",
        cancelLabel: "Vazgec",
      },
    );

    if (!accepted) {
      return;
    }

    try {
      await deleteCharacter(characterId);
      await refreshCharacters();
    } catch (error) {
      await message(error instanceof Error ? error.message : "Karakter silinemedi.", {
        title: "Characters",
        kind: "error",
      });
    }
  }

  function handleAddLook() {
    const nextLook = createEmptyLook(`Look ${draft.looks.length + 1}`);
    setDraft((current) => ({
      ...current,
      looks: [...current.looks, nextLook],
      defaultLookId: current.defaultLookId ?? nextLook.id,
    }));
    setActiveLookId(nextLook.id);
  }

  function handleDuplicateLook() {
    if (!activeLook) {
      return;
    }

    const nextLook: StudioLookDraft = {
      ...activeLook,
      id: crypto.randomUUID(),
      name: `${activeLook.name} Copy`,
      refImages: activeLook.refImages.slice(),
      attributes: { ...activeLook.attributes },
    };

    setDraft((current) => ({
      ...current,
      looks: [...current.looks, nextLook],
    }));
    setActiveLookId(nextLook.id);
  }

  async function handleRemoveLook() {
    if (!activeLook) {
      return;
    }

    if (draft.looks.length === 1) {
      await message("Her karakterde en az bir look bulunmali.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    const accepted = await confirm(`${activeLook.name} look'u taslaktan kaldirilacak. Devam edilsin mi?`, {
      title: "Look sil",
      kind: "warning",
      okLabel: "Sil",
      cancelLabel: "Vazgec",
    });

    if (!accepted) {
      return;
    }

    setDraft((current) => {
      const nextLooks = current.looks.filter((look) => look.id !== activeLook.id);
      const nextDefaultLookId =
        current.defaultLookId === activeLook.id
          ? nextLooks[0]?.id ?? null
          : current.defaultLookId;
      return {
        ...current,
        looks: nextLooks,
        defaultLookId: nextDefaultLookId,
      };
    });
    setActiveLookId((current) => (current === activeLook.id ? draft.looks.find((look) => look.id !== activeLook.id)?.id ?? null : current));
  }

  function handleMoveReference(refImage: string, direction: -1 | 1) {
    updateActiveLook((look) => ({
      ...look,
      refImages: reorderLookReference(look.refImages, refImage, direction),
    }));
  }

  function handleRemoveReference(refImage: string) {
    updateActiveLook((look) => ({
      ...look,
      ...removeLookReference(look.refImages, look.primaryImage, refImage),
    }));
  }

  async function handleReferencePrimaryChange(relativePath: string) {
    updateActiveLook((look) => ({
      ...look,
      refImages: Array.from(new Set([...look.refImages, relativePath])),
      primaryImage: relativePath,
    }));

    if (!draft.id || !activeLookId) {
      return;
    }

    try {
      await setCharacterLookPrimaryImage(draft.id, activeLookId, relativePath);
      await refreshCharacters();
    } catch (error) {
      console.error("Failed to persist character primary image", error);
      await message(error instanceof Error ? error.message : "Karakter gorseli guncellenemedi.", {
        title: "Characters",
        kind: "error",
      });
    }
  }

  async function handleUseCandidate(asset: CandidateAsset, makePrimary: boolean) {
    updateActiveLook((look) => {
      const nextRefImages = Array.from(new Set([...look.refImages, asset.file_path]));
      return {
        ...look,
        refImages: nextRefImages,
        primaryImage: makePrimary ? asset.file_path : look.primaryImage ?? nextRefImages[0] ?? null,
      };
    });

    if (!draft.id || !activeLookId) {
      return;
    }

    try {
      if (makePrimary) {
        await setCharacterLookPrimaryImage(draft.id, activeLookId, asset.file_path);
      } else {
        await appendCharacterLookReference(draft.id, activeLookId, asset.file_path);
      }

      await refreshCharacters();
    } catch (error) {
      console.error("Failed to persist character candidate usage", error);
      await message(error instanceof Error ? error.message : "Candidate gorseli karaktere eklenemedi.", {
        title: "Characters",
        kind: "error",
      });
    }
  }

  async function handleDiscardCandidate(asset: CandidateAsset) {
    if (activeLook?.refImages.includes(asset.file_path)) {
      await message("Bu candidate su an aktif look referanslari icinde kullaniliyor. Once referans listesinden cikar.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    const accepted = await confirm("Bu candidate asset silinecek. Devam edilsin mi?", {
      title: "Candidate sil",
      kind: "warning",
      okLabel: "Sil",
      cancelLabel: "Vazgec",
    });

    if (!accepted) {
      return;
    }

    await deleteAssetRecord(asset.id);
    setCandidateAssets((current) => current.filter((item) => item.id !== asset.id));
  }

  async function handleGenerateCandidates() {
    if (!activeProject || !activeLook) {
      return;
    }

    const persistedDraft = await ensureSavedDraft();

    if (!persistedDraft) {
      return;
    }

    const persistedLook =
      persistedDraft.looks.find((look) => look.id === activeLook.id) ??
      persistedDraft.looks.find((look) => look.id === persistedDraft.defaultLookId) ??
      persistedDraft.looks[0];

    if (!persistedLook) {
      return;
    }

    setGeneratingCandidates(true);

    try {
      const referenceImagePaths = await Promise.all(
        persistedLook.refImages.slice(0, 4).map((relativePath) =>
          join(activeProject.folderPath, ...relativePath.split(/[\\/]+/).filter(Boolean)),
        ),
      );
      const prompt =
        persistedLook.promptLocked && persistedLook.generationPrompt.trim()
          ? persistedLook.generationPrompt.trim()
          : buildCharacterGenerationPrompt(
              persistedDraft.name,
              persistedDraft.profile,
              persistedLook.attributes,
            );
      const tags = buildCharacterCandidateTags(persistedDraft.id as string, persistedLook.id);

      await enqueueImageJobs({
        model: "fal-ai/nano-banana-2",
        prompt,
        aspectRatio: candidateAspectRatio,
        cfg: 7,
        steps: 28,
        quantity: candidateQuantity,
        referenceImagePaths,
        jobType: "character_image",
        assetTags: tags,
      });

      await message(`${candidateQuantity} karakter candidate isi kuyruga eklendi.`, {
        title: "Characters",
        kind: "info",
      });
    } catch (error) {
      console.error("Failed to enqueue character candidates", error);
      await message(error instanceof Error ? error.message : "Character candidate kuyrugu olusturulamadi.", {
        title: "Characters",
        kind: "error",
      });
    } finally {
      setGeneratingCandidates(false);
    }
  }

  async function handleAssignReference() {
    if (!selectedCharacter || !assignLookId) {
      return;
    }

    if (!assignShotId) {
      await message("Referansin atanacagi shot'u sec.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    const selectedLook =
      selectedCharacter.looks.find((look) => look.id === assignLookId) ??
      selectedCharacter.looks[0];

    if (!selectedLook?.primaryImage) {
      await message("Secilen look icin once bir primary referans gorseli belirle.", {
        title: "Characters",
        kind: "warning",
      });
      return;
    }

    setAssigning(true);

    try {
      await assignCharacterLookToShot(
        assignShotId,
        selectedCharacter.id,
        selectedLook.id,
        assignIncludePrompt,
      );
      await message(`${selectedCharacter.name} / ${selectedLook.name} shot'a baglandi.`, {
        title: "Characters",
        kind: "info",
      });
      setShowAssignModal(false);
      setSelectedCharacter(null);
      setAssignShotId("");
      setAssignLookId("");
      setAssignIncludePrompt(true);
    } catch (error) {
      await message(error instanceof Error ? error.message : "Referans atanamadi.", {
        title: "Characters",
        kind: "error",
      });
    } finally {
      setAssigning(false);
    }
  }

  if (!activeProject) {
    return <CharactersState title="Characters" copy="Karakter kutuphanesini yonetmek icin once bir proje ac." />;
  }

  return (
    <section className="screen-shell">
      <section style={{ display: "grid", gap: 18 }}>
        <header style={heroStyle}>
          <div style={{ display: "grid", gap: 8, maxWidth: 760 }}>
            <span style={eyebrowStyle}>
              <UserRound size={13} />
              Continuity vault
            </span>
            <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>
              Characters
            </div>
            <p style={copyStyle}>
              Karakter continuity profilleri, look varyantlari ve Nano Banana 2 ile uretilen referanslar burada yonetilir.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={() => void handleImportCharacterFromFiles()} type="button">
              <Plus size={15} />
              Karakter Yukle
            </button>
            {hasResumableStudioDraft ? (
              <button className="btn-secondary" onClick={() => void openCreateEditor(true)} type="button">
                <Plus size={15} />
                Yeni Karakter
              </button>
            ) : null}
            <button className="btn-primary" onClick={() => void openCreateEditor()} type="button">
              <Plus size={15} />
              {hasResumableStudioDraft ? "Taslaga Don" : "Character Studio"}
            </button>
          </div>
        </header>

        <section style={toolbarStyle}>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Karakter ara"
            style={searchInputStyle}
            value={search}
          />
          <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
            {characters.length} karakter / {shots.length} ana shot
          </div>
        </section>

        {loading ? (
          <CharactersState title="Yukleniyor..." copy="Karakter kayitlari okunuyor." />
        ) : filteredCharacters.length === 0 ? (
          <CharactersState
            title={characters.length === 0 ? "Karakter kutuphanesi bos" : "Sonuc bulunamadi"}
            copy={
              characters.length === 0
                ? "Character Studio ile ilk continuity profilini olusturup referans gorseller uretebilirsin."
                : "Arama sonucunda karakter bulunamadi."
            }
          />
        ) : (
          <div style={gridStyle}>
            {filteredCharacters.map((character) => (
              <CharacterCard
                character={character}
                key={character.id}
                onAssign={() => {
                  setSelectedCharacter(character);
                  setAssignShotId(shots[0]?.id ?? "");
                  setAssignLookId(character.defaultLookId ?? character.looks[0]?.id ?? "");
                  setAssignIncludePrompt(true);
                  setShowAssignModal(true);
                }}
                onDelete={() => void handleDelete(character.id)}
                onEdit={() => void openEditEditor(character)}
                onUploadImages={() => void handleAttachImagesToCharacter(character)}
                projectFolderPath={activeProject.folderPath}
              />
            ))}
          </div>
        )}
      </section>

      {showStudio ? (
        <Portal><CharacterStudioModal
          activeLook={activeLook}
          activeLookId={activeLookId}
          activeTab={studioTab}
          candidateAssets={candidateAssets}
          candidateAspectRatio={candidateAspectRatio}
          candidateLoading={candidateLoading}
          candidateQuantity={candidateQuantity}
          draft={draft}
          generatingCandidates={generatingCandidates}
          onActiveTabChange={setStudioTab}
          onAddLook={handleAddLook}
          onCandidateAspectRatioChange={setCandidateAspectRatio}
          onCandidateQuantityChange={setCandidateQuantity}
          onClose={() => {
            if (!saving && !generatingCandidates) {
              setShowStudio(false);
            }
          }}
          onDefaultLookChange={(lookId) => updateDraft({ defaultLookId: lookId })}
          onDiscardCandidate={(asset) => void handleDiscardCandidate(asset)}
          onDuplicateLook={handleDuplicateLook}
          onGenerateCandidates={() => void handleGenerateCandidates()}
          onImportReferences={() => void handleImportReferences()}
          onLookFieldChange={handleLookFieldChange}
          onLookNameChange={(value) => updateActiveLook((look) => ({ ...look, name: value }))}
          onLookSelect={setActiveLookId}
          onMoveReference={handleMoveReference}
          onProfileFieldChange={handleProfileFieldChange}
          onPromptChange={(value) =>
            updateActiveLook((look) => ({
              ...look,
              generationPrompt: value,
              promptLocked: true,
            }))
          }
          onPromptReset={() =>
            updateActiveLook((look) => ({
              ...look,
              generationPrompt: "",
              promptLocked: false,
            }))
          }
          onReferencePrimaryChange={(relativePath) => void handleReferencePrimaryChange(relativePath)}
          onRemoveLook={() => void handleRemoveLook()}
          onRemoveReference={handleRemoveReference}
          onSave={() => void handleSave()}
          onTextChange={(key, value) => updateDraft({ [key]: value } as Partial<CharacterStudioDraft>)}
          onUseCandidate={(asset, makePrimary) => void handleUseCandidate(asset, makePrimary)}
          projectFolderPath={activeProject.folderPath}
          queueJobs={activeCandidateJobs.length}
          saving={saving}
        /></Portal>
      ) : null}

      {showAssignModal && selectedCharacter ? (
        <Portal><AssignReferenceModal
          assigning={assigning}
          character={selectedCharacter}
          includePrompt={assignIncludePrompt}
          onAssign={() => void handleAssignReference()}
          onClose={() => {
            if (!assigning) {
              setShowAssignModal(false);
            }
          }}
          onIncludePromptChange={setAssignIncludePrompt}
          onLookChange={setAssignLookId}
          onShotChange={setAssignShotId}
          projectFolderPath={activeProject.folderPath}
          selectedLookId={assignLookId}
          selectedShotId={assignShotId}
          shots={shots}
        /></Portal>
      ) : null}
    </section>
  );
}

function CharacterCard({
  character,
  onEdit,
  onDelete,
  onAssign,
  onUploadImages,
  projectFolderPath,
}: {
  character: CharacterRecord;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onUploadImages: () => void;
  projectFolderPath: string;
}) {
  const defaultLook =
    character.looks.find((look) => look.id === character.defaultLookId) ??
    character.looks[0] ??
    null;
  const previewLook =
    defaultLook?.primaryImage || defaultLook?.refImages[0]
      ? defaultLook
      : character.looks.find((look) => look.primaryImage || look.refImages[0]) ?? defaultLook;
  const primaryUrl = toProjectAssetUrl(
    projectFolderPath,
    previewLook?.primaryImage ??
      previewLook?.refImages[0] ??
      character.primaryImage ??
      character.refImages[0] ??
      null,
  );

  return (
    <article style={cardStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr)", gap: 16 }}>
        <div style={mediaStyle}>
          {primaryUrl ? (
            <img alt={character.name} src={primaryUrl} style={mediaImageStyle} />
          ) : (
            <UserRound size={34} style={{ color: "rgba(255,255,255,0.18)" }} />
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 18 }}>{character.name}</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {character.klingElementId ? <span style={mutedTagStyle}>{character.klingElementId}</span> : null}
                <span style={tagStyle}>{character.looks.length} look</span>
                <span style={mutedTagStyle}>{defaultLook?.name ?? "Default Look"}</span>
              </div>
            </div>
            <button className="icon-button" onClick={onEdit} type="button">
              <Pencil size={15} />
            </button>
          </div>

          <div style={textBlockStyle}>
            {character.promptHint || character.description || summarizeCharacterProfile(character.profile, character.styleNotes) || "Karakter notu eklenmedi."}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={onUploadImages} type="button">
              <Plus size={14} />
              Gorsel yukle
            </button>
            <button className="btn-secondary" onClick={onEdit} type="button">
              <Pencil size={14} />
              Studyoda ac
            </button>
            <button className="btn-secondary" onClick={onAssign} type="button">
              <Link2 size={14} />
              Shot'a bagla
            </button>
            <button className="btn-secondary" onClick={onDelete} type="button">
              <Trash2 size={14} />
              Sil
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function AssignReferenceModal({
  character,
  shots,
  selectedShotId,
  selectedLookId,
  includePrompt,
  onShotChange,
  onLookChange,
  onIncludePromptChange,
  onAssign,
  onClose,
  assigning,
  projectFolderPath,
}: {
  character: CharacterRecord;
  shots: ShotRow[];
  selectedShotId: string;
  selectedLookId: string;
  includePrompt: boolean;
  onShotChange: (value: string) => void;
  onLookChange: (value: string) => void;
  onIncludePromptChange: (value: boolean) => void;
  onAssign: () => void;
  onClose: () => void;
  assigning: boolean;
  projectFolderPath: string;
}) {
  const selectedLook =
    character.looks.find((look) => look.id === selectedLookId) ??
    character.looks.find((look) => look.id === character.defaultLookId) ??
    character.looks[0] ??
    null;
  const previewUrl = toProjectAssetUrl(projectFolderPath, selectedLook?.primaryImage ?? null);

  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={(event) => event.stopPropagation()} style={{ ...modalPanelStyle, width: "min(560px, 100%)" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>Shot'a karakter bagla</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            Secilen look'un primary referansi shot'a baglanacak. Istersen promptlara continuity hint'i de eklenir.
          </p>
        </div>

        {previewUrl ? <img alt={character.name} src={previewUrl} style={{ ...thumbStyle, width: "100%", height: 220 }} /> : null}

        <select onChange={(event) => onLookChange(event.target.value)} style={formInputStyle} value={selectedLookId}>
          {character.looks.map((look) => (
            <option key={look.id} value={look.id}>
              {look.name}
            </option>
          ))}
        </select>

        <select disabled={shots.length === 0} onChange={(event) => onShotChange(event.target.value)} style={formInputStyle} value={selectedShotId}>
          <option value="">Shot sec</option>
          {shots.map((shot) => (
            <option key={shot.id} value={shot.id}>
              {shot.shotNumber}
            </option>
          ))}
        </select>

        <label style={toggleRowStyle}>
          <input checked={includePrompt} onChange={(event) => onIncludePromptChange(event.target.checked)} type="checkbox" />
          <span>Karakter continuity hint'ini promptlara ekle</span>
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-secondary" disabled={assigning} onClick={onClose} type="button">
            Iptal
          </button>
          <button className="btn-primary" disabled={!selectedShotId || !selectedLook?.primaryImage || assigning} onClick={onAssign} type="button">
            {assigning ? "Ataniyor..." : "Bagla"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CharactersState({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="screen-shell">
      <div style={emptyStateStyle}>
        <div style={{ display: "grid", gap: 10, justifyItems: "center", maxWidth: 420, textAlign: "center" }}>
          <UserRound size={34} style={{ color: "var(--accent)" }} />
          <div style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
          <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.7 }}>{copy}</p>
        </div>
      </div>
    </section>
  );
}


const heroStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 18,
  flexWrap: "wrap",
  padding: 24,
  borderRadius: 28,
  border: "1px solid var(--border-subtle)",
  background: "linear-gradient(135deg, rgba(245,158,11,0.08), transparent 28%), var(--bg-surface)",
} satisfies React.CSSProperties;

const eyebrowStyle = {
  display: "inline-flex",
  width: "fit-content",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(245, 158, 11, 0.24)",
  background: "rgba(245, 158, 11, 0.1)",
  color: "var(--accent)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
} satisfies React.CSSProperties;

const copyStyle = {
  margin: 0,
  color: "var(--text-secondary)",
  lineHeight: 1.7,
} satisfies React.CSSProperties;

const toolbarStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "center",
  padding: 18,
  borderRadius: 20,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const searchInputStyle = {
  minWidth: 260,
  flex: 1,
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
} satisfies React.CSSProperties;

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
  gap: 16,
} satisfies React.CSSProperties;

const cardStyle = {
  display: "grid",
  gap: 16,
  padding: 18,
  borderRadius: 22,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const mediaStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 164,
  borderRadius: 18,
  overflow: "hidden",
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const mediaImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
} satisfies React.CSSProperties;

const tagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(245,158,11,0.1)",
  color: "var(--accent)",
  fontSize: 11,
} satisfies React.CSSProperties;

const mutedTagStyle = {
  display: "inline-flex",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.04)",
  color: "var(--text-secondary)",
  fontSize: 11,
} satisfies React.CSSProperties;

const textBlockStyle = {
  minHeight: 70,
  padding: 12,
  borderRadius: 14,
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-elevated)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
} satisfies React.CSSProperties;

const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 240,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(0, 0, 0, 0.72)",
  backdropFilter: "blur(10px)",
} satisfies React.CSSProperties;

const modalPanelStyle = {
  width: "min(760px, 100%)",
  display: "grid",
  gap: 18,
  padding: 24,
  borderRadius: 24,
  border: "1px solid var(--border-default)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;

const formInputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-elevated)",
  color: "var(--text-primary)",
  outline: "none",
} satisfies React.CSSProperties;

const toggleRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--text-secondary)",
  fontSize: 13,
} satisfies React.CSSProperties;

const thumbStyle = {
  width: "100%",
  height: 112,
  objectFit: "cover",
  display: "block",
  borderRadius: 12,
} satisfies React.CSSProperties;

const emptyStateStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: 360,
  padding: 24,
  borderRadius: 24,
  border: "1px dashed var(--border-default)",
  background: "var(--bg-surface)",
} satisfies React.CSSProperties;
