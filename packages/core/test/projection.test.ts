import { describe, expect, it } from 'vitest';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import type { MathScanRequest } from '../src/ai/types';
import { findFormulaDescriptions, projectTextblocks, textRange } from '../src/tiptap/scan';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    codeBlock: { group: 'block', content: 'text*', code: true },
    listItem: { content: 'paragraph block*' },
    bulletList: { group: 'block', content: 'listItem+' },
    mathBlock: { group: 'block', atom: true, attrs: { id: { default: null }, latex: { default: '' } } },
    text: { group: 'inline' },
    mathInline: { group: 'inline', inline: true, atom: true, attrs: { id: { default: null }, latex: { default: '' } } },
    hardBreak: { group: 'inline', inline: true },
  },
});

const t = (s: string) => schema.text(s);
const m = (latex: string) => schema.nodes['mathInline']!.create({ latex });
const p = (...c: PMNode[]) => schema.nodes['paragraph']!.create(null, c);

const doc = schema.nodes['doc']!.create(null, [
  schema.nodes['heading']!.create(null, [t('第一章')]),
  p(t('设 '), m('x^2'), t(' 则 x的平方加1 大于 0')),
  schema.nodes['codeBlock']!.create(null, [t('x^2 + 1')]),
  schema.nodes['mathBlock']!.create({ latex: 'a' }),
  p(t('sin x的平方加cos x的平方等于1')),
  schema.nodes['bulletList']!.create(null, [schema.nodes['listItem']!.create(null, [p(t('a加b'))])]),
  p(t('上一行'), schema.nodes['hardBreak']!.create(), t('下一行')),
]);

describe('projectTextblocks', () => {
  const blocks = projectTextblocks(doc);

  it('shows formulas as $…$ and skips code blocks', () => {
    expect(blocks.map((b) => b.text)).toEqual(['第一章', '设 $x^2$ 则 x的平方加1 大于 0', 'sin x的平方加cos x的平方等于1', 'a加b', '上一行\n下一行']);
    expect(blocks[1]!.protectedRanges).toEqual([[2, 7]]);
  });

  it('maps every text offset back to the document', () => {
    const b = blocks[1]!;
    const start = b.text.indexOf('x的平方加1');
    const r = textRange(b, start, start + 'x的平方加1'.length)!;
    expect(doc.textBetween(r.from, r.to)).toBe('x的平方加1');
    expect(textRange(b, 0, 5)).toBeNull();
    expect(textRange(blocks[4]!, 2, 5)).toBeNull();
  });

  it('protects inline code like a formula', () => {
    const codeSchema = new Schema({
      nodes: schema.spec.nodes,
      marks: { code: { code: true } },
    });
    const d = codeSchema.nodes['doc']!.create(null, [
      codeSchema.nodes['paragraph']!.create(null, [codeSchema.text('写作 '), codeSchema.text('x^2', [codeSchema.marks['code']!.create()]), codeSchema.text(' 即 x^2')]),
    ]);
    const [b] = projectTextblocks(d);
    expect(b!.text).toBe('写作 `x^2` 即 x^2');
    expect(b!.protectedRanges).toEqual([[3, 8]]);
  });

  it('marks only top-level text paragraphs as able to become a block formula', () => {
    expect(blocks.map((b) => b.plainParagraph)).toEqual([false, false, true, false, false]);
  });
});

describe('projectTextblocks with a range (a selection)', () => {
  const para = (start: string) => {
    let at = -1;
    doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === 'paragraph' && n.textContent.startsWith(start)) at = pos;
      return at < 0;
    });
    return { pos: at, node: doc.nodeAt(at)! };
  };

  it('keeps only the selected part of a block, which then cannot become a block formula', () => {
    const { pos } = para('sin');
    const from = pos + 1 + 'sin x的平方加'.length;
    const [b, ...rest] = projectTextblocks(doc, { from, to: from + 'cos x的平方'.length });
    expect(rest).toEqual([]);
    expect(b!.text).toBe('cos x的平方');
    expect(b!.plainParagraph).toBe(false);
    expect(doc.textBetween(textRange(b!, 0, 3)!.from, textRange(b!, 0, 3)!.to)).toBe('cos');
  });

  it('takes whole blocks across the range, with the formulas that lie inside it', () => {
    const first = para('设');
    const last = para('sin');
    const blocks = projectTextblocks(doc, { from: first.pos + 2, to: last.pos + last.node.nodeSize });
    expect(blocks.map((b) => b.text)).toEqual([' $x^2$ 则 x的平方加1 大于 0', 'sin x的平方加cos x的平方等于1']);
    expect(blocks[0]!.protectedRanges).toEqual([[1, 6]]);
    expect(blocks.map((b) => b.plainParagraph)).toEqual([false, true]);
  });
});

/** The document range of the first occurrence of `s` inside one text node. */
function rangeOf(s: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  doc.descendants((n, pos) => {
    const at = n.isText ? n.text!.indexOf(s) : -1;
    if (!found && at >= 0) found = { from: pos + at, to: pos + at + s.length };
  });
  if (!found) throw new Error(`no ${s}`);
  return found;
}

describe('findFormulaDescriptions', () => {
  it('with a range, converts only quotes from the text inside it', async () => {
    const outcome = await findFormulaDescriptions(
      doc,
      async (req) => ({
        spans: req.blocks.flatMap((b) => [
          { block: b.id, quote: 'x的平方加1', latex: 'x^2+1', interpretation: '' },
          { block: b.id, quote: '大于 0', latex: '>0', interpretation: '' },
        ]),
      }),
      () => ({ ok: true }),
      { range: rangeOf('x的平方加1') },
    );
    expect(outcome.found.map((f) => [doc.textBetween(f.from, f.to), f.display])).toEqual([['x的平方加1', 'inline']]);
    expect(outcome.rejected.map((r) => r.reason)).toEqual(['not-found']);
  });

  it('turns located quotes into ranges, a whole-paragraph description into a block formula', async () => {
    const seen: MathScanRequest[] = [];
    const outcome = await findFormulaDescriptions(
      doc,
      async (req) => {
        seen.push(req);
        const id = (text: string) => req.blocks.find((b) => b.text.startsWith(text))!.id;
        return {
          spans: [
            { block: id('设'), quote: 'x的平方加1 大于 0', latex: 'x^2+1>0', interpretation: '' },
            { block: id('sin'), quote: 'sin x的平方加cos x的平方等于1', latex: '\\sin^2 x+\\cos^2 x=1', interpretation: '' },
            { block: id('a加b'), quote: 'a加b', latex: 'a+b', interpretation: '' },
            { block: id('设'), quote: 'x^2', latex: 'x^2', interpretation: '' },
          ],
        };
      },
      () => ({ ok: true }),
    );
    expect(seen).toHaveLength(1);
    // 第一章 and the line-break paragraph hold nothing that looks like math.
    expect(seen[0]!.blocks.map((b) => b.text)).not.toContain('第一章');
    expect(outcome.found.map((f) => [doc.textBetween(f.from, f.to), f.display])).toEqual([
      ['x的平方加1 大于 0', 'inline'],
      ['sin x的平方加cos x的平方等于1', 'block'],
      ['a加b', 'inline'],
    ]);
    expect(outcome.rejected.map((r) => r.reason)).toEqual(['overlap']);
  });
});
