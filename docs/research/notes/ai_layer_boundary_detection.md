# 公式编辑器的 AI 层:非正式/口述数学 → 精确公式、选区改写、能力边界检测

> 调研日期:2026-09-25(所有关于模型、价格、延迟、版本的陈述均标注抓取或发布日期)。目标:可复用的 Web 组件(个人笔记),宿主注入一个"输入 → 公式"的函数,需保持 provider-neutral;用户说中文与英文。本文件聚焦 AI 层与边界检测;Typst 语法、编译器诊断、fletcher 交换图等细节见同目录 `typst_alternative.md`(另一位研究者负责),此处只做交叉引用。
>
> 方法说明:除网页一手/二手来源外,本文件含若干**本地实验**(2026-09-25,Apple M4 Pro,Node v24.20.0,npm 当日最新版:`katex` 0.18.9、`mathjax` 4.1.3、`mathlive` 0.110.0、`@cortex-js/compute-engine` 0.134.0、`@unified-latex/unified-latex-util-parse` 1.8.4、`latex-utensils` 7.0.0),实验结论以 npm 包页面作为版本出处标注。

## 1. 如何让模型"只输出公式":提示与输出格式模式;已发表的 text/speech-to-LaTeX 评测

### Takeaway
"只输出公式"最可靠的做法是**结构化输出(JSON Schema + 受约束解码)+ 宿主侧渲染器校验**,而不是靠提示词要求"不要解释":2026 年 Anthropic(`output_config.format`,GA)、OpenAI(`strict: true`)、Google Gemini(`response_format` + `schema`)与 Chrome 内置 Prompt API(`responseConstraint`)都支持按 schema 约束输出,宿主只取 `latex` 字段再做校验即可。学术评测表明该任务并不"简单":口述数学 → LaTeX 上通用 LLM 少样本 CER 约 30–40%(MathSpeech 基准上 GPT-4o 0.390),专门微调的小模型(60M–0.5B)可追平或超越;文档级 LaTeX 生成(TeXpert)Hard 级准确率 <17%。未找到公开的"中文/中英混合非正式文本 → LaTeX"评测。

### Cited Findings
- Claude structured outputs:"Structured outputs guarantee schema-compliant responses through constrained decoding";推荐参数 `output_config.format`(`type: "json_schema"`);旧参数 `output_format`(需 `structured-outputs-2025-11-13` beta header)已废弃;工具可加 `"strict": true`;已 GA,支持 `claude-haiku-4-5-20251001`、Sonnet 4.5/4.6/5、Opus 4.x/5/5.5 等 — [Claude Docs: Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)(抓取于 2026-09-25)
- 同页限制与性能:不支持递归 schema、数值约束(`minimum`/`maximum`/`multipleOf`)、字符串长度约束(`minLength`/`maxLength`)、外部 `$ref`、enum 内复杂类型;支持 `enum`、`const`、`anyOf`、`$ref`/`$defs`;首次使用某 schema 需编译语法、有额外延迟,编译结果缓存 24 小时(仅改 `name`/`description` 不失效);修改 `output_config.format` 会使该会话的 prompt cache 失效 — [Claude Docs: Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- OpenAI Structured Outputs:`response_format` 使用 `json_schema` 且 `strict: true` 时输出保证匹配 schema;普通 JSON mode 只保证合法 JSON、不保证符合 schema;响应含 `refusal` 字段供程序检测拒答(2024-08-06 发布文) — [OpenAI: Introducing Structured Outputs in the API](https://openai.com/index/introducing-structured-outputs-in-the-api/);[OpenAI API docs: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- Gemini API 结构化输出(2026-09 文档):`response_format` 中设 `mime_type: "application/json"` 与 `schema`;支持 JSON Schema 子集(`enum`、`minimum`/`maximum`、`prefixItems`、`minItems`/`maxItems` 等),过大或嵌套过深的 schema 可能被拒;原话 "While output is syntactically correct JSON, always validate values in your application" — [Gemini API: Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- Chrome 内置 Prompt API:`prompt()`/`promptStreaming()` 的 `responseConstraint` 可传 JSON Schema(或正则)约束输出 — [Chrome for Developers: The Prompt API](https://developer.chrome.com/docs/ai/prompt-api)
- "Let Me Speak Freely?"(arXiv 2408.02442,EMNLP 2024 Industry):格式限制(JSON-mode 受约束解码、格式指令、NL-to-Format)使推理任务表现显著下降,限制越严格退化越多;但对分类类任务有利(收窄答案空间、减少解析错误) — [arXiv 2408.02442](https://arxiv.org/abs/2408.02442);.txt(dottxt)发表了反驳文章 "Say What You Mean"(本次未细读) — [dottxt blog](https://blog.dottxt.ai/say-what-you-mean.html)
- 本地实验(2026-09-25,[katex 0.18.9](https://www.npmjs.com/package/katex)):模型若多输出定界符,`$x^2$` 触发 `ParseError` "Can't use function '$' in math mode";`x=1 \label{eq:1}` 触发 "Undefined control sequence: \label";`\begin{equation}`、`\begin{gather}`、`\begin{align}`、`\dfrac` 在 displayMode 下均通过 — 说明"剥定界符 / 禁用 `\label`"必须由宿主兜底
- **Speech-to-LaTeX (S2L)**,arXiv 2508.03542(2025-08-05 提交,ICLR 2026 接收):首个完全开源的大规模数据集,英语与俄语 66,000+ 条人工标注音频 + 571k 合成音频;MathSpeech 基准上公式 CER 与 MathSpeech 模型相当(28% vs 30%),自建 S2L-equations 上大幅领先(27% vs 64%);首个"数学句子识别"基准 S2L-sentences,公式 CER 40% — [arXiv abs 2508.03542](https://arxiv.org/abs/2508.03542)
- S2L 数据:S2L-equations 英语人工 6,535、俄语人工 4,274、英语 TTS 406,122、俄语 TTS 12,669 条,33 位标注者;S2L-sentences 12,395 条英语句子(取自 Proof-Pile arXiv 子集,每句 1–4 个公式,最多 11 个);方案含冻结 Whisper-Large v3 + 微调 Qwen2.5(0.5B/1.5B/7B)或 Qwen2.5-Math-1.5B 后纠错、5/25-shot 提示、端到端 audio-LLM(SALMONN-13B 最好,另测 Qwen-Audio、Gemma-3n、Audio Flamingo-3);主指标 CER,另报 TeXBLEU、ROUGE-1、chrF、WER、METEOR — [arXiv html 2508.03542](https://arxiv.org/html/2508.03542)(逐模型数字经抓取摘要:MathSpeech 基准上 MathSpeech 27.7% / Qwen2.5-0.5B 30.0%;S2L-equations 上 MathSpeech 64.0% / Qwen2.5-0.5B 27.2% / SALMONN-13B 17.5%;前两组与摘要一致,SALMONN 行未二次核对)
- S2L 用 **KaTeX 解析器规范化 LaTeX**(统一记法、去多余空格、补必要花括号),约降低 1% CER — [arXiv html 2508.03542](https://arxiv.org/html/2508.03542)
- **MathSpeech**,arXiv 2412.15655:ASR + 两个 T5-small(各 60M,合计 120M;纠错器 + 口述英文 → LaTeX 翻译器);基准 1,101 条音频、5,583 秒、10 位讲者,来自 MIT OpenCourseWare;平均 CER:MathSpeech 0.298、GPT-4o 0.390、Gemini-Pro 0.400;LLM 基线用 1-shot 提示 — [arXiv html 2412.15655v3](https://arxiv.org/html/2412.15655v3)
- **MathBridge**(arXiv 2408.07081,2024-08-07 提交):约 2,300 万条 LaTeX 公式与英文口述句子配对;T5-large 微调后 sacreBLEU 由 4.77 升至 46.8 — [arXiv 2408.07081](https://arxiv.org/abs/2408.07081)
- **TeXpert**(arXiv 2506.16990,ACL 2025 SDP workshop):440 条自然语言 → LaTeX 代码样本,Simple/Average/Hard 三级,覆盖表格、图、参考文献、文档结构等;评测 9 个 LLM,Hard 级准确率普遍低于 17%;综述指出公式级数据集有 MATH、MathBridge、STEM-POM,表格有 STRUC-BENCH,图像 → LaTeX 有 im2latex-100k — [arXiv 2506.16990](https://arxiv.org/abs/2506.16990);[TeXpert html](https://arxiv.org/html/2506.16990v1)
- Greek2MathTex(arXiv 2412.12167):希腊语语音 → LaTeX 框架 — [arXiv PDF 2412.12167](https://arxiv.org/pdf/2412.12167)

### Inferences
- 推荐的输出 schema(宿主 ↔ 注入函数的契约;全部用字符串/enum,以兼容 Claude 不支持数值约束):
  ```json
  {
    "status": "ok | ambiguous | unsupported | not_math",
    "interpretation": "一句话复述理解(用户语言)",
    "latex": "不含 $ 或 \\[ 的纯公式",
    "alternatives": [{"latex": "...", "interpretation": "..."}],
    "requires": ["tikz-cd"],
    "confidence": "high | medium | low",
    "check": {"kind": "numeric | none", "expected": "19/3"},
    "notes": "已做的假设或纠正"
  }
  ```
  把 `interpretation` 放在 `latex` 之前,相当于给受约束解码留一个极短的"先想后写"槽位(缓解 "Let Me Speak Freely" 指出的格式约束损害推理的问题);`confidence` 用离散 enum 而非 0–1 数值。
- 系统提示要点:① 声明目标渲染器与允许的宏/环境白名单(例如"仅 KaTeX 0.18 支持的命令;禁止 `\label`、`\usepackage`、任何定界符");② 歧义策略(按数学惯例取最可能解释,其余放 `alternatives`,如 `sinx/x` 默认 `\frac{\sin x}{x}`,并**要求输出无歧义写法**);③ 越界策略(需要 tikz-cd 等时 `status="unsupported"`、填 `requires`,不要用 `array` 硬凑);④ 中英混合、听写输入的少样本(见第 8 节)。
- 注入函数若不支持结构化输出(如部分本地模型):要求"只输出一行 LaTeX",用 stop sequence(换行或 ``` )截断,宿主剥离 `$…$`、`\[…\]`、代码围栏;无论哪种方式都以渲染器校验为最终裁决。
- 自建评测建议三合一计分:KaTeX 规范化字符串 + Compute Engine MathJSON 结构等价 + 数值核验(S2L/MathSpeech 用 CER,无法区分"语义等价的不同写法")。

### Gaps
- 未找到"中文/中英混合非正式文本 → LaTeX"的公开评测集或准确率数字;也未找到在公式转换任务上直接比较"结构化输出 vs 纯文本输出"准确率的研究。
- 2026 年各厂商模型在 text-to-LaTeX 上没有公开的横向基准(TeXpert 评测的是 2025 年模型且为文档级任务)。
## 2. 现有产品如何做"非正式文本 → LaTeX",以及歧义与纠正的 UX

### Takeaway
面向学术写作的产品(Overleaf/Writefull 的 Equation Generator、Bibby AI、Underleaf)基本都是"通用大模型 + 预览 → Insert / 重新生成"的轻量 UX,几乎不显式处理歧义;真正成熟的歧义 UX 来自 Wolfram|Alpha 的 "Assuming … / Use … instead"(默认取最常见解释,其余一键切换)。确定性方案(Word 的 UnicodeMath/LaTeX 线性格式、MathLive 的 AsciiMath 转换与 inline shortcuts、Compute Engine 非 strict 解析)速度快但不理解自然语言:本地实验中 Compute Engine 把 `sinx/x` 解析成含虚数单位的乘积、把 `\sin x/x` 规范化为 `\sin(1)`,MathLive 把 `lim_(x->0) sin(x)/x` 转成带 `#?` 占位符且作用域错误的 LaTeX——这正是 AI 层要解决、也要主动暴露的歧义。

### Cited Findings
- Overleaf AI 功能:Table and Equation Generator 可从图片或提示生成表格/公式 LaTeX;免费可用但有每日上限,购买套餐可提高 AI 额度 — [Overleaf AI features](https://www.overleaf.com/about/ai-features);[Overleaf docs: AI features](https://docs.overleaf.com/integrations-and-add-ons/ai-features)
- Digital Science 于 2025-06 为 Overleaf 2,000 万+ 用户推出新一代 AI 写作工具 — [Digital Science blog 2025-06](https://www.digital-science.com/blog/2025/06/digital-science-launches-new-cutting-edge-ai-writing-tools-for-20-million-overleaf-users/)
- Writefull Equation Generator(博文 2024-06-26):自然语言提示或拖拽图片输入;在 Writefull 工具栏打开,显示生成的 LaTeX 预览,`Insert` 插入源码,`Generate` 生成其他版本;当时为 Premium;提示与图片发送至 OpenAI GPT API — [Writefull blog](https://blog.writefull.com/instantly-generate-tables-and-equations-in-writefull-for-overleaf/)
- Bibby AI(arXiv 2602.16432v1,2026-02-18):公式生成接受自然语言描述或手写图片,产出含 align、矩阵、密集符号的 LaTeX;底层模型自述 "Gemini 2.5 Pro fine-tuned for LaTeX and academic style";LaTeXBench-500 上错误检测 91.4%、一键修复 83.7%;**无**公式生成专项准确率或延迟 — [arXiv html 2602.16432](https://arxiv.org/html/2602.16432)
- Bibby 官网示例:输入 "integral of e to the negative x squared from zero to infinity" 生成对应 `\int` 表达式;免费计划,Pro 起价 $15/月(2026 年页面) — [trybibby.com](https://trybibby.com/);[Bibby AI features](https://trybibby.com/ai-features)
- Microsoft Word:`Alt+=` 进入公式,可用 UnicodeMath 或 LaTeX(Microsoft 365 新增)线性格式输入;`Convert > Professional` 或 `Ctrl+=` 构建;Math AutoCorrect 快速输入符号;LaTeX 模式不支持 `\eqarray`、`\Middle`、`\ldiv`、`\dsmash` 等,矩阵用简化语法 `\matrix{a&b\\c&d}` — [Microsoft Support: Linear format equations using UnicodeMath and LaTeX in Word](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)
- Copilot in Word:未找到"自然语言直接插入可编辑公式"的官方功能;第三方博客描述的流程是让 Copilot 输出 LaTeX 再转为 OMML(二手,可信度低) — [ecuacionesaword blog](https://www.ecuacionesaword.com/en/blog/copilot-math-to-word-editable-equations)
- Mathpix 核心为 OCR(图片、PDF、手写 → LaTeX/DOCX/Markdown 等);未找到 2026 年"自然语言 → LaTeX"专门功能的一手说明 — [mathpix.com](https://mathpix.com/);[Mathpix Snip Web docs](https://mathpix.com/docs/snip/editor-overview)
- Wolfram|Alpha:Full Results API 返回 `assumptions`,每个 `assumption` 含 `type`、`word`(被假设的词/短语)、`template` 及一组可选值;界面把"最显然"的解释放首位,其余"一次点击"切换(如 "springfield" 显示当前假设的是哪个 Springfield) — [Wolfram|Alpha Full Results API Reference](https://products.wolframalpha.com/api/documentation);[Stephen Wolfram: Programming with Natural Language (2010)](https://writings.stephenwolfram.com/2010/11/programming-with-natural-language-is-actually-going-to-work/)
- MathLive:`smartFence` 自动把括号变为 `\left...\right`;`smartMode` 检测到文本输入(如 "if x > 0")时切到文本模式;inline shortcuts 把键入序列展开为数学,`inlineShortcutTimeout`(文档示例 750 ms);可作 `smart-fence`、`smart-mode`、`smart-superscript` 属性设置 — [MathLive Customizing](https://mathlive.io/mathfield/guides/customizing/);[MathLive Shortcuts](https://mathlive.io/mathfield/guides/shortcuts/)
- Compute Engine 非 strict 解析只接受"松散 ASCII 记法"(裸函数名 `sin(x)`、`sqrt(x)`、`*`、`**` 等),不是自然语言解析 — [Compute Engine: Parsing and Serializing LaTeX](https://mathlive.io/compute-engine/guides/latex-syntax/)
- **本地实验(2026-09-25,[@cortex-js/compute-engine 0.134.0](https://www.npmjs.com/package/@cortex-js/compute-engine))**:`ce.parse('sin(x)/x', {strict:false})` → `["Divide",["Sin","x"],"x"]`(正确);`ce.parse('sinx/x', {strict:false})` → `["Divide",["Multiply",["Complex",0,1],"n","s","x"],"x"]`(`sinx` 被读作 s·i·n·x,i 当作虚数单位);strict 模式下 `sin(x)/x` → `["Divide",["Multiply",["Complex",0,1],"s",["n","x"]],"x"]`;LaTeX `\sin x/x` 与 `\sin(x/x)` 都被规范化为 `["Sin",1]`,只有 `\frac{\sin x}{x}` 得到 `["Divide",["Sin","x"],"x"]`
- **本地实验(2026-09-25,[mathlive 0.110.0](https://www.npmjs.com/package/mathlive) `convertAsciiMathToLatex`)**:`(x+1)^2` → `\left(x+1\right)^{2}`;`int_1^2 (x+1)^2 dx` → `\int _{1}^{2}\left(x+1\right)^{2}\differentialD x`(`\differentialD` 是 MathLive 专有宏,KaTeX 报 "Undefined control sequence: \differentialD");`lim_(x->0) sin(x)/x` → `\lim_{#?\to#?} _{x\to 0}\sin \frac{x}{x}`(残留 `#?` 占位符,且作用域变成 sin(x/x));`sinx/x`、`x的平方` 原样返回;`sum_(k=1)^n k^2` → `\sum _{k=1}^{n}k^{2}`;`sqrt(x^2+1)` → `\sqrt{x^{2}+1}`

### Inferences
- "sinx/x" 的歧义在 LaTeX 层面同样存在:`\sin x/x` 渲染"看起来对",但语义解析器读成 sin(x/x)。AI 层应输出**无歧义的结构化写法**(`\frac{\sin x}{x}` 或 `\sin(x)/x`),并在 JSON 给出 `interpretation`/`alternatives`;UI 用 Wolfram 式小标签"按 sin(x)/x 理解 · 改为 sin(x/x)"一键切换,而不是弹窗追问。
- 对 "limit->0(sinx/x)" 这类缺变量的输入,模型应补全最可能的变量并在 `notes` 说明"已假设 x→0",UI 低打扰展示。
- 确定性转换(AsciiMath)适合作为 <1 ms 的"即时预览",但会产生跨渲染器方言(`\differentialD`)与占位符残留,必须经过与 AI 输出相同的校验管线,不能直接落库。
- "预览 → Insert → 重新生成"是最低可行 UX;笔记组件在其上加"解释标签 + 备选 + 撤销"即可覆盖大部分纠错需求。

### Gaps
- 未找到 ai-math.io 的可靠一手资料,无法评述。
- 未找到 Copilot in Word 自然语言插入公式的微软官方文档;Mathpix 是否提供 text-to-LaTeX API 未能确认。
- 未找到任何产品公开"歧义检测率"或"用户纠正率"数据。
## 3. 选区内改写(edit-in-place):提示结构、diff 预览、接受/拒绝/撤销

### Takeaway
主流内联编辑(Cursor Cmd+K、VS Code Copilot inline chat、Notion AI、Writefull)收敛到同一骨架:选区 + 指令 → 以内联 diff/预览呈现"待定提案" → 显式接受(Keep / Replace selection / Insert)或拒绝(Undo / Discard)→ 可追加指令迭代;上下文除选区外自动附带当前文件/周边内容。代码编辑工具(Aider)的经验是:输出格式要按"改动规模"选——整文件返回简单但对长文件昂贵,search/replace 省 token 但易匹配失败。公式通常 <200 token,因此最稳妥的协议是**同时返回"选区替换文本"与"完整新公式"**,宿主以完整公式校验、以替换文本做高亮。

### Cited Findings
- Cursor inline edit:选中代码后 `Cmd+K`(Win/Linux `Ctrl+K`),输入指令(文档示例 "Convert this to an async function.")回车即对选区修改;"To refine, add follow-up instructions and press Return again";`Opt+Return`(`Alt+Return`)切换为 quick question 模式,之后输入 "do it" 可应用建议;复杂/多文件修改用 `Cmd+L` 以选区为上下文打开 Agent — [Cursor Docs: Inline edit](https://cursor.com/docs/inline-edit/overview)
- Cursor 上下文策略(教程转述旧版文档):除用户 `@` 引用外,自动寻找相关文件、最近浏览文件等,按相关性排序只保留最相关条目 — [cursor101 tutorial](https://cursor101.com/tutorial/learn-cursor-cmdk)(二手)
- Cursor 提案呈现:以"待定提案"显示,删除行红色、新增行绿色;接受后清除着色 — [learncursor.dev](https://www.learncursor.dev/learn/cursor-basics/cursor-inline-edit)(二手)
- VS Code Copilot inline chat:`⌘I`(`Ctrl+I`)打开;有选区时提示限定于选区,无选区时作用于活动编辑器并可能使用工作区其他文件;"VS Code shows a diff with the code suggestion inline in the editor",用 **Keep** / **Undo** 接受或拒绝;设置含 `inlineChat.defaultModel`、`inlineChat.affordance`(`off`/`gutter`/`editor`)、`inlineChat.askInChat`、`inlineChat.renderMode`(实验) — [VS Code Docs: Inline chat](https://code.visualstudio.com/docs/copilot/chat/inline-chat)
- Notion AI 对选中文本生成结果后提供 "Replace selection"、"Insert below"、"Continue writing"、"Make longer"、"Try again" 与 Discard — [XRAY blog](https://www.xray.tech/post/how-to-use-notion-ai);[SlashGear](https://www.slashgear.com/1304573/notion-ai-note-taking/)(二手)
- Writefull Equation Generator:预览 → `Insert` / `Generate` 重新生成 — [Writefull blog 2024-06-26](https://blog.writefull.com/instantly-generate-tables-and-equations-in-writefull-for-overleaf/)
- Aider 编辑格式:`whole`(返回整个文件;缺点是"slow and costly because the LLM has to return the entire file")、`diff`(`<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` 块,只返回改动部分)、`diff-fenced`(为 Gemini 设计,因其常不遵守 diff 的围栏约定)、`udiff`(简化 unified diff,曾用于减少 GPT-4 Turbo 的 "lazy coding")、`editor-diff`/`editor-whole`(architect 模式中由 editor 模型把方案落为语法正确的编辑) — [Aider: Edit formats](https://aider.chat/docs/more/edit-formats.html)

### Inferences
- 推荐提示结构(基于上述共性推断,非任何产品公开原文):
  - system:角色 + 输出契约("返回 `replacement`(替换 `⟦…⟧` 内片段)与 `full_formula`,不加 `$`、不加解释";越界时 `status="unsupported"` + `requires`)。
  - user:`formula_before`(完整公式,选区用 `⟦` `⟧` 等 LaTeX 中不会出现的标记包住)、`selection`(原文)、`instruction`、可选 `context`(同笔记相邻公式与已定义符号,如"本页 \mathbf{v} 表示向量、用 \mathrm{d} 写微分")、`target`(渲染器 + 允许宏清单)。
  - 输出:`{ status, replacement, full_formula, interpretation, notes }`;宿主校验 `full_formula`(第 4 节),并验证"`formula_before` 去掉选区后的前后缀"与 `full_formula` 一致,防止模型顺手改了选区外内容(类似 Aider SEARCH 块必须精确匹配的约束)。
- 选区需与语法树边界对齐:若用户选中 `\frac{a` 这类残缺片段,先扩展到最近完整子树(借助 MathLive 选区或 unified-latex AST)再发给模型。
- 公式 diff 以**渲染后**的前后对比呈现(改动处高亮),保留一次 `Undo` 与"继续调整"输入框(Cursor/Copilot 的 follow-up 模式);LaTeX 源码 diff 仅作为可展开细节。
- 保持记号一致:在 `context` 中给出本页已用记号(微分 `\mathrm{d}` vs `d`、向量 `\vec` vs `\mathbf`),并在系统提示要求"沿用上下文记号";宿主可用 unified-latex 清点上下文里的宏,自动生成这段约定。

### Gaps
- 未找到 Cursor、Copilot、Notion 内联编辑的**系统提示原文**;上述结构为推断。
- 未找到针对"公式片段改写"的公开评测或产品文档(Overleaf AI Assist 的选区改写细节未获取到一手资料)。
## 4. 程序化校验:宿主如何验证模型输出的 LaTeX;分层(tiered)渲染方案

### Takeaway
浏览器侧已有足够的"机器可读错误信号",但各层宽严不同,必须组合使用:KaTeX 最严格,给出 `position`/`length`/`rawMessage`;MathJax 4 对未定义宏**默认不抛错而是染红**(`noundefined`),对未知环境抛 `UnknownEnv`,部分扩展需异步加载;MathLive `validateLatex()` 能报 `unknown-command`/`unknown-environment`,但本地实验中**漏报缺右括号**;Compute Engine 报 `unknown-environment`/`expected-closing-delimiter` 并给出语义树;unified-latex/latex-utensils 解析极宽容,不适合当语法裁判,但适合清点"用了哪些宏/环境"做白名单。所有校验合计 <1 ms/公式,可每次都跑。建议分层:① AST 清点 → 能力注册表;② KaTeX 严格渲染;③ 失败且属 MathJax 可支持集合 → MathJax 异步渲染;④ 图表类(tikz-cd 等)→ 懒加载浏览器内 WASM TeX(TikZJax)或提示"暂不支持",UI 标明由哪一层渲染、哪个构造不受支持。

### Cited Findings
- KaTeX `throwOnError`(默认 `true`):遇到不支持的命令或非法 LaTeX 抛 `ParseError`;`false` 时把不支持的命令按原文以 `errorColor`(默认 `#cc0000`)渲染 — [KaTeX Options](https://katex.org/docs/options)
- KaTeX `strict`(默认 `"warn"`):`false`/`"ignore"`、`true`/`"error"`、`"warn"`,或函数 `handler(errorCode, errorMsg, token)`;`errorCode`:`unknownSymbol`、`unicodeTextInMathMode`、`mathVsTextUnits`、`commentAtEnd`、`htmlExtension`、`newLineInDisplayMode` — [KaTeX Options](https://katex.org/docs/options)
- KaTeX `trust`(默认 `false`)可为函数 `handler(context)`(`command`、`url`、`protocol`、`class`、`id`、`style`、`attributes`);`maxExpand` 默认 1000;`maxSize` 默认 `Infinity`;`macros` 注入自定义宏;`output` 为 `html`/`mathml`/`htmlAndMathml` — [KaTeX Options](https://katex.org/docs/options)
- KaTeX `ParseError`:`position`(起点)、`length`、`rawMessage`;`message` 形如 `KaTeX parse error: … at position N: …`,用下划线标出出错 token 与前后至多 15 字符上下文 — [KaTeX src/ParseError.ts](https://github.com/KaTeX/KaTeX/blob/main/src/ParseError.ts)
- MathLive `ParserErrorCode`(14 种):`unknown-command`、`invalid-command`、`unbalanced-braces`、`unknown-environment`、`unbalanced-environment`、`unbalanced-mode-shift`、`missing-argument`、`too-many-infix-commands`、`unexpected-command-in-string`、`missing-unit`、`unexpected-delimiter`、`unexpected-token`、`unexpected-end-of-string`、`improper-alphabetic-constant`;`LatexSyntaxError = { code; arg?; latex?; before?; after? }` — [mathlive core-types.d.ts](https://cdn.jsdelivr.net/npm/mathlive/dist/types/core-types.d.ts)
- MathLive 0.110.0(2026-06-08):`validateLatex()` 接受可选 `options.macros`,自定义宏不再报 unknown command — [MathLive Changelog](https://mathlive.io/mathfield/changelog/);Node 端 `mathlive/ssr` 导出 `validateLatex`、`convertLatexToMarkup`、`convertLatexToMathMl`、`convertLatexToSpeakableText`、`convertAsciiMathToLatex`、`convertLatexToAsciiMath`、`convertMathJsonToLatex`(本地实验列出) — [mathlive on npm](https://www.npmjs.com/package/mathlive)
- MathJax 4 TeX 输入 `formatError(jax, err)`:默认生成 `<merror>`;可覆盖以记录、替换或 `throw` 中止;`noerrors` 扩展改为显示原始 TeX — [MathJax TeX Input Options](https://docs.mathjax.org/en/latest/options/input/tex.html);[noerrors](https://docs.mathjax.org/en/latest/input/tex/extensions/noerrors.html);[Detecting Typeset Errors](https://docs.mathjax.org/en/v4.0/web/errors.html)
- Compute Engine:出错时 `expr.isValid === false`,出错处生成 `["Error", …]`,`expr.errors` 返回全部错误节点 — [Compute Engine: Parsing and Serializing LaTeX](https://mathlive.io/compute-engine/guides/latex-syntax/)
- unified-latex:PEG.js 文法 + 基于宏知识的后处理;"should work on your code, unless you do complicated things like redefine control sequences…" — [unified-latex GitHub](https://github.com/siefkenj/unified-latex);`@unified-latex/unified-latex-util-parse` 当前 1.8.4 — [npm](https://www.npmjs.com/package/@unified-latex/unified-latex-util-parse)
- latex-utensils:基于 LaTeX.js 与 siefkenj/latex-parser;AST 节点含 `kind`(`command`、`env`、`inlineMath`、`text.string` 等)与 `location`(offset/line/column);npm 最新 7.0.0(2026-09-25;部分第三方索引仍显示 6.2.0) — [latex-utensils GitHub](https://github.com/tamuratak/latex-utensils);[npm](https://www.npmjs.com/package/latex-utensils)
- **本地交叉实验(2026-09-25;[katex 0.18.9](https://www.npmjs.com/package/katex)、[mathjax 4.1.3](https://www.npmjs.com/package/mathjax)、[mathlive 0.110.0](https://www.npmjs.com/package/mathlive)、[@cortex-js/compute-engine 0.134.0](https://www.npmjs.com/package/@cortex-js/compute-engine);Node v24.20.0)**:

| 输入 | KaTeX(`throwOnError:true` + `strict` 回调) | MathJax 4(`formatError` 改为 throw) | MathLive `validateLatex` | Compute Engine `ce.parse` |
|---|---|---|---|---|
| `\begin{tikzcd} A \arrow[r] & B \end{tikzcd}` | `ParseError` "No such environment: tikzcd",position=6,length=8 | `TexError` id=`UnknownEnv` "Unknown environment 'tikzcd'" | `unknown-environment`(tikzcd)+ `unknown-command`(`\arrow`、`\end`) | `["Error",["ErrorCode","'unknown-environment'","'tikzcd'"],…]`,`isValid=false` |
| `\begin{CD} A @>f>> B \end{CD}`(amscd) | 通过 | 同步 `tex2mml` 抛 "MathJax retry"(需异步加载);`await tex2mmlPromise` 后通过 | `unknown-environment`(CD) | 未测 |
| `\frac{1}{x`(缺右括号) | "Unexpected end of input in a macro argument, expected '}'",position=10,length=0 | id=`MissingCloseBrace` | **返回 `[]`(未报错)** | `["Error","'expected-closing-delimiter'",…]`,`isValid=false` |
| `\qty(\frac{a}{b})`(physics) | "Undefined control sequence: \qty" | **不抛错**,输出 MathML 中 `mathcolor="red"`;加 `\require{physics}` 后正常 | `unknown-command`(`\qty`) | `\qty(x)` → `["Error","'unexpected-command'",…]` |
| `\SI{3}{\meter}`(siunitx) | "Undefined control sequence: \SI" | 不抛错,染红 | `unknown-command`(`\SI`、`\meter`) | — |
| `\xymatrix{A \ar[r] & B}` | "Undefined control sequence: \xymatrix" | id=`Misplaced` "Misplaced &"(误导性) | `unknown-command`(`\xymatrix`、`\ar`) | — |
| `\ce{H2O}`(mhchem) | "Undefined control sequence: \ce"(需 contrib 扩展) | 同步抛 retry;异步在本机 Node 环境 `RequireFail`(可能为环境问题) | 返回 `[]` | — |
| `x的平方`(中文进数学模式) | 通过,但 `strict` 回调收到 3 次 `unicodeTextInMathMode` | — | — | — |
| `$x^2$`(多输出定界符) | "Can't use function '$' in math mode",position=0 | — | — | — |
| `x=1 \label{eq:1}` | "Undefined control sequence: \label" | — | — | — |
| `a \\ b`(display) | 通过,`strict` 回调收到 `newLineInDisplayMode` | — | — | — |
| `\int _{1}^{2}…\differentialD x`(MathLive AsciiMath 转换产物) | "Undefined control sequence: \differentialD",position=33 | — | — | — |
| `align`/`aligned`/`equation`/`gather` 环境、`\dfrac`、`\bra{\psi}`、`\mathscr{L}`、`\text{当 } x>0` | 均通过 | — | — | — |

- 同实验:MathLive `validateLatex` 返回的 `before`/`after` 内容看起来与字段名相反(tikzcd 一例 `after` 为 `"\\begin{tikzcd}"`,`before` 为其后文本),使用前应自测 — 本地实验([mathlive 0.110.0](https://www.npmjs.com/package/mathlive))
- 同实验:unified-latex `parseMath` + `visit` 稳定清点出 `{"macros":["\\arrow"],"envs":["tikzcd"]}`、`{"macros":["\\qty","\\frac","\\SI","\\meter"]}`,但对 `\frac{1}{x` 不报错;latex-utensils 7.0.0 对 `$\frac{1}{x$` 也不报错,但对 tikzcd 给出 `kind:"env", name:"tikzcd"` 与 offset/line/column — 适合"清点 + 定位",不适合"语法裁判" — 本地实验([unified-latex-util-parse 1.8.4](https://www.npmjs.com/package/@unified-latex/unified-latex-util-parse)、[latex-utensils 7.0.0](https://www.npmjs.com/package/latex-utensils))
- 同实验(Apple M4 Pro,预热后均值):KaTeX `renderToString` 5 条典型公式(积分、极限、求和恒等式、`pmatrix`、`cases`)合计约 0.22 ms;MathLive `validateLatex` 约 0.11 ms;Compute Engine `ce.parse` 约 0.58 ms — 校验开销相对 LLM 延迟可忽略
- 第 4 层候选(浏览器内真 TeX):TikZJax 把 TeX 经 web2js 编译为 WebAssembly,加载 latex 格式与 PGF 驱动后 core dump,浏览器内快速重载,经 dvi2html 输出 SVG,"All of this happens in the browser" — [kisonecat/tikzjax](https://github.com/kisonecat/tikzjax);node-tikzjax(浏览器版 `isomorphic-tikzjax`)支持 `tikz-cd`、`pgfplots`、`chemfig`、`circuitikz`、`amsmath`、`amssymb`、`tikz-3dplot` 等 — [prinsss/node-tikzjax](https://github.com/prinsss/node-tikzjax)
- Typst 路线的诊断(severity/span/hints、"unknown variable" 等)见同目录 `typst_alternative.md` 第 4 节。

### Inferences
- **错误分类映射**(宿主内部统一 4 类,决定 UI 文案与是否重试):
  1. `syntax`:缺括号、多余 `$`、`&` 位置错误 → 先本地自动修(剥定界符、去 `\label`、补括号)再验;仍失败则把 `rawMessage` + `position` 回传模型重试 1 次(如"KaTeX 在第 10 个字符报 expected '}'");
  2. `unsupported-construct`:未知环境/包级宏(tikzcd、xymatrix、`\SI`、tikzpicture)→ "超出当前支持范围(可后续添加)",**不重试**;
  3. `renderer-gap`:KaTeX 不支持但 MathJax 可支持(`\require{physics}`、autoload 扩展)→ 自动升级 MathJax 层,小字标注"由 MathJax 渲染(部分内容不可可视化编辑)";
  4. `semantic-warning`:能渲染但语义可疑(`\sin x/x` 被读成 sin(1);数学模式中文 `unicodeTextInMathMode`)→ 低打扰提示或自动改写(如中文包进 `\text{}`)。
- MathJax 作第二层时,必须检测输出中的 `mathcolor="red"` 或从 `packages` 去掉 `noundefined`,否则"看似成功、实有红字"。
- 由于 MathLive 编辑层与 KaTeX 渲染层支持集不同(CD 在 KaTeX 可渲染、MathLive 不认识;`\differentialD` 反之),"可渲染"与"可编辑"应在注册表中分开标注。
- 以 KaTeX 为基准时,可把 `macros` 选项与 MathLive `validateLatex({macros})` 共用同一份用户宏表,保证两层对自定义宏的认知一致。

### Gaps
- 服务端真 TeX(TeX Live + dvisvgm 等)的延迟与部署成本、TikZJax 首次加载体积与单图编译时间均未找到可靠数字。
- 未找到 KaTeX/MathJax "全部支持命令"的官方机器可读清单(KaTeX 有 Supported Functions 文档页,MathJax 有扩展列表,但未确认 JSON 形式)。
- `\ce` 在 MathJax 4 Node 环境加载失败的原因未查明;浏览器端需另测。
## 5. 能力边界设计:让模型声明所需包/环境,并以"不是 AI 出错"的方式告知用户

### Takeaway
能力边界应由**宿主判定、模型辅助声明**:模型在 JSON 中填 `status: "unsupported"` 与 `requires: ["tikz-cd"]`,宿主用 AST 清点(unified-latex / latex-utensils)与渲染器错误码独立复核——本地实验显示 KaTeX、MathJax、MathLive、Compute Engine 对 `tikzcd` 给出一致且可机器识别的信号——再查"能力注册表"映射成三类文案:已支持 / 可自动升级 / 暂不支持(可后续添加)。文案遵循 Google PAIR 与 Microsoft HAX:具体说明限制、给出替代路径、交还控制权;视觉上把"能力边界"与"AI 出错"区分开。tikz-cd 属于现实可补的能力:浏览器内 WASM TeX(node-tikzjax 支持 tikz-cd)或 amscd `CD` 简化版(KaTeX 已支持)。

### Cited Findings
- Google PAIR "Errors + Graceful Failure":错误分为 System Limitation("Your system can't provide the right answer, or any answer at all, due to inherent limitations")、Context Errors(系统按设计工作但未解释清楚而被视为错误)、Background Errors、User Errors;"Messages about user-perceived errors should inform the user as specifically as possible about the system's limitations";低置信时 "Explain why a certain result couldn't be given and provide alternative paths forward";失败时 "Return control to the user";在错误消息与"正确"输出旁都提供反馈入口 — [PAIR: Errors + Graceful Failure](https://pair.withgoogle.com/chapter/errors-failing/)
- 同章建议先定义产品中"什么算错误"及类型,并提供 "Error audit"(约 1 小时)与 "Quality assurance"(约 30 分钟)练习 — [PAIR 章节](https://pair.withgoogle.com/chapter/errors-failing/);[worksheet PDF](https://pair.withgoogle.com/worksheet/errors-failure.pdf)
- Microsoft Guidelines for Human-AI Interaction(18 条):G1 "Make clear what the system can do."、G2 "Make clear how well the system can do what it can do.";When wrong:G7 "Support efficient invocation."、G8 "Support efficient dismissal."、G9 "Support efficient correction."、G10 "Scope services when in doubt."、G11 "Make clear why the system did what it did.";Over time:G15 "Encourage granular feedback."、G17 "Provide global controls."、G18 "Notify users about changes." — [Microsoft Research: 18 best practices](https://www.microsoft.com/en-us/research/group/customer-insights-research/articles/guidelines-for-human-ai-interaction-eighteen-best-practices-for-human-centered-ai-design/);[CHI 2019 论文 PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)
- Microsoft 以 PowerPoint QuickStarter 作为 G1 示例:用说明文字与建议主题告诉用户功能能做什么 — [Microsoft Research](https://www.microsoft.com/en-us/research/group/customer-insights-research/articles/guidelines-for-human-ai-interaction-eighteen-best-practices-for-human-centered-ai-design/)(检索摘要)
- 本地实验(2026-09-25):对 `tikzcd`,KaTeX `ParseError` "No such environment: tikzcd"(position=6,length=8)、MathJax 4 `TexError` id=`UnknownEnv`、MathLive `validateLatex` `unknown-environment`/`tikzcd`、Compute Engine `["Error",["ErrorCode","'unknown-environment'","'tikzcd'"],…]`;unified-latex 清点 `{"macros":["\\arrow"],"envs":["tikzcd"]}` — 详见第 4 节表格([katex](https://www.npmjs.com/package/katex)、[mathjax](https://www.npmjs.com/package/mathjax)、[mathlive](https://www.npmjs.com/package/mathlive)、[@cortex-js/compute-engine](https://www.npmjs.com/package/@cortex-js/compute-engine)、[@unified-latex/unified-latex-util-parse](https://www.npmjs.com/package/@unified-latex/unified-latex-util-parse))
- 同实验:amscd `\begin{CD} … \end{CD}` 在 KaTeX 0.18.9 直接通过,MathJax 4 经异步 `tex2mmlPromise` 自动加载后通过,MathLive `validateLatex` 报 `unknown-environment`(CD)——"简化交换图"可渲染但在 MathLive 编辑层不可编辑
- TikZJax:TeX → WebAssembly(web2js)、core dump 快速重载、dvi2html → SVG,全部在浏览器内完成;`<script type="text/tikz">` 用法 — [kisonecat/tikzjax](https://github.com/kisonecat/tikzjax);[tikzjax.com](https://tikzjax.com/);node-tikzjax / `isomorphic-tikzjax` 支持 `tikz-cd`、`pgfplots`、`chemfig`、`circuitikz` 等,无需安装 LaTeX 工具链 — [prinsss/node-tikzjax](https://github.com/prinsss/node-tikzjax)
- Typst + fletcher 画交换图及其 WASM 可用性见同目录 `typst_alternative.md` 第 6 节。

### Inferences
- **能力注册表(capability registry)**:`{ construct → tier }`,例如 `env:tikzcd → "planned"`("交换图 tikz-cd 暂不支持,可后续添加")、`env:CD → "render-only"`(KaTeX 可渲染、MathLive 不可编辑)、`macro:\qty → "mathjax-upgrade"`(`\require{physics}`)、`macro:\SI → "unsupported"`、`macro:\label → "strip"`、`macro:\differentialD → "rewrite:\mathrm{d}"`。模型的 `requires` 只是提示,最终以 AST 清点 + 渲染错误码为准;二者不一致时记日志用于改进提示。
- 提示中写明越界协议:"若请求需要本编辑器不支持的构造(如 tikz-cd、TikZ 图、xymatrix、siunitx),不要近似替代;返回 `status:"unsupported"`、`requires:[包名]`,可选给出 `alternatives`(如 amscd `CD` 简化版并在 interpretation 中说明'仅水平/竖直箭头')"。
- **文案模板**(PAIR "具体限制 + 替代路径 + 交还控制",HAX G1/G10/G11):
  - 暂不支持:「交换图(tikz-cd)目前超出本编辑器的渲染范围——这不是识别错误,原始 LaTeX 已保留。可:① 改用简化交换图(仅水平/竖直箭头)② 保留源码稍后渲染 ③ 复制到 Overleaf。」
  - 可升级:「已用增强渲染器(MathJax)显示;该公式暂不支持可视化编辑。」
  - 语义存疑:「按 sin(x)/x 理解 · 改为 sin(x/x)」(Wolfram 式假设标签,见第 2 节)。
- 视觉区分:能力边界用中性信息色 + "可后续添加"标签;AI 失败用警告色 + "重试";能力边界**不自动重试**,避免浪费调用与让用户误以为模型不稳定。
- "可后续添加"的落地:检测到 `tikzcd` 时懒加载 isomorphic-tikzjax,仅该块走 WASM TeX,其余仍走 KaTeX;或切 Typst + fletcher。

### Gaps
- 未找到"不支持提示文案"对用户信任影响的公开 A/B 数据;PAIR/HAX 为通用指南,非公式编辑器特定。
- TikZJax / isomorphic-tikzjax 的首屏加载体积与单图编译延迟无可靠数字,需自测。
- 未找到 Overleaf、Notion 等产品在"AI 生成了渲染器不支持的公式"时的具体文案。
## 6. 语义规范形式:MathJSON / Content MathML / SymPy,与自动数值核验

### Takeaway
Compute Engine(npm 最新 0.134.0,2026-09-24)已能在浏览器端把规范 LaTeX 解析为 MathJSON 并求值:本地实验 `\int_1^2 (x+1)^2\,dx` 精确得 `19/3`、`\lim_{x\to 0}\frac{\sin x}{x}` 得 `1`、`\sum_{k=1}^{10}k^2` 得 `385`,`cases` 解析为 `Which`、`pmatrix` 解析为 `Matrix`,单次解析+求值 3–31 ms。因此"用数值结果核对公式是否符合描述"可行;但规范化会把歧义写法"悄悄算掉"(`\sin x/x` → `sin(1)`),所以核验需同时比较**结构**与**数值**。Python 侧成熟方案是 SymPy `parse_latex`(ANTLR/Lark 两种后端)与 Hugging Face 的 Math-Verify(latex2sympy2_extended),适合服务端或离线评测。MathJSON/SymPy 宜作为 LaTeX 的**附加字段**而非替代。

### Cited Findings
- Compute Engine 版本:changelog 显示 0.131.0–0.131.3(2026-09-18)、0.132.0–0.132.2(2026-09-19)、0.132.3(2026-09-20),0.133.0 标为 Coming Soon;npm 最新已为 0.134.0(`time.modified` 2026-09-24) — [Compute Engine Changelog](https://mathlive.io/compute-engine/changelog/);[npm @cortex-js/compute-engine](https://www.npmjs.com/package/@cortex-js/compute-engine)
- 0.131.0 新增 `resolveApplication(context)` 钩子,在"乘法 vs 函数应用"之间自定义决策;破坏性变更:无类型信息的符号后跟括号参数默认解释为函数应用;0.131.1 起 `\overline{z}` 为复共轭;数值积分超时改为抛出调用方 timeout;0.133.0 改进 `evaluate()`/`.N()` 性能 — [Compute Engine Changelog](https://mathlive.io/compute-engine/changelog/)
- 文档站迁移:`cortexjs.io/compute-engine/...` 于 2026-09-25 301 跳转至 `mathlive.io/compute-engine/...` — [旧地址](https://cortexjs.io/compute-engine/changelog/) → [新地址](https://mathlive.io/compute-engine/changelog/)
- `ce.parse()`:`strict`(默认 `true`);默认 canonical 形式,`\frac{7}{-4}` → `["Rational", -7, 4]`,`{ form: 'raw' }` → `["Divide", 7, -4]`;`ce.declare()`/`getSymbolType` 声明符号为函数或变量;`toLatex({ digits, notation, decimalSeparator, fractionStyle })` 控制序列化 — [Compute Engine: Parsing and Serializing LaTeX](https://mathlive.io/compute-engine/guides/latex-syntax/)
- **本地实验(2026-09-25,[@cortex-js/compute-engine 0.134.0](https://www.npmjs.com/package/@cortex-js/compute-engine))**:
  - `\int_1^2 (x+1)^2\,dx` 与 `\int_{1}^{2}(x+1)^{2}\,\mathrm{d}x` → 同一 MathJSON `["Integrate",["Function",["Block",["Power",["Add","x",1],2]],"x"],["Limits","x",1,2]]`;`.evaluate()` → `["Rational",19,3]`;`.N()` → `["Measurement",6.333333333333333,2.02e-19]`(数值积分附误差估计);首次约 20 ms,之后约 3 ms
  - `\lim_{x\to 0}\frac{\sin x}{x}` → `["Limit",…]`,`.evaluate()` → `1`(约 31 ms);`\sum_{k=1}^{10} k^2` → `385`
  - `f(x)=\begin{cases}x^2 & x\ge 0\\ -x & x<0\end{cases}` → `["Equal",["f","x"],["Which",["LessEqual",0,"x"],["Power","x",2],["Less","x",0],["Negate","x"]]]`;`\begin{pmatrix}a&b\\c&d\end{pmatrix}` → `["Matrix",["List",["List","a","b"],["List","c","d"]]]`,均 `isValid=true`
  - `\sin x/x`、`\sin(x/x)` → `["Sin",1]`;`\frac{\sin x}{x}` → `["Divide",["Sin","x"],"x"]`
  - 不支持/非法输入 → `["Error", …]` 且 `isValid=false`(`unknown-environment`、`expected-closing-delimiter`、`unexpected-command`)
- SymPy `parse_latex`:两种后端——ANTLR(默认,移植自 latex2sympy)与 Lark(较新,"intended to eventually completely replace the ANTLR-based parser"),用 `backend="lark"` 切换 — [SymPy 1.14 Parsing docs](https://docs.sympy.org/latest/modules/parsing.html);已知问题:Lark 后端在特定字符串上卡死 — [sympy#27411](https://github.com/sympy/sympy/issues/27411);两后端都把 `3!!` 解析成 `(3!)!`,有 PR 修复 — [sympy PR #30550](https://github.com/sympy/sympy/pull/30550);社区亦有"基于 LLM 的 LaTeX 解析"提案 — [sympy#26128](https://github.com/sympy/sympy/issues/26128)
- Hugging Face Math-Verify:用 latex2sympy2_extended(ANTLR4 文法)把答案解析为 SymPy,先字符串比较再 SymPy 等价,并处理区间 vs 不等式等特例(如金标 `1 < x < 2` 与预测 `(1,2)` 判为等价) — [huggingface/Math-Verify](https://github.com/huggingface/Math-Verify);[latex2sympy2_extended](https://github.com/huggingface/latex2sympy2_extended)
- MathLive 提供 `convertLatexToMathMl`(本地实验导出列表),可生成 MathML — [mathlive on npm](https://www.npmjs.com/package/mathlive)

### Inferences
- **数值核验**:让模型在 JSON 中给出 `check`(如 `{"kind":"numeric","expected":"19/3"}`),宿主用 `ce.parse(latex).evaluate()`/`.N()` 独立计算比较;不一致时标"数值核验未通过"。"写 LaTeX"与"算期望值"是两条相对独立的推理路径,可互相校验。
- **结构核验**:把输出解析成 MathJSON 后检查关键结构(描述为 sin(x)/x 时应含 `["Divide",["Sin","x"],"x"]`),可发现"渲染对、语义错"的输出。
- 选型:Web 组件内优先 Compute Engine(纯 JS、毫秒级);SymPy/Math-Verify 需要 Python(服务端或 WASM Python),更适合离线评测集打分而非交互路径。
- MathJSON 不宜替代 LaTeX 作为存储格式(覆盖不了图表、排版宏),但适合作为附加字段用于核验、搜索和"复制为可计算表达式"。

### Gaps
- Content MathML 路线未找到 2026 年成熟的浏览器端"LaTeX → Content MathML"工具资料(MathLive 的 `convertLatexToMathMl` 输出是否含 Content MathML 未核实)。
- Compute Engine 在多重积分、含参积分、不收敛极限等更复杂输入上的准确率无公开评测;本次实验仅覆盖少量样例。
## 7. 模型选择与延迟/成本(截至 2026-09-25)

### Takeaway
这个"输入几十 token、输出几十 token"的窄任务**成本几乎可以忽略**(按 2026-09 标价,最便宜的托管模型每千次调用约 $0.1–0.5,Haiku 级约 $2),**体验取决于首 token 延迟与中文理解**:托管小模型 TTFT 最快约 0.3 s(Artificial Analysis 2026-09 页面上 Gemini 2.5 Flash-Lite 非推理 0.30 s);浏览器本地 WebGPU 小模型(0.5B–2B)二手测得 TTFT 约 0.5–2 s、解码 20–60 tok/s,中文质量无公开评测;Chrome 内置 Gemini Nano(Prompt API)官方支持语言**不含中文**且硬件门槛高。建议:默认托管 flash/nano/haiku 级**非推理**模型 + 结构化输出;本地模型作可选离线模式;任何路径都先显示确定性预览,再替换为 AI 结果。

### Cited Findings
- **Anthropic(定价页抓取于 2026-09-25,每百万 token 输入/输出)**:Claude Haiku 4.5 $1 / $5(缓存命中 $0.10);Claude Sonnet 5 $2 / $10(原定 2026-09-01 涨至 $3/$15 已取消,$2/$10 成为标准价);Claude Sonnet 4.6 $3 / $15;Claude Opus 5.5 $4 / $20;Batch API 五折;缓存读取为输入价 0.1×(Opus 5.5 为 0.05×);Claude 4.7 及之后模型用新 tokenizer,同样文本约多 30% token — [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **OpenAI(抓取于 2026-09-25,Standard 档,输入/缓存输入/输出)**:`gpt-5-nano` $0.05 / $0.005 / $0.40;`gpt-6-luna` $0.10 / $0.01 / $0.50;`gpt-4o-mini` $0.15 / $0.075 / $0.60;`gpt-5.4-nano` $0.20 / $0.02 / $1.25;`gpt-6-sol` $2.00 / $0.20 / $10.00;`gpt-6-astra` $10.00 / $1.00 / $50.00;另有 Batch、Flex 档;"Priority processing was renamed Fast mode on July 30, 2026"(Standard 的 2–10 倍) — [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing)
- **Google Gemini(页面 "Last updated 2026-09-24 UTC")**:`gemini-3.1-flash-lite` 输入 $0.25(文本/图像/视频;音频 $0.50)/ 输出 $1.50;`gemini-3.5-flash-lite` $0.30 / $2.50;`gemini-3.8-flash` 与 `gemini-3.7-flash` $0.75 / $3.75(至 2026-12-31;2027-01-01 起 $1.50 / $7.50);`gemini-3.5-flash` $1.50 / $9.00;有免费档(限额) — [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- **DeepSeek(抓取于 2026-09-25)**:`deepseek-flash`(DeepSeek-V4.1-Flash,1M 上下文)高峰价输入缓存命中 $0.006 / 未命中 $0.30 / 输出 $1.20,非高峰半价;`deepseek-v4-pro`(V4-Pro-0813)高峰 $0.044 / $1.32 / $3.96;高峰为 UTC 周一至周五 01:00–04:00、06:00–10:00(中国法定假日除外) — [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- **托管延迟**:Artificial Analysis 模型页(抓取于 2026-09-25)最低 TTFT 为 Gemini 2.5 Flash-Lite(非推理)0.30 s,其次 North Mini Code 0.39 s、Command A+ 0.41 s;输出最快 Celeris-1 1,538.2 tok/s、Mercury 2.5 780.8 tok/s;未抓到 Haiku 4.5、OpenAI nano 等数字 — [Artificial Analysis: Models](https://artificialanalysis.ai/models);BenchLM(updated 2026-09-23)摘要称 "Gemini 3.8 Flash leads at 276 tok/s among models scoring 70 or higher",并提醒短请求应看首答延迟而非 tok/s — [BenchLM: LLM speed](https://benchlm.ai/llm-speed)(检索摘要,表格未能抓取)
- MathSpeech(2024 测量):5 秒语音的 ASR 文本转 LaTeX,自研 120M 模型 V100 上 0.45 s,GPT-4o API 0.65 s,Gemini-Pro API 1.53 s — [arXiv html 2412.15655v3](https://arxiv.org/html/2412.15655v3)
- **浏览器本地推理**:WebLLM(arXiv 2412.15803,2024-12-20 提交,2026-04-13 修订)基于 WebGPU + WebAssembly + MLC-LLM/Apache TVM 生成的 kernel,OpenAI 兼容 API,"retain up to 80% native performance on the same device" — [arXiv 2412.15803](https://arxiv.org/abs/2412.15803);二手测评:Qwen2.5-0.5B 在较新集显上 TTFT 约 0.5–2 s、解码 20–60 tok/s,M3 Max 上 Llama 3.1 8B(4-bit)41 tok/s、Phi 3.5 mini 71 tok/s — [TinyWeights.dev](https://tinyweights.dev/posts/run-llm-in-browser-webllm/);Transformers.js WebGPU 比 WASM 快 5–20×(Qwen3 1.7B 在 RTX 4090 上约 28 vs 3 tok/s),Transformers.js v4(2026-02)加深 ONNX Runtime 集成 — [SitePoint](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)(二手,未经官方复核)
- 开源演示:Whisper Web + WebLLM + MathJax 的纯浏览器口述 → LaTeX — [Thomas-McKanna/speech-to-latex](https://github.com/Thomas-McKanna/speech-to-latex)
- **Chrome 内置 Prompt API(Gemini Nano)**:官方文档称网页可用 Chrome 138+ 核心 API;平台 Windows 10/11、macOS 13+、Linux、ChromeOS(Chromebook Plus),不支持 Android/iOS;需 Chrome profile 所在卷 ≥22 GB 可用空间、GPU "strictly more than 4 GB of VRAM" 或 16 GB 内存 + 4 核;支持语言 'en'、'ja'、'es'、'de'、'fr'(**不含中文**);超出上下文抛 `QuotaExceededError` — [Chrome for Developers: The Prompt API](https://developer.chrome.com/docs/ai/prompt-api);二手博客称网页稳定开放始于 Chrome 148,与官方表述不一致 — [pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/3145/gemini-nano-chrome-built-in-ai-client-side-en)
- **专门化模型**:MathSpeech 两个 T5-small(合计 120M) — [GitHub AIDASLab/MathSpeech](https://github.com/AIDASLab/MathSpeech);S2L 用 Whisper-Large v3 + 微调 Qwen2.5-0.5B/1.5B/7B 后纠错(0.5B 在 S2L-equations CER 27.2%),数据集在 Hugging Face `marsianin500/Speech2Latex`,代码与 Colab demo 在 [dkorzh10/speech2latex](https://github.com/dkorzh10/speech2latex) — [arXiv html 2508.03542](https://arxiv.org/html/2508.03542);MathBridge 微调 T5-large sacreBLEU 4.77 → 46.8 — [arXiv 2408.07081](https://arxiv.org/abs/2408.07081)
- **本地实验(Apple M4 Pro,2026-09-25)**:宿主侧校验开销 <1 ms/批(KaTeX 5 条约 0.22 ms、MathLive `validateLatex` 约 0.11 ms、Compute Engine 约 0.58 ms);MathLive `convertAsciiMathToLatex` 可作即时预览,但会产出 `\differentialD` 与 `#?` 占位符 — 见第 2、4 节([katex](https://www.npmjs.com/package/katex)、[mathlive](https://www.npmjs.com/package/mathlive)、[@cortex-js/compute-engine](https://www.npmjs.com/package/@cortex-js/compute-engine))

### Inferences
- **成本估算**(推断:每次 ≈1,300 输入 token〔系统提示 + 少样本 + 输入〕+ 120 输出 token,未计缓存):每 1,000 次 `gpt-5-nano` ≈ $0.11、`gpt-6-luna` ≈ $0.19、`gemini-3.1-flash-lite` ≈ $0.51、`deepseek-flash`(高峰、无缓存)≈ $0.53、`gemini-3.8-flash` ≈ $1.43、Claude Haiku 4.5 ≈ $1.90、Claude Sonnet 5 ≈ $3.80;静态前缀命中缓存后输入成本可再降约一个数量级。个人笔记每月花费约 $0.1–$20,选型应看延迟、中文理解与稳定性。
- **延迟预算**:显式触发(回车/Tab/按钮/听写结束)而非逐键触发;"边打边转"用 150–300 ms 防抖 + AbortController 取消过期请求 + 规范化输入缓存;先显示确定性预览(<1 ms),AI 结果到达后替换并标注;结构化输出首个 schema 有编译延迟(Claude 缓存 24 h),应在组件初始化时预热。
- **模型档位**:默认非推理/低推理档(思考 token 会把 TTFT 拉到秒级);"选区改写 + 长上下文"可升级到中档;失败最多重试 1 次并附校验器 `rawMessage`/`position`。
- **本地模型**:0.5B–2B 在中英混合、口述输入上的质量无公开评测;Gemini Nano 不支持中文且门槛高,不宜作为本用户主路径。若需离线,可用 S2L 公开数据 + 自建中文样本微调 Qwen 系 0.5B–1.5B,经 WebLLM/Transformers.js 运行(需自测体积与速度)。
- **宿主注入函数接口**(provider-neutral):`(req: {text, mode: "convert"|"edit", selection?, context?, target: {renderer, allowedMacros}}) => Promise<FormulaResult>`,`FormulaResult` 即第 1 节 schema;适配器把各家结构化输出参数(Claude `output_config.format`、OpenAI `response_format` json_schema + `strict`、Gemini `response_format` + `schema`、Prompt API `responseConstraint`)映射到同一 schema。

### Gaps
- 2026-09 各托管小模型在"短提示 + 短输出"下的统一 TTFT 数据缺失(Artificial Analysis 仅抓到部分,BenchLM 表格为空);Haiku 4.5、`gpt-6-luna`、`gemini-3.x-flash-lite`、`deepseek-flash` 需自测。
- WebGPU 上 Qwen3/Qwen3.5 0.6B–0.8B 的官方基准与下载体积未找到。
- OpenAI、Gemini 的新模型名与价格经两次抓取复核;DeepSeek 未二次复核;各家模型在中文数学口语上的准确率无公开对比。
## 8. 语音:听写转写中的口述数学模式(中英文)及论文处理方式

### Takeaway
macOS 听写只输出纯文本,其"数学"命令仅覆盖少量符号("plus sign"、"equal sign" 等),宿主拿到的是"未结构化的口述数学",与 MathSpeech/S2L 的"ASR 后纠错 → LaTeX"阶段同构。英文侧主要问题是同音误识别("sine"→"side")、数字写法歧义、作用域歧义("one over x plus two");中文侧的额外特点是分数"分母先读"(三分之二)、幂次"的平方/的 n 次方"、"根号下"、三角函数常用英文读法(sine)与中英混说。目前没有公开的中文口述数学 → LaTeX 数据集,只能从 TTS 方向(LaTeX → 中文朗读)的规则文档反推读法。

### Cited Findings
- macOS 听写数学符号命令:"equal sign" → =、"greater than sign" → >、"less than sign" → <、"minus sign" → -、"multiplication sign" → x、"plus sign" → +;度数与百分号归在 Typography;对支持的语言会自动加部分标点 — [Apple Support: Commands for dictating text on Mac](https://support.apple.com/guide/mac-help/commands-for-dictating-text-on-mac-mh40695/mac)
- 阿里云 CosyVoice LaTeX 中文朗读规则(仅中文、中小学数学、仅 cosyvoice-v2):`\frac{2}{3}` → "三分之二";`2^{1}` → "二的一次方";`\sqrt{9} = 3` → "根号下九等于三";`\pi` → "派";`\sin 30^{\circ}=\frac{1}{2}` → "sine三十度等于二分之一";`\triangle ABC` → "三角形ABC";`\leq` → "小于等于";`\because a = b \therefore b=a` → "因为a等于b所以b等于a";"若分隔符中包含中文字符,可能导致语音合成结果不准确" — [阿里云:CosyVoice 朗读 LaTeX](https://help.aliyun.com/zh/isi/developer-reference/cosyvoice-support-for-latex)
- 讯飞 TTS LaTeX(仅中文、中小学数学):`\frac{2}{3}` → "三分之二"、`\sqrt{9}=3` → "根号下九等于三"、绝对值读作"…的绝对值";**不支持**求和 `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`、数列极限 `\lim`、向量 `\vec`、矩阵 `\mathbf{A}` — [讯飞开放平台:LaTeX 能力支持说明](https://www.xfyun.cn/doc/spark/tts_latex.html)
- MathSpeech 三类误差:严重噪声、非母语口音误识别、标签歧义("1" vs "one");"i sine of x" 被转成 "i side of x";纠错器吃两路 ASR 候选,两路 top-1 组合 CER 0.269(GPT-4o 同设置 0.373) — [arXiv html 2412.15655v3](https://arxiv.org/html/2412.15655v3)
- S2L:讲者看公式与"参考读法"后朗读,另用 XTTSv2、SaluteSpeech 合成;"one over x plus two" 可对应 1/(x+2) 或 1/x+2;常见错误为符号替换、缺 `\text{...}`、嵌套分式、下标错误,"Majority of differences … are small lexical or index-level discrepancies" — [arXiv html 2508.03542](https://arxiv.org/html/2508.03542)
- S2L 仅英语与俄语,数据集 `marsianin500/Speech2Latex`(66k 人工 + 571k 合成) — [dkorzh10/speech2latex](https://github.com/dkorzh10/speech2latex);MathBridge 约 2,300 万对(仅英文) — [arXiv 2408.07081](https://arxiv.org/abs/2408.07081);Greek2MathTex 为希腊语 — [arXiv PDF 2412.12167](https://arxiv.org/pdf/2412.12167)
- 浏览器端 Whisper Web + WebLLM 口述 → LaTeX 演示 — [Thomas-McKanna/speech-to-latex](https://github.com/Thomas-McKanna/speech-to-latex)
- 本地实验(2026-09-25):确定性转换器处理不了中文与连写——MathLive `convertAsciiMathToLatex("x的平方")`、`("sinx/x")` 原样返回;KaTeX 对 `x的平方` 的 `strict` 回调报 3 次 `unicodeTextInMathMode` — 本地实验([mathlive 0.110.0](https://www.npmjs.com/package/mathlive)、[katex 0.18.9](https://www.npmjs.com/package/katex))

### Inferences
- **中文口述/非正式输入模式清单**(用于少样本与测试集;依据上述读法规则与用户示例推断,未经语料统计):
  - 分数倒序:"x 加 1 分之 1" = `\frac{1}{x+1}`;"二分之一" = `\frac12`;"分之"作用域同样有歧义("x 分之一加二")。
  - 幂与根:"x 的平方/立方/n 次方" = `x^2`/`x^3`/`x^n`;"根号下 x 加 1" 作用域不清(`\sqrt{x+1}` vs `\sqrt{x}+1`);"三次根号下" = `\sqrt[3]{…}`。
  - 积分/极限/求和语序:"(x+1)^2 从 1 到 2 的定积分"、"从 1 到 2 对 x 积分"、"x 趋于 0 时 sinx 比 x 的极限"、"k 从 1 到 n 求和";被积函数可在上下限前或后;"定积分"意味着需要上下限,"不定积分"是否补 `+C` 应在提示中规定。
  - 中英混说与字母音译:"sine / cos / log / e 的 x 次方";字母可能被转成汉字音("艾克斯"= x、"派"= π、"西格玛"= σ/Σ、"阿尔法"= α);ASCII 与中文混写("limit->0(sinx/x)")。
  - 听写符号冲突:英文听写 "multiplication sign" 输出字母 x,与变量 x 冲突,提示中要求结合上下文判断乘号。
- 提示中显式说明"输入来自语音听写,可能含同音误识别(英文 side/sine,中文同音字),按数学上下文纠正,并在 `notes` 列出纠正";长句允许 `status:"ambiguous"` + 多个 `alternatives`,UI 以可点选芯片呈现。
- 数学模式中的中文(如"当 x>0 时")应包进 `\text{}`;可用 KaTeX `strict` 回调捕获 `unicodeTextInMathMode` 作为自动修复触发器。

### Gaps
- 未找到任何公开的中文口述数学 → LaTeX 数据集或论文;中文 ASR 在数学词汇上的同音错误分布无公开统计。
- 未找到 macOS 中文听写的符号命令官方列表,也未找到 macOS 听写是否把 "x squared" 等短语自动格式化为 `x²` 的官方说明。
