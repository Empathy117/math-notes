/**
 * Stand-in for the injected AI function (design doc D6) so the S1 interaction spike
 * can run without an API key. Start the dev server with DEEPSEEK_API_KEY to use the
 * real resolver instead (see vite.config.ts).
 */
import type { MathGenerateRequest, MathResolver, MathResult } from '@math-notes/core';

const base = {
  alternatives: [] as MathResult['alternatives'],
  notations: [] as MathResult['notations'],
  features: [] as string[],
  consistency: { kind: 'none' as const },
};

const canned: { match: RegExp; result: MathResult }[] = [
  {
    match: /\(x\+1\)\^2从1到2的定积分|integral_1\^2 \(x\+1\)\^2 dx/,
    result: {
      ...base,
      status: 'ok',
      interpretation: '(x+1)² 从 1 到 2 的定积分',
      latex: '\\int_1^2 (x+1)^2 \\, dx',
      confidence: 'high',
      consistency: { kind: 'numeric', expected: '19/3' },
    },
  },
  {
    match: /limit->0\(sinx\/x\)|lim x->0 sin x\/x|sin x\/x/,
    result: {
      ...base,
      status: 'ambiguous',
      interpretation: '按 sin(x)/x 在 x→0 时的极限理解',
      latex: '\\lim_{x \\to 0} \\frac{\\sin x}{x}',
      alternatives: [{ latex: '\\lim_{x \\to 0} \\sin\\left(\\frac{x}{x}\\right)', interpretation: '改为 sin(x/x)' }],
      confidence: 'medium',
    },
  },
  { match: /^sin x$/, result: { ...base, status: 'ok', interpretation: '正弦函数 sin x', latex: '\\sin x', confidence: 'high' } },
  { match: /^x的平方$/, result: { ...base, status: 'ok', interpretation: 'x 的平方', latex: 'x^2', confidence: 'high' } },
  { match: /^三分之二$/, result: { ...base, status: 'ok', interpretation: '分数三分之二', latex: '\\frac{2}{3}', confidence: 'high' } },
  { match: /^根号下 ?x ?加 ?1$/, result: { ...base, status: 'ok', interpretation: '根号下 x+1', latex: '\\sqrt{x+1}', confidence: 'high' } },
  { match: /^pi r\^2$/, result: { ...base, status: 'ok', interpretation: '圆面积 πr²', latex: '\\pi r^2', confidence: 'high' } },
  { match: /^sum_\{k=1\}\^n k\^2$/, result: { ...base, status: 'ok', interpretation: 'k² 从 1 到 n 求和', latex: '\\sum_{k=1}^{n} k^2', confidence: 'high' } },
  { match: /^sqrt\(x\^2\+1\)$/, result: { ...base, status: 'ok', interpretation: '根号下 x²+1', latex: '\\sqrt{x^2+1}', confidence: 'high' } },
  { match: /^x -> 0$/, result: { ...base, status: 'ok', interpretation: 'x 趋于 0', latex: 'x \\to 0', confidence: 'high' } },
  { match: /^x >= 0$/, result: { ...base, status: 'ok', interpretation: 'x 大于等于 0', latex: 'x \\ge 0', confidence: 'high' } },
  { match: /^abc$/, result: { ...base, status: 'ok', interpretation: '按乘积 abc 理解', latex: 'abc', confidence: 'medium' } },
];

/** The descriptions the mock "finds" for the one-click conversion (the sample note's 口述笔记). */
const describedFormulas: { quote: string; latex: string; interpretation: string }[] = [
  { quote: 'x等于2a分之负b加减根号下b的平方减4ac', latex: 'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}', interpretation: '二次方程的求根公式' },
  { quote: 'b的平方减4ac', latex: 'b^{2} - 4ac', interpretation: '判别式' },
  { quote: 'pi r^2', latex: '\\pi r^{2}', interpretation: '圆的面积' },
  { quote: '2 pi r', latex: '2\\pi r', interpretation: '圆的周长' },
  { quote: 'sin x的平方加cos x的平方等于1', latex: '\\sin^{2} x + \\cos^{2} x = 1', interpretation: '同角三角函数的平方关系' },
  { quote: '(x+1)^2从1到2的定积分', latex: '\\int_{1}^{2} (x+1)^{2} \\, dx', interpretation: '(x+1)² 从 1 到 2 的定积分' },
  { quote: '三分之十九', latex: '\\frac{19}{3}', interpretation: '分数 19/3' },
];

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const mockResolver: MathResolver = {
  /** Every non-overlapping occurrence of a known description, longest first, in reading order. */
  async scan(req) {
    await delay(500);
    const spans = [];
    for (const b of req.blocks) {
      const hits: { at: number; f: (typeof describedFormulas)[number] }[] = [];
      for (const f of describedFormulas) {
        for (let at = b.text.indexOf(f.quote); at >= 0; at = b.text.indexOf(f.quote, at + 1)) hits.push({ at, f });
      }
      hits.sort((x, y) => x.at - y.at || y.f.quote.length - x.f.quote.length);
      let end = 0;
      for (const { at, f } of hits) {
        if (at < end) continue;
        spans.push({ block: b.id, quote: f.quote, latex: f.latex, interpretation: f.interpretation });
        end = at + f.quote.length;
      }
    }
    return { spans };
  },
  async resolve(req: MathGenerateRequest): Promise<MathResult> {
    await delay(300);
    const s = req.input.trim();
    for (const c of canned) if (c.match.test(s)) return c.result;
    if (/tikz|交换图|commutative/i.test(s)) {
      return { ...base, status: 'unsupported', interpretation: '交换图', latex: '', features: ['tikz-cd'], confidence: 'high' };
    }
    return { ...base, status: 'not_math', interpretation: '', latex: '', confidence: 'low' };
  },
  async edit(req) {
    await delay(300);
    return { status: 'unclear', replacementLatex: req.selectionLatex, interpretation: 'mock 不支持改写', confidence: 'low' };
  },
};
