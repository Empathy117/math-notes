import { describe, expect, it } from 'vitest';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { clipboardText } from '../src/tiptap/math-node';
import { unwrapDelimited } from '../src/source/source-editor';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    // Tiptap's HardBreak serializes as a newline through `renderText`, which Tiptap stores as `toText`.
    hardBreak: { group: 'inline', inline: true, toText: () => '\n' },
    mathInline: { group: 'inline', inline: true, atom: true, attrs: { latex: { default: '' }, id: { default: null } } },
    mathBlock: { group: 'block', atom: true, attrs: { latex: { default: '' }, id: { default: null } } },
  },
});

const t = (s: string) => schema.text(s);
const p = (...c: PMNode[]) => schema.nodes['paragraph']!.create(null, c);
const mi = (latex: string) => schema.nodes['mathInline']!.create({ latex });
const mb = (latex: string) => schema.nodes['mathBlock']!.create({ latex });
const br = () => schema.nodes['hardBreak']!.create();
const doc = (...c: PMNode[]) => schema.nodes['doc']!.create(null, c);

/** The plain text a copy of [from, to) gets, the slice taken as ProseMirror takes a selection's. */
function copied(d: PMNode, from = 0, to = d.content.size): string {
  return clipboardText(d.slice(from, to, true), schema);
}

describe('clipboardText', () => {
  it('writes inline formulas as $…$ within the text', () => {
    expect(copied(doc(p(t('考虑极限 '), mi('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'), t('，它是'))))).toBe(
      '考虑极限 $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$，它是',
    );
  });

  it('writes a block formula between $$ lines, paragraphs apart', () => {
    expect(copied(doc(p(t('a')), mb('\\int_0^1 x \\, dx'), p(t('b'))))).toBe('a\n\n$$\n\\int_0^1 x \\, dx\n$$\n\nb');
  });

  it('keeps the lines of a multi-line formula', () => {
    const latex = '\\begin{gathered}\nx = 1 \\\\\ny = 2\n\\end{gathered}';
    expect(copied(doc(mb(latex)))).toBe(`$$\n${latex}\n$$`);
  });

  it('copies only the selected part, a formula in it whole', () => {
    const d = doc(p(t('abc '), mi('x^2'), t(' def')));
    // From after "a" to after "d".
    expect(copied(d, 2, 1 + 4 + 1 + 2)).toBe('bc $x^2$ d');
  });

  it('drops empty formulas and keeps what other nodes serialize to', () => {
    expect(copied(doc(p(t('a'), mi(' '), t('b'), br(), t('c'))))).toBe('ab\nc');
  });
});

describe('unwrapDelimited', () => {
  it('takes the LaTeX out of one delimited formula', () => {
    expect(unwrapDelimited('$x^2$')).toBe('x^2');
    expect(unwrapDelimited('  $$\n\\int_0^1 x \\, dx\n$$ ')).toBe('\\int_0^1 x \\, dx');
    expect(unwrapDelimited('\\(a+b\\)')).toBe('a+b');
    expect(unwrapDelimited('\\[\\frac{a}{b}\\]')).toBe('\\frac{a}{b}');
    expect(unwrapDelimited('$\\$5 + x$')).toBe('\\$5 + x');
  });

  it('leaves everything else alone', () => {
    for (const s of ['x^2', '\\frac{a}{b}', '$a$ and $b$', '\\(a\\) and \\(b\\)', '$$a$b$$', '$a', '$$', '$ $', '价格 $5']) {
      expect(unwrapDelimited(s), s).toBeNull();
    }
  });
});
