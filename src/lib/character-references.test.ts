import { describe, expect, it } from "vitest";
import { moveCharacterReference, removeCharacterReference } from "@/lib/character-references";

describe("character references", () => {
  it("moves references without losing order integrity", () => {
    expect(
      moveCharacterReference(["a.png", "b.png", "c.png"], "b.png", 1),
    ).toEqual(["a.png", "c.png", "b.png"]);
  });

  it("falls back primary image to the first remaining reference after removal", () => {
    expect(
      removeCharacterReference(["a.png", "b.png", "c.png"], "b.png", "b.png"),
    ).toEqual({
      refImages: ["a.png", "c.png"],
      primaryImage: "a.png",
    });
  });
});
