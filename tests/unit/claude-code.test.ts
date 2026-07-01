import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildPromptFile, DEFAULT_TOOLS } from "../../src/claude-code.js";

const TMP = `/tmp/claude-code-test-${Date.now()}`;
const WT = path.join(TMP, "worktree");

beforeEach(() => {
  fs.mkdirSync(path.join(WT, ".adt"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("buildPromptFile", () => {
  it("creates context files and returns prompt path", () => {
    const issue = { number: 42, title: "Fix bug", body: "description of bug", repo: "owner/repo" };
    const comments = [{ id: 1, body: "ok", user: { login: "dev" } }];

    const promptPath = buildPromptFile(WT, issue, comments, "reqs");

    expect(promptPath).toBe(path.join(WT, ".adt", "prompt.md"));
    expect(fs.existsSync(promptPath)).toBe(true);
    expect(fs.existsSync(path.join(WT, ".adt", "issue.json"))).toBe(true);
    expect(fs.existsSync(path.join(WT, ".adt", "comments.json"))).toBe(true);
    expect(fs.existsSync(path.join(WT, ".adt", "stage.txt"))).toBe(true);

    const stageTxt = fs.readFileSync(path.join(WT, ".adt", "stage.txt"), "utf-8");
    expect(stageTxt).toBe("reqs");

    const issueJson = JSON.parse(fs.readFileSync(path.join(WT, ".adt", "issue.json"), "utf-8"));
    expect(issueJson.number).toBe(42);
    expect(issueJson.title).toBe("Fix bug");
  });
});

describe("DEFAULT_TOOLS", () => {
  it("has entries for all 4 stages", () => {
    for (const s of ["reqs", "design", "impl", "review"]) {
      expect(Array.isArray(DEFAULT_TOOLS[s as keyof typeof DEFAULT_TOOLS])).toBe(true);
      expect(DEFAULT_TOOLS[s as keyof typeof DEFAULT_TOOLS].length).toBeGreaterThan(0);
    }
  });
});
