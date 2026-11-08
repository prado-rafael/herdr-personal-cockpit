// `localStorage` is a global the app provides, and issues.js caches the queue
// in it.
//
// Defined unconditionally rather than only when absent: Node has one of its
// own behind --localstorage-file, and merely reading `globalThis.localStorage`
// to check warns on stderr. A real one would also carry state from one test
// file to the next, which this must not.

const store = new Map();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => void store.set(String(key), String(value)),
    removeItem: (key) => void store.delete(String(key)),
    clear: () => void store.clear(),
    get length() {
      return store.size;
    },
    key: (n) => [...store.keys()][n] ?? null,
  },
});
