// The panel role.
//
// Four modules -- pulls, issues, routines, team -- are interchangeable to
// list.js, which imports all four and treats whichever it was given as
// `this.source`. That makes them players of one role, so this is one set of
// tests run against every one of them: the shared role test, rather than four
// copies that drift.
//
// The contract is read off list.js's own use of `source`, not invented here.
// What it reaches for unguarded is required; what it reaches for behind
// `if (source.x)` is optional, and only has to be the right type when present.
//
// This is the file that makes a refactor safe. Split kit.js, move a panel into
// a subfolder, rename a private helper -- if all four still answer the same
// messages with the same kinds of answer, list.js cannot tell the difference,
// and neither can the app.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as pulls from "../mods/personal-cockpit/pulls.js";
import * as issues from "../mods/personal-cockpit/issues.js";
import * as routines from "../mods/personal-cockpit/routines.js";
import * as team from "../mods/personal-cockpit/team.js";

const PANELS = [
  ["pulls", pulls],
  ["issues", issues],
  ["routines", routines],
  ["team", team],
];

// Used by list.js without asking whether it is there.
const REQUIRED = {
  panel: "string",
  title: "string",
  icon: "string",
  loading: "string",
  empty: "string",
  needsRepo: "boolean",
  refreshMs: "number",
  load: "function",
  sections: "function",
  attention: "function",
  rowOf: "function",
};

// Reached for behind a guard: a panel may answer or not, but a half-answer --
// a `configure` that is a string, say -- would break the copy that has one.
const OPTIONAL = {
  stampNote: "function",
  footnote: "function",
  configure: "function",
  configureTip: "string",
  act: "function",
  cached: "function",
  save: "function",
  newUrl: "function",
  newLabel: "string",
};

/** The role, as one assertion. A module either plays it or it does not. */
export function assertPanelRole(mod, name) {
  for (const [member, type] of Object.entries(REQUIRED)) {
    assert.equal(typeof mod[member], type, `${name}.${member} must be a ${type}`);
  }
  for (const [member, type] of Object.entries(OPTIONAL)) {
    if (mod[member] !== undefined) {
      assert.equal(typeof mod[member], type, `${name}.${member} must be a ${type} when present`);
    }
  }
  for (const member of ["panel", "title", "icon", "loading", "empty"]) {
    assert.ok(mod[member].length > 0, `${name}.${member} must not be empty`);
  }
  assert.ok(mod.refreshMs > 0, `${name}.refreshMs must be a positive number of ms`);
}

for (const [name, mod] of PANELS) {
  test(`${name} plays the panel role`, () => {
    assertPanelRole(mod, name);
  });

  test(`${name}.sections([]) is empty rather than four empty groups`, () => {
    // An empty list draws the panel's `empty` line, so a section with no items
    // in it would be a heading over nothing.
    assert.deepEqual(mod.sections([]), []);
  });

  test(`${name}.sections returns {label, items} groups`, () => {
    for (const section of mod.sections([])) {
      assert.equal(typeof section.label, "string");
      assert.ok(Array.isArray(section.items));
    }
  });

  test(`${name}.attention([]) is 0`, () => {
    const count = mod.attention([]);
    assert.equal(typeof count, "number");
    assert.equal(count, 0);
  });

  test(`${name}.stampNote survives having no meta`, () => {
    // list.js calls it with whatever `load` returned, and a failed first load
    // leaves that null.
    assert.doesNotThrow(() => mod.stampNote(null, null));
    assert.doesNotThrow(() => mod.stampNote(undefined, undefined));
  });

  if (mod.footnote) {
    test(`${name}.footnote survives having no meta`, () => {
      assert.doesNotThrow(() => mod.footnote(null));
      assert.doesNotThrow(() => mod.footnote(undefined));
    });
  }
}

test("the four panel keys are distinct", () => {
  // `panel` names the layout block, the remembered height in shared state and
  // the cache. Two panels sharing one would share a height and a cached list.
  const keys = PANELS.map(([, mod]) => mod.panel);
  assert.equal(new Set(keys).size, keys.length, `collision in ${keys.join(", ")}`);
});

test("only the panel that needs a repo asks for one", () => {
  // Not a style rule: `needsRepo` decides whether the panel blocks on a repo
  // pick, and a panel that asked for one it never uses would never load.
  assert.equal(issues.needsRepo, true);
  for (const [name, mod] of PANELS.filter(([n]) => n !== "issues")) {
    assert.equal(mod.needsRepo, false, `${name} should not need a repo`);
  }
});

test("a repo-less panel ships no cache, and the repo-keyed one does", () => {
  // The cache is keyed by repo, so a panel without one has nothing to key by.
  assert.equal(typeof issues.cached, "function");
  assert.equal(typeof issues.save, "function");
  for (const [name, mod] of PANELS.filter(([n]) => n !== "issues")) {
    assert.equal(mod.cached, undefined, `${name} should not cache`);
    assert.equal(mod.save, undefined, `${name} should not cache`);
  }
});

// ---- the contract is a real check -----------------------------------------

test("the role assertion rejects a module that does not play the role", () => {
  // Without this, every test above could be passing vacuously.
  const complete = { ...REQUIRED };
  for (const [member, type] of Object.entries(REQUIRED)) {
    complete[member] =
      type === "string" ? "x" : type === "number" ? 1 : type === "boolean" ? false : () => [];
  }
  assert.doesNotThrow(() => assertPanelRole(complete, "complete"));

  for (const member of Object.keys(REQUIRED)) {
    const missing = { ...complete };
    delete missing[member];
    assert.throws(() => assertPanelRole(missing, "missing"), new RegExp(`missing\\.${member}`), `dropping ${member} should fail the role`);
  }
});

test("the role assertion rejects an empty title and a zero interval", () => {
  const base = {
    panel: "x", title: "x", icon: "x", loading: "x", empty: "x",
    needsRepo: false, refreshMs: 1,
    load: () => {}, sections: () => [], attention: () => 0, rowOf: () => {},
  };
  assert.throws(() => assertPanelRole({ ...base, title: "" }, "m"), /title must not be empty/);
  assert.throws(() => assertPanelRole({ ...base, refreshMs: 0 }, "m"), /positive number of ms/);
  assert.throws(() => assertPanelRole({ ...base, configure: "not a function" }, "m"), /configure must be a function/);
});
