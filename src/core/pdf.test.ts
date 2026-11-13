import fontkit from '@pdf-lib/fontkit';
import {
  decodePDFRawStream, degrees, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber,
  PDFRawStream, PDFString, StandardFonts,
} from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NUMBERS, DeskError, LIMITS, pageLabel } from './model';
import type { DeskPage, NumberPosition, NumberSettings, QuarterTurn, SourcePdf } from './model';
import { createOutputs, inspectPdf, MAX_OUTPUT_BYTES } from './pdf';
import type { CreateOutputsOptions } from './pdf';

// Node is the test host; the browser project's TypeScript setup does not require @types/node.
const { readFileSync } = await vi.importActual<{ readFileSync: (path: URL) => Uint8Array }>('node:fs');
const fontBytes = new Uint8Array(readFileSync(new URL(
  '../../node_modules/@fontsource/vazirmatn/files/vazirmatn-arabic-400-normal.woff', import.meta.url,
)));
const latinNumbers: NumberSettings = { ...DEFAULT_NUMBERS, digits: 'latin' };
const decoder = new TextDecoder();

interface FixturePage {
  width?: number;
  height?: number;
  rotation?: number;
  crop?: [number, number, number, number];
  media?: [number, number, number, number];
  userUnit?: number;
  indirectUserUnit?: boolean;
  label?: string;
}

async function fixture(id = 'a', specs: FixturePage[] = [{}]): Promise<SourcePdf> {
  const document = await PDFDocument.create();
  document.setTitle('Old title');
  document.setAuthor('Old author');
  const font = await document.embedFont(StandardFonts.Helvetica);
  specs.forEach((spec, index) => {
    const page = document.addPage([spec.width ?? 400, spec.height ?? 600]);
    if (spec.media) page.setMediaBox(...spec.media);
    if (spec.crop) page.setCropBox(...spec.crop);
    page.setRotation(degrees(spec.rotation ?? 0));
    if (spec.userUnit !== undefined) {
      const unit = PDFNumber.of(spec.userUnit);
      page.node.set(PDFName.of('UserUnit'), spec.indirectUserUnit ? document.context.register(unit) : unit);
    }
    page.drawText(spec.label ?? `${id}-${index}`, { x: 80, y: 120, size: 10, font });
  });
  return { id, name: `${id}.pdf`, pageCount: specs.length, bytes: await document.save({ addDefaultPage: false }) };
}

function workspace(sources: SourcePdf[]): DeskPage[] {
  return sources.flatMap(source => Array.from({ length: source.pageCount }, (_, sourcePage) => ({
    id: `${source.id}-${sourcePage}`, sourceId: source.id, sourcePage, rotation: 0 as QuarterTurn, included: true,
  })));
}

function streamText(stream: unknown): string {
  if (!(stream instanceof PDFRawStream)) throw new Error('Expected an actual saved PDF stream');
  return decoder.decode(decodePDFRawStream(stream).decode());
}

function pageContent(page: PDFPage): string {
  const contents = page.node.Contents();
  if (contents instanceof PDFRawStream) return streamText(contents);
  if (!(contents instanceof PDFArray)) return '';
  return contents.asArray().map(ref => streamText(page.doc.context.lookup(ref))).join('\n');
}

function fontDictionary(page: PDFPage, key: string): PDFDict {
  return page.node.Resources()!.lookup(PDFName.of('Font'), PDFDict).lookup(PDFName.of(key), PDFDict);
}

function decodeText(hex: string, font: PDFDict): string {
  if (font.get(PDFName.of('Subtype')) === PDFName.of('Type1')) {
    return String.fromCharCode(...(hex.match(/.{2}/g) ?? []).map(code => parseInt(code, 16)));
  }
  const cmap = streamText(font.lookup(PDFName.of('ToUnicode')));
  const mapping = new Map<string, string>();
  const chars = /beginbfchar([\s\S]*?)endbfchar/.exec(cmap)![1];
  for (const match of chars.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
    mapping.set(match[1].toUpperCase(), String.fromCharCode(...match[2].match(/.{4}/g)!.map(code => parseInt(code, 16))));
  }
  return (hex.match(/.{4}/g) ?? []).map(code => mapping.get(code.toUpperCase()) ?? '?').join('');
}

function textRuns(page: PDFPage): { text: string; matrix: number[]; font: PDFDict; hex: string; size: number }[] {
  return [...pageContent(page).matchAll(/BT([\s\S]*?)ET/g)].map(match => {
    const block = match[1];
    const [, key, size] = /\/([^\s]+)\s+([-+\d.e]+)\s+Tf/i.exec(block)!;
    const font = fontDictionary(page, key);
    const hex = /<([\da-f]+)>\s*Tj/i.exec(block)![1];
    const matrix = /([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)\s+Tm/i.exec(block)!
      .slice(1).map(Number);
    return { text: decodeText(hex, font), matrix, font, hex, size: Number(size) };
  });
}

function pageTexts(page: PDFPage): string[] {
  const runs = textRuns(page);
  // Fixtures have one original text run; Persian fractions intentionally use three font runs.
  return runs.length < 2 ? runs.map(run => run.text) : [runs[0].text, runs.slice(1).map(run => run.text).join('')];
}

async function expectDeskError(operation: Promise<unknown>, message?: RegExp): Promise<void> {
  const error: unknown = await operation.then(() => null, reason => reason);
  expect(error).toBeInstanceOf(DeskError);
  expect((error as Error).message).toMatch(message ?? /[\u0600-\u06ff]/);
}

async function oneOutput(source: SourcePdf, options: Partial<CreateOutputsOptions> = {}, pages = workspace([source])) {
  const outputs = await createOutputs([source], pages, { title: 'آزمون', ...options });
  expect(outputs).toHaveLength(1);
  return PDFDocument.load(outputs[0].bytes);
}

function sizedInput(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
  bytes.set(new TextEncoder().encode('\n%%EOF\n'), size - 7);
  return bytes;
}

afterEach(() => vi.restoreAllMocks());

describe('inspectPdf: real PDF validation', () => {
  it('inspects differing sizes, crop offsets, and all quarter-turns without changing bytes', async () => {
    const source = await fixture('a', [
      { width: 240, height: 380 },
      { width: 720, height: 300, crop: [21, 32, 410, 220], rotation: 90 },
      { rotation: 180 }, { rotation: 270 },
    ]);
    const original = source.bytes.slice();
    expect(await inspectPdf(source.bytes, source.name)).toEqual({ pageCount: 4 });
    expect(source.bytes).toEqual(original);
  });

  it.each([false, true])('accepts default, fractional and maximum UserUnit without changing raw geometry (indirect=%s)', async indirectUserUnit => {
    const units = [undefined, 1, 10, 0.5, 75000];
    const source = await fixture('units', units.map(userUnit => ({
      userUnit, indirectUserUnit, media: [-50, -80, 400, 500], crop: [-20, 10, 200, 240],
    })));
    const before = source.bytes.slice();
    expect(await inspectPdf(source.bytes, source.name)).toEqual({ pageCount: units.length });
    const result = await oneOutput(source);
    result.getPages().forEach((page, index) => {
      expect(page.getMediaBox()).toEqual({ x: -50, y: -80, width: 400, height: 500 });
      expect(page.getCropBox()).toEqual({ x: -20, y: 10, width: 200, height: 240 });
      const value = result.context.lookup(page.node.get(PDFName.of('UserUnit')));
      if (units[index] === undefined) expect(value).toBeUndefined();
      else {
        expect(value).toBeInstanceOf(PDFNumber);
        expect((value as PDFNumber).asNumber()).toBe(units[index]);
      }
      expect(pageTexts(page)).toEqual([`units-${index}`]);
    });
    expect(source.bytes).toEqual(before);
  });

  it.each([0, -1, 75000.01, 75001, Number.MAX_VALUE, '10', 'NaN', 'Infinity', true, [10], { Value: 10 }, null])(
    'rejects invalid direct and indirect UserUnit %j during loading, even on an excluded page without numbering', async value => {
      for (const indirect of [false, true]) {
        const source = await fixture('bad-unit', [{}, {}]);
        const document = await PDFDocument.load(source.bytes);
        // obj() overloads reject a union argument; the generated literal is valid for its runtime type.
        const object = document.context.obj(value as never);
        document.getPage(1).node.set(PDFName.of('UserUnit'), indirect ? document.context.register(object) : object);
        source.bytes = await document.save();
        await expectDeskError(inspectPdf(source.bytes, source.name), /UserUnit/);
        await expectDeskError(createOutputs([source], workspace([source]).slice(0, 1), { title: 'test' }), /UserUnit/);
      }
    },
  );

  it('rejects string, dangling-reference and overflowing numeric UserUnit in actual PDFs', async () => {
    const source = await fixture();
    const document = await PDFDocument.load(source.bytes);
    const page = document.getPage(0);
    for (const value of [PDFString.of('10'), document.context.nextRef()]) {
      page.node.set(PDFName.of('UserUnit'), value);
      source.bytes = await document.save();
      await expectDeskError(inspectPdf(source.bytes, source.name), /UserUnit/);
      await expectDeskError(createOutputs([source], workspace([source]), { title: 'test' }), /UserUnit/);
    }
    // pdf-lib's lexer refuses numeric tokens longer than 300 digits, so an
    // overflowing unit never survives loading; patch the saved bytes instead.
    const digits = '9'.repeat(400);
    page.node.set(PDFName.of('UserUnit'), PDFName.of(digits));
    const bytes = await document.save({ useObjectStreams: false });
    // Equal-length ASCII replacement preserves binary streams and all xref offsets.
    const marker = new TextEncoder().encode(`/UserUnit /${digits}`);
    const offset = bytes.findIndex((_, index) => marker.every((byte, delta) => bytes[index + delta] === byte));
    expect(offset).toBeGreaterThanOrEqual(0);
    source.bytes = bytes.slice();
    source.bytes.set(new TextEncoder().encode(`/UserUnit ${digits} `), offset);
    await expectDeskError(inspectPdf(source.bytes, source.name), /خراب|نامعتبر|UserUnit/);
    await expectDeskError(createOutputs([source], workspace([source]), { title: 'test' }), /خراب|نامعتبر|UserUnit/);
  });

  it('rejects empty, non-PDF, truncated, structurally corrupt, and zero-page files in Persian', async () => {
    await expectDeskError(inspectPdf(new Uint8Array(), 'empty.pdf'), /خالی/);
    await expectDeskError(inspectPdf(new TextEncoder().encode('not a PDF'), 'fake.pdf'), /PDF معتبر/);
    await expectDeskError(inspectPdf(new TextEncoder().encode('HTML %PDF-1.7\n%%EOF'), 'fake.pdf'));
    const source = await fixture();
    await expectDeskError(inspectPdf(source.bytes.subarray(0, source.bytes.length - 9), source.name), /خراب|ناقص/);
    await expectDeskError(inspectPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Bad >>\nendobj\n%%EOF'), 'bad.pdf'), /خراب/);
    const document = await PDFDocument.create();
    await expectDeskError(inspectPdf(await document.save({ addDefaultPage: false }), 'zero.pdf'), /هیچ صفحه/);
  });

  it('rejects broken page-content references instead of silently copying a blank page', async () => {
    const source = await fixture();
    const document = await PDFDocument.load(source.bytes);
    document.getPage(0).node.set(PDFName.of('Contents'), document.context.nextRef());
    const bytes = await document.save();
    await expectDeskError(inspectPdf(bytes, 'broken.pdf'), /محتوای صفحه/);
    await expectDeskError(createOutputs([{ ...source, bytes }], workspace([source]), { title: 'test' }), /محتوای صفحه/);
  });

  it('never opens an encrypted PDF, including when it is an unused source', async () => {
    const source = await fixture();
    const encrypted = await PDFDocument.load(source.bytes);
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(encrypted.context.obj({
      Filter: 'Standard', V: 1, R: 2, O: 'owner', U: 'user', P: -4,
    }));
    const bytes = await encrypted.save();
    await expectDeskError(inspectPdf(bytes, 'locked.pdf'), /رمزگذاری/);
    const locked = { ...source, id: 'locked', bytes, name: 'locked.pdf' };
    await expectDeskError(createOutputs([source, locked], workspace([source]), { title: 'test' }), /رمزگذاری/);
  });

  it('accepts 300 real pages and rejects 301, oversize input, bad boxes and non-quarter rotation', async () => {
    const source = await fixture('many', Array.from({ length: 300 }, () => ({})));
    expect(await inspectPdf(source.bytes, source.name)).toEqual({ pageCount: 300 });
    const document = await PDFDocument.load(source.bytes);
    document.addPage();
    await expectDeskError(inspectPdf(await document.save(), '301.pdf'), /۳۰۰/);
    await expectDeskError(inspectPdf(new Uint8Array(LIMITS.fileBytes + 1), 'large.pdf'), /۵۰/);
    const invalid = await PDFDocument.load((await fixture()).bytes);
    invalid.getPage(0).node.set(PDFName.of('Rotate'), PDFNumber.of(45));
    await expectDeskError(inspectPdf(await invalid.save(), 'rotation.pdf'), /چرخش/);
    invalid.getPage(0).node.set(PDFName.of('Rotate'), PDFNumber.of(0));
    invalid.getPage(0).node.set(PDFName.of('MediaBox'), invalid.context.obj([0, 0, -10, 500]));
    await expectDeskError(inspectPdf(await invalid.save(), 'box.pdf'), /ابعاد/);
  });
});

describe('createOutputs: merge, subset, order, rotation and metadata', () => {
  it('loads each source once, preserves ordered content and geometry, and emits fresh NoxaPlus metadata', async () => {
    const a = await fixture('a', [
      { width: 310, height: 480, rotation: 90, crop: [13, 27, 240, 380] },
      { width: 720, height: 300, rotation: 270 },
    ]);
    const b = await fixture('b', [{ width: 430, height: 650, rotation: 180 }, { width: 250, height: 360 }]);
    const [a0, a1, b0, b1] = workspace([a, b]);
    const pages: DeskPage[] = [
      { ...b0, rotation: 270 },
      { ...a1, included: false },
      { ...a0, rotation: 180 },
      b1,
    ];
    const beforeA = a.bytes.slice();
    const load = vi.spyOn(PDFDocument, 'load');
    const progress = vi.fn();
    const outputs = await createOutputs([a, b], pages, { title: '../گزارش: خصوصی.pdf', onProgress: progress });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.every(([, options]) => options?.ignoreEncryption === false)).toBe(true);
    load.mockRestore();
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toBe('..گزارش خصوصی.pdf');
    const result = await PDFDocument.load(outputs[0].bytes, { updateMetadata: false });
    expect(result.getPages().map(page => pageTexts(page))).toEqual([['b-0'], ['a-0'], ['b-1']]);
    expect(result.getPages().map(page => page.getRotation().angle)).toEqual([90, 270, 0]);
    expect(result.getPages().map(page => page.getSize())).toEqual([
      { width: 430, height: 650 }, { width: 310, height: 480 }, { width: 250, height: 360 },
    ]);
    expect(result.getPage(1).getCropBox()).toEqual({ x: 13, y: 27, width: 240, height: 380 });
    expect(result.getTitle()).toBe('../گزارش: خصوصی.pdf');
    expect(result.getAuthor()).toBe('NoxaPlus');
    expect(result.getCreator()).toBe('NoxaPlus PDF Desk');
    expect(result.getProducer()).toBe('NoxaPlus PDF Desk');
    expect(result.getKeywords()).toContain('NoxaPlus');
    expect(result.getCreationDate()).toBeInstanceOf(Date);
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    expect(a.bytes).toEqual(beforeA);
  });

  it('keeps repeated source-page numbering streams and rotations independent', async () => {
    const source = await fixture();
    const [page] = workspace([source]);
    const result = await oneOutput(source, { numbers: latinNumbers }, [page, { ...page, id: 'again', rotation: 90 }]);
    expect(result.getPages().map(page => page.getRotation().angle)).toEqual([0, 90]);
    expect(result.getPages().map(page => pageTexts(page))).toEqual([['a-0', '1'], ['a-0', '2']]);
  });

  it('normalizes inherited negative/full-circle source rotations before adding the delta', async () => {
    const source = await fixture('a', [{}, {}]);
    const document = await PDFDocument.load(source.bytes);
    document.getPage(0).node.set(PDFName.of('Rotate'), PDFNumber.of(-90));
    document.getPage(1).node.set(PDFName.of('Rotate'), PDFNumber.of(450));
    source.bytes = await document.save();
    const pages = workspace([source]).map(page => ({ ...page, rotation: 90 as QuarterTurn }));
    const result = await oneOutput(source, {}, pages);
    expect(result.getPages().map(page => page.getRotation().angle)).toEqual([0, 180]);
  });

  it('groups address included ordered pages, allow subsets, and retain each group order', async () => {
    const a = await fixture('a', [{}, {}, {}]);
    const b = await fixture('b', [{}, {}]);
    const [a0, a1, a2, b0, b1] = workspace([a, b]);
    const pages = [b1, { ...a1, included: false }, a0, a2, b0];
    const load = vi.spyOn(PDFDocument, 'load');
    const progress = vi.fn();
    const outputs = await createOutputs([a, b], pages, {
      title: 'بخش.pdf', groups: [[3, 0], [2]], onProgress: progress,
    });
    expect(load).toHaveBeenCalledTimes(2);
    load.mockRestore();
    expect(outputs.map(output => output.name)).toEqual(['بخش-01.pdf', 'بخش-02.pdf']);
    const results = await Promise.all(outputs.map(output => PDFDocument.load(output.bytes)));
    expect(results.map(result => result.getPages().flatMap(page => pageTexts(page))))
      .toEqual([['b-0', 'b-1'], ['a-2']]);
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  });

  it('names even a single explicit group and reserves the sequence suffix for long or unsafe titles', async () => {
    const source = await fixture('a', [{}, {}]);
    const outputs = await createOutputs([source], workspace([source]), { title: 'x'.repeat(150), groups: [[0], [1]] });
    expect(outputs.map(output => output.name)).toEqual([`${'x'.repeat(97)}-01.pdf`, `${'x'.repeat(97)}-02.pdf`]);
    expect((await createOutputs([source], workspace([source]), { title: 'CON.pdf', groups: [[0]] }))[0].name)
      .toBe('NoxaPlus-PDF-01.pdf');
  });

  it('snapshots pages, groups, source metadata and number settings before invoking progress', async () => {
    const source = await fixture('a', [{}, {}]);
    const pages = workspace([source]);
    const groups = [[1, 0]];
    const numbers = { ...latinNumbers };
    const result = await oneOutput(source, {
      groups, numbers,
      onProgress: done => {
        if (done !== 0) return;
        groups[0].splice(0);
        pages[0].rotation = 180;
        source.pageCount = 99;
        numbers.start = 900;
      },
    }, pages);
    expect(result.getPages().map(page => pageTexts(page))).toEqual([['a-1', '1'], ['a-0', '2']]);
    expect(result.getPages().map(page => page.getRotation().angle)).toEqual([0, 0]);
  });
});

describe('numbering: real embedded fonts and labels', () => {
  it('uses Helvetica for Latin fractions, skips output cover and starts the next page at start', async () => {
    const source = await fixture('a', [{}, {}, {}]);
    const register = vi.spyOn(PDFDocument.prototype, 'registerFontkit');
    const result = await oneOutput(source, {
      numbers: { ...latinNumbers, start: 12, style: 'fraction', skipFirst: true },
      persianFontBytes: new Uint8Array(), // Not touched for Latin digits.
    });
    expect(register).not.toHaveBeenCalled();
    expect(result.getPages().map(page => pageTexts(page))).toEqual([
      ['a-0'], ['a-1', '12 / 2'], ['a-2', '13 / 2'],
    ]);
    expect(textRuns(result.getPage(1)).at(-1)!.font.get(PDFName.of('BaseFont'))).toBe(PDFName.of('Helvetica'));
  });

  it.each([false, true])('embeds real Persian WOFF as valid TrueType, preserving multi-digit order (override=%s)', async override => {
    const source = await fixture('a', [{}, {}, {}]);
    const numbers: NumberSettings = { ...DEFAULT_NUMBERS, start: 123, style: 'fraction', skipFirst: true };
    const result = await oneOutput(source, { numbers, ...(override ? { persianFontBytes: fontBytes } : {}) });
    const labels = result.getPages().map(page => pageTexts(page));
    expect(labels).toEqual([['a-0'], ['a-1', '۱۲۳ / ۲'], ['a-2', '۱۲۴ / ۲']]);
    const run = textRuns(result.getPage(1))[1];
    expect(run.font.get(PDFName.of('Subtype'))).toBe(PDFName.of('Type0'));
    const descendant = run.font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const fontStream = descriptor.lookup(PDFName.of('FontFile2'));
    expect(fontStream).toBeInstanceOf(PDFRawStream);
    const fontProgram = decodePDFRawStream(fontStream as PDFRawStream).decode();
    const signature = [...fontProgram.subarray(0, 4)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    expect(['00010000', '74727565']).toContain(signature); // TrueType SFNT (including Apple's "true" tag), not WOFF.
    const embedded = fontkit.create(fontProgram);
    const glyphIds = run.hex.match(/.{4}/g)!.map(code => parseInt(code, 16));
    expect(glyphIds.every(id => id > 0 && id < embedded.numGlyphs)).toBe(true);
    expect(embedded.getGlyph(glyphIds[0]).path.toSVG().length).toBeGreaterThan(0);
    // Check the saved/reloaded font again, not just embedFont's in-memory object.
    const reloaded = await PDFDocument.load(await result.save());
    expect(pageTexts(reloaded.getPage(2)).at(-1)).toBe('۱۲۴ / ۲');
  });

  it('draws plain multi-digit Persian labels in numeric order without embedding a separator font', async () => {
    const source = await fixture('a', [{}, {}]);
    const result = await oneOutput(source, { numbers: { ...DEFAULT_NUMBERS, start: 908 }, persianFontBytes: fontBytes });
    expect(result.getPages().map(pageTexts)).toEqual([['a-0', '۹۰۸'], ['a-1', '۹۰۹']]);
    expect(result.getPages().map(page => textRuns(page).length)).toEqual([2, 2]);
  });

  it('restarts numbering and skipFirst for each group using that output count', async () => {
    const source = await fixture('a', [{}, {}, {}, {}, {}]);
    const numbers = { ...latinNumbers, start: 8, style: 'fraction' as const, skipFirst: true };
    const outputs = await createOutputs([source], workspace([source]), { title: 'test', groups: [[4, 2, 0], [3, 1]], numbers });
    const results = await Promise.all(outputs.map(output => PDFDocument.load(output.bytes)));
    expect(results.map(result => result.getPages().map(page => pageTexts(page)))).toEqual([
      [['a-4'], ['a-2', '8 / 2'], ['a-0', '9 / 2']], [['a-3'], ['a-1', '8 / 1']],
    ]);
  });

  it('does not load a font or reject tiny pages when the only page is a skipped cover', async () => {
    const source = await fixture('a', [{ width: 15, height: 15 }]);
    const result = await oneOutput(source, {
      numbers: { ...DEFAULT_NUMBERS, skipFirst: true }, persianFontBytes: new Uint8Array(),
    });
    expect(textRuns(result.getPage(0))).toHaveLength(1);
  });

  it('reports invalid or unreadable font bytes in Persian without returning partial PDFs', async () => {
    const source = await fixture();
    for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3, 4])]) {
      await expectDeskError(createOutputs([source], workspace([source]), {
        title: 'test', numbers: DEFAULT_NUMBERS, persianFontBytes: bytes,
      }), /قلم فارسی/);
    }
  });
});

const positions: NumberPosition[] = ['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-right'];
const geometryCases = [1, 10, 0.5].flatMap(unit => (['latin', 'persian'] as const).flatMap(digits =>
  ([0, 90, 180, 270] as const).flatMap(rotation => positions.map(position => ({ unit, digits, rotation, position })))));

describe('number geometry in visible screen coordinates', () => {
  it.each(geometryCases)('$digits $rotation° $position: upright, aligned, inside crop including descent', async ({ digits, rotation, position }) => {
    const source = await fixture('a', [{ width: 510, height: 700, crop: [41, 53, 360, 520], rotation }]);
    const numbers: NumberSettings = { ...DEFAULT_NUMBERS, digits, position, start: 123, style: 'fraction', size: 24, margin: 32 };
    const result = await oneOutput(source, { numbers, persianFontBytes: fontBytes });
    const runs = textRuns(result.getPage(0)).slice(1);
    const run = runs[0];
    const [a, b, c, d, px, py] = run.matrix;
    const radians = rotation * Math.PI / 180;
    expect(a).toBeCloseTo(Math.cos(radians));
    expect(b).toBeCloseTo(Math.sin(radians));
    expect(c).toBeCloseTo(-Math.sin(radians));
    expect(d).toBeCloseTo(Math.cos(radians));
    const u = px - 41;
    const v = py - 53;
    const x = rotation === 0 ? u : rotation === 90 ? v : rotation === 180 ? 360 - u : 520 - v;
    const y = rotation === 0 ? v : rotation === 90 ? 360 - u : rotation === 180 ? 520 - v : u;
    const screenWidth = rotation % 180 === 0 ? 360 : 520;
    const screenHeight = rotation % 180 === 0 ? 520 : 360;
    let width: number;
    let ascent: number;
    let descent: number;
    if (digits === 'persian') {
      const font = fontkit.create(fontBytes);
      const metrics = await PDFDocument.create();
      const separator = await metrics.embedFont(StandardFonts.Helvetica);
      width = pageLabel(0, 1, numbers).split(/( \/ )/).reduce((sum, text) => sum + (text === ' / '
        ? separator.widthOfTextAtSize(text, numbers.size)
        : font.layout(text).glyphs.reduce((advance, glyph) => advance + glyph.advanceWidth, 0) * numbers.size / font.unitsPerEm), 0);
      ascent = font.ascent * numbers.size / font.unitsPerEm;
      descent = -font.descent * numbers.size / font.unitsPerEm;
    } else {
      const metrics = await PDFDocument.create();
      const font = await metrics.embedFont(StandardFonts.Helvetica);
      width = font.widthOfTextAtSize(pageLabel(0, 1, numbers), numbers.size);
      ascent = font.heightAtSize(numbers.size, { descender: false });
      descent = font.heightAtSize(numbers.size) - ascent;
    }
    expect(runs.map(run => run.text).join('')).toBe(pageLabel(0, 1, numbers));
    // All mixed-font fraction chunks share one baseline and the same upright orientation.
    for (const chunk of runs) {
      chunk.matrix.slice(0, 4).forEach((value, index) => expect(value).toBeCloseTo(run.matrix[index]));
      const dx = chunk.matrix[4] - px;
      const dy = chunk.matrix[5] - py;
      expect(-dx * Math.sin(radians) + dy * Math.cos(radians)).toBeCloseTo(0);
      expect(dx * Math.cos(radians) + dy * Math.sin(radians)).toBeGreaterThanOrEqual(-0.00001);
    }
    expect(x).toBeCloseTo(position.endsWith('left') ? 32 : position.endsWith('right') ? screenWidth - 32 - width : (screenWidth - width) / 2);
    expect(y - descent).toBeGreaterThanOrEqual(32 - 0.00001);
    expect(y + ascent).toBeLessThanOrEqual(screenHeight - 32 + 0.00001);
    expect(x).toBeGreaterThanOrEqual(32 - 0.00001);
    expect(x + width).toBeLessThanOrEqual(screenWidth - 32 + 0.00001);
    expect(position.startsWith('top') ? y + ascent : y - descent).toBeCloseTo(position.startsWith('top') ? screenHeight - 32 : 32);
  });

  it('uses final rotation after delta, negative media offsets and the visible crop/media intersection', async () => {
    const source = await fixture('a', [{ media: [-50, -80, 400, 500], crop: [-80, -100, 200, 240], rotation: 90 }]);
    const pages = workspace([source]).map(page => ({ ...page, rotation: 180 as QuarterTurn }));
    const result = await oneOutput(source, { numbers: { ...latinNumbers, position: 'bottom-left' } }, pages);
    const page = result.getPage(0);
    expect(page.getRotation().angle).toBe(270);
    const [a, b, c, d, px, py] = textRuns(page).at(-1)!.matrix;
    expect([a, b, c, d].map(value => Math.round(value))).toEqual([-0, -1, 1, -0]);
    const metrics = await PDFDocument.create();
    const font = await metrics.embedFont(StandardFonts.Helvetica);
    const descent = font.heightAtSize(12) - font.heightAtSize(12, { descender: false });
    expect(px).toBeCloseTo(-50 + 24 + descent);
    expect(py).toBeCloseTo(-80 + 220 - 24);
  });

  it.each(['latin', 'persian'] as const)('rejects insufficient width or height for %s at top and bottom', async digits => {
    for (const position of ['top-right', 'bottom-center'] as const) {
      for (const spec of [{ width: 60, height: 400 }, { width: 400, height: 60 }]) {
        const source = await fixture('a', [spec]);
        await expectDeskError(createOutputs([source], workspace([source]), {
          title: 'test', numbers: { ...DEFAULT_NUMBERS, digits, position, start: 999999, size: 36, margin: 24 }, persianFontBytes: fontBytes,
        }), /کوچک/);
      }
    }
  });
});

describe('validation and hard limits', () => {
  it('rejects no sources, no included pages, unknown and out-of-range refs, bad rotations and stale source counts', async () => {
    const source = await fixture();
    const [page] = workspace([source]);
    await expectDeskError(createOutputs([], [], { title: 'test' }), /فایل/);
    await expectDeskError(createOutputs([source], [], { title: 'test' }), /حداقل یک صفحه/);
    await expectDeskError(createOutputs([source], [{ ...page, included: false }], { title: 'test' }), /حداقل یک صفحه/);
    for (const change of [{ sourceId: 'unknown' }, { sourcePage: -1 }, { sourcePage: 1 }, { sourcePage: 0.5 }, { sourcePage: NaN }]) {
      await expectDeskError(createOutputs([source], [{ ...page, ...change }], { title: 'test' }), /ارجاع/);
    }
    for (const rotation of [-90, 45, 360, NaN]) {
      await expectDeskError(createOutputs([source], [{ ...page, rotation: rotation as QuarterTurn }], { title: 'test' }), /چرخش/);
    }
    await expectDeskError(createOutputs([{ ...source, pageCount: 2 }], [page], { title: 'test' }), /مطابقت/);
    // Excluded stale references do not participate in the output plan.
    expect((await createOutputs([source], [page, { ...page, included: false, sourceId: 'gone', sourcePage: 99 }], { title: 'test' }))).toHaveLength(1);
  });

  it.each([[], [[]], [[-1]], [[1]], [[0.5]], [[NaN]], [[0, 0]], [[0], [0]], [null], null])('rejects invalid groups %j', async groups => {
    const source = await fixture();
    await expectDeskError(createOutputs([source], workspace([source]), { title: 'test', groups: groups as number[][] }));
  });

  it.each([
    { start: 0 }, { start: 1000000 }, { start: 1.5 }, { size: 7 }, { size: 37 }, { size: NaN },
    { margin: 7 }, { margin: 73 }, { margin: Infinity }, { position: 'middle' }, { digits: 'arabic' },
    { style: 'roman' }, { skipFirst: 'yes' },
  ])('rejects invalid number settings %j', async change => {
    const source = await fixture();
    await expectDeskError(createOutputs([source], workspace([source]), {
      title: 'test', numbers: { ...DEFAULT_NUMBERS, ...change } as NumberSettings,
    }), /شماره‌گذاری/);
  });

  it('rejects malformed options, source identities and runtime inputs with DeskError', async () => {
    const source = await fixture();
    const pages = workspace([source]);
    await expectDeskError(createOutputs([source], pages, null as unknown as CreateOutputsOptions));
    await expectDeskError(createOutputs([source], pages, { title: 5 } as unknown as CreateOutputsOptions));
    await expectDeskError(createOutputs([source], pages, { title: '', onProgress: 5 } as unknown as CreateOutputsOptions));
    for (const change of [{ id: '' }, { pageCount: 0 }, { pageCount: 0.5 }, { bytes: new Uint8Array() }]) {
      await expectDeskError(createOutputs([{ ...source, ...change }], pages, { title: 'test' }));
    }
    await expectDeskError(createOutputs([source, source], pages, { title: 'test' }), /یکتا/);
    await expectDeskError(createOutputs([source], [{ ...pages[0], included: 1 } as unknown as DeskPage], { title: 'test' }));
  });

  it('enforces file count, 50 MiB/file, 150 MiB total and 300 workspace pages, including excluded ones', async () => {
    const source = await fixture();
    const pages = workspace([source]);
    await expectDeskError(createOutputs(Array.from({ length: 31 }, (_, index) => ({ ...source, id: String(index) })), pages, { title: 'test' }), /۳۰/);
    await expectDeskError(createOutputs([{ ...source, bytes: sizedInput(LIMITS.fileBytes + 1) }], pages, { title: 'test' }), /۵۰/);
    const fullSize = sizedInput(LIMITS.fileBytes);
    const bigSources = Array.from({ length: 3 }, (_, index) => ({ ...source, id: String(index), bytes: fullSize }));
    bigSources.push({ ...source, id: 'extra' });
    await expectDeskError(createOutputs(bigSources, workspace([bigSources[0]]), { title: 'test' }), /۱۵۰/);
    await expectDeskError(createOutputs([{ ...source, pageCount: 301 }], pages, { title: 'test' }), /۳۰۰/);
    await expectDeskError(createOutputs([{ ...source, id: 'a', pageCount: 200 }, { ...source, id: 'b', pageCount: 101 }], pages, { title: 'test' }), /۳۰۰/);
    await expectDeskError(createOutputs([source], Array.from({ length: 301 }, (_, index) => ({ ...pages[0], included: index === 0 })), { title: 'test' }), /۳۰۰/);
  });

  it('allows 100 real split files with unique sequence names and rejects 101', async () => {
    const source = await fixture('a', Array.from({ length: 100 }, () => ({})));
    const pages = workspace([source]);
    const groups = pages.map((_, index) => [index]);
    const outputs = await createOutputs([source], pages, { title: 'بخش', groups });
    expect(outputs).toHaveLength(100);
    expect(new Set(outputs.map(output => output.name)).size).toBe(100);
    expect(outputs[0].name).toBe('بخش-001.pdf');
    expect(outputs[99].name).toBe('بخش-100.pdf');
    expect((await PDFDocument.load(outputs[99].bytes)).getPageCount()).toBe(1);
    await expectDeskError(createOutputs([source], pages, { title: 'test', groups: [...groups, [0]] }), /۱۰۰/);
  });

  it('guards the combined saved-byte total, allows exactly 200 MiB, and never returns partial outputs', async () => {
    const source = await fixture('a', [{}, {}]);
    const half = new Uint8Array(MAX_OUTPUT_BYTES / 2);
    const save = vi.spyOn(PDFDocument.prototype, 'save').mockResolvedValue(half);
    const options = { title: 'test', groups: [[0], [1]] };
    const exact = await createOutputs([source], workspace([source]), options);
    expect(exact.reduce((sum, output) => sum + output.bytes.length, 0)).toBe(MAX_OUTPUT_BYTES);
    save.mockResolvedValueOnce(half).mockResolvedValueOnce(new Uint8Array(half.length + 1));
    await expectDeskError(createOutputs([source], workspace([source]), options), /۲۰۰/);
  });
});

describe('cancellation, progress and event-loop cooperation', () => {
  it('rejects an already-aborted operation before any load or progress call', async () => {
    const source = await fixture();
    const controller = new AbortController();
    controller.abort();
    const load = vi.spyOn(PDFDocument, 'load');
    const progress = vi.fn();
    await expectDeskError(createOutputs([source], workspace([source]), { title: 'test', signal: controller.signal, onProgress: progress }), /لغو/);
    expect(load).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it.each(['load', 'copy', 'font', 'save'] as const)('checks cancellation after the awaited %s operation', async stage => {
    const source = await fixture();
    const controller = new AbortController();
    if (stage === 'load') {
      const original = PDFDocument.load;
      vi.spyOn(PDFDocument, 'load').mockImplementationOnce(async (bytes, options) => {
        const result = await original.call(PDFDocument, bytes, options);
        controller.abort();
        return result;
      });
    } else if (stage === 'copy') {
      const original = PDFDocument.prototype.copyPages;
      vi.spyOn(PDFDocument.prototype, 'copyPages').mockImplementationOnce(async function (this: PDFDocument, source, indices) {
        const result = await original.call(this, source, indices);
        controller.abort();
        return result;
      });
    } else if (stage === 'font') {
      const original = PDFDocument.prototype.embedFont;
      vi.spyOn(PDFDocument.prototype, 'embedFont').mockImplementationOnce(async function (this: PDFDocument, bytes, options) {
        const result = await original.call(this, bytes, options);
        controller.abort();
        return result;
      });
    } else {
      const original = PDFDocument.prototype.save;
      vi.spyOn(PDFDocument.prototype, 'save').mockImplementationOnce(async function (this: PDFDocument, options) {
        const result = await original.call(this, options);
        controller.abort();
        return result;
      });
    }
    await expectDeskError(createOutputs([source], workspace([source]), {
      title: 'test', numbers: DEFAULT_NUMBERS, persianFontBytes: fontBytes, signal: controller.signal,
    }), /لغو/);
  });

  it('stops immediately after cancellation from a page-progress callback, with no partial return', async () => {
    const source = await fixture('a', [{}, {}, {}]);
    const controller = new AbortController();
    const progress = vi.fn((done: number) => { if (done === 1) controller.abort(); });
    const save = vi.spyOn(PDFDocument.prototype, 'save');
    await expectDeskError(createOutputs([source], workspace([source]), {
      title: 'test', groups: [[0], [1, 2]], signal: controller.signal, onProgress: progress,
    }), /لغو/);
    expect(progress.mock.calls.map(([done]) => done)).toEqual([0, 1]);
    expect(save).not.toHaveBeenCalled();
  });

  it('yields a browser-style timer periodically so cancellation can run between pages', async () => {
    const source = await fixture('a', Array.from({ length: 20 }, () => ({})));
    const controller = new AbortController();
    const seen: number[] = [];
    await expectDeskError(createOutputs([source], workspace([source]), {
      title: 'test', signal: controller.signal,
      onProgress: done => {
        seen.push(done);
        if (done === 1) setTimeout(() => controller.abort(), 0);
      },
    }), /لغو/);
    expect(seen.at(-1)).toBe(8);
  });

  it('wraps save failures and progress exceptions into clear Persian DeskError', async () => {
    const source = await fixture();
    vi.spyOn(PDFDocument.prototype, 'save').mockRejectedValueOnce(new Error('failed write'));
    await expectDeskError(createOutputs([source], workspace([source]), { title: 'test' }), /ساخت خروجی/);
    await expectDeskError(createOutputs([source], workspace([source]), {
      title: 'test', onProgress: () => { throw new Error('callback failure'); },
    }), /ساخت خروجی/);
  });
});
