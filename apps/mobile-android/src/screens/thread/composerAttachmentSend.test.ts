import { describe, expect, it, vi } from "vitest";
import { sendWithAttachments, type ComposerAttachment } from "./composerAttachmentSend";

const file: ComposerAttachment = { id: "local-file", type: "file", name: "notes.txt", mimeType: "text/plain", sizeBytes: 6, uri: "file:///cache/notes.txt" };
const stored = { id: "host-file", type: "file" as const, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes };

it("sends host-minted attachment references only after uploads finish", async () => {
  const calls: string[] = [];
  const send = vi.fn(async (attachments) => { calls.push("send"); return attachments; });
  const result = await sendWithAttachments([file], async () => { calls.push("upload"); return stored; }, vi.fn(), send);
  expect(calls).toEqual(["upload", "send"]);
  expect(result).toEqual([stored]);
  expect(result[0]).not.toHaveProperty("uri");
});

describe("attachment failure recovery", () => {
  it("does not send a partial selection and releases already-uploaded files", async () => {
    const upload = vi.fn().mockResolvedValueOnce(stored).mockRejectedValueOnce(new Error("Offline"));
    const cancel = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    await expect(sendWithAttachments([file, { ...file, id: "second" }], upload, cancel, send)).rejects.toThrow("Offline");
    expect(send).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(stored.id);
    expect(file.uri).toBe("file:///cache/notes.txt");
  });
  it("preserves the send failure even when upload cleanup also fails", async () => {
    const cancel = vi.fn().mockRejectedValue(new Error("Cleanup offline"));
    await expect(sendWithAttachments([file], async () => stored, cancel, async () => { throw new Error("Turn rejected"); })).rejects.toThrow("Turn rejected");
    expect(cancel).toHaveBeenCalledWith(stored.id);
  });
  it("rejects oversized and excessive selections before any upload", async () => {
    const upload = vi.fn();
    for (const attachments of [[{ ...file, sizeBytes: 26 * 1024 * 1024 }], Array.from({ length: 9 }, () => file)]) {
      await expect(sendWithAttachments(attachments, upload, vi.fn(), vi.fn())).rejects.toThrow();
    }
    expect(upload).not.toHaveBeenCalled();
  });
});
