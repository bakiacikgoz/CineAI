import { describe, expect, it } from "vitest";
import { parseShot } from "@/lib/markdown-parser";

const shotMarkdown = `# SHOT04 | 15s | Tension: 5

## TR Summary
Komutan durumun ciddiyetini anlatir ve vur emrini verir. Asker (Omer) emri tereddutsuz kabul eder.

## Model Control
- Model: kling-3.0
- Model Display: Kling 3.0
- Preset: ultra-realism
- CFG: 0.45
- Transition Mode: Start+End

## Chain Status
CHAINED from SHOT03_END

## Main Shot

### \u0130LK FRAME (SHOT04_START)
\`\`\`text
[REFERENCE LOCK] Using uploaded character reference (omer.png): The soldier - Match face, body, and clothing EXACTLY. Use SHOT03_END as exact first frame.

Main shot start prompt.
\`\`\`

### SON FRAME (SHOT04_END)
\`\`\`text
[REFERENCE LOCK] Using uploaded character reference (omer.png): The soldier - Match face, body, and clothing EXACTLY.

Main shot end prompt.
\`\`\`

### V\u0130DEO
\`\`\`text
Same character continuity from the start frame, no identity drift.

Main shot video prompt.
\`\`\`

## Coverage Shots

### SHOT04A - Phone POV | 5s | OTS
TR: Telefon kamerasinin acisindan askerin yuzunun gerginligi.

#### \u0130LK FRAME
\`\`\`text
[REFERENCE LOCK] Using uploaded character reference (omer.png): The soldier - Match face, body, and clothing EXACTLY.

Coverage shot start prompt.
\`\`\`

#### SON FRAME
\`\`\`text
Coverage shot end prompt.
\`\`\`

#### V\u0130DEO
\`\`\`text
Coverage shot video prompt.
\`\`\`

### SHOT04B - Hand on Holster Insert | 4s | DETAIL
TR: Askerin bosta kalan elinin silah kilifina gitmesinin detay cekimi.

#### \u0130LK FRAME
\`\`\`text
Insert shot start prompt.
\`\`\`

#### SON FRAME
\`\`\`text
Insert shot end prompt.
\`\`\`

#### V\u0130DEO
\`\`\`text
Insert shot video prompt.
\`\`\`
`;

const scenicShotMarkdown = `# SHOT01 | 5s | 🎭 Tension: 2

## 🇹🇷 Türkçe Özet
Sabah erken saatlerde drone, sisle kapli cam ormaninin uzerinden yavasca suzuluyor.

## 🔗 Chain Status
FIRST SHOT — Video 1 baslangici

## Model Control
- Model: \`kling-3.0\`
- Model display: Kling 3.0
- Kling preset: \`ultra-realism\`
- Kling transition mode: Start+End

## Main Shot

### \u0130LK FRAME (SHOT01_START)

> START IMAGE: \`references/scenario-a/V1_SHOT01_sis-orman-drone_a1.jpg\`

\`\`\`
Main scenic shot start prompt.
\`\`\`

### SON FRAME (SHOT01_END)

\`\`\`
Main scenic shot end prompt.
\`\`\`

### V\u0130DEO

\`\`\`
Main scenic shot video prompt.

Audio direction:
- Language: NONE
- Type: Ambience
\`\`\`

---

## Coverage Shots (Kurgu Detaylari)

### SHOT01A — Wide Cutaway | 6s | WIDE

🇹🇷 Alternatif genis aci: Dag siluetleri arasindan yukselen sis tabakasi ve orman vadisi panoramasi.

\`\`\`
Coverage wide start prompt.
\`\`\`
\`\`\`
Coverage wide video prompt.
\`\`\`

### SHOT01B — Atmosphere Cutaway | 4s | ATMOSPHERE

🇹🇷 Detay: Cam dallarinda asili ciy damlalari ve orman dokusu.

\`\`\`
Coverage atmosphere start prompt.
\`\`\`
\`\`\`
Coverage atmosphere video prompt.
\`\`\`
`;

describe("markdown parser", () => {
  it("supports TR Summary headings and TR inline summaries in import markdown", () => {
    const parsed = parseShot(shotMarkdown, "scenario/test/act-01/scene-01/SHOT04.md");

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      shotNumber: "SHOT04",
      parentShotNum: null,
      shotType: "main",
      durationS: 15,
      tensionLevel: 5,
      chainStatus: "continue",
      prevShotRef: "SHOT03",
      model: "kling-3.0",
      cfg: 0.45,
      klingPreset: "ultra-realism",
      transitionMode: "Start+End",
      summaryTr:
        "Komutan durumun ciddiyetini anlatir ve vur emrini verir. Asker (Omer) emri tereddutsuz kabul eder.",
      requiresExternalReference: true,
      externalReferenceName: "omer.png",
    });
    expect(parsed[0]?.promptStart).toContain("Main shot start prompt.");
    expect(parsed[0]?.promptEnd).toContain("Main shot end prompt.");
    expect(parsed[0]?.promptVideo).toContain("Main shot video prompt.");

    expect(parsed[1]).toMatchObject({
      shotNumber: "SHOT04A",
      parentShotNum: "SHOT04",
      shotType: "ots",
      durationS: 5,
      summaryTr: "Telefon kamerasinin acisindan askerin yuzunun gerginligi.",
      requiresExternalReference: true,
      externalReferenceName: "omer.png",
    });
    expect(parsed[1]?.promptStart).toContain("Coverage shot start prompt.");
    expect(parsed[1]?.promptEnd).toContain("Coverage shot end prompt.");
    expect(parsed[1]?.promptVideo).toContain("Coverage shot video prompt.");

    expect(parsed[2]).toMatchObject({
      shotNumber: "SHOT04B",
      parentShotNum: "SHOT04",
      shotType: "detail",
      durationS: 4,
      summaryTr: "Askerin bosta kalan elinin silah kilifina gitmesinin detay cekimi.",
    });
    expect(parsed[2]?.promptStart).toContain("Insert shot start prompt.");
    expect(parsed[2]?.promptEnd).toContain("Insert shot end prompt.");
    expect(parsed[2]?.promptVideo).toContain("Insert shot video prompt.");
  });

  it("supports emoji summary headings, markdown inline values, and emoji coverage summaries", () => {
    const parsed = parseShot(
      scenicShotMarkdown,
      "scenario/test/act-01/scene-01/SHOT01.md",
    );

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      shotNumber: "SHOT01",
      shotType: "main",
      durationS: 5,
      tensionLevel: 2,
      chainStatus: "break",
      model: "kling-3.0",
      klingPreset: "ultra-realism",
      transitionMode: "Start+End",
      summaryTr:
        "Sabah erken saatlerde drone, sisle kapli cam ormaninin uzerinden yavasca suzuluyor.",
    });
    expect(parsed[0]?.promptStart).toContain("Main scenic shot start prompt.");
    expect(parsed[0]?.promptEnd).toContain("Main scenic shot end prompt.");
    expect(parsed[0]?.promptVideo).toContain("Main scenic shot video prompt.");
    expect(parsed[0]?.audioDirection?.type).toBe("ambience");

    expect(parsed[1]).toMatchObject({
      shotNumber: "SHOT01A",
      parentShotNum: "SHOT01",
      shotType: "wide",
      durationS: 6,
      summaryTr:
        "Dag siluetleri arasindan yukselen sis tabakasi ve orman vadisi panoramasi.",
    });
    expect(parsed[1]?.promptStart).toContain("Coverage wide start prompt.");
    expect(parsed[1]?.promptVideo).toContain("Coverage wide video prompt.");

    expect(parsed[2]).toMatchObject({
      shotNumber: "SHOT01B",
      parentShotNum: "SHOT01",
      durationS: 4,
      summaryTr: "Cam dallarinda asili ciy damlalari ve orman dokusu.",
    });
    expect(parsed[2]?.promptStart).toContain("Coverage atmosphere start prompt.");
    expect(parsed[2]?.promptVideo).toContain("Coverage atmosphere video prompt.");
  });
});
