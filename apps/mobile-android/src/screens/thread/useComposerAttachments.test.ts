import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useComposerAttachments } from "./useComposerAttachments";

const mocks = vi.hoisted(() => ({
  pick: vi.fn(), files: new Map<string, number>(), nextId: 0,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `file-${++mocks.nextId}` }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: mocks.pick }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: class {
    uri: string;
    constructor(...parts: string[]) { this.uri = parts.join("/"); }
    get exists() { return mocks.files.has(this.uri); }
    get size() { return mocks.files.get(this.uri) ?? 0; }
    get type() { return "text/plain"; }
    copy(target: { uri: string }) { mocks.files.set(target.uri, this.size); }
    delete() { mocks.files.delete(this.uri); }
  },
}));

let result: ReturnType<typeof useComposerAttachments>;
let renderer: ReactTestRenderer | undefined;
function Harness({ threadId }: { threadId: string }) {
  result = useComposerAttachments(threadId);
  return null;
}
const asset = { uri: "file:///original.txt", name: "original.txt", mimeType: "text/plain" };
async function mount() {
  await act(() => { renderer = create(createElement(Harness, { threadId: "thread-1" })); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.pick.mockReset();
  mocks.files.clear();
  mocks.files.set(asset.uri, 20);
  mocks.pick.mockResolvedValue({ canceled: false, assets: [asset] });
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("keeps upload files alive across navigation, then releases only owned copies", async () => {
  await mount();
  await act(() => result.pick("files"));
  const uri = result.attachments[0]!.uri;
  const release = result.retainForSend();
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(mocks.files.has(uri)).toBe(true);
  release();
  expect(mocks.files.has(uri)).toBe(false);
  expect(mocks.files.has(asset.uri)).toBe(true);
});

it("ignores a late picker result after changing threads and unlocks the next picker", async () => {
  let finish!: (value: unknown) => void;
  mocks.pick.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await mount();
  let picking!: Promise<void>;
  await act(() => { picking = result.pick("files"); });
  expect(result.isPicking).toBe(true);
  await act(() => renderer!.update(createElement(Harness, { threadId: "thread-2" })));
  expect(result.isPicking).toBe(false);
  await act(async () => { finish({ canceled: false, assets: [asset] }); await picking; });
  expect(result.attachments).toHaveLength(0);
  await act(() => result.pick("files"));
  expect(result.attachments).toHaveLength(1);
});

it("preserves the selection on picker cancellation and releases a removed preview", async () => {
  await mount();
  await act(() => result.pick("files"));
  const selected = result.attachments[0]!;
  mocks.pick.mockResolvedValueOnce({ canceled: true });
  await act(() => result.pick("files"));
  expect(result.attachments).toEqual([selected]);
  await act(() => result.remove([selected.id]));
  expect(mocks.files.has(selected.uri)).toBe(false);
  expect(mocks.files.has(asset.uri)).toBe(true);
});
