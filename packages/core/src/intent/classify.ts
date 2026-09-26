/**
 * Input intent classifier (design doc D6, spike S0).
 *
 * Decides whether a piece of user input is *literal LaTeX* that can be inserted
 * directly, or informal math / natural language that must go through the AI.
 * The question is never "can KaTeX parse this" (it parses `sin x` as four
 * variables) but "are we highly confident the user typed LaTeX on purpose".
 *
 * Asymmetric costs drive the rules: a false `direct` silently inserts the wrong
 * formula, a false `ai` only costs one model call. When in doubt, go `ai`.
 */

export type IntentKind =
  | 'empty'
  | 'source-mode'
  | 'explicit-latex'
  | 'restricted-expression'
  | 'gray'
  | 'natural-language';

export type IntentDecision = 'direct' | 'ai' | 'none';

export interface IntentResult {
  kind: IntentKind;
  decision: IntentDecision;
  /** LaTeX to insert when `decision === 'direct'` (delimiters stripped). */
  latex?: string;
  /** Display hint derived from delimiters or environments. */
  display?: 'inline' | 'block';
  /** Machine-readable reasons, for logs and for the "可能是不精准公式" hint. */
  reasons: string[];
}

export interface ClassifyOptions {
  /** The user is typing in source mode: everything is literal. */
  sourceMode?: boolean;
  /** Extra two-letter words that mark informal input (merged with the built-in list). */
  extraKeywords?: string[];
}

/** Two-letter runs are allowed in restricted expressions (ab, dx, ij) unless they are one of these. */
const INFORMAL_TWO_LETTER = new Set([
  'pi', 'ln', 'lg', 'to', 'of', 'or', 'in', 'on', 'at', 'is', 'by', 'be', 'if', 'as', 'an',
]);

/** Characters a restricted (backslash-free) expression may contain. */
const RESTRICTED_CHARS = /^[A-Za-z0-9+\-/=^_{}()[\].,<>|!':;\s]*$/;

const SHORTHAND: { re: RegExp; reason: string }[] = [
  { re: /->|=>|<-|<=>/, reason: 'shorthand-arrow' },
  { re: /<=|>=|!=|==/, reason: 'shorthand-relation' },
  { re: /\*/, reason: 'asterisk-product' },
];

/** Han characters, CJK punctuation and fullwidth forms. */
const CJK = /\p{Script=Han}|[　-〿＀-￯]/u;

/** Greek, letterlike symbols, arrows, math operators, misc technical, super/subscripts, ×÷∞ and friends. */
const UNICODE_MATH =
  /[Ͱ-Ͽ⁰-₟℀-⅏←-⇿∀-⋿⌀-⏿■-◿²³¹¼-¾×÷]/;

/** A backslash followed by a letter, or a backslash escape such as `\{`, `\,`, `\\`. */
const BACKSLASH_COMMAND = /\\[A-Za-z]|\\[\\{}[\]|,;!:&%#_^ ]/;

const BLOCK_ENV = /\\begin\{(align|align\*|gather|gather\*|multline|multline\*|equation|equation\*|eqnarray|cases|pmatrix|bmatrix|vmatrix|Vmatrix|Bmatrix|matrix|array|CD)\}/;

function stripDelimiters(t: string): { inner: string; display: 'inline' | 'block' } | null {
  let m: RegExpExecArray | null;
  if ((m = /^\$\$([\s\S]+?)\$\$$/.exec(t))) return { inner: m[1]!.trim(), display: 'block' };
  if ((m = /^\\\[([\s\S]+?)\\\]$/.exec(t))) return { inner: m[1]!.trim(), display: 'block' };
  if ((m = /^\$([^$]+?)\$$/.exec(t))) return { inner: m[1]!.trim(), display: 'inline' };
  if ((m = /^\\\(([\s\S]+?)\\\)$/.exec(t))) return { inner: m[1]!.trim(), display: 'inline' };
  return null;
}

/**
 * Environment names and the arguments of text-like commands are legitimate words
 * inside LaTeX (`\begin{cases}`, `\text{if }`), so they are removed before the
 * prose heuristic counts words.
 */
function stripLatexTextArgs(t: string): string {
  return t
    .replace(/\\(begin|end)\{[^}]*\}/g, ' ')
    .replace(/\\(text|textrm|textit|textbf|textsf|texttt|mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|operatorname|mbox|label|tag|ref|eqref)\*?\{[^}]*\}/g, ' ');
}

/**
 * Letter runs of length >= 2 that are not part of a backslash command. Word
 * boundaries are defined by "not a letter", so `integral_1` and `sum_{k}` still
 * yield `integral` and `sum` (unlike `\b`, which treats `_` as a word character).
 */
function plainWords(t: string): string[] {
  const out: string[] = [];
  const re = /(?<![A-Za-z\\])[A-Za-z]{2,}(?![A-Za-z])/g;
  const cleaned = stripLatexTextArgs(t);
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) out.push(m[0]);
  return out;
}

function balanced(t: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  for (const ch of t) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0;
}

function inferDisplay(latex: string): 'inline' | 'block' {
  return BLOCK_ENV.test(latex) || latex.includes('\\\\') ? 'block' : 'inline';
}

export function classifyIntent(input: string, opts: ClassifyOptions = {}): IntentResult {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { kind: 'empty', decision: 'none', reasons: ['empty'] };

  if (opts.sourceMode) {
    return {
      kind: 'source-mode',
      decision: 'direct',
      latex: trimmed,
      display: inferDisplay(trimmed),
      reasons: ['source-mode'],
    };
  }

  // 1. Any CJK means the user is describing, even if LaTeX is embedded in the sentence.
  if (CJK.test(trimmed)) {
    return { kind: 'natural-language', decision: 'ai', reasons: ['cjk'] };
  }

  // 2. Explicit delimiters: $…$, $$…$$, \(…\), \[…\].
  const stripped = stripDelimiters(trimmed);
  if (stripped) {
    return {
      kind: 'explicit-latex',
      decision: 'direct',
      latex: stripped.inner,
      display: stripped.display,
      reasons: ['delimiters'],
    };
  }

  const informalTwo = new Set([...INFORMAL_TWO_LETTER, ...(opts.extraKeywords ?? []).map((w) => w.toLowerCase())]);
  const words = plainWords(trimmed);
  const informalWords = words.filter((w) => w.length >= 3 || informalTwo.has(w.toLowerCase()));

  // 3. Backslash commands mark literal LaTeX, unless they are embedded in English prose.
  if (BACKSLASH_COMMAND.test(trimmed)) {
    if (informalWords.length >= 3) {
      return {
        kind: 'natural-language',
        decision: 'ai',
        reasons: ['backslash-with-prose', ...informalWords.map((w) => `word:${w}`)],
      };
    }
    return {
      kind: 'explicit-latex',
      decision: 'direct',
      latex: trimmed,
      display: inferDisplay(trimmed),
      reasons: ['backslash-command'],
    };
  }

  // 4. Everything below is backslash-free. Collect reasons that disqualify a direct insert.
  const reasons: string[] = [];
  if (UNICODE_MATH.test(trimmed)) reasons.push('unicode-math-symbols');
  for (const s of SHORTHAND) if (s.re.test(trimmed)) reasons.push(s.reason);
  for (const w of informalWords) reasons.push(`word:${w}`);
  if (!RESTRICTED_CHARS.test(trimmed)) reasons.push('chars-outside-restricted-set');
  if (!balanced(trimmed)) reasons.push('unbalanced-brackets');

  if (reasons.length === 0) {
    return {
      kind: 'restricted-expression',
      decision: 'direct',
      latex: trimmed,
      display: 'inline',
      reasons: ['restricted-expression'],
    };
  }

  return {
    kind: informalWords.length >= 3 ? 'natural-language' : 'gray',
    decision: 'ai',
    reasons,
  };
}
