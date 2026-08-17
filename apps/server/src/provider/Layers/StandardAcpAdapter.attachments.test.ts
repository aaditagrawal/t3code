import type { ChatAttachment } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { toAcpAttachmentContentBlock } from "./StandardAcpAdapter.ts";

describe("StandardAcpAdapter attachment content", () => {
  it("keeps images as inline ACP image blocks", () => {
    const attachment: ChatAttachment = {
      type: "image",
      id: "thread-1-image-1",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 3,
    };

    expect(
      toAcpAttachmentContentBlock({
        attachment,
        attachmentPath: "/tmp/diagram.png",
        bytes: Uint8Array.from([1, 2, 3]),
      }),
    ).toEqual({ type: "image", data: "AQID", mimeType: "image/png" });
  });

  it("maps non-images to MIME-typed ACP resource links", () => {
    const attachment: ChatAttachment = {
      type: "file",
      id: "thread-1-file-1",
      name: "release notes.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    };

    expect(
      toAcpAttachmentContentBlock({
        attachment,
        attachmentPath: "/tmp/release notes.pdf",
        bytes: Uint8Array.from([1, 2, 3, 4]),
      }),
    ).toEqual({
      type: "resource_link",
      uri: "file:///tmp/release%20notes.pdf",
      name: "release notes.pdf",
      mimeType: "application/pdf",
      size: 4,
    });
  });
});
