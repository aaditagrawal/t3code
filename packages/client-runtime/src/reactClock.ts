// @effect-diagnostics globalDate:off globalTimers:off -- This synchronous React adapter subscribes to the host UI clock without an Effect runtime.
import { useSyncExternalStore } from "react";

function createClock(periodMs: number) {
  const readNow = () => Math.floor(Date.now() / periodMs) * periodMs;
  let snapshot = readNow();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const schedule = () => {
    timer = setTimeout(
      () => {
        snapshot = readNow();
        for (const listener of listeners) listener();
        if (listeners.size > 0) schedule();
      },
      periodMs - (Date.now() % periodMs),
    );
  };
  return {
    getSnapshot: () => {
      if (timer === null) snapshot = readNow();
      return snapshot;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (timer === null) schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };
    },
  };
}

const clocks = { 1000: createClock(1000), 60000: createClock(60000) };
const unsubscribe = () => {};
const inactiveSubscription = () => unsubscribe;

/** Share one aligned timer per resolution; stop it when its last consumer unmounts. */
export function useClock(periodMs: 1000 | 60000 = 1000, enabled = true): number {
  const clock = clocks[periodMs];
  return useSyncExternalStore(
    enabled ? clock.subscribe : inactiveSubscription,
    clock.getSnapshot,
    clock.getSnapshot,
  );
}

export function useNowMinute(enabled = true): string {
  return new Date(useClock(60000, enabled)).toISOString().slice(0, 16);
}
