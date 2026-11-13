import { describe, expect, it } from 'vitest';
import { DEFAULT_NUMBERS, DeskError, formatBytes, formatNumber, pageLabel, parseRange, parseSplitGroups, rotateBy, safeFilename, validateNumbers, type NumberSettings } from './model';

describe('page ranges', () => {
  it.each([
    ['1', [0]], ['1-3,5', [0,1,2,4]], ['۵، ۱-۳', [0,1,2,4]], ['١-٣,٥', [0,1,2,4]], ['3,1,3,2', [0,1,2]], [' 1 - 2 , 5 ', [0,1,4]], ['01-02', [0,1]], ['5', [4]], ['1-5,2-4', [0,1,2,3,4]],
  ])('parses %s in page order', (expression, indices) => expect(parseRange(expression as string, 5)).toEqual(indices));
  it.each(['', ' ', '0', '-1', '6', '3-1', '1-6', '1.5', '1e2', '1,,2', '1,', ',1', '1--3', '1/3', '1;2', 'all', 'Infinity', '99999999999999999999999999'])('rejects invalid %s', expression => expect(() => parseRange(expression, 5)).toThrow(DeskError));
  it.each([0,-1,1.5,301,NaN,Infinity])('rejects bad count %s', count => expect(() => parseRange('1', count)).toThrow());
});

describe('split groups', () => {
  it('supports Persian separators and newlines', () => expect(parseSplitGroups('۱-۲؛۳\n۴-۵',5)).toEqual([[0,1],[2],[3,4]]));
  it('allows omissions', () => expect(parseSplitGroups('1;5',5)).toEqual([[0],[4]]));
  it('deduplicates within a group', () => expect(parseSplitGroups('1,1;2',5)).toEqual([[0],[1]]));
  it.each(['', '1;', ';1', '1;1', '1-3;3-5', '1\n\n2', '1-5;2'])('rejects invalid split %s', expression => expect(() => parseSplitGroups(expression,5)).toThrow());
  it('caps file count', () => expect(() => parseSplitGroups(Array.from({length:101},(_,i)=>i+1).join(';'),300)).toThrow());
});

describe('quarter-turn rotation', () => {
  it.each([[0,90,90],[90,90,180],[180,90,270],[270,90,0],[0,-90,270],[180,-90,90],[0,720,0],[270,-720,270]] as const)('%s + %s', (current,delta,result) => expect(rotateBy(current,delta)).toBe(result));
  it.each([45,1,NaN,Infinity])('rejects non-quarter-turn %s', delta => expect(() => rotateBy(0,delta)).toThrow());
});

describe('numbering', () => {
  it('accepts defaults', () => expect(() => validateNumbers(DEFAULT_NUMBERS)).not.toThrow());
  it.each([
    {start:0}, {start:1.2}, {start:1_000_000}, {size:7}, {size:37}, {size:NaN}, {margin:7}, {margin:73}, {margin:Infinity}, {position:'center'}, {digits:'arabic'}, {style:'custom'}, {skipFirst:1},
  ])('rejects %o', partial => expect(() => validateNumbers({...DEFAULT_NUMBERS,...partial} as NumberSettings)).toThrow());
  it('uses Persian digits', () => expect(pageLabel(1,3,DEFAULT_NUMBERS)).toBe('۲'));
  it('uses Latin digits and custom start', () => expect(pageLabel(1,3,{...DEFAULT_NUMBERS,digits:'latin',start:8})).toBe('9'));
  it('starts after the skipped cover', () => expect(pageLabel(1,3,{...DEFAULT_NUMBERS,skipFirst:true})).toBe('۱'));
  it('counts numbered pages in fraction', () => expect(pageLabel(2,3,{...DEFAULT_NUMBERS,skipFirst:true,style:'fraction'})).toBe('۲ / ۲'));
  it('does not offset total by start', () => expect(pageLabel(0,3,{...DEFAULT_NUMBERS,start:12,style:'fraction',digits:'latin'})).toBe('12 / 3'));
});

describe('filenames and display', () => {
  it.each(['', '.', '..', 'CON', 'nul.pdf', 'PRN', 'aux.txt', 'COM1', 'LPT9'])('falls back for %s', name => expect(safeFilename(name,'pdf')).toBe('NoxaPlus-PDF.pdf'));
  it('retains Persian names', () => expect(safeFilename('دفتر جلسه.pdf','pdf')).toBe('دفتر جلسه.pdf'));
  it('normalizes extensions', () => expect(safeFilename('Desk.PDF','zip')).toBe('Desk.zip'));
  it('strips unsafe characters and bidi controls', () => expect(safeFilename('a/b\\c:*?<>"|\u202ed\u0000.pdf','pdf')).toBe('abcd.pdf'));
  it('strips trailing dot and space', () => expect(safeFilename('note.  ','pdf')).toBe('note.pdf'));
  it('caps name length', () => expect(safeFilename('a'.repeat(500),'pdf').length).toBe(104));
  it('formats bytes', () => { expect(formatBytes(1)).toBe('۱ کیلوبایت'); expect(formatBytes(1048576)).toBe('۱ مگابایت'); });
  it('formats Persian counts', () => expect(formatNumber(12)).toBe('۱۲'));
});
