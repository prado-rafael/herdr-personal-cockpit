// The viewer's open pull requests, in one `gh api graphql` call.
//
// `viewer.pullRequests` is the PRs the authenticated person wrote, in every repo
// they can read, public and private. The search API's `author:@me` is a gh/web
// shorthand the GraphQL API doesn't expand, so this avoids it (and the extra
// call that looking up the login would cost).

import { exec } from "herdr";

// Herdr's env is the one it started with: a gh installed after that isn't on its
// PATH until the app restarts, so the usual install spots are tried too.
const CANDIDATES = [
  "gh",
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "/usr/bin/gh",
];

// Errors carry a `kind` so the panel can offer the right fix. Plain objects, not
// Error subclasses: `instanceof` across a hot reload isn't worth relying on.
const fail = (kind, message) => Object.assign(new Error(message), { kind });

let found = null;

/** The gh that answered last, for `terminal.open` to use. */
export function ghCommand() {
  return found ?? "gh";
}

async function resolve() {
  if (found) return found;
  let last = "";
  for (const candidate of CANDIDATES) {
    try {
      const r = await exec(candidate, ["--version"]);
      if (r.code === 0) return (found = candidate);
      last = (r.stderr || r.stdout).trim();
    } catch (e) {
      last = String(e?.message ?? e);
    }
  }
  throw fail("no-gh", last);
}

// Counts stay small on purpose: 30 PRs of ~50 child nodes is about 20 GraphQL
// rate-limit points a call, against a budget of 5,000 an hour.
const QUERY = (mergeState) => `
query {
  viewer {
    login
    pullRequests(states: OPEN, first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number title url isDraft updatedAt
        additions deletions changedFiles
        mergeable reviewDecision${mergeState ? "\n        mergeStateStatus" : ""}
        headRefName baseRefName
        repository { nameWithOwner isArchived }
        comments { totalCount }
        reviewThreads(first: 20) { nodes { isResolved } }
        latestOpinionatedReviews(first: 10) { nodes { state } }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 20) {
                  totalCount
                  nodes {
                    __typename
                    ... on CheckRun { name conclusion status }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

// mergeStateStatus is still behind a preview media type.
const PREVIEW = "Accept: application/vnd.github.merge-info-preview+json";

async function ask(gh, mergeState) {
  const args = ["api", "graphql", "-f", `query=${QUERY(mergeState)}`];
  if (mergeState) args.push("-H", PREVIEW);
  const r = await exec(gh, args);
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.code !== 0) return { bad: text.trim() || `gh exited ${r.code}` };
  try {
    const body = JSON.parse(r.stdout);
    if (body.errors?.length) return { bad: body.errors.map((e) => e.message).join("; ") };
    if (!body.data?.viewer) return { bad: "gh returned no viewer" };
    return { data: body.data };
  } catch {
    return { bad: `couldn't read gh's answer: ${r.stdout.slice(0, 200)}` };
  }
}

const FAILED_RUN = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"];

function checksOf(pr) {
  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  // Null means the head commit has no checks at all, which is not a failure.
  if (!rollup) return { state: "NONE", failing: [], running: [], total: 0 };
  const nodes = rollup.contexts?.nodes ?? [];
  const failing = [], running = [];
  for (const c of nodes) {
    if (c.__typename === "CheckRun") {
      if (c.status !== "COMPLETED") running.push(c.name);
      else if (FAILED_RUN.includes(c.conclusion)) failing.push(c.name);
    } else {
      if (c.state === "PENDING" || c.state === "EXPECTED") running.push(c.context);
      else if (c.state === "FAILURE" || c.state === "ERROR") failing.push(c.context);
    }
  }
  return { state: rollup.state ?? "NONE", failing, running, total: rollup.contexts?.totalCount ?? nodes.length };
}

const RED = (state) => state === "FAILURE" || state === "ERROR";

function shape(pr) {
  const checks = checksOf(pr);
  const approvals = (pr.latestOpinionatedReviews?.nodes ?? []).filter((r) => r.state === "APPROVED").length;
  const unresolved = (pr.reviewThreads?.nodes ?? []).filter((n) => !n.isResolved).length;
  const conflicts = pr.mergeable === "CONFLICTING";
  const changesRequested = pr.reviewDecision === "CHANGES_REQUESTED";
  // mergeStateStatus is what GitHub's own merge button goes by, so it decides
  // "ready" where it's available; without it, an approval has to stand in.
  const clean = pr.mergeStateStatus === "CLEAN";
  const blocked = pr.mergeStateStatus === "BLOCKED";
  const behind = pr.mergeStateStatus === "BEHIND";
  const landable = !conflicts && !changesRequested && !RED(checks.state);
  const group = pr.isDraft
    ? "draft"
    : RED(checks.state) || changesRequested || conflicts
      ? "attention"
      : landable && (clean || (approvals > 0 && pr.reviewDecision === "APPROVED"))
        ? "ready"
        : "waiting";
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    draft: pr.isDraft,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    comments: pr.comments?.totalCount ?? 0,
    repo: pr.repository?.nameWithOwner ?? "",
    branch: pr.headRefName,
    base: pr.baseRefName,
    reviewDecision: pr.reviewDecision,
    checks, approvals, unresolved, conflicts, changesRequested, clean, blocked, behind, group,
  };
}

/** Resolves with `{ login, total, pulls }`, or rejects with `kind`:
 *  "no-gh" (not installed), "no-auth" (never signed in), "error". */
export async function fetchPulls() {
  const gh = await resolve();
  let out = await ask(gh, true);
  // A graduated or withdrawn preview takes mergeStateStatus with it; everything
  // else on the row survives without it.
  if (out.bad && /mergeStateStatus|merge-info-preview|preview/i.test(out.bad)) out = await ask(gh, false);
  if (out.bad) {
    const auth = /auth login|not logged in|authentication|GH_TOKEN|bad credentials|HTTP 401/i.test(out.bad);
    throw fail(auth ? "no-auth" : "error", out.bad);
  }
  const prs = (out.data.viewer.pullRequests.nodes ?? []).filter((n) => n && !n.repository?.isArchived);
  return {
    login: out.data.viewer.login,
    total: out.data.viewer.pullRequests.totalCount ?? prs.length,
    pulls: prs.map(shape),
  };
}

const seconds = (when) => {
  const at = typeof when === "number" ? when : Date.parse(when);
  return at ? Math.max(0, (Date.now() - at) / 1000) : null;
};

/** "just now", "6m ago", "3d ago". Takes an ISO string or an epoch in ms. */
export function ago(when) {
  const s = seconds(when);
  if (s === null) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 2592000)}mo ago`;
}

/** The same, short enough for a sidebar row: "now", "6m", "3d". */
export function agoShort(when) {
  const s = seconds(when);
  if (s === null) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 2592000)}mo`;
}
