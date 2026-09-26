/**
 * Text-mode editor for one formula (design doc R4, D10): the LaTeX source in a plain input
 * (inline) or textarea (block). It implements the structural editor's interface, so the NodeView
 * runs the same session for both; the NodeView adds the live-rendered preview.
 *
 * Keys match the structural editor: an arrow key at the edge of the source leaves the formula
 * (`moveOut`), Enter in a block formula starts a new formula line (`insertLineBreak`).
 */
import type {
  CreateEditorOptions,
  MathSelectionSnapshot,
  StructuredMathEditor,
  StructuredMathEditorEvents,
  StructuredMathEditorFactory,
} from '../adapter/types';

type Handler<K extends keyof StructuredMathEditorEvents> = (e: StructuredMathEditorEvents[K]) => void;

/** Han characters and fullwidth forms take two columns in a monospace font. */
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/g;

export class SourceMathEditor implements StructuredMathEditor {
  readonly element: HTMLElement;
  private readonly field: HTMLInputElement | HTMLTextAreaElement;
  private readonly block: boolean;
  private readonly handlers: { [K in keyof StructuredMathEditorEvents]: Set<Handler<K>> } = {
    change: new Set(),
    commit: new Set(),
    moveOut: new Set(),
    selectionChange: new Set(),
  };

  constructor(opts: CreateEditorOptions) {
    this.block = opts.display === 'block';
    const wrap = document.createElement(this.block ? 'div' : 'span');
    wrap.className = `mn-source mn-source-${this.block ? 'block' : 'inline'}`;
    let field: HTMLInputElement | HTMLTextAreaElement;
    if (this.block) {
      field = document.createElement('textarea');
      field.wrap = 'off';
    } else {
      field = document.createElement('input');
      field.type = 'text';
    }
    field.className = 'mn-source-field';
    field.value = opts.latex;
    field.readOnly = Boolean(opts.readOnly);
    field.spellcheck = false;
    field.setAttribute('autocomplete', 'off');
    field.setAttribute('autocapitalize', 'off');
    field.setAttribute('autocorrect', 'off');
    field.setAttribute('aria-label', this.block ? '块级公式的 LaTeX 源码' : '行内公式的 LaTeX 源码');
    const el: HTMLElement = field;
    el.addEventListener('input', this.onInput);
    el.addEventListener('keydown', this.onKeyDown);
    if (this.block) {
      wrap.appendChild(field);
    } else {
      wrap.append(delimiter(), field, delimiter());
    }
    this.field = field;
    this.element = wrap;
    this.autosize();
  }

  private readonly onInput = (): void => {
    this.autosize();
    this.emit('change', { latex: this.field.value });
  };

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.isComposing || ev.defaultPrevented || ev.shiftKey || ev.altKey || ev.metaKey || ev.ctrlKey) return;
    const f = this.field;
    const start = f.selectionStart ?? 0;
    const end = f.selectionEnd ?? start;
    if (start !== end) return;
    const v = f.value;
    const direction =
      ev.key === 'ArrowLeft' && start === 0
        ? 'backward'
        : ev.key === 'ArrowRight' && end === v.length
          ? 'forward'
          : ev.key === 'ArrowUp' && !v.slice(0, start).includes('\n')
            ? 'upward'
            : ev.key === 'ArrowDown' && !v.slice(end).includes('\n')
              ? 'downward'
              : null;
    if (direction) this.emit('moveOut', { direction });
  };

  private emit<K extends keyof StructuredMathEditorEvents>(event: K, payload: StructuredMathEditorEvents[K]): void {
    for (const h of this.handlers[event]) (h as Handler<K>)(payload);
  }

  /** Size the field to its content: no measuring needed with a monospace font. */
  private autosize(): void {
    const v = this.field.value;
    if (this.field instanceof HTMLTextAreaElement) {
      this.field.rows = Math.max(1, v.split('\n').length);
    } else {
      const columns = v.length + (v.match(WIDE)?.length ?? 0);
      this.field.style.width = `${Math.max(2, columns + 1)}ch`;
    }
  }

  getValue(): string {
    return this.field.value;
  }

  setValue(latex: string, opts?: { silent?: boolean }): void {
    this.field.value = latex;
    this.autosize();
    if (!opts?.silent) this.emit('change', { latex });
  }

  getSelection(): MathSelectionSnapshot {
    const v = this.field.value;
    const start = this.field.selectionStart ?? v.length;
    const end = this.field.selectionEnd ?? start;
    return { start, end, collapsed: start === end, latex: v.slice(start, end), whole: v };
  }

  replaceSelection(latex: string): void {
    const { start, end } = this.getSelection();
    this.field.setRangeText(latex, start, end, 'end');
    this.onInput();
  }

  /** Rendered math does not map back to source offsets: put the caret at the end. */
  positionFromPoint(): number {
    return this.field.value.length;
  }

  focusAt(position: number | 'start' | 'end'): void {
    this.field.focus({ preventScroll: true });
    const n = this.field.value.length;
    const p = position === 'start' ? 0 : position === 'end' ? n : Math.max(0, Math.min(position, n));
    this.field.setSelectionRange(p, p);
  }

  /**
   * A new formula line: `\\` plus a newline, the source keeping one line per formula line. A
   * source that is not in an environment yet is wrapped in gathered, the TeX-standard way to
   * stack centered lines (a bare `\\` is ignored in display math by LaTeX).
   */
  insertLineBreak(): boolean {
    if (!this.block || this.field.readOnly) return false;
    const f = this.field;
    const v = f.value;
    const start = f.selectionStart ?? v.length;
    const end = f.selectionEnd ?? start;
    const br = ' \\\\\n';
    let next: string;
    let caret: number;
    if (/\\begin\s*\{/.test(v)) {
      next = v.slice(0, start).trimEnd() + br + v.slice(end).trimStart();
      caret = v.slice(0, start).trimEnd().length + br.length;
    } else {
      const open = '\\begin{gathered}\n';
      const head = v.slice(0, start).trim();
      next = `${open}${head}${br}${v.slice(end).trim()}\n\\end{gathered}`;
      caret = open.length + head.length + br.length;
    }
    f.value = next;
    f.setSelectionRange(caret, caret);
    this.onInput();
    return true;
  }

  blur(): void {
    this.field.blur();
  }

  hasFocus(): boolean {
    return document.activeElement === this.field;
  }

  on<K extends keyof StructuredMathEditorEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers[event] as Set<Handler<K>>;
    set.add(handler);
    return () => set.delete(handler);
  }

  destroy(): void {
    const el: HTMLElement = this.field;
    el.removeEventListener('input', this.onInput);
    el.removeEventListener('keydown', this.onKeyDown);
    for (const key of Object.keys(this.handlers) as (keyof StructuredMathEditorEvents)[]) this.handlers[key].clear();
    this.element.remove();
  }
}

function delimiter(): HTMLElement {
  const d = document.createElement('span');
  d.className = 'mn-source-delim';
  d.textContent = '$';
  d.setAttribute('aria-hidden', 'true');
  return d;
}

export const sourceEditorFactory: StructuredMathEditorFactory = {
  create: (opts) => new SourceMathEditor(opts),
  // Syntax is judged by the renderer the preview uses.
  validate: () => [],
};
