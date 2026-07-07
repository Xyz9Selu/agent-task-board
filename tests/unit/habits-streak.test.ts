import { describe, it, expect } from "vitest";
import { computeStreak } from "../../src/habits/streak.js";

const today = "2026-07-07";

describe("computeStreak", () => {
  it("returns 0 for empty completions", () => {
    expect(computeStreak([], today)).toBe(0);
  });

  it("returns 0 when today is not present (no grace day)", () => {
    expect(computeStreak(["2026-07-06"], today)).toBe(0);
    expect(computeStreak(["2026-07-05", "2026-07-06"], today)).toBe(0);
  });

  it("returns 1 when only today is present", () => {
    expect(computeStreak([today], today)).toBe(1);
  });

  it("returns 2 for today + yesterday", () => {
    expect(computeStreak(["2026-07-06", today], today)).toBe(2);
  });

  it("returns 7 for seven consecutive days ending today", () => {
    const days = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      today,
    ];
    expect(computeStreak(days, today)).toBe(7);
  });

  it("stops at the first gap", () => {
    // Gap on 2026-07-02 — every day from 2026-07-03 onward is present, so the
    // streak walks back 5 days (07-07, 07-06, 07-05, 07-04, 07-03) before
    // hitting the missing 07-02.
    const days = [
      "2026-07-01",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      today,
    ];
    expect(computeStreak(days, today)).toBe(5);
  });

  it("handles a 30-day gap and returns 1", () => {
    const days = ["2026-06-07", today];
    expect(computeStreak(days, today)).toBe(1);
  });

  it("trusts a sorted input — out-of-order still produces correct streak", () => {
    // The helper does not defensively sort; the store always sorts first.
    // Sanity-check the documented contract: callers hand us sorted input.
    // Even out-of-order, a Set lookup is order-independent, so the walk
    // finds every consecutive day back from today.
    const days = ["2026-07-01", today, "2026-07-06", "2026-07-05"];
    expect(computeStreak(days, today)).toBe(3);
  });

  it("walks across a US spring-forward DST day correctly", () => {
    // Mar 8 2026 is DST spring-forward in the US; walking back one calendar
    // day from Mar 8 should land on Mar 7 (and on Mar 6, etc.).
    expect(computeStreak(["2026-03-07", "2026-03-08"], "2026-03-08")).toBe(2);
    expect(
      computeStreak(["2026-03-06", "2026-03-07", "2026-03-08"], "2026-03-08"),
    ).toBe(3);
  });

  it("walks across a US fall-back DST day correctly", () => {
    // Nov 1 2026 is DST fall-back in the US; same invariant as above.
    expect(computeStreak(["2026-10-31", "2026-11-01"], "2026-11-01")).toBe(2);
  });

  it("does not double-count duplicate entries", () => {
    // Even though the store dedupes, the helper uses a Set, so duplicates
    // in `completions` are harmless.
    expect(computeStreak([today, today, today], today)).toBe(1);
  });
});