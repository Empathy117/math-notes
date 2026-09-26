/**
 * AI layer contract (design doc D6, D8). The component never talks to a vendor
 * directly: the host injects a MathResolver.
 */

export type MathStatus = 'ok' | 'ambiguous' | 'unsupported' | 'not_math';
export type Confidence = 'high' | 'medium' | 'low';

export interface MathAlternative {
  latex: string;
  interpretation: string;
}

export interface MathContext {
  /** Text around the caret, taken from the AI document projection. */
  surroundingText?: string;
  /** Notation already used on the page, e.g. "\\mathrm{d}", "\\vec". */
  notation?: string[];
  /** Document-level macro table. */
  macros?: Record<string, string>;
  /** Summary of supported features, so the model can declare what it needs. */
  capabilities?: string[];
  locale?: 'zh-CN' | 'en';
}

export interface MathGenerateRequest {
  /** 'generate' comes from the input box, 'convert' from selected note text. */
  kind: 'generate' | 'convert';
  input: string;
  context?: MathContext;
  /**
   * Set on the sync gate's one retry: the previous answer's LaTeX and why the renderer rejected
   * it, or an empty `latex` and why the answer itself was unusable (cut off, broken JSON).
   */
  retry?: { latex: string; message: string; position?: number };
}

export interface MathEditRequest {
  kind: 'edit';
  instruction: string;
  /** The whole formula, for context only. */
  fullLatex: string;
  /** The selected sub-expression. The model rewrites exactly this and nothing else. */
  selectionLatex: string;
  context?: MathContext;
}

export interface MathResult {
  status: MathStatus;
  /** One-sentence restatement of the understood meaning, in the user's language. */
  interpretation: string;
  /** Bare LaTeX, no delimiters. Empty when status is unsupported or not_math. */
  latex: string;
  /**
   * Other readings of the input, each a different meaning. Non-empty exactly when status is
   * 'ambiguous'; the host offers them in the chip (D6).
   */
  alternatives: MathAlternative[];
  /** The same formula in other notations (\mathbf{a} for \vec{a}, f'(x) for df/dx). Never a different meaning. */
  notations: MathAlternative[];
  /** Features or packages the formula needs (e.g. "tikz-cd", "physics"); a hint only. */
  features: string[];
  confidence: Confidence;
  consistency: { kind: 'numeric' | 'none'; expected?: string };
  notes?: string;
  /** The vendor payload, kept for logging. */
  raw?: unknown;
}

export interface MathEditResult {
  status: 'ok' | 'unsupported' | 'unclear';
  /**
   * Replaces only the selected fragment. The host applies it through the structural
   * editor's `replaceSelection`, which keeps the surrounding structure intact; it never
   * splices strings (see MathSelectionSnapshot.whole for why).
   */
  replacementLatex: string;
  interpretation?: string;
  confidence: Confidence;
  raw?: unknown;
}

export interface MathScanBlock {
  id: string;
  /** The block's text; formulas already in the note appear as $…$. */
  text: string;
}

/** One-click conversion: find the formula descriptions in note text (design doc D13 projection). */
export interface MathScanRequest {
  kind: 'scan';
  blocks: MathScanBlock[];
  context?: MathContext;
}

export interface MathScanSpan {
  /** Id of the block the description is in. */
  block: string;
  /**
   * The description, copied verbatim from the block text. The host finds it by this quote and
   * replaces nothing else, so the model cannot change the text around it (D13).
   */
  quote: string;
  latex: string;
  interpretation: string;
}

export interface MathScanResult {
  spans: MathScanSpan[];
  raw?: unknown;
}

export interface MathResolver {
  resolve(req: MathGenerateRequest, opts?: { signal?: AbortSignal }): Promise<MathResult>;
  edit(req: MathEditRequest, opts?: { signal?: AbortSignal }): Promise<MathEditResult>;
  /** Optional: a host without it offers no one-click conversion. */
  scan?(req: MathScanRequest, opts?: { signal?: AbortSignal }): Promise<MathScanResult>;
}
