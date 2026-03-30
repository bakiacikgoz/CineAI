import { readFile, writeFile } from "@tauri-apps/plugin-fs";

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",
};

function getVideoExtension(absolutePath: string): string {
  const match = /(\.[^./\\]+)$/.exec(absolutePath);
  return match?.[1]?.toLowerCase() ?? "";
}

async function createVideoObjectUrl(absolutePath: string): Promise<string> {
  const bytes = await readFile(absolutePath);
  const mimeType =
    VIDEO_MIME_BY_EXTENSION[getVideoExtension(absolutePath)] ?? "video/mp4";
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

async function waitForEvent(
  target: EventTarget,
  eventName: string,
  errorEventName = "error",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      target.removeEventListener(eventName, handleResolve);
      target.removeEventListener(errorEventName, handleReject);
    }

    function handleResolve() {
      cleanup();
      resolve();
    }

    function handleReject() {
      cleanup();
      reject(new Error("Video karesi okunamadi."));
    }

    target.addEventListener(eventName, handleResolve, { once: true });
    target.addEventListener(errorEventName, handleReject, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, targetTime: number): Promise<void> {
  const normalizedTarget = Number.isFinite(targetTime) ? Math.max(0, targetTime) : 0;

  if (Math.abs(video.currentTime - normalizedTarget) < 0.01 && video.readyState >= 2) {
    return;
  }

  const seekPromise = waitForEvent(video, "seeked");
  video.currentTime = normalizedTarget;
  await seekPromise;

  if (video.readyState < 2) {
    await waitForEvent(video, "loadeddata");
  }
}

function createHiddenVideoElement(): { wrapper: HTMLDivElement; video: HTMLVideoElement } {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.pointerEvents = "none";
  wrapper.style.opacity = "0";
  wrapper.style.width = "1px";
  wrapper.style.height = "1px";
  wrapper.style.overflow = "hidden";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";

  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;

  wrapper.appendChild(video);
  document.body.appendChild(wrapper);

  return { wrapper, video };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Video karesi PNG olarak olusturulamadi."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

export async function extractVideoLastFrameToPng(params: {
  videoAbsolutePath: string;
  destinationAbsolutePath: string;
}): Promise<{ width: number; height: number }> {
  if (typeof document === "undefined") {
    throw new Error("Video kare cikarimi icin tarayici ortami gerekli.");
  }

  const { wrapper, video } = createHiddenVideoElement();
  let objectUrl: string | null = null;

  try {
    objectUrl = await createVideoObjectUrl(params.videoAbsolutePath);
    video.src = objectUrl;
    video.load();

    if (video.readyState < 1 || !Number.isFinite(video.duration)) {
      await waitForEvent(video, "loadedmetadata");
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const targetTime =
      duration > 0 ? Math.max(0, duration - Math.min(0.08, duration / 20)) : 0;
    await seekVideo(video, targetTime);

    const width = Math.max(1, Math.round(video.videoWidth || 1));
    const height = Math.max(1, Math.round(video.videoHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas baglami olusturulamadi.");
    }

    context.drawImage(video, 0, 0, width, height);
    const blob = await canvasToBlob(canvas);
    const buffer = await blob.arrayBuffer();
    await writeFile(params.destinationAbsolutePath, new Uint8Array(buffer));

    return { width, height };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    wrapper.remove();
  }
}
