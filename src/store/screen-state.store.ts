import { create } from "zustand";
import type { CharacterStudioDraft } from "@/screens/characters/CharacterStudioModal";
import type {
  KlingShotType,
  VideoAspectRatio,
  VideoModelId,
} from "@/services/fal.service";

export type StoryboardScreenState = {
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  showArchived: boolean;
  selectedShotId: string | null;
  detailModalView: "start" | "end" | "video";
};

export type ImageGeneratorScreenState = {
  mode: "shot-linked" | "freeform";
  selectedShotId: string;
  shotStage: "start" | "end";
  prompt: string;
  model: string;
  aspectRatio: string;
  cfg: number;
  steps: number;
  quantity: number;
  refImage: string | null;
  galleryActiveGroupKey: string;
  galleryGroupDraft: string;
  gallerySelectedGroupTarget: string;
  galleryPage: number;
};

export type VideoGeneratorScreenState = {
  mode: "shot-linked" | "freeform";
  selectedShotId: string;
  startAssetId: string;
  endAssetId: string;
  localStartPath: string | null;
  localEndPath: string | null;
  prompt: string;
  model: VideoModelId;
  duration: number;
  aspectRatio: VideoAspectRatio;
  cfg: number;
  generateAudio: boolean;
  shotType: KlingShotType;
  galleryActiveGroupKey: string;
  galleryGroupDraft: string;
  gallerySelectedGroupTarget: string;
  galleryPage: number;
};

export type CharactersScreenState = {
  search: string;
  showStudio: boolean;
  draft: CharacterStudioDraft | null;
  activeLookId: string | null;
  candidateAspectRatio: string;
  candidateQuantity: number;
  selectedCharacterId: string | null;
  viewedLookId: string | null;
  showAssignModal: boolean;
  assignShotId: string;
  assignLookId: string;
  assignIncludePrompt: boolean;
  studioTab: "profile" | "looks" | "voice" | "generation";
};

type ScreenStateStore = {
  storyboardByProject: Record<string, StoryboardScreenState>;
  imageGeneratorByProject: Record<string, ImageGeneratorScreenState>;
  videoGeneratorByProject: Record<string, VideoGeneratorScreenState>;
  charactersByProject: Record<string, CharactersScreenState>;
  setStoryboardState: (
    projectId: string,
    patch: Partial<StoryboardScreenState>,
  ) => void;
  setImageGeneratorState: (
    projectId: string,
    patch: Partial<ImageGeneratorScreenState>,
  ) => void;
  setVideoGeneratorState: (
    projectId: string,
    patch: Partial<VideoGeneratorScreenState>,
  ) => void;
  setCharactersState: (
    projectId: string,
    patch: Partial<CharactersScreenState>,
  ) => void;
  clearProjectScreenState: (projectId: string) => void;
};

export const useScreenStateStore = create<ScreenStateStore>((set) => ({
  storyboardByProject: {},
  imageGeneratorByProject: {},
  videoGeneratorByProject: {},
  charactersByProject: {},
  setStoryboardState: (projectId, patch) =>
    set((state) => ({
      storyboardByProject: {
        ...state.storyboardByProject,
        [projectId]: {
          ...state.storyboardByProject[projectId],
          ...patch,
        } as StoryboardScreenState,
      },
    })),
  setImageGeneratorState: (projectId, patch) =>
    set((state) => ({
      imageGeneratorByProject: {
        ...state.imageGeneratorByProject,
        [projectId]: {
          ...state.imageGeneratorByProject[projectId],
          ...patch,
        } as ImageGeneratorScreenState,
      },
    })),
  setVideoGeneratorState: (projectId, patch) =>
    set((state) => ({
      videoGeneratorByProject: {
        ...state.videoGeneratorByProject,
        [projectId]: {
          ...state.videoGeneratorByProject[projectId],
          ...patch,
        } as VideoGeneratorScreenState,
      },
    })),
  setCharactersState: (projectId, patch) =>
    set((state) => ({
      charactersByProject: {
        ...state.charactersByProject,
        [projectId]: {
          ...state.charactersByProject[projectId],
          ...patch,
        } as CharactersScreenState,
      },
    })),
  clearProjectScreenState: (projectId) =>
    set((state) => {
      const { [projectId]: _storyboardRemoved, ...storyboardByProject } =
        state.storyboardByProject;
      const { [projectId]: _imageRemoved, ...imageGeneratorByProject } =
        state.imageGeneratorByProject;
      const { [projectId]: _videoRemoved, ...videoGeneratorByProject } =
        state.videoGeneratorByProject;
      const { [projectId]: _charactersRemoved, ...charactersByProject } =
        state.charactersByProject;

      return {
        storyboardByProject,
        imageGeneratorByProject,
        videoGeneratorByProject,
        charactersByProject,
      };
    }),
}));
