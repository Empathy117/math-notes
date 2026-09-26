# 公式的规范存储形式（source of truth）与格式间转换工具调研

> 版本 v1.0，调研日期 2026-09-25。目标场景：面向个人笔记的 Web 组件，需要结构化点击编辑、实时渲染、精确导出 LaTeX/Markdown、导入任意粘贴的 LaTeX、AI 生成与改写子表达式、可选语义操作（求值/化简/判等），并在之后复用到学习系统（搜索、Anki 卡片、间隔重复、去重、笔记互链）。
> 凡注明“WebFetch 摘要”或“搜索摘要”的条目，是工具对页面的二次概括，建议人工复核原文。

## Q1 各格式的特性：字符串还是树、是否保留作者意图、往返能力、哪些编辑器/渲染器原生消费

### Takeaway
LaTeX 字符串是生态中唯一被几乎所有笔记/学习产品和渲染器原生消费的格式（KaTeX、Temml、MathJax、MathLive、MathQuill、Notion、Obsidian、Anki、Jupyter、GitHub、RemNote、Typora、Wikipedia、pandoc），但它只是字符串、语义弱。Presentation MathML、OMML、MathJSON、Content MathML 是树：前两者表达呈现，后两者表达语义；MathJSON 官方明确声明不能替代 LaTeX 或 MathML 做视觉表示；Content MathML 从未在浏览器中实现渲染。Typst、AsciiMath、UnicodeMath 是各自语法的字符串，消费方集中在各自生态（Typst、MathJax/AsciiDoc、Office）。

### Cited Findings
**LaTeX**
- MathLive 的值就是 LaTeX 字符串；0.110.0（2026-06-08）起 `getValue()` 不再提供 `"math-json"`，MathJSON 需另行调用 `MathfieldElement.computeEngine.parse(mf.getValue()).json`。 — [MathLive CHANGELOG](https://raw.githubusercontent.com/arnog/mathlive/master/CHANGELOG.md)
- MathQuill 以 `latex()` 方法读写内容（`mathField.latex('2^{\\frac{3}{2}}')` / `mathField.latex()`）；许可证 MPL-2.0；README 称项目“正在恢复活跃开发”。 — [mathquill/mathquill](https://github.com/mathquill/mathquill)
- Notion 用 KaTeX 渲染 LaTeX；Obsidian、GitHub、Jupyter、Typora、Anki 用 MathJax；RemNote 用 KaTeX（详见 Q3/Q6）。 — [Notion Help](https://www.notion.com/help/math-equations)、[Obsidian Help](https://obsidian.md/help/advanced-syntax)、[GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)、[Jupyter Notebook Docs](https://jupyter-notebook.readthedocs.io/en/stable/examples/Notebook/Working%20With%20Markdown%20Cells.html)、[Typora Math](https://support.typora.io/Math/)、[Anki Manual](https://docs.ankiweb.net/math.html)、[RemNote Help](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- 数学检索基准 ARQMath 指出：LaTeX→Presentation MathML 是“外观表示之间”的直接转换；从 LaTeX 生成 Content MathML“需要推断，因此可能出错”。ARQMath 同时提供 LaTeX 原串、Symbol Layout Tree（以 Presentation MathML 表示）与 Operator Tree（以 Content MathML 表示）三种表示。 — [Overview of ARQMath 2020](https://www.cs.rit.edu/~dprl/ARQMath/2020/papers/Errata-TableA2-Overview_of_ARQMath_2020.pdf)（搜索摘要）

**Presentation MathML / MathML Core**
- MathML Core 是面向浏览器的 MathML 核心子集，仅含呈现标记（token 元素 mi/mn/mo/mtext/ms/mspace、分式/根式/上下标/表格、math 相关 CSS、OpenType MATH 集成）；MathML3 中不适合或不够基础的部分移到 MathML 4；Content MathML 不在其范围内；`intent`/`arg` 属性仅“保留为合法”，不定义可观察行为。 — [MathML Core Editor's Draft (2026-07-27)](https://w3c.github.io/mathml-core/index.html)
- MDN：MathML 3/4 的语义子集“从未在浏览器中实现”，布局子集导致实现不完整不一致，MDN“强烈建议”转向 MathML Core。 — [MDN: MathML](https://developer.mozilla.org/en-US/docs/Web/MathML)

**Content MathML / MathML 4**
- MathML 4.0 仍是 W3C Working Draft（2026-06-04）；定义 `intent` 属性（配合 `arg` 引用子元素，主要服务无障碍）、Strict Content MathML 及把非严格内容标记改写为严格形式的变换（附录 F）、第 6 章用 `<semantics>` + `<annotation>`/`<annotation-xml>` 组合呈现与内容标记（并行标记）。 — [MathML 4.0 (W3C TR)](https://www.w3.org/TR/mathml4/)

**MathJSON**
- MathJSON 是基于 JSON 的树：number、symbol、string、function（`["Add", 1, "x"]` 或 `{"fn": [...]}`）、dictionary；简写形式不能携带元数据；对象形式可带 `wikidata`、`comment`、`documentation`、`latex`、`sourceUrl`、`sourceContent`、`sourceOffsets`、`hash`。 — [MathJSON Standard](https://mathlive.io/math-json/)（原 cortexjs.io 已 301 至 mathlive.io）
- 官方声明：“MathJSON is not intended to be suitable as a visual representation of arbitrary mathematical notations, and as such is not a replacement for LaTeX or MathML.” — [MathJSON Standard](https://mathlive.io/math-json/)

**OMML / OfficeMath**
- OfficeMath 的内存格式是 “built-up”（Professional）表示；OMML 是镜像该内存模型的 XML 格式，之所以另造 OMML 是因为 Presentation MathML 缺少 n-ary 与 math-function 元素；“按最佳实践，不带 `<semantics>` 的 MathML 可以往返 OfficeMath 公式，修订标记、嵌入对象等非数学格式除外”；UnicodeMath 模式自动 build-up，Word 的 LaTeX 模式需手动请求 build-up；Word 2007 与 RichEdit 6.0 首先引入，PowerPoint/Excel/OneNote 于 2010 跟进，Mac Word 2011。（博文 2022-04-28） — [Math in Office: OfficeMath](https://devblogs.microsoft.com/math-in-office/officemath/)
- Word 支持 UnicodeMath 与 LaTeX 两种线性格式，仅 Word 支持 LaTeX 线性格式，其他 Office 应用只支持 UnicodeMath；Word 的 LaTeX 是方言：矩阵用 `\matrix{}`，不支持 `\begin{matrix}`/`\end{}`，明确不支持 `\eqarray`、`\Middle`、`\ldiv`、`\dsmash`；适用 Word for Microsoft 365/2024/2021/2019/2016。 — [Microsoft Support: Linear format equations using UnicodeMath and LaTeX in Word](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)

**UnicodeMath**
- UTN #28 “UnicodeMath, A Nearly Plain-Text Encoding of Mathematics”，Version 3.3，2025-01-22，作者 Murray Sargent III；轻标记线性记法，可在纯文本与排版形式间转换；社区工具 UnicodeMathML 做 UnicodeMath↔MathML。 — [Unicode UTN #28](https://www.unicode.org/notes/tn28/)
- UnicodeMath 与 LaTeX 线性输入存在歧义：`a^10+b^10=c^10` 在 UnicodeMath 中是 a¹⁰，在 LaTeX 中是 a¹0；`\mathbf{`、`{n\choose k}` 等是可识别的 LaTeX 特征。 — [Math in Office: Recognizing LaTeX Input in UnicodeMath Input Mode](https://learn.microsoft.com/en-us/archive/blogs/murrays/recognizing-latex-input-in-unicodemath-input-mode)（搜索摘要）

**AsciiMath**
- AsciiMath 是易写的数学标记语言，经 MathJax（4 或 2）或 ASCIIMathML.js（转为 Presentation MathML）渲染；不支持 LaTeX 环境，矩阵写成 `[[a,b],[c,d]]`，下标须写在上标之前，复杂构造覆盖有限。 — [asciimath.org](https://asciimath.org/)

**Typst math**
- `$x$` 为行内、`$ x $`（两侧有空格）为块级；单字母原样显示，多字母被解释为变量/函数（字面多字母需加引号 `"area"`）；数学调用 `frac(a, b)`、`mat(...)`（`;` 分行）、`vec`、`cases`、`lr`、`accent`、`attach`；符号来自 sym 模块并可加修饰符变体；`\` 换行、`&` 对齐点；`#` 进入代码模式（如 `#let`）。 — [Typst Docs: Math](https://typst.app/docs/reference/math/)

### Inferences
- 格式对比（基于上述引文的归纳）：

| 格式 | 形态 | 表达的意图 | 原生消费者（2026） | 与 LaTeX 的往返 | “不支持构造”的表达方式 |
|---|---|---|---|---|---|
| LaTeX | 字符串，宏可扩展 | 呈现为主（`\operatorname` 等弱语义） | KaTeX、Temml、MathJax、MathLive、MathQuill、Notion、Obsidian、Anki、Jupyter、GitHub、RemNote、Typora、Wikipedia(texvc)、pandoc、Word(方言) | —— | 相对某个渲染器而言：KaTeX/Temml 以 `errorColor` 显示源码；pandoc 回退为原样 TeX |
| Presentation MathML | XML 树 | 呈现 | 浏览器（MathML Core）、Word（经 XSLT）、pandoc | LaTeX→PMML 成熟；PMML→LaTeX 有损 | `<semantics>` + `<annotation encoding="application/x-tex">` 携带源码 |
| Content MathML | XML 树 | 语义 | 浏览器不渲染；LaTeXML（部分）、SnuggleTeX（遗留）、CAS | 从 LaTeX 生成需推断、易错 | `<annotation-xml>` 并行标记 |
| MathJSON | JSON 树 | 语义（默认 canonical 化） | Compute Engine | 不承诺往返 | `["Error", code, context]` + `LatexString` |
| Typst math | 字符串 | 呈现为主 | Typst（0.15 起 HTML 导出为 MathML）、MathLive 导出、pandoc/texmath | tex2typst、MiTeX、texmath 均有未覆盖命令 | 可在 Typst 内用 MiTeX 嵌入 LaTeX |
| OMML | XML 树（OfficeMath 内存模型） | 呈现（含 n-ary、函数结构） | Word/PowerPoint/Excel/OneNote | Word 线性 LaTeX（方言）、pandoc/texmath | OOXML `mc:AlternateContent` + `mc:Fallback` 图片 |
| AsciiMath | 字符串 | 呈现，语法易歧义 | MathJax、ASCIIMathML.js | 无环境，无法表达多行对齐 | 无机制 |
| UnicodeMath | 近纯文本字符串 | 呈现 | Office | 与 LaTeX 线性输入有歧义 | 未见公开机制 |

- 对“精确导出 LaTeX/Markdown + 导入任意粘贴 LaTeX”这两个硬需求，只有“原始 LaTeX 字符串”能做到字节级无损；任何以树为真源的方案都要经过序列化，而序列化会规范化（见 Q2、Q4 的 MathLive/Compute Engine 证据）。
- 语义格式（MathJSON、Content MathML）适合作为派生物（判等、化简、去重、检索），不适合作为真源：前者官方否认其视觉表示能力，后者从 LaTeX 生成需要推断并且易错。

### Gaps
- 没有找到覆盖这 8 种格式、带统一指标的往返保真度基准；各工具只有零散的测试或基准。
- MathML Core 中 `<semantics>` 的具体渲染行为（只渲染第一个子元素、隐藏 annotation）本次未在规范原文中核实。
- Apple Math Notes 与 Mathcha 的内部存储格式没有公开文档。

## Q2 转换工具及其保真度（含已知信息丢失）

### Takeaway
LaTeX→Presentation MathML 路径成熟且有多家实现（Temml、KaTeX、MathJax 4、LaTeXML、pandoc/texmath、WikiTexVC），且多数能把原始 TeX 放进 `<annotation>`，因此 MathML 可作为自带源码的导出物。反方向和跨格式转换（MathML→LaTeX、LaTeX↔Typst、OMML↔LaTeX、LaTeX→Content MathML/MathJSON）都可用，但各有明确的有损边界。主要丢失点：宏、`\label`/`\ref`/`\tag`、颜色、`\text` 周边、对齐环境、空格命令，以及规范化带来的结构改变。

### Cited Findings
**LaTeX → Presentation MathML**
- **Temml** v0.13.5，MIT，作者 Ron Kok：选项 `annotate`（把 TeX 源写入 `<annotation>`）、`wrap`（"none"/"tex"/"="）、`macros`、`throwOnError`、`errorColor`（默认 #b22222）、`trust`、`colorIsTextColor`、`leqno`、`xml`；支持 `\label`/`\ref`/`\eqref`（经 `postProcess()`）、align/alignat/gather/CD、mhchem；已知 Chromium/WebKit 的可伸缩箭头与根指数有问题，Safari 不支持自动换行。 — [Temml Administration](https://temml.org/docs/en/administration)
- Temml 官方对比页对比 Temml 0.13.02、MathJax 4.0、KaTeX 0.16.27、TeXZilla 1.0.2.0 的逐命令输出；没有给出总计数；TeXZilla 覆盖最窄；对比表中 KaTeX 没有 mhchem、MathJax 的部分功能需扩展（bbox、braket、化学）。 — [Temml: Comparison](https://temml.org/docs/en/comparison)（WebFetch 摘要）
- **KaTeX** 最新 v0.18.9（2026-09-23）；近期版本：v0.18.8 修复 align 尾行保留，v0.18.7 新增 `\reflectbox`、`\mapsfrom`，v0.18.4 把非法环境名改为报 ParseError，v0.18.2 修复 settings 原型污染。 — [KaTeX Releases](https://github.com/KaTeX/KaTeX/releases)
- KaTeX `output: "html" | "mathml" | "htmlAndMathml"`（默认后者）；`throwOnError: false` 时“把不支持的命令渲染为文本，把非法 LaTeX 以源码形式按 `errorColor`（默认 #cc0000）显示并带悬停错误信息”；另有 `macros`、`globalGroup`、`strict`、`trust`、`maxExpand`（默认 1000）。 — [KaTeX Options](https://katex.org/docs/options)
- KaTeX 的 MathML 输出结构为 `<semantics><mrow>…</mrow><annotation encoding="application/x-tex">原始TeX</annotation></semantics>`，copy-tex 等功能依赖该 annotation。 — [zatex issue #119（对照 KaTeX 行为）](https://github.com/gregoreesmaa/zatex/issues/119)（二手来源）；pandoc 也有“从 HTML 中识别 KaTeX 数学并只提取 LaTeX 源”的需求： [jgm/pandoc#9971](https://github.com/jgm/pandoc/issues/9971)
- KaTeX 覆盖面：支持 `\def`/`\gdef`/`\newcommand`/`\renewcommand`/`\providecommand`（≤9 参数，全局变体跨公式持久）；`\color`、`\textcolor`、`\colorbox`、`\fcolorbox`；`\text{…}` 可嵌 `$…$`；空格命令 `\,` `\:` `\;` `\quad` `\qquad` `\phantom` `\kern` `\hspace`；环境有 matrix 系列、array、align/align*、aligned、gather、alignat、cases/rcases、equation、split、subarray；支持 amscd 的 `CD`，tikz-cd、xymatrix 不在列表；`\htmlId`/`\htmlClass`/`\htmlStyle`/`\htmlData` 需 `trust`；函数表中没有 `\label`/`\ref`/`\eqref`。 — [KaTeX Supported Functions](https://katex.org/docs/supported)
- **MathJax 4.0.0** 于 2025-08-05 发布：新默认字体与 11 种字体、行内与行间公式自动换行、默认开启表达式浏览器、语音生成移到 web worker、TeX/MathML 中可嵌 HTML、ES6 模块、更新 mathtools；之后已发布 v4.1.0。 — [MathJax v4.0.0 now available](https://www.mathjax.org/MathJax-v4.0.0-available/)、[What's New in v4.0](https://docs.mathjax.org/en/latest/upgrading/whats-new-4.0.html)、[mathjax-users: v4.1.0 released](https://groups.google.com/g/mathjax-users/c/fhmW1tLkrBQ)
- **LaTeXML**：手册版本 0.8.8（2024-02-26）。`latexmlpost` 的 `--pmml`（html5/xhtml 默认开启）、`--cmml`（默认关闭，“only partially implemented”）、`--openmath`（部分实现）、`--keepXMath`（保留中间 XMath）、`--mathtex`（在并行标记中加入 TeX annotation）、`--mathimages`、`--mathsvg`。 — [LaTeXML Manual](https://math.nist.gov/~BMiller/LaTeXML/manual/)、[latexmlpost](https://math.nist.gov/~BMiller/LaTeXML/manual/commands/latexmlpost.html)
- **arXiv 上的 LaTeXML 规模化结果**（Ginev、Miller 等，arXiv:2605.16562，2026-05-15）：约 97% 的投稿能产出“某种 HTML”，这是可用性上限而非质量指标；约 75% 无 LaTeXML 错误；目标 90% 无错；2025 至 2026-04 约 6,000 条用户报告，已解决约一半；主要失败来自新宏包及依赖迁向 LaTeX3，另专门改进了 TikZ/xy 图；公式标 MathML 4 `:literal` intent，并在 `<math>` 内以 annotation 保留原始 TeX；LaTeXML v0.9 预计 2026 夏；Rust 重写版快 10–30 倍，输出与 Perl 版一致。 — [arXiv:2605.16562](https://arxiv.org/html/2605.16562v1)
- **WikiTexVC**（Stegmüller & Schubotz，arXiv:2401.16786，2024-01-30）：在 MediaWiki 内（PHP）校验 LaTeX 并直接转 MathML，不再依赖外部服务；30 万+ 公式纳入 CI；对 423 个公式与其他 MathML 渲染器比较解析树编辑距离；已用于德语 Wikipedia 并随新版 MediaWiki 发布。 — [arXiv:2401.16786](https://arxiv.org/abs/2401.16786)

**LaTeX → Content MathML（语义）**
- **MathMLben**（Schubotz 等，JCDL 2018）：305 个人工语义标注公式（Wikipedia、DLMF、NTCIR arXiv/Wikipedia 查询）；评测 9 个工具（LaTeXML、LaTeX2MathML、Mathoid、SnuggleTeX、MathToWeb、TeXZilla、Mathematical、CAS、POM tagger）；只有 LaTeXML 与 CAS 输出 Content MathML；以树编辑距离衡量，LaTeXML 在呈现树与内容树上错误都最低。结论：“Many converters simply do not support the conversion from presentation to content format, and those that did often yielded mathematically incorrect content representations even for basic input data.” — [ar5iv: Improving the Representation and Conversion of Mathematical Formulae by Considering their Textual Context](https://ar5iv.labs.arxiv.org/html/1804.04956)
- **SnuggleTeX**（Java）：可把 LaTeX“up-convert”为 Content MathML 再转 Maxima 输入；不是所有能转成 Content MathML 的输入都能再转成 Maxima；项目以“legacy repository”形式挂在 SourceForge，在线 webapp 版本为 1.2.2。 — [SnuggleTeX: Generating Maxima Input](https://math-xserver.mitx.mit.edu/snuggletex-webapp-1.2.2/documentation/generating-maxima-input.html)、[SnuggleTeX legacy repository](https://sourceforge.net/p/snuggletex/news/)

**LaTeX ↔ MathJSON（Cortex Compute Engine）**
- 解析：`ce.parse(latex, options)`；`form: 'raw'` 返回“更接近字面 LaTeX 输入”的非规范表达式（默认 canonical）；`parseNumbers: "auto" | "rational" | "never"`；`strict`（默认 true；false 时接受 `sin(x)`、`*`）；`skipSpace`（默认 true）；`preserveLatex: true` 用源 LaTeX 片段装饰表达式；钩子 `getSymbolType`、`parseUnexpectedToken`、`resolveSymbol`、`resolveApplication`。 — [Compute Engine: Parsing and Serializing LaTeX](https://mathlive.io/compute-engine/guides/latex-syntax/)
- 序列化：`expr.latex`；`expr.toLatex(options)`：`prettify`（默认 false）、`invisibleMultiply`（默认 `""`）、`multiply`（默认 `\times`）、`missingSymbol`（默认 `\placeholder{}`）、`fractionStyle`/`rootStyle`/`powerStyle`/`groupStyle`/`applyFunctionStyle`/`logicStyle`/`numericSetStyle` 回调、`digits`/`notation`/`avoidExponentsInRange` 等。 — [同上](https://mathlive.io/compute-engine/guides/latex-syntax/)
- 字典定制：`new LatexSyntax({ dictionary: [...LATEX_DICTIONARY, customEntry] })`；条目字段 `kind`（prefix/postfix/infix/expression/function/symbol/environment/matchfix）、`latexTrigger`/`symbolTrigger`、`parse`、`serialize`、`name`、`precedence`；后加条目覆盖前者。 — [同上](https://mathlive.io/compute-engine/guides/latex-syntax/)
- 有损点：无法识别的内容变成 `["Error", …]`（`expr.isValid === false`，`expr.errors` 列出全部）；静默恢复会丢信息，例如 `13^{\text{th}}` 退化为 13、`x^{}` 退化为 x、`\cancel{x}` 被解包；canonical 形式会改结构（`\frac{7}{-4}` → `["Rational", -7, 4]`，raw 为 `["Divide", 7, -4]`）；文档没有往返保证，也没说空格命令、`\text`、颜色、对齐环境会保留。 — [同上](https://mathlive.io/compute-engine/guides/latex-syntax/)
- 核心库：`Error(error-code, context)` 标记无法正确解释的表达式；`LatexString` 把字符串标为 LaTeX；`Latex` 求值为该表达式的 LaTeX 序列化；`Parse` 把 LaTeX 转为 MathJSON；参考页没有列出 LaTeX 解析错误码的完整清单。 — [Compute Engine Reference: Core](https://mathlive.io/compute-engine/reference/core/)；错误中的 LaTeX 字符串曾被误标为 `Latex`，0.15.0（2023-09-14）改为 `LatexString`。 — [Compute Engine Changelog](https://cortexjs.io/compute-engine/changelog/)（搜索摘要）
- 版本与稳定性：0.134.0（2026-09-24）、0.133.0（2026-09-22）、0.132.3（2026-09-20），仍为 0.x 且发版极快；有 issue 反映序列化缺陷，如 “Compute Engine 0.55.6: toLatex() omits multiplication sign for Multiply(number, Power(number, n)) after substitution”（#302）。 — [Compute Engine CHANGELOG](https://raw.githubusercontent.com/cortex-js/compute-engine/main/CHANGELOG.md)、[issue #302](https://github.com/cortex-js/compute-engine/issues/302)

**pandoc / texmath（多格式枢纽）**
- texmath（Haskell，GPL-2.0）：输入 TeX、MathML、OMML；输出 TeX、MathML、OMML、GNU eqn、Typst、StarMath、Pandoc native；支持“basic LaTeX and AMS extensions”，能解析并应用 LaTeX 宏；有 golden tests 与往返测试。 — [jgm/texmath](https://github.com/jgm/texmath)
- pandoc 各输出格式的数学：LaTeX 输出为 `\(...\)`/`\[...\]`；docx/PowerPoint 用 OMML；ODT“尽可能”用 MathML；DocBook 视选项用 MathML 或 Unicode；roff man、Jira 等“原样输出、去掉 `$`”；HTML 取决于 `--math-method`（plain/mathjax/mathml/webtex/katex/gladtex）。 — [pandoc Manual §8.13 Math](https://pandoc.org/demo/example33/8.13-math.html)、[pandoc Manual](https://pandoc.org/MANUAL.html)（manual 日期 2026-08-28： [MANUAL.txt](https://raw.githubusercontent.com/jgm/pandoc/main/MANUAL.txt)）
- texmath 解析失败时 pandoc 警告 `[WARNING] Could not convert TeX math \frac{1}{2}, rendering as TeX`，输出中出现原样 TeX（该例为 pandoc 2.16.2 输出 RTF）；docx 输出的已知触发还有 `\tag{}`、`\over`。 — [jgm/pandoc#7771](https://github.com/jgm/pandoc/issues/7771)、[#5886](https://github.com/jgm/pandoc/issues/5886)、[#4251](https://github.com/jgm/pandoc/issues/4251)
- `latex_macros`：解析 LaTeX 宏定义并应用到所有 LaTeX 数学与 raw LaTeX，例如 `\newcommand{\tuple}[1]{\langle #1 \rangle}` 后 `$\tuple{a, b, c}$` 在所有输出格式都可用；目前只能对输入 reader 启用。 — [pandoc Manual §8.15 LaTeX macros](https://pandoc.org/demo/example33/8.15-latex-macros.html)、[jgm/pandoc#9677](https://github.com/jgm/pandoc/issues/9677)

**MathML → LaTeX**
- mathml-to-latex（JS，asnunes）：MIT，v1.5.0，`MathMLToLaTeX.convert(mathml)`，支持 mn/mo/mi/mfenced/mtable 等，README 未列局限。 — [asnunes/mathml-to-latex](https://github.com/asnunes/mathml-to-latex)
- texmath 也能读取 MathML 并写出 TeX（见上）。 — [jgm/texmath](https://github.com/jgm/texmath)

**LaTeX ↔ Typst**
- tex2typst（JS）：`tex2typst()`、`typst2tex()`，0.3.0 起双向；0.3.15 起许可证由 GPL-3.0 改为 Apache-2.0。 — [qwinsi/tex2typst](https://github.com/qwinsi/tex2typst)。Releases 页最新 v0.6.2；近期版本新增 `\varGamma`、`\cancel`、`\left<`/`\right>`、`\bmod`/`\pmod`、`\bra`/`\ket`/`\braket`/`\set`、`\operatorname*` 等，并“fully follow symbol changes in Typst 0.14”。 — [tex2typst Releases](https://github.com/qwinsi/tex2typst/releases)（WebFetch 给出的发布日期为 2023-12 至 2024-06，与“跟进 Typst 0.14”的说明矛盾，日期需复核）
- MiTeX（Rust+WASM，Apache-2.0）：LaTeX 解析为 AST 后生成 Typst 代码；约 185 KB（对比 texmath 约 17 MB）；32.5k 个公式 WASM 2.28 s、x86 0.085 s；以 Typst 包 `@preview/mitex:0.2.7` 分发；支持 `\newcommand`、aligned/matrix/cases、颜色、带标签公式与交叉引用；完整宏包支持未实现，文本模式仍在开发。 — [mitex-rs/mitex](https://github.com/mitex-rs/mitex)
- MathLive 0.106.0（2025-07-11）新增 `mf.getValue("typst")`。 — [MathLive CHANGELOG](https://raw.githubusercontent.com/arnog/mathlive/master/CHANGELOG.md)
- Typst→MathML：Typst 0.14 的 HTML 导出完全忽略公式；Typst 0.15（2026-06-15）起 HTML 导出以 MathML 输出公式，但官方提示“若绝对视觉一致性至关重要，渲染为 SVG 可能仍更合适”；HTML 导出仍属实验性。 — [Typst 0.15 blog](https://typst.app/blog/2026/typst-0.15/)、[Typst 0.15 changelog](https://typst.app/docs/changelog/0.15.0/)
- MyST 的 `{math}` 可用 `:typst:` 提供原生 Typst 写法，替代自动转换；frontmatter 定义的宏会传递到 LaTeX/Typst 导出。 — [MyST Guide: Math](https://mystmd.org/guide/math)

**OMML ↔ MathML/LaTeX**
- Word 自带 `OMML2MML.XSL`（Word 复制出 MathML 靠它）；TEI 样式表集也收录，许可为 CC-SA/BSD 双许可；另有 plurimath/omml2mathml 等移植。 — [plurimath/omml2mathml](https://github.com/plurimath/omml2mathml)、[JATS-Con 2016: Wrangling Math from Microsoft Word into JATS XML](https://www.ncbi.nlm.nih.gov/books/NBK350572/)
- Word 内部可在线性（LaTeX/UnicodeMath）与专业格式之间转换（Ctrl+= / Ctrl+Shift+=），受上文 LaTeX 方言限制。 — [Microsoft Support](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)
- pandoc 读 docx 时经 texmath 把 OMML 转成 TeX 数学，写 docx 时再把 TeX 转成 OMML。 — [jgm/texmath](https://github.com/jgm/texmath)、[pandoc §8.13](https://pandoc.org/demo/example33/8.13-math.html)

### Inferences
- 已知信息丢失汇总（按构造）：
  - **宏**：KaTeX/Temml/MathLive 只在渲染或编辑时展开宏，宏定义不随公式导出；pandoc 的 `latex_macros` 只作用于 reader；MiTeX 与 MyST 能把宏传到 Typst/LaTeX。因此跨文档宏是最大的可移植性风险。
  - **`\label`/`\ref`/`\tag`**：KaTeX 函数表没有 `\label`/`\ref`，MathLive 不支持 `\label`/`\ref`/`\tag`，Temml 与 MiTeX 支持，pandoc→docx 遇 `\tag` 失败。
  - **颜色**：KaTeX、Temml、MathLive 都支持；Compute Engine 文档未说明保留；texmath 对 xcolor 支持有限（此点来自搜索摘要）。
  - **`\text`**：Compute Engine 对 `13^{\text{th}}` 等做有损恢复。
  - **对齐环境**：KaTeX 支持 align，但 Notion 不支持 align、要求改用 aligned（见 Q3），说明“同一渲染器、不同宿主”的子集也会不同。
  - **规范化**：Compute Engine canonical、MathLive 重新序列化都会改变字面 LaTeX。
- 需要 Content MathML 时，LaTeXML 是公认最佳，但它是 Perl 服务端工具，`--cmml` 仍“部分实现”；前端组件做语义操作更现实的路径是 Compute Engine（MathJSON），但要接受“语义是推断”的前提。

### Gaps
- MathJax 4 的 `noerrors`/`noundefined` 对未知宏的具体行为本次未核实。
- mathml-to-latex、tex2typst 缺少公开的保真度测试或覆盖率数字；texmath 的命令覆盖清单未取到。
- Compute Engine 的 LaTeX 解析错误码清单（如是否仍用 `'unexpected-command'`）在当前参考页中找不到。
- Word LaTeX 线性格式导出的保真度没有量化资料。
- KaTeX、MathJax、MathLive、Compute Engine、LaTeXML 的许可证本次未逐一核实（一般认为 KaTeX、MathLive、Compute Engine 为 MIT，MathJax 为 Apache-2.0，LaTeXML 为 public domain，仍需确认）。

## Q3 知名项目的做法与理由

### Takeaway
绝大多数笔记和学习产品以 LaTeX 字符串为真源，用 KaTeX 或 MathJax 渲染：Notion、Obsidian、Anki、Jupyter、GitHub、RemNote、Typora、Tiptap、MyST、Wikipedia、Overleaf、MathLive、MathQuill 都是如此。例外是自有排版引擎的产品：Word 用 OfficeMath/OMML，Typst 用 Typst 标记，Mathcha 用自有 WYSIWYG 模型并导出 LaTeX/TikZ。这些产品通常以“受支持的 LaTeX 子集”作为实际契约（Notion=KaTeX 子集，Wikipedia=texvc 子集）。

### Cited Findings
- **Notion**：KaTeX 渲染，支持 KaTeX 的 Supported Functions；不支持 `align`，需改用 `aligned`；化学用 mhchem 的 `\ce`/`\pu`；行内可用 `$$equation$$` 或 Ctrl/Cmd+Shift+E，块公式 `/math`。 — [Notion Help: Math equations](https://www.notion.com/help/math-equations)
- Notion 官方帮助页未说明 Markdown 导出格式；第三方工具 notion-to-md 把公式块转成代码块。 — [notion-to-md](https://github.com/haoyayoi/notion-to-md)（搜索摘要）
- **Obsidian**：行内 `$...$`、块 `$$...$$`，MathJax 渲染 LaTeX。 — [Obsidian Help](https://obsidian.md/help/advanced-syntax)。跨笔记宏依赖社区插件：Extended MathJax（vault 根目录的 `preamble.sty`）、MathJax Preamble Manager（`\newcommand` 定义后除非重定义否则一直生效，移除需重载应用）、fastMathJax（隔离的 MathJax 4 引擎，vault 内 preamble 文件，编辑后自动重读）。 — [obsidian-latex (Extended MathJax)](https://github.com/wei2912/obsidian-latex)、[obsidian-mathjax-preamble-manager](https://github.com/RyotaUshio/obsidian-mathjax-preamble-manager)、[fastMathJax](https://github.com/danlingdan/fastMathJax)
- **Anki**：MathJax 行内 `\(...\)`、行间 `\[...\]`；`$...$` 不用作 MathJax 定界符；Anki 2.1+、AnkiMobile、AnkiDroid 2.9+ 开箱支持；内置 mhchem；另有 `[latex]…[/latex]`、`[$]…[/$]`、`[$$]…[/$$]`，需本地 LaTeX+dvipng 生成图片存入 media，只能在桌面端生成。 — [Anki Manual: Math & Symbols](https://docs.ankiweb.net/math.html)
- **Wikipedia/MediaWiki**：`<math>` 中写 TeX，texvcjs 校验并限制为安全子集；自 2016-05-31 起默认“MathML + SVG 回退”，SVG 由运行 MathJax 的 Node.js 服务 Mathoid 生成。 — [Extension:Math](https://www.mediawiki.org/wiki/Extension:Math)、[Phabricator T131177](https://phabricator.wikimedia.org/T131177)、[Wikipedia:Rendering math](https://en.wikipedia.org/wiki/Wikipedia:Rendering_math)。MediaWiki 1.40+ 提供 PHP 生成的 Native MathML，1.42+ 提供 MathJax 模式，Mathoid 正被淘汰。 — [Extension:Math](https://www.mediawiki.org/wiki/Extension:Math)。Native MathML 推广动机是去掉 Mathoid/SVG 存储/RESTBase；2024-10 分诊发现多浏览器渲染问题；该页至 2026-07 未宣布成为 Wikipedia 默认。 — [Native MathML rollout (2024)](https://www.mediawiki.org/wiki/Extension:Math/Native_MathML_rollout_(2024))（WebFetch 摘要）
- **Overleaf**：真源是 LaTeX 源文件；Visual Editor（Rich Text）在源码中内联预览公式与图片、隐藏导言区，并支持 mhchem 化学式预览。 — [Overleaf blog: Rich Text](https://www.overleaf.com/blog/new-overleaf-v2-features-rich-text-and-adding-linked-files)、[Overleaf blog: chemical formulas preview](https://www.overleaf.com/blog/feature-update-preview-chemical-formulas-with-overleafs-visual-editor)
- **Word/Office**：OfficeMath 内存模型 + OMML 文件格式；LaTeX 与 UnicodeMath 只是线性输入/显示形式（见 Q1）。 — [Math in Office: OfficeMath](https://devblogs.microsoft.com/math-in-office/officemath/)
- **Apple Notes**：iOS 26 起支持 Markdown 导入/导出；未找到 Math Notes 导出 LaTeX 的官方说明。 — [MacRumors](https://www.macrumors.com/how-to/ios-import-export-markdown-apple-notes/)、[AppleInsider](https://appleinsider.com/inside/ios-26/tips/how-to-import-and-export-markdown-with-apple-notes-in-ios-26)
- **Jupyter**：Markdown 解析器“MathJax-aware”，支持 `$…$`、`$$…$$`、`\(...\)`，TeX 环境可直接书写，无需 `$$`。 — [Jupyter Notebook 7.6.x: Markdown Cells](https://jupyter-notebook.readthedocs.io/en/stable/examples/Notebook/Working%20With%20Markdown%20Cells.html)
- **Typst**：真源是 Typst 标记（见 Q1）；0.15 起 HTML 导出为 MathML。 — [Typst 0.15 blog](https://typst.app/blog/2026/typst-0.15/)
- **Mathcha**：在线所见即所得公式与绘图编辑器，导出 LaTeX、TikZ、SVG、PNG，图可转 TikZ。 — [Mathcha](https://www.mathcha.io/)、[Mathcha on X](https://x.com/mathchaeditor/status/920087765596782592)
- **MathLive 系应用**：LaTeX 为值；0.110.0 起 Compute Engine 不再是依赖，MathJSON 需按需 `computeEngine.parse(...)`。 — [MathLive CHANGELOG](https://raw.githubusercontent.com/arnog/mathlive/master/CHANGELOG.md)
- **Tiptap Mathematics 扩展**：LaTeX 存为节点属性，KaTeX 渲染，分 inline/block 节点，`katexOptions` 透传，提供从旧“装饰式”数学字符串迁移到节点的工具。 — [Tiptap Docs: Mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- **Typora**：MathJax（0.11.0 起 v3）；`$$` 块；行内 `$` 需在偏好设置中开启，默认采用 pandoc 式规则；支持 AMS 或全部自动编号、`\label`/`\ref`、在数学块中 `\def`/`\newcommand`、可选 physics 包、mhchem；“并非所有导出格式都支持数学”。 — [Typora Support: Math](https://support.typora.io/Math/)
- **arXiv HTML**：LaTeX 源经 LaTeXML 转为 HTML+MathML，并在 `<math>` 内保留 TeX annotation。 — [arXiv:2605.16562](https://arxiv.org/html/2605.16562v1)

### Inferences
- 选择 LaTeX 字符串的共同理由（归纳）：用户已会写，粘贴与导入零成本，渲染器现成（KaTeX/MathJax），导出到 Markdown/LaTeX 是恒等变换；代价是每个产品都只支持某个子集，跨产品移植的风险集中在子集差异（如 Notion 的 align）与宏上。
- 做结构编辑（MathLive、MathQuill、Tiptap 的节点）时，这些产品仍把 LaTeX 作为持久化值，结构树只在内存中存在。

### Gaps
- Notion、RemNote 官方 Markdown 导出的公式格式没有一手文档。
- Mathcha 的持久化 JSON 模型、Apple Math Notes 的存储没有公开资料。
- 没找到有代表性的“MathLive + Compute Engine 按需语义”生产应用的公开架构文章。

## Q4 “LaTeX 字符串为真源 + 解析树用于编辑 + 按需语义树”架构：实践形态与断点

### Takeaway
MathLive 0.110 与 Compute Engine 的拆分正好对应这种三层结构：LaTeX 为持久值，MathLive 的 atom 树用于结构编辑，MathJSON 由 Compute Engine 按需派生（`form: 'raw'` 保持字面结构，canonical 用于判等）。断点集中在四处：编辑器解析不了的 LaTeX（环境、宏包、`\label`/`\tag`、CD/tikz-cd）；在别处定义的宏；多行环境；重新序列化导致的字面漂移。实践上要保存原始字符串，只在用户确实做了结构编辑时才接受重新序列化的结果。

### Cited Findings
- MathLive 0.110.0：移除 `mathfield.expression` 与 `"math-json"` 输出，改用 `MathfieldElement.computeEngine.parse(mf.getValue())` / `.json`；Compute Engine 不再是依赖。 — [MathLive CHANGELOG](https://raw.githubusercontent.com/arnog/mathlive/master/CHANGELOG.md)
- MathLive 的序列化随版本变化：0.108.0 修正字体样式序列化（`\mathrm{H}`），0.104.0 起只为标准三角函数生成命令、其余改用 `\operatorname{}`，0.99.0 序列化时偏好 `\mathbf`；输出格式有 `"latex"`、`"latex-expanded"`、`"latex-unstyled"`、`"latex-without-placeholders"`、`"typst"`。 — [MathLive CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- MathLive 预置 800 多个 LaTeX 命令；自定义宏通过 `mf.macros = {...mf.macros, …}` 添加（不展开旧值会关闭所有标准宏）；宏调用以原样“包含在 mathfield 的 LaTeX 值中”；默认宏内容不可编辑，设 `captureSelection: false` 后可选中编辑。 — [MathLive Guides: Macros](https://mathlive.io/mathfield/guides/macros/)
- MathLive 0.106.0 起 `validateLatex()` 接受 macros 选项，自定义宏不再被报为未知命令（issue #3032）。 — [MathLive Changelog](https://mathlive.io/mathfield/changelog/)（搜索摘要）
- MathLive 支持的环境：array、matrix/pmatrix/bmatrix/Bmatrix/vmatrix/Vmatrix/smallmatrix、cases/dcases/rcases、gather、multline、align、aligned、split、gathered、equation、subequations、eqnarray 等；文档没有 CD；`\label`/`\ref`/`\tag` 不在命令表中；支持 `\textcolor`（推荐）、`\color`、`\colorbox`、`\fcolorbox`，`\text{}` 保留空白，空格命令 `\hspace`、`\,`、`\quad` 等。 — [MathLive Reference: LaTeX Commands](https://mathlive.io/mathfield/reference/commands/)
- Compute Engine：`form: 'raw'` 保持接近字面的结构；`preserveLatex: true` 用源 LaTeX 片段装饰表达式；MathJSON 元数据有 `latex`、`sourceOffsets`、`hash`；无法识别的部分变成 `["Error", …]`，`expr.isValid`/`expr.errors` 可检测。 — [Compute Engine: LaTeX Syntax](https://mathlive.io/compute-engine/guides/latex-syntax/)、[MathJSON Standard](https://mathlive.io/math-json/)
- KaTeX 可用 `\htmlId`/`\htmlClass`/`\htmlData` 给子表达式打 DOM 标记（需 `trust`），`globalGroup` 让宏跨 render 调用持久。 — [KaTeX Supported](https://katex.org/docs/supported)、[KaTeX Options](https://katex.org/docs/options)
- 跨文档宏的先例：pandoc `latex_macros`（仅 reader）；MyST 在 frontmatter 的 `math:` 下定义宏，传到 LaTeX/Typst 导出；Obsidian 靠 preamble 插件；Typora 允许在数学块中 `\newcommand`。 — [pandoc §8.15](https://pandoc.org/demo/example33/8.15-latex-macros.html)、[MyST Math](https://mystmd.org/guide/math)、[obsidian-mathjax-preamble-manager](https://github.com/RyotaUshio/obsidian-mathjax-preamble-manager)、[Typora Math](https://support.typora.io/Math/)
- 与 AI 编辑相关：.tmu 论文（EMNLP 2026，2026-03-03 提交、2026-09-08 定稿）认为 TeX“缺乏显式结构表示”，与 LLM 工作流存在架构错配，影响语义生成与错误定位；树结构的 .tmu 在四项 LLM 评测中优于 .tex，在 .tmu 上微调的最终训练损失约低 43%。 — [arXiv:2603.02873](https://arxiv.org/abs/2603.02873)
- TeXpert 基准显示，LLM 的 LaTeX 生成准确率随任务复杂度上升明显下降（针对文档级 LaTeX，非单个公式）。 — [arXiv:2506.16990](https://arxiv.org/abs/2506.16990)（搜索摘要）

### Inferences
- 建议的数据流：
  1. 持久化 `source.latex`（用户原文，不带定界符）+ `display: inline|block` + `macrosRef`（文档或库级宏表）+ 派生缓存（如 `derived.mathml`，按工具版本打标）。
  2. 编辑时 `MathfieldElement` 载入 `source.latex`；如果 `validateLatex(latex, {macros})` 报错、或含 MathLive 不支持的构造（CD、tikz-cd、`\label`/`\tag`、未知宏包），降级为“源码编辑 + 广义渲染器预览”（见 Q5）。
  3. 只有用户做了结构编辑，才用 `mf.getValue("latex")` 覆盖原文；未改动的公式保持字节不变，避免 MathLive 版本升级带来的序列化漂移。
  4. 语义层按需生成：`ce.parse(latex, { form: 'raw' })` 用于保持结构的 AI 子表达式操作与定位，canonical 形式用于判等、化简和去重键；`expr.isValid` 为 false 时禁用语义功能而不是阻止保存。
  5. AI 改写子表达式：由于 LaTeX 没有显式结构（.tmu 论文的论点），把目标子树（MathLive 选区或 MathJSON 子表达式及其 `sourceOffsets`）的 LaTeX 片段交给模型，再把结果片段拼回原字符串、重新 `validateLatex`，改动面最小。
- 主要断点：
  - 编辑器无法解析：CD/tikz-cd、`\label`/`\tag`（MathLive 不支持）、未知宏包；
  - 别处定义的宏：MathLive/KaTeX 只在运行时知道宏，导出时要么附带宏表，要么用 `"latex-expanded"` 展开；
  - 多行环境：align 与 aligned 在不同宿主中支持不同（Notion），`&`/`\\` 跨行结构在 Markdown 中还会遇到换行与反斜杠转义问题（GitHub 文档对 .md 文件中数学换行有专门说明，细节未逐字核实）；
  - 规范化漂移：MathLive 重新序列化与 Compute Engine canonical 都会改变字面。

### Gaps
- MathLive 对未知命令的显示与保留行为（是否原样保留、如何提示）在本次取到的文档中没有说明。
- 没有 MathLive 往返（LaTeX→atom→LaTeX）字节级保真度的公开测量。
- `preserveLatex` 装饰的粒度（到哪一层子表达式）未见详细文档。

## Q5 结构编辑器处理不了的公式如何在文档格式中表示（不透明节点 + 回退渲染器）

### Takeaway
成熟的先例都遵循“保存权威源码 + 声明所需能力 + 提供回退渲染”这一模式：MathML 的 `<semantics>`/`<annotation encoding="application/x-tex">`、OOXML 的 `mc:AlternateContent`（`mc:Choice Requires` + `mc:Fallback` 图片）、pandoc 的 raw attribute（按目标格式直通，其余忽略）与 texmath 失败时回退为原样 TeX、ProseMirror 的 catch-all 原子节点保存 `outerHTML`、Lexical 的 DecoratorNode、KaTeX/Temml 的 `throwOnError: false` 源码回显、Compute Engine 的 `["Error", …, LatexString]`。对 tikz-cd 这类构造，可行的更广渲染器有：浏览器内 TikZJax（WASM TeX）、服务端 LaTeX→SVG/PNG（Anki `[latex]`、Wikipedia/Mathoid SVG），或者在能力允许时降级为 KaTeX/Temml 支持的 amscd `CD`。

### Cited Findings
- MathML 4 第 6 章：`<semantics>` 结合 `<annotation>`/`<annotation-xml>`，同时携带多种表示与内容等价物。 — [MathML 4.0](https://www.w3.org/TR/mathml4/)
- KaTeX（annotation 中的原始 TeX）、Temml（`annotate`）、LaTeXML（`--mathtex`）、arXiv HTML 都把 TeX 源放进 MathML。 — [zatex#119](https://github.com/gregoreesmaa/zatex/issues/119)、[Temml](https://temml.org/docs/en/administration)、[latexmlpost](https://math.nist.gov/~BMiller/LaTeXML/manual/commands/latexmlpost.html)、[arXiv:2605.16562](https://arxiv.org/html/2605.16562v1)
- OOXML Markup Compatibility：`mc:AlternateContent` 容纳同一内容的多种表示，`mc:Choice Requires="…"` 声明读者须支持的命名空间，`mc:Fallback` 在无 Choice 匹配时使用；Office 用它把公式与回退图片包在一起。 — [Open XML SDK: Introduction to markup compatibility](https://learn.microsoft.com/en-us/office/open-xml/general/introduction-to-markup-compatibility)、[MS-ODRAWXML: Math](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/38b13e1f-1102-4bb7-819a-dd5d9abdb176)、[LoC: MCE](https://www.loc.gov/preservation/digital/formats/fdd/fdd000396.shtml)
- pandoc `raw_attribute`：```` ```{=latex} ```` 块与 `` `…`{=html} `` 行内，格式名须与目标格式匹配，只直通给对应输出；`raw_tex`：行内 TeX 原样传给 LaTeX/ConTeXt，在 Markdown、LaTeX、Org、ConTeXt 以外的格式中被忽略；`raw_html` 在 HTML 系格式中直通，其他格式中被抑制。 — [pandoc Manual §8.14 Raw HTML](https://pandoc.org/demo/example33/8.14-raw-html.html)
- texmath 解析失败时 pandoc“rendering as TeX”。 — [jgm/pandoc#7771](https://github.com/jgm/pandoc/issues/7771)
- ProseMirror：不符合 schema 的内容会被丢弃；迁移遗留 HTML 时用 catch-all 原子节点把 `outerHTML` 存为属性，序列化时还原，Marijn 建议在解析前预处理并标记外来节点（2026-04）；schema 不能运行时动态更新，但可预扫描后预生成包含 fallback 类型的 schema（2021-12）。 — [discuss.ProseMirror #8999](https://discuss.prosemirror.net/t/schema-for-preserving-unknown-html-content-and-structure-as-is/8999)、[discuss.ProseMirror #4295](https://discuss.prosemirror.net/t/adding-fallback-extensions-for-unsupported-node-mark-types/4295)
- Lexical DecoratorNode：“Wrapper node to insert arbitrary view (component) inside the editor”，通过 `decorate()` 返回任意框架组件，节点需实现 `importJSON`/`exportJSON`/`clone`。 — [Lexical Docs: Nodes](https://lexical.dev/docs/concepts/nodes)
- Tiptap Mathematics：LaTeX 属性 + KaTeX，`throwOnError: false` 优雅降级。 — [Tiptap Docs](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- KaTeX `throwOnError: false` 把不支持的命令渲染为文本、把非法 LaTeX 以源码按 `errorColor` 显示；Temml 同理（`errorColor` #b22222）。 — [KaTeX Options](https://katex.org/docs/options)、[Temml](https://temml.org/docs/en/administration)
- Compute Engine：`Error(error-code, context)`，context 可以是 `LatexString`；`expr.isValid`/`expr.errors`。 — [CE Core](https://mathlive.io/compute-engine/reference/core/)、[CE LaTeX Syntax](https://mathlive.io/compute-engine/guides/latex-syntax/)
- 广义渲染器先例：Obsidian TikZJax 插件在浏览器内渲染 TikZ（含 tikz-cd，需 `\usepackage{}` 与 `\begin{document}…\end{document}`），无需本地 LaTeX。 — [artisticat1/obsidian-tikzjax](https://github.com/artisticat1/obsidian-tikzjax)。Anki `[latex]` 用本地 LaTeX 生成图片存入 media。 — [Anki Manual](https://docs.ankiweb.net/math.html)。MiTeX 让 Typst 文档内嵌渲染 LaTeX 片段。 — [mitex-rs/mitex](https://github.com/mitex-rs/mitex)
- KaTeX 支持 amscd 的 `CD` 环境（`@>a>>`、`@VbVV`、`@=` 语法），tikz-cd/xymatrix 不支持。 — [KaTeX Supported](https://katex.org/docs/supported)

### Inferences
- 建议的公式节点 schema（参照 OOXML AlternateContent 与 MathML semantics）：
  - `source: { format: "latex", text }`：唯一权威字段，永远原样保存；
  - `requires: ["mathlive" | "katex" | "mathjax" | "tikzjax" | "server-latex"]`（相当于 `mc:Choice Requires`）；
  - `tier: "structural" | "render-only" | "opaque"`：分别为可结构编辑、只能源码编辑但前端可渲染、需更广渲染器或只显示缓存图；
  - `fallback: { svg?, mathml?, generatedBy, version }`（相当于 `mc:Fallback`），是可丢弃的缓存；
  - `macrosRef`、可选 `semantic: { mathjson, engineVersion }`（派生、可重算）。
- 升级路径：每次加载时按当前能力重新计算 `tier`（例如 `validateLatex` 通过就升为 structural）；因为真源一直是 `source.text`，升级不需要迁移数据。这与 ProseMirror 预扫描生成 fallback schema、Tiptap 的迁移工具思路一致。
- 导出：Markdown 与 LaTeX 直接写 `source.text`（opaque 的 tikz-cd 在 LaTeX 中原样输出；在 Markdown 中可仿 pandoc 用 ```` ```{=latex} ```` 或 Obsidian 的 ```` ```tikz ```` 代码块）；HTML 写 `fallback.mathml`/`svg`，并在 annotation 中附 TeX。

### Gaps
- 没找到 ProseMirror 或 Lexical 官方文档中专门针对数学、带回退渲染器的“opaque node”设计；现有先例是社区讨论和其他格式（OOXML、pandoc、MathML）的机制。
- Notion 对不支持内容（“unsupported block”）的处理没有公开文档。
- MathJax 的 `noundefined`/`noerrors` 扩展作为回退显示手段，本次未核实。

## Q6 学习系统复用：Anki/Obsidian/RemNote 的数学存储、常见 Markdown 数学方言与可移植性

### Takeaway
各系统存的都是 LaTeX 字符串，差别只在定界符和子集：Markdown 系（pandoc、Obsidian、GitHub、Jupyter、Typora、MyST、remark-math）用 `$…$`/`$$…$$`；Anki 用 `\(...\)`/`\[...\]`（`$` 不是 MathJax 定界符）；GitHub 另有 `` $`…`$ `` 和 ```` ```math ````；RemNote 与 Notion 实际契约是 KaTeX 子集。可移植性最大化的做法是：存储不带定界符的 LaTeX，在导出时按目标加定界符；写法限制在 KaTeX 与 MathJax 的交集内；宏在导出时展开或随文档携带；为检索和去重派生 MathJSON canonical 哈希或 MathML 树。

### Cited Findings
- **Anki**：`\(...\)`/`\[...\]`；`$`、`$$` 不是 MathJax 定界符。 — [Anki Manual](https://docs.ankiweb.net/math.html)。社区有 add-on “Math Delimiters Replacer” 把 `$`/`$$` 转为 `\(...\)`。 — [AnkiWeb add-on 401047458](https://ankiweb.net/shared/info/401047458)（搜索摘要）
- **Obsidian**：`$`/`$$` + MathJax。 — [Obsidian Help](https://obsidian.md/help/advanced-syntax)
- **RemNote**：KaTeX；在 bullet 中输入 `$$` 弹出 LaTeX 编辑框；导入/粘贴时识别 `$…$`（行内，两侧须紧邻空格）与 `$$…$$`（块）。 — [RemNote Help](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)（搜索摘要）
- **GitHub**：行内 `$…$` 与 `` $`…`$ ``，块 `$$…$$` 与 ```` ```math ````；MathJax；表达式内 `\$` 转义，表达式外可用 `<span>$</span>`。 — [GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)
- **pandoc**：`tex_math_dollars` 规则为开 `$` 右侧须紧邻非空白，闭 `$` 左侧须紧邻非空白且后面不能紧跟数字，`$$` 为行间（可与公式间有空白）。 — [pandoc §8.13](https://pandoc.org/demo/example33/8.13-math.html)。`tex_math_dollars`、`tex_math_gfm`、`tex_math_single_backslash`、`tex_math_double_backslash` 四个扩展也可用于 HTML 输入（便于读取 MathJax 网页）。 — [pandoc §7.3 Math Input](https://pandoc.org/demo/example33/7.3-math-input.html)。`tex_math_gfm` 对应 GitHub 的 `` $`…`$ `` 与 ```` ```math ````（GitHub 与 GitLab 的块语法都是 ```` ```math ````）；MarkText 有 issue 提议把数学输入选项与 pandoc 这四个扩展对齐，并有 PR 实现 `tex_math_gfm`、替换原 GitLab 兼容选项。 — [marktext PR #5451](https://github.com/marktext/marktext/pull/5451)、[marktext issue #5446](https://github.com/marktext/marktext/issues/5446)（搜索摘要）
- **remark-math / micromark-extension-math**：不属于 CommonMark 或 GFM，“there is no spec for math in markdown”；`$…$` 行内（`singleDollarTextMath` 默认 true）、`$$…$$` 块；HTML 输出 `math math-inline`/`math math-display` 类名；MIT。 — [micromark-extension-math](https://github.com/micromark/micromark-extension-math)
- **Typora**：默认 pandoc 式 `$` 规则，行内数学需手动开启。 — [Typora Math](https://support.typora.io/Math/)
- **MyST**：`$…$`、`{math}` role、`$$…$$`（可带 `\label`）、math directive、直接写 amsmath 环境（equation、align、gather、multline、alignat、flalign、eqnarray 等）；`[](#label)` 交叉引用；frontmatter `math:` 宏跨文档并进入 LaTeX/Typst 导出。 — [MyST Math](https://mystmd.org/guide/math)
- **Jupyter**：`$`、`$$`、`\(...\)`，环境可直接写。 — [Jupyter Docs](https://jupyter-notebook.readthedocs.io/en/stable/examples/Notebook/Working%20With%20Markdown%20Cells.html)
- **Notion**：输入快捷方式 `$$…$$`（行内）；子集为 KaTeX 且不支持 align。 — [Notion Help](https://www.notion.com/help/math-equations)
- **检索/去重**：ARQMath 用 LaTeX + SLT（Presentation MathML）+ OPT（Content MathML）三种表示做公式检索，Content MathML 从 LaTeX 推断而来，可能出错。 — [ARQMath 2020 Overview](https://www.cs.rit.edu/~dprl/ARQMath/2020/papers/Errata-TableA2-Overview_of_ARQMath_2020.pdf)（搜索摘要）。MathJSON 有 `hash` 元数据键，canonical 形式可消除写法差异（如 `["Rational", -7, 4]`）。 — [MathJSON Standard](https://mathlive.io/math-json/)、[CE LaTeX Syntax](https://mathlive.io/compute-engine/guides/latex-syntax/)
- 公式抽取基准中，以 LLM-as-a-judge 评估公式语义等价，与人工判断的相关性（Pearson r=0.78）明显高于其他指标。 — [arXiv:2512.09874](https://arxiv.org/html/2512.09874v1)（搜索摘要）

### Inferences
- 可移植导出矩阵：Markdown（Obsidian/GitHub/pandoc/Jupyter/Typora/MyST/remark）写 `$…$` 与 `$$…$$`；如需兼容 GitHub 行内冲突，可选 `` $`…`$ ``（pandoc `tex_math_gfm`）；Anki 字段写 `\(...\)`/`\[...\]`；LaTeX 写 `\(...\)`/`\[...\]` 或原环境。定界符不应进入存储。
- 子集策略：以 KaTeX 支持表与 MathJax 默认 TeX 包的交集为“可移植档”，超出部分（align vs aligned、`\label`、宏包）在节点上标记，导出到 Notion/RemNote 等 KaTeX 宿主时给出警告或自动改写（如 align→aligned，Notion 官方即如此建议）。
- 宏：学习卡片是脱离原文档的单元，所以导出到 Anki 时应使用展开后的 LaTeX（MathLive `"latex-expanded"` 或 pandoc `latex_macros` 思路），或把宏表放进卡片模板（Anki 的 MathJax 定制，未核实）。
- 去重与链接：去重键 = Compute Engine canonical MathJSON 的哈希（`isValid` 时），再以规范化 LaTeX 字符串作为兜底；搜索索引同时保存 LaTeX token 与树结构（借鉴 ARQMath）；判等可先用 Compute Engine，失败时用 LLM 判断（参考上面 r=0.78 的结果）。

### Gaps
- Anki 使用的 MathJax 版本、以及在卡片模板中注入全局宏的官方做法本次未核实（Anki FAQ 有 “Customizing MathJax” 页面，未抓取）。
- RemNote 的 Markdown 导出格式没有一手文档。
- Obsidian→Anki 插件（如 Obsidian_to_Anki）的定界符转换细节未核实。

## Q7 2026 年 MathML Core 的浏览器状态，以及它是否改变“以 MathML 作为存储/渲染格式”的判断

### Takeaway
MathML Core 自 2023-01 Chromium 109 起在所有主流浏览器可用（MDN Baseline “Widely available”），规范是 W3C Candidate Recommendation Snapshot（2025-06-24，编辑稿更新至 2026-07-27）；MathML 4 仍是 Working Draft（2026-06-04）；Interop 2026 不含 MathML；跨浏览器渲染质量仍有差异（Wikipedia 与 Temml 都记录了具体问题）。这让 MathML 成为可靠的渲染与导出目标（Typst 0.15、arXiv、Wikipedia 都在往这边走），但不改变存储选型：MathML Core 只有呈现、冗长、难以手写和做 AI 编辑，Content MathML 不渲染。最佳做法是把 MathML 当作派生物，并在 annotation 中携带 LaTeX 源。

### Cited Findings
- Chromium 109（2023-01）默认启用 Igalia 实现的 MathML Core，至此所有主流浏览器原生支持 MathML。 — [MathML in Web Browsers (Igalia)](https://mathml.igalia.com/)
- MDN：MathML Baseline “Widely available”，跨浏览器起点 2023-01；推荐转向 MathML Core；W3C Math WG 维护 mathml-polyfills。 — [MDN: MathML](https://developer.mozilla.org/en-US/docs/Web/MathML)
- MathML Core：W3C Candidate Recommendation Snapshot，2025-06-24，“not expected to advance to Proposed Recommendation any earlier than 30 September 2025”。 — [W3C TR: MathML Core](https://www.w3.org/TR/mathml-core/)；2025 年 W3C 发布“邀请实现 MathML Core”的新闻。 — [W3C News](https://www.w3.org/news/2025/w3c-invites-implementations-of-mathml-core)；编辑稿日期 2026-07-27。 — [MathML Core ED](https://w3c.github.io/mathml-core/index.html)
- MathML 4.0：Working Draft，2026-06-04。 — [W3C TR: MathML 4](https://www.w3.org/TR/mathml4/)。2025-08 的工作组会议纪要曾计划 2025-12 进入 CR、2026-10 进入 PR。 — [www-math minutes 2025-08-21](https://lists.w3.org/Archives/Public/www-math/2025Sep/0000.html)（搜索摘要）
- Interop 2026 的 20 个 focus areas 与 4 个 investigation areas 均不含 MathML。 — [Interop 2026 README](https://github.com/web-platform-tests/interop/blob/main/2026/README.md)
- FOSDEM 2026（Igalia 的 Eri Pazos）：MathML Core 互操作工作仍在进行（嵌套指数、阿拉伯文方向等），推进 Core 往往需要废弃既有特性或做大改动。 — [FOSDEM 2026: Interop and MathML Core](https://archive.fosdem.org/2026/schedule/event/NJM3KB-mathml-core/)
- Temml 文档：Chromium/WebKit 的可伸缩箭头与根指数有问题，Safari 不支持自动换行。 — [Temml](https://temml.org/docs/en/administration)
- Wikipedia Native MathML 在 2024-10 分诊中发现 Safari、Firefox、Android Chrome 的重音、上下标、尺寸、间距问题。 — [Native MathML rollout (2024)](https://www.mediawiki.org/wiki/Extension:Math/Native_MathML_rollout_(2024))
- Typst 0.15（2026-06-15）HTML 导出改用 MathML，但仍提示 SVG 在视觉一致性上可能更合适。 — [Typst 0.15 blog](https://typst.app/blog/2026/typst-0.15/)
- arXiv：2023 年后“原生数学渲染第一次在所有主流浏览器上可行”；HTML 论文使用 MathML + `:literal` intent + TeX annotation。 — [arXiv:2605.16562](https://arxiv.org/html/2605.16562v1)

### Inferences
- 对本组件的含义：
  - **渲染**：可以用 Temml 或 KaTeX `output: "mathml"` 走原生 MathML，获得更小的体积、可选中文本与屏幕阅读器支持；如果要像素级一致（打印、卡片截图），仍可用 KaTeX HTML、MathJax CHTML/SVG。MathLive 负责编辑态渲染。
  - **导出**：HTML/EPUB 导出写 MathML + `<annotation encoding="application/x-tex">`，粘贴进 Word 可走 MML2OMML；这也是“自带源码的回退”。
  - **存储**：MathML Core 不适合作为真源：它只有呈现、没有宏、冗长，不便于 AI 生成与改写；MathML 4 的 `intent` 仍在 WD 阶段，Content MathML 不渲染。浏览器现状没有推翻“LaTeX 为真源”的结论。
- MathML 4 的 CR 时间点已经滑过工作组 2025 年的计划（2026-06 仍为 WD），短期内不宜依赖 `intent` 的语义。

### Gaps
- 各引擎在 wpt.fyi 上的 MathML Core 通过率本次未抓取，无法给出量化的互操作数字。
- Chromium 与 MathML Core 相对 MathML 3 省略的具体元素（如 `menclose`、`mfenced`）对 `\cancel`、`\boxed` 等 LaTeX 构造的影响，本次未逐项核实。
- W3C Math WG 2026 章程草案（[charter-2026](https://w3c.github.io/mathml-docs/charter-2026.html)）未抓取，其中可能包含 MathML 4 的新时间表。
