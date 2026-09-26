import type { JSONContent } from '@tiptap/core';

const inline = (latex: string): JSONContent => ({ type: 'mathInline', attrs: { latex } });
const block = (latex: string): JSONContent => ({ type: 'mathBlock', attrs: { latex } });
const text = (t: string): JSONContent => ({ type: 'text', text: t });
const marked = (t: string, ...marks: (string | { type: string; attrs: Record<string, unknown> })[]): JSONContent => ({
  type: 'text',
  text: t,
  marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)),
});

// The e2e suite relies on the order of the first formulas: the \lim one comes first, the fifth
// inline formula leads its paragraph, the integral is the first block formula and is followed by
// a paragraph that starts with text.
export const sampleDoc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text('极限与积分')] },
    {
      type: 'paragraph',
      content: [
        text('考虑极限 '),
        inline('\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'),
        text('，它是'),
        marked('最基本的三角极限', 'bold'),
        text('之一。'),
      ],
    },
    block('\\int_1^2 (x+1)^2 \\, dx = \\left[ \\frac{(x+1)^3}{3} \\right]_1^2 = \\frac{19}{3}'),
    {
      type: 'paragraph',
      content: [
        text('欧拉公式 '),
        inline('e^{i\\pi} + 1 = 0'),
        text(' 把五个常数联系在一起。设 '),
        inline('f(x) = x^2'),
        text(' 则 '),
        inline("f'(x) = 2x"),
        text('。'),
      ],
    },
    {
      type: 'paragraph',
      content: [
        inline('a^2 + b^2 = c^2'),
        text(' 就是'),
        marked('勾股定理', 'italic'),
        text('：直角三角形两条直角边的平方和等于斜边的平方。'),
      ],
    },
    block('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}'),
    {
      type: 'paragraph',
      content: [
        text('矩阵乘法一般不满足交换律，行列式倒是满足乘法。写法可查 '),
        marked('KaTeX 支持的命令', { type: 'link', attrs: { href: 'https://katex.org/docs/supported.html' } }),
        text('，分式写作 '),
        marked('\\frac{a}{b}', 'code'),
        text('。'),
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [text('口述笔记')] },
    {
      type: 'paragraph',
      content: [text('下面几段是听写进来的，公式还都是文字。点顶部的「一键转公式」，只有描述公式的地方会变成公式。')],
    },
    {
      type: 'paragraph',
      content: [text('二次方程的求根公式是 x等于2a分之负b加减根号下b的平方减4ac，其中 b的平方减4ac 叫判别式。')],
    },
    { type: 'paragraph', content: [text('圆的面积是 pi r^2，周长是 2 pi r；这半句只是普通笔记。')] },
    { type: 'paragraph', content: [text('sin x的平方加cos x的平方等于1')] },
    { type: 'paragraph', content: [text('复习时把这几条再抄一遍。')] },
  ],
};
