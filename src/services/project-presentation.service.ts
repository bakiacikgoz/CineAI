import { getProjectDb } from "@/db/project-db";
import { computeProjectPresentationSummary } from "@/lib/project-summary";
import { updateProjectPresentation } from "@/services/project.service";
import { useProjectStore } from "@/store/project.store";

type ShotPresentationRow = {
  parentShotId: string | null;
  isArchived: number;
  imageStartPath: string | null;
  imageEndPath: string | null;
  videoPath: string | null;
  video4kPath: string | null;
  updatedAt: number;
};

export async function syncActiveProjectPresentation(): Promise<void> {
  const project = useProjectStore.getState().activeProject;

  if (!project) {
    return;
  }

  const db = await getProjectDb();
  const shots = await db.select<ShotPresentationRow[]>(
    `SELECT
       parent_shot_id AS parentShotId,
       COALESCE(is_archived, 0) AS isArchived,
       image_start_path AS imageStartPath,
       image_end_path AS imageEndPath,
       video_path AS videoPath,
       video_4k_path AS video4kPath,
       updated_at AS updatedAt
     FROM shots
     WHERE project_id = $1`,
    [project.id],
  );

  await updateProjectPresentation(
    project,
    computeProjectPresentationSummary(
      shots.map((shot) => ({
        ...shot,
        isArchived: Boolean(shot.isArchived),
      })),
    ),
  );
}
