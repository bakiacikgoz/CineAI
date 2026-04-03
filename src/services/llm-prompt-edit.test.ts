import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiKeyMock, fetchMock } = vi.hoisted(() => ({
  getApiKeyMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getApiKey: getApiKeyMock,
}));

import { runSurgicalPromptEdit } from "@/services/llm.service";

describe("runSurgicalPromptEdit", () => {
  beforeEach(() => {
    getApiKeyMock.mockReset();
    fetchMock.mockReset();
    getApiKeyMock.mockResolvedValue("test-openrouter-key");
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the original prompt and requested change to OpenRouter and returns plain prompt text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openrouter/auto",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                "```text\nClose-up on the ring in the actor's hand, same camera angle, remove the table.\n```",
            },
          },
        ],
      }),
    });

    const output = await runSurgicalPromptEdit({
      originalPrompt:
        "Close-up on the ring in the actor's hand, same camera angle, table visible.",
      editInstruction: "Masayi kaldir, baska hicbir seyi degistirme.",
      promptKind: "start",
      shotNumber: "SHOT12B",
      shotType: "Insert",
      cameraAngle: "Close-up",
      summaryTr: "Yuzuk detayi.",
      model: "openrouter/auto",
    });

    expect(output).toBe(
      "Close-up on the ring in the actor's hand, same camera angle, remove the table.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.model).toBe("openrouter/auto");
    expect(body.messages[0]?.content).toContain("surgically revise an existing generation prompt");
    expect(body.messages[1]?.content).toContain("SHOT12B");
    expect(body.messages[1]?.content).toContain("Masayi kaldir, baska hicbir seyi degistirme.");
    expect(body.messages[1]?.content).toContain("table visible");
  });

  it("rejects empty edit instructions before making a network call", async () => {
    await expect(
      runSurgicalPromptEdit({
        originalPrompt: "Static medium shot.",
        editInstruction: "   ",
        promptKind: "video",
      }),
    ).rejects.toThrow("Prompt duzeltme talimati bos olamaz.");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once when the first AI response does not materially change the prompt", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "openrouter/auto",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "Close-up on the ring in the actor's hand, same camera angle, table visible.",
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: "openrouter/auto",
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  "Close-up on the ring in the actor's hand, same camera angle, the table removed.",
              },
            },
          ],
        }),
      });

    const output = await runSurgicalPromptEdit({
      originalPrompt:
        "Close-up on the ring in the actor's hand, same camera angle, table visible.",
      editInstruction: "Masayi kaldir, baska hicbir seyi degistirme.",
      promptKind: "start",
      model: "openrouter/auto",
    });

    expect(output).toBe(
      "Close-up on the ring in the actor's hand, same camera angle, the table removed.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryRequestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const retryBody = JSON.parse(String(retryRequestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(retryBody.messages[0]?.content).toContain("A no-op rewrite is not acceptable.");
  });

  it("fails when AI still returns a no-op prompt after retry", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "openrouter/auto",
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "Static medium shot in the corridor.",
            },
          },
        ],
      }),
    });

    await expect(
      runSurgicalPromptEdit({
        originalPrompt: "Static medium shot in the corridor.",
        editInstruction: "Kamerayi yakinlastir ama diger her seyi koru.",
        promptKind: "end",
        model: "openrouter/auto",
      }),
    ).rejects.toThrow("AI duzeltme talimati promptta olculebilir bir degisiklik uretemedi.");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
