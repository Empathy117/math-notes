/**
 * Host-side semantic checks (design doc D6, semantic-warning → alternatives): readings the host
 * offers itself, deterministically, for patterns where the model's own flagging proved unreliable
 * in S4 even with rules and few-shots in the prompt.
 *
 * - Typed `sinx/x`, `ln t/t`: calculators and parsers disagree on the reading. The model missed
 *   it inside an outer structure such as limit->0(sinx/x).
 * - Spoken 根号下 A 加 B: the root may cover B or not. The model flagged 根号下x加1 but never
 *   根号下2x减1.
 */
import type { MathResult } from './types';

const FUNCS = 'arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|ln|log|lg|exp';
/** In the typed input: `sinx/x`, `ln t / t`; not `sin(x)/x`, `sin x/(x+1)`, `asinx/x`. */
const TYPED_SLASH = new RegExp(`(?:^|[^a-z])(?:${FUNCS})\\s*[a-z0-9]\\s*/\\s*[a-z0-9]`, 'i');
/** In the model's LaTeX: \frac{\sin x}{x}, \frac{\ln{t}}{t}. */
const FUNC_OVER = new RegExp(`\\\\frac\\{\\s*\\\\(${FUNCS})\\s*\\{?\\s*([a-zA-Z0-9])\\s*\\}?\\s*\\}\\{\\s*([a-zA-Z0-9])\\s*\\}`);
/** In the spoken input: a root "under which" something is added or subtracted. */
const ROOT_UNDER = /根号下.*?[加减]/;

function sameFormula(a: string, b: string): boolean {
  const squash = (s: string) => s.replace(/\\left|\\right|\s+/g, '');
  return squash(a) === squash(b);
}

function withReading(r: MathResult, latex: string, interpretation: string): MathResult {
  if (sameFormula(latex, r.latex) || r.alternatives.some((a) => sameFormula(a.latex, latex))) return r;
  return { ...r, status: 'ambiguous', alternatives: [...r.alternatives, { latex, interpretation }] };
}

function slashReading(input: string, r: MathResult): MathResult {
  if (!TYPED_SLASH.test(input)) return r;
  const m = FUNC_OVER.exec(r.latex);
  if (!m) return r;
  const [whole, fn, arg, den] = m as unknown as [string, string, string, string];
  const other = r.latex.slice(0, m.index) + `\\${fn}\\left(\\frac{${arg}}{${den}}\\right)` + r.latex.slice(m.index + whole.length);
  return withReading(r, other, `改为 ${fn}(${arg}/${den})`);
}

/** Index just past the group that opens at `open` ({…} or […]), or -1 if it never closes. */
function groupEnd(s: string, open: number): number {
  const close = s[open] === '[' ? ']' : '}';
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === s[open]) depth++;
    else if (s[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

/** First + or - at the top level of `s`, not a leading sign. */
function topLevelSign(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\') i++;
    else if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth--;
    else if ((ch === '+' || ch === '-') && depth === 0 && s.slice(0, i).trim() !== '') return i;
  }
  return -1;
}

function rootReading(input: string, r: MathResult): MathResult {
  if (!ROOT_UNDER.test(input)) return r;
  const at = r.latex.indexOf('\\sqrt');
  if (at < 0) return r;
  let i = at + '\\sqrt'.length;
  while (r.latex[i] === ' ') i++;
  const index = r.latex[i] === '[' ? r.latex.slice(i, groupEnd(r.latex, i)) : '';
  i += index.length;
  while (r.latex[i] === ' ') i++;
  if (r.latex[i] !== '{') return r;
  const end = groupEnd(r.latex, i);
  if (end < 0) return r;
  const radicand = r.latex.slice(i + 1, end - 1);
  const sign = topLevelSign(radicand);
  // √(x+1)^2 would turn into √x + 1^2: leave anything raised or subscripted alone.
  if (sign < 0 || /^\s*[\^_]/.test(r.latex.slice(end))) return r;
  const first = radicand.slice(0, sign).trim();
  const rest = radicand.slice(sign).trim();
  const other = `${r.latex.slice(0, at)}\\sqrt${index}{${first}}${rest}${r.latex.slice(end)}`;
  return withReading(r, other, `改为只对 ${first} 开方`);
}

/** Add the readings the host knows the input can also mean. */
export function offerKnownReadings(input: string, r: MathResult): MathResult {
  if (r.status !== 'ok' && r.status !== 'ambiguous') return r;
  return rootReading(input, slashReading(input, r));
}
