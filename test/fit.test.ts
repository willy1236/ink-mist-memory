import { describe, expect, it } from 'vitest';
import { fitWithinLimit, formatEntry, SEPARATOR } from '../src/shell/fit.js';
import { entry } from './helpers.js';

describe('fitWithinLimit', () => {
  it('每條以所屬檔案開頭接條目原文（可多行）', () => {
    const e = entry(1, '- [stated] 父項\n  - 子項');
    expect(formatEntry(e)).toBe('[areas/f1.md]\n- [stated] 父項\n  - 子項');
  });

  it('依候選順序取到條數上限', () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(i));
    const r = fitWithinLimit('H', entries, 30);
    expect(r.used.map((e) => e.id)).toEqual(entries.slice(0, 30).map((e) => e.id));
    expect(r.dropped).toHaveLength(10);
  });

  it('以組好的文字長度計數，含 header、分隔與預留長度', () => {
    const entries = [entry(1, 'a'.repeat(50)), entry(2, 'b'.repeat(50))];
    const one = 'H' + SEPARATOR + formatEntry(entries[0]!);
    const r = fitWithinLimit('H', entries, 30, one.length + 10, 10);
    expect(r.text).toBe(one);
    expect(r.used).toHaveLength(1);
    expect(r.dropped.map((e) => e.id)).toEqual(['id-2']);
  });

  it('放不下的條目之後全部捨棄，維持取捨順序', () => {
    const entries = [entry(1, 'a'.repeat(30)), entry(2, 'b'.repeat(30)), entry(3, 'c')];
    const r = fitWithinLimit('', entries, 30, 60);
    expect(r.used.map((e) => e.id)).toEqual(['id-1']);
    expect(r.dropped.map((e) => e.id)).toEqual(['id-2', 'id-3']);
    expect(r.oversized).toEqual([]);
  });

  it('過長以絕對上限判斷：只是這次放不下的條目照常停止，不算過長', () => {
    const entries = [entry(1, 'a'.repeat(40)), entry(2, 'b')];
    const r = fitWithinLimit('H', entries, 30, 30, 0, 1000);
    expect(r.used).toEqual([]);
    expect(r.oversized).toEqual([]);
    expect(r.dropped.map((e) => e.id)).toEqual(['id-1', 'id-2']);
  });

  it('單條就超過預算的條目跳過，後面的照常採用', () => {
    const entries = [entry(1, 'x'.repeat(100)), entry(2, 'short')];
    const r = fitWithinLimit('H', entries, 30, 50);
    expect(r.used.map((e) => e.id)).toEqual(['id-2']);
    expect(r.oversized.map((e) => e.id)).toEqual(['id-1']);
    expect(r.dropped.map((e) => e.id)).toEqual(['id-1']);
    expect(r.text).toBe('H' + SEPARATOR + formatEntry(entries[1]!));
  });
});
