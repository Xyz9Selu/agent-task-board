import { describe, it, expect } from "vitest";
import { addDays, todayLocal } from "../../src/habits/today.js";

describe("todayLocal", () => {
  it("returns YYYY-MM-DD in local time", () => {
    const d = new Date(2026, 6, 2, 13, 0, 0); // Jul 2 2026 13:00 local
    expect(todayLocal(d)).toBe("2026-07-02");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5, 9, 0, 0);
    expect(todayLocal(d)).toBe("2026-01-05");
  });

  it("returns the same date at midnight as the day before noon", () => {
    const start = new Date(2026, 6, 7, 0, 0, 0);
    const end = new Date(2026, 6, 7, 23, 59, 59);
    expect(todayLocal(start)).toBe(todayLocal(end));
  });
});

describe("addDays", () => {
  it("moves forward by calendar days", () => {
    expect(addDays("2026-07-02", 1)).toBe("2026-07-03");
    expect(addDays("2026-07-02", 7)).toBe("2026-07-09");
  });

  it("moves backward by calendar days", () => {
    expect(addDays("2026-07-02", -1)).toBe("2026-07-01");
    expect(addDays("2026-07-02", -7)).toBe("2026-06-25");
  });

  it("crosses month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("walks across a US spring-forward DST day without skipping a date", () => {
    // Mar 8 2026 is DST spring-forward in the US. Adding one calendar day
    // from Mar 7 must land on Mar 8, and from Mar 8 must land on Mar 9.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("walks across a US fall-back DST day without skipping a date", () => {
    // Nov 1 2026 is DST fall-back in the US. Same invariant: one calendar
    // day in == one calendar day out.
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});