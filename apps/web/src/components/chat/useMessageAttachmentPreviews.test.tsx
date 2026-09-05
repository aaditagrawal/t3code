import { EnvironmentId, MessageId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatMessage } from "../../types";
import { useAssetUrls } from "../../assets/assetUrls";
import {
  selectMessagePreviewResources,
  useMessageAttachmentPreviews,
} from "./useMessageAttachmentPreviews";

vi.mock("../../assets/assetUrls", () => ({ useAssetUrls: vi.fn(() => []) }));

const environmentId = EnvironmentId.make("remote-environment");
const image = {
  type: "image",
  id: "image",
  name: "chart.png",
  mimeType: "image/png",
  sizeBytes: 10,
} as const;
const file = {
  type: "file",
  id: "file",
  name: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 20,
} as const;
const video = { ...file, id: "video", name: "demo.mp4", mimeType: "video/mp4" };
const message: ChatMessage = {
  id: MessageId.make("assistant-message"),
  role: "assistant",
  text: "Result",
  streaming: true,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  turnId: null,
  attachments: [image, file, video],
};

beforeEach(() => vi.mocked(useAssetUrls).mockReset().mockReturnValue([]));

describe("mounted message attachment previews", () => {
  it("requests assistant images and file links with download metadata, leaving video loading on demand", () => {
    expect(selectMessagePreviewResources(message)).toEqual([
      { _tag: "attachment", attachmentId: "image" },
      {
        _tag: "attachment",
        attachmentId: "file",
        fileName: "report.pdf",
        mimeType: "application/pdf",
      },
    ]);
    expect(selectMessagePreviewResources({ ...message, role: "user" })).toEqual([
      { _tag: "attachment", attachmentId: "image" },
    ]);
  });

  it("preserves local previews and does not acquire unavailable or unknown files", () => {
    expect(
      selectMessagePreviewResources({
        ...message,
        attachments: [
          { ...image, previewUrl: "blob:local-image" },
          { ...image, id: "inline-image", previewUrl: "data:image/png;base64,AAAA" },
          { ...file, previewUrl: "blob:local-file" },
          { ...file, id: "pending-file", downloadable: false },
          {
            type: "future-format",
            id: "future",
            name: "future.bin",
            mimeType: "application/octet-stream",
            sizeBytes: 1,
          },
        ],
      }),
    ).toEqual([]);
  });

  it.each(["assistant", "user"] as const)(
    "binds renewed URLs for a mounted %s row and preserves immutable streaming previews",
    async (role) => {
      const source = { ...message, role };
      const projected: ChatMessage[] = [];
      function Row({ value }: { value: ChatMessage }) {
        const preview = useMessageAttachmentPreviews(environmentId, value);
        projected.push(preview);
        return null;
      }
      let renderer: ReactTestRenderer | undefined;
      try {
        vi.mocked(useAssetUrls).mockReturnValue([
          "https://assets/image-v1",
          "https://assets/file-v1",
        ]);
        await act(async () => {
          renderer = create(<Row value={source} />);
        });
        const first = projected.at(-1)!;
        expect(first.attachments?.[0]).toMatchObject({ previewUrl: "https://assets/image-v1" });
        if (role === "assistant")
          expect(first.attachments?.[1]).toMatchObject({ previewUrl: "https://assets/file-v1" });
        expect(source.attachments?.[0]).not.toHaveProperty("previewUrl");
        expect(useAssetUrls).toHaveBeenLastCalledWith(
          environmentId,
          selectMessagePreviewResources(source),
        );

        await act(async () => {
          renderer?.update(<Row value={{ ...source, text: "Result streaming" }} />);
        });
        expect(projected.at(-1)?.attachments).toBe(first.attachments);

        vi.mocked(useAssetUrls).mockReturnValue([
          "https://assets/image-v2",
          "https://assets/file-v2",
        ]);
        await act(async () => {
          renderer?.update(<Row value={source} />);
        });
        expect(projected.at(-1)?.attachments?.[0]).toMatchObject({
          previewUrl: "https://assets/image-v2",
        });
        expect(first.attachments?.[0]).toMatchObject({ previewUrl: "https://assets/image-v1" });

        vi.mocked(useAssetUrls).mockReturnValue([null, null]);
        await act(async () => {
          renderer?.update(<Row value={{ ...source }} />);
        });
        expect(projected.at(-1)?.attachments).toBe(source.attachments);
      } finally {
        await act(async () => {
          renderer?.unmount();
        });
      }
    },
  );
});
