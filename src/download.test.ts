import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { download, releaseDownloads } from './download';

const create = vi.fn((_blob: Blob): string => `blob:download-${create.mock.calls.length}`);
const revoke = vi.fn();
const click = vi.fn();
const remove = vi.fn();

beforeEach(() => {
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  vi.stubGlobal('document', { createElement: () => ({ click, remove }), body: { append: vi.fn() } });
});
afterEach(() => {
  releaseDownloads();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('download resources', () => {
  it('reuses one Blob URL for repeated downloads of an output', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    for (let i = 0; i < 20; i++) download(bytes, 'output.pdf', 'application/pdf');
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(20);
    expect(remove).toHaveBeenCalledTimes(20);
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
  it('releases every prepared resource when outputs are discarded', () => {
    download(new Uint8Array([1]), 'a.pdf', 'application/pdf');
    download(new Uint8Array([2]), 'b.pdf', 'application/pdf');
    releaseDownloads();
    expect(revoke).toHaveBeenCalledTimes(2);
    releaseDownloads();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('prepares a fresh resource after clearing the workspace', () => {
    const bytes = new Uint8Array([1]);
    download(bytes, 'a.pdf', 'application/pdf');
    releaseDownloads();
    download(bytes, 'a.pdf', 'application/pdf');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
