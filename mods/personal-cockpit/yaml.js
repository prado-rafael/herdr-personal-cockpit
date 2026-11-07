// A YAML reader for exactly the shape routines.yml has, and nothing else.
//
// The runtime ships no YAML parser -- `JSON.parse` is built in, YAML is not --
// and vendoring js-yaml costs ~40KB of third-party bundle for a file with four
// constructs in it. So this reads those four:
//
//   # comment              anywhere outside a block scalar
//   key: value             at the top level, or inside a list item
//   key:                   followed by `- ` items
//   key: |                 a block scalar: every deeper line, dedented
//
// Anything else is reported by line number rather than guessed at. That is the
// whole reason this is hand-written: a parser that silently drops a line it did
// not understand would turn a typo into a routine that never fires, found weeks
// later. `problems` is rendered in the panel, so a malformed file says so.

/** Leading tabs are the one indentation mistake YAML forbids outright, and the
 *  one an editor makes invisible. */
const hasTab = (line) => /^[ ]*\t/.test(line);

const indentOf = (line) => line.match(/^ */)[0].length;

// Leading space is the indentation, measured separately by `indentOf`, so the
// key itself is matched wherever on the line it starts.
const KEY = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/;

/** A `#` opens a comment at the start of a line or after whitespace, so a `#`
 *  inside a value ("C#", a URL fragment) survives. */
function uncomment(line) {
  const at = line.search(/(^|\s)#/);
  if (at < 0) return line.replace(/\s+$/, "");
  const keep = line.slice(0, at === 0 ? 0 : at + 1);
  return keep.replace(/\s+$/, "");
}

function scalar(raw) {
  const v = raw.trim().replace(/^(["'])(.*)\1$/, "$2");
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "" || v === "~" || v === "null") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function dedent(lines) {
  const widths = lines.filter((l) => l.trim()).map(indentOf);
  const min = widths.length ? Math.min(...widths) : 0;
  return lines
    .map((l) => l.slice(min))
    .join("\n")
    .replace(/\s+$/, "");
}

/**
 * `{ top, items, problems }` -- top-level scalars, the `- ` list under the
 * first key that has one, and everything that did not parse.
 *
 * One list per file is all this shape needs, so the list key is remembered but
 * not nested: `routines:` and its items are the file.
 */
export function parse(text) {
  const top = {};
  const items = [];
  const problems = [];
  const lines = String(text ?? "").split(/\r?\n/);

  let i = 0;
  let current = null;

  const say = (line, message) => problems.push(`line ${line}: ${message}`);

  // Consumes a block scalar's body: every following line indented deeper than
  // the key that introduced it. Reads raw lines, so a `#` in prose is prose.
  const block = (keyIndent) => {
    const body = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        body.push("");
        i++;
        continue;
      }
      if (indentOf(line) <= keyIndent) break;
      body.push(line);
      i++;
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    return dedent(body);
  };

  // `i` must already be past the key's own line when this runs, so a block
  // scalar reads the lines below it.
  const assign = (target, key, value, keyIndent, line) => {
    if (value === "|" || value === "|-" || value === ">") {
      target[key] = block(keyIndent);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      say(line, `"${key}" appears twice; the second one wins`);
    }
    target[key] = scalar(value);
  };

  while (i < lines.length) {
    const raw = lines[i];
    const at = i + 1;

    if (hasTab(raw)) {
      say(at, "tab indentation; YAML allows only spaces");
      i++;
      continue;
    }

    const line = uncomment(raw);
    if (!line.trim()) {
      i++;
      continue;
    }

    const indent = indentOf(line);
    const dash = line.match(/^(\s*)-\s+(.*)$/);

    if (dash) {
      current = {};
      items.push(current);
      const rest = dash[2];
      const kv = rest.match(KEY);
      i++;
      if (!kv) {
        say(at, `expected "key: value" after the "-", found "${rest.trim()}"`);
        continue;
      }
      // The dash occupies the first two columns, so the item's keys sit two
      // deeper than the dash itself.
      assign(current, kv[1], kv[2], indent + 2, at);
      continue;
    }

    const kv = line.match(KEY);
    if (!kv) {
      say(at, `couldn't read "${line.trim()}"`);
      i++;
      continue;
    }

    if (indent === 0) {
      current = null;
      i++;
      // `routines:` with nothing after it introduces the list; a top-level key
      // with a value is config.
      if (kv[2] !== "") assign(top, kv[1], kv[2], 0, at);
      continue;
    }

    if (!current) {
      say(at, `"${kv[1]}" is indented but belongs to no list item`);
      i++;
      continue;
    }

    i++;
    assign(current, kv[1], kv[2], indent, at);
  }

  return { top, items, problems };
}
