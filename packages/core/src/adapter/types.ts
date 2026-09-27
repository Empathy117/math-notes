/**
 * Hard adapter boundary for the structural math editor (design doc D5).
 * Nothing outside `adapter/` may import MathLive types; the rest of the system
 * only knows this interface.
 */

export type MoveOutDirection = 'forward' | 'backward' | 'upward' | 'downward';

export interface MathSelectionSnapshot {
  start: number;
  end: number;
  collapsed: boolean;
  /** LaTeX of the selected sub-expression (compact serialization). */
  latex: string;
  /**
   * LaTeX of the whole formula. Note: the editor's offsets are a flattening of the
   * atom tree, so serializing the ranges before and after a selection does NOT
   * reassemble the formula when the selection sits inside a subscript, fraction or
   * other branch (verified with MathLive 0.110.0). Replacements must therefore be
   * applied with `replaceSelection`, never by string concatenation.
   */
  whole: string;
}

export interface StructuredMathEditorEvents {
  /** The user changed the value (fires on almost every keystroke; never for setValue with `silent`). */
  change: { latex: string };
  /** Enter pressed or the field lost focus. */
  commit: { latex: string };
  /** An arrow key or Tab had nowhere to go inside the field. */
  moveOut: { direction: MoveOutDirection };
  selectionChange: MathSelectionSnapshot;
  /**
   * The user copied (not cut) part or all of the formula: `latex` went to the clipboard as plain
   * text, in the stored form. `data` is the clipboard being written; more formats can be added to
   * it while the handler runs.
   */
  copy: { latex: string; data: DataTransfer };
}

/**
 * The editor a formula session mounts. The structural editor (MathLive) is the main
 * implementation; the text-mode source editor (D10) implements the same interface, so the
 * NodeView runs one session model for both.
 */
export interface StructuredMathEditor {
  /** The host element to mount wherever the NodeView wants it. */
  readonly element: HTMLElement;
  getValue(): string;
  setValue(latex: string, opts?: { silent?: boolean }): void;
  getSelection(): MathSelectionSnapshot;
  replaceSelection(latex: string): void;
  /** Model position closest to a client point (after the element is laid out). */
  positionFromPoint(x: number, y: number): number;
  focusAt(position: number | 'start' | 'end'): void;
  /**
   * Start a new line of the formula at the caret (block formulas), turning a one-line formula
   * into a multi-line one. False when there is no sensible place for a line break.
   */
  insertLineBreak(): boolean;
  blur(): void;
  hasFocus(): boolean;
  on<K extends keyof StructuredMathEditorEvents>(
    event: K,
    handler: (e: StructuredMathEditorEvents[K]) => void,
  ): () => void;
  destroy(): void;
}

export interface ValidationIssue {
  code: string;
  arg?: string;
  latex?: string;
  before?: string;
  after?: string;
}

export interface CreateEditorOptions {
  latex: string;
  display: 'inline' | 'block';
  macros?: Record<string, string>;
  readOnly?: boolean;
}

export interface StructuredMathEditorFactory {
  create(opts: CreateEditorOptions): StructuredMathEditor;
  validate(latex: string, macros?: Record<string, string>): ValidationIssue[];
}
