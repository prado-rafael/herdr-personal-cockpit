// Everything that talks to GitHub, for every panel in this mod.
//
// One way in: the `gh` CLI. It already holds the login (its own keyring, or
// GH_TOKEN) and behaves the same on Windows, macOS and Linux. The tasks panel
// used to read a bearer token out of Git Credential Manager through a
// PowerShell script instead -- Windows-only, and a second login path to keep
// working for no gain, since gh was installed and authenticated anyway.

import { exec } from "herdr";

// Herdr's env is the one it started with: a gh installed after that isn't on
// its PATH until the app restarts, so the usual install spots are tried too.
// This is load-bearing on Windows, where the installer does not touch the PATH
// of an already-running process.
const CANDIDATES = [
  "gh",
  "C:\\Program Files\\GitHub CLI\\gh.exe",
  "C:\\Program Files (x86)\\GitHub CLI\\gh.exe",
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "/usr/bin/gh",
];

/** Errors carry a `kind` so a panel can offer the right fix:
 *  "no-gh" (not installed), "no-auth" (never signed in), "not-found" (no such
 *  repo, or the login cannot see it), "error" (anything else). Plain objects,
 *  not Error subclasses: `instanceof` across a hot reload isn't worth relying on. */
const fail = (kind, message) => Object.assign(new Error(message), { kind });

const AUTH = /auth login|not logged in|authentication|GH_TOKEN|bad credentials|HTTP 401|HTTP 403/i;
// GitHub answers 404, not 403, for a private repo the token cannot see.
const MISSING = /HTTP 404|Not Found/i;

let found = null;

/** The gh that answered last, for `terminal.open` to use. */
export function ghCommand() {
  return found ?? "gh";
}

export async function resolve() {
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
  throw fail("no-gh", last || "gh not found");
}

// Turns gh's exit into either parsed JSON or a typed throw. Both GraphQL and
// REST come through here so every panel reports trouble the same way.
function answer(r, args) {
  const text = `${r.stdout}\n${r.stderr}`.trim();
  if (r.code !== 0) {
    const kind = AUTH.test(text) ? "no-auth" : MISSING.test(text) ? "not-found" : "error";
    throw fail(kind, text || `gh ${args[0]} exited ${r.code}`);
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw fail("error", `couldn't read gh's answer: ${r.stdout.slice(0, 200)}`);
  }
}

/** Runs a GraphQL query. `preview` adds an Accept header for a field still
 *  behind a preview media type; pass null for none. */
export async function graphql(query, preview = null) {
  const gh = await resolve();
  const args = ["api", "graphql", "-f", `query=${query}`];
  if (preview) args.push("-H", preview);
  const body = answer(await exec(gh, args), args);
  if (body.errors?.length) {
    const message = body.errors.map((e) => e.message).join("; ");
    throw fail(AUTH.test(message) ? "no-auth" : "error", message);
  }
  if (!body.data) throw fail("error", "gh returned no data");
  return body.data;
}

/** A REST call: `rest("repos/owner/name/issues?state=open")`. */
export async function rest(path) {
  const gh = await resolve();
  const args = ["api", path];
  return answer(await exec(gh, args), args);
}

/** `owner/name` for every repo the login can push to, for the repo picker's
 *  suggestions. `owner` narrows it to one user or org -- which is how a repo on
 *  another account (a work org) becomes reachable at all, since a bare
 *  `gh repo list` only knows the authenticated user's own.
 *  Resolves with [] rather than throwing: suggestions are a nicety, and the
 *  picker always accepts a typed `owner/name`. */
export async function repoList(owner = null, limit = 100) {
  try {
    const gh = await resolve();
    const args = ["repo", "list"];
    if (owner) args.push(owner);
    args.push("--limit", String(limit), "--json", "nameWithOwner,isPrivate,updatedAt");
    const r = await exec(gh, args);
    if (r.code !== 0) return [];
    const body = JSON.parse(r.stdout);
    return Array.isArray(body) ? body : [];
  } catch {
    return [];
  }
}

/** The issue-form templates a repo offers, by file name, newest API shape
 *  first. `config.yml` is the chooser's own settings, not a template.
 *
 *  Resolves with [] for a repo with no `.github/ISSUE_TEMPLATE` folder, which
 *  GitHub answers with a 404 — the same answer as no access, and harmless
 *  either way: no templates just means a blank new-issue form. */
export async function issueTemplates(repo) {
  try {
    const body = await rest(`repos/${repo}/contents/.github/ISSUE_TEMPLATE`);
    if (!Array.isArray(body)) return [];
    return body
      .filter((f) => f.type === "file" && /\.(ya?ml|md)$/i.test(f.name) && f.name.toLowerCase() !== "config.yml")
      .map((f) => f.name);
  } catch {
    return [];
  }
}

/** The signed-in login, or null. Cheap and cached: the header shows it in a
 *  tooltip, and it is how "signed in at all" gets answered without a panel
 *  having to interpret an error. */
let login = null;
export async function viewer() {
  if (login) return login;
  try {
    const data = await graphql("query { viewer { login } }");
    return (login = data.viewer?.login ?? null);
  } catch {
    return null;
  }
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
