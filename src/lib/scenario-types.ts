export type TargetVideoModel = "veo31" | "kling-3.0";

export type KlingPreset = "ultra-realism" | "balanced" | "custom";

export type ScenarioStatus = "draft" | "analyzing" | "planned" | "generating" | "done" | "error";

export interface ScenarioSceneUnit {
  sceneId: string;
  dramaticFunction: "setup" | "escalation" | "reveal" | "reaction" | "transition" | "payoff";
  pacePressure: "compressed" | "standard" | "extended";
  dialogueDensity: "none" | "light" | "medium" | "dense";
  motionDensity: "still" | "moderate" | "high";
  spatialComplexity: "simple" | "layered" | "reset-required";
  coverageNeed: "low" | "medium" | "high";
  minShots: number;
  targetShots: number;
  maxShots: number;
  reason: string;
}

export interface ScenarioShotSizing {
  method: "director-paced-balance";
  minFunctionalShots: number;
  maxTastefulShots: number;
  selectedTargetShots: number;
  globalRationale: string;
  sceneUnits: ScenarioSceneUnit[];
}

export interface ScenarioBatchPlan {
  batchId: string;
  shotStart: string;
  shotEnd: string;
  chainEntry: string;
  chainExitTarget: string | null;
}

export interface ShotPlan {
  scenes: ScenePlan[];
  totalMainShots: number;
  totalCoverageShots: number;
  estimatedDurationS: number;
  tensionArc: number[];
  dialogueNamePolicy: "preserve" | "anonymous";
  targetModel: TargetVideoModel;
  klingPreset?: KlingPreset;
  shotSizing?: ScenarioShotSizing;
  batches?: ScenarioBatchPlan[];
}

export interface ScenePlan {
  sceneNumber: number;
  title: string;
  summaryTr: string;
  shots: ShotPlanItem[];
  tensionLevel: number;
}

export interface ShotPlanItem {
  shotNumber: string;
  type: "main" | "coverage";
  coverageType?: "reaction" | "ots" | "insert" | "cutaway" | "ecu" | "wide";
  parentShotNumber?: string;
  durationS: number;
  hasDialogue: boolean;
  dialogueSpeakers?: string[];
  dialoguePreview?: string;
  chainStatus: "first" | "chained" | "break";
  chainBreakReason?: string;
  prevShotRef?: string;
  summaryTr: string;
  tensionLevel: number;
  sceneType?: "dialogue" | "action" | "emotional" | "establishing" | "suspense";
}

export interface GeneratedShot {
  shotNumber: string;
  parentShotNumber: string | null;
  sceneNumber: number;
  promptStart: string | null;
  promptEnd: string | null;
  promptVideo: string | null;
  summaryTr: string;
  durationS: number;
  tensionLevel: number;
  chainStatus: string;
  prevShotRef: string | null;
  shotType: string;
  cameraAngle: string | null;
  model: string;
  cfg: number | null;
  klingPreset: string | null;
  sourceFile?: string | null;
}

export interface GeneratedShotFile {
  shotNumber: string;
  sourceFile: string;
  markdown: string;
}

export interface GenerationProgress {
  currentPass: 1 | 2 | 3 | 4 | 5;
  passLabel: string;
  shotNumber?: string;
  completedShots: number;
  totalShots: number;
  percent: number;
}

export interface GenerationResult {
  shots: GeneratedShot[];
  shotFiles: GeneratedShotFile[];
  totalCostUsd: number;
  passLogs: PassLog[];
}

export interface PassLog {
  pass: number;
  label: string;
  durationMs: number;
  costUsd: number;
  shotCount: number;
}
