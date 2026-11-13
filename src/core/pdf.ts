import fontkit from '@pdf-lib/fontkit';
import persianFontDataUrl from '@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff?inline';
import {
  degrees, EncryptedPDFError, ParseSpeeds, PDFArray, PDFDocument, PDFName,
  PDFNull, PDFNumber, PDFStream, StandardFonts,
} from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import { DeskError, LIMITS, pageLabel, safeFilename, validateNumbers } from './model';
import type { DeskPage, NumberSettings, SourcePdf } from './model';

export interface CreateOutputsOptions {
  title: string;
  /** Zero-based indices into the included, ordered pages; subsets are allowed. */
  groups?: number[][];
  numbers?: NumberSettings;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Optional local WOFF/TrueType bytes for hosts without Vite asset imports. */
  persianFontBytes?: Uint8Array;
}

export interface PdfOutput {
  name: string;
  bytes: Uint8Array;
}

export const MAX_OUTPUT_BYTES = 200 * 1024 * 1024;
const quarterTurns = [0, 90, 180, 270];
let bundledFontBytes: Uint8Array | undefined;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DeskError('عملیات لغو شد.');
}

async function checkedAwait<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal);
  try {
    return await operation();
  } finally {
    checkAbort(signal);
  }
}

function validateBytes(bytes: Uint8Array, name: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new DeskError(`فایل «${name}» خالی است یا دادهٔ معتبری ندارد.`);
  }
  if (bytes.byteLength > LIMITS.fileBytes) {
    throw new DeskError(`حجم فایل «${name}» نباید بیش از ۵۰ مگابایت باشد.`);
  }
  const decoder = new TextDecoder('ascii');
  if (!/^%PDF-[12]\.\d[\r\n\t ]/.test(decoder.decode(bytes.subarray(0, 16)))) {
    throw new DeskError(`فایل «${name}» یک PDF معتبر نیست.`);
  }
  // pdf-lib can recover truncated files. Do not silently accept a missing trailer terminator.
  if (!/%%EOF[\t\n\f\r ]*$/.test(decoder.decode(bytes.subarray(Math.max(0, bytes.length - 1024))))) {
    throw new DeskError(`فایل PDF «${name}» خراب یا ناقص است.`);
  }
}

function pageRotation(page: PDFPage): number {
  const angle = page.getRotation().angle;
  if (!Number.isFinite(angle) || !Number.isInteger(angle / 90)) {
    throw new DeskError('چرخش صفحهٔ PDF باید مضربی از ۹۰ درجه باشد.');
  }
  return ((angle % 360) + 360) % 360;
}

function pageUserUnit(page: PDFPage): number {
  const ref = page.node.get(PDFName.of('UserUnit'), true);
  if (ref === undefined) return 1;
  const value = page.doc.context.lookup(ref);
  if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber())
    || value.asNumber() <= 0 || value.asNumber() > 75000) {
    throw new DeskError('واحد اندازه‌گیری صفحهٔ PDF (UserUnit) معتبر نیست.');
  }
  return value.asNumber();
}

function visibleBox(page: PDFPage): { x: number; y: number; width: number; height: number } {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  for (const box of [media, crop]) {
    if (![box.x, box.y, box.width, box.height, box.x + box.width, box.y + box.height].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0) {
      throw new DeskError('ابعاد صفحهٔ PDF معتبر نیست.');
    }
  }
  // Viewers clip the crop box to the media box.
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  if (width <= 0 || height <= 0) throw new DeskError('ناحیهٔ قابل نمایش صفحهٔ PDF خالی است.');
  return { x, y, width, height };
}

async function loadSource(bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<PDFDocument> {
  checkAbort(signal);
  validateBytes(bytes, name);
  try {
    const document = await checkedAwait(() => PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
      parseSpeed: ParseSpeeds.Slow,
    }), signal);
    // Keep this explicit even if a future library version changes load's encryption handling.
    if (document.isEncrypted) throw new EncryptedPDFError();
    const count = document.getPageCount();
    if (count < 1) throw new DeskError(`فایل PDF «${name}» هیچ صفحه‌ای ندارد.`);
    if (count > LIMITS.pages) throw new DeskError('حداکثر ۳۰۰ صفحه در فضای کار مجاز است.');
    for (const page of document.getPages()) {
      pageRotation(page);
      visibleBox(page);
      pageUserUnit(page);
      const contentsRef = page.node.get(PDFName.of('Contents'));
      if (contentsRef !== undefined) {
        const contents = document.context.lookup(contentsRef);
        if (contents === PDFNull) continue; // PDF null is equivalent to an absent optional entry.
        const streams = contents instanceof PDFArray ? contents.asArray() : [contentsRef];
        if (!streams.every(ref => document.context.lookup(ref) instanceof PDFStream)) {
          throw new DeskError(`محتوای صفحهٔ فایل PDF «${name}» خراب یا نامعتبر است.`);
        }
      }
    }
    checkAbort(signal);
    return document;
  } catch (error) {
    checkAbort(signal);
    if (error instanceof DeskError) throw error;
    // pdf-lib 1.17's ES5 Error subclass does not reliably preserve instanceof.
    if (error instanceof EncryptedPDFError || (error instanceof Error
      && error.message.startsWith('Input document to `PDFDocument.load` is encrypted.'))) {
      throw new DeskError(`فایل PDF «${name}» رمزگذاری شده است؛ ابتدا نسخهٔ بدون رمز آن را تهیه کنید.`);
    }
    throw new DeskError(`فایل PDF «${name}» خراب یا نامعتبر است و باز نمی‌شود.`, { cause: error });
  }
}

export async function inspectPdf(bytes: Uint8Array, name: string): Promise<{ pageCount: number }> {
  const document = await loadSource(bytes, name);
  return { pageCount: document.getPageCount() };
}

function getPersianFontBytes(override?: Uint8Array): Uint8Array {
  if (override !== undefined) {
    if (!(override instanceof Uint8Array) || override.byteLength === 0) {
      throw new DeskError('دادهٔ قلم فارسی معتبر نیست.');
    }
    return override;
  }
  if (!bundledFontBytes) {
    const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\r\n]+)$/.exec(persianFontDataUrl);
    if (!match) throw new DeskError('قلم فارسی در بستهٔ برنامه موجود نیست؛ دادهٔ قلم محلی را فراهم کنید.');
    const binary = atob(match[1]);
    bundledFontBytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  return bundledFontBytes;
}

interface NumberFonts {
  primary: PDFFont;
  separator?: PDFFont;
  /** Primary-font metrics per point, before multiplying by the requested size. */
  ascent: number;
  descent: number;
}

async function numberFont(document: PDFDocument, options: CreateOutputsOptions): Promise<NumberFonts> {
  const { signal } = options;
  if (options.numbers?.digits === 'persian') {
    let ascent = NaN;
    let descent = NaN;
    document.registerFontkit({
      ...fontkit,
      create(bytes, postscriptName) {
        const font = fontkit.create(bytes, postscriptName);
        // pdf-lib 1.17's custom heightAtSize({ descender: false }) subtracts
        // unscaled descent. Use fontkit's actual units for reliable placement.
        ascent = (font.ascent || font.bbox.maxY) / font.unitsPerEm;
        descent = -(font.descent || font.bbox.minY) / font.unitsPerEm;
        const layout = font.layout;
        // Numerals (including Persian ones) run left-to-right. Fontkit otherwise
        // infers Arabic RTL and reverses multi-digit labels and fractions.
        font.layout = (text, features) => Reflect.apply(layout, font, [text, features, undefined, undefined, 'ltr']);
        return font;
      },
    });
    try {
      // Subsetting converts the WOFF container into an actual SFNT font program for FontFile2.
      const primary = await checkedAwait(() => document.embedFont(getPersianFontBytes(options.persianFontBytes), {
        subset: true,
      }), signal);
      if (![...'۰۱۲۳۴۵۶۷۸۹'].every(digit => primary.getCharacterSet().includes(digit.codePointAt(0)!))) {
        throw new DeskError('قلم فارسی رقم‌های لازم برای شماره‌گذاری را ندارد.');
      }
      // Fontsource's Arabic subset omits ASCII slash; never render a missing glyph.
      const separator = options.numbers.style === 'fraction'
        ? await checkedAwait(() => document.embedFont(StandardFonts.Helvetica), signal) : undefined;
      return { primary, separator, ascent, descent };
    } catch (error) {
      checkAbort(signal);
      if (error instanceof DeskError) throw error;
      throw new DeskError('قلم فارسی قابل خواندن یا جاسازی نیست.', { cause: error });
    }
  }
  const primary = await checkedAwait(() => document.embedFont(StandardFonts.Helvetica), signal);
  const ascent = primary.heightAtSize(1, { descender: false });
  return { primary, ascent, descent: primary.heightAtSize(1) - ascent };
}

function drawNumber(page: PDFPage, fonts: NumberFonts, settings: NumberSettings, index: number, count: number): void {
  if (settings.skipFirst && index === 0) return;
  const label = pageLabel(index, count, settings);
  const box = visibleBox(page);
  const unit = pageUserUnit(page);
  // Settings are physical points; keep the page's boxes and UserUnit untouched.
  const size = settings.size / unit;
  const margin = settings.margin / unit;
  const rotation = pageRotation(page);
  const sideways = rotation === 90 || rotation === 270;
  const screenWidth = sideways ? box.height : box.width;
  const screenHeight = sideways ? box.width : box.height;
  const chunks = (fonts.separator ? label.split(/( \/ )/) : [label]).map(text => {
    const font = text === ' / ' ? fonts.separator! : fonts.primary;
    const ascent = font === fonts.primary ? fonts.ascent * size
      : font.heightAtSize(size, { descender: false });
    const descent = font === fonts.primary ? fonts.descent * size : font.heightAtSize(size) - ascent;
    return { text, font, width: font.widthOfTextAtSize(text, size), ascent, descent };
  });
  const width = chunks.reduce((sum, chunk) => sum + chunk.width, 0);
  const ascent = Math.max(...chunks.map(chunk => chunk.ascent));
  const descent = Math.max(...chunks.map(chunk => chunk.descent));
  const height = ascent + descent;
  if (![width, height, ascent, descent].every(Number.isFinite) || width <= 0 || height <= 0
    || screenWidth < width + 2 * margin || screenHeight < height + 2 * margin) {
    throw new DeskError('صفحه برای اندازهٔ قلم و حاشیهٔ انتخاب‌شده کوچک است؛ اندازه یا حاشیه را کاهش دهید.');
  }
  const x = settings.position.endsWith('left') ? margin
    : settings.position.endsWith('right') ? screenWidth - margin - width
      : (screenWidth - width) / 2;
  const y = settings.position.startsWith('top') ? screenHeight - margin - ascent
    : margin + descent;
  // Inverse of the viewer's clockwise /Rotate, including crop/media offsets.
  let px: number;
  let py: number;
  switch (rotation) {
    case 90: px = box.x + box.width - y; py = box.y + x; break;
    case 180: px = box.x + box.width - x; py = box.y + box.height - y; break;
    case 270: px = box.x + y; py = box.y + box.height - x; break;
    default: px = box.x + x; py = box.y + y;
  }
  const radians = rotation * Math.PI / 180;
  let offset = 0;
  for (const chunk of chunks) {
    page.drawText(chunk.text, {
      x: px + offset * Math.cos(radians), y: py + offset * Math.sin(radians),
      font: chunk.font, size, rotate: degrees(rotation),
    });
    offset += chunk.width;
  }
}

function validateWorkspace(sources: SourcePdf[], pages: DeskPage[], options: CreateOutputsOptions): {
  included: DeskPage[]; groups: number[][];
} {
  if (!options || typeof options.title !== 'string'
    || (options.onProgress !== undefined && typeof options.onProgress !== 'function')) {
    throw new DeskError('تنظیمات خروجی معتبر نیست.');
  }
  if (!Array.isArray(sources) || sources.length === 0) throw new DeskError('ابتدا یک فایل PDF اضافه کنید.');
  if (sources.length > LIMITS.files) throw new DeskError('حداکثر ۳۰ فایل ورودی مجاز است.');
  const sourceMap = new Map<string, SourcePdf>();
  let totalBytes = 0;
  let totalPages = 0;
  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || !source.id.trim() || sourceMap.has(source.id)
      || typeof source.name !== 'string' || !Number.isSafeInteger(source.pageCount) || source.pageCount < 1) {
      throw new DeskError('اطلاعات یا شناسهٔ فایل‌های ورودی معتبر و یکتا نیست.');
    }
    validateBytes(source.bytes, source.name);
    sourceMap.set(source.id, source);
    totalBytes += source.bytes.byteLength;
    totalPages += source.pageCount;
  }
  if (totalBytes > LIMITS.totalBytes) throw new DeskError('حجم کل فایل‌های ورودی نباید بیش از ۱۵۰ مگابایت باشد.');
  if (totalPages > LIMITS.pages || (Array.isArray(pages) && pages.length > LIMITS.pages)) {
    throw new DeskError('حداکثر ۳۰۰ صفحه در فضای کار مجاز است.');
  }
  if (!Array.isArray(pages)) throw new DeskError('فهرست صفحات معتبر نیست.');
  const included = pages.filter(page => {
    if (!page || typeof page.included !== 'boolean') throw new DeskError('انتخاب صفحات معتبر نیست.');
    return page.included;
  });
  if (included.length === 0) throw new DeskError('حداقل یک صفحه را برای خروجی انتخاب کنید.');
  for (const page of included) {
    const source = sourceMap.get(page.sourceId);
    if (!source || !Number.isSafeInteger(page.sourcePage) || page.sourcePage < 0 || page.sourcePage >= source.pageCount) {
      throw new DeskError('ارجاع صفحه به فایل PDF معتبر نیست.');
    }
    if (!quarterTurns.includes(page.rotation)) throw new DeskError('چرخش صفحه باید ۰، ۹۰، ۱۸۰ یا ۲۷۰ درجه باشد.');
  }
  if (options.numbers !== undefined) {
    if (!options.numbers) throw new DeskError('تنظیمات شماره‌گذاری معتبر نیست.');
    validateNumbers(options.numbers);
  }
  const groups = options.groups === undefined ? [included.map((_, index) => index)] : options.groups;
  if (!Array.isArray(groups) || groups.length === 0) throw new DeskError('حداقل یک گروه تفکیک لازم است.');
  if (groups.length > LIMITS.splitFiles) throw new DeskError('حداکثر ۱۰۰ فایل خروجی در هر نوبت مجاز است.');
  const seen = new Set<number>();
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) throw new DeskError('گروه‌های تفکیک نباید خالی باشند.');
    for (const index of group) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= included.length) {
        throw new DeskError('شمارهٔ صفحه در گروه تفکیک معتبر نیست.');
      }
      if (seen.has(index)) throw new DeskError('گروه‌های تفکیک نباید هم‌پوشانی داشته باشند.');
      seen.add(index);
    }
  }
  // Snapshot the plan so progress callbacks cannot change it halfway through an operation.
  return { included: included.map(page => ({ ...page })), groups: groups.map(group => [...group]) };
}

/** Copies page content, not full-document forms, bookmarks, or digital signatures. */
export async function createOutputs(
  sources: SourcePdf[], pages: DeskPage[], options: CreateOutputsOptions,
): Promise<PdfOutput[]> {
  checkAbort(options?.signal);
  try {
    const { included, groups } = validateWorkspace(sources, pages, options);
    const plan: CreateOutputsOptions = { ...options, numbers: options.numbers && { ...options.numbers } };
    const sourcePlan = sources.map(source => ({ ...source }));
    const { signal } = plan;
    const total = groups.reduce((sum, group) => sum + group.length, 0);
    let done = 0;
    let outputBytes = 0;
    const report = () => {
      checkAbort(signal);
      plan.onProgress?.(done, total);
      checkAbort(signal);
    };
    report();
    const documents = new Map<string, PDFDocument>();
    for (const source of sourcePlan) {
      const document = await checkedAwait(() => loadSource(source.bytes, source.name, signal), signal);
      if (document.getPageCount() !== source.pageCount) {
        throw new DeskError(`تعداد صفحات فایل «${source.name}» با اطلاعات فضای کار مطابقت ندارد.`);
      }
      documents.set(source.id, document);
    }
    const outputs: PdfOutput[] = [];
    const baseName = safeFilename(plan.title, 'pdf');
    const stem = baseName.slice(0, -4);
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      const document = await checkedAwait(() => PDFDocument.create(), signal);
      const now = new Date();
      document.setTitle(plan.title.trim() || 'NoxaPlus PDF');
      document.setAuthor('NoxaPlus');
      document.setCreator('NoxaPlus PDF Desk');
      document.setProducer('NoxaPlus PDF Desk');
      document.setSubject('پردازش خصوصی و محلی PDF');
      document.setKeywords(['NoxaPlus', 'PDF Desk']);
      document.setCreationDate(now);
      document.setModificationDate(now);
      const font = plan.numbers && !(plan.numbers.skipFirst && group.length === 1)
        ? await checkedAwait(() => numberFont(document, plan), signal) : undefined;
      const bySource = new Map<string, { slots: number[]; indices: number[] }>();
      group.forEach((index, slot) => {
        const page = included[index];
        let batch = bySource.get(page.sourceId);
        if (!batch) {
          batch = { slots: [], indices: [] };
          bySource.set(page.sourceId, batch);
        }
        batch.slots.push(slot);
        batch.indices.push(page.sourcePage);
      });
      const copied = new Array<PDFPage>(group.length);
      for (const [sourceId, batch] of bySource) {
        const batchPages = await checkedAwait(() => document.copyPages(documents.get(sourceId)!, batch.indices), signal);
        batchPages.forEach((page, index) => { copied[batch.slots[index]] = page; });
      }
      for (let index = 0; index < group.length; index++) {
        checkAbort(signal);
        const page = copied[index];
        // Repeated source pages can share a Contents array. Keep new numbering streams independent.
        const contents = page.node.Contents();
        if (contents instanceof PDFArray) page.node.set(PDFName.of('Contents'), contents.clone());
        page.setRotation(degrees((pageRotation(page) + included[group[index]].rotation) % 360));
        document.addPage(page);
        if (font && plan.numbers) drawNumber(page, font, plan.numbers, index, group.length);
        done++;
        report();
        if (done % 8 === 0) await checkedAwait(() => new Promise<void>(resolve => setTimeout(resolve, 0)), signal);
      }
      const bytes = await checkedAwait(() => document.save({ addDefaultPage: false, objectsPerTick: 50 }), signal);
      outputBytes += bytes.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        throw new DeskError('حجم مجموع خروجی‌ها بیش از ۲۰۰ مگابایت است؛ صفحات کمتری را در هر نوبت پردازش کنید.');
      }
      const suffix = `-${String(groupIndex + 1).padStart(Math.max(2, String(groups.length).length), '0')}`;
      const name = plan.groups === undefined ? baseName
        : safeFilename(`${stem.slice(0, 100 - suffix.length)}${suffix}`, 'pdf');
      outputs.push({ name, bytes });
    }
    checkAbort(signal);
    return outputs;
  } catch (error) {
    checkAbort(options?.signal);
    if (error instanceof DeskError) throw error;
    throw new DeskError('ساخت خروجی PDF ناموفق بود؛ فایل‌ها و تنظیمات را بررسی کنید.', { cause: error });
  }
}
