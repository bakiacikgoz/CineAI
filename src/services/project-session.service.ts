import { clearLastActiveProjectPath, setLastActiveProjectPath } from "@/lib/store";
import { touchProject, type ProjectMeta } from "@/services/project.service";
import { useProjectStore } from "@/store/project.store";

export async function activateProject(
  project: ProjectMeta,
  options?: { touch?: boolean },
): Promise<ProjectMeta> {
  const nextProject = options?.touch
    ? { ...project, updatedAt: Date.now() }
    : project;

  if (options?.touch) {
    await touchProject(project.id);
  }

  useProjectStore.getState().setActiveProject(nextProject);
  await setLastActiveProjectPath(nextProject.folderPath);
  return nextProject;
}

export async function clearProjectSession(): Promise<void> {
  useProjectStore.getState().clearActiveProject();
  await clearLastActiveProjectPath();
}
