import { readFile } from "@tauri-apps/plugin-fs";
import { getApiKey } from "@/lib/store";

const EVOLINK_API_BASE_URL = "https://api.evolink.ai/v1";
const EVOLINK_FILES_API_BASE_URL = "https://files-api.evolink.ai/api/v1";

type EvoLinkVideoInputMode = "image-to-video" | "text-to-video";

type EvoLinkCreditsResponse = {
  success?: boolean;
  message?: string;
  msg?: string;
  data?: {
    token?: {
      remaining_credits?: number;
    };
    user?: {
      remaining_credits?: number;
    };
  };
};

type EvoLinkFileUploadResponse = {
  success?: boolean;
  message?: string;
  msg?: string;
  data?: {
    file_url?: string;
  };
};

type EvoLinkTaskError = {
  code?: string;
  message?: string;
  type?: string;
};

type EvoLinkTaskResponse = {
  id?: string;
  progress?: number;
  results?: string[];
  status?: "pending" | "processing" | "completed" | "failed";
  error?: EvoLinkTaskError;
  task_info?: {
    video_duration?: number;
  };
};

function createAbortError(): Error {
  return typeof DOMException === "function"
    ? new DOMException("Islem iptal edildi.", "AbortError")
    : new Error("Islem iptal edildi.");
}

function normalizePathBasename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? "upload.bin";
}

function getFileExtension(filePath: string): string {
  const match = /(\.[^./\\]+)$/.exec(filePath);
  return match?.[1]?.toLowerCase() ?? "";
}

function resolveMimeType(filePath: string): string {
  const extension = getFileExtension(filePath);

  if ([".jpg", ".jpeg"].includes(extension)) {
    return "image/jpeg";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".mp4") {
    return "video/mp4";
  }

  if (extension === ".mov") {
    return "video/quicktime";
  }

  if (extension === ".webm") {
    return "video/webm";
  }

  if (extension === ".m4v") {
    return "video/mp4";
  }

  return "application/octet-stream";
}

function summarizeEvoLinkError(
  payload: unknown,
  fallback: string,
  statusCode?: number,
): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const errorRecord =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    const message =
      (typeof record.message === "string" && record.message.trim()) ||
      (typeof record.msg === "string" && record.msg.trim()) ||
      (typeof record.detail === "string" && record.detail.trim()) ||
      (typeof errorRecord?.message === "string" && errorRecord.message.trim());

    if (message) {
      return statusCode ? `${message} (HTTP ${statusCode})` : message;
    }
  }

  return statusCode ? `${fallback} (HTTP ${statusCode})` : fallback;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<T> {
  const response = await fetch(url, init);
  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    throw new Error(summarizeEvoLinkError(payload, fallbackMessage, response.status));
  }

  return payload as T;
}

async function waitForDelay(durationMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, durationMs);

    function cleanup() {
      globalThis.clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", handleAbort);
    }

    function handleAbort() {
      cleanup();
      reject(createAbortError());
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function resolveEvoLinkApiKey(apiKeyOverride?: string): Promise<string> {
  const apiKey = apiKeyOverride?.trim() || (await getApiKey("EVOLINK_API_KEY"))?.trim();

  if (!apiKey) {
    throw new Error("EvoLink API key bulunamadi. Ayarlardan ekleyin.");
  }

  return apiKey;
}

async function uploadLocalFileToEvoLink(filePath: string, apiKey: string): Promise<string> {
  const bytes = await readFile(filePath);
  const formData = new FormData();
  const blob = new Blob([bytes], { type: resolveMimeType(filePath) });

  formData.append("file", blob, normalizePathBasename(filePath));

  const response = await requestJson<EvoLinkFileUploadResponse>(
    `${EVOLINK_FILES_API_BASE_URL}/files/upload/stream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    },
    "EvoLink dosya yukleme istegi tamamlanamadi.",
  );

  if (response.success === false || !response.data?.file_url) {
    throw new Error(
      summarizeEvoLinkError(
        response,
        "EvoLink dosya yukleme yanitinda kullanilabilir URL bulunamadi.",
      ),
    );
  }

  return response.data.file_url;
}

export async function testEvoLinkConnection(
  apiKeyOverride?: string,
): Promise<{
  remainingUserCredits: number;
  remainingTokenCredits: number | null;
}> {
  const apiKey = await resolveEvoLinkApiKey(apiKeyOverride);
  const response = await requestJson<EvoLinkCreditsResponse>(
    `${EVOLINK_API_BASE_URL}/credits`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    "EvoLink kredi bilgisi okunamadi.",
  );

  if (response.success === false || !response.data?.user) {
    throw new Error(
      summarizeEvoLinkError(response, "EvoLink kredi bilgisi yaniti gecersiz."),
    );
  }

  return {
    remainingUserCredits: Number(response.data.user.remaining_credits ?? 0),
    remainingTokenCredits:
      typeof response.data.token?.remaining_credits === "number"
        ? response.data.token.remaining_credits
        : null,
  };
}

export async function generateVideoOnEvoLink(params: {
  remoteModel: string;
  inputMode: EvoLinkVideoInputMode;
  prompt: string;
  duration: number;
  aspectRatio?: string;
  quality: "720p" | "1080p";
  generateAudio?: boolean;
  elementIds?: string[];
  negativePrompt?: string;
  imageStartPath?: string;
  imageEndPath?: string;
  abortSignal?: AbortSignal;
  onProgress?: (pct: number) => void;
  supportsAudio?: boolean;
  supportsAspectRatio?: boolean;
  supportsNegativePrompt?: boolean;
  supportsElementList?: boolean;
}): Promise<{ url: string; requestId?: string; durationS?: number }> {
  const apiKey = await resolveEvoLinkApiKey();
  const input: Record<string, unknown> = {
    model: params.remoteModel,
    prompt: params.prompt,
    duration: params.duration,
    quality: params.quality,
  };
  const modelParams: Record<string, unknown> = {};

  if (params.inputMode === "image-to-video") {
    if (!params.imageStartPath) {
      throw new Error("EvoLink image-to-video icin START gorseli gerekli.");
    }

    input.image_start = await uploadLocalFileToEvoLink(params.imageStartPath, apiKey);

    if (params.imageEndPath) {
      input.image_end = await uploadLocalFileToEvoLink(params.imageEndPath, apiKey);
    }
  }

  if (params.supportsAspectRatio && params.aspectRatio) {
    input.aspect_ratio = params.aspectRatio;
  }

  if (params.supportsAudio) {
    input.sound = params.generateAudio ? "on" : "off";
  }

  if (params.supportsNegativePrompt && params.negativePrompt?.trim()) {
    input.negative_prompt = params.negativePrompt.trim();
  }

  if (params.supportsElementList) {
    const elementList = Array.from(
      new Set(
        (params.elementIds ?? [])
          .map((elementId) => elementId.trim())
          .filter(Boolean),
      ),
    )
      .slice(0, 3)
      .map((elementId) => ({
        element_id: elementId,
      }));

    if (elementList.length > 0) {
      modelParams.element_list = elementList;
    }
  }

  if (Object.keys(modelParams).length > 0) {
    input.model_params = modelParams;
  }

  params.onProgress?.(18);

  const submitResponse = await requestJson<EvoLinkTaskResponse>(
    `${EVOLINK_API_BASE_URL}/videos/generations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: params.abortSignal,
    },
    "EvoLink video istegi baslatilamadi.",
  );

  const requestId = submitResponse.id?.trim();

  if (!requestId) {
    throw new Error("EvoLink video istegi task ID donmedi.");
  }

  let lastKnownDuration = submitResponse.task_info?.video_duration;

  while (true) {
    if (params.abortSignal?.aborted) {
      throw createAbortError();
    }

    const statusResponse = await requestJson<EvoLinkTaskResponse>(
      `${EVOLINK_API_BASE_URL}/tasks/${requestId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: params.abortSignal,
      },
      "EvoLink task durumu okunamadi.",
    );

    if (typeof statusResponse.task_info?.video_duration === "number") {
      lastKnownDuration = statusResponse.task_info.video_duration;
    }

    if (statusResponse.status === "completed") {
      const videoUrl = statusResponse.results?.[0];

      if (!videoUrl) {
        throw new Error("EvoLink yanitinda indirilebilir video bulunamadi.");
      }

      params.onProgress?.(84);

      return {
        url: videoUrl,
        requestId,
        durationS:
          typeof lastKnownDuration === "number" && Number.isFinite(lastKnownDuration)
            ? lastKnownDuration
            : undefined,
      };
    }

    if (statusResponse.status === "failed") {
      throw new Error(
        summarizeEvoLinkError(
          statusResponse,
          "EvoLink video istegi tamamlanamadi.",
        ),
      );
    }

    const rawProgress =
      typeof statusResponse.progress === "number" ? statusResponse.progress : 0;

    if (statusResponse.status === "processing") {
      params.onProgress?.(Math.max(28, Math.min(78, Math.round(28 + rawProgress * 0.5))));
    } else {
      params.onProgress?.(22);
    }

    await waitForDelay(1400, params.abortSignal);
  }
}
