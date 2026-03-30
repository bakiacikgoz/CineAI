import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { confirm, message, open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  Copy,
  ImagePlus,
  Link2,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
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
  viewedLookId: null,
  showAssignModal: false,
  assignShotId: "",
  assignLookId: "",
  assignIncludePrompt: true,
  studioTab: "profile",
};

/** Attribute label map for displaying CharacterLookAttributes in Turkish */
const ATTRIBUTE_LABELS: Record<keyof CharacterLookAttributes, string> = {
  wardrobe: "Kiyafet",
  palette: "Palet",
  materials: "Materyal",
  accessories: "Aksesuar",
  hairOverride: "Sac",
  makeupOverride: "Makyaj",
  mood: "Ruh Hali",
  sceneContext: "Sahne",
  continuityNotes: "Sureklilik",
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
  const [viewedLookId, setViewedLookId] = useState<string | null>(null);
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
  const [promptCopied, setPromptCopied] = useState(false);
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

  /** Resolved look being viewed in the detail panel */
  const viewedLook = useMemo(() => {
    if (!selectedCharacter) return null;
    if (viewedLookId) {
      return selectedCharacter.looks.find((l) => l.id === viewedLookId) ?? null;
    }
    return null;
  }, [selectedCharacter, viewedLookId]);

  /** Generation prompt text for the viewed look */
  const viewedLookPrompt = useMemo(() => {
    if (!viewedLook || !selectedCharacter) return "";
    if (viewedLook.promptLocked && viewedLook.generationPrompt.trim()) {
      return viewedLook.generationPrompt;
    }
    return buildCharacterGenerationPrompt(
      selectedCharacter.name,
      selectedCharacter.profile,
      viewedLook.attributes,
    );
  }, [viewedLook, selectedCharacter]);

  // ----- Screen state hydration on project switch -----
  useEffect(() => {
    if (!activeProjectId) {
      const nextDraft = createEmptyDraft();
      setSearch(DEFAULT_CHARACTERS_SCREEN_STATE.search);
      setShowStudio(DEFAULT_CHARACTERS_SCREEN_STATE.showStudio);
      setShowAssignModal(DEFAULT_CHARACTERS_SCREEN_STATE.showAssignModal);
      setSelectedCharacter(null);
      setViewedLookId(null);
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
    setViewedLookId(nextState?.viewedLookId ?? null);
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

  // ----- Data loading -----
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

  // ----- Candidate assets loading -----
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

  // ----- Restore selected character from persisted state -----
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

  // ----- Auto-select first character when list loads and none is selected -----
  useEffect(() => {
    if (!selectedCharacter && characters.length > 0 && !loading) {
      const first = characters[0];
      setSelectedCharacter(first);
      setViewedLookId(first.defaultLookId ?? first.looks[0]?.id ?? null);
    }
  }, [characters, loading, selectedCharacter]);

  // ----- Sync activeLookId with draft looks -----
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

  // ----- Persist screen state -----
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
      viewedLookId,
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
    viewedLookId,
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

      // Also refresh selectedCharacter if it is the same one
      if (updatedCharacter && selectedCharacter?.id === updatedCharacter.id) {
        setSelectedCharacter(updatedCharacter);
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
      const nextCharacters = await refreshCharacters();

      // If the deleted character was selected, clear selection
      if (selectedCharacter?.id === characterId) {
        const first = nextCharacters[0] ?? null;
        setSelectedCharacter(first);
        setViewedLookId(first?.defaultLookId ?? first?.looks[0]?.id ?? null);
      }
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

  /** Handle selecting a character from the left panel */
  function handleSelectCharacter(character: CharacterRecord) {
    setSelectedCharacter(character);
    setViewedLookId(character.defaultLookId ?? character.looks[0]?.id ?? null);
  }

  /** Trigger generate candidates from the detail panel */
  function handleDetailGenerateCandidates() {
    if (!selectedCharacter || !activeProject) return;

    // Set up the draft for this character and open studio on generation tab
    const nextDraft = toStudioDraft(selectedCharacter);
    setDraft(nextDraft);
    setActiveLookId(nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
    setStudioTab("generation");
    setShowStudio(true);
  }

  /** Copy prompt text to clipboard */
  async function handleCopyPrompt() {
    if (!viewedLookPrompt) return;
    try {
      await navigator.clipboard.writeText(viewedLookPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      // Fallback: silently fail
    }
  }

  // ----- No project state -----
  if (!activeProject) {
    return <CharactersEmptyState title="Characters" copy="Karakter kutuphanesini yonetmek icin once bir proje ac." />;
  }

  // ----- Loading state -----
  if (loading) {
    return (
      <div style={masterDetailContainerStyle}>
        <div style={leftPanelStyle}>
          <div style={leftPanelHeaderStyle}>
            <span style={{ fontSize: 20, fontWeight: 700 }}>Karakterler</span>
          </div>
        </div>
        <div style={rightPanelStyle}>
          <div style={emptyDetailStyle}>
            <UserRound size={48} strokeWidth={1.2} style={{ color: "var(--text-muted)" }} />
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-muted)" }}>Yukleniyor...</div>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
              Karakter kayitlari okunuyor.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={masterDetailContainerStyle}>
      {/* ═══════════════════════════ LEFT PANEL ═══════════════════════════ */}
      <div style={leftPanelStyle}>
        {/* Header */}
        <div style={leftPanelHeaderStyle}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>Karakterler</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => void handleImportCharacterFromFiles()}
              style={leftPanelIconBtnStyle}
              title="Karakter Yukle"
              type="button"
            >
              <Upload size={14} />
            </button>
            <button
              onClick={() => void openCreateEditor(true)}
              style={leftPanelAddBtnStyle}
              title="Yeni Karakter"
              type="button"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "0 16px 12px" }}>
          <div style={searchWrapperStyle}>
            <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Karakter ara..."
              style={leftSearchInputStyle}
              value={search}
            />
          </div>
        </div>

        {/* Character list */}
        <div style={characterListStyle}>
          {filteredCharacters.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center" }}>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
                {characters.length === 0 ? "Henuz karakter yok" : "Sonuc bulunamadi"}
              </p>
            </div>
          ) : (
            filteredCharacters.map((character) => {
              const isActive = selectedCharacter?.id === character.id;
              const defaultLook =
                character.looks.find((l) => l.id === character.defaultLookId) ??
                character.looks[0] ??
                null;
              const avatarUrl = toProjectAssetUrl(
                activeProject.folderPath,
                defaultLook?.primaryImage ?? defaultLook?.refImages[0] ?? character.primaryImage ?? character.refImages[0] ?? null,
              );
              const description =
                character.description ||
                summarizeCharacterProfile(character.profile, character.styleNotes) ||
                "";

              return (
                <button
                  key={character.id}
                  onClick={() => handleSelectCharacter(character)}
                  style={{
                    ...charListItemStyle,
                    background: isActive ? "var(--surface-hover)" : "transparent",
                    borderRadius: 12,
                  }}
                  type="button"
                >
                  {/* Active indicator bar */}
                  {isActive ? (
                    <div style={activeBarStyle} />
                  ) : (
                    <div style={{ width: 3, height: 24 }} />
                  )}

                  {/* Avatar */}
                  <div style={avatarStyle}>
                    {avatarUrl ? (
                      <img
                        alt={character.name}
                        src={avatarUrl}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          borderRadius: "50%",
                          filter: "grayscale(1)",
                          opacity: isActive ? 1 : 0.6,
                          transition: "opacity 200ms ease",
                        }}
                      />
                    ) : (
                      <UserRound size={18} style={{ color: "var(--text-muted)" }} />
                    )}
                  </div>

                  {/* Name & description */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {character.name}
                    </div>
                    {description ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: isActive ? "var(--text-muted)" : "var(--text-muted)",
                          lineHeight: 1.3,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          marginTop: 2,
                        }}
                      >
                        {description}
                      </div>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Resume draft button at bottom (if applicable) */}
        {hasResumableStudioDraft ? (
          <div style={{ padding: "8px 16px 16px" }}>
            <button
              onClick={() => void openCreateEditor()}
              style={resumeDraftBtnStyle}
              type="button"
            >
              Taslaga Don
            </button>
          </div>
        ) : null}
      </div>

      {/* ═══════════════════════════ RIGHT PANEL ═══════════════════════════ */}
      <div style={rightPanelStyle}>
        {selectedCharacter ? (
          <CharacterDetailPanel
            character={selectedCharacter}
            onAssign={() => {
              setAssignShotId(shots[0]?.id ?? "");
              setAssignLookId(selectedCharacter.defaultLookId ?? selectedCharacter.looks[0]?.id ?? "");
              setAssignIncludePrompt(true);
              setShowAssignModal(true);
            }}
            onCopyPrompt={() => void handleCopyPrompt()}
            onDelete={() => void handleDelete(selectedCharacter.id)}
            onEdit={() => void openEditEditor(selectedCharacter)}
            onGenerateCandidates={() => handleDetailGenerateCandidates()}
            onLookSelect={setViewedLookId}
            onNewLook={() => {
              const nextDraft = toStudioDraft(selectedCharacter);
              setDraft(nextDraft);
              setActiveLookId(nextDraft.defaultLookId ?? nextDraft.looks[0]?.id ?? null);
              setStudioTab("looks");
              setShowStudio(true);
            }}
            onUploadImages={() => void handleAttachImagesToCharacter(selectedCharacter)}
            projectFolderPath={activeProject.folderPath}
            promptCopied={promptCopied}
            viewedLook={viewedLook}
            viewedLookId={viewedLookId}
            viewedLookPrompt={viewedLookPrompt}
          />
        ) : (
          <div style={emptyDetailStyle}>
            <UserRound size={48} strokeWidth={1.2} style={{ color: "var(--text-muted)" }} />
            <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-muted)" }}>Karakter sec</div>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, maxWidth: 280, textAlign: "center" }}>
              Detaylari goruntulemek icin sol panelden bir karakter sec.
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════ STUDIO MODAL ═══════════════════════════ */}
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

      {/* ═══════════════════════════ ASSIGN MODAL ═══════════════════════════ */}
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
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   Character Detail Panel (Right Side)
   ═══════════════════════════════════════════════════════════════ */

function CharacterDetailPanel({
  character,
  viewedLookId,
  viewedLook,
  viewedLookPrompt,
  promptCopied,
  projectFolderPath,
  onEdit,
  onDelete,
  onGenerateCandidates,
  onLookSelect,
  onNewLook,
  onUploadImages,
  onAssign,
  onCopyPrompt,
}: {
  character: CharacterRecord;
  viewedLookId: string | null;
  viewedLook: CharacterRecord["looks"][number] | null;
  viewedLookPrompt: string;
  promptCopied: boolean;
  projectFolderPath: string;
  onEdit: () => void;
  onDelete: () => void;
  onGenerateCandidates: () => void;
  onLookSelect: (lookId: string) => void;
  onNewLook: () => void;
  onUploadImages: () => void;
  onAssign: () => void;
  onCopyPrompt: () => void;
}) {
  const description =
    character.description ||
    summarizeCharacterProfile(character.profile, character.styleNotes) ||
    "";

  /** Collect non-empty attributes from the viewed look */
  const lookAttributes = useMemo(() => {
    if (!viewedLook) return [];
    const entries: { key: keyof CharacterLookAttributes; label: string; value: string }[] = [];
    for (const [key, label] of Object.entries(ATTRIBUTE_LABELS)) {
      const val = viewedLook.attributes[key as keyof CharacterLookAttributes];
      if (val && val.trim()) {
        entries.push({ key: key as keyof CharacterLookAttributes, label, value: val });
      }
    }
    return entries;
  }, [viewedLook]);

  return (
    <>
      {/* Sticky header */}
      <div style={detailHeaderStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.1 }}>
            {character.name}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button
            onClick={onUploadImages}
            style={detailIconBtnStyle}
            title="Gorsel yukle"
            type="button"
          >
            <ImagePlus size={16} />
          </button>
          <button
            onClick={onAssign}
            style={detailIconBtnStyle}
            title="Shot'a bagla"
            type="button"
          >
            <Link2 size={16} />
          </button>
          <button
            onClick={onEdit}
            style={detailIconBtnStyle}
            title="Duzenle"
            type="button"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={onDelete}
            style={{ ...detailIconBtnStyle, color: "var(--status-error)" }}
            title="Sil"
            type="button"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={onGenerateCandidates}
            style={generateBtnStyle}
            type="button"
          >
            Aday Gorsel Uret
          </button>
        </div>
      </div>

      {/* Content area */}
      <div style={{ padding: "24px 32px 48px" }}>
        {/* Description */}
        {description ? (
          <p style={{ margin: "0 0 32px", color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7 }}>
            {description}
          </p>
        ) : null}

        {/* Looks Grid */}
        <div style={{ marginBottom: 32 }}>
          <div style={sectionTitleStyle}>Gorunumler</div>
          <div style={looksGridStyle}>
            {character.looks.map((look) => {
              const isActive = look.id === viewedLookId;
              const isDefault = look.id === character.defaultLookId;
              const imageUrl = toProjectAssetUrl(
                projectFolderPath,
                look.primaryImage ?? look.refImages[0] ?? null,
              );

              return (
                <div key={look.id}>
                  <button
                    onClick={() => onLookSelect(look.id)}
                    style={{
                      ...lookCardStyle,
                      outline: isActive ? "2px solid var(--accent)" : "none",
                      outlineOffset: isActive ? -2 : 0,
                      filter: isActive ? "none" : "grayscale(1)",
                      opacity: isActive ? 1 : 0.4,
                    }}
                    type="button"
                  >
                    {imageUrl ? (
                      <img
                        alt={look.name}
                        src={imageUrl}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      <div style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", background: "var(--bg-elevated)" }}>
                        <UserRound size={28} style={{ color: "var(--text-muted)" }} />
                      </div>
                    )}

                    {/* Check badge for active/default */}
                    {(isActive || isDefault) ? (
                      <div style={lookBadgeStyle}>
                        <Check size={12} strokeWidth={3} />
                      </div>
                    ) : null}
                  </button>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {look.name}
                  </div>
                </div>
              );
            })}

            {/* New Look card */}
            <div>
              <button
                onClick={onNewLook}
                style={newLookCardStyle}
                type="button"
              >
                <ImagePlus size={24} style={{ color: "var(--text-muted)" }} />
              </button>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                Yeni Gorunum
              </div>
            </div>
          </div>
        </div>

        {/* Look Details Section */}
        {viewedLook ? (
          <div style={lookDetailContainerStyle}>
            {/* Look detail header */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                Gorunum Detayi: {viewedLook.name}
              </h3>
              {viewedLook.promptHint ? (
                <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  {viewedLook.promptHint}
                </p>
              ) : null}
            </div>

            {/* Reference images */}
            {viewedLook.refImages.length > 0 ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ ...sectionSubTitleStyle, marginBottom: 10 }}>Referans Gorselleri</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {viewedLook.refImages.map((refImage) => {
                    const imageUrl = toProjectAssetUrl(projectFolderPath, refImage);
                    const isPrimary = refImage === viewedLook.primaryImage;
                    return (
                      <div
                        key={refImage}
                        style={{
                          position: "relative",
                          width: 80,
                          height: 80,
                          borderRadius: 12,
                          overflow: "hidden",
                          outline: isPrimary ? "2px solid var(--status-success)" : "1px solid var(--border-default)",
                          outlineOffset: isPrimary ? -2 : -1,
                          flexShrink: 0,
                        }}
                      >
                        {imageUrl ? (
                          <img
                            alt="ref"
                            src={imageUrl}
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <div style={{ width: "100%", height: "100%", background: "var(--bg-elevated)" }} />
                        )}
                        {isPrimary ? (
                          <div style={refPrimaryBadgeStyle}>
                            <Check size={10} strokeWidth={3} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Attributes */}
            {lookAttributes.length > 0 ? (
              <div style={{ marginBottom: 24 }}>
                <div style={{ ...sectionSubTitleStyle, marginBottom: 10 }}>Ozellikler</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {lookAttributes.map(({ key, label, value }) => (
                    <span key={key} style={attributeChipStyle}>
                      <strong style={{ fontWeight: 600 }}>{label}:</strong> {value}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Generation prompt */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Lock size={13} style={{ color: "var(--text-muted)" }} />
                <span style={sectionSubTitleStyle}>Uretim Promptu</span>
              </div>
              <div style={{ position: "relative" }}>
                <textarea
                  readOnly
                  style={promptTextareaStyle}
                  value={viewedLookPrompt || "Prompt henuz olusturulmadi."}
                />
                {viewedLookPrompt ? (
                  <button
                    onClick={onCopyPrompt}
                    style={copyPromptBtnStyle}
                    title="Kopyala"
                    type="button"
                  >
                    {promptCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}


/* ═══════════════════════════════════════════════════════════════
   Assign Reference Modal
   ═══════════════════════════════════════════════════════════════ */

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
      <div onClick={(event) => event.stopPropagation()} style={modalPanelStyle}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>Shot'a karakter bagla</div>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
            Secilen look'un primary referansi shot'a baglanacak. Istersen promptlara continuity hint'i de eklenir.
          </p>
        </div>

        {previewUrl ? (
          <img
            alt={character.name}
            src={previewUrl}
            style={{ width: "100%", height: 220, objectFit: "cover", borderRadius: 16, display: "block" }}
          />
        ) : null}

        <select
          onChange={(event) => onLookChange(event.target.value)}
          style={modalSelectStyle}
          value={selectedLookId}
        >
          {character.looks.map((look) => (
            <option key={look.id} value={look.id}>
              {look.name}
            </option>
          ))}
        </select>

        <select
          disabled={shots.length === 0}
          onChange={(event) => onShotChange(event.target.value)}
          style={modalSelectStyle}
          value={selectedShotId}
        >
          <option value="">Shot sec</option>
          {shots.map((shot) => (
            <option key={shot.id} value={shot.id}>
              {shot.shotNumber}
            </option>
          ))}
        </select>

        <label style={modalToggleStyle}>
          <input
            checked={includePrompt}
            onChange={(event) => onIncludePromptChange(event.target.checked)}
            type="checkbox"
          />
          <span>Karakter continuity hint'ini promptlara ekle</span>
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            disabled={assigning}
            onClick={onClose}
            style={modalSecondaryBtnStyle}
            type="button"
          >
            Iptal
          </button>
          <button
            disabled={!selectedShotId || !selectedLook?.primaryImage || assigning}
            onClick={onAssign}
            style={modalPrimaryBtnStyle}
            type="button"
          >
            {assigning ? "Ataniyor..." : "Bagla"}
          </button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   Empty State Component
   ═══════════════════════════════════════════════════════════════ */

function CharactersEmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div style={masterDetailContainerStyle}>
      <div style={{ ...leftPanelStyle, minHeight: "100%" }}>
        <div style={leftPanelHeaderStyle}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>Karakterler</span>
        </div>
      </div>
      <div style={rightPanelStyle}>
        <div style={emptyDetailStyle}>
          <UserRound size={48} strokeWidth={1.2} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-muted)" }}>{title}</div>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, maxWidth: 320, textAlign: "center" }}>
            {copy}
          </p>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */

const masterDetailContainerStyle = {
  display: "flex",
  height: "calc(100vh - var(--topbar-h, 56px))",
  overflow: "hidden",
} satisfies React.CSSProperties;

const leftPanelStyle = {
  width: 300,
  minWidth: 300,
  maxWidth: 300,
  display: "flex",
  flexDirection: "column",
  borderRight: "1px solid var(--border-default)",
  background: "var(--surface-tint)",
  overflow: "hidden",
} satisfies React.CSSProperties;

const leftPanelHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "18px 16px 14px",
  flexShrink: 0,
} satisfies React.CSSProperties;

const rightPanelStyle = {
  flex: 1,
  background: "var(--bg-base)",
  overflowY: "auto",
  position: "relative",
} satisfies React.CSSProperties;

const searchWrapperStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 14px",
  borderRadius: 999,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
} satisfies React.CSSProperties;

const leftSearchInputStyle = {
  flex: 1,
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 13,
  color: "var(--text-primary)",
  lineHeight: 1.4,
} satisfies React.CSSProperties;

const characterListStyle = {
  flex: 1,
  overflowY: "auto",
  padding: "0 8px",
} satisfies React.CSSProperties;

const charListItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "10px 8px",
  border: "none",
  cursor: "pointer",
  textAlign: "left" as const,
  transition: "background 150ms ease",
} satisfies React.CSSProperties;

const activeBarStyle = {
  width: 3,
  height: 24,
  borderRadius: "0 999px 999px 0",
  background: "var(--accent)",
  flexShrink: 0,
} satisfies React.CSSProperties;

const avatarStyle = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  overflow: "hidden",
  background: "var(--bg-elevated)",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
} satisfies React.CSSProperties;

const leftPanelAddBtnStyle = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "var(--on-accent)",
  cursor: "pointer",
  transition: "background 150ms ease",
} satisfies React.CSSProperties;

const leftPanelIconBtnStyle = {
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "all 150ms ease",
} satisfies React.CSSProperties;

const resumeDraftBtnStyle = {
  width: "100%",
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-primary)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  textAlign: "center" as const,
  transition: "all 150ms ease",
} satisfies React.CSSProperties;

const detailHeaderStyle = {
  position: "sticky",
  top: 0,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  gap: 16,
  height: 80,
  padding: "0 32px",
  background: "var(--glass-bg)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  borderBottom: "1px solid var(--border-default)",
} satisfies React.CSSProperties;

const detailIconBtnStyle = {
  width: 36,
  height: 36,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "all 150ms ease",
} satisfies React.CSSProperties;

const generateBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 36,
  padding: "0 18px",
  borderRadius: 12,
  border: "none",
  background: "var(--status-success)",
  color: "var(--on-accent)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 150ms ease",
  whiteSpace: "nowrap",
} satisfies React.CSSProperties;

const sectionTitleStyle = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--text-muted)",
  marginBottom: 14,
} satisfies React.CSSProperties;

const sectionSubTitleStyle = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-muted)",
} satisfies React.CSSProperties;

const looksGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 14,
} satisfies React.CSSProperties;

const lookCardStyle = {
  position: "relative",
  width: "100%",
  aspectRatio: "160 / 180",
  borderRadius: 16,
  overflow: "hidden",
  border: "none",
  padding: 0,
  cursor: "pointer",
  transition: "all 200ms ease",
  background: "var(--bg-elevated)",
} satisfies React.CSSProperties;

const lookBadgeStyle = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 22,
  height: 22,
  borderRadius: "50%",
  background: "var(--status-success)",
  color: "var(--on-accent)",
  display: "grid",
  placeItems: "center",
} satisfies React.CSSProperties;

const newLookCardStyle = {
  width: "100%",
  aspectRatio: "160 / 180",
  borderRadius: 16,
  border: "2px dashed var(--border-default)",
  background: "transparent",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  transition: "all 150ms ease",
} satisfies React.CSSProperties;

const lookDetailContainerStyle = {
  background: "var(--bg-elevated)",
  borderRadius: 24,
  padding: 32,
} satisfies React.CSSProperties;

const refPrimaryBadgeStyle = {
  position: "absolute",
  top: 4,
  right: 4,
  width: 18,
  height: 18,
  borderRadius: "50%",
  background: "var(--status-success)",
  color: "var(--on-accent)",
  display: "grid",
  placeItems: "center",
} satisfies React.CSSProperties;

const attributeChipStyle = {
  display: "inline-flex",
  gap: 4,
  padding: "6px 14px",
  borderRadius: 999,
  background: "var(--bg-base)",
  border: "1px solid var(--border-default)",
  fontSize: 12,
  color: "var(--text-secondary)",
  lineHeight: 1.3,
} satisfies React.CSSProperties;

const promptTextareaStyle = {
  width: "100%",
  minHeight: 120,
  padding: "14px 16px",
  paddingRight: 44,
  borderRadius: 14,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.7,
  resize: "none" as const,
  outline: "none",
  fontFamily: "inherit",
} satisfies React.CSSProperties;

const copyPromptBtnStyle = {
  position: "absolute",
  top: 10,
  right: 10,
  width: 30,
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 8,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  color: "var(--text-muted)",
  cursor: "pointer",
  transition: "all 150ms ease",
} satisfies React.CSSProperties;

const emptyDetailStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  height: "100%",
  minHeight: 400,
} satisfies React.CSSProperties;

/* Modal styles */
const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 240,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "var(--backdrop-bg)",
  backdropFilter: "blur(8px)",
} satisfies React.CSSProperties;

const modalPanelStyle = {
  width: "min(520px, 100%)",
  display: "grid",
  gap: 18,
  padding: 28,
  borderRadius: 20,
  border: "1px solid var(--border-default)",
  background: "var(--bg-base)",
  boxShadow: "var(--shadow-modal)",
} satisfies React.CSSProperties;

const modalSelectStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid var(--border-default)",
  background: "var(--surface-tint)",
  color: "var(--text-primary)",
  fontSize: 13,
  outline: "none",
} satisfies React.CSSProperties;

const modalToggleStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "var(--text-muted)",
  fontSize: 13,
} satisfies React.CSSProperties;

const modalSecondaryBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 40,
  padding: "10px 20px",
  borderRadius: 10,
  border: "1px solid var(--border-default)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 150ms ease",
} satisfies React.CSSProperties;

const modalPrimaryBtnStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 40,
  padding: "10px 20px",
  borderRadius: 10,
  border: "none",
  background: "var(--accent)",
  color: "var(--on-accent)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  transition: "all 150ms ease",
} satisfies React.CSSProperties;
