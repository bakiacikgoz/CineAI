import type {
  GeneratedShot,
  ScenePlan,
  ShotPlan,
  ShotPlanItem,
  TargetVideoModel,
} from "@/lib/scenario-types";
import { parseShot } from "@/lib/markdown-parser";

// ─── SKILL RULES (film-kit 8 skill encoded as numbered rules) ─────────

const SAFETY_COMPLIANCE_RULES = [
  "SAFETY-01: NEVER include any real person's name in ANY visual prompt. Replace with detailed physical descriptions (age, hair, build, clothing).",
  "SAFETY-02: AUTO-ANONYMOUS is automatic. Scan all character names, historical figures, celebrities and replace with physical descriptions in visual prompts.",
  "SAFETY-03: Dialogue transcripts in Audio Direction preserve original names and language verbatim. Anonymization applies ONLY to visual prompts.",
  "SAFETY-04: AUTO-SAFETY: Proactively reframe content that may trigger platform safety filters. War scenes → documentary approach, equipment focus. Violence → reaction shots, environmental impact. Weapons → mechanical operation, recoil, muzzle flash (never show impact on human body).",
  "SAFETY-05: Safe framing for military/historical: 'Historical reenactment style. Documentary approach. Non-graphic representation. Focus on scale, atmosphere, environmental storytelling.'",
  "SAFETY-06: Minors on screen → Dialogue transcript: NONE (platform requirement).",
  "SAFETY-07: Never script threatening dialogue, graphic violence descriptions, or hate speech in audio transcripts.",
].join("\n");

const PROMPT_STRUCTURE_RULES = [
  "PROMPT-01: Every prompt follows mandatory 7-step flow order. First sentence = highest weight in AI model.",
  "PROMPT-02: Flow order: 1) Scene summary (single sentence answering 'What is this shot?'), 2) Who/What/Where (character physical description, costume, position), 3) Action (micro-behavior, acting cue, physical gesture), 4) Camera+Lens (specific mm, aperture, movement/stabilization), 5) Light+Atmosphere (key light direction, color temperature, mood), 6) Audio Direction block (VIDEO prompts only), 7) Avoid line (MANDATORY on EVERY prompt).",
  "PROMPT-03: Image prompts minimum 80 words. Video prompts minimum 120 words. Coverage prompts minimum 60 words.",
  "PROMPT-04: Use specific action verbs ('strides' not 'walks', 'glides' not 'moves'). Use professional cinematography terms (dolly, crane, Steadicam, rack focus).",
  "PROMPT-05: Lens selection: 24mm wide/environmental, 35mm natural wide, 50mm standard, 85mm portrait/compression, 135mm+ telephoto.",
  "PROMPT-06: Aperture: f/1.4-2.0 shallow isolation, f/2.8 portrait, f/4 balanced, f/5.6-8 environmental, f/11+ landscapes.",
  "PROMPT-07: Image Avoid line MUST include: blurry, low-res, noise, distorted faces, bad anatomy, extra limbs/fingers, plastic skin, waxy skin, airbrushed skin, on-screen text, watermark, logo, cartoon/anime style, CGI look, uncanny valley.",
  "PROMPT-08: Video Avoid line MUST include: distorted faces, morphing, bad anatomy, extra limbs/fingers, blurry, flickering, inconsistent lighting, unnatural motion, warping, on-screen text, watermark, cartoon/anime, CGI motion, robotic movement.",
  "PROMPT-09: Prompt length 80-120 words for video gives maximum control over AI model behavior. Too short = model invents, too long = model ignores.",
].join("\n");

const FRAME_CHAINING_RULES = [
  "CHAIN-01: LAST FRAME of shot N MUST become FIRST FRAME of shot N+1. Default: 95% of shots must chain.",
  "CHAIN-02: Naming: SHOTNN_START (first frame), SHOTNN_END (last frame). Chained shot reuses previous END as START.",
  "CHAIN-03: First shot generates both START and END frames. All subsequent chained shots generate only END frame.",
  "CHAIN-04: Chain break permitted ONLY for: location change, time jump, dream/flashback, character transformation, extreme camera reset.",
  "CHAIN-05: Chain break must declare transition type: Hard Cut, Fade to Black, Cross-Dissolve, Match Cut, Smash Cut.",
  "CHAIN-06: End frame design rules: No extreme close-ups, no off-balance compositions, no motion blur, no unusual angles, no character exiting frame. Must allow natural continuation.",
  "CHAIN-07: Frame continuity checklist: Camera position compatible, subject gaze/facing matches, subject consistency across cut.",
].join("\n");

const COVERAGE_SYSTEM_RULES = [
  "COV-01: EVERY main shot MUST have 2-3 coverage shots. No exceptions. Coverage provides editing flexibility.",
  "COV-02: Six coverage types: Reaction (R) CU 85mm f/2.0, Over-the-Shoulder (OTS) MS 50mm f/2.8, Insert (INS) CU/ECU 50-100mm f/4-5.6, Cutaway (CUT) variable, Extreme Close-Up (ECU) 100mm+ f/2.0, Wide Cutaway (WC) 24-35mm f/8-11.",
  "COV-03: Coverage naming: Main SHOT05 → Coverage SHOT05A, SHOT05B, SHOT05C (alphabetical).",
  "COV-04: Scene type → Coverage matrix: Dialogue scenes → Reaction + OTS + Insert. Action scenes → Insert + ECU + Wide. Emotional scenes → Reaction + ECU + Cutaway. Establishing scenes → Wide + Cutaway + Insert. Suspense → ECU + Cutaway + Reaction.",
  "COV-05: 30-Degree Rule: Consecutive shots of same subject must differ by ≥30° camera angle.",
  "COV-06: 180-Degree Rule: In dialogue, camera stays on same side of axis of action.",
  "COV-07: Coverage shots are STANDALONE — they break chain by design. Main shot chain resumes after coverage.",
  "COV-08: Reaction shot: Ambience only (no dialogue — character is listening). OTS: Full dialogue. Insert: SFX only. Cutaway: Ambience only. ECU: Amplified SFX or silence. Wide: Full ambience.",
  "COV-09: Coverage duration: Reaction 4-6s, OTS 4-6s, Insert 2-4s, Cutaway 4s, ECU 2-4s, Wide 6-8s.",
].join("\n");

const AUDIO_DESIGN_RULES = [
  "AUDIO-01: Audio Direction block MANDATORY in every VIDEO prompt. Format: Language, Type, Dialogue transcript, SFX, Ambience, Music, Mix target, 'No on-screen subtitles/captions.'",
  "AUDIO-02: Music: NONE is the STRICT DEFAULT. Never add music unless user explicitly requests it.",
  "AUDIO-03: NEVER translate user's dialogue. Turkish stays Turkish, English stays English. Preserve verbatim.",
  "AUDIO-04: ONE active speaker per shot. Separate dialogue across camera angles to prevent mixed lipsync.",
  "AUDIO-05: Type values: Dialogue, SFX, SFX Only, Ambience, Ambience Only, Mixed, SFX/Ambience, Amplified SFX.",
  "AUDIO-06: Mix targets by scene: Intense dialogue 70%/5%/25%, Action 20%/50%/30%, Tension 0%/30%/70%, Emotional 60%/10%/30%, Establishing 0%/20%/80%.",
  "AUDIO-07: SFX must be specific (not generic). 'Chalk compressing against chrome knurling' not 'grinding sound'. Match surface: wood=creaking, stone=sharp echo, metal=clanging, gravel=crunching.",
  "AUDIO-08: Environmental acoustic matching: Small room (tight reverb), Large hall (echo), Outdoor (minimal reverb), Bunker (muffled), Ship deck (wind/waves/metallic).",
  "AUDIO-09: Dialogue transcript format for speaker-tagged: 'Speaker: dialogue text' per line. For single voice without speaker tag: just the text in quotes.",
].join("\n");

const SPATIAL_BLOCKING_RULES = [
  "SPATIAL-01: When 2+ subjects in frame: MUST define Plane Map (FG/MG/BG positions), Eyeline Map (gaze targets), Body Orientation, Light Map (shared source), Depth Map.",
  "SPATIAL-02: Plane Map language: 'Foreground left: soldier, 1m from camera, fills left third...' NOT 'A soldier and a tank in the street'.",
  "SPATIAL-03: Eyeline: Name target explicitly. State 'not camera' when character should NOT look at camera. Head angle must support eye direction.",
  "SPATIAL-04: Contact/weight cues for realism: palm pressing, elbow resting, sleeve compression, boot planted, cloth tension, body weight shifted.",
  "SPATIAL-05: Shared light: Name ONE motivated source, specify direction/color, describe how it affects each subject. Same key direction for all subjects.",
  "SPATIAL-06: Depth: Foreground crisp microtexture, distant subjects lower contrast, background softened by atmospheric haze. Prevents miniature/toy-like look.",
  "SPATIAL-07: Occlusion: When subjects overlap, state it. 'Raised arm partially overlaps turret rim' kills cutout/composite look.",
  "SPATIAL-08: Anti-artifact avoid: disconnected eyelines, pasted composite look, cutout edges, floating subject, toy-like scale, miniature effect, warped perspective.",
].join("\n");

const VISUAL_MODES_RULES = [
  "VISUAL-01: Ultra Realism is LOCKED default. No stylization without explicit user trigger keywords (anime, noir, vintage, cyberpunk, etc.).",
  "VISUAL-02: Human appearance: visible pores, natural imperfections, subsurface scattering, hair strands/flyaways, iris detail, five correct fingers, slight facial asymmetry.",
  "VISUAL-03: Materials: fabric weave visible at close range, metal reflections with fingerprints, leather with natural cracks, wood grain, stone porosity.",
  "VISUAL-04: Lighting: physically correct shadows, color temperature (daylight 5600K, tungsten 3200K, fire warm orange), atmospheric perspective, volumetric effects.",
  "VISUAL-05: Color continuity: Same scene = same color temperature/palette. Lock per scene: interior warm 3200K, exterior cool 5600K.",
  "VISUAL-06: Anti-AI artifacts PROHIBITED: plastic/waxy skin, symmetrical faces, floating objects, merged fingers, extra limbs, beauty filter look, uncanny expressions.",
].join("\n");

const REFERENCE_LOCKING_RULES = [
  "REF-01: When reference images exist for a character, DON'T describe face/hair/body/eyes in text. Let reference handle physical appearance.",
  "REF-02: Start every prompt with [REFERENCE LOCK] section when reference images are provided.",
  "REF-03: Use STRONG language: 'EXACTLY', 'PRECISELY', 'IDENTICAL' — not 'similar to' or 'using the provided image'.",
  "REF-04: Allowed text when reference exists: costume, accessories, age range, pose/posture, emotion/behavior, action.",
  "REF-05: Repeat reference reminder 2-3 times per prompt: at START, middle, and near end.",
  "REF-06: Multi-shot consistency: Every subsequent shot must include [REFERENCE LOCK] reminder with 'same person throughout'.",
].join("\n");

// ─── MODEL-SPECIFIC RULES ─────────────────────────────────────────────

function buildVeoRules(): string {
  return [
    "VEO-01: Duration default: 8s (slow burn pacing). Action/impact can be 4s.",
    "VEO-02: Structured Audio Direction block required in every video prompt.",
    "VEO-03: Prompt length 80-120 words. Longer prompts give more control, model rewrites less.",
    "VEO-04: Image-to-video: Don't repeat visual info already visible in reference image. Only describe the CHANGE/motion.",
    "VEO-05: Re-take: New seed for face issues, same seed for motion adjustments. After 3 failures split 8s → 4s+4s.",
  ].join("\n");
}

function buildKlingRules(preset: string): string {
  const cfgValue = preset === "ultra-realism" ? "0.45" : preset === "balanced" ? "0.50" : "user-defined";
  return [
    `KLING-01: CFG guidance: ${cfgValue}. Lower = more realistic/fluid, higher = stricter text adherence but artifact risk.`,
    "KLING-02: Start+End frame paradigm. 70% of quality is frame alignment. Both frames MUST share same visual universe: angle, height, scale, lens feel, light direction.",
    "KLING-03: Motion timeline: 'First: [micro movement]; Then: [main change]; Finally: [settle into end pose]'.",
    "KLING-04: Transformation budget: 5s = 1 major change, 10s = 2-3 staged changes, 15s = complex single-scene.",
    "KLING-05: Camera movements: prefer simple safe commands (push-in, pan, tilt, handheld micro-sway). Complex = more warping risk.",
    "KLING-06: Dialogue MUST be in quotation marks with tone markers. Format: softly, \"dialogue\" or \"dialogue\" (with trembling voice).",
    "KLING-07: SFX: narrative descriptions, not lists. 'distant thunder rolling across valley' not 'thunder, rolling, distant'.",
    "KLING-08: Negative prompt: blur, low quality, compression artifacts, flicker, jitter, warping, rubbery motion, melted textures, extra fingers, deformed hands, uncanny face, text, over-sharpening, plastic skin, texture crawl.",
    "KLING-09: Stable background priority. No texture crawl. Physically plausible motion only.",
  ].join("\n");
}

// ─── PASS 1: SCENE ANALYSIS + SHOT PLAN ───────────────────────────────

export function buildPass1SystemPrompt(targetModel: TargetVideoModel): string {
  const modelLabel = targetModel === "veo31" ? "Google Veo 3.1" : "Kling 3.0";
  return [
    `You are a Hollywood-grade film director and cinematographer planning shots for ${modelLabel} AI video generation.`,
    "Your task: Analyze the given scenario and produce a detailed shot plan as JSON.",
    "",
    "## RULES",
    SAFETY_COMPLIANCE_RULES,
    "",
    "## COVERAGE REQUIREMENTS",
    "COV-01: Every main shot MUST have 2-3 coverage shots planned.",
    "COV-04: Coverage type selection by scene: Dialogue → Reaction+OTS, Action → Insert+ECU, Emotional → Reaction+ECU, Establishing → Wide+Cutaway.",
    "",
    "## CHAIN RULES",
    "CHAIN-01: Default 95% shots must chain (SHOT[N]_END → SHOT[N+1]_START).",
    "CHAIN-04: Chain break ONLY for location change, time jump, or major transition.",
    "",
    "## TENSION ARC",
    "Assign tension 1-5 per shot. Level 1=wide/slow, Level 3=medium-close, Level 5=ECU/intense.",
    "Build dramatic arc: rising tension → climax → resolution.",
    "",
    "## PACING (SLOW BURN — CRITICAL)",
    "PACE-01: NEVER rush. A single sentence of dialogue = at least 1 main shot + 2 coverage.",
    "PACE-02: Split every action into MULTIPLE shots: approach → action → reaction → aftermath.",
    "PACE-03: Dedicate shots purely to atmosphere/establishing before any action begins.",
    "PACE-04: Show reactions BEFORE and AFTER key actions. Every emotional beat needs its own shot.",
    "PACE-05: Use micro-beats for dialogue. One speaker per shot. Back-and-forth = OTS coverage.",
    "",
    "## SHOT COUNT GUIDELINES (MANDATORY MINIMUMS)",
    "COUNT-01: Per SCENE minimum: 3-5 main shots + 2-3 coverage each = 9-20 total shots per scene.",
    "COUNT-02: A scene with dialogue between 2 people needs MINIMUM 4 main shots: establishing → speaker A → speaker B → reaction/closing.",
    "COUNT-03: An action scene needs MINIMUM 5 main shots: setup → approach → action → impact/reaction → aftermath.",
    "COUNT-04: An emotional scene needs MINIMUM 4 main shots: context → build-up → peak emotion → resolution.",
    "COUNT-05: Even a simple establishing scene needs MINIMUM 2 main shots: wide establishing → closer detail.",
    "COUNT-06: NEVER condense a full scene into 1 shot. That is a TRAILER, not a FILM.",
    "COUNT-07: Think like an editor: you need OPTIONS. More shots = more editing flexibility = better final cut.",
    "COUNT-08: Total shot count for a typical 2-3 page scenario should be 15-45 main shots (45-135 including coverage).",
    "",
    "## OUTPUT FORMAT (CRITICAL — MUST BE VALID JSON)",
    "Return ONLY a single JSON object. No text before or after. No markdown fences. No comments. No explanation.",
    "Do NOT use // comments inside JSON. Do NOT add trailing commas.",
    "The response must start with { and end with }.",
    "",
    "You MUST use EXACTLY these field names — do not invent your own:",
    "",
    "EXAMPLE (2 scenes, abbreviated — your output should have MORE shots):",
    JSON.stringify({
      scenes: [
        {
          sceneNumber: 1,
          title: "Ornek Sahne Basligi",
          summaryTr: "Sahnenin Turkce ozeti burada.",
          tensionLevel: 2,
          shots: [
            { shotNumber: "SHOT01", type: "main", durationS: 8, hasDialogue: false, chainStatus: "first", summaryTr: "Genis acilis plani", tensionLevel: 2, sceneType: "establishing" },
            { shotNumber: "SHOT01A", type: "coverage", coverageType: "wide", parentShotNumber: "SHOT01", durationS: 6, hasDialogue: false, chainStatus: "first", summaryTr: "Genis plan atmosphere", tensionLevel: 2, sceneType: "establishing" },
            { shotNumber: "SHOT01B", type: "coverage", coverageType: "insert", parentShotNumber: "SHOT01", durationS: 4, hasDialogue: false, chainStatus: "first", summaryTr: "Detay insert", tensionLevel: 2, sceneType: "establishing" },
            { shotNumber: "SHOT02", type: "main", durationS: 8, hasDialogue: true, dialogueSpeakers: ["Komutan"], dialoguePreview: "Komutan: Hazir olun!", chainStatus: "chained", prevShotRef: "SHOT01", summaryTr: "Komutan konusur", tensionLevel: 3, sceneType: "dialogue" },
            { shotNumber: "SHOT02A", type: "coverage", coverageType: "reaction", parentShotNumber: "SHOT02", durationS: 5, hasDialogue: false, chainStatus: "first", summaryTr: "Askerlerin tepkisi", tensionLevel: 3, sceneType: "dialogue" },
            { shotNumber: "SHOT02B", type: "coverage", coverageType: "ots", parentShotNumber: "SHOT02", durationS: 5, hasDialogue: true, dialogueSpeakers: ["Komutan"], dialoguePreview: "Komutan: Hazir olun!", chainStatus: "first", summaryTr: "OTS komutan", tensionLevel: 3, sceneType: "dialogue" },
          ],
        },
        {
          sceneNumber: 2,
          title: "Ikinci Sahne",
          summaryTr: "Ikinci sahne ozeti.",
          tensionLevel: 4,
          shots: [
            { shotNumber: "SHOT03", type: "main", durationS: 8, hasDialogue: false, chainStatus: "chained", prevShotRef: "SHOT02", summaryTr: "Aksiyon baslangici", tensionLevel: 4, sceneType: "action" },
            { shotNumber: "SHOT03A", type: "coverage", coverageType: "ecu", parentShotNumber: "SHOT03", durationS: 3, hasDialogue: false, chainStatus: "first", summaryTr: "Yakin plan detay", tensionLevel: 4, sceneType: "action" },
            { shotNumber: "SHOT03B", type: "coverage", coverageType: "insert", parentShotNumber: "SHOT03", durationS: 4, hasDialogue: false, chainStatus: "first", summaryTr: "Obje detayi", tensionLevel: 4, sceneType: "action" },
          ],
        },
      ],
      totalMainShots: 3,
      totalCoverageShots: 5,
      estimatedDurationS: 48,
      tensionArc: [2, 3, 4],
      dialogueNamePolicy: "preserve",
      targetModel,
    }, null, 0),
    "",
    "## FIELD RULES",
    "- scenes: array of scene objects. MUST use 'scenes' not 'scene'.",
    "- scenes[].shots: array of shot objects inside each scene.",
    "- shotNumber: SHOT01, SHOT02 for main. SHOT01A, SHOT01B for coverage.",
    "- type: 'main' or 'coverage'. MUST use these exact strings.",
    "- coverageType: 'reaction' | 'ots' | 'insert' | 'cutaway' | 'ecu' | 'wide'. Only for type='coverage'.",
    "- parentShotNumber: the main shot this coverage belongs to. Only for type='coverage'.",
    "- chainStatus: 'first' for SHOT01, 'chained' for subsequent, 'break' only with chainBreakReason.",
    "- prevShotRef: e.g. 'SHOT01' for SHOT02 when chained.",
    "- hasDialogue: true only if character speaks in this shot.",
    "- dialogueSpeakers: array of speaker names if hasDialogue is true.",
    "- dialoguePreview: first line of dialogue if hasDialogue is true.",
    "- summaryTr: Turkish description of what happens in this shot.",
    "- tensionArc: array of tension values, one per main shot.",
    "- Every scene MUST have at least 3 main shots with 2-3 coverage each.",
  ].join("\n");
}

export function validatePass1Output(raw: string): ShotPlan {
  const rawParsed = JSON.parse(raw) as Record<string, unknown>;

  // ─── Kurtarma: LLM "scene" yerine "scenes" dönmediyse ───
  let scenes: ScenePlan[];

  if (Array.isArray(rawParsed.scenes)) {
    scenes = rawParsed.scenes as ScenePlan[];
  } else if (Array.isArray((rawParsed as Record<string, unknown>).scene)) {
    scenes = (rawParsed as Record<string, unknown>).scene as ScenePlan[];
  } else if (Array.isArray(rawParsed.shotPlan)) {
    scenes = [{ sceneNumber: 1, title: "Ana Sahne", summaryTr: "", tensionLevel: 3, shots: rawParsed.shotPlan as ShotPlanItem[] }];
  } else {
    const keys = Object.keys(rawParsed);
    const arrayKey = keys.find((k) => Array.isArray(rawParsed[k]));

    if (arrayKey) {
      const arr = rawParsed[arrayKey] as unknown[];

      if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null && "shotNumber" in (arr[0] as Record<string, unknown>)) {
        scenes = [{ sceneNumber: 1, title: "Ana Sahne", summaryTr: "", tensionLevel: 3, shots: arr as ShotPlanItem[] }];
      } else {
        scenes = arr as ScenePlan[];
      }
    } else {
      throw new Error("Shot plan 'scenes' dizisi bulunamadi. AI yaniti beklenmeyen formatta.");
    }
  }

  if (scenes.length === 0) {
    throw new Error("Shot plan must have at least one scene.");
  }

  // ─── shot alanlarını normalize et ───
  for (const scene of scenes) {
    if (!scene.sceneNumber) {
      scene.sceneNumber = scenes.indexOf(scene) + 1;
    }

    if (!Array.isArray(scene.shots)) {
      scene.shots = [];
    }

    for (const shot of scene.shots) {
      // shotRef → shotNumber kurtarma
      const raw = shot as unknown as Record<string, unknown>;

      if (!shot.shotNumber && raw.shotRef) {
        shot.shotNumber = String(raw.shotRef);
      }

      if (!shot.shotNumber && raw.shot_number) {
        shot.shotNumber = String(raw.shot_number);
      }

      // type yoksa tahmin et
      if (!shot.type) {
        shot.type = shot.shotNumber?.includes("A") || shot.shotNumber?.includes("B") || shot.shotNumber?.includes("C")
          ? "coverage"
          : "main";
      }

      // chainStatus yoksa tahmin et
      if (!shot.chainStatus) {
        shot.chainStatus = shot.shotNumber === "SHOT01" ? "first" : "chained";
      }

      // durationS yoksa default
      if (!shot.durationS) {
        shot.durationS = shot.type === "coverage" ? 5 : 8;
      }

      // tensionLevel yoksa sahne seviyesi
      if (!shot.tensionLevel) {
        shot.tensionLevel = scene.tensionLevel ?? 3;
      }

      // summaryTr yoksa boş
      if (!shot.summaryTr) {
        shot.summaryTr = "";
      }
    }
  }

  // ─── İstatistikleri hesapla ───
  const allShots = scenes.flatMap((s) => s.shots);
  const mainShots = allShots.filter((s) => s.type === "main");
  const coverageShots = allShots.filter((s) => s.type === "coverage");

  return {
    scenes,
    totalMainShots: mainShots.length,
    totalCoverageShots: coverageShots.length,
    estimatedDurationS: allShots.reduce((sum, s) => sum + (s.durationS ?? 8), 0),
    tensionArc: mainShots.map((s) => s.tensionLevel ?? 3),
    dialogueNamePolicy: (rawParsed.dialogueNamePolicy as "preserve" | "anonymous") ?? "preserve",
    targetModel: (rawParsed.targetModel as string as import("@/lib/scenario-types").TargetVideoModel) ?? "veo31",
  };
}

// ─── PASS 2: MAIN SHOT PROMPTS ────────────────────────────────────────

export function buildPass2SystemPrompt(
  targetModel: TargetVideoModel,
  scene: ScenePlan,
  klingPreset?: string,
): string {
  const modelRules = targetModel === "veo31" ? buildVeoRules() : buildKlingRules(klingPreset ?? "ultra-realism");
  return [
    "You are a Hollywood-grade cinematographer generating production-ready shot prompts.",
    `Target model: ${targetModel === "veo31" ? "Google Veo 3.1" : "Kling 3.0"}.`,
    "",
    "## PROMPT STRUCTURE (MANDATORY)",
    PROMPT_STRUCTURE_RULES,
    "",
    "## FRAME CHAINING",
    FRAME_CHAINING_RULES,
    "",
    "## VISUAL REALISM",
    VISUAL_MODES_RULES,
    "",
    "## SAFETY",
    SAFETY_COMPLIANCE_RULES,
    "",
    "## REFERENCE LOCKING",
    REFERENCE_LOCKING_RULES,
    "",
    "## MODEL-SPECIFIC RULES",
    modelRules,
    "",
    "## AUDIO DIRECTION (video prompts)",
    "AUDIO-01: Every VIDEO prompt MUST end with Audio Direction block before Avoid line.",
    "AUDIO-02: Music: NONE always. Dialogue transcript in original language.",
    "AUDIO-05: Type values: Dialogue, SFX, SFX Only, Mixed, SFX/Ambience, Amplified SFX, Ambience.",
    "",
    "## OUTPUT FORMAT (CRITICAL — MUST BE VALID JSON)",
    "Return ONLY a single JSON object. No text before or after. No markdown fences. No // comments. No trailing commas.",
    "The response must start with { and end with } — nothing else.",
    `Generate prompts for all ${scene.shots.filter((s) => s.type === "main").length} main shots in scene ${scene.sceneNumber}: "${scene.title}".`,
    '{"shots":[{"shotNumber":"SHOT01","promptStart":"full image prompt with Avoid line","promptEnd":"full image prompt with Avoid line","promptVideo":"full video prompt with Audio Direction block and Avoid line","summaryTr":"Türkçe özet","durationS":8,"tensionLevel":3,"chainStatus":"chained","prevShotRef":"SHOT00","shotType":"main","cameraAngle":"85mm f/2.0 close-up","model":"' + targetModel + '","cfg":null,"klingPreset":null}]}',
    "",
    "## CRITICAL REQUIREMENTS",
    "- promptStart: Full image prompt ≥80 words with Avoid line. First shot only, others say 'Use SHOT[prev]_END as exact first frame.' then full prompt.",
    "- promptEnd: Full image prompt ≥80 words with Avoid line.",
    "- promptVideo: Full video prompt ≥120 words with complete Audio Direction block and Avoid line.",
    "- Every prompt follows 7-step flow order.",
    "- All prompts in English. Dialogue in Audio Direction stays in original language.",
    "- chainStatus must match the shot plan exactly.",
  ].join("\n");
}

export function validatePass2Output(
  raw: string,
  scene: ScenePlan,
): GeneratedShot[] {
  const parsed = JSON.parse(raw) as { shots: GeneratedShot[] };

  if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error("Pass 2 output must have shots.");
  }

  const mainShots = scene.shots.filter((s) => s.type === "main");

  if (parsed.shots.length !== mainShots.length) {
    throw new Error(
      `Expected ${mainShots.length} main shots for scene ${scene.sceneNumber}, got ${parsed.shots.length}.`,
    );
  }

  for (const shot of parsed.shots) {
    if (!shot.promptEnd?.trim()) {
      throw new Error(`${shot.shotNumber} missing promptEnd.`);
    }

    if (!shot.promptVideo?.trim()) {
      throw new Error(`${shot.shotNumber} missing promptVideo.`);
    }
  }

  return parsed.shots.map((shot) => ({
    ...shot,
    sceneNumber: scene.sceneNumber,
    parentShotNumber: null,
  }));
}

// ─── PASS 3: COVERAGE SHOTS ──────────────────────────────────────────

export function buildPass3SystemPrompt(
  targetModel: TargetVideoModel,
  mainShot: GeneratedShot,
  coveragePlan: ShotPlanItem[],
  klingPreset?: string,
): string {
  const modelRules = targetModel === "veo31" ? buildVeoRules() : buildKlingRules(klingPreset ?? "ultra-realism");
  const coverageList = coveragePlan
    .map((c) => `${c.shotNumber} (${c.coverageType}, ${c.durationS}s): ${c.summaryTr}`)
    .join("\n");

  return [
    "You are generating coverage shots for an existing main shot.",
    `Target model: ${targetModel === "veo31" ? "Google Veo 3.1" : "Kling 3.0"}.`,
    "",
    "## COVERAGE SYSTEM",
    COVERAGE_SYSTEM_RULES,
    "",
    "## PROMPT STRUCTURE",
    PROMPT_STRUCTURE_RULES,
    "",
    "## VISUAL REALISM",
    VISUAL_MODES_RULES,
    "",
    "## MODEL-SPECIFIC RULES",
    modelRules,
    "",
    "## AUDIO FOR COVERAGE",
    "COV-08: Reaction=Ambience only. OTS=Full dialogue. Insert=SFX only. Cutaway=Ambience only. ECU=Amplified SFX/silence. Wide=Full ambience.",
    AUDIO_DESIGN_RULES,
    "",
    "## PARENT MAIN SHOT CONTEXT",
    `Shot: ${mainShot.shotNumber}`,
    `Summary: ${mainShot.summaryTr}`,
    `End Frame: ${mainShot.promptEnd?.slice(0, 300) ?? "N/A"}`,
    `Video: ${mainShot.promptVideo?.slice(0, 400) ?? "N/A"}`,
    "",
    "## REQUIRED COVERAGE",
    coverageList,
    "",
    "## OUTPUT FORMAT",
    "Return ONLY a single JSON object. No text before or after. No markdown fences. No // comments. No trailing commas.",
    '{"shots":[{"shotNumber":"SHOT01A","promptStart":null,"promptEnd":"full image prompt ≥60 words with Avoid","promptVideo":"full video prompt ≥60 words with Audio Direction and Avoid","summaryTr":"Türkçe","durationS":4,"tensionLevel":3,"chainStatus":"first","prevShotRef":null,"shotType":"reaction","cameraAngle":"85mm f/2.0","model":"' + targetModel + '","cfg":null,"klingPreset":null}]}',
    "",
    "## CRITICAL",
    "- Coverage promptStart is always null (standalone, not chained).",
    "- Coverage promptEnd is the only image frame (≥60 words).",
    "- Camera angle must differ ≥30° from parent main shot.",
    "- Each coverage follows its type spec (lens, duration, audio rules).",
  ].join("\n");
}

export function validatePass3Output(
  raw: string,
  mainShotNumber: string,
  expectedCount: number,
): GeneratedShot[] {
  const parsed = JSON.parse(raw) as { shots: GeneratedShot[] };

  if (!Array.isArray(parsed.shots) || parsed.shots.length < expectedCount) {
    throw new Error(
      `Expected ${expectedCount} coverage shots for ${mainShotNumber}, got ${parsed.shots?.length ?? 0}.`,
    );
  }

  for (const shot of parsed.shots) {
    if (!shot.promptEnd?.trim()) {
      throw new Error(`Coverage ${shot.shotNumber} missing promptEnd.`);
    }

    if (!shot.promptVideo?.trim()) {
      throw new Error(`Coverage ${shot.shotNumber} missing promptVideo.`);
    }
  }

  return parsed.shots.map((shot) => ({
    ...shot,
    parentShotNumber: mainShotNumber,
  }));
}

// ─── PASS 4: AUDIO DESIGN ────────────────────────────────────────────

export function buildPass4SystemPrompt(targetModel: TargetVideoModel): string {
  return [
    "You are a professional sound designer adding Audio Direction blocks to shot video prompts.",
    `Target model: ${targetModel === "veo31" ? "Google Veo 3.1" : "Kling 3.0"}.`,
    "",
    "## AUDIO DESIGN RULES",
    AUDIO_DESIGN_RULES,
    "",
    "## SAFETY",
    "SAFETY-07: Never script threatening dialogue, violence sounds as 'firing at targets'. Use 'mechanical operation'.",
    "",
    "## OUTPUT FORMAT",
    "For each shot provided, return the COMPLETE promptVideo with improved Audio Direction block.",
    "Return ONLY a single JSON object. No text before or after. No markdown fences. No // comments. No trailing commas.",
    '{"shots":[{"shotNumber":"SHOT01","promptVideo":"full video prompt with complete Audio Direction block and Avoid line"}]}',
    "",
    "## AUDIO DIRECTION BLOCK FORMAT (exact)",
    "Audio direction:",
    "- Language: TURKISH / ENGLISH / NONE",
    "- Type: Dialogue / SFX / Mixed / SFX Only / SFX/Ambience / Amplified SFX / Ambience",
    '- Dialogue transcript: "Speaker: exact line" or NONE',
    "- SFX: specific, detailed sound effects (surface-matched, environment-aware)",
    "- Ambience: environmental background (room-appropriate reverb, distance-aware)",
    "- Music: NONE",
    "- Mix target: Dialogue X%, SFX Y%, Ambience Z%",
    "- No on-screen subtitles/captions.",
    "",
    "## CRITICAL",
    "- Preserve the ENTIRE video prompt. Only enhance the Audio Direction block.",
    "- SFX must be specific: 'chalk compressing against chrome knurling' not 'grinding sound'.",
    "- Match acoustics to environment: bunker=muffled reverb, open field=minimal reverb, ship deck=wind+waves.",
    "- Dialogue in original language. Turkish stays Turkish.",
    "- Type must match content: has dialogue → 'Dialogue' or 'Mixed'. No dialogue → 'SFX Only' or 'Ambience'.",
  ].join("\n");
}

export function validatePass4Output(
  raw: string,
  expectedShotNumbers: string[],
): Array<{ shotNumber: string; promptVideo: string }> {
  const parsed = JSON.parse(raw) as {
    shots: Array<{ shotNumber: string; promptVideo: string }>;
  };

  if (!Array.isArray(parsed.shots)) {
    throw new Error("Pass 4 output must have shots array.");
  }

  for (const expected of expectedShotNumbers) {
    const found = parsed.shots.find((s) => s.shotNumber === expected);

    if (!found?.promptVideo?.trim()) {
      throw new Error(`Pass 4 missing promptVideo for ${expected}.`);
    }
  }

  return parsed.shots;
}

// ─── PASS 5: SPATIAL BLOCKING + QA ───────────────────────────────────

export function buildPass5SystemPrompt(): string {
  return [
    "You are a quality assurance cinematographer reviewing and improving shot prompts.",
    "",
    "## SPATIAL BLOCKING (apply to multi-subject shots)",
    SPATIAL_BLOCKING_RULES,
    "",
    "## CHAIN CONTINUITY",
    FRAME_CHAINING_RULES,
    "",
    "## QUALITY CHECKS",
    "QA-01: Verify image prompts ≥80 words, video prompts ≥120 words, coverage ≥60 words.",
    "QA-02: Verify every video prompt has Audio Direction block.",
    "QA-03: Verify every prompt has Avoid line.",
    "QA-04: Verify no real person names in visual prompts (AUTO-ANONYMOUS).",
    "QA-05: Verify chain continuity: end frame of shot N is compatible with start of shot N+1.",
    "QA-06: Add spatial blocking layer to any multi-subject shot missing it.",
    "QA-07: Verify eyeline targets are explicit ('looks at commander, not camera').",
    "QA-08: Verify contact/weight cues exist for physical interactions.",
    "",
    "## OUTPUT FORMAT",
    "Return corrected prompts for shots that needed changes. If a shot is already good, don't include it.",
    '{"corrections":[{"shotNumber":"SHOT03","field":"promptVideo","corrected":"full corrected prompt","reason":"Added spatial blocking for 2-person scene"}],"qualityReport":{"totalChecked":N,"passed":N,"corrected":N,"issues":["list of issues found and fixed"]}}',
  ].join("\n");
}

export function validatePass5Output(raw: string): {
  corrections: Array<{
    shotNumber: string;
    field: string;
    corrected: string;
    reason: string;
  }>;
  qualityReport: {
    totalChecked: number;
    passed: number;
    corrected: number;
    issues: string[];
  };
} {
  const parsed = JSON.parse(raw) as ReturnType<typeof validatePass5Output>;

  return {
    corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
    qualityReport: parsed.qualityReport ?? {
      totalChecked: 0,
      passed: 0,
      corrected: 0,
      issues: [],
    },
  };
}

function stripOuterMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim();
  const fencedMatch = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch?.[1]?.trim() ?? trimmed;
}

function countWords(value: string | null | undefined): number {
  return value?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}

function hasAvoidLine(value: string | null | undefined): boolean {
  return /(?:^|\n)\s*Avoid\s*:/i.test(value ?? "");
}

function hasAudioDirectionBlock(value: string | null | undefined): boolean {
  return /Audio direction\s*:/i.test(value ?? "");
}

function normalizeChainStatusLabel(shot: ShotPlanItem): string {
  if (shot.chainStatus === "first") {
    return "FIRST SHOT";
  }

  if (shot.chainStatus === "chained" && shot.prevShotRef) {
    return `CHAINED from ${shot.prevShotRef}_END`;
  }

  const reason = shot.chainBreakReason?.trim() || "continuity reset";
  return `CHAIN BREAK - ${reason}`;
}

export function buildShotGeneratorSystemPrompt(
  targetModel: TargetVideoModel,
  klingPreset?: string,
): string {
  const modelRules = targetModel === "veo31" ? buildVeoRules() : buildKlingRules(klingPreset ?? "ultra-realism");

  return [
    "You are the shot-generator agent inside a professional film production pipeline.",
    "Generate EXACTLY ONE production-ready markdown file for EXACTLY ONE main shot.",
    "The file MUST contain the main shot plus its 2-3 coverage shots in the SAME file.",
    "",
    "## ROLE BOUNDARY",
    "- Follow the planned shot numbers exactly.",
    "- Do not invent extra shots.",
    "- Do not omit coverage shots.",
    "- Do not return JSON.",
    "- Return ONLY markdown for the requested SHOT file. No commentary before or after.",
    "",
    "## ACTIVE RULES",
    PROMPT_STRUCTURE_RULES,
    "",
    FRAME_CHAINING_RULES,
    "",
    COVERAGE_SYSTEM_RULES,
    "",
    AUDIO_DESIGN_RULES,
    "",
    SPATIAL_BLOCKING_RULES,
    "",
    VISUAL_MODES_RULES,
    "",
    SAFETY_COMPLIANCE_RULES,
    "",
    REFERENCE_LOCKING_RULES,
    "",
    "## MODEL-SPECIFIC RULES",
    modelRules,
    "",
    "## HARD OUTPUT CONTRACT",
    "- Output a markdown file with YAML frontmatter.",
    "- Frontmatter MUST contain: shot_id, scene, duration, tension, chain_status, model, preset.",
    "- Then a title line: '# SHOTNN | 8s | FIRST SHOT' or '# SHOTNN | 8s | CHAINED from SHOTXX_END'.",
    "- Add one Turkish summary line starting with '>' directly under the title.",
    "- Add '## Model Control' block.",
    "- Add '## Main Shot'.",
    "- Add '### ILK FRAME (SHOTNN_START)' followed by a fenced code block.",
    "- If the shot is chained, place the plain line 'Use SHOTXX_END as exact first frame.' immediately before the ILK FRAME code block.",
    "- Add '### SON FRAME (SHOTNN_END)' followed by a fenced code block.",
    "- Add '### VIDEO' followed by a fenced code block.",
    "- Add '## Coverage Shots'.",
    "- Each coverage shot MUST use heading format: '### SHOTNNA - [Type] | [duration]s | [label]'.",
    "- Each coverage block MUST include one Turkish summary line starting with '>' plus TWO fenced code blocks: image prompt first, video prompt second.",
    "",
    "## QUALITY FLOOR",
    "- ILK FRAME prompt >= 80 words.",
    "- SON FRAME prompt >= 80 words.",
    "- VIDEO prompt >= 120 words.",
    "- Every coverage image prompt >= 70 words.",
    "- Every coverage video prompt >= 70 words.",
    "- Every prompt MUST include an Avoid line.",
    "- Every video prompt MUST include a full Audio direction block.",
    "- Multi-subject realism MUST explicitly include plane map, eyeline target, shared light source, and contact/depth cues when relevant.",
    "",
    "## CHAIN RULES",
    "- FIRST SHOT: create a real opening frame.",
    "- CHAINED: header/frontmatter must say 'CHAINED from SHOTXX_END'. ILK FRAME must reuse previous END exactly.",
    "- CHAIN BREAK: explicitly write 'CHAIN BREAK - [reason]' and include transition type when a break is required.",
    "",
    "## TEMPLATE SKELETON",
    [
      "---",
      "shot_id: SHOTNN",
      "scene: 1 - Scene Title",
      "duration: 8s",
      "tension: 3",
      "chain_status: FIRST SHOT",
      `model: ${targetModel}`,
      `preset: ${klingPreset ?? "default"}`,
      "---",
      "",
      "# SHOTNN | 8s | FIRST SHOT",
      "",
      "> Turkce ozet satiri.",
      "",
      "## Model Control",
      "- Model: `...`",
      "- Preset: `...`",
      targetModel === "kling-3.0" ? "- Transition mode: Start+End" : "- Display: Google Flow + Veo 3.1",
      "",
      "## Main Shot",
      "",
      "### ILK FRAME (SHOTNN_START)",
      "```",
      "[80+ word image prompt]",
      "```",
      "",
      "### SON FRAME (SHOTNN_END)",
      "```",
      "[80+ word image prompt]",
      "```",
      "",
      "### VIDEO",
      "```",
      "[120+ word video prompt with Audio direction block]",
      "```",
      "",
      "## Coverage Shots",
      "",
      "### SHOTNNA - Reaction | 5s | REACT",
      "> Coverage Turkce ozeti.",
      "```",
      "[70+ word image prompt]",
      "```",
      "```",
      "[70+ word video prompt with Audio direction block]",
      "```",
    ].join("\n"),
  ].join("\n");
}

export function validateShotGeneratorMarkdown(params: {
  markdown: string;
  sourceFile: string;
  scene: ScenePlan;
  mainShot: ShotPlanItem;
  coveragePlan: ShotPlanItem[];
  targetModel: TargetVideoModel;
  klingPreset?: string;
}): { markdown: string; shots: GeneratedShot[] } {
  const markdown = stripOuterMarkdownFence(params.markdown);
  const parsedShots = parseShot(markdown, params.sourceFile);

  if (parsedShots.length === 0) {
    throw new Error("SHOT markdown parse edilemedi.");
  }

  if (!markdown.includes("## Model Control")) {
    throw new Error("Model Control blogu eksik.");
  }

  if (!markdown.includes("## Coverage Shots")) {
    throw new Error("Coverage Shots bolumu eksik.");
  }

  const parsedMainShot = parsedShots.find((shot) => shot.shotNumber === params.mainShot.shotNumber);

  if (!parsedMainShot) {
    throw new Error(`${params.mainShot.shotNumber} main shot markdown icinde yok.`);
  }

  const parsedCoverageShots = parsedShots.filter((shot) => shot.shotNumber !== params.mainShot.shotNumber);
  const expectedCoverageNumbers = new Set(params.coveragePlan.map((shot) => shot.shotNumber));
  const parsedCoverageNumbers = new Set(parsedCoverageShots.map((shot) => shot.shotNumber));

  if (parsedCoverageShots.length !== params.coveragePlan.length) {
    throw new Error(
      `${params.mainShot.shotNumber} icin ${params.coveragePlan.length} coverage bekleniyordu, ${parsedCoverageShots.length} bulundu.`,
    );
  }

  for (const coverageShot of params.coveragePlan) {
    if (!parsedCoverageNumbers.has(coverageShot.shotNumber)) {
      throw new Error(`${params.mainShot.shotNumber} markdown icinde ${coverageShot.shotNumber} eksik.`);
    }
  }

  for (const parsedCoverage of parsedCoverageShots) {
    if (!expectedCoverageNumbers.has(parsedCoverage.shotNumber)) {
      throw new Error(`${parsedCoverage.shotNumber} planlanmamis coverage shot olarak dondu.`);
    }
  }

  if (!parsedMainShot.promptStart?.trim()) {
    throw new Error(`${params.mainShot.shotNumber} ILK FRAME blogu eksik.`);
  }

  if (!parsedMainShot.promptEnd?.trim()) {
    throw new Error(`${params.mainShot.shotNumber} SON FRAME blogu eksik.`);
  }

  if (!parsedMainShot.promptVideo?.trim()) {
    throw new Error(`${params.mainShot.shotNumber} VIDEO blogu eksik.`);
  }

  if (countWords(parsedMainShot.promptStart) < 80) {
    throw new Error(`${params.mainShot.shotNumber} ILK FRAME 80 kelimenin altinda.`);
  }

  if (countWords(parsedMainShot.promptEnd) < 80) {
    throw new Error(`${params.mainShot.shotNumber} SON FRAME 80 kelimenin altinda.`);
  }

  if (countWords(parsedMainShot.promptVideo) < 120) {
    throw new Error(`${params.mainShot.shotNumber} VIDEO 120 kelimenin altinda.`);
  }

  if (!hasAvoidLine(parsedMainShot.promptStart) || !hasAvoidLine(parsedMainShot.promptEnd) || !hasAvoidLine(parsedMainShot.promptVideo)) {
    throw new Error(`${params.mainShot.shotNumber} ana prompt bloklarindan birinde Avoid satiri eksik.`);
  }

  if (!hasAudioDirectionBlock(parsedMainShot.promptVideo)) {
    throw new Error(`${params.mainShot.shotNumber} VIDEO blogunda Audio direction eksik.`);
  }

  if (params.mainShot.chainStatus === "chained") {
    if (parsedMainShot.chainStatus !== "continue") {
      throw new Error(`${params.mainShot.shotNumber} chained olmaliydi ama continuity isareti eksik.`);
    }

    if (parsedMainShot.prevShotRef !== params.mainShot.prevShotRef) {
      throw new Error(
        `${params.mainShot.shotNumber} prev shot ref uyusmuyor. Beklenen ${params.mainShot.prevShotRef ?? "none"}, gelen ${parsedMainShot.prevShotRef ?? "none"}.`,
      );
    }

    if (!markdown.includes(`Use ${params.mainShot.prevShotRef}_END as exact first frame.`)) {
      throw new Error(`${params.mainShot.shotNumber} chain entry satiri eksik.`);
    }
  }

  if (params.mainShot.chainStatus === "break" && !/CHAIN BREAK/i.test(markdown)) {
    throw new Error(`${params.mainShot.shotNumber} chain break olarak planlandi ama markdown bunu belirtmiyor.`);
  }

  if (params.mainShot.chainStatus === "first" && !/FIRST SHOT/i.test(markdown)) {
    throw new Error(`${params.mainShot.shotNumber} first shot olarak isaretlenmemis.`);
  }

  const shots: GeneratedShot[] = parsedShots.map((parsedShot) => {
    const plannedShot =
      parsedShot.shotNumber === params.mainShot.shotNumber
        ? params.mainShot
        : params.coveragePlan.find((shot) => shot.shotNumber === parsedShot.shotNumber);

    const imagePrompt = parsedShot.promptStart ?? parsedShot.promptEnd;

    if (!imagePrompt?.trim()) {
      throw new Error(`${parsedShot.shotNumber} image prompt blogu eksik.`);
    }

    if (parsedShot.shotNumber !== params.mainShot.shotNumber && countWords(imagePrompt) < 70) {
      throw new Error(`${parsedShot.shotNumber} coverage image prompt'u 70 kelimenin altinda.`);
    }

    if (parsedShot.shotNumber !== params.mainShot.shotNumber && countWords(parsedShot.promptVideo) < 70) {
      throw new Error(`${parsedShot.shotNumber} coverage video prompt'u 70 kelimenin altinda.`);
    }

    if (!hasAvoidLine(imagePrompt) || !hasAvoidLine(parsedShot.promptVideo)) {
      throw new Error(`${parsedShot.shotNumber} coverage prompt'unda Avoid satiri eksik.`);
    }

    if (!hasAudioDirectionBlock(parsedShot.promptVideo)) {
      throw new Error(`${parsedShot.shotNumber} coverage video prompt'unda Audio direction eksik.`);
    }

    return {
      shotNumber: parsedShot.shotNumber,
      parentShotNumber:
        parsedShot.shotNumber === params.mainShot.shotNumber
          ? null
          : params.mainShot.shotNumber,
      sceneNumber: params.scene.sceneNumber,
      promptStart: parsedShot.promptStart,
      promptEnd: parsedShot.promptEnd,
      promptVideo: parsedShot.promptVideo,
      summaryTr: parsedShot.summaryTr ?? plannedShot?.summaryTr ?? params.scene.summaryTr,
      durationS: parsedShot.durationS ?? plannedShot?.durationS ?? 5,
      tensionLevel: parsedShot.tensionLevel ?? plannedShot?.tensionLevel ?? params.scene.tensionLevel ?? 3,
      chainStatus:
        parsedShot.shotNumber === params.mainShot.shotNumber
          ? params.mainShot.chainStatus
          : "break",
      prevShotRef:
        parsedShot.shotNumber === params.mainShot.shotNumber
          ? parsedShot.prevShotRef ?? params.mainShot.prevShotRef ?? null
          : null,
      shotType: parsedShot.shotType,
      cameraAngle: parsedShot.cameraAngle,
      model: parsedShot.model ?? params.targetModel,
      cfg: parsedShot.cfg,
      klingPreset: parsedShot.klingPreset ?? params.klingPreset ?? null,
      sourceFile: params.sourceFile,
    };
  });

  return { markdown, shots };
}

export function describePlannedChainStatus(shot: ShotPlanItem): string {
  return normalizeChainStatusLabel(shot);
}
