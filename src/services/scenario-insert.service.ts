import { join } from "@tauri-apps/api/path";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";
import { getProjectDb, syncProjectDbMirror } from "@/db/project-db";
import {
  createAudioContentHash,
  parseAudioDirection,
  resolveAudioShotStatus,
} from "@/lib/audio-direction-parser";
import type { GeneratedShot, GeneratedShotFile } from "@/lib/scenario-types";

function resolveStoredChainStatus(chainStatus: string): "continue" | "break" {
  return chainStatus === "chained" || chainStatus === "continue" ? "continue" : "break";
}

function shouldUsePreviousEndForStart(chainStatus: string): boolean {
  return chainStatus === "chained" || chainStatus === "continue";
}

function buildAudioStateFromPromptVideo(promptVideo: string | null) {
  if (!promptVideo) {
    return {
      audioDirectionJson: null,
      audioDialoguePreview: null,
      audioStatus: "none",
      audioContentHash: null,
    };
  }

  const parsed = parseAudioDirection(promptVideo);

  if (!parsed) {
    return {
      audioDirectionJson: null,
      audioDialoguePreview: null,
      audioStatus: "none",
      audioContentHash: null,
    };
  }

  return {
    audioDirectionJson: JSON.stringify(parsed),
    audioDialoguePreview: parsed.dialoguePreview,
    audioStatus: resolveAudioShotStatus(parsed),
    audioContentHash: createAudioContentHash(parsed),
  };
}

export async function insertGeneratedShots(params: {
  projectId: string;
  shots: GeneratedShot[];
  scenarioId: string;
  clearExisting?: boolean;
}): Promise<void> {
  const db = await getProjectDb();
  const now = Date.now();

  if (params.clearExisting) {
    await db.execute("DELETE FROM shots WHERE project_id = $1", [params.projectId]);
  }

  const idMap = new Map<string, string>();

  for (const shot of params.shots) {
    idMap.set(shot.shotNumber.toUpperCase(), uuidv4());
  }

  for (const shot of params.shots) {
    const id = idMap.get(shot.shotNumber.toUpperCase())!;
    const parentId = shot.parentShotNumber
      ? (idMap.get(shot.parentShotNumber.toUpperCase()) ?? null)
      : null;
    const prevShotId = shot.prevShotRef
      ? (idMap.get(shot.prevShotRef.toUpperCase()) ?? null)
      : null;
    const audioState = buildAudioStateFromPromptVideo(shot.promptVideo);

    await db.execute(
      `INSERT INTO shots (
        id, project_id, shot_number, parent_shot_id,
        act, scene, shot_type, camera_angle,
        duration_s, tension_level, chain_status, use_previous_end_for_start, prev_shot_id,
        prompt_start, prompt_end, prompt_video, summary_tr,
        model, cfg, kling_preset, transition_mode,
        requires_external_reference, external_reference_name, external_reference_notes,
        external_reference_path, character_id, character_look_id, include_character_prompt,
        image_start_path, image_end_path, video_path, video_4k_path,
        image_status, video_status, upscale_status,
        is_archived,
        audio_direction_json, audio_dialogue_preview, audio_status, audio_master_path,
        audio_model_used, audio_output_format, audio_character_count, audio_cost_usd,
        audio_timestamps_json, audio_content_hash, audio_error,
        audio_optimized_dialogue_json, audio_optimized_dialogue_preview,
        audio_optimizer_model, audio_optimizer_source_hash,
        audio_generation_profile_json,
        audio_dialogue_override_json, audio_take_history_json,
        audio_voiceover_text,
        source_file, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
        $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
        $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
        $51, $52, $53, $54, $55, $56, $57, $58, $59
      )`,
      [
        id,
        params.projectId,
        shot.shotNumber,
        parentId,
        null,
        shot.sceneNumber,
        shot.shotType,
        shot.cameraAngle,
        shot.durationS,
        shot.tensionLevel,
        resolveStoredChainStatus(shot.chainStatus),
        shouldUsePreviousEndForStart(shot.chainStatus) ? 1 : 0,
        prevShotId,
        shot.promptStart,
        shot.promptEnd,
        shot.promptVideo,
        shot.summaryTr,
        shot.model,
        shot.cfg,
        shot.klingPreset,
        null,
        0,
        null,
        null,
        null,
        null,
        null,
        1,
        null,
        null,
        null,
        null,
        "pending",
        "pending",
        "none",
        0,
        audioState.audioDirectionJson,
        audioState.audioDialoguePreview,
        audioState.audioStatus,
        null,
        null,
        null,
        null,
        null,
        null,
        audioState.audioContentHash,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        shot.sourceFile ?? `scenario:${params.scenarioId}`,
        now,
        now,
      ],
    );
  }

  await syncProjectDbMirror();
}

export async function persistGeneratedShotFiles(params: {
  projectFolderPath: string;
  scenarioId: string;
  shotFiles: GeneratedShotFile[];
}): Promise<string> {
  const outputDir = await join(
    params.projectFolderPath,
    ".cineai",
    "scenario-studio",
    params.scenarioId,
    "shots",
  );

  await mkdir(outputDir, { recursive: true });

  for (const shotFile of params.shotFiles) {
    const targetPath = await join(outputDir, `${shotFile.shotNumber}.md`);
    await writeTextFile(targetPath, shotFile.markdown);
  }

  return outputDir;
}
