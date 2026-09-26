/**
 * Host side of the one-click conversion. The model points at a description by quoting it; the
 * host finds the quote in the block and checks it before anything is replaced. A quote that is
 * not in the text verbatim, that overlaps a formula or another span, or whose LaTeX the renderer
 * rejects, is dropped and its text stays as it is.
 */
import type { LatexCheck } from './retry';
import type { MathScanBlock, MathScanSpan } from './types';

export interface ScanBlock extends MathScanBlock {
  /** Text offsets [start, end) the conversion must not touch: the formulas shown as $…$. */
  protectedRanges?: [number, number][];
}

export interface LocatedSpan extends MathScanSpan {
  /** Offsets of the quote in its block's text. */
  start: number;
  end: number;
}

export type ScanRejectReason = 'unknown-block' | 'empty' | 'not-found' | 'overlap' | 'render';

export interface ScanRejection {
  span: MathScanSpan;
  reason: ScanRejectReason;
  message?: string;
}

const overlaps = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

export function locateScanSpans(
  blocks: ScanBlock[],
  spans: MathScanSpan[],
  check?: LatexCheck,
): { located: LocatedSpan[]; rejected: ScanRejection[] } {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const taken = new Map<string, [number, number][]>();
  const cursor = new Map<string, number>();
  const located: LocatedSpan[] = [];
  const rejected: ScanRejection[] = [];

  for (const span of spans) {
    const block = byId.get(span.block);
    if (!block) {
      rejected.push({ span, reason: 'unknown-block' });
      continue;
    }
    const quote = span.quote.trim();
    if (!quote || !span.latex.trim() || quote.includes('$')) {
      rejected.push({ span, reason: 'empty' });
      continue;
    }
    const busy = [...(block.protectedRanges ?? []), ...(taken.get(block.id) ?? [])];
    const free = (at: number): boolean => !busy.some((r) => overlaps(r, [at, at + quote.length]));
    // Spans come in reading order: look after the previous one first, then anywhere.
    const find = (from: number): number => {
      for (let at = block.text.indexOf(quote, from); at >= 0; at = block.text.indexOf(quote, at + 1)) {
        if (free(at)) return at;
      }
      return -1;
    };
    let start = find(cursor.get(block.id) ?? 0);
    if (start < 0) start = find(0);
    if (start < 0) {
      rejected.push({ span, reason: block.text.includes(quote) ? 'overlap' : 'not-found' });
      continue;
    }
    const verdict = check?.(span.latex);
    if (verdict && !verdict.ok) {
      rejected.push({ span, reason: 'render', message: verdict.message });
      continue;
    }
    const end = start + quote.length;
    taken.set(block.id, [...(taken.get(block.id) ?? []), [start, end]]);
    cursor.set(block.id, end);
    located.push({ ...span, quote, start, end });
  }

  const order = new Map(blocks.map((b, i) => [b.id, i]));
  located.sort((a, b) => order.get(a.block)! - order.get(b.block)! || a.start - b.start);
  return { located, rejected };
}

/**
 * Worth sending to the model: some Latin letter, digit or operator, or a word that spoken
 * Chinese math uses. A cheap filter; the model makes the real call.
 */
const MAY_HOLD_FORMULA =
  /[A-Za-z0-9=+\-*/^_<>()|√∑∫π∞≤≥≠±×÷²³]|平方|立方|次方|次幂|等于|分之|根号|加|减|乘|除以|积分|极限|导数|求和|大于|小于|趋于|趋向|绝对值|对数|正弦|余弦|正切|阶乘|倒数|开方|派/;

export function mayHoldFormula(text: string): boolean {
  return MAY_HOLD_FORMULA.test(text.replace(/\$[^$]*\$/g, ''));
}

/** Consecutive groups of blocks of at most `maxChars` text each (a longer block goes alone). */
export function chunkScanBlocks<T extends MathScanBlock>(blocks: T[], maxChars = 1500): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const b of blocks) {
    if (current.length && size + b.text.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(b);
    size += b.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
