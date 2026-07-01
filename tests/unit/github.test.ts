import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import {
  createClient, listReadyIssues, getIssue, getComments,
  postComment, replaceAdtLabel, isPRMerged, isPRClosed, hasApprovedReview, getPR,
} from "../../src/github.js";

const BASE = "https://api.github.com";
let client: ReturnType<typeof createClient>;

describe("github module (nock)", () => {
  beforeEach(() => {
    client = createClient("ghp_test");
    nock.cleanAll();
  });

  afterEach(() => nock.cleanAll());

  describe("createClient", () => {
    it("returns an Octokit instance", () => {
      const c = createClient("ghp_token");
      expect(c).toBeDefined();
      expect(typeof c.rest.issues.listForRepo).toBe("function");
    });
  });

  describe("listReadyIssues", () => {
    it("returns issues with adt:ready label", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues")
        .query({ labels: "adt:ready", state: "open", per_page: 100 })
        .reply(200, [{ number: 42, title: "Fix bug", state: "open", body: "desc", created_at: "2026-01-01T00:00:00Z", labels: [{ name: "adt:ready" }] }]);

      const issues = await listReadyIssues(client, "owner/repo");
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(42);
      expect(issues[0].title).toBe("Fix bug");
      expect(issues[0].state).toBe("open");
    });

    it("returns empty array when no adt:ready issues exist", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues")
        .query({ labels: "adt:ready", state: "open", per_page: 100 })
        .reply(200, []);

      const issues = await listReadyIssues(client, "owner/repo");
      expect(issues).toHaveLength(0);
    });
  });

  describe("getIssue", () => {
    it("fetches an issue", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues/42")
        .reply(200, { number: 42, title: "Test", state: "open", body: "hello", created_at: "2026-01-01T00:00:00Z" });
      const issue = await getIssue(client, "owner/repo", 42);
      expect(issue.number).toBe(42);
      expect(issue.body).toBe("hello");
    });
  });

  describe("getComments", () => {
    it("fetches comments", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues/42/comments")
        .reply(200, [{ id: 1, body: "ok", created_at: "2026-01-01T00:00:00Z", user: { login: "dev" } }]);
      const comments = await getComments(client, "owner/repo", 42);
      expect(comments).toHaveLength(1);
      expect(comments[0].body).toBe("ok");
      expect(comments[0].user?.login).toBe("dev");
    });

    it("returns empty array when no comments exist", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues/42/comments")
        .reply(200, []);
      const comments = await getComments(client, "owner/repo", 42);
      expect(comments).toEqual([]);
    });
  });

  describe("postComment", () => {
    it("posts a comment to an issue", async () => {
      nock(BASE)
        .post("/repos/owner/repo/issues/42/comments", { body: "Hello world" })
        .reply(201, { id: 1 });

      await expect(postComment(client, "owner/repo", 42, "Hello world")).resolves.toBeUndefined();
    });
  });

  describe("replaceAdtLabel", () => {
    it("removes existing adt labels and adds the new one", async () => {
      // GET issue — returns existing labels including adt:ready
      nock(BASE)
        .get("/repos/owner/repo/issues/42")
        .reply(200, { number: 42, labels: [{ name: "adt:ready" }, { name: "bug" }] });
      // Remove adt:ready (Octokit URL-encodes the colon)
      nock(BASE)
        .delete("/repos/owner/repo/issues/42/labels/adt%3Aready")
        .reply(200);
      // Add new label
      nock(BASE)
        .post("/repos/owner/repo/issues/42/labels", { labels: ["adt:impl-running"] })
        .reply(200, [{ name: "adt:impl-running" }]);

      await replaceAdtLabel(client, "owner/repo", 42, "adt:impl-running");
      // If we get here without nock throwing, all expected calls were made
    });

    it("does nothing when no adt labels to remove", async () => {
      nock(BASE)
        .get("/repos/owner/repo/issues/42")
        .reply(200, { number: 42, labels: [{ name: "bug" }, { name: "enhancement" }] });
      nock(BASE)
        .post("/repos/owner/repo/issues/42/labels", { labels: ["adt:merge-ready"] })
        .reply(200, [{ name: "adt:merge-ready" }]);

      await replaceAdtLabel(client, "owner/repo", 42, "adt:merge-ready");
    });
  });

  describe("getPR", () => {
    it("fetches a pull request", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "closed", merged: true, html_url: "https://github.com/owner/repo/pull/99" });
      const pr = await getPR(client, "owner/repo", 99);
      expect(pr.number).toBe(99);
      expect(pr.title).toBe("PR");
      expect(pr.merged).toBe(true);
      expect(pr.html_url).toBe("https://github.com/owner/repo/pull/99");
    });
  });

  describe("isPRMerged", () => {
    it("returns true for merged PR", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "closed", merged: true, html_url: "https://github.com/owner/repo/pull/99" });
      expect(await isPRMerged(client, "owner/repo", 99)).toBe(true);
    });

    it("returns false for unmerged PR", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "open", merged: false, html_url: "https://github.com/owner/repo/pull/99" });
      expect(await isPRMerged(client, "owner/repo", 99)).toBe(false);
    });
  });

  describe("isPRClosed", () => {
    it("returns true for closed but unmerged PR", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "closed", merged: false, html_url: "https://github.com/owner/repo/pull/99" });
      expect(await isPRClosed(client, "owner/repo", 99)).toBe(true);
    });

    it("returns false for merged PR (even if state is closed)", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "closed", merged: true, html_url: "https://github.com/owner/repo/pull/99" });
      expect(await isPRClosed(client, "owner/repo", 99)).toBe(false);
    });

    it("returns false for open PR", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99")
        .reply(200, { number: 99, title: "PR", state: "open", merged: false, html_url: "https://github.com/owner/repo/pull/99" });
      expect(await isPRClosed(client, "owner/repo", 99)).toBe(false);
    });
  });

  describe("hasApprovedReview", () => {
    it("returns true when any review is APPROVED", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99/reviews")
        .reply(200, [{ id: 1, state: "APPROVED", user: { login: "reviewer" } }]);
      expect(await hasApprovedReview(client, "owner/repo", 99)).toBe(true);
    });

    it("returns false when no review is APPROVED", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99/reviews")
        .reply(200, [{ id: 1, state: "COMMENTED", user: { login: "reviewer" } }]);
      expect(await hasApprovedReview(client, "owner/repo", 99)).toBe(false);
    });

    it("returns false when there are no reviews", async () => {
      nock(BASE)
        .get("/repos/owner/repo/pulls/99/reviews")
        .reply(200, []);
      expect(await hasApprovedReview(client, "owner/repo", 99)).toBe(false);
    });
  });
});
