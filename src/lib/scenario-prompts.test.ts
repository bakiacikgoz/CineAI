import { describe, expect, it } from "vitest";
import { parseShot } from "@/lib/markdown-parser";
import { validateShotGeneratorMarkdown } from "@/lib/scenario-prompts";
import type { ScenePlan, ShotPlanItem } from "@/lib/scenario-types";

const scene: ScenePlan = {
  sceneNumber: 1,
  title: "Test Sahnesi",
  summaryTr: "Bir karakter agirlik altinda direncini korur.",
  tensionLevel: 3,
  shots: [],
};

const mainShot: ShotPlanItem = {
  shotNumber: "SHOT02",
  type: "main",
  durationS: 8,
  hasDialogue: false,
  chainStatus: "chained",
  prevShotRef: "SHOT01",
  summaryTr: "Karakterin kararliligi yakin planda yogunlasir.",
  tensionLevel: 3,
  sceneType: "emotional",
};

const coveragePlan: ShotPlanItem[] = [
  {
    shotNumber: "SHOT02A",
    type: "coverage",
    coverageType: "insert",
    parentShotNumber: "SHOT02",
    durationS: 4,
    hasDialogue: false,
    chainStatus: "first",
    summaryTr: "Ellerin boyunduruga daha sert kapanisi.",
    tensionLevel: 3,
    sceneType: "emotional",
  },
  {
    shotNumber: "SHOT02B",
    type: "coverage",
    coverageType: "ecu",
    parentShotNumber: "SHOT02",
    durationS: 4,
    hasDialogue: false,
    chainStatus: "first",
    summaryTr: "Gozlerdeki inat asiri yakin plana tasinir.",
    tensionLevel: 4,
    sceneType: "emotional",
  },
];

const shotMarkdown = `---
shot_id: SHOT02
scene: 1 - Test Sahnesi
duration: 8s
tension: 3
chain_status: CHAINED from SHOT01_END
model: veo31
preset: ultra-realism
---

# SHOT02 | 8s | CHAINED from SHOT01_END

> Karakterin kararliligi yakin planda yogunlasir.

## Model Control
- Model: \`veo31\`
- Display: Google Flow + Veo 3.1
- Preset: \`ultra-realism\`

## Main Shot

### ILK FRAME (SHOT02_START)
Use SHOT01_END as exact first frame.

\`\`\`
High-end live action close-up of a young laborer with tired eyes and damp skin, shoulders compressed beneath a rough wooden yoke, standing in the same alley and same amber dusk light established by the previous shot. His jaw is locked, neck tendons visible, breath held between effort and stubborn resolve. Foreground is the blurred edge of the yoke, midground is his strained face, background is soft village texture falling into warm haze. He looks past camera-left toward the road ahead, not camera. Single low sun from screen-right paints one cheek in amber and leaves the opposite cheek in cool shadow. 85mm lens, f/2.0, static frame, continuation safe composition.

Avoid: blurry, low-res, noise, distorted faces, bad anatomy, extra limbs, extra fingers, plastic skin, waxy skin, on-screen text, watermark, logo, cartoon style, CGI look.
\`\`\`

### SON FRAME (SHOT02_END)
\`\`\`
High-end live action close-up of the same young laborer, now with heavier sweat along his temple and a fiercer expression that pushes the emotion deeper without changing the camera axis. The wooden yoke still rests across his shoulders, fabric compressed at the collar, hands out of frame but tension visible in the neck and jaw. Foreground remains the blurred timber edge, midground the face, background the same alley haze and amber dusk atmosphere. He keeps his eyes fixed down the road, not camera, preparing for the next shot to widen back out. The same low sun from screen-right drives the key light and keeps shadows stable. 85mm lens, f/2.0, locked frame, sharp and continuation ready.

Avoid: blurry, low-res, noise, distorted faces, bad anatomy, extra limbs, extra fingers, plastic skin, waxy skin, on-screen text, watermark, logo, cartoon style, CGI look.
\`\`\`

### VIDEO
\`\`\`
High-end live action close-up of the same young laborer carrying crushing weight through a narrow alley at dusk. The shot begins from the exact composition of SHOT01_END and holds the same camera axis while his expression slowly hardens from fatigue into stubborn resolve. Sweat gathers along his temple, a breath catches in his chest, then releases in a controlled exhale. Foreground left keeps the yoke edge soft, midground center holds the face, background walls and dust haze stay stable and scale-correct. He looks past camera-left toward the road ahead, not camera. The single low sun from screen-right remains the motivated key light, warming one cheek while the other falls into blue shadow. 85mm lens, f/2.0, subtle handheld organic micro sway, stable background, natural motion only.

Audio direction:
- Language: NONE
- Type: SFX/Ambience
- Dialogue transcript: NONE
- SFX: strained breathing, wood creak against cloth, subtle skin movement, one tiny grunt of effort
- Ambience: warm evening alley tone, soft wind, distant village activity, loose dust brushing stone
- Music: NONE
- Mix target: SFX 60%, Ambience 40%
- No on-screen subtitles/captions.

Avoid: distorted faces, morphing, bad anatomy, extra limbs, extra fingers, blurry, flickering, inconsistent lighting, unnatural motion, on-screen text, watermark, cartoon style, CGI motion.
\`\`\`

## Coverage Shots

### SHOT02A - Insert | 4s | DETAIL
> Ellerin boyunduruga daha sert kapanisi.
\`\`\`
Insert detail shot of two strained hands clamping harder around a rough wooden yoke. Tight overhead framing shows knuckles whitening, tendons pulling, sleeve fabric bunching under pressure, and sweat catching amber light on the wrist. Foreground is the nearest thumb edge, midground is the grip itself, background is soft cloth and blurred ground texture. The weight feels believable because the wrists bend under load, the wood bites into skin, and the same sunset from screen-right paints warm highlights with cool shadow beneath the fingers. 85mm lens, f/4, static and tactile composition.

Avoid: blurry, low-res, noise, distorted anatomy, extra fingers, plastic skin, waxy skin, on-screen text, watermark, logo, cartoon style, CGI look.
\`\`\`
\`\`\`
Insert detail shot of two strained hands gripping the wooden yoke as the pressure subtly increases during the shot. Fingers tighten, tendons stand up, and one thumb shifts to keep balance while the cloth sleeve compresses at the wrist. Foreground stays on the nearest knuckle ridge, midground holds the grip, background remains softly diffused ground and fabric texture. Warm sunset light from screen-right catches sweat and wood grain while cooler fill collects under the palms. 85mm lens, f/4, locked frame, realistic motion only.

Audio direction:
- Language: NONE
- Type: SFX
- Dialogue transcript: NONE
- SFX: wood creak, dry fabric compression, subtle skin friction, tiny breath through clenched teeth
- Ambience: low evening room tone from the alley, faint wind
- Music: NONE
- Mix target: SFX 75%, Ambience 25%
- No on-screen subtitles/captions.

Avoid: distorted anatomy, extra fingers, blurry, flickering, warped motion, on-screen text, watermark, cartoon style, CGI motion.
\`\`\`

### SHOT02B - ECU | 4s | EXTREME
> Gozlerdeki inat asiri yakin plana tasinir.
\`\`\`
Extreme close-up of the laborer's eyes and upper brow, the entire frame built around concentrated resolve rather than broad movement. Moisture glints along the lower lid, lashes hold tiny dust, and the brow folds tighten with controlled strain. The plane map is simple but precise: foreground is the nearest lash line, midground is both eyes, background falls away into soft skin texture and dusk haze. He looks camera-left toward the road, not camera. The same sunset from screen-right creates amber catchlight and cool shadow, keeping continuity exact. 100mm macro style lens, f/2.0, static, ultra stable.

Avoid: blurry, low-res, noise, distorted faces, bad anatomy, extra limbs, extra fingers, plastic skin, waxy skin, on-screen text, watermark, logo, cartoon style, CGI look.
\`\`\`
\`\`\`
Extreme close-up holding on the laborer's eyes as the emotion sharpens inward instead of outward. The eyes stay locked toward camera-left, not camera, a slow blink resets focus, and the brow tightens by degrees while the lower lid glistens with effort. Foreground stays on the nearest lash edge, midground carries both irises, background remains soft skin texture with no scale drift. Warm amber catchlight from screen-right and cool shadow on the opposite side preserve exact continuity. 100mm macro lens, f/2.0, locked frame, no warping, no unstable background.

Audio direction:
- Language: NONE
- Type: Amplified SFX
- Dialogue transcript: NONE
- SFX: intimate breath, slight heartbeat presence, skin tension, faint cloth strain
- Ambience: nearly silent dusk air with a distant low breeze
- Music: NONE
- Mix target: SFX 80%, Ambience 20%
- No on-screen subtitles/captions.

Avoid: distorted faces, morphing, bad anatomy, extra limbs, extra fingers, blurry, flickering, warped motion, on-screen text, watermark, cartoon style, CGI motion.
\`\`\`
`;

describe("scenario shot-generator contract", () => {
  it("parses film-kit style coverage metadata", () => {
    const parsed = parseShot(
      shotMarkdown,
      "scenario/test/act-01/scene-01/SHOT02.md",
    );

    expect(parsed).toHaveLength(3);
    expect(parsed[1]?.durationS).toBe(4);
    expect(parsed[1]?.summaryTr).toBe("Ellerin boyunduruga daha sert kapanisi.");
    expect(parsed[1]?.shotType).toBe("detail");
    expect(parsed[2]?.durationS).toBe(4);
    expect(parsed[2]?.shotType).toBe("close");
  });

  it("validates a chained SHOT markdown file and maps it into generated shots", () => {
    const result = validateShotGeneratorMarkdown({
      markdown: shotMarkdown,
      sourceFile: "scenario/test/act-01/scene-01/SHOT02.md",
      scene,
      mainShot,
      coveragePlan,
      targetModel: "veo31",
    });

    expect(result.shots).toHaveLength(3);
    expect(result.shots[0]).toMatchObject({
      shotNumber: "SHOT02",
      parentShotNumber: null,
      prevShotRef: "SHOT01",
      chainStatus: "chained",
      sceneNumber: 1,
      sourceFile: "scenario/test/act-01/scene-01/SHOT02.md",
    });
    expect(result.shots[1]).toMatchObject({
      shotNumber: "SHOT02A",
      parentShotNumber: "SHOT02",
      durationS: 4,
      shotType: "detail",
    });
    expect(result.shots[2]).toMatchObject({
      shotNumber: "SHOT02B",
      parentShotNumber: "SHOT02",
      durationS: 4,
      shotType: "close",
    });
  });
});
