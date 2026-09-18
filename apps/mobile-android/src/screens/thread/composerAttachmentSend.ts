import {
  GRAFT_MOBILE_MAX_ATTACHMENTS,
  GraftAttachmentSchema,
  type GraftAttachment,
  type GraftInteractionMode,
  type GraftEnvironmentSummary,
} from "@graft/mobile-contract";

export type ComposerAttachment = GraftAttachment & { readonly uri: string };
export type AttachmentSource = "files" | "photos" | "camera";

export function attachmentHostError(
  attachments: readonly ComposerAttachment[],
  features: GraftEnvironmentSummary["composerFeatures"],
): string | undefined {
  return attachments.length && features?.attachments !== true
    ? "Your files are ready. Reconnect to an updated Graft Studio to send attachments, or remove them to send text."
    : undefined;
}
export interface ComposerSendOptions {
  readonly attachments?: readonly ComposerAttachment[];
  readonly interactionMode?: GraftInteractionMode;
  readonly fastMode?: boolean;
}

export interface ComposerSendAttempt {
  readonly key: string;
  readonly commandId: string;
  uploaded?: GraftAttachment[];
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

/** Retain uploads after an uncertain send so a retry uses the same command and files. */
export async function sendWithAttachments<T>(
  attachments: readonly ComposerAttachment[],
  upload: (attachment: ComposerAttachment) => Promise<GraftAttachment>,
  cancel: (id: string) => Promise<void>,
  send: (attachments: GraftAttachment[]) => Promise<T>,
  retry?: {
    readonly attempt: ComposerSendAttempt;
    readonly isOutcomeUnknown: (error: unknown) => boolean;
  },
): Promise<T> {
  validateComposerAttachments(attachments);
  const uploaded = retry?.attempt.uploaded ?? [];
  try {
    if (!retry?.attempt.uploaded) {
      for (const attachment of attachments) uploaded.push(await upload(attachment));
      if (retry) retry.attempt.uploaded = uploaded;
    }
    return await send(uploaded);
  } catch (error) {
    if (retry?.attempt.uploaded && retry.isOutcomeUnknown(error)) throw error;
    if (retry) delete retry.attempt.uploaded;
    await Promise.allSettled(uploaded.map((attachment) => cancel(attachment.id)));
    throw error;
  }
}
