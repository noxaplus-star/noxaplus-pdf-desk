const urls = new Map<Uint8Array, string>();

export function releaseDownloads(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

export function download(bytes: Uint8Array, name: string, type: string): void {
  let url = urls.get(bytes);
  if (!url) {
    url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    urls.set(bytes, url);
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}
