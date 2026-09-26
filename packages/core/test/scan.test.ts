import { describe, expect, it } from 'vitest';
import { buildScanMessages } from '../src/ai/prompt';
import { ModelOutputError, parseMathScanResultText } from '../src/ai/result';
import type { LatexCheck } from '../src/ai/retry';
import { chunkScanBlocks, locateScanSpans, mayHoldFormula, type ScanBlock } from '../src/ai/scan';
import type { MathScanSpan } from '../src/ai/types';

const span = (block: string, quote: string, latex = 'x'): MathScanSpan => ({ block, quote, latex, interpretation: '' });

describe('parseMathScanResultText', () => {
  it('reads spans and normalizes their LaTeX', () => {
    const r = parseMathScanResultText(
      '```json\n{"spans":[{"block":"b1","quote":"x的平方","latex":"$x^{2}$","interpretation":"x 的平方"}]}\n```',
    );
    expect(r.spans).toEqual([{ block: 'b1', quote: 'x的平方', latex: 'x^{2}', interpretation: 'x 的平方' }]);
  });

  it('drops entries without a block, a quote or a formula', () => {
    const r = parseMathScanResultText(
      '{"spans":[{"id":"b0","quote":"a加b","latex":"a+b"},{"block":"b0","quote":"","latex":"x"},{"block":"b0","quote":"y","latex":""},"junk"]}',
    );
    expect(r.spans).toEqual([{ block: 'b0', quote: 'a加b', latex: 'a+b', interpretation: '' }]);
  });

  it('treats a missing list as nothing found, and text that is not JSON as unusable', () => {
    expect(parseMathScanResultText('{"spans":null}').spans).toEqual([]);
    expect(() => parseMathScanResultText('{"spans":[{"block":"b0","quote":"x')).toThrow(ModelOutputError);
    expect(() => parseMathScanResultText('x^2')).toThrow(ModelOutputError);
  });
});

describe('locateScanSpans', () => {
  const blocks: ScanBlock[] = [
    { id: 'b0', text: '求根公式 x等于2a分之负b加减根号下b的平方减4ac，其中 b的平方减4ac 叫判别式。' },
    { id: 'b1', text: '由 $x^2$ 可知 x^2 非负。', protectedRanges: [[2, 7]] },
  ];

  it('finds quotes in reading order, also when they repeat inside an earlier one', () => {
    const { located, rejected } = locateScanSpans(blocks, [
      span('b0', 'x等于2a分之负b加减根号下b的平方减4ac'),
      span('b0', ' b的平方减4ac '),
    ]);
    expect(rejected).toEqual([]);
    expect(located.map((l) => blocks[0]!.text.slice(l.start, l.end))).toEqual(['x等于2a分之负b加减根号下b的平方减4ac', 'b的平方减4ac']);
    expect(located[1]!.start).toBe(blocks[0]!.text.lastIndexOf('b的平方减4ac'));
  });

  it('never touches a formula already in the note', () => {
    const { located } = locateScanSpans(blocks, [span('b1', 'x^2')]);
    expect(located).toHaveLength(1);
    expect(located[0]!.start).toBe(blocks[1]!.text.indexOf('可知') + 3);
    expect(locateScanSpans(blocks, [span('b1', '$x^2$')]).rejected[0]!.reason).toBe('empty');
    expect(locateScanSpans([{ id: 'b', text: '$x^2$', protectedRanges: [[0, 5]] }], [span('b', 'x^2')]).rejected[0]!.reason).toBe('overlap');
  });

  it('rejects paraphrased quotes, unknown blocks and formulas the renderer rejects', () => {
    const check: LatexCheck = (l) => (l.includes('\\bad') ? { ok: false, message: 'Undefined control sequence' } : { ok: true });
    const { located, rejected } = locateScanSpans(
      blocks,
      [span('b0', 'x 等于 2a 分之负 b'), span('b9', 'x'), span('b0', '判别式', '\\bad'), span('b0', '叫判别式', 'D')],
      check,
    );
    expect(rejected.map((r) => r.reason)).toEqual(['not-found', 'unknown-block', 'render']);
    expect(located.map((l) => l.quote)).toEqual(['叫判别式']);
  });

  it('does not let two spans claim the same text', () => {
    const { located, rejected } = locateScanSpans(blocks, [span('b0', '判别式'), span('b0', '判别式')]);
    expect(located).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('overlap');
  });
});

describe('scan helpers', () => {
  it('sends only text that may hold a formula', () => {
    expect(mayHoldFormula('x的平方加1')).toBe(true);
    expect(mayHoldFormula('三分之二加上五分之一')).toBe(true);
    expect(mayHoldFormula('今天把这一章看完。')).toBe(false);
    expect(mayHoldFormula('只有排好的公式 $x^2$。')).toBe(false);
  });

  it('chunks blocks by text size, keeping order', () => {
    const b = (id: string, n: number) => ({ id, text: 'x'.repeat(n) });
    expect(chunkScanBlocks([b('a', 600), b('b', 600), b('c', 600), b('d', 2000)], 1500).map((c) => c.map((x) => x.id))).toEqual([
      ['a', 'b'],
      ['c'],
      ['d'],
    ]);
  });

  it("has a few-shot whose quotes are verbatim in its own input", () => {
    const [, example, answer] = buildScanMessages({ kind: 'scan', blocks: [] });
    const input = JSON.parse(example!.content) as { blocks: { id: string; text: string }[] };
    const { located, rejected } = locateScanSpans(input.blocks, parseMathScanResultText(answer!.content).spans);
    expect(rejected).toEqual([]);
    expect(located).toHaveLength(4);
  });
});
