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
