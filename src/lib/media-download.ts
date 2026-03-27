import { save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? "media";
}

function getFileExtension(path: string): string {
  const fileName = getFileName(path);
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

function buildFilters(path: string) {
  const extension = getFileExtension(path);

  if (!extension) {
    return undefined;
  }

  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) {
    return [{ name: "Images", extensions: [extension] }];
  }

  if (["mp4", "mov", "webm", "mkv"].includes(extension)) {
    return [{ name: "Videos", extensions: [extension] }];
  }

  return [{ name: "Files", extensions: [extension] }];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export async function downloadMediaFile({
  sourcePath,
  suggestedName,
  dialogTitle = "CineAI",
}: {
  sourcePath: string;
  suggestedName?: string | null;
  dialogTitle?: string;
}): Promise<boolean> {
  const targetPath = await save({
    title: dialogTitle,
    defaultPath: suggestedName ?? getFileName(sourcePath),
    filters: buildFilters(suggestedName ?? sourcePath),
    canCreateDirectories: true,
  });

  if (!targetPath) {
    return false;
  }

  if (normalizePath(targetPath) === normalizePath(sourcePath)) {
    return true;
  }

  const bytes = await readFile(sourcePath);
  await writeFile(targetPath, bytes, { create: true });
  return true;
}
