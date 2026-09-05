import { useRef } from "react";
import { Suspense, startTransition, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import { useCommitRef } from "@t3tools/client-runtime/react";

describe("useCommitRef", () => {
  it("publishes committed values while retaining callback identity and ignores suspended renders", async () => {
    let read = () => "unmounted";
    const never = new Promise<void>(() => {});
    function Probe({ value, suspend = false }: { value: string; suspend?: boolean }) {
      const latest = useRef(value);
      useCommitRef(latest, value);
      useLayoutEffect(() => {
        read = () => latest.current;
      }, [latest]);
      if (suspend) throw never;
      return null;
    }
    let root: ReactTestRenderer | undefined;
    try {
      await act(() => {
        root = create(
          <Suspense fallback={null}>
            <Probe value="first" />
          </Suspense>,
        );
      });
      const initialRead = read;
      expect(read()).toBe("first");
      await act(() => {
        root?.update(
          <Suspense fallback={null}>
            <Probe value="second" />
          </Suspense>,
        );
      });
      expect(read).toBe(initialRead);
      expect(read()).toBe("second");
      await act(() => {
        startTransition(() =>
          root?.update(
            <Suspense fallback={null}>
              <Probe value="uncommitted" suspend />
            </Suspense>,
          ),
        );
      });
      expect(read()).toBe("second");
      await act(() => {
        root?.update(
          <Suspense fallback={null}>
            <Probe value="final" />
          </Suspense>,
        );
      });
      expect(read()).toBe("final");
      expect(read).toBe(initialRead);
    } finally {
      await act(() => root?.unmount());
    }
  });
});
