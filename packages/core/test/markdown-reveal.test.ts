import { describe, expect, it } from 'vitest';
import { Schema, type Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { markdownMarkers } from '../src/tiptap/markdown-reveal';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
    blockquote: { group: 'block', content: 'block+' },
    codeBlock: { group: 'block', content: 'text*', code: true, marks: '', attrs: { language: { default: null } } },
    text: { group: 'inline' },
  },
  marks: {
    link: { attrs: { href: {} }, inclusive: true },
    bold: {},
    italic: {},
    code: {},
    strike: {},
  },
});

const t = (s: string, ...marks: string[]) =>
  schema.text(
    s,
    marks.map((m) => (m.startsWith('link:') ? schema.marks['link']!.create({ href: m.slice(5) }) : schema.marks[m]!.create())),
  );
const p = (...c: PMNode[]) => schema.nodes['paragraph']!.create(null, c);
const h = (level: number, ...c: PMNode[]) => schema.nodes['heading']!.create({ level }, c);

/** Markers with the caret just after the first occurrence of `after` (or at `pos`). */
function markersAt(doc: PMNode, after: string | number) {
  let pos = typeof after === 'number' ? after : -1;
  if (typeof after === 'string') {
    doc.descendants((n, at) => {
      if (pos < 0 && n.isText && n.text!.includes(after)) pos = at + n.text!.indexOf(after) + after.length;
    });
  }
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
  return markdownMarkers(state).map((m) => [m.pos - pos, m.text, m.side]);
}

describe('markdownMarkers', () => {
  it("shows a heading's #s before its text while the caret is in it, and nothing in a plain paragraph", () => {
    const doc = schema.nodes['doc']!.create(null, [h(2, t('极限与积分')), p(t('正文'))]);
    expect(markersAt(doc, '极限')).toEqual([[-2, '## ', -3]]);
    expect(markersAt(doc, '正')).toEqual([]);
  });

  it('shows > for each quote around the block', () => {
    const quote = (...c: PMNode[]) => schema.nodes['blockquote']!.create(null, c);
    const doc = schema.nodes['doc']!.create(null, [quote(p(t('引用')), quote(h(3, t('深层'))))]);
    expect(markersAt(doc, '引')).toEqual([[-1, '> ', -3]]);
    expect(markersAt(doc, '深')).toEqual([[-1, '> > ### ', -3]]);
  });

  it('shows the delimiters of formatting the caret is in or right next to', () => {
    const doc = schema.nodes['doc']!.create(null, [p(t('它是'), t('最基本的', 'bold'), t('三角极限'))]);
    expect(markersAt(doc, '最基')).toEqual([
      [-2, '**', -1],
      [2, '**', 1],
    ]);
    expect(markersAt(doc, '最基本的')).toEqual([
      [-4, '**', -1],
      [0, '**', 1],
    ]);
    expect(markersAt(doc, '三角')).toEqual([]);
  });

  it('opens outer formatting first and closes it last', () => {
    const doc = schema.nodes['doc']!.create(null, [p(t('a', 'bold'), t('b', 'bold', 'italic'), t('c', 'bold'), t(' 看 '), t('链接', 'link:https://katex.org'))]);
    // At the paragraph start the italic b is not next to the caret.
    expect(markersAt(doc, 1).map(([, text]) => text)).toEqual(['**', '**']);
    expect(markersAt(doc, 'b').map(([at, text]) => [at, text])).toEqual([
      [-2, '**'],
      [-1, '*'],
      [0, '*'],
      [1, '**'],
    ]);
    expect(markersAt(doc, '链').map(([, text]) => text)).toEqual(['[', '](https://katex.org)']);
  });

  it("shows a code block's fences with its language", () => {
    const doc = schema.nodes['doc']!.create(null, [schema.nodes['codeBlock']!.create({ language: 'ts' }, [t('let x = 1')])]);
    expect(markersAt(doc, 'let')).toEqual([
      [-3, '```ts\n', -3],
      [6, '\n```', 3],
    ]);
  });
});
