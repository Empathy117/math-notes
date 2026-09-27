/**
 * MathLive implementation of the StructuredMathEditor interface.
 * This is the only file allowed to import from 'mathlive'.
 */
import { MathfieldElement, validateLatex } from 'mathlive';
import { fromEditorLatex, toEditorLatex } from './latex-shims';
import type {
  CreateEditorOptions,
  MathSelectionSnapshot,
  StructuredMathEditor,
  StructuredMathEditorEvents,
  StructuredMathEditorFactory,
  ValidationIssue,
} from './types';

export interface MathLiveGlobalConfig {
  /**
   * Where MathLive loads its fonts from. Pass `null` when the host imports
   * `mathlive/fonts.css` itself (Vite then bundles the font files).
   */
  fontsDirectory?: string | null;
}

let configured = false;

export function configureMathLive(cfg: MathLiveGlobalConfig = {}): void {
  if (configured) return;
  configured = true;
  MathfieldElement.fontsDirectory = cfg.fontsDirectory ?? null;
  MathfieldElement.soundsDirectory = null;
  MathfieldElement.keypressSound = null;
  MathfieldElement.plonkSound = null;
  MathfieldElement.keypressVibration = false;
}

/** The inline shortcuts that insert an operator whose limits MathLive would place wrongly (see latex-shims). */
const LIMIT_SHORTCUTS: Record<string, string> = {
  lim: String.raw`\lim\displaylimits_{#?\to#?}`,
  liminf: String.raw`\liminf\displaylimits_{#?}`,
  limsup: String.raw`\limsup\displaylimits_{#?}`,
  argmin: String.raw`\operatorname*{arg~min}\displaylimits_{#?}`,
  argmax: String.raw`\operatorname*{arg~max}\displaylimits_{#?}`,
  det: String.raw`\det\displaylimits`,
  max: String.raw`\max\displaylimits`,
  min: String.raw`\min\displaylimits`,
  gcd: String.raw`\gcd\displaylimits`,
};

/** A space the user types; `\;` is about as wide as a word space in the text around the formula. */
const SPACE = String.raw`\;`;

/**
 * Commands after which a typed space would only widen what TeX already spaces: relations, binary
 * operators, big operators and function names, opening fences, explicit spaces.
 */
const SPACED_COMMANDS = new Set(
  (
    'le leq ge geq ne neq approx equiv sim simeq cong propto doteq ll gg prec succ to gets mapsto ' +
    'rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow longrightarrow implies impliedby iff ' +
    'in notin ni subset subseteq supset supseteq subsetneq supsetneq mid parallel perp vdash models ' +
    'pm mp times div cdot circ ast star bullet oplus ominus otimes odot wedge vee land lor lnot neg cup cap setminus bmod ' +
    'sum prod coprod int iint iiint oint bigcup bigcap bigvee bigwedge bigoplus bigotimes ' +
    'lim liminf limsup max min sup inf det gcd Pr sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth ' +
    'log ln lg exp arg deg dim hom ker forall exists nexists nabla partial ' +
    'left langle lbrace lbrack lfloor lceil lvert lVert colon quad qquad displaylimits limits nolimits'
  ).split(' '),
);
/** Characters that end a spaced token (relations, operators, punctuation, opening fences, space commands). */
const SPACED_TRAILING = /(?:[=<>+\-*/,;:.!|([{]|\\[{|,:;! ])$/;
/** Keys that should not follow a space the user just typed: TeX spaces them itself, or they attach to the atom before. */
const ABSORBS_SPACE = new Set(['=', '<', '>', '+', '-', '*', '/', ',', ';', ':', '.', '!', '|', ')', ']', '}', '^', '_', "'"]);

function spacedAlready(prevLatex: string): boolean {
  const s = prevLatex.trim();
  if (s === '' || SPACED_TRAILING.test(s)) return true;
  if (/\\operatorname\*?\s*\{[^{}]*\}$/.test(s)) return true;
  const cmd = /\\([a-zA-Z]+)\*?$/.exec(s);
  return cmd !== null && SPACED_COMMANDS.has(cmd[1]!);
}

const SINGLE_ENVIRONMENT = /^\\begin\{([a-zA-Z]+\*?)\}[\s\S]*\\end\{\1\}$/;

/** The slice of MathLive's internal model `spaceGoesIn` reads. */
interface InternalModel {
  position: number;
  at(offset: number): { parent?: { type?: string; parent?: unknown } } | undefined;
}

type Handler<K extends keyof StructuredMathEditorEvents> = (e: StructuredMathEditorEvents[K]) => void;

export class MathLiveEditor implements StructuredMathEditor {
  readonly element: MathfieldElement;
  private readonly mf: MathfieldElement;
  private readonly handlers: { [K in keyof StructuredMathEditorEvents]: Set<Handler<K>> } = {
    change: new Set(),
    commit: new Set(),
    moveOut: new Set(),
    selectionChange: new Set(),
    copy: new Set(),
  };
  private readonly disposers: (() => void)[] = [];
  /** Caret offset right after a space the user typed, while the next key may still absorb it. */
  private spaceAt = -1;

  constructor(opts: CreateEditorOptions) {
    configureMathLive();
    const mf = new MathfieldElement();
    this.mf = mf;
    this.element = mf;
    const initial = toEditorLatex(opts.latex);

    // Options stored on the element are safe before it is connected.
    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.defaultMode = opts.display === 'block' ? 'math' : 'inline-math';
    mf.smartMode = false;
    mf.readOnly = Boolean(opts.readOnly);
    // The plain text MathLive copies: the formula as stored, without the editor-only rewrites
    // (`\displaylimits`, `\differentialD`, which KaTeX does not know) and without MathLive's `$$`
    // wrapper, so both editors copy bare LaTeX.
    mf.onExport = (_mf, latex) => fromEditorLatex(latex);
    mf.value = initial;
    // `menuItems`, `macros` and `inlineShortcuts` throw "Mathfield not mounted" until the element is connected.
    this.listen('mount', () => {
      mf.menuItems = [];
      mf.inlineShortcuts = { ...mf.inlineShortcuts, ...LIMIT_SHORTCUTS };
      if (opts.macros) mf.macros = { ...mf.macros, ...opts.macros };
      if (mf.getValue('latex') === '' && initial !== '') mf.setValue(initial, { silenceNotifications: true });
    });

    this.listen('input', () => this.emit('change', { latex: this.getValue() }));
    this.listen('change', () => this.emit('commit', { latex: this.getValue() }));
    this.listen('move-out', (ev) => this.emit('moveOut', { direction: ev.detail.direction }));
    this.listen('selection-change', () => this.emit('selectionChange', this.getSelection()));
    // Capture: runs before MathLive's own handler inside the shadow root.
    this.listen('keydown', (ev) => this.onKeyDown(ev), true);
    // Bubble: runs after MathLive's own handler has filled the clipboard.
    this.listen('copy', (ev) => this.onCopied(ev));
  }

  /** MathLive copied a selection of math (text-only selections carry no `application/x-latex`). */
  private onCopied(ev: ClipboardEvent): void {
    const data = ev.clipboardData;
    const latex = ev.defaultPrevented && data ? data.getData('application/x-latex') : '';
    if (data && latex) this.emit('copy', { latex: fromEditorLatex(latex), data });
  }

  private listen<K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (ev: HTMLElementEventMap[K]) => void,
    capture = false,
  ): void {
    this.mf.addEventListener(type, fn, capture);
    this.disposers.push(() => this.mf.removeEventListener(type, fn, capture));
  }

  private emit<K extends keyof StructuredMathEditorEvents>(event: K, payload: StructuredMathEditorEvents[K]): void {
    for (const h of this.handlers[event]) (h as Handler<K>)(payload);
  }

  /**
   * Space. MathLive's own space leaves the current branch (the exponent, the numerator) and does
   * nothing at the top level, which reads as "space is broken". Keep the branch exit, and at the
   * top level insert a visible space unless TeX already spaces the spot (after =, +, \sin …); a
   * space followed by such a key (x = 1) is taken back, so habitual spaces do not widen formulas.
   */
  private onKeyDown(ev: KeyboardEvent): void {
    const mf = this.mf;
    if (ev.isComposing || ev.metaKey || ev.ctrlKey || ev.altKey) {
      this.spaceAt = -1;
      return;
    }
    if (ev.key !== ' ') {
      if (this.spaceAt === mf.position && ABSORBS_SPACE.has(ev.key) && mf.getValue(mf.position - 1, mf.position, 'latex') === SPACE) {
        mf.executeCommand('deleteBackward');
      }
      this.spaceAt = -1;
      return;
    }
    this.spaceAt = -1;
    if (mf.mode !== 'math' || ev.shiftKey || !this.selectionCollapsed() || !this.spaceGoesIn()) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (spacedAlready(mf.getValue(Math.max(0, mf.position - 1), mf.position, 'latex'))) return;
    mf.insert(SPACE, { format: 'latex', insertionMode: 'replaceSelection', selectionMode: 'after' });
    this.spaceAt = mf.position;
    this.emit('change', { latex: this.getValue() });
  }

  private selectionCollapsed(): boolean {
    const r = this.mf.selection.ranges[0];
    return !r || r[0] === r[1];
  }

  /**
   * Where a space is typed in rather than stepping out: the top level, a row of a multi-line
   * environment (stepping out of the cell would leave the whole environment), the inside of
   * \left…\right. Exponents, fractions and roots keep MathLive's step-out.
   *
   * The atom tree is not public; this reads MathLive 0.110's internal model (the version is
   * pinned and the e2e suite covers it). Without it, only the top level is recognized: there
   * the two halves around the caret reassemble the formula (see MathSelectionSnapshot.whole).
   */
  private spaceGoesIn(): boolean {
    const model = (this.mf as unknown as { _mathfield?: { model?: InternalModel } })._mathfield?.model;
    if (model) {
      const parent = model.at(model.position)?.parent;
      return !parent?.parent || parent.type === 'array' || parent.type === 'leftright';
    }
    const mf = this.mf;
    const squash = (s: string) => s.replace(/\s+/g, '');
    const halves = mf.getValue(0, mf.position, 'latex') + mf.getValue(mf.position, mf.lastOffset, 'latex');
    return squash(halves) === squash(mf.getValue('latex'));
  }

  getValue(): string {
    return fromEditorLatex(this.mf.getValue('latex'));
  }

  setValue(latex: string, opts?: { silent?: boolean }): void {
    this.mf.setValue(toEditorLatex(latex), { silenceNotifications: Boolean(opts?.silent) });
  }

  getSelection(): MathSelectionSnapshot {
    const range = this.mf.selection.ranges[0] ?? [this.mf.position, this.mf.position];
    const start = Math.min(range[0], range[1]);
    const end = Math.max(range[0], range[1]);
    return {
      start,
      end,
      collapsed: start === end,
      latex: start === end ? '' : fromEditorLatex(this.mf.getValue(start, end, 'latex')),
      whole: this.getValue(),
    };
  }

  replaceSelection(latex: string): void {
    this.mf.insert(toEditorLatex(latex), { insertionMode: 'replaceSelection', format: 'latex', selectionMode: 'after' });
  }

  positionFromPoint(x: number, y: number): number {
    return this.mf.getOffsetFromPoint(x, y);
  }

  focusAt(position: number | 'start' | 'end'): void {
    this.ensureDomFocus();
    if (position === 'start') this.mf.position = 0;
    else if (position === 'end') this.mf.position = this.mf.lastOffset;
    else this.mf.position = Math.max(0, Math.min(position, this.mf.lastOffset));
  }

  /**
   * Add a row after the caret's row. Inside a multi-line environment (gathered, aligned, cases,
   * a matrix) that is MathLive's own `addRowAfter`. Elsewhere the caret first climbs out of the
   * branch it is in; at the top level MathLive would wrap everything in its `lines` root, which
   * serializes as \displaylines (unknown to KaTeX) and lays out left-aligned, so that root is
   * swapped for gathered, the caret keeping its place.
   */
  insertLineBreak(): boolean {
    const mf = this.mf;
    // At the very end of a formula that is one environment the caret sits after it; step into
    // the last cell so the row goes there instead of wrapping the environment once more.
    if (mf.position === mf.lastOffset && mf.lastOffset > 0 && SINGLE_ENVIRONMENT.test(mf.getValue('latex').trim())) {
      mf.position = mf.lastOffset - 1;
    }
    for (let guard = 0; guard < 32; guard++) {
      const before = mf.getValue('latex');
      mf.executeCommand('addRowAfter');
      const after = mf.getValue('latex');
      if (after !== before) {
        const lines = /^\s*\\displaylines\s*\{([\s\S]*)\}\s*$/.exec(after);
        if (lines) {
          // The gathered atom takes one more offset than the `lines` root it replaces (measured).
          const caret = mf.position + 1;
          mf.setValue(String.raw`\begin{gathered}${lines[1]}\end{gathered}`, { silenceNotifications: true });
          mf.position = caret;
        }
        this.emit('change', { latex: this.getValue() });
        return true;
      }
      if (!mf.executeCommand('moveAfterParent')) return false;
    }
    return false;
  }

  /**
   * MathLive's `focus()` is a no-op when its internal "focused" flag is already set,
   * which can leave the real DOM focus on <body> (observed in headless Chromium).
   * Fall back to focusing the keyboard sink inside the shadow root directly.
   */
  private ensureDomFocus(): void {
    this.mf.focus();
    if (document.activeElement === this.mf) return;
    const sink = this.mf.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink');
    sink?.focus({ preventScroll: true });
  }

  blur(): void {
    this.mf.blur();
  }

  /** Real DOM focus, not MathLive's internal flag (which can stay true after focus is lost). */
  hasFocus(): boolean {
    return document.activeElement === this.mf;
  }

  on<K extends keyof StructuredMathEditorEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers[event] as Set<Handler<K>>;
    set.add(handler);
    return () => set.delete(handler);
  }

  destroy(): void {
    for (const d of this.disposers.splice(0)) d();
    for (const key of Object.keys(this.handlers) as (keyof StructuredMathEditorEvents)[]) this.handlers[key].clear();
    this.mf.remove();
  }
}

export const mathLiveFactory: StructuredMathEditorFactory = {
  create: (opts) => new MathLiveEditor(opts),
  validate: (latex, macros): ValidationIssue[] =>
    validateLatex(latex, macros ? { macros } : undefined).map((e) => ({
      code: e.code,
      arg: e.arg,
      latex: e.latex,
      before: e.before,
      after: e.after,
    })),
};
