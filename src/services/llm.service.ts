import { getApiKey } from "@/lib/store";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "openrouter/auto";

export type PromptAssistMode =
  | "refine"
  | "shorten"
  | "translate-tr"
  | "translate-en";

function buildInstruction(mode: PromptAssistMode): string {
  if (mode === "refine") {
    return "Improve the prompt for production image or video generation. Preserve intent, concrete details, tone, and constraints. Return only the improved prompt.";
  }

  if (mode === "shorten") {
    return "Shorten the prompt while preserving all critical visual, cinematic, and constraint information. Return only the shortened prompt.";
  }

  if (mode === "translate-tr") {
    return "Translate the prompt to Turkish. Preserve structure, tone, and all cinematic details. Return only the translated prompt.";
  }

  return "Translate the prompt to English. Preserve structure, tone, and all cinematic details. Return only the translated prompt.";
}

export async function runPromptAssist(
  mode: PromptAssistMode,
  content: string,
): Promise<string> {
  const apiKey = (await getApiKey("OPENROUTER_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key bulunamadi. Ayarlardan ekleyin.");
  }

  if (!content.trim()) {
    throw new Error("Bos prompt yardimci islemine gonderilemez.");
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cineai.local",
      "X-Title": "CineAI Studio",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENROUTER_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: buildInstruction(mode),
        },
        {
          role: "user",
          content: content.trim(),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter istegi basarisiz oldu (${response.status}).`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const output = payload.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("OpenRouter yanitinda icerik bulunamadi.");
  }

  return output;
}
