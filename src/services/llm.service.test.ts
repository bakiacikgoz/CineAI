import { describe, expect, it } from "vitest";
import {
  autoCloseJsonDelimiters,
  estimateDialogueTimingGuidance,
  estimatePromptDialogueWindowSeconds,
  formatOpenRouterProvider,
  inferOpenRouterProvider,
  polishTurkishDialogueFluency,
  preserveDialogueMeaning,
  resolveDialoguePerformanceProfile,
  stabilizeDialogueDeliveryCue,
} from "@/services/llm.service";

describe("dialogue timing guidance", () => {
  it("normalizes provider ids and friendly provider labels for the model picker", () => {
    expect(inferOpenRouterProvider("anthropic/claude-sonnet-4")).toBe("anthropic");
    expect(inferOpenRouterProvider("openrouter/auto")).toBe("openrouter");
    expect(formatOpenRouterProvider("x-ai")).toBe("xAI");
    expect(formatOpenRouterProvider("meta-llama")).toBe("Meta");
    expect(formatOpenRouterProvider("some-custom-lab")).toBe("Some Custom Lab");
  });

  it("can auto-close truncated json delimiters when only the tail is missing", () => {
    expect(
      autoCloseJsonDelimiters('{"scenes":[{"sceneNumber":1,"shots":[{"shotNumber":"SHOT01"}]}'),
    ).toBe('{"scenes":[{"sceneNumber":1,"shots":[{"shotNumber":"SHOT01"}]}]}');

    expect(autoCloseJsonDelimiters('{"broken":[}')).toBeNull();
  });

  it("detects the actual kling dialogue segment window instead of using the full shot", () => {
    const promptVideo = `
Shot 1, Low angle close-up looking up at his face. (5s)

Shot 2, Extreme close-up of his belt area. (5s)

Shot 3, Close-up over his chest perfectly matching the end frame composition. (5s)

harsh static phone voice, "Yasananlari biliyorsun. O haini vur. Asla oraya girememeli."
steadily, "Bas ustune. Gorev anlasilmistir."
    `;

    expect(estimatePromptDialogueWindowSeconds(promptVideo)).toBe(5);
  });

  it("compresses dialogue against the detected prompt segment instead of the total shot duration", () => {
    const promptVideo = `
Shot 1, Low angle close-up looking up at his face. (5s)
Shot 2, Extreme close-up of his belt area. (5s)
Shot 3, Close-up over his chest perfectly matching the end frame composition. (5s)
harsh static phone voice, "Yasananlari biliyorsun. O haini vur. Asla oraya girememeli."
steadily, "Bas ustune. Gorev anlasilmistir."
    `;

    const timing = estimateDialogueTimingGuidance({
      shotDurationS: 15,
      promptVideo,
      lines: [
        {
          speaker: "Phone Voice",
          text: "Yasananlari biliyorsun. O haini vur. Asla oraya girememeli. Bu is bu gece bitecek.",
        },
        {
          speaker: "On-Screen Character",
          text: "Bas ustune. Gorev anlasilmistir. Hemen harekete geciyorum komutanim.",
        },
      ],
    });

    expect(timing.promptDetectedDialogueWindowSeconds).toBe(5);
    expect(timing.effectiveDialogueWindowSeconds).toBe(5);
    expect(timing.recommendedDialogueWindowSeconds).toBeLessThanOrEqual(4.5);
    expect(timing.shouldCompressForTime).toBe(true);
  });

  it("keeps long shots from allocating almost the entire runtime to speech when no segment cue exists", () => {
    const timing = estimateDialogueTimingGuidance({
      shotDurationS: 15,
      lines: [
        {
          speaker: "Komutan",
          text: "Ozel bir ekip getiriyor. Sana sonu sehadet gorunen bir gorev veriyorum. Hakkini helal et, Omer.",
        },
        {
          speaker: "Omer",
          text: "Helal olsun komutanim. Siz de hakkinizi helal edin.",
        },
      ],
    });

    expect(timing.promptDetectedDialogueWindowSeconds).toBeNull();
    expect(timing.recommendedDialogueWindowSeconds).toBeLessThanOrEqual(7.5);
    expect(timing.recommendedDialogueWindowSeconds).toBeLessThan(
      timing.shotDurationSeconds ?? Number.POSITIVE_INFINITY,
    );
  });

  it("keeps minimal fluency edits but rejects meaning drift", () => {
    expect(
      preserveDialogueMeaning(
        "Bas ustune komutanim gorev anlasilmistir",
        "Bas ustune, komutanim. Gorev anlasilmistir.",
      ),
    ).toBe("Bas ustune, komutanim. Gorev anlasilmistir.");

    expect(
      preserveDialogueMeaning(
        "O haini vur. Asla oraya girememeli.",
        "Onu yakalayin. Oraya ulasmasina izin vermeyin.",
      ),
    ).toBe("O haini vur. Asla oraya girememeli.");
  });

  it("keeps delivery audible and natural unless the prompt explicitly wants low projection", () => {
    const phoneCommandCue = stabilizeDialogueDeliveryCue({
      delivery: "quietly resolute",
      sourceText: "Bas ustune. Gorev anlasilmistir.",
      promptVideo: 'harsh static phone voice, "Bas ustune. Gorev anlasilmistir."',
    });
    expect(phoneCommandCue).toContain("command");

    const conversationCue = stabilizeDialogueDeliveryCue({
      delivery: null,
      sourceText: "Normal konusalim, sorun yok.",
      promptVideo: "Same room conversation.",
    });
    expect(conversationCue).toContain("natural");

    expect(
      stabilizeDialogueDeliveryCue({
        delivery: "softly shaken",
        sourceText: "Tamam... duyuyorum.",
        promptVideo: 'he whispers under breath, "Tamam... duyuyorum."',
      }),
    ).toBe("softly shaken");
  });

  it("adds minimal speech polish without changing meaning", () => {
    expect(
      polishTurkishDialogueFluency("bas ustune komutanim gorev anlasilmistir"),
    ).toBe("Bas ustune, komutanim. Gorev anlasilmistir.");

    expect(
      polishTurkishDialogueFluency("helal olsun komutanim siz de hakkinizi helal edin"),
    ).toBe("Helal olsun, komutanim. Siz de hakkinizi helal edin.");
  });

  it("builds a stronger performance profile for command and pressure scenes", () => {
    const commandProfile = resolveDialoguePerformanceProfile({
      summaryTr: "Komutan buyuk baski altinda vur emri veriyor.",
      promptVideo:
        'harsh static phone voice, "O haini vur. Asla oraya girememeli." steadily, "Bas ustune. Gorev anlasilmistir."',
    });
    expect(commandProfile.intensity).toBe("high");
    expect(commandProfile.baselineCue).toContain("command");
    expect(commandProfile.recommendedStability).toBeLessThan(0.4);
    expect(commandProfile.recommendedSimilarityBoost).toBeGreaterThan(0.7);

    const conversationProfile = resolveDialoguePerformanceProfile({
      summaryTr: "Iki kisi sakin bir odada normal sekilde konusuyor.",
      promptVideo: 'He says, "Tamam, anladim."',
    });
    expect(conversationProfile.preset).toBe("auto");
    expect(conversationProfile.intensity).toBe("low");
    expect(conversationProfile.baselineCue).toContain("natural");
    expect(conversationProfile.recommendedStability).toBeGreaterThanOrEqual(0.45);
  });

  it("respects an explicit performance preset override", () => {
    const threatProfile = resolveDialoguePerformanceProfile({
      preset: "threat",
      note: "Soguk ama bagirarak degil.",
      summaryTr: "Normal bir sahne ozeti olsa bile override galip gelmeli.",
    });
    expect(threatProfile.preset).toBe("threat");
    expect(threatProfile.intensity).toBe("high");
    expect(threatProfile.baselineCue).toContain("dangerous");
    expect(threatProfile.recommendedStability).toBeLessThan(0.4);
    expect(threatProfile.recommendedSimilarityBoost).toBeGreaterThan(0.7);
  });
});
