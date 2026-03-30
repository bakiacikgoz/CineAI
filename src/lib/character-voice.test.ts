import { describe, expect, it } from "vitest";
import {
  EMPTY_CHARACTER_VOICE_STATE,
  buildCharacterVoiceState,
  hasCharacterVoiceSelection,
  resolveCharacterVoiceState,
} from "@/lib/character-voice";

describe("character voice helpers", () => {
  it("hydrates a persisted binding into stable draft state", () => {
    const voice = buildCharacterVoiceState({
      id: "binding-1",
      projectId: "project-1",
      characterId: "character-1",
      voiceId: "voice-1",
      voiceName: "Aylin",
      voiceProvider: "elevenlabs",
      modelId: "eleven_multilingual_v2",
      createdAt: 1,
      updatedAt: 2,
    });

    expect(voice).toEqual({
      voiceId: "voice-1",
      voiceName: "Aylin",
      voiceProvider: "elevenlabs",
      modelId: "eleven_multilingual_v2",
      isMissing: false,
    });
  });

  it("marks missing voice state when binding is cleared", () => {
    expect(resolveCharacterVoiceState(null)).toEqual(EMPTY_CHARACTER_VOICE_STATE);
    expect(hasCharacterVoiceSelection(null)).toBe(false);
  });

  it("normalizes partial draft state without losing missing flag behavior", () => {
    const voice = resolveCharacterVoiceState({
      voiceId: "  ",
      voiceName: "  Demo  ",
      voiceProvider: " elevenlabs ",
      modelId: null,
    });

    expect(voice).toEqual({
      voiceId: null,
      voiceName: "Demo",
      voiceProvider: "elevenlabs",
      modelId: null,
      isMissing: true,
    });
  });
});
