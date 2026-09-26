import type { IntentDecision, IntentKind } from '../src/intent/classify';

export interface IntentCase {
  input: string;
  decision: IntentDecision;
  kind?: IntentKind;
  latex?: string;
  display?: 'inline' | 'block';
  note?: string;
}

/**
 * S0 corpus. Every `direct` case must be something a user would only type if they
 * meant literal LaTeX; every `ai` case is informal, ambiguous or natural language.
 */
export const intentCorpus: IntentCase[] = [
  // --- the user's own examples -------------------------------------------------
  { input: '(x+1)^2从1到2的定积分', decision: 'ai', kind: 'natural-language', note: 'Chinese description' },
  { input: 'limit->0(sinx/x)', decision: 'ai', kind: 'gray', note: 'shorthand arrow + word' },
  { input: 'integral_1^2 (x+1)^2 dx', decision: 'ai', kind: 'gray', note: 'Typst-like word' },
  { input: 'x的平方', decision: 'ai', kind: 'natural-language' },

  // --- literal LaTeX: direct ---------------------------------------------------
  { input: 'x^2+y^2=1', decision: 'direct', kind: 'restricted-expression', latex: 'x^2+y^2=1' },
  { input: 'e^x', decision: 'direct', kind: 'restricted-expression' },
  { input: 'f(x) = x^2 + 1', decision: 'direct', kind: 'restricted-expression' },
  { input: 'a_1 + a_2', decision: 'direct', kind: 'restricted-expression' },
  { input: 'A_{ij}', decision: 'direct', kind: 'restricted-expression', note: 'two-letter run allowed' },
  { input: '2ab', decision: 'direct', kind: 'restricted-expression', note: 'two-letter run allowed' },
  { input: 'x^2 dx', decision: 'direct', kind: 'restricted-expression', note: 'dx is a two-letter run' },
  { input: '1/2', decision: 'direct', kind: 'restricted-expression', note: 'slash is valid LaTeX; documented trade-off' },
  { input: '\\sin x', decision: 'direct', kind: 'explicit-latex' },
  { input: '\\frac{1}{2}', decision: 'direct', kind: 'explicit-latex' },
  { input: '\\lim_{x\\to 0} \\frac{\\sin x}{x}', decision: 'direct', kind: 'explicit-latex', display: 'inline' },
  { input: '\\int_1^2 (x+1)^2 \\, dx', decision: 'direct', kind: 'explicit-latex' },
  { input: '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', decision: 'direct', kind: 'explicit-latex', display: 'block' },
  { input: '\\begin{align} a &= b \\\\ c &= d \\end{align}', decision: 'direct', kind: 'explicit-latex', display: 'block' },
  { input: 'x \\in A', decision: 'direct', kind: 'explicit-latex', note: 'backslash wins over word rule' },
  { input: '\\begin{cases} x & \\text{if } x > 0 \\\\ -x & \\text{otherwise} \\end{cases}', decision: 'direct', kind: 'explicit-latex', display: 'block', note: 'words inside \\text and env names are not prose' },
  { input: '\\text{for all } x \\in \\mathbb{R}', decision: 'direct', kind: 'explicit-latex' },
  { input: '\\operatorname{Var}(X) = \\mathrm{E}[X^2]', decision: 'direct', kind: 'explicit-latex' },
  { input: '$x^2$', decision: 'direct', kind: 'explicit-latex', latex: 'x^2', display: 'inline' },
  { input: '$$\\int_0^1 x\\,dx$$', decision: 'direct', kind: 'explicit-latex', latex: '\\int_0^1 x\\,dx', display: 'block' },
  { input: '\\[ E = mc^2 \\]', decision: 'direct', kind: 'explicit-latex', latex: 'E = mc^2', display: 'block' },
  { input: '\\( a+b \\)', decision: 'direct', kind: 'explicit-latex', latex: 'a+b', display: 'inline' },
  { input: '  x + y  ', decision: 'direct', kind: 'restricted-expression', latex: 'x + y' },
  { input: 'AB', decision: 'direct', kind: 'restricted-expression', note: 'segment AB' },
  { input: "f'(x)", decision: 'direct', kind: 'restricted-expression' },
  { input: '|x| < 1', decision: 'direct', kind: 'restricted-expression' },

  // --- informal or ambiguous: ai ---------------------------------------------
  { input: 'sin x', decision: 'ai', kind: 'gray', note: 'KaTeX would parse as s·i·n·x' },
  { input: 'sin x/x', decision: 'ai', kind: 'gray' },
  { input: 'lim x->0 sin x/x', decision: 'ai', kind: 'gray' },
  { input: 'abc', decision: 'ai', kind: 'gray', note: 'three-letter run' },
  { input: 'pi r^2', decision: 'ai', kind: 'gray', note: 'pi is an informal two-letter word' },
  { input: 'ln x', decision: 'ai', kind: 'gray' },
  { input: 'x -> 0', decision: 'ai', kind: 'gray' },
  { input: 'x >= 0', decision: 'ai', kind: 'gray' },
  { input: 'a != b', decision: 'ai', kind: 'gray' },
  { input: 'x*y', decision: 'ai', kind: 'gray', note: 'asterisk product' },
  { input: '2**10', decision: 'ai', kind: 'gray' },
  { input: 'sqrt(x^2+1)', decision: 'ai', kind: 'gray' },
  { input: 'sum_{k=1}^n k^2', decision: 'ai', kind: 'gray' },
  { input: 'x in A', decision: 'ai', kind: 'gray' },
  { input: '{x^2', decision: 'ai', kind: 'gray', note: 'unbalanced' },
  { input: 'x^2 & y', decision: 'ai', kind: 'gray', note: 'ampersand outside restricted set' },
  { input: '∫₀¹ x² dx', decision: 'ai', kind: 'gray', note: 'unicode math' },
  { input: 'α + β', decision: 'ai', kind: 'gray', note: 'unicode greek' },
  { input: 'ABC', decision: 'ai', kind: 'gray', note: 'three uppercase letters; accepted trade-off' },
  { input: 'the integral of x squared from 0 to 1', decision: 'ai', kind: 'natural-language' },
  { input: 'derivative of sin x', decision: 'ai', kind: 'natural-language' },
  { input: 'the limit of \\frac{\\sin x}{x} as x goes to zero', decision: 'ai', kind: 'natural-language', note: 'LaTeX inside English prose' },
  { input: '求 \\int_0^1 x dx 的值', decision: 'ai', kind: 'natural-language', note: 'LaTeX inside Chinese prose' },
  { input: '三分之二', decision: 'ai', kind: 'natural-language' },
  { input: '根号下 x 加 1', decision: 'ai', kind: 'natural-language' },
  { input: 'sine of x over x', decision: 'ai', kind: 'natural-language' },

  // --- empty ---------------------------------------------------------------------
  { input: '', decision: 'none', kind: 'empty' },
  { input: '   ', decision: 'none', kind: 'empty' },
];
