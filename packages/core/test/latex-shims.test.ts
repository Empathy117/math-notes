import { describe, expect, it } from 'vitest';
import { fromEditorLatex, toEditorLatex } from '../src/adapter/latex-shims';
import { renderKatex } from '../src/render/katex';

const STORED = [
  '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1',
  '\\limsup_{n\\to\\infty} a_n \\le \\liminf_{n} b_n',
  '\\max(a, b) + \\min_{i} x_i + \\sup_{x \\in A} f(x) + \\inf_x g',
  '\\det A \\cdot \\gcd(a, b) + \\Pr(X > 0)',
  '\\operatorname*{arg\\,max}_{\\theta} L(\\theta)',
  '\\mathop{\\mathrm{ess\\,sup}}_{x} |f|',
  '\\lim\\limits_{x\\to0} f + \\lim\\nolimits_{x\\to1} g',
  '\\sum_{k=1}^{n} k^2 + \\int_0^1 f(x) \\, dx',
];

describe('toEditorLatex', () => {
  it('gives the operators TeX sets with \\displaylimits an explicit one for MathLive', () => {
    expect(toEditorLatex('\\lim_{x \\to 0} f')).toBe('\\lim\\displaylimits_{x \\to 0} f');
    expect(toEditorLatex('\\limsup_{n} a_n')).toBe('\\limsup\\displaylimits_{n} a_n');
    expect(toEditorLatex('\\max(a, b) + \\sup_x f')).toBe('\\max\\displaylimits(a, b) + \\sup\\displaylimits_x f');
    expect(toEditorLatex('\\operatorname*{arg\\,max}_{x} f')).toBe('\\operatorname*{arg\\,max}\\displaylimits_{x} f');
  });

  it('leaves explicit placements, longer command names and other operators alone', () => {
    for (const s of ['\\lim\\limits_{x} f', '\\lim \\nolimits_x f', '\\limits', '\\minus', '\\sum_{k=1}^n k', '\\int_0^1 f', '\\sin x', '\\operatorname{tr} A']) {
      expect(toEditorLatex(s)).toBe(s);
    }
  });
});

describe('fromEditorLatex', () => {
  it('gives back every stored formula byte for byte', () => {
    for (const s of STORED) expect(fromEditorLatex(toEditorLatex(s))).toBe(s);
  });

  it('strips the \\displaylimits MathLive serializes, which KaTeX does not know', () => {
    expect(fromEditorLatex('\\lim\\displaylimits_{x\\to0}\\frac{\\sin x}{x}=1')).toBe('\\lim_{x\\to0}\\frac{\\sin x}{x}=1');
    expect(fromEditorLatex('\\operatorname*{arg~max}\\displaylimits_{x}f')).toBe('\\operatorname*{arg~max}_{x}f');
    expect(fromEditorLatex('\\max\\displaylimits x')).toBe('\\max x');
  });

  it('spells out MathLive-only macros', () => {
    // Typing "dx" in MathLive gives \differentialD, which broke the formula once committed.
    expect(fromEditorLatex('\\int_0^1 x\\differentialD x')).toBe('\\int_0^1 x\\mathrm{d} x');
    expect(fromEditorLatex('\\exponentialE^{\\imaginaryI\\pi}')).toBe('\\mathrm{e}^{\\mathrm{i}\\pi}');
    expect(fromEditorLatex('\\differentialDelta')).toBe('\\differentialDelta');
  });

  it("turns MathLive's \\displaylines root into gathered", () => {
    expect(fromEditorLatex('\\displaylines{a+b=c\\\\ d}')).toBe('\\begin{gathered}a+b=c\\\\ d\\end{gathered}');
  });

  it('only produces LaTeX that KaTeX renders', () => {
    for (const s of [
      '\\lim\\displaylimits_{x\\to0}\\frac{\\sin x}{x}=1',
      '\\int_0^1 x\\differentialD x',
      '\\displaylines{\\int_1^2(x+1)^2\\,dx\\\\ y=1}',
      ...STORED.map(toEditorLatex),
    ]) {
      expect(renderKatex(fromEditorLatex(s), { display: 'block' }).ok, s).toBe(true);
    }
  });
});
