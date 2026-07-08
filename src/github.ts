import { Octokit } from "@octokit/rest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ALL_ADT_LABELS } from "./labels.js";

type OctokitClient = Octokit;

function createClient(token: string): OctokitClient {
  return new Octokit({ auth: token });
}

interface GhIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  created_at: string;
}

interface GhComment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string } | null;
}

interface GhPR {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  html_url: string;
}

interface GhReview {
  id: number;
  state: string; // "APPROVED", "CHANGES_REQUESTED", "COMMENTED"
  user: { login: string } | null;
}

async function listIssuesByLabel(client: OctokitClient, repo: string, label: string): Promise<GhIssue[]> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.listForRepo({
    owner, repo: name,
    labels: label,
    state: "open",
    per_page: 100,
    direction: "asc",
    sort: "created",
  });
  return data as GhIssue[];
}

async function listReadyIssues(client: OctokitClient, repo: string): Promise<GhIssue[]> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.listForRepo({
    owner, repo: name,
    labels: "adt:ready",
    state: "open",
    per_page: 100,
    direction: "asc",     // FIFO: oldest first (ADR 0001)
    sort: "created",
  });
  return data as GhIssue[];
}

async function getIssue(client: OctokitClient, repo: string, issueNumber: number): Promise<GhIssue> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.get({ owner, repo: name, issue_number: issueNumber });
  return data as unknown as GhIssue;
}

async function getComments(client: OctokitClient, repo: string, issueNumber: number): Promise<GhComment[]> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.listComments({ owner, repo: name, issue_number: issueNumber, per_page: 100 });
  return data as GhComment[];
}

async function postComment(client: OctokitClient, repo: string, issueNumber: number, body: string): Promise<void> {
  const [owner, name] = repo.split("/");
  await client.rest.issues.createComment({ owner, repo: name, issue_number: issueNumber, body });
}

async function replaceAdtLabel(client: OctokitClient, repo: string, issueNumber: number, newLabel: string): Promise<void> {
  const [owner, name] = repo.split("/");
  // Remove all existing adt:* labels
  const { data: issue } = await client.rest.issues.get({ owner, repo: name, issue_number: issueNumber });
  const existingLabels: string[] = (issue.labels || []).map((l: any) => l.name);
  const toRemove = existingLabels.filter(l => ALL_ADT_LABELS.includes(l));
  for (const label of toRemove) {
    try { await client.rest.issues.removeLabel({ owner, repo: name, issue_number: issueNumber, name: label }); } catch (_) {}
  }
  await client.rest.issues.addLabels({ owner, repo: name, issue_number: issueNumber, labels: [newLabel] });
}

async function getPR(client: OctokitClient, repo: string, prNumber: number): Promise<GhPR> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.pulls.get({ owner, repo: name, pull_number: prNumber });
  return data as unknown as GhPR;
}

async function isPRMerged(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const pr = await getPR(client, repo, prNumber);
  return pr.merged === true;
}

async function isPRClosed(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const pr = await getPR(client, repo, prNumber);
  return pr.state === "closed" && !pr.merged;
}

async function hasApprovedReview(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.pulls.listReviews({ owner, repo: name, pull_number: prNumber, per_page: 100 });
  return data.some((r: any) => r.state === "APPROVED");
}

// PR conversation comments share the issue endpoint — listComments with
// issue_number = prNumber returns the same conversation thread the user sees
// in the PR's "Conversation" tab.
async function listPRComments(client: OctokitClient, repo: string, prNumber: number): Promise<GhComment[]> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.issues.listComments({ owner, repo: name, issue_number: prNumber, per_page: 100 });
  return data as GhComment[];
}

async function hasChangesRequestedReview(client: OctokitClient, repo: string, prNumber: number): Promise<boolean> {
  const [owner, name] = repo.split("/");
  const { data } = await client.rest.pulls.listReviews({ owner, repo: name, pull_number: prNumber, per_page: 100 });
  return data.some((r: any) => r.state === "CHANGES_REQUESTED");
}

// Read the PR URL out of the worktree's review-result.json so the worker can
// find the PR number without scanning issue comments. Returns null if the
// file is missing, malformed, or has no artifacts.prUrl.
function getPRNumberFromReviewResult(worktreePath: string): number | null {
  const resultPath = path.join(worktreePath, ".adt", "review-result.json");
  if (!fs.existsSync(resultPath)) return null;
  try {
    const raw = fs.readFileSync(resultPath, "utf-8");
    const obj = JSON.parse(raw);
    const prUrl: string | undefined = obj?.artifacts?.prUrl;
    if (typeof prUrl !== "string") return null;
    const m = /\/pull\/(\d+)/.exec(prUrl);
    return m ? parseInt(m[1], 10) : null;
  } catch (_) {
    return null;
  }
}

export {
  createClient, listReadyIssues, listIssuesByLabel, getIssue, getComments,
  postComment, replaceAdtLabel, getPR, isPRMerged, isPRClosed, hasApprovedReview,
  listPRComments, hasChangesRequestedReview, getPRNumberFromReviewResult,
  OctokitClient, GhIssue, GhComment, GhPR, GhReview,
};
