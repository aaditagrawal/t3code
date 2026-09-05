import { useMemo, useState } from "react";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useAssetUrls } from "../../assets/assetUrls";
import {
  createMessageAttachmentPreviewProjector,
  selectMessageImageResources,
} from "../../session-logic";
import { isFileAttachment, isVideoAttachment, type ChatMessage } from "../../types";

type AttachmentResource = Extract<AssetResource, { readonly _tag: "attachment" }>;

/** File links need URLs only on assistant rows; user files and videos load on demand. */
export function selectMessagePreviewResources(
  message: Pick<ChatMessage, "role" | "attachments">,
): ReadonlyArray<AttachmentResource> {
  const images = selectMessageImageResources(message.attachments);
  if (message.role !== "assistant") return images;
  const resources = new Map(images.map((resource) => [resource.attachmentId, resource]));
  for (const attachment of message.attachments ?? []) {
    if (
      !isFileAttachment(attachment) ||
      isVideoAttachment(attachment) ||
      attachment.downloadable === false
    )
      continue;
    if (attachment.previewUrl?.startsWith("blob:") || attachment.previewUrl?.startsWith("data:"))
      continue;
    resources.set(attachment.id, {
      _tag: "attachment",
      attachmentId: attachment.id,
      fileName: attachment.name,
      mimeType: attachment.mimeType,
    });
  }
  return resources.size === images.length ? images : [...resources.values()];
}

/** Mounted rows acquire previews; immutable projection preserves streaming row reuse. */
export function useMessageAttachmentPreviews(
  environmentId: EnvironmentId,
  message: ChatMessage,
): ChatMessage {
  const { role, attachments } = message;
  const resources = useMemo(
    () => selectMessagePreviewResources({ role, attachments }),
    [role, attachments],
  );
  const previewUrls = useAssetUrls(environmentId, resources);
  const [projectPreviews] = useState(createMessageAttachmentPreviewProjector);
  return useMemo(() => {
    const urlsById = new Map(
      resources.flatMap((resource, index) => {
        const url = previewUrls[index];
        return url ? [[resource.attachmentId, url] as const] : [];
      }),
    );
    return projectPreviews(message, (attachment) => urlsById.get(attachment.id));
  }, [previewUrls, projectPreviews, resources, message]);
}
