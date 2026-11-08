// A stand-in for a gpui element: every method returns itself, so a builder
// chain of any length runs without the real toolkit.
//
// It records what it was asked to do, for one purpose only: reaching the
// handlers. A panel's keys are documented behaviour -- `r` refreshes, `enter`
// opens the row -- but the handler is built into an element and handed to the
// app, so a test has no other way to press a key.
//
// Nothing here asserts on what a row *looks* like. That is the app's business
// and changes when the design does.

function node(tag) {
  return { tag, calls: [], kids: [], text: [] };
}

function adopt(parent, value) {
  if (value === null || value === undefined || value === false) return;
  if (typeof value === "string" || typeof value === "number") {
    parent.text.push(String(value));
    return;
  }
  const inner = value?.__node;
  if (inner) parent.kids.push(inner);
}

export function element(tag = "el") {
  const self = node(tag);
  const proxy = new Proxy(function () {}, {
    apply: () => proxy,
    get(_target, prop) {
      if (prop === "__node") return self;
      // Not a thenable: an element returned from an async function would
      // otherwise be awaited into oblivion.
      if (prop === "then") return undefined;
      return (...args) => {
        self.calls.push({ name: prop, args });
        if (prop === "child" || prop === "children") {
          for (const value of args.flat(Infinity)) adopt(self, value);
        }
        return proxy;
      };
    },
  });
  return proxy;
}

/** Every call of one builder method, on an element or any of its descendants. */
export function callsOf(value, name) {
  const self = value?.__node ?? value;
  if (!self) return [];
  return [
    ...self.calls.filter((call) => call.name === name).map((call) => call.args),
    ...self.kids.flatMap((kid) => callsOf(kid, name)),
  ];
}

/**
 * The function given to a builder method -- `handlerOf(panel, "on_key_down")`.
 * Throws rather than returning undefined: a test that silently pressed nothing
 * would pass for the wrong reason.
 */
export function handlerOf(value, name, at = 0) {
  const found = callsOf(value, name)
    .map((args) => args.find((arg) => typeof arg === "function"))
    .filter(Boolean);
  if (!found[at]) {
    throw new Error(`no ${name} handler at index ${at} (found ${found.length})`);
  }
  return found[at];
}

/** How many of a given handler were wired. */
export const countOf = (value, name) => callsOf(value, name).length;

/** Every string that ended up in an element or its descendants, in order. */
export function textOf(value) {
  const self = value?.__node ?? value;
  if (!self) return [];
  return [...self.text, ...self.kids.flatMap((kid) => textOf(kid))];
}
