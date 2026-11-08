// Answers `gh`, at the process boundary.
//
// This is not a stub of github.js: the real github.js runs, builds the real
// arguments, and parses the real JSON through its own `answer()`. What is
// replaced is the subprocess -- the one thing a test cannot have. So the error
// taxonomy, the `-f` variable passing and the preview retry are all exercised
// for real, which is the only place they can be.

import { host } from "./host/herdr.js";

const VERSION = { code: 0, stdout: "gh version 2.62.0 (2026-01-01)", stderr: "" };

/**
 * `gh([[match, answer], ...])` -- the first route whose `match` appears
 * anywhere in the arguments answers. An answer is the object to return as
 * JSON, or a function of the arguments returning a raw `{ code, stdout,
 * stderr }`, for a test about failure.
 *
 * An unrouted call fails loudly rather than returning empty: a test that
 * accidentally reaches a second endpoint should say so.
 */
export function gh(routes = []) {
  host.onExec = (command, args) => {
    if (args[0] === "--version") return VERSION;
    for (const [match, answer] of routes) {
      if (args.some((arg) => String(arg).includes(match))) {
        return typeof answer === "function"
          ? answer(args)
          : { code: 0, stdout: JSON.stringify(answer), stderr: "" };
      }
    }
    return { code: 1, stdout: "", stderr: `no route for: ${args.join(" ")}` };
  };
}

/** A failure the way gh reports one: a non-zero exit and a message. */
export const fails = (stderr, code = 1) => () => ({ code, stdout: "", stderr });

/** The call `gh` was asked to make, for asserting an outgoing command. */
export const lastCall = () => host.exec.at(-1);

/** Every call that was not the `--version` probe. */
export const apiCalls = () => host.exec.filter((call) => call.args[0] !== "--version");
