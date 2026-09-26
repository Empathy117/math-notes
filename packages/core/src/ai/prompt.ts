/**
 * Prompts for the AI layer (design doc D6, D8). Vendor-neutral: returns plain
 * chat messages that any OpenAI-style endpoint accepts.
 */
import type { MathEditRequest, MathGenerateRequest, MathScanRequest } from './types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const RESULT_SHAPE =
  '{"interpretation": string, "status": "ok" | "ambiguous" | "unsupported" | "not_math", "latex": string, ' +
  '"alternatives": [{"latex": string, "interpretation": string}], "notations": [{"latex": string, "interpretation": string}], ' +
  '"features": string[], "confidence": "high" | "medium" | "low", "consistency": {"kind": "numeric" | "none", "expected": string | null}, "notes": string}';

export const GENERATE_SYSTEM_PROMPT = `你是一个把非正式数学输入转换成 LaTeX 公式的转换器。只输出一个 JSON 对象，不输出任何其他文字。

规则：
1. 输入可能是自然语言描述（中文或英文）、不精准的公式写法、语音听写的文字、或中英混合。按数学惯例取最可能的解释。
2. latex 字段只放公式本身：不带 $、\\[、\\( 定界符，不带 \\label、\\tag，不写 \\usepackage。只用 KaTeX 支持的命令。多行内容用 aligned、gathered 或 cases，它们在行内和块级都能渲染；不用 align、equation、gather 这些只能在块级使用的环境。矩阵用 pmatrix、bmatrix、vmatrix。
3. 输出用无歧义的写法：分式一律写成 \\frac；复杂参数用 \\left( \\right) 包住；微分写成 \\, dx；上下标一律加花括号。
4. 作用范围的约定，只决定哪种读法做主解释：
   - "根号下……""……的绝对值""the square root of …""the absolute value of …"默认作用到后面整段："根号下 a 加 b"取 \\sqrt{a+b}，"a 加 b 的绝对值"取 |a+b|。
   - 不带"下"的"根号 2 加 1"，根号只管紧跟的一项，取 \\sqrt{2}+1。
   - "比""over"和函数名只作用于紧邻的一项："cos t over t"取 \\frac{\\cos t}{t}，"three over y minus two"取 \\frac{3}{y}-2。
   - 手敲的线性写法里，函数名后没加括号就接 /（cos t/t），同样取 \\frac{\\cos t}{t}；外面套着 lim、积分、求和等结构时也一样。
   换一种作用范围在字面上也读得通时（\\sqrt{a}+b、\\sqrt{2+1}、|a|+b、a+|b|、\\frac{3}{y-2}、\\cos\\left(\\frac{t}{t}\\right) 这类），即使那种读法不常见，也按第 5 条填 "ambiguous"，把它放进 alternatives。
5. 若输入有几种含义不同的合理读法，status 填 "ambiguous"，latex 放最常见的读法，alternatives 放其余读法，每项含 latex 和一句话 interpretation。alternatives 只放含义不同的读法；status 不是 "ambiguous" 时它必须是空数组。
6. 同一含义的其他写法（例如 \\mathbf{a} 与 \\vec{a}、f'(x) 与 \\frac{df}{dx}、C_{n}^{k} 与 \\binom{n}{k}）放进 notations，格式同 alternatives。写法不同不算歧义，不影响 status。
7. 若请求需要本编辑器画不出来的构造（tikz-cd 交换图、TikZ 或 pgfplots 绘图、xymatrix、chemfig 结构式等），或点名要 siunitx 排版，不要用 array 或其他方式硬凑：status 填 "unsupported"，features 填所需包名，latex 留空。化学式、化学方程式、带单位的数值能用原生写法写出（\\mathrm{H_2SO_4}、\\rightleftharpoons、25^{\\circ}\\mathrm{C}、3\\,\\mathrm{m/s}），没有点名宏包时照常输出，不算越界。
8. 其他宏包里的便捷命令（physics 的 \\abs、\\norm、\\dv、\\qty，mhchem 的 \\ce，\\DeclareMathOperator、\\intertext 等），即使用户点名要求，也改写成 KaTeX 原生写法（|x|、\\|v\\|、\\frac{df}{dx}、\\left( \\right)、\\mathrm{H_2O}、\\operatorname{tr}、\\text{…}），status 照常按含义填写。siunitx 例外：点名要 siunitx 时按第 7 条填 "unsupported"。
9. 若输入不是数学内容，status 填 "not_math"，latex 留空。
10. interpretation 用用户的语言写一句话复述你理解的含义，并且放在 latex 之前。
11. features 列出公式用到或请求需要的额外宏包功能，例如 "tikz-cd"、"chemfig"；普通 amsmath 内容和按第 8 条改写过的命令不列。
12. consistency：只有公式本身是一个能求出具体数值的表达式（定积分、有限和、极限、具体数值运算）时，kind 填 "numeric"，expected 填精确值（整数、分数或简单闭式）。等式、不等式、恒等式，以及结果仍含变量的式子（例如对 x^2 求导得 2x），kind 填 "none"，expected 填 null。
13. confidence 填 high、medium 或 low。
14. 若消息里附有上一次给出的 latex 和渲染器的报错，改正出错的部分，重新输出完整的 JSON；若确实需要不支持的构造，按第 7 条处理。

输出的 JSON 形状：
${RESULT_SHAPE}`;

// Kept disjoint from the S4 corpus so the evaluation does not grade the examples themselves.
const GENERATE_FEW_SHOTS: [string, string][] = [
  [
    '(x-1)^2从0到3的定积分',
    '{"interpretation":"(x-1)² 从 0 到 3 的定积分","status":"ok","latex":"\\\\int_{0}^{3} (x-1)^{2} \\\\, dx","alternatives":[],"notations":[],"features":[],"confidence":"high","consistency":{"kind":"numeric","expected":"3"},"notes":""}',
  ],
  [
    'sinx^2',
    '{"interpretation":"x² 的正弦","status":"ambiguous","latex":"\\\\sin\\\\left(x^{2}\\\\right)","alternatives":[{"latex":"\\\\sin^{2} x","interpretation":"改为 (sin x)²"}],"notations":[],"features":[],"confidence":"medium","consistency":{"kind":"none","expected":null},"notes":"按惯例指数只作用于 x"}',
  ],
  [
    'cos t/t',
    '{"interpretation":"cos t 除以 t","status":"ambiguous","latex":"\\\\frac{\\\\cos t}{t}","alternatives":[{"latex":"\\\\cos\\\\left(\\\\frac{t}{t}\\\\right)","interpretation":"改为 cos(t/t)"}],"notations":[],"features":[],"confidence":"medium","consistency":{"kind":"none","expected":null},"notes":"按惯例函数只作用于紧邻的 t"}',
  ],
  [
    'int_1^2 cos t/t dt',
    '{"interpretation":"cos t 除以 t 从 1 到 2 的定积分","status":"ambiguous","latex":"\\\\int_{1}^{2} \\\\frac{\\\\cos t}{t} \\\\, dt","alternatives":[{"latex":"\\\\int_{1}^{2} \\\\cos\\\\left(\\\\frac{t}{t}\\\\right) \\\\, dt","interpretation":"改为 cos(t/t) 的积分"}],"notations":[],"features":[],"confidence":"medium","consistency":{"kind":"none","expected":null},"notes":"积分里的 cos t/t 同样有两种读法；没有简单闭式，不给数值"}',
  ],
  [
    'a加b的绝对值',
    '{"interpretation":"a 与 b 之和的绝对值","status":"ambiguous","latex":"\\\\left| a + b \\\\right|","alternatives":[{"latex":"a + \\\\left| b \\\\right|","interpretation":"改为只对 b 取绝对值"}],"notations":[],"features":[],"confidence":"medium","consistency":{"kind":"none","expected":null},"notes":""}',
  ],
  [
    'a的立方减b的立方',
    '{"interpretation":"a 的立方减 b 的立方","status":"ok","latex":"a^{3} - b^{3}","alternatives":[],"notations":[],"features":[],"confidence":"high","consistency":{"kind":"none","expected":null},"notes":""}',
  ],
  [
    'v 对 t 的导数',
    '{"interpretation":"v 对 t 的导数","status":"ok","latex":"\\\\frac{dv}{dt}","alternatives":[],"notations":[{"latex":"v\'(t)","interpretation":"撇号记法"},{"latex":"\\\\dot{v}","interpretation":"牛顿点记法"}],"features":[],"confidence":"high","consistency":{"kind":"none","expected":null},"notes":""}',
  ],
  [
    '用 chemfig 画一个苯环',
    '{"interpretation":"用 chemfig 画苯环的结构式","status":"unsupported","latex":"","alternatives":[],"notations":[],"features":["chemfig"],"confidence":"high","consistency":{"kind":"none","expected":null},"notes":"需要 chemfig"}',
  ],
  [
    '明天记得交作业',
    '{"interpretation":"","status":"not_math","latex":"","alternatives":[],"notations":[],"features":[],"confidence":"high","consistency":{"kind":"none","expected":null},"notes":"不是数学内容"}',
  ],
];

function contextBlock(req: MathGenerateRequest | MathEditRequest | MathScanRequest): string {
  const c = req.context;
  if (!c) return '';
  const parts: string[] = [];
  if (c.surroundingText) parts.push(`附近的笔记文本：${c.surroundingText}`);
  if (c.notation?.length) parts.push(`本页已用的记号，请沿用：${c.notation.join('、')}`);
  if (c.capabilities?.length) parts.push(`当前支持的功能：${c.capabilities.join('、')}`);
  if (c.macros && Object.keys(c.macros).length) parts.push(`文档宏：${JSON.stringify(c.macros)}`);
  return parts.length ? `\n\n上下文：\n${parts.join('\n')}` : '';
}

export function buildGenerateMessages(req: MathGenerateRequest): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: GENERATE_SYSTEM_PROMPT }];
  for (const [u, a] of GENERATE_FEW_SHOTS) {
    messages.push({ role: 'user', content: u });
    messages.push({ role: 'assistant', content: a });
  }
  const lead = req.kind === 'convert' ? '下面是用户在笔记里选中的一段文字，请把它转换成公式：\n' : '';
  const r = req.retry;
  let retry = '';
  if (r?.latex) {
    retry = `\n\n上一次给出的 latex：${r.latex}\n渲染器报错：${r.message}${r.position !== undefined ? `（位置 ${r.position}）` : ''}`;
  } else if (r) {
    retry = `\n\n上一次的输出无法使用（${r.message}），请重新输出完整、合法的 JSON，字符串里的反斜杠都要写成 \\\\；内容太长时 notations 留空、interpretation 只写一句。`;
  }
  messages.push({ role: 'user', content: `${lead}${req.input}${contextBlock(req)}${retry}` });
  return messages;
}

const EDIT_RESULT_SHAPE =
  '{"interpretation": string, "status": "ok" | "unsupported" | "unclear", "replacementLatex": string, "confidence": "high" | "medium" | "low"}';

export const EDIT_SYSTEM_PROMPT = `你是一个公式局部改写器。用户在一条 LaTeX 公式里选中了一个子表达式，并给出修改指令。你会拿到整条公式 full（仅供理解上下文）和选中的子表达式 selection（它可能是分子、下标、某一项等局部，写法与 full 中的对应部分可能有空格差异）。

规则：
1. 只返回替换 selection 的新 LaTeX 片段 replacementLatex。宿主会用结构化编辑器把它放回 selection 原来的位置，所以不要包含 selection 以外的任何内容，也不要重写整条公式。
2. 片段不带定界符，不带 \\label、\\tag，只用 KaTeX 支持的命令。
3. 若指令不清楚，status 填 "unclear"，replacementLatex 填原 selection；指令没说要改成什么（只有"这个""改一下"这类）也算不清楚，不要猜。若指令要求不支持的构造，status 填 "unsupported"，replacementLatex 填原 selection。
4. interpretation 用用户的语言写一句话说明你做了什么，放在 replacementLatex 之前。

输出的 JSON 形状：
${EDIT_RESULT_SHAPE}`;

export function buildEditMessages(req: MathEditRequest): ChatMessage[] {
  const payload = {
    instruction: req.instruction,
    full: req.fullLatex,
    selection: req.selectionLatex,
  };
  return [
    { role: 'system', content: EDIT_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(payload) + contextBlock(req) },
  ];
}

const SCAN_RESULT_SHAPE = '{"spans": [{"block": string, "quote": string, "latex": string, "interpretation": string}]}';

export const SCAN_SYSTEM_PROMPT = `你是笔记里的公式识别器。用户的笔记里，有些地方用文字、口语、听写或不精准的写法描述了数学公式，其他地方是普通笔记。你要找出这些描述，把每一处转换成 LaTeX。只输出一个 JSON 对象，不输出任何其他文字。

输入是 JSON：blocks 是笔记的段落，每段有编号 id 和文字 text。text 里已经排好的公式用 $…$ 标出，代码用反引号 \`…\` 标出。

规则：
1. 要找的是写出了具体数学表达式的片段：用文字描述的公式（"x的平方加y的平方等于1""三分之二""根号下x加1"），不精准的手敲写法（"x^2+1""sinx/x""lim x->0 sinx/x"），以及正文里没有排版的等式、不等式和算式（"f(x)=2x""a>0""(a+b)^2"）。
2. 不要输出：只提到数学名词或概念、没有写出表达式的叙述（"勾股定理很重要""对它求导""这个极限存在""二次函数"）；单独一个字母、数字或变量名（"设 x 为实数"里的 x，"第 3 题"里的 3）；已经用 $…$ 标出的公式，反引号里的代码。
3. quote 必须从所在段落的 text 里逐字复制：同一段落内连续的一段，字符、空格、标点完全一致，不改写、不省略、不跨段落，不包含 $ 和反引号。
4. quote 只含公式本身，不带前后的叙述、连接词和标点。例如"它的导数是 x的平方的两倍。"只取"x的平方的两倍"；"当 x 趋于 0 时"只取"x 趋于 0"。
5. 一处描述输出一项，按在段落里出现的顺序排列。
6. latex 的写法：不带 $、\\[、\\( 定界符，不带 \\label、\\tag，只用 KaTeX 支持的命令；分式写成 \\frac，上下标加花括号，复杂参数用 \\left( \\right) 包住，微分写成 \\, dx。有几种读法时取最常见的一种。
7. interpretation 用中文一句话说明这是什么公式。
8. 没有要转换的片段时，spans 为空数组。

输出的 JSON 形状：
${SCAN_RESULT_SHAPE}`;

// Kept disjoint from the playground's sample note so the demo does not grade the example itself.
const SCAN_FEW_SHOT: [string, string] = [
  JSON.stringify({
    blocks: [
      { id: 'b0', text: '复习二次函数：y等于a x平方加b x加c 的顶点横坐标是负2a分之b。' },
      { id: 'b1', text: '这部分下周再整理，先记住配方法。' },
      { id: 'b2', text: "由 $f(x)=x^2$ 得 f'(x)=2x，所以当 x>0 时函数单调递增。" },
    ],
  }),
  '{"spans":[{"block":"b0","quote":"y等于a x平方加b x加c","latex":"y = ax^{2} + bx + c","interpretation":"二次函数的一般式"},' +
    '{"block":"b0","quote":"负2a分之b","latex":"-\\\\frac{b}{2a}","interpretation":"顶点的横坐标"},' +
    '{"block":"b2","quote":"f\'(x)=2x","latex":"f\'(x) = 2x","interpretation":"f(x) 的导函数"},' +
    '{"block":"b2","quote":"x>0","latex":"x > 0","interpretation":"x 大于 0"}]}',
];

export function buildScanMessages(req: MathScanRequest): ChatMessage[] {
  return [
    { role: 'system', content: SCAN_SYSTEM_PROMPT },
    { role: 'user', content: SCAN_FEW_SHOT[0] },
    { role: 'assistant', content: SCAN_FEW_SHOT[1] },
    { role: 'user', content: JSON.stringify({ blocks: req.blocks.map((b) => ({ id: b.id, text: b.text })) }) + contextBlock(req) },
  ];
}
