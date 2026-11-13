export type QuarterTurn = 0 | 90 | 180 | 270;
export type Mode = 'merge' | 'split' | 'rotate' | 'number';
export type NumberPosition = 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right';

export interface SourcePdf {
  id: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export interface DeskPage {
  id: string;
  sourceId: string;
  sourcePage: number;
  rotation: QuarterTurn;
  included: boolean;
}

export interface NumberSettings {
  start: number;
  size: number;
  margin: number;
  position: NumberPosition;
  digits: 'latin' | 'persian';
  style: 'plain' | 'fraction';
  skipFirst: boolean;
}

export const LIMITS = { files: 30, fileBytes: 50 * 1024 * 1024, totalBytes: 150 * 1024 * 1024, pages: 300, splitFiles: 100 } as const;
export const DEFAULT_NUMBERS: NumberSettings = { start: 1, size: 12, margin: 24, position: 'bottom-center', digits: 'persian', style: 'plain', skipFirst: false };

export class DeskError extends Error {}

export function parseRange(expression: string, count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > LIMITS.pages) throw new DeskError('تعداد صفحات برای انتخاب بازه معتبر نیست.');
  const text = expression.replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/،/g, ',').trim();
  if (!text) throw new DeskError('بازهٔ صفحات را وارد کنید؛ مثلاً ۱-۳، ۵.');
  const indices = new Set<number>();
  for (const segment of text.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(segment);
    if (!match) throw new DeskError('قالب بازه درست نیست؛ عددها را با ویرگول و بازه‌ها را با خط تیره جدا کنید.');
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last > count || first > last) throw new DeskError(`بازه باید صعودی و بین ۱ تا ${formatNumber(count)} باشد.`);
    for (let i = first; i <= last; i++) indices.add(i - 1);
  }
  return [...indices].sort((a, b) => a - b);
}

export function parseSplitGroups(expression: string, count: number): number[][] {
  const groups = expression.split(/[;؛\n]/).map(group => parseRange(group, count));
  if (groups.length > LIMITS.splitFiles) throw new DeskError(`حداکثر ${formatNumber(LIMITS.splitFiles)} فایل خروجی در هر نوبت مجاز است.`);
  const seen = new Set<number>();
  for (const group of groups) for (const index of group) {
    if (seen.has(index)) throw new DeskError('بازه‌های تفکیک نباید هم‌پوشانی داشته باشند.');
    seen.add(index);
  }
  return groups;
}

export function rotateBy(current: QuarterTurn, delta: number): QuarterTurn {
  if (!Number.isInteger(delta / 90)) throw new DeskError('چرخش باید مضربی از ۹۰ درجه باشد.');
  return ((current + delta) % 360 + 360) % 360 as QuarterTurn;
}

export function validateNumbers(settings: NumberSettings): void {
  if (!Number.isSafeInteger(settings.start) || settings.start < 1 || settings.start > 999999 || !Number.isFinite(settings.size) || settings.size < 8 || settings.size > 36 || !Number.isFinite(settings.margin) || settings.margin < 8 || settings.margin > 72 || !['bottom-left', 'bottom-center', 'bottom-right', 'top-left', 'top-center', 'top-right'].includes(settings.position) || !['latin', 'persian'].includes(settings.digits) || !['plain', 'fraction'].includes(settings.style) || typeof settings.skipFirst !== 'boolean') throw new DeskError('تنظیمات شماره‌گذاری معتبر نیست.');
}

export function pageLabel(index: number, count: number, settings: NumberSettings): string {
  const number = settings.start + index - (settings.skipFirst ? 1 : 0);
  const label = settings.style === 'fraction' ? `${number} / ${count - (settings.skipFirst ? 1 : 0)}` : String(number);
  return settings.digits === 'persian' ? label.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]) : label;
}

export function formatNumber(number: number): string {
  return new Intl.NumberFormat('fa-IR').format(number);
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${formatNumber(Math.round(bytes / 1024 / 1024 * 10) / 10)} مگابایت` : `${formatNumber(Math.ceil(bytes / 1024))} کیلوبایت`;
}

export function safeFilename(name: string, extension: 'pdf' | 'zip'): string {
  let stem = name.replace(/\.(pdf|zip)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!stem || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = 'NoxaPlus-PDF';
  return `${stem}.${extension}`;
}
