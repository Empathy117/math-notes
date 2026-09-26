import { describe, expect, it } from 'vitest';
import { normalizeModelLatex, parseModelJson, stripDelimiters } from '../src/ai/normalize';
import { ModelOutputError, parseMathEditResultText, parseMathResultText, toMathResult } from '../src/ai/result';
import { buildEditMessages, buildGenerateMessages } from '../src/ai/prompt';

describe('normalize', () => {
  it('strips delimiters and fences', () => {
    expect(stripDelimiters('$x^2$')).toBe('x^2');
    expect(stripDelimiters('$$\\int_0^1 x\\,dx$$')).toBe('\\int_0^1 x\\,dx');
    expect(stripDelimiters('\\[ E = mc^2 \\]')).toBe('E = mc^2');
    expect(stripDelimiters('\\( a+b \\)')).toBe('a+b');
    expect(stripDelimiters('```latex\n\\frac{1}{2}\n```')).toBe('\\frac{1}{2}');
  });

  it('drops \\label and \\tag', () => {
    expect(normalizeModelLatex('x = 1 \\label{eq:1}')).toBe('x = 1');
    expect(normalizeModelLatex('x = 1 \\tag{3}')).toBe('x = 1');
  });

  it('parses JSON out of fences and prose', () => {
    expect(parseModelJson('```json\n{"latex":"x"}\n```')).toEqual({ latex: 'x' });
    expect(parseModelJson('Sure! {"latex":"x"} done')).toEqual({ latex: 'x' });
    expect(parseModelJson('not json')).toBeNull();
  });

  it('mends a missing closing brace and a trailing comma', () => {
    // Seen from deepseek-flash in S4: the consistency object was never closed.
    const s4 = '{"status":"ok","latex":"\\\\int_{-\\\\infty}^{\\\\infty} e^{-x^{2}} \\\\, dx","consistency":{"kind":"numeric","expected":"\\\\sqrt{\\\\pi}","notes":""}';
    expect(parseModelJson(s4)).toMatchObject({ status: 'ok', latex: '\\int_{-\\infty}^{\\infty} e^{-x^{2}} \\, dx' });
    expect(parseModelJson('{"latex":"x^{2}",}')).toEqual({ latex: 'x^{2}' });
  });

  it('keeps a LaTeX backslash the model left undoubled', () => {
    // zh-01 in S4: \int escaped, \, not, so JSON.parse rejects the "\," escape.
    const s4 = '{"status":"ok","latex":"\\\\int_{1}^{2} (x+1)^{2} \\, dx"}';
    expect(parseModelJson(s4)).toEqual({ status: 'ok', latex: '\\int_{1}^{2} (x+1)^{2} \\, dx' });
    expect(parseModelJson('{"latex":"\\underline{x}"}')).toEqual({ latex: '\\underline{x}' });
  });

  it('puts back commands that valid JSON escapes swallowed', () => {
    // "\frac" and "\theta" in JSON parse as a form feed and a tab.
    expect(parseMathResultText('{"status":"ok","latex":"\\frac{1}{2} + \\theta"}').latex).toBe('\\frac{1}{2} + \\theta');
    expect(normalizeModelLatex('\\begin{aligned} a &= b \\\\\nb &= c \\end{aligned}')).toContain('\nb');
  });

  it('does not mend a string cut off mid-way', () => {
    expect(parseModelJson('{"interpretation":"a divided by the quantity')).toBeNull();
  });
});

describe('toMathResult', () => {
  it('fills defaults and normalizes latex', () => {
    const r = toMathResult({ status: 'ok', latex: '$\\sin x$', interpretation: 'sine' });
    expect(r.latex).toBe('\\sin x');
    expect(r.confidence).toBe('medium');
    expect(r.alternatives).toEqual([]);
    expect(r.consistency).toEqual({ kind: 'none' });
  });

  it('turns an ok result with empty latex into not_math', () => {
    expect(toMathResult({ status: 'ok', latex: '' }).status).toBe('not_math');
  });

  it('keeps unsupported with features and empty latex', () => {
    const r = toMathResult({ status: 'unsupported', latex: '', features: ['tikz-cd'] });
    expect(r.status).toBe('unsupported');
    expect(r.features).toEqual(['tikz-cd']);
  });

  it('drops alternatives equal to the primary latex', () => {
    const r = toMathResult({ status: 'ambiguous', latex: 'x', alternatives: [{ latex: 'x', interpretation: 'same' }, { latex: 'y', interpretation: 'other' }] });
    expect(r.alternatives.map((a) => a.latex)).toEqual(['y']);
  });

  it('keeps notations apart from alternatives', () => {
    const r = toMathResult({
      status: 'ok',
      latex: '\\frac{df}{dx}',
      notations: [{ latex: "f'(x)", interpretation: '撇号记法' }, { latex: '\\frac{df}{dx}', interpretation: 'same' }],
    });
    expect(r.status).toBe('ok');
    expect(r.alternatives).toEqual([]);
    expect(r.notations.map((n) => n.latex)).toEqual(["f'(x)"]);
  });

  it('treats an ok answer that offers other readings as ambiguous', () => {
    const r = toMathResult({ status: 'ok', latex: '|x-2|', alternatives: [{ latex: '|x|-2', interpretation: 'x 的绝对值再减 2' }] });
    expect(r.status).toBe('ambiguous');
  });

  it('treats an ambiguous answer without other readings as ok', () => {
    expect(toMathResult({ status: 'ambiguous', latex: 'abc', alternatives: [] }).status).toBe('ok');
  });

  it('accepts a numeric expected value', () => {
    const r = toMathResult({ status: 'ok', latex: '1+1', consistency: { kind: 'numeric', expected: 2 } });
    expect(r.consistency).toEqual({ kind: 'numeric', expected: '2' });
  });
});

describe('text fallbacks', () => {
  it('treats a bare line as a formula when the model ignored JSON', () => {
    const r = parseMathResultText('\\frac{1}{2}\nsome explanation');
    expect(r.latex).toBe('\\frac{1}{2}');
    expect(r.confidence).toBe('low');
  });

  it('refuses to read broken JSON as a formula', () => {
    expect(() => parseMathResultText('{"interpretation":"x 的平方","latex":"x^{2}')).toThrow(ModelOutputError);
    expect(() => parseMathEditResultText('```json\n{"replacementLatex":"x^{3}', 'x^{2}')).toThrow(ModelOutputError);
  });

  it('edit falls back to the original selection when unclear', () => {
    const r = parseMathEditResultText('{"status":"unclear","replacementLatex":"whatever"}', 'x^2');
    expect(r.replacementLatex).toBe('x^2');
    expect(r.status).toBe('unclear');
  });
});

describe('prompts', () => {
  it('generate messages end with the user input and include context', () => {
    const m = buildGenerateMessages({ kind: 'generate', input: 'x的平方', context: { notation: ['\\mathrm{d}'] } });
    expect(m[0]!.role).toBe('system');
    expect(m[m.length - 1]!.role).toBe('user');
    expect(m[m.length - 1]!.content).toContain('x的平方');
    expect(m[m.length - 1]!.content).toContain('\\mathrm{d}');
  });

  it('a retry carries the rejected LaTeX and the renderer error', () => {
    const m = buildGenerateMessages({
      kind: 'generate',
      input: 'x 的绝对值',
      retry: { latex: '\\abs{x}', message: 'Undefined control sequence: \\abs', position: 0 },
    });
    const last = m[m.length - 1]!.content;
    expect(last).toContain('x 的绝对值');
    expect(last).toContain('\\abs{x}');
    expect(last).toContain('Undefined control sequence: \\abs');
  });

  it('a retry after an unusable answer asks for valid JSON', () => {
    const m = buildGenerateMessages({ kind: 'generate', input: 'x 的平方', retry: { latex: '', message: 'model returned malformed JSON' } });
    const last = m[m.length - 1]!.content;
    expect(last).toContain('无法使用');
    expect(last).toContain('model returned malformed JSON');
    expect(last).not.toContain('渲染器报错');
  });

  it('edit messages carry the whole formula and the selected fragment', () => {
    const m = buildEditMessages({ kind: 'edit', instruction: '改成 2', fullLatex: 'a+b+c', selectionLatex: 'b' });
    const payload = JSON.parse(m[1]!.content) as Record<string, string>;
    expect(payload).toMatchObject({ full: 'a+b+c', selection: 'b', instruction: '改成 2' });
  });
});
