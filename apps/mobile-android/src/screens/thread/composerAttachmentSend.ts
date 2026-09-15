import {
  GRAFT_MOBILE_MAX_ATTACHMENTS,
  GraftAttachmentSchema,
  type GraftAttachment,
  type GraftInteractionMode,
} from "@graft/mobile-contract";

export type ComposerAttachment = GraftAttachment & { readonly uri: string };
export type AttachmentSource = "files" | "photos" | "camera";
export interface ComposerSendOptions {
  readonly attachments?: readonly ComposerAttachment[];
  readonly interactionMode?: GraftInteractionMode;
  readonly fastMode?: boolean;
}

export function validateComposerAttachments(attachments: readonly ComposerAttachment[]): void {
  if (attachments.length > GRAFT_MOBILE_MAX_ATTACHMENTS) {
    throw new Error(`Attach up to ${GRAFT_MOBILE_MAX_ATTACHMENTS} files per message.`);
  }
  for (const attachment of attachments) {
    if (!GraftAttachmentSchema.safeParse(attachment).success) {
      throw new Error(`${attachment.name}: images must be under 10 MB and files under 25 MB.`);
    }
  }
}

/** Upload before dispatch; keep the draft intact and release staged uploads on failure. */
export async function sendWithAttachments<T>(
  attachments: readonly ComposerAttachment[],
  upload: (attachment: ComposerAttachment) => Promise<GraftAttachment>,
  cancel: (id: string) => Promise<void>,
  send: (attachments: GraftAttachment[]) => Promise<T>,
): Promise<T> {
  validateComposerAttachments(attachments);
  const uploaded: GraftAttachment[] = [];
  try {
    for (const attachment of attachments) uploaded.push(await upload(attachment));
    return await send(uploaded);
  } catch (error) {
    await Promise.allSettled(uploaded.map((attachment) => cancel(attachment.id)));
    throw error;
  }
}
