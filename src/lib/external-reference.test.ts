import { describe, expect, it } from "vitest";
import {
  resolveInheritedExternalReferencePath,
  type ExternalReferenceLookupShot,
} from "@/lib/external-reference";

function buildShot(
  overrides: Partial<ExternalReferenceLookupShot> & Pick<ExternalReferenceLookupShot, "id" | "shotNumber">,
): ExternalReferenceLookupShot {
  return {
    id: overrides.id,
    shotNumber: overrides.shotNumber,
    parentShotId: overrides.parentShotId ?? null,
    prevShotId: overrides.prevShotId ?? null,
    requiresExternalReference: overrides.requiresExternalReference ?? false,
    externalReferenceName: overrides.externalReferenceName ?? null,
    externalReferencePath: overrides.externalReferencePath ?? null,
  };
}

describe("resolveInheritedExternalReferencePath", () => {
  it("returns the direct path when the shot already has one", () => {
    const shots = [
      buildShot({
        id: "shot-1",
        shotNumber: "SHOT01",
        requiresExternalReference: true,
        externalReferencePath: "assets/references/omer.png",
      }),
    ];

    expect(resolveInheritedExternalReferencePath(shots[0], shots)).toBe(
      "assets/references/omer.png",
    );
  });

  it("inherits the path from the previous shot when the current shot is chained", () => {
    const shots = [
      buildShot({
        id: "shot-1",
        shotNumber: "SHOT01",
        requiresExternalReference: true,
        externalReferencePath: "assets/references/omer.png",
      }),
      buildShot({
        id: "shot-2",
        shotNumber: "SHOT02",
        prevShotId: "shot-1",
        requiresExternalReference: true,
      }),
    ];

    expect(resolveInheritedExternalReferencePath(shots[1], shots)).toBe(
      "assets/references/omer.png",
    );
  });

  it("inherits the path from the parent shot for coverage frames", () => {
    const shots = [
      buildShot({
        id: "shot-1",
        shotNumber: "SHOT03",
        requiresExternalReference: true,
        externalReferencePath: "assets/references/omer.png",
      }),
      buildShot({
        id: "shot-2",
        shotNumber: "SHOT03A",
        parentShotId: "shot-1",
        requiresExternalReference: true,
      }),
    ];

    expect(resolveInheritedExternalReferencePath(shots[1], shots)).toBe(
      "assets/references/omer.png",
    );
  });

  it("inherits by shared uploaded reference name when another shot already resolved it", () => {
    const shots = [
      buildShot({
        id: "shot-1",
        shotNumber: "SHOT01",
        requiresExternalReference: true,
        externalReferenceName: "omer.png",
        externalReferencePath: "assets/references/omer.png",
      }),
      buildShot({
        id: "shot-2",
        shotNumber: "SHOT08",
        requiresExternalReference: true,
        externalReferenceName: "omer.png",
      }),
    ];

    expect(resolveInheritedExternalReferencePath(shots[1], shots)).toBe(
      "assets/references/omer.png",
    );
  });

  it("breaks recursive cycles safely when no reference exists anywhere", () => {
    const shots = [
      buildShot({
        id: "shot-1",
        shotNumber: "SHOT09",
        requiresExternalReference: true,
        prevShotId: "shot-2",
      }),
      buildShot({
        id: "shot-2",
        shotNumber: "SHOT10",
        requiresExternalReference: true,
        prevShotId: "shot-1",
      }),
    ];

    expect(resolveInheritedExternalReferencePath(shots[0], shots)).toBeNull();
  });
});
