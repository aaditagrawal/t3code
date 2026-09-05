import { useClock } from "@t3tools/client-runtime/react-clock";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

describe("shared UI clock", () => {
  afterEach(() => vi.useRealTimers());

  it("shares an aligned timer, stops without subscribers, and refreshes on remount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1250);
    function Probe({ enabled = true }: { enabled?: boolean }) {
      const now = useClock(1000, enabled);
      return <span>{now}</span>;
    }
    let root: ReactTestRenderer | undefined;
    const readClock = () => Number(root?.root.findAllByType("span")[0]?.children[0]);
    try {
      await act(() => {
        root = create(
          <>
            <Probe />
            <Probe />
          </>,
        );
      });
      expect(readClock()).toBe(1000);
      expect(vi.getTimerCount()).toBe(1);
      await act(() => {
        vi.advanceTimersByTime(749);
      });
      expect(readClock()).toBe(1000);
      await act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(readClock()).toBe(2000);
      expect(vi.getTimerCount()).toBe(1);
      await act(() => root?.update(<Probe enabled={false} />));
      expect(vi.getTimerCount()).toBe(0);
      vi.setSystemTime(9876);
      await act(() => root?.update(<Probe />));
      expect(readClock()).toBe(9000);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      await act(() => root?.unmount());
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
