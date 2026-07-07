import { describe, it, expect } from "vitest";
import { isEmptyName, normalizeName } from "../../src/habits/normalize.js";

describe("normalizeName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeName("  read  ")).toBe("read");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName("\t\n")).toBe("");
  });

  it("preserves case (case-sensitive dedupe happens elsewhere)", () => {
    expect(normalizeName("Exercise")).toBe("Exercise");
    expect(normalizeName("exercise")).toBe("exercise");
  });

  it("preserves internal whitespace", () => {
    expect(normalizeName("  drink water  ")).toBe("drink water");
  });
});

describe("isEmptyName", () => {
  it("returns true for empty / whitespace-only strings", () => {
    expect(isEmptyName("")).toBe(true);
    expect(isEmptyName("   ")).toBe(true);
    expect(isEmptyName("\n")).toBe(true);
  });

  it("returns false for any non-empty string after trim", () => {
    expect(isEmptyName("read")).toBe(false);
    expect(isEmptyName("  a  ")).toBe(false);
  });
});