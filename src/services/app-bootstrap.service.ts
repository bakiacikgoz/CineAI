import {
  clearLastActiveProjectPath,
  getAppSettings,
  getLastActiveProjectPath,
} from "@/lib/store";
import { openProject } from "@/services/project.service";
import { activateProject } from "@/services/project-session.service";
import { useQueueStore } from "@/store/queue.store";

export async function hydrateAppState(): Promise<void> {
  const settings = await getAppSettings();
  useQueueStore.getState().setParallelLimit(settings.queueParallelLimit);

  const lastActiveProjectPath = await getLastActiveProjectPath();

  if (!lastActiveProjectPath) {
    return;
  }

  try {
    const project = await openProject(lastActiveProjectPath);
    await activateProject(project, { touch: true });
  } catch {
    await clearLastActiveProjectPath();
  }
}
