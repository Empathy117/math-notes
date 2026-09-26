import { describe, expect, it } from 'vitest';
import { toMathResult } from '../src/ai/result';
import { offerKnownReadings } from '../src/ai/semantic';

const ok = (latex: string) => toMathResult({ status: 'ok', latex });
const readings = (input: string, latex: string) => offerKnownReadings(input, ok(latex)).alternatives.map((a) => a.latex);

describe('typed function-over-slash', () => {
  it('offers sin(x/x) for typed sinx/x inside an outer structure', () => {
    // S4 sl-01: the model answered ok without the other reading.
    const r = offerKnownReadings('limit->0(sinx/x)', ok('\\lim_{x \\to 0} \\frac{\\sin x}{x}'));
    expect(r.status).toBe('ambiguous');
    expect(r.alternatives.map((a) => a.latex)).toEqual(['\\lim_{x \\to 0} \\sin\\left(\\frac{x}{x}\\right)']);
  });

  it('handles braced arguments and spaces around the slash', () => {
    expect(readings('int_1^2 ln t / t dt', '\\int_{1}^{2} \\frac{\\ln{t}}{t} \\, dt')).toEqual([
      '\\int_{1}^{2} \\ln\\left(\\frac{t}{t}\\right) \\, dt',
    ]);
  });

  it('leaves bracketed or spoken input alone', () => {
    for (const input of ['sin(x)/x', 'sin x/(x+1)', 'limit as x goes to zero of sine x over x', 'asinx/x']) {
      expect(offerKnownReadings(input, ok('\\frac{\\sin x}{x}')).status).toBe('ok');
    }
  });

  it('does not repeat a reading the model already offered', () => {
    const r = offerKnownReadings(
      'tanx/x',
      toMathResult({ status: 'ambiguous', latex: '\\frac{\\tan x}{x}', alternatives: [{ latex: '\\tan(\\frac{x}{x})', interpretation: '' }] }),
    );
    expect(r.alternatives).toHaveLength(1);
  });

  it('leaves answers without the quotient, or without a formula, alone', () => {
    expect(readings('sinx/x', '\\sin\\left(\\frac{x}{x}\\right)')).toEqual([]);
    expect(offerKnownReadings('sinx/x', toMathResult({ status: 'not_math', latex: '' })).status).toBe('not_math');
  });
});

describe('spoken 根号下 A 加 B', () => {
  it('offers the root over the first term only', () => {
    // S4 ha-05: never flagged by the model.
    expect(readings('根号下2x减1', '\\sqrt{2x-1}')).toEqual(['\\sqrt{2x}-1']);
    expect(readings('三次根号下x加8', '\\sqrt[3]{x + 8}')).toEqual(['\\sqrt[3]{x}+ 8']);
  });

  it('splits at the top level only and keeps the surroundings', () => {
    expect(readings('根号下x的平方加y的平方', '\\sqrt{x^{2}+y^{2}}')).toEqual(['\\sqrt{x^{2}}+y^{2}']);
    expect(readings('根号下(a+b)减c 除以 2', '\\frac{\\sqrt{(a+b)-c}}{2}')).toEqual(['\\frac{\\sqrt{(a+b)}-c}{2}']);
    expect(readings('根号下负x加1', '\\sqrt{-x+1}')).toEqual(['\\sqrt{-x}+1']);
  });

  it('leaves roots that are raised, single-term, or not spoken with 根号下 alone', () => {
    expect(readings('根号下x加1的平方', '\\sqrt{x+1}^{2}')).toEqual([]);
    expect(readings('根号下2加根号下3', '\\sqrt{2}+\\sqrt{3}')).toEqual([]);
    expect(readings('根号x加1', '\\sqrt{x}+1')).toEqual([]);
    expect(readings('square root of x plus one', '\\sqrt{x+1}')).toEqual([]);
  });
});
