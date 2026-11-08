// The render context the app hands a View.
//
// Every callback in a mod gets its own `cx` -- never a kept one -- so this is
// handed out fresh and records what was asked of it.
//
// `spawn` defaults to deferring: a panel's constructor starts a `for (;;)`
// command loop in one, and running that here would be an infinite loop in a
// test. `cx({ spawn: "run" })` runs them, which is what a test about loading
// wants; the command loop still parks on the promise `nextCommand()` returns.

export function cx({ spawn = "defer" } = {}) {
  const self = {
    notifies: 0,
    focused: 0,
    stopped: 0,
    timers: [],
    opened: [],
    /** The functions handed to `spawn`, run or not. */
    spawned: [],
    running: [],

    notify() {
      self.notifies++;
    },

    focus_handle() {
      return {
        focus() {
          self.focused++;
        },
      };
    },

    stop_propagation() {
      self.stopped++;
    },

    open_url(url) {
      self.opened.push(url);
    },

    timer: {
      every(ms, fn) {
        self.timers.push({ ms, fn });
        return { cancel() {} };
      },
      after(ms, fn) {
        self.timers.push({ ms, fn, once: true });
        return { cancel() {} };
      },
    },

    spawn(fn) {
      self.spawned.push(fn);
      if (spawn !== "run") return undefined;
      const task = Promise.resolve().then(() => fn(self));
      // A rejection inside a spawned task is the panel's own business -- it
      // catches them and puts the message in a row. An unhandled one here
      // would take the test process down.
      self.running.push(task.catch(() => {}));
      return task;
    },

    /**
     * Let every spawned task that can finish, finish.
     *
     * Turns of the event loop, deliberately -- not `Promise.all(running)`. A
     * panel's command loop is a spawned task that parks on `nextCommand()` and
     * is *meant* never to resolve, so awaiting the set would hang forever.
     */
    async settle(turns = 25) {
      for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
    },

    /** Fire the timer registered at this interval, as the app would. */
    async tick(ms) {
      for (const timer of self.timers.filter((t) => t.ms === ms)) timer.fn(self);
      await self.settle();
    },
  };
  return self;
}
