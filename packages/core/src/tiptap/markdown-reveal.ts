/**
 * Typora-style Markdown syntax. The markers of what the caret is in are shown — `## ` before a
 * heading, `> ` in a quote, `**` around bold text, the fences of a code block — and hidden
 * everywhere else. The document keeps its structure; the markers are decorations.
 *
 * Deleting a marker works as in Typora. Backspace right after a heading's `## ` deletes the space,
 * leaving `##` as text in a paragraph; a space after the #s makes it a heading again (StarterKit's
 * heading input rule), so a heading's level is changed by editing its #s. Backspace right after an
 * opening `**` (or `*`, `~~`, `` ` ``, `[`) removes that formatting. Cmd/Ctrl+click opens a link.
 */
import { Extension } from '@tiptap/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface MarkdownMarker {
  pos: number;
  text: string;
  /** Order at `pos`: negative markers are drawn before the caret there, positive ones after it. */
  side: number;
  kind: 'block' | 'inline';
}

/** Markdown delimiters of the inline marks StarterKit has (underline has none; Typora writes HTML). */
const DELIMITERS: Record<string, (mark: Mark) => [string, string]> = {
  bold: () => ['**', '**'],
  italic: () => ['*', '*'],
  strike: () => ['~~', '~~'],
  code: () => ['`', '`'],
  underline: () => ['<u>', '</u>'],
  link: (m) => ['[', `](${String(m.attrs['href'] ?? '')})`],
};

interface MarkRange {
  mark: Mark;
  from: number;
  to: number;
}

/** The ranges of Markdown-able marks in a textblock whose content starts at `start`. */
function markRanges(block: PMNode, start: number): MarkRange[] {
  const done: MarkRange[] = [];
  let open: MarkRange[] = [];
  block.forEach((child, offset) => {
    const from = start + offset;
    const marks = child.marks.filter((m) => m.type.name in DELIMITERS);
    open = open.filter((r) => {
      if (r.mark.isInSet(marks)) return true;
      done.push(r);
      return false;
    });
    for (const mark of marks) {
      const r = open.find((o) => o.mark.eq(mark));
      if (r) r.to = from + child.nodeSize;
      else open.push({ mark, from, to: from + child.nodeSize });
    }
  });
  return [...done, ...open];
}

/** The markers to show for the current selection. */
export function markdownMarkers(state: EditorState): MarkdownMarker[] {
  const { selection } = state;
  const $head = selection.$head;
  const block = $head.parent;
  if (!block.isTextblock) return [];
  const start = $head.start();
  const end = $head.end();
  if (block.type.spec.code) {
    const lang = String(block.attrs['language'] ?? '');
    return [
      { pos: start, text: `\`\`\`${lang}\n`, side: -3, kind: 'block' },
      { pos: end, text: '\n```', side: 3, kind: 'block' },
    ];
  }
  const out: MarkdownMarker[] = [];
  let prefix = '';
  for (let d = 1; d < $head.depth; d++) if ($head.node(d).type.name === 'blockquote') prefix += '> ';
  if (block.type.name === 'heading') prefix += `${'#'.repeat(Number(block.attrs['level']) || 1)} `;
  if (prefix) out.push({ pos: start, text: prefix, side: -3, kind: 'block' });

  // Every mark range the selection touches; a caret right next to a range counts, as in Typora.
  const from = Math.max(selection.from, start);
  const to = Math.min(selection.to, end);
  const touched = markRanges(block, start).filter((r) => r.to >= from && r.from <= to);
  const delimiters = (r: MarkRange) => DELIMITERS[r.mark.type.name]!(r.mark);
  // Outer ranges open first and close last.
  for (const r of [...touched].sort((a, b) => a.from - b.from || b.to - a.to)) {
    out.push({ pos: r.from, text: delimiters(r)[0], side: -1, kind: 'inline' });
  }
  for (const r of [...touched].sort((a, b) => a.to - b.to || b.from - a.from)) {
    // Text typed at the end of an inclusive mark gets the mark: draw its closing marker after the caret.
    out.push({ pos: r.to, text: delimiters(r)[1], side: r.mark.type.spec.inclusive === false ? -2 : 1, kind: 'inline' });
  }
  return out;
}

function markerDom(m: MarkdownMarker): HTMLElement {
  const el = document.createElement('span');
  el.className = `mn-md-mark mn-md-${m.kind}`;
  el.textContent = m.text;
  return el;
}

/** Backspace right after a heading's `## `: the heading becomes a paragraph starting with its #s. */
function unheading(state: EditorState): Transaction | null {
  const { selection } = state;
  const $pos = selection.$from;
  const paragraph = state.schema.nodes['paragraph'];
  if (!selection.empty || $pos.parent.type.name !== 'heading' || $pos.parentOffset !== 0 || !paragraph) return null;
  const hashes = '#'.repeat(Number($pos.parent.attrs['level']) || 1);
  const tr = state.tr.setBlockType($pos.pos, $pos.pos, paragraph).insertText(hashes, $pos.pos);
  return tr.setSelection(TextSelection.create(tr.doc, $pos.pos + hashes.length));
}

/** Backspace right after an opening inline marker: the formatting it opens is removed. */
function unmark(state: EditorState): Transaction | null {
  const { selection } = state;
  const $pos = selection.$from;
  if (!selection.empty || !$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  const opening = markRanges($pos.parent, $pos.start()).filter((r) => r.from === $pos.pos);
  if (!opening.length) return null;
  const tr = state.tr;
  for (const r of opening) tr.removeMark(r.from, r.to, r.mark);
  return tr;
}

export const MarkdownReveal = Extension.create({
  name: 'markdownReveal',
  // Before the default Backspace, which would join the heading with the block above it.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor;
        // Right after an input rule, Backspace undoes it (Tiptap's own behaviour).
        if (this.editor.commands.undoInputRule()) return true;
        const tr = unheading(state) ?? unmark(state);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('markdownReveal'),
        props: {
          decorations(state) {
            const markers = markdownMarkers(state);
            if (!markers.length) return null;
            return DecorationSet.create(
              state.doc,
              markers.map((m) =>
                Decoration.widget(m.pos, () => markerDom(m), { side: m.side, marks: [], key: `${m.kind}${m.side}${m.text}` }),
              ),
            );
          },
          handleClick(view, pos, event) {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const link = view.state.doc.resolve(pos).marks().find((m) => m.type.name === 'link');
            const href = link ? String(link.attrs['href'] ?? '') : '';
            if (!href) return false;
            window.open(href, '_blank', 'noopener');
            return true;
          },
        },
      }),
    ];
  },
});
