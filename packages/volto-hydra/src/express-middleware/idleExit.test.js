import { describe, it, expect, vi } from 'vitest';
import { idleExit, idleExitMinutes } from './idleExit';

// The clock and the timer are handed in, so the test moves time itself.
function harness(minutes) {
  let now = 0;
  let tick = null;
  const exit = vi.fn();
  const middleware = idleExit({
    minutes,
    stopParent: false,
    exitProcess: exit,
    now: () => now,
    every: (fn) => {
      tick = fn;
    },
  });
  return {
    middleware,
    exit,
    advance(ms) {
      now += ms;
      tick();
    },
  };
}
const MINUTE = 60_000;

describe('idleExit', () => {
  it('stops the admin once nothing has asked it anything for the idle time', () => {
    const h = harness(240);
    h.advance(239 * MINUTE);
    expect(h.exit).not.toHaveBeenCalled();
    h.advance(1 * MINUTE);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });

  it('counts the idle time from the last request, and passes every request on', () => {
    const h = harness(240);
    h.advance(200 * MINUTE);
    const next = vi.fn();
    h.middleware({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    h.advance(200 * MINUTE);
    expect(h.exit).not.toHaveBeenCalled();
    h.advance(40 * MINUTE);
    expect(h.exit).toHaveBeenCalledTimes(1);
  });
});

describe('idleExit in the dev server', () => {
  it('stops razzle too: the server is its child, and razzle holds the memory', () => {
    const killed = [];
    let tick = null;
    let now = 0;
    const exited = vi.fn();
    idleExit({
      minutes: 1,
      stopParent: true,
      parent: 4242,
      kill: (pid, signal) => killed.push([pid, signal]),
      exitProcess: exited,
      now: () => now,
      every: (fn) => {
        tick = fn;
      },
    });
    now = 60_000;
    tick();
    expect(killed).toEqual([[4242, 'SIGTERM']]);
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it('leaves its parent alone when built: the built server has no razzle above it', () => {
    const kill = vi.fn();
    let tick = null;
    let now = 0;
    const exited = vi.fn();
    idleExit({ minutes: 1, stopParent: false, parent: 4242, kill, exitProcess: exited, now: () => now, every: (fn) => { tick = fn; } });
    now = 60_000;
    tick();
    expect(kill).not.toHaveBeenCalled();
    expect(exited).toHaveBeenCalledTimes(1);
  });
});

it('must be told whether it is the dev server', () => {
  expect(() => idleExit({ minutes: 1, every: () => {} })).toThrow(/stopParent/);
});

describe('idleExitMinutes', () => {
  it('is off unless asked for, and a number when it is', () => {
    expect(idleExitMinutes({})).toBe(null);
    expect(idleExitMinutes({ INKA_ADMIN_IDLE_EXIT_MINUTES: '240' })).toBe(240);
  });

  it('refuses a value that is not a whole number of minutes', () => {
    expect(() => idleExitMinutes({ INKA_ADMIN_IDLE_EXIT_MINUTES: '4h' })).toThrow(/INKA_ADMIN_IDLE_EXIT_MINUTES/);
    expect(() => idleExitMinutes({ INKA_ADMIN_IDLE_EXIT_MINUTES: '0' })).toThrow(/INKA_ADMIN_IDLE_EXIT_MINUTES/);
  });
});
