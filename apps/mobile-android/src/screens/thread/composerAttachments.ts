/// The Graft mobile turn protocol is text-only today. Hide the attach
/// entry point (instead of collecting images that could never be sent)
/// until the host accepts attachments — same gate as native iOS.
export const COMPOSER_ATTACHMENTS_SUPPORTED = false;

export const COMPOSER_ATTACHMENT_LIMIT = 4;

export interface ComposerAttachment {
  readonly id: string;
  readonly mimeType: string;
  readonly name: string;
  readonly uri: string;
}

export const COMPOSER_ATTACH_SOURCES = ["Photos", "Camera", "Files", "Paste"] as const;

export type ComposerAttachSource = (typeof COMPOSER_ATTACH_SOURCES)[number];

export function remainingAttachmentSlots(count: number): number {
  return Math.max(0, COMPOSER_ATTACHMENT_LIMIT - count);
}

export function canAddAttachments(count: number): boolean {
  return remainingAttachmentSlots(count) > 0;
}

export function attachmentNameFromUri(uri: string, fallback: string): string {
  const segment = uri.split("/").pop()?.split("?")[0];
  return segment && segment.length > 0 ? decodeURIComponent(segment) : fallback;
}

export function imageDataUri(data: string, mimeType = "image/jpeg"): string {
  if (data.startsWith("data:")) return data;
  return `data:${mimeType};base64,${data}`;
}
