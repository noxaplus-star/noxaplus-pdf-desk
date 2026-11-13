import { AnnotationMode, PDFWorker, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import jbig2Fallback from 'pdfjs-dist/wasm/jbig2_nowasm_fallback.js?raw';
import jpegFallback from 'pdfjs-dist/wasm/openjpeg_nowasm_fallback.js?raw';
import type { DeskPage, SourcePdf } from './core/model';

const maps = import.meta.glob<string>('../node_modules/pdfjs-dist/cmaps/*.bcmap', { eager: true, query: '?url&inline', import: 'default' });
const fonts = import.meta.glob<string>('../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { eager: true, query: '?url&inline', import: 'default' });
const wasm = import.meta.glob<string>('../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm', { eager: true, query: '?url&inline', import: 'default' });
const assets: Record<string, Record<string, string>> = { cMapUrl: {}, standardFontDataUrl: {}, wasmUrl: {} };
for (const [kind, files] of [['cMapUrl', maps], ['standardFontDataUrl', fonts], ['wasmUrl', wasm]] as const) {
  for (const [path, data] of Object.entries(files)) assets[kind][path.split('/').pop()!] = data;
}

class EmbeddedBinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const data = assets[kind]?.[filename];
    if (!data?.startsWith('data:')) throw new Error('Unsupported embedded PDF resource.');
    return Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), character => character.charCodeAt(0));
  }
}

interface PreviewDocument {
  task: PDFDocumentLoadingTask;
  promise: Promise<PDFDocumentProxy>;
  disposed: boolean;
}
interface WorkerOwner { native: Worker; pdf: PDFWorker; urls: string[] }
const documents = new Map<string, PreviewDocument>();
let owner: WorkerOwner | null = null;
let renderQueue: Promise<void> = Promise.resolve();

function getWorker(): PDFWorker {
  if (owner) return owner.pdf;
  const urls: string[] = [];
  const blobModule = (code: string) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    urls.push(url);
    return url;
  };
  const fallbackUrls = { 'jbig2_nowasm_fallback.js': blobModule(jbig2Fallback), 'openjpeg_nowasm_fallback.js': blobModule(jpegFallback) };
  // PDF.js imports decoder fallbacks directly; route that one import to embedded Blob modules.
  const operand = '`${WasmImage.#R}${this._noWasmFilename}`';
  if (workerSource.split(operand).length !== 2) {
    urls.forEach(url => URL.revokeObjectURL(url));
    throw new Error('The embedded PDF worker needs a decoder import update.');
  }
  const source = workerSource.replace(operand, `(${JSON.stringify(fallbackUrls)})[this._noWasmFilename]`);
  const native = new Worker(blobModule(source), { type: 'module' });
  // The shipped declaration types port as null, but the runtime accepts a native Worker.
  const PortWorker = PDFWorker as unknown as new (options: { port: Worker }) => PDFWorker;
  owner = { native, pdf: new PortWorker({ port: native }), urls };
  return owner.pdf;
}

function getPreviewDocument(source: SourcePdf): PreviewDocument {
  const existing = documents.get(source.id);
  if (existing) return existing;
  const task = getDocument({
    data: source.bytes.slice(), worker: getWorker(), BinaryDataFactory: EmbeddedBinaryDataFactory,
    useWorkerFetch: false, cMapPacked: true, useSystemFonts: false, disableFontFace: false,
    enableXfa: false, disableWorkerRendering: true, maxImageSize: 32_000_000,
    canvasMaxAreaInBytes: 32_000_000, stopAtErrors: true, verbosity: 0,
  });
  const entry = { task, promise: task.promise, disposed: false };
  documents.set(source.id, entry);
  return entry;
}

export function renderPage(source: SourcePdf, page: DeskPage, canvas: HTMLCanvasElement, large: boolean, signal: AbortSignal): Promise<void> {
  const render = async () => {
    signal.throwIfAborted();
    const entry = getPreviewDocument(source);
    const doc = await entry.promise;
    signal.throwIfAborted();
    if (entry.disposed) throw new DOMException('Preview disposed', 'AbortError');
    const pdfPage = await doc.getPage(page.sourcePage + 1);
    signal.throwIfAborted();
    const rotation = (pdfPage.rotate + page.rotation) % 360;
    const original = pdfPage.getViewport({ scale: 1, rotation });
    const scale = Math.min((large ? 850 : 210) / original.width, (large ? 1000 : 280) / original.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = pdfPage.getViewport({ scale: scale * pixelRatio, rotation });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
    canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
    const task = pdfPage.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE });
    const cancel = () => task.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try { await task.promise; signal.throwIfAborted(); }
    finally { signal.removeEventListener('abort', cancel); pdfPage.cleanup(); }
  };
  const pending = renderQueue.then(render);
  renderQueue = pending.catch(() => {});
  return pending;
}

export function releasePreviews(retain: string[]): void {
  const ids = new Set(retain);
  const pending: Promise<void>[] = [];
  for (const [id, entry] of documents) {
    if (ids.has(id)) continue;
    documents.delete(id);
    entry.disposed = true;
    pending.push(entry.task.destroy().catch(() => {}));
  }
  if (retain.length || !owner) return;
  const previous = owner;
  owner = null;
  void Promise.all(pending).then(() => {
    previous.pdf.destroy(); previous.native.terminate();
    previous.urls.forEach(url => URL.revokeObjectURL(url));
  });
}
