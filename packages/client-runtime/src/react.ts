import { useLayoutEffect, type RefObject } from "react";

/** Publish values to asynchronous callbacks after commit, never from an abandoned render. */
export function useCommitRef<T>(ref: RefObject<T>, value: T): void {
  useLayoutEffect(() => {
    ref.current = value;
  }, [ref, value]);
}
