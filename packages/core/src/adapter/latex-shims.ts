/**
 * LaTeX rewrites at the boundary between the stored formula and MathLive (design doc D1, D5).
 * MathLive 0.110.0 and KaTeX disagree in a few places; every rewrite here is a no-op in TeX, so
 * the stored formula keeps its meaning, and a formula nobody edited is never written back.
 *
 * - Limits: TeX sets \lim, \max, \sup … with \displaylimits (beside the operator in text style,
 *   below it in display style). MathLive hard-codes "below" for \lim \max \min \det \liminf
 *   \limsup \operatorname* \mathop and "beside" for \sup \inf \gcd \Pr, so an inline \lim_{x\to0}
 *   grew the line when it was opened for editing. The editor gets an explicit \displaylimits;
 *   the stored formula does not (KaTeX does not know the command).
 * - MathLive's own macros (\differentialD from typing "dx", \exponentialE …) are unknown to KaTeX.
 * - MathLive wraps a formula that is not multi-line yet in \displaylines{…} when a row is added;
 *   KaTeX has no \displaylines, and gathered is its TeX-standard equivalent.
 */

const DISPLAY_LIMIT_OPS = ['lim', 'liminf', 'limsup', 'max', 'min', 'det', 'sup', 'inf', 'gcd', 'Pr'];
/** One level of nested braces is enough for operator names such as arg\,max or \mathrm{ess}\,sup. */
const BRACED = String.raw`\{(?:[^{}]|\{[^{}]*\})*\}`;
const OPERATOR = String.raw`\\(?:${DISPLAY_LIMIT_OPS.join('|')})(?![a-zA-Z])|\\operatorname\*\s*${BRACED}|\\mathop\s*${BRACED}`;
const EXPLICIT_LIMITS = String.raw`\s*\\(?:limits|nolimits|displaylimits)(?![a-zA-Z])`;

const INJECT = new RegExp(`(${OPERATOR})(?!${EXPLICIT_LIMITS})`, 'g');
const STRIP = new RegExp(String.raw`(${OPERATOR})\s*\\displaylimits(?![a-zA-Z])`, 'g');

const MATHLIVE_MACROS: Record<string, string> = {
  differentialD: String.raw`\mathrm{d}`,
  capitalDifferentialD: String.raw`\mathrm{D}`,
  exponentialE: String.raw`\mathrm{e}`,
  imaginaryI: String.raw`\mathrm{i}`,
  imaginaryJ: String.raw`\mathrm{j}`,
};
const MACRO = new RegExp(String.raw`\\(${Object.keys(MATHLIVE_MACROS).join('|')})(?![a-zA-Z])`, 'g');

const DISPLAYLINES = /^\s*\\displaylines\s*\{([\s\S]*)\}\s*$/;

/** The stored formula as MathLive should load it. */
export function toEditorLatex(latex: string): string {
  return latex.replace(INJECT, String.raw`$1\displaylimits`);
}

/** What MathLive serialized, as the formula to store and render with KaTeX. */
export function fromEditorLatex(latex: string): string {
  const s = latex.replace(STRIP, '$1').replace(MACRO, (_, name: string) => MATHLIVE_MACROS[name] ?? _);
  const lines = DISPLAYLINES.exec(s);
  return lines ? String.raw`\begin{gathered}${lines[1]}\end{gathered}` : s;
}
