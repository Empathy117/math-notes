/**
 * Tiptap nodes for inline and block math (design doc D2, D7).
 * Document nodes store only facts: id, latex. Everything else is derived elsewhere.
 */
import { InputRule, Node, mergeAttributes, type Editor, type Extensions } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { StructuredMathEditorFactory } from '../adapter/types';
import type { RenderResult } from '../render/katex';
import { sourceEditorFactory } from '../source/source-editor';
import { MathNodeView, type InlineEditMode, type LayoutMetrics, type MathEditorKind } from './math-node-view';

export interface MathExtensionOptions {
  factory: StructuredMathEditorFactory;
  render: (latex: string, display: 'inline' | 'block') => RenderResult;
  getInlineMode?: () => InlineEditMode;
  /** Which editor a click opens: the structural one (default) or the LaTeX source with a live preview. */
  getEditorKind?: () => MathEditorKind;
  /** The text-mode editor; defaults to the built-in source editor. */
  sourceFactory?: StructuredMathEditorFactory;
  macros?: () => Record<string, string> | undefined;
  onMetrics?: (m: LayoutMetrics) => void;
  HTMLAttributes?: Record<string, unknown>;
}

interface NodeOptions
  extends Required<Pick<MathExtensionOptions, 'factory' | 'render' | 'getInlineMode' | 'getEditorKind' | 'sourceFactory'>> {
  macros?: MathExtensionOptions['macros'];
  onMetrics?: MathExtensionOptions['onMetrics'];
  HTMLAttributes: Record<string, unknown>;
  registry: Map<string, MathNodeView>;
}

/** A text range to turn into a formula (the one-click conversion). */
export interface MathConversion {
  from: number;
  to: number;
  latex: string;
  /** 'block' replaces the whole top-level paragraph the range is in. */
  display: 'inline' | 'block';
  id?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      /** Insert a formula at the cursor. */
      insertMath: (attrs: { latex: string; display?: 'inline' | 'block'; id?: string }) => ReturnType;
      /** Insert an empty formula at the cursor and open it: the caret is in the formula box. */
      insertEmptyMath: (display?: 'inline' | 'block') => ReturnType;
      /** Replace the current text selection with a formula (R6). */
      replaceSelectionWithMath: (latex: string, display?: 'inline' | 'block') => ReturnType;
      /** Replace a document range with a formula (R6 when the selection may have moved since it was read). */
      replaceRangeWithMath: (range: { from: number; to: number }, latex: string, display?: 'inline' | 'block', id?: string) => ReturnType;
      /** Turn several text ranges into formulas in one transaction, so one undo restores the text. */
      convertRangesToMath: (items: MathConversion[]) => ReturnType;
      /** Set the LaTeX of the formula with this id (e.g. switching to another reading). */
      updateMath: (id: string, latex: string) => ReturnType;
      /** Open the editor on the formula with this id. */
      openMath: (id: string, caret?: 'start' | 'end') => ReturnType;
    };
  }
}

export const MATH_NODE_NAMES = ['mathInline', 'mathBlock'] as const;

export function newMathId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return `m${c.randomUUID().slice(0, 8)}`;
  return `m${Math.random().toString(36).slice(2, 10)}`;
}

function mathAttributes() {
  return {
    id: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-id'),
      renderHTML: (attrs: Record<string, unknown>) => (attrs['id'] ? { 'data-id': attrs['id'] } : {}),
    },
    latex: {
      default: '',
      parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '',
      renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': attrs['latex'] }),
    },
  };
}

/** Assign ids to math nodes that lack one or duplicate another (paste, initial content). */
function assignMissingIds(tr: Transaction): Transaction | null {
  const seen = new Set<string>();
  let changed = false;
  tr.doc.descendants((node, pos) => {
    if (!(MATH_NODE_NAMES as readonly string[]).includes(node.type.name)) return;
    const id = node.attrs['id'] as string | null;
    if (!id || seen.has(id)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: newMathId() });
      changed = true;
    } else {
      seen.add(id);
    }
  });
  return changed ? tr : null;
}

function ensureIdsPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey('mathEnsureIds'),
    appendTransaction(trs, _old, newState) {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = assignMissingIds(newState.tr);
      return tr ? tr.setMeta('addToHistory', false) : null;
    },
  });
}

function ensureIdsNow(view: EditorView): void {
  const tr = assignMissingIds(view.state.tr);
  if (tr) view.dispatch(tr.setMeta('addToHistory', false));
}

/** ArrowRight / ArrowLeft next to an inline formula enters it (Notion / RemNote behaviour). */
function enterAdjacent(editor: Editor, registry: Map<string, MathNodeView>, dir: 'forward' | 'backward'): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const $pos = selection.$from;
  const node = dir === 'forward' ? $pos.nodeAfter : $pos.nodeBefore;
  if (!node || node.type.name !== 'mathInline') return false;
  const view = registry.get(String(node.attrs['id']));
  if (!view) return false;
  view.open({ caret: dir === 'forward' ? 'start' : 'end' });
  return true;
}

/**
 * Shift+Arrow across an inline formula: extend the selection over the whole node in one
 * step. Left to the browser, the native extension can stall on the node's buffer
 * positions when keys arrive faster than ProseMirror re-syncs the DOM selection.
 */
function extendAcross(editor: Editor, dir: 'forward' | 'backward'): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return false;
  const $head = selection.$head;
  const next = dir === 'forward' ? $head.nodeAfter : $head.nodeBefore;
  const prev = dir === 'forward' ? $head.nodeBefore : $head.nodeAfter;
  let step: number;
  if (next?.type.name === 'mathInline') {
    step = next.nodeSize;
  } else if (prev?.type.name === 'mathInline' && next?.isText) {
    // The head sits on the node's edge, where the browser's native extension can stall
    // on the buffer positions; take the first text step ourselves.
    step = 1;
  } else {
    return false;
  }
  const head = dir === 'forward' ? $head.pos + step : $head.pos - step;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, selection.anchor, head)));
  return true;
}

function openSelectedNode(editor: Editor, registry: Map<string, MathNodeView>): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return false;
  if (!(MATH_NODE_NAMES as readonly string[]).includes(selection.node.type.name)) return false;
  const view = registry.get(String(selection.node.attrs['id']));
  if (!view) return false;
  view.open({ caret: 'end' });
  return true;
}

/**
 * Open a formula inserted empty by the transaction being dispatched. Its NodeView exists once
 * the dispatch is done, which is after the command or input rule returns.
 */
function openFresh(registry: Map<string, MathNodeView>, id: string): void {
  queueMicrotask(() => registry.get(id)?.open({ caret: 'end' }, { fresh: true }));
}

/**
 * `$…$` typed in text becomes an inline formula when the closing `$` is typed. As in pandoc, the
 * content must not start or end with a space; content with Han characters is left alone, so
 * prices in Chinese text ("$5，另一个$6") stay text.
 */
const DOLLAR_PAIR = /(?<![$\\])\$([^\s$](?:[^$]*[^\s$\\])?)\$$/;
const HAN = /\p{Script=Han}/u;

const MathInline = Node.create<NodeOptions>({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return mathAttributes();
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-math-inline': '' }),
      `$${String(node.attrs['latex'])}$`,
    ];
  },

  addNodeView() {
    return (props) =>
      new MathNodeView(props, {
        display: 'inline',
        getInlineMode: this.options.getInlineMode,
        getEditorKind: this.options.getEditorKind,
        factory: this.options.factory,
        sourceFactory: this.options.sourceFactory,
        render: this.options.render,
        macros: this.options.macros,
        registry: this.options.registry,
        onMetrics: this.options.onMetrics,
      });
  },

  addCommands() {
    return {
      insertMath:
        ({ latex, display = 'inline', id }) =>
        ({ commands }) =>
          commands.insertContent({
            type: display === 'block' ? 'mathBlock' : 'mathInline',
            attrs: { latex, id: id ?? newMathId() },
          }),
      insertEmptyMath:
        (display = 'inline') =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes[display === 'block' ? 'mathBlock' : 'mathInline'];
          // With a selection the insertion would delete text outside the undo history.
          if (!type || !state.selection.empty) return false;
          if (dispatch) {
            const id = newMathId();
            tr.replaceSelectionWith(type.create({ id, latex: '' }), false).setMeta('addToHistory', false);
            openFresh(this.options.registry, id);
          }
          return true;
        },
      replaceSelectionWithMath:
        (latex, display = 'inline') =>
        ({ state, commands }) =>
          commands.replaceRangeWithMath({ from: state.selection.from, to: state.selection.to }, latex, display),
      replaceRangeWithMath:
        ({ from, to }, latex, display = 'inline', id) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes[display === 'block' ? 'mathBlock' : 'mathInline'];
          if (!type || from < 0 || to > state.doc.content.size || from > to) return false;
          if (dispatch) {
            tr.replaceRangeWith(from, to, type.create({ latex, id: id ?? newMathId() }));
            // Caret right after the new formula, not a selection around it.
            tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(to)), 1));
          }
          return true;
        },
      convertRangesToMath:
        (items) =>
        ({ state, tr, dispatch }) => {
          const inline = state.schema.nodes['mathInline'];
          const block = state.schema.nodes['mathBlock'];
          if (!inline) return false;
          if (dispatch) {
            // From the end backwards, so the positions of the ranges still to do stay valid.
            for (const it of [...items].sort((a, b) => b.from - a.from)) {
              const id = it.id ?? newMathId();
              const $from = tr.doc.resolve(it.from);
              if (it.display === 'block' && block && $from.depth === 1 && $from.parent.type.name === 'paragraph') {
                tr.replaceWith($from.before(), $from.after(), block.create({ latex: it.latex, id }));
              } else {
                tr.replaceWith(it.from, it.to, inline.create({ latex: it.latex, id }));
              }
            }
          }
          return true;
        },
      updateMath:
        (id, latex) =>
        ({ state, tr, dispatch }) => {
          let at = -1;
          state.doc.descendants((node, pos) => {
            if (at >= 0) return false;
            if ((MATH_NODE_NAMES as readonly string[]).includes(node.type.name) && node.attrs['id'] === id) at = pos;
            return undefined;
          });
          if (at < 0) return false;
          const node = state.doc.nodeAt(at)!;
          if (dispatch) tr.setNodeMarkup(at, undefined, { ...node.attrs, latex });
          return true;
        },
      openMath:
        (id, caret) =>
        () => {
          const view = this.options.registry.get(id);
          if (!view) return false;
          view.open(caret ? { caret } : undefined);
          return true;
        },
    };
  },

  addInputRules() {
    const registry = this.options.registry;
    return [
      new InputRule({
        find: DOLLAR_PAIR,
        handler: ({ state, range, match }) => {
          const latex = match[1] ?? '';
          // An existing formula inside the match shows up as placeholder text: leave such runs alone.
          if (HAN.test(latex) || state.doc.textBetween(range.from, range.to) !== match[0].slice(0, -1)) return null;
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex, id: newMathId() }));
          return undefined;
        },
      }),
      // `$$` opens an empty formula box: block on an otherwise empty top-level line, inline elsewhere.
      new InputRule({
        find: /(?<![$\\])\$\$$/,
        handler: ({ state, range }) => {
          if (state.doc.textBetween(range.from, range.to) !== '$') return null;
          const $from = state.doc.resolve(range.from);
          const block = state.schema.nodes['mathBlock'];
          const id = newMathId();
          const { tr } = state;
          if (block && $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.textContent === '$') {
            tr.replaceWith($from.before(), $from.after(), block.create({ id, latex: '' }));
          } else {
            tr.replaceWith(range.from, range.to, this.type.create({ id, latex: '' }));
          }
          tr.setMeta('addToHistory', false);
          openFresh(registry, id);
          return undefined;
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      ArrowRight: () => enterAdjacent(this.editor, this.options.registry, 'forward'),
      ArrowLeft: () => enterAdjacent(this.editor, this.options.registry, 'backward'),
      'Shift-ArrowRight': () => extendAcross(this.editor, 'forward'),
      'Shift-ArrowLeft': () => extendAcross(this.editor, 'backward'),
      Enter: () => openSelectedNode(this.editor, this.options.registry),
    };
  },

  addProseMirrorPlugins() {
    return [ensureIdsPlugin()];
  },

  onCreate() {
    ensureIdsNow(this.editor.view);
  },
});

const MathBlock = Node.create<NodeOptions>({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return mathAttributes();
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-math-block': '' }),
      `$$${String(node.attrs['latex'])}$$`,
    ];
  },

  addNodeView() {
    return (props) =>
      new MathNodeView(props, {
        display: 'block',
        getInlineMode: this.options.getInlineMode,
        getEditorKind: this.options.getEditorKind,
        factory: this.options.factory,
        sourceFactory: this.options.sourceFactory,
        render: this.options.render,
        macros: this.options.macros,
        registry: this.options.registry,
        onMetrics: this.options.onMetrics,
      });
  },
});

/** Build the configured inline + block math extensions sharing one NodeView registry. */
export function mathExtensions(opts: MathExtensionOptions): Extensions {
  const registry = new Map<string, MathNodeView>();
  const shared: NodeOptions = {
    factory: opts.factory,
    render: opts.render,
    getInlineMode: opts.getInlineMode ?? (() => 'inplace'),
    getEditorKind: opts.getEditorKind ?? (() => 'structured'),
    sourceFactory: opts.sourceFactory ?? sourceEditorFactory,
    macros: opts.macros,
    onMetrics: opts.onMetrics,
    HTMLAttributes: opts.HTMLAttributes ?? {},
    registry,
  };
  return [MathInline.configure(shared), MathBlock.configure(shared)];
}

export { MathInline, MathBlock };
