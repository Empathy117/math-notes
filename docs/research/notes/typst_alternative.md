# Typst 作为公式源格式 / 渲染引擎的替代方案(对比 LaTeX)

> 调研时间:2026-09-25。目标场景:浏览器内笔记组件,用户输入非正式数学("(x+1)^2从1到2的定积分"、"limit->0(sinx/x)"、"integral_1^2 (x+1)^2 dx"),由 AI 或解析层转成精确公式;需要可编辑公式、快速渲染、可靠错误信号、与 LaTeX 互换。以下所有版本号与日期均以抓取到的一手页面为准;凡未能核实的数字均放入 Gaps。

---

## 1. Typst 数学语法长什么样?对非正式输入有多宽容?有没有类似"线性输入"的东西?

### Takeaway
Typst 数学本身就是一种无反斜杠、无花括号、以空格和 `/`、`_`、`^` 为结构的"线性 ASCII 记法":`integral_1^2 (x+1)^2 dif x`、`lim_(x -> 0) (sin x)/x`、`sum_(k=0)^n`、`mat(1, 2; 3, 4)`、`cases(...)` 直接可写,与用户的非正式输入距离远小于 LaTeX;代价是"连写多字母即变量名"的规则(`sinx`、`dx` 都会报 `unknown variable`),但编译器对此给出结构化 hint,反而可作为解析层的纠错信号。

### Cited Findings
- 进入数学模式只需 `$...$`;首尾各留至少一个空格即为独立块级公式(`$ x^2 $`),不留空格为行内(`$x^2$`);在 markup 与 code 两种模式下都可用 — [Typst Syntax 文档](https://typst.app/docs/reference/syntax/)
- 官方语法表中的数学模式条目:下标 `$x_1$`、上标 `$x^2$`、分式 `$1 + (a+b)/5$`、换行 `$x \ y$`、对齐点 `$x &= 2 \ &= 3$`、变量访问 `$#x$, $pi$`、字段访问 `$arrow.r.long$`、隐含乘法 `$x y$`、符号简写 `$->$`, `$!=$`、文本 `$a "is natural"$`、函数调用 `$floor(x)$`、代码表达式 `$#rect(width: 1cm)$`、转义 `$x\^2$` — [Typst Syntax 文档](https://typst.app/docs/reference/syntax/)
- 单字母按原样排版;连写多字母被解释为变量/函数名;要原样显示多字母需加引号 `"area"`;示例 `$ A = pi r^2 $`、`$ "area" = pi dot "radius"^2 $` — [Typst Math 文档](https://typst.app/docs/reference/math/)
- 上下标附着:`sum_(k=0)^n`,`op("lim", limits: #true)_x`;分式用 `/` 或 `frac()`:`(n(n+1)) / 2`、`frac(a^2, 2)`;矩阵 `mat(1, 2; 3, 4)`(分号分行);向量 `vec(1, 2, delim: "[")`;数学模式内函数调用无需 `#`,支持位置/命名参数、参数展开 `mat(..#range(1, 5).chunks(2))`;逗号/分号需转义时用反斜杠 — [Typst Math 文档](https://typst.app/docs/reference/math/)
- `attach(base, t, b, tl, bl, tr, br)`;`_`/`^` 为其专用语法;`scripts()` 强制显示为角标,`limits()` 强制显示为上下限(带 `inline` 参数,默认 true);"Typst automatically decides which is more suitable depending on the base";示例 `$ limits(A)_1^2 != A_1^2 $`、`$ sum_(i=0)^n a_i $` — [attach 文档](https://typst.app/docs/reference/math/attach/)
- 分情况:`cases(delim, reverse, gap, ...children)`,默认 `delim: ("{", "}")`、`gap: 0% + 0.2em`;示例 `$ f(x, y) := cases(1 "if" (x dot y)/2 <= 0, 2 "if" x "is even", 3 "if" x in NN, 4 "else",) $`;可用 `&` 对齐 — [cases 文档](https://typst.app/docs/reference/math/cases/)
- 文本算符:`op(text, limits: bool)`,`limits` 默认 `false`;示例 `$ op("custom", limits: #true)_(n->oo) n $`;预定义算符含 `arccos arcsin arctan arg cos cosh cot coth csc csch ctg deg det dim exp gcd hom id im inf ker lcm lg lim liminf limsup ln log max min mod Pr sec sech sin sinc sinh sup tan tanh tg tr` — [op 文档](https://typst.app/docs/reference/math/op/)
- 符号按名字书写并以点号叠加修饰(`arrow.r.long`, `arrow.r.double`);已确认的名字:`integral`(∫)、`integral.double`、`integral.cont`、`dif`("The `d` in an integral's `dx` can be written as `$dif x$`")、`oo`/`infinity`(∞)、`RR NN ZZ QQ CC`、`in`、`in.not`、`subset`、`subset.eq`、`union`、`partial`、`nabla`、`alpha beta Gamma`、`arrow.r`、`approx`、`times`、`plus.minus`、`sum`、`product`、`forall`、`exists`、`emptyset`、`ell`;简写 `->` 映射到 `arrow.r`,`<= >= !=` 对应 `lt.eq gt.eq eq.not` — [Symbols (sym) 文档](https://typst.app/docs/reference/symbols/sym/)
- 字体变体函数:`bb(N) = NN`(大写拉丁字母的黑板粗体另有符号简写 `NN RR ZZ QQ CC`)、`cal(P)`、`scr(L)`、`frak(P)`、`sans(A B C)`、`mono(x + y = z)`、`serif` — [variants 文档](https://typst.app/docs/reference/math/variants/)
- 面向 LaTeX 用户的对照:`\sum_{k=1}^n` → `sum_(k=1)^n`;`\frac{a}{b}` → `(a + b)/2` 或 `frac()`;`\left( ... \right)` → 定界符自动缩放;`\begin{cases}` → `cases()`;`\text{...}` → `"text"`;希腊字母直接写 `alpha beta gamma`;无需 amsmath 之类的包,数学"fundamentally part of the language" — [Guide for LaTeX Users](https://typst.app/docs/guides/for-latex-users/)
- 多字母连写触发 `unknown variable: ab`(如 `$ 5ab $`);Typst 为此扩展了 hint:"if you meant to display multiple letters as is, try adding spaces between each letter" 与 "if you meant to display this as text, try placing it in quotes";issue #5029 已由 PR #5038 关闭 — [typst/typst#5029](https://github.com/typst/typst/issues/5029)
- 另有针对 LaTeX 迁移者的 hint 提案:用户写 `cdot` 时建议 `dot` — [typst/typst#6402](https://github.com/typst/typst/issues/6402)
- Typst 社区明确拒绝在编译器内原生支持 LaTeX 数学:"To properly parse and handle LaTeX math, you need to implement a full LaTeX engine",LaTeX 靠宏展开、参数消费灵活(`\frac\sqrt\pi 2`)与 Typst 的纯函数模型冲突;推荐 MiTeX(2025-11-06 讨论) — [Typst Forum #6755](https://forum.typst.app/t/can-typst-natively-support-latex-math/6755)
- 0.15.0(2026-06-15)数学相关变更:多字符符号处理增强;under/over(underbrace 等)布局改进;`math.op` 周围间距调整;`class` 仅作用于直接包裹的内容而非递归;更多定界符(如 `chevron.l`)可被调用生成 `lr` 元素;破坏性变更:`lr` 的 `size` 相对基础字形尺寸解析 — [Typst 0.15.0 Changelog](https://typst.app/docs/changelog/0.15.0/)

### Inferences
- 把目标场景的三条输入映射到 Typst,几乎是"最小编辑距离":
  - `integral_1^2 (x+1)^2 dx` → `integral_1^2 (x+1)^2 dif x`(唯一改动:`dx` → `dif x`,否则 `dx` 报 unknown variable)
  - `limit->0(sinx/x)` → `lim_(x -> 0) (sin x)/x`(`limit` 不是预定义算符,须改 `lim`;`sinx` 须拆为 `sin x`)
  - "(x+1)^2从1到2的定积分" 仍需 AI 层做语义翻译,但目标串是可读的线性文本,便于让模型"补全为 Typst 而非 LaTeX",也便于人工二次编辑。
- Typst 没有单独的"线性输入模式"(如 Word 的 UnicodeMath 或 AsciiMath),因为它的正式语法本身就是线性记法;LaTeX 要达到同样的可读性需要 AsciiMath/KaTeX 一类的前置转换层。
- 对 AI 生成而言,Typst 的"多字母即变量"规则是双刃剑:更严格(`sinx` 报错)但错误可预测、hint 可机读,可以做自动修复(拆空格、加引号、映射到预定义算符)。
- `#` 逃逸到代码模式与 `"..."` 字符串,是把自然语言片段("if x is even")嵌入公式的直接手段,对笔记场景友好。

### Gaps
- 未找到系统性的"非正式输入 → Typst 数学"容错率测评;上面的可写性判断基于官方语法示例推断,没有针对 LLM 生成 Typst 数学正确率的公开数据。
- 官方符号页对 `sect`、`hbar` 未确认(抓取摘要报告"not found",可能是页面过长导致摘要遗漏,需在实现时以实际编译器为准)。
- 未核实哪些算符在 display 模式下默认使用 limits(文档只说由 `limits` 参数控制,预定义算符列表未标注默认值)。

---

## 2. Typst 编译器如何做到快?(增量编译、comemo、布局)有哪些实测延迟?

### Takeaway
Typst 是无状态的四阶段编译器(parse → eval → layout → export),靠 comemo 的"受约束记忆化"在模块/闭包/元素三个粒度缓存结果,增量解析保持远处 span 稳定以最大化缓存命中;公开可查的实测:tinymist 管线对 5 页文档记忆化后编译约 26 ms(冷编译 624 ms),旧版调优后论文级文档增量 600 ms;单个公式级别的延迟没有公开测量。

### Cited Findings
- 编译分四阶段:Parsing → syntax tree;Evaluation → content;Layout → frames;Export → 输出格式。解析"cannot fail",语法错误变成 error node;解析后给节点分配唯一 span 编号用于全程错误追踪;增量解析(segment parser)只在局部重分配 span,"keeping distant span numbers stable—crucial for memoization efficiency" — [typst/docs/dev/architecture.md](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- 求值是树遍历解释器(`Vm` 作用域栈);通过 `World` trait 获取文件/字体/配置;"Results are memoized at module and closure granularity; since Typst ensures function purity, closure calls can be recycled across recompilations" — [architecture.md](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- 布局阶段:realization 应用 show rule;introspection loop 处理页码/计数器/state 的循环依赖,最多迭代 5 次;"Incremental caching: Occurs at element granularity—the most expensive phase, so maximal reuse is prioritized";编译器"stateless",外部状态全部经 `World` 注入;HTML 导出从 content 而非 frames 出发(因为浏览器负责布局) — [architecture.md](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- comemo:`#[memoize]` 标注函数缓存返回值;`#[track]` 标注 impl 块使其方法调用被追踪;参数包成 `Tracked<T>` 后只记录"实际访问过的数据",而非任意输入变化即失效;v0.5,MIT/Apache-2.0 双许可 — [typst/comemo](https://github.com/typst/comemo)
- 维护者 laurmaedje 解释为何不用 salsa:salsa "dictates the program's structure a lot more","It is more advanced in some aspects, but also more rigid in others";两者"the same concept more or less" — [Typst Forum #4014](https://forum.typst.app/t/why-does-typst-implements-its-own-incremental-computation-comemo-instead-of-using-salsa/4014)
- IDE 语义分析中 tracer 被包在 `comemo::TrackedMut` 里,因此只有活动文件的模块求值和相关布局代码需要重跑,其余复用上次正常编译的记忆化结果 — [architecture.md](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- 性能跟踪 issue 中的实测(2023 年调优前→后):某论文冷编译 14.6 s → 6 s,增量 2.9 s → 600 ms;2.5k 页文档冷编译 2 min → 1 min 30 s,增量 30 s → 15 s;瓶颈包括默认分配器(mimalloc 在 Linux 提升 20%、Windows 30%)、字段名/标签字符串比较(15%)、`is_justifiable` 每字符重复调用、导出重复编码(记忆化后增量提升约 30%)、`SourceDiagnostic`/`SourceResult` 过度克隆 — [typst/typst#2393](https://github.com/typst/typst/issues/2393)
- Zed 的实时预览 RFC 实测(复杂 5 页法律文档,tinymist 管线):记忆化编译平均 26 ms,resvg 栅格化 82 ms,总延迟 109 ms;无记忆化冷编译 624 ms;按 ~150 ms 击键间隔可跟上打字;去掉未变化的 glyph 定义后每帧 SVG 传输从 ~2 MB 降到 ~200 KB — [zed-industries/zed discussion #51633](https://github.com/zed-industries/zed/discussions/51633)
- TUGboat 2026 论文附带的可复现基准(Intel Core i7-1355U,TeX Live 2025,Typst 0.12–0.15,10/100/300 页):LuaTeX 会话内单段落重排约 1 ms 且与文档长度无关;Typst "0.14 and later are about 1.6–2.2× slower per incremental edit than 0.12/0.13 at 300 pages" — [texlode/luatex-benchmark](https://github.com/texlode/luatex-benchmark)
- 面向 LaTeX 用户的官方文档称 Typst 编译"usually taking milliseconds rather than seconds"(搜索摘要,页面本身未直接给出数字) — [Guide for LaTeX Users](https://typst.app/docs/guides/for-latex-users/)

### Inferences
- 对"单个公式 = 一个极小文档"的场景,决定性的不是 comemo,而是 WASM 实例化、字体加载与首个公式的冷编译;后续公式编辑落在 comemo 缓存路径上,按 26 ms/5 页的数据外推应为个位数到十几毫秒量级(推断,未测量)。
- comemo 缓存只在同一编译器实例内有效:浏览器端若每次新建 compiler 实例(或 `reset()`),就失去增量优势;应保持长驻实例并复用 `World`。
- luatex-benchmark 表明 0.14+ 每次增量编辑比 0.12/0.13 慢 1.6–2.2×(300 页),说明"越新越快"不成立,升级 Typst 版本需回归测量。

### Gaps
- 没有任何公开来源给出"单个公式(行内或块级)编译+渲染"的毫秒级测量,无论原生还是 WASM。
- Medium 文章(Typst Studio)声称"典型 5–10 页文档编译 30–50 ms"、"WASM 2.8 MB 压缩后",但页面返回 403 无法核实,数字仅来自搜索摘要,且是作者自建 Rust/WASM 项目而非 typst.ts — [Medium: Typst Studio in Pure Rust](https://autognosi.medium.com/typst-studio-in-pure-rust-webassembly-and-rust-for-modern-web-applications-4e2e52be14a2)
- issue #2393 的数字是 2023 年的历史值,不代表 0.15 现状。

---

## 3. 2026 年有哪些浏览器/WASM 包可以客户端编译与渲染 Typst?体积、加载与渲染延迟、渲染方式?

### Takeaway
事实标准是 Myriad-Dreamin 的 typst.ts(Apache-2.0):`@myriaddreamin/typst-ts-web-compiler`(npm 0.7.0,解包 28.4 MB)+ `@myriaddreamin/typst-ts-renderer`(0.7.0,解包 1.09 MB),稳定版跟踪 Typst 0.14.2,0.8.0-rc3(2026-06-29)跟踪 0.15.0-rc.1;渲染输出 SVG / canvas / 中间 vector 格式并支持增量渲染;字体默认从 CDN 懒加载,体积大头是 typst-assets 内嵌字体(另一项目实测 +42.8 MB raw / +16.4 MB gzip)。2026-07 新出现的 `typst-wasm` 以多运行时一致 API 为目标。公开的浏览器端渲染延迟数字几乎为零。

### Cited Findings
- typst.ts 包家族:`@myriaddreamin/typst.ts`(核心 JS 包装)、`typst.react`、`typst.angular`、`typst.vue3`、`@myriaddreamin/typst-ts-web-compiler`(内部 WASM 编译器)、`@myriaddreamin/typst-ts-renderer`(内部 WASM 渲染器)、`@myriaddreamin/typst-all-in-one.ts`、`@myriaddreamin/rehype-typst`;许可 Apache-2.0;仓库 1.2k stars、1,438 commits、52 open issues — [Myriad-Dreamin/typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
- 三种形态:服务端渲染成 SVG 静态嵌入;服务端预处理成 Vector Artifact Format、客户端渲染(支持"responsive rendering" 与 "incremental server-side rendering");完全客户端编译并操作 canvas — [Myriad-Dreamin/typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
- `all-in-one.bundle.js` 内嵌资源可离线;`all-in-one-lite.bundle.js` 去掉字体与 Wasm,"load extra resources from CDN",从 jsdelivr 拉 `@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm` 与 `@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm`;API:`$typst.svg()`, `$typst.pdf()`, `$typst.vector()`, `$typst.canvas()`, `addSource(path, content)`, `mapShadow(path, data)`, `resetShadow()`, `setCompilerInitOptions()`, `setRendererInitOptions()`;文档注明浏览器 Wasm "Slower performance than native code"、"Requires network font access" — [typst.ts all-in-one 指南](https://myriad-dreamin.github.io/typst.ts/cookery/guide/all-in-one.html)
- 默认 all-in-one 包"will download the font assets from GitHub in browser, so you need to connect to the Internet" — [Myriad-Dreamin/typst.ts](https://github.com/Myriad-Dreamin/typst.ts)
- npm 元数据:`@myriaddreamin/typst-ts-web-compiler` 0.7.0,"WASM module for Compiling Typst documents in JavaScript environment",Apache-2.0,unpackedSize 28,404,270 bytes,7 个文件 — [npm registry](https://www.npmjs.com/package/@myriaddreamin/typst-ts-web-compiler);`@myriaddreamin/typst-ts-renderer` 0.7.0,"WASM module for rendering Typst documents in browser",Apache-2.0,unpackedSize 1,092,944 bytes,7 个文件 — [npm registry](https://www.npmjs.com/package/@myriaddreamin/typst-ts-renderer)
- 版本节奏(GitHub releases Atom 源):v0.6.1-rc5 2025-11-08;v0.7.0-rc2 2025-12-31(Typst v0.14.2);v0.7.0 2026-06-01("Bumped typst to v0.14.2");v0.8.0-rc1 2026-06-19、rc2 2026-06-23、rc3 2026-06-29("Updated the Typst integration to Typst v0.15.0-rc.1";rc2/rc3 修复 "source span resolution by falling back to `vpath`") — [typst.ts releases](https://github.com/Myriad-Dreamin/typst.ts/releases)。注意:同一 releases 页的 HTML 抓取摘要把这些日期报成 2025 年,与 Atom 源的 2026 年冲突;Atom 源带完整时间戳,且 tinymist 2026-09-04 才"更新 typst.ts 到 0.8.0-rc3",以 2026 年为准。
- v0.7.0 新增:snapshot API、on-demand font loading、`typst2hast` 编译特性、`typst.svelte`(Svelte 5)、`set_fonts` API、HTML target 的 query、Typst 0.14 的 PDF 标准支持;修复 snippet 库竞态 — [typst.ts releases](https://github.com/Myriad-Dreamin/typst.ts/releases)
- `TypstSnippet` 高层 API:`vector/pdf/svg/canvas/query`、`addSource/mapShadow/unmapShadow/resetShadow/setFonts`、`use(...providers)`、静态 provider:`preloadFontFromUrl`, `preloadFontData`, `preloadFontAssets`, `disableDefaultFontAssets`, `withAccessModel`, `withPackageRegistry`, `fetchPackageRegistry(accessModel?)`, `fetchPackageBy(accessModel, fetcher)`;`SweetCompileOptions` 接受 `mainFilePath` 或 `mainContent`,可选 `root`、`inputs`(经 `sys.inputs` 可见);内部编译默认 `diagnostics: 'none'` — [snippet.mts 源码](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/contrib/snippet.mts)
- 底层 `compile()` 选项含 `incrementalServer?: IncrementalServer`(增量编译)、`format`(vector 或 pdf,默认 vector)、`diagnostics`(默认 `'full'`);另有 `getSemanticTokens()`、`reset()`(清空字体与源文件缓存)、`runWithWorld()`(拿到 `TypstWorld`) — [compiler.mts 源码](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/compiler.mts)
- 包加载:维护者称 "typst.ts can load cmarker without extra configuration, as long as clients can access packages.typst.org"(cmarker 自带 WASM 插件,即 WASM-in-WASM 可行);本地插件文件报 "cannot read file outside of project root" — [typst.ts discussion #731](https://github.com/Myriad-Dreamin/typst.ts/discussions/731)
- 一位做 PowerPoint 加载项的开发者证实浏览器端自动拉取 Universe 包"was already implemented in typst.ts, just not documented",需自行补"a tiny font cache and registry fetch",无后端即可用 — [Typst Forum #7655](https://forum.typst.app/t/webassembly-auto-download-and-build-typst-packages/7655)
- 第三方体积实测(Rustume 项目 spike,2026-07-28):不含渲染的 `rustume-wasm` 3.8 MB raw / 1.0 MB gzip;加入 `rustume-render`(拉入 Typst 渲染)后 46.6 MB / 17.4 MB,增量 +42.8 MB / +16.4 MB(~17×);"The bulk is `typst-assets`'s embedded font payload";估计 wasm-opt 后约 14 MB gzip;首次导出冷缓存延迟、每击键预览开销均"deferred";并警告 "re-run the spike before trusting its numbers" — [lgtm-hq/Rustume#682](https://github.com/lgtm-hq/Rustume/issues/682)
- 新项目 `typst-wasm`(作者 bradshaw,2026-07-17 发布):面向浏览器、Node、Cloudflare Workers/Vercel 等 serverless;Promise API "closely mirrors" Rust crate;支持 `format: "svg"` 与 HTML 输出;`addFonts()` 加载字体(示例引用 `@typst-wasm/fonts/NewCMMath-Regular.otf`);与 typst.ts 的差异自述:"typst-wasm aims to support many runtimes and provide a consistent api without the use of deprecated APIs";体积、Typst 版本、许可、延迟未在帖中说明 — [Typst Forum #9399](https://forum.typst.app/t/typst-wasm-compile-typst-in-browsers-node-and-serverless-runtimes/9399),仓库 [typst-wasm/typst-wasm](https://github.com/typst-wasm/typst-wasm)
- Quarto 社区用户试用 typst.ts 静态 HTML 示例后反馈 "works incredibly well, live, with almost no latency, and no local typst installation"(定性,2025-04) — [quarto-dev discussion #12439](https://github.com/orgs/quarto-dev/discussions/12439)
- Typst 官方 WASM 插件机制:插件"fully encapsulated with no access to the file system or network",且"plugins work just the same in the web app" — [Plugin 文档](https://typst.app/docs/reference/foundations/plugin/)
- Typst 官方 web app 为闭源、浏览器内使用 — [Typst: Open Source](https://typst.app/open-source/)
- 其他社区浏览器项目(仅列存在性):`atulyak123/Typst-WebAssembly`(Vite + CodeMirror 6 + Typst WASM,SVG 实时预览)、`Mapaor/typst-online-editor`(Next.js + typst.ts)、`automataIA/wasm-typst-studio-rs`(Rust + Leptos)、VS Code 扩展 "Typst WASM Compiler"(SteveLu) — [搜索结果汇总](https://github.com/atulyak123/Typst-WebAssembly)

### Inferences
- 体积预算:编译器 WASM 是主要成本(解包 ~28 MB;字体是大头),渲染器仅 ~1 MB。对笔记组件应:(a) 用 `all-in-one-lite` 或直接依赖两个 `*-bg.wasm` 并自托管;(b) 关闭默认字体(`disableDefaultFontAssets`)、只预载一款数学字体(如 New Computer Modern Math)与一款正文字体;(c) 借助 v0.7.0 的 on-demand font loading。
- 架构选项:若只做公式,可直接在主线程之外的 Web Worker 长驻一个 compiler 实例(obsidian-typst 0.5.0 即迁到 worker,见第 7 节),输出 SVG 字符串插入 DOM;`vector()` + renderer 的增量路径对整页文档更有价值。
- 0.7.0 稳定版仍停在 Typst 0.14.2;想用 0.15 的 MathML/新符号需要用 0.8.0-rc 系列(tinymist 已在生产用 rc3),这意味着"跟版本"要接受 rc 状态。

### Gaps
- 没有任何一手来源给出 typst.ts 在浏览器中的首次加载时间、WASM 实例化时间或每次渲染的毫秒数;Rustume 明确推迟了这些测量。
- 未能拆分 28.4 MB 解包体积中 `.wasm` 本体与 JS/`.d.ts` 的占比,也未获得 gzip/brotli 传输体积(npm 页面 403,jsdelivr 文件 API 路径 404)。
- `typst-wasm` 的许可证、跟踪的 Typst 版本与体积未查到。
- 未找到 Typst 官方 web app 在浏览器端如何编译(WASM 与否、是否增量)的一手说明;issue #909 的提问者声称官方 web app 用 WASM,但抓取内容缺维护者回复 — [typst/typst#909](https://github.com/typst/typst/issues/909)

---

## 4. Typst 如何报告错误?宿主应用能否程序化识别"构造不支持 / 包缺失"?

### Takeaway
Typst 的 `SourceDiagnostic` 带 `severity / span / message / trace / hints`,span 可经 `World` 映射到文件行列;typst.ts 自 PR #492(2024-03)起在 `compile()` 结果中返回结构化诊断(`diagnostics: 'full'` → `{package, path, severity, range, message}`,`range` 形如 `line:char` 或 `startLine:startChar-endLine:endChar`),不再仅抛字符串;但没有错误码,识别"未知变量 / 包缺失"只能靠 message 文本匹配。

### Cited Findings
- Rust 侧诊断结构示例:`SourceDiagnostic { severity: Error, span: Span(143747411669795), message: "the character # is not valid in code", trace: [], hints: [...] }`;span "either from a Typst source file or from a loaded external file";typst-preview 通过 Rust 的 `SourceDiagnostics` + World API 把 span 转成 `(line)39 error: expected expression` 形式 — [typst.ts discussion #485](https://github.com/Myriad-Dreamin/typst.ts/discussions/485)
- 2024-02 时 typst.ts 尚无公开 API 把 span 转行列;维护者指出 WASM 下 "wasm-bindgen never automatically frees objects",需 `e.free()`,因而设计上要避免把原始对象暴露给 JS;开 issue #486 追踪 — [discussion #485](https://github.com/Myriad-Dreamin/typst.ts/discussions/485)
- issue #486 "make diagnostics API for typst.ts"(2024-02-26 开,已关闭)目标:无需手动内存管理、信息完整、不需要诊断时零转换开销;关联 PR #492 — [typst.ts#486](https://github.com/Myriad-Dreamin/typst.ts/issues/486)
- PR #492 "feat: export diagnostics objects" 于 2024-03-09 合并:`compile<D extends DiagnosticsFormat>(options: CompileOptions<'vector', D>): Promise<CompileResult<Uint8Array, D>>`,诊断"returned within the result object"而非抛出;v0.6.0 起未设 `diagnostics` 时返回不含诊断的 `CompileResult<Uint8Array>` — [typst.ts PR #492](https://github.com/Myriad-Dreamin/typst.ts/pull/492)
- 当前类型:`DiagnosticsFormat = 'none' | 'unix' | 'full'`;`DiagnosticMessage { package: string(空表示 workspace 相对路径), path: string, severity: string, range: string(零基行号、一基字符偏移;点为 `line:character`,区间为 `startLine:startCharacter-endLine:endCharacter`), message: string }`;`DiagnosticsData`:`'none'` → never,`'unix'` → string,`'full'` → DiagnosticMessage;`CompileResult { result?: T; diagnostics?: DiagnosticsData[D][] }` 另有 `hasError: boolean`;`compile()` 的 `diagnostics` 默认 `'full'` — [compiler.mts 源码](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/compiler.mts)
- 高层 `TypstSnippet`(即 `$typst.svg()` 等)内部编译默认 `diagnostics: 'none'` — [snippet.mts 源码](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/contrib/snippet.mts)
- 0.8.0-rc2/rc3 "Fixed source span resolution by falling back to `vpath` when needed" — [typst.ts releases](https://github.com/Myriad-Dreamin/typst.ts/releases)
- 解析永不失败,语法错误成为 error node;span 编号在增量解析下保持稳定 — [architecture.md](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- 数学模式未知多字母标识符的错误为 `unknown variable: ab`,并附"加空格"或"加引号"两条 hint(PR #5038) — [typst/typst#5029](https://github.com/typst/typst/issues/5029)
- 编译器侧有专门改进"包未找到"错误信息的 PR(#6433,"Improving error messages in case of package not found") — [typst/typst#6433](https://github.com/typst/typst/pull/6433)
- 警告抑制机制(PR #4459 "Warning suppression")存在,说明诊断分 error/warning 两级并可按需屏蔽 — [typst/typst#4459](https://github.com/typst/typst/pull/4459)
- typst.ts 的 `TypstSnippet` 通过 `DiagnosticsFormat` 泛型参数决定诊断结构 — [DeepWiki: All-in-One API and TypstSnippet](https://deepwiki.com/Myriad-Dreamin/typst.ts/6.2-all-in-one-api-(dollartypst))(二手来源,与源码一致)

### Inferences
- 嵌入时应绕过 `$typst.svg()` 糖 API,直接调用底层 `compile({ mainContent, diagnostics: 'full' })` 或自行封装,以拿到 `range`;`range` 的行列是相对于喂给编译器的整个文件——若在公式外包了 preamble(`#set page(...)` 等),需要减去 preamble 的行偏移再映射回用户输入。
- `DiagnosticMessage` 没有 `code`/`kind` 字段,`hints` 也未列在 JS 类型中;"这是未知变量"、"这是包缺失"只能靠正则匹配 `message`(如 `^unknown variable: (\w+)$`);Typst 的 message 措辞在版本间会变(#5029、#6433 都是措辞改动),需要把匹配规则与 Typst 版本绑定并加回归测试。
- 与 KaTeX(`ParseError` 带 position、`throwOnError`/`errorColor` 直接渲染红字)相比,Typst 的模型是"整段编译要么成功要么给出诊断列表",宿主需自己实现"降级显示"(例如错误时显示上一次成功的 SVG + 错误浮层)。
- 对 AI 生成场景,`unknown variable: sinx` + hint 是很好的自动修复触发器:把标识符按预定义算符表/符号表拆分或加引号后重试。

### Gaps
- 未确认 typst.ts 的 `'full'` 格式是否携带 Rust 侧的 `hints` 与 `trace`(抓取到的类型只列出五个字段);需要读 Rust 绑定源码或实测。
- 未找到 Typst 的诊断"错误码"或稳定分类枚举;据现有来源判断不存在,但没有官方声明。
- 未核实"包未找到"在 0.15 中的确切 message 文本。

---

## 5. LaTeX ↔ Typst 数学互转的状态(MiTeX、tex2typst、pandoc/texmath)与保真度上限

### Takeaway
三条工具链各司其职:MiTeX(0.2.7,2026-04-07,Apache-2.0)是 185 KB 的 Typst 内 WASM 插件,把 LaTeX 数学就地转成 Typst 内容,32.5k 个公式 2.28 s,社区评价"至少 90%";tex2typst(0.6.2,2026-06-14,Apache-2.0)是纯 JS 双向转换器(`tex2typst()`/`typst2tex()`),适合在宿主前端做源码级互换;pandoc 自 3.1.2(2023-03-26)有 Typst writer,texmath 0.12.7 起有 Typst 数学 writer,但 texmath 不能读 Typst 数学,Typst→LaTeX 走 pandoc 的 Typst reader。三者对不支持的命令都没有"保证",且都在追 Typst 的符号重命名(0.14 的 `\langle` ↔ `chevron.l`)。

### Cited Findings
- MiTeX:把 LaTeX 解析成 AST,再转成 Typst 代码并求值;"powered by Rust and WASM";体积"just about 185 KB"对比 texmath 17 MB;转换 OI Wiki 的 32.5k 个公式 WASM 用 2.28 s,texmath 109 s;数学模式支持 `\newcommand`、`\color`/`\textcolor`、aligned/matrix/cases 等环境;文本模式(`\section`、`\textbf`、`\ref`、itemize、tabular 等)仍在开发;局限:"No dynamic command specification yet"、"Limited package support";用法 `#import "@preview/mitex:0.2.7": *`,`#mi(...)` 行内、`#mitex(...)` 块级、`#mitext(...)` 文本;许可 Apache-2.0;设计目标是"rendering LaTeX content correctly within Typst"而非产出可读 Typst — [mitex-rs/mitex](https://github.com/mitex-rs/mitex)
- Universe 页:最新 0.2.7 发布于 2026-04-07;另有 `#mimath`、`#mitex-convert()`;缺失命令"can be reported as issues";在线 PoC "loads files from a git repository and then runs typst compile in browser" — [mitex – Typst Universe](https://typst.app/universe/package/mitex/)
- 命令规格(spec)文件用 Typst 编写,"Even if you don't know Rust, you can still add missing TeX commands to MiTeX by modifying specification files" — [mitex 搜索摘要/README](https://github.com/mitex-rs/mitex)
- CHANGELOG:0.2.7 增加颜色类可选参数、补齐缺失命令、`\smash`;0.2.6 修复 Typst v0.14.0 的 "kai is deprecated" 警告;0.2.5 修 `lvert/rvert` 符号类、`bf` → `bold(upright(..))`、为 Typst 0.12 移除 xarrow 改用 stretch — [mitex CHANGELOG](https://github.com/mitex-rs/mitex/blob/main/CHANGELOG.md)
- 论坛共识:MiTeX 给出"at least 90% of what you want",但没有完整 TeX 引擎就"remains inherently incomplete";推荐用 raw block + show rule:`#show raw.where(lang: "mitex"): set text(1em/0.8)` — [Typst Forum #6755](https://forum.typst.app/t/can-typst-natively-support-latex-math/6755)
- tex2typst:JS/TS 库,npm 包名 `tex2typst`,双向(`typst2tex` "since version 0.3.0");示例 `e \overset{\text{def}}{=} \lim_{n \to \infty}` → `e eq.def lim_(n -> infinity)`;Web UI https://qwinsi.github.io/tex2typst-webapp/;许可 Apache-2.0(0.3.15 起,此前 GPL-3.0);可经 jsdelivr/unpkg 直接在网页加载;115 stars、444 commits — [qwinsi/tex2typst](https://github.com/qwinsi/tex2typst)
- npm 最新 0.6.2,Apache-2.0,"JavaScript library for converting TeX code to Typst" — [npm: tex2typst](https://www.npmjs.com/package/tex2typst)
- 发布节奏:v0.6.2 2026-06-14(修 `#h` 后空格);v0.6.0 2026-04-05(`\varGamma` → `italic(Gamma)`);v0.5.7 2026-03-21(typst2tex:`dot` → `\cdot`,`dot(A)` → `\dot{A}`);v0.5.6 2026-02-20(`\cancel`,识别 `<->` 简写);v0.5.5 2025-12-28(`\left< \right>`、`\bmod`、`\pmod`);v0.5.4(braket 包 `\bra \ket \braket \set`);v0.5.0 2025-11-29("aligning with Typst 0.14 symbol changes (e.g., `\langle` ↔ `chevron.l`)",改进 `\displaystyle` 与分式解析) — [tex2typst releases](https://github.com/qwinsi/tex2typst/releases)
- pandoc 3.1.2(2023-03-26)"Add typst writer (#8713). New module Text.Pandoc.Writers.Typst",并把 typst 加为 PDF 引擎 — [pandoc 3.1.2 changelog](https://hackage.haskell.org/package/pandoc-3.1.2/changelog)
- texmath:能读 TeX math、presentation MathML、OMML,能写 Gnu eqn、typst、pandoc native(读端不含 Typst) — [texmath on Hackage](https://hackage.haskell.org/package/texmath)
- texmath Typst writer 于 0.12.7 加入("New module: Text.TeXMath.Writers.Typst");后续修复:0.12.7.1 over/underbrace 与角标分组;0.12.8.1 转义引号、改进 accent 与矩阵;0.12.8.2 二项式用 `binom` 而非分式;0.12.8.5 尽量用 ASCII 符号;0.13.0.1 prime 与上下标定位;0.13.0.2 转义分号,依赖 typst-symbols 0.1.9.1;0.13.1.1 不在 `|` 与转义符号旁加多余空格;0.13.1.2 避免弃用符号,依赖 typst-symbols 0.2.* — [texmath changelog](https://hackage.haskell.org/package/texmath-0.13.1.2/changelog)
- pandoc 3.1.9 修复 Typst reader 把所有数学识别成行内的回归(证明 pandoc 有 Typst reader 且处理数学) — [pandoc 3.1.9 changelog](https://hackage.haskell.org/package/pandoc-3.1.9/changelog)
- pandoc 3.10.2:新 texmath 修复含 `\tag`、`\label`、注释的公式解析,以及 typst 输出中引号转换 — [pandoc 3.10.2 release](https://github.com/jgm/pandoc/releases/tag/3.10.2)
- Typst→LaTeX 时用户希望 pandoc "pass through" 某些命令的讨论(说明存在无法映射的构造) — [pandoc discussion #9929](https://github.com/jgm/pandoc/discussions/9929)
- 官方文档:"you can use Pandoc to convert your source code to Typst markup",web app 也支持上传 `.tex` 自动转换 — [Guide for LaTeX Users](https://typst.app/docs/guides/for-latex-users/)
- Quarto 用 texmath 的 Typst writer 做 LaTeX→Typst 数学("quarto-math: TeX math front end with OMML and Typst writers") — [quarto-dev/q2 PR #706](https://github.com/quarto-dev/q2/pull/706)

### Inferences
- 面向笔记组件的分工:存储/编辑用 Typst 源;导出到 LaTeX 用 `typst2tex`(前端零依赖、Apache-2.0)或 pandoc;导入历史 LaTeX 笔记用 `tex2typst`(源码级、可读)而不是 MiTeX(MiTeX 产出的是渲染结果,不是给人编辑的 Typst)。MiTeX 适合"用户坚持写 LaTeX 但渲染管线是 Typst"的兼容层。
- 三条链都紧跟 Typst 符号命名变化(`chevron.l`、弃用 `kai`),意味着"Typst 版本 ↔ 转换器版本"必须成对锁定;Typst 尚未 1.0(LWN 指出 pre-1.0 状态与破坏性变更风险),互换层是长期维护成本。
- 保真度上限来自根本模型差异(宏展开 vs 纯函数),官方论坛已给出定论;因此任何"LaTeX 全兼容"承诺都不成立,组件应把 LaTeX 视为导入/导出格式而非运行时语法。

### Gaps
- 未查到 tex2typst 对未知 LaTeX 命令的具体行为(抛错、原样透传还是丢弃),API 选项(`preferTypstIntrinsic` 等)未能从 README 抓取确认。
- 未查到 MiTeX 在运行时遇到 spec 中不存在的命令时的确切表现(报错文本 / 静默)。
- 没有找到任何量化的 LaTeX↔Typst 数学转换保真度基准(如在标准公式集上的通过率);"90%"仅为论坛主观估计。
- 未确认 pandoc Typst reader 对 Typst 数学→LaTeX 的覆盖范围(如 `cases`、`mat`、`attach` 四角标、`lr` 尺寸)。

---

## 6. Typst 能否渲染交换图等图表(fletcher、cetz)?在浏览器 WASM 里能跑吗?

### Takeaway
cetz(0.5.2,LGPL-3.0)与 fletcher(0.5.9,MIT,需 Typst ≥ 0.13、CeTZ ≥ 0.3.4)都是纯 Typst 代码、无 WASM 插件,理论上任何能拉取 `@preview` 包的编译器实例(含 typst.ts 浏览器端)都能运行;实践证据来自 Obsidian 的 Typst Mate("almost all Typst packages are supported")与 typst.ts 用户在浏览器加载含 WASM 插件的 cmarker 成功;但没有任何浏览器端 cetz/fletcher 的渲染延迟数据,且 LGPL-3.0 需评估。

### Cited Findings
- fletcher:"a Typst package for drawing diagrams with arrows, built on top of CeTZ";支持交换图、流程图、状态机、Feynman 图、UML、范畴论图;核心 API `diagram()`, `node()`, `edge()`;最新稳定版 0.5.9;自 0.5.6 起要求 Typst ≥ 0.13.0;依赖 CeTZ ≥ 0.3.4;MIT;1.1k stars、641 commits;手册为 PDF;页面未说明性能或 WASM 兼容性 — [Jollywatt/typst-fletcher](https://github.com/Jollywatt/typst-fletcher)
- cetz:"a library for drawing with Typst with an API inspired by TikZ and Processing";canvas 绘图、图表(cetz-plot)、树、Venn(cetz-venn)、3D 示例;最新 0.5.2;LGPL-3.0;"Pure Typst code (no external plugins required)";`#import "@preview/cetz:0.5.2"`;1.9k stars;页面未说明 Typst 版本要求或浏览器兼容性 — [cetz-package/cetz](https://github.com/cetz-package/cetz)
- fletcher 与原生 cetz 混用有官方"Cetz integration"章节与论坛讨论 — [Typst Forum #4862](https://forum.typst.app/t/how-can-i-use-fletcher-alongside-native-cetz/4862)
- typst.ts 维护者:只要客户端能访问 `packages.typst.org`,typst.ts 即可"without extra configuration"加载 cmarker(该包含 WASM 插件) — [typst.ts discussion #731](https://github.com/Myriad-Dreamin/typst.ts/discussions/731)
- 浏览器端自动拉取 Universe 包已在 typst.ts 实现(未文档化),需自加字体缓存与 registry fetch — [Typst Forum #7655](https://forum.typst.app/t/webassembly-auto-download-and-build-typst-packages/7655)
- Obsidian 的 Typst Mate(WASM 渲染,支持移动端)声明 "Almost all Typst packages are supported"(唯一列出的例外 jlyfish);默认 preamble 导入 `mannot`、`quick-maths` 包 — [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate)
- Quarto 讨论(2025-04-03)中,提议者用 quarto-diagrams 扩展渲染包裹 cetz canvas 的 fletcher/lilaq 图"consistent failures",但同一人测试 typst.ts 静态 HTML 示例"works incredibly well";维护者建议先做 Lua filter;2026-03-08 有协作者指向已有的 "Typst Render" 扩展 — [quarto-dev discussion #12439](https://github.com/orgs/quarto-dev/discussions/12439)
- Typst 插件"fully encapsulated with no access to the file system or network",并且"plugins work just the same in the web app" — [Plugin 文档](https://typst.app/docs/reference/foundations/plugin/)
- 官方 web app 中 Universe 包正常可用是 Typst 生态的基本前提(生态"over 1500 packages",LWN 2026-09-09) — [LWN: Typst makes big strides](https://lwn.net/Articles/1092993/)

### Inferences
- "覆盖边界"结论:Typst 路线下,交换图(fletcher)、TikZ 风格几何/函数图(cetz)、甚至 matplotlib 风格图(lilaq)都在同一编译器、同一语法内,输出同样是 SVG;LaTeX 路线要达到同样覆盖需要 TikZ(浏览器内无解,只能服务端)或 tikzjax 之类的 WASM TeX。这是 Typst 相对 KaTeX/MathJax 的结构性优势。
- 运行前提是包分发:浏览器要么直连 `packages.typst.org`(CORS/离线问题),要么把 cetz/fletcher 的 tarball 随组件自托管并用 `withPackageRegistry` 注入;后者更适合个人笔记应用(离线可用、版本锁定)。
- cetz 是解释执行的纯 Typst 代码,复杂图的求值成本远高于单个公式;在 WASM 中还有额外倍数;应把图表编译放在 worker 并做防抖,与公式渲染分离队列。
- 许可:cetz 为 LGPL-3.0——作为运行时下载的"数据"(Typst 源码被解释执行)而非静态链接进组件,通常不传染宿主代码,但商用分发前需法务确认;fletcher(MIT)、typst.ts(Apache-2.0)无此顾虑。

### Gaps
- 没有 cetz/fletcher 在 typst.ts 浏览器 WASM 中的直接成功案例文档或延迟数字(仅有 Obsidian Typst Mate 的"几乎所有包可用"与 typst.ts 的 cmarker 案例作为间接证据)。
- Quarto 讨论中的失败根因(是 quarto-diagrams 扩展的 Typst CLI 调用问题还是包本身)未在帖中给出。
- cetz 的 Typst 版本兼容矩阵未能从 README 抓到。

---

## 7. 有哪些用 Typst 做数学语言并实时渲染的笔记/编辑器项目?它们学到了什么?

### Takeaway
现成先例集中在 Obsidian(fenjalien/obsidian-typst 已停在 2024-03 / Typst 0.11;azyarashi/obsidian-typst-mate 与 0xbolt/obsidian-wypst 在 2026 仍活跃)、Emacs(org-typst-math 用长驻 Rust helper)和编辑器预览(tinymist,2026-09-08 v0.15.8 跟 Typst 0.15.1);共同经验:把编译器放到 worker/长驻进程、单独下载 WASM 以减小插件体积、字体按需加载、用 preamble 注入 `WIDTH/SIZE/THEME` 适配宿主样式、对 LaTeX 输入做回退(wypst 回退 MathJax)。

### Cited Findings
- fenjalien/obsidian-typst("Typst Renderer"):把 typst 代码块与(可选)数学块渲染成图片,"through the power of WASM";WASM 文件在首次启用与更新后单独下载以缩小插件体积;因为当时"Typst does not currently support exporting to HTML only PDFs, PNGs and SVGs",输出 PNG/SVG,"Rendered views may look a bit terrible"(缩放问题);"Override Math Blocks" 设置用 Typst 替代 MathJax,`$...$` → `$...$`、`$$...$$` → `$ ... $`,但 "LaTeX code is incompatible";三类 preamble(Shared/Math/Code)注入 `WIDTH`, `HEIGHT`, `SIZE`(CSS 字号)、`THEME`("light"/"dark");包支持 `@preview` 与 `@local`,桌面端自动下载到 vault 插件目录,移动端仅 `@preview`;运行时错误 "Unreachable or Recursive Use Of Object" 需重启插件;当前 0.10 支持 Typst 0.11.0 — [obsidian-typst README](https://github.com/fenjalien/obsidian-typst/blob/master/README.md)
- 其版本史:0.5.0 把编译器移入 web worker 并重做文件读取;0.5.1 重新启用系统字体但改为选择性加载;0.6.0(2023-08-31)加 SVG 导出、改进错误报告;0.8.0(2023-11-05)加包下载与移动端文件读取、改善加载时间;0.9.0(2024-01-16)移除 SVGO,SVG 随行高缩放;0.10.0(2024-03-19)升到 Typst 0.11.0——为最新版本 — [obsidian-typst releases](https://github.com/fenjalien/obsidian-typst/releases)
- azyarashi/obsidian-typst-mate("Typst Mate"):用 Typst 替代 MathJax 渲染行内/块级/代码块;WASM 二进制"automatically downloaded from the Releases page"以免拖慢启动;支持后台渲染(worker)与移动端;导出/复制 SVG(Obsidian 主题或 Typst 默认样式)与 PNG、HTML;preamble/模板/Processor 机制,默认 preamble 页边距为零并导入 `mannot`、`quick-maths`;输入 `\` 可按 LaTeX 命令名搜索符号补全;矩阵/cases 片段;"Almost all Typst packages are supported";系统字体与本地包仅桌面端;Apache-2.0;673 commits;注明部分默认值与标准 Typst 不同(`datetime`、`smallcaps`、`fontsize`) — [azyarashi/obsidian-typst-mate](https://github.com/azyarashi/obsidian-typst-mate)
- 0xbolt/obsidian-wypst:基于 wypst 库(0xpapercut/wypst)覆盖 `$...$`/`$$...$$` 为 Typst 数学;遇到 `\begin{environment}...\end{environment}` 或 `\<symbol>` 等 LaTeX 结构时"the rendering backend switches to MathJax";实验性 `fallbackToLatexOnError`;MIT;声称等价表达式在 Typst 与 LaTeX 下"should render to exactly the same output" — [0xbolt/obsidian-wypst](https://github.com/0xbolt/obsidian-wypst)
- Obsidian 社区插件目录中带 #typst 标签的插件共 3 个(Typst Renderer、Typst Mate、以及 wypst) — [obsidianstats #typst](https://www.obsidianstats.com/tags/typst)
- DzmingLi/org-typst-math(Emacs):在 Org 的 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 内写 Typst 数学;长驻 Rust helper "links directly to Typst's Rust libraries",保留字体数据库与编译缓存;预览为 SVG(需 Emacs 30.2+);HTML 导出用 helper 的 MathML 输出,LaTeX 导出把 Typst 数学转成 LaTeX;每次导出把所有公式合成一个批量 JSON-RPC 请求;未变化的 SVG 复用已有 image 对象;限制:包不会自动下载、文本分式显示实验性(`a/b/c` 保留源码)、嵌套分式行高变大 — [DzmingLi/org-typst-math](https://github.com/DzmingLi/org-typst-math)
- tinymist 预览:两半架构——编译管线(LSP + comemo 增量编译)与渲染管线(reflexo vector IR → WASM 前端 → 浏览器 canvas);`IncrSvgDocServer` 记忆化未改页面,只把有改动的页放进 delta 更新;Web (SVG) 预览"much faster than PDF preview";双向跳转;`--partial-rendering` 选项 — [Zed RFC #51633](https://github.com/zed-industries/zed/discussions/51633);[tinymist Preview 文档](https://myriad-dreamin.github.io/tinymist/feature/preview.html)
- tinymist 发布:v0.15.8 2026-09-08(Typst v0.15.1,PDF 导出编辑器动作);v0.15.6 2026-09-06;v0.15.4 2026-09-04(typst.ts 升到 0.8.0-rc3,加 LSIF/SCIP 索引) — [tinymist releases](https://github.com/Myriad-Dreamin/tinymist/releases)
- Enter-tainer/typst-preview 已标记 "[DEPRECATED] Use tinymist instead" — [Enter-tainer/typst-preview](https://github.com/Enter-tainer/typst-preview)
- `@myriaddreamin/rehype-typst` 0.7.0,MIT,"rehype plugin for rendering typst math equations",依赖 `@myriaddreamin/typst-ts-node-compiler ^0.7.0`(即 Node 侧、构建期渲染 Markdown 中的 Typst 数学) — [npm: @myriaddreamin/rehype-typst](https://www.npmjs.com/package/@myriaddreamin/rehype-typst)
- 一位开发者在浏览器 PowerPoint 加载项中用 typst.ts 实现无后端的 Typst 编译与包拉取 — [Typst Forum #7655](https://forum.typst.app/t/webassembly-auto-download-and-build-typst-packages/7655)
- 社区其他浏览器编辑器:Next.js + typst.ts 在线编辑器、Vite + CodeMirror 6 + Typst WASM 实时 SVG 预览 — [Mapaor/typst-online-editor](https://github.com/Mapaor/typst-online-editor);[atulyak123/Typst-WebAssembly](https://github.com/atulyak123/Typst-WebAssembly)

### Inferences
- 可直接复用的工程模式:(1) 编译器进 Web Worker、主线程只收 SVG 字符串;(2) WASM 与字体延迟/分离下载;(3) 每个公式用固定 preamble 包裹(`#set page(width: auto, height: auto, margin: 0pt)` + 字号/颜色来自 CSS 变量),用 `sys.inputs` 传 `THEME/SIZE`;(4) 输出 SVG 时按 em 单位设置 viewBox 以实现基线对齐(1024th 博文与 obsidian-typst 0.9.0 都在处理"随行高缩放"的问题);(5) 对 LaTeX 输入保留 KaTeX/MathJax 回退(wypst 模式)。
- 停更风险真实存在:obsidian-typst 停在 Typst 0.11(2024-03),而 Typst 0.12→0.15 有多次符号/布局破坏性变更;选型时应把"跟版本速度"作为指标(tinymist/typst.ts 在 0.15 发布两周内就有 rc)。
- 目前没有任何项目宣称做到了"AI 从非正式输入生成 Typst 公式并可编辑"这一整套闭环;Typst Mate 的 `\` 命令名搜索是最接近"帮 LaTeX 用户过渡"的交互设计。

### Gaps
- Typst Mate 与 wypst 的最新版本号/日期、以及所用 WASM 引擎(自编译 Typst 还是 typst.ts)未能从 README 抓到。
- 未找到任何这些项目公布的渲染延迟、内存占用或崩溃率数据。
- typst-preview 架构页(`arch.html`)只抓到目录,增量 vector IR 的协议细节未拿到一手描述。

---

## 8. Typst 的 HTML 导出与 MathML 输出到 2026 年是什么状态?

### Takeaway
Typst 0.15.0(2026-06-15)在 HTML 导出中原生输出 MathML,替代此前"公式被忽略/靠 `html.frame` 转 SVG"的状况;但整个 HTML 导出仍是实验特性(需 `--features html` 或 `TYPST_FEATURES=html`,官方明言"Do not use this feature for production"),浏览器间 MathML 渲染质量不一致,已有矩阵/向量间距 issue;需要视觉一致性时官方仍建议 SVG。

### Cited Findings
- 0.15.0 发布于 2026-06-15;"With Typst 0.15, native support for equations via MathML was added";MathML 保留结构与语义,文本可选、可被屏幕阅读器朗读;此前 HTML 导出"would completely ignore equations",变通是 `html.frame` 转 SVG 但不可访问、不可选;"MathML is supported across all major browsers, but the rendering quality varies somewhat","If absolute visual consistency is crucial, rendering to SVG may still prove more suitable" — [Typst 0.15 博客](https://typst.app/blog/2026/typst-0.15/)
- HTML 导出"under active development and experimental only","The feature is still very incomplete and only available for experimentation behind a feature flag. Do not use this feature for production use cases";启用:`--format html` 或输出文件名 `.html`,并加 `--features html` 或 `TYPST_FEATURES=html`;目标是语义化 HTML 而非视觉复刻;不自动生成 CSS;当前总是输出单个独立 HTML 文件,fragment 输出为规划中;`html` 模块提供 `elem`、`frame`(内联 SVG 布局回退)、`typed` — [Typst HTML 文档](https://typst.app/docs/reference/html/)
- Changelog 0.15.0:公式在 HTML 导出中自动输出为 MathML,"MathML defines how to render an equation, but also preserves its semantics";此前用 `html.frame` show rule 的用户被建议迁移到 MathML 以提升可访问性;新增实验性 `bundle` 导出(一个项目输出多文件:HTML 页面、PDF、PNG、SVG 与任意资源,需 `--features bundle`) — [Typst 0.15.0 Changelog](https://typst.app/docs/changelog/0.15.0/)
- 早期 MathML PR #5721 于 2025-02-23 关闭未合并;它尝试映射 `<mi> <mo> <mn> <mtext> <mrow> <mfrac> <msub> <msup> <munder> <mover> <mtable>`(矩阵)、accent、cancel;发现的问题:Chrome 缺 `<menclose>`(cancel 需要)、矩阵单元对齐差、数学字体不完整;Typst 中 `mtext/mo/mi/mn` 都来自 `TextElem` 难区分;`mathvariant` 处理;`underline/overline`、`underparen/overparen` 跨浏览器失败;核心团队(reknih)当时建议"默认 SVG + 叠加不可见 MathML 供无障碍"、同时支持 MathML Core 与 MathML 3(PDF/UA-2)、CSS/SVG polyfill、允许 alt 文本 — [typst/typst PR #5721](https://github.com/typst/typst/pull/5721)
- `math.equation` 支持 `alt` 参数提供自然语言描述(无障碍) — [Typst Math 文档](https://typst.app/docs/reference/math/)
- 已知 0.15 MathML 问题:多行公式中矩阵/向量元素间距 — [typst/typst#8850](https://github.com/typst/typst/issues/8850)
- LWN(2026-09-09):HTML 导出"still an experimental feature",需特殊 flag;MathML 让公式在浏览器中渲染"without requiring JavaScript libraries like MathJax or image fallbacks";生态 1500+ 包、460 贡献者;评论者指出缺 italic correction 导致 "_odd_ function" 等间距问题;pre-1.0 状态阻碍学术采用 — [LWN: Typst makes big strides](https://lwn.net/Articles/1092993/)
- 0.15 之前的实践(2026-01-25 博文):用 `html.frame` 把公式渲染为 SVG,行内公式通过查询不可见 label 的位置计算 `vertical-align` 偏移;把 SVG viewBox 的 em 单位换算到文字尺寸做基线对齐;`target()` 在 figure 内的 `html.frame` 中会错误地变成 `paged` — [1024th: Typst HTML Export with Math Support](https://1024th.top/posts/typst/typst-html-export)
- typst.ts v0.7.0 加入 `typst2hast` 编译特性与 HTML target 的 query(即在 JS 侧可拿到 HTML/hast 输出) — [typst.ts releases](https://github.com/Myriad-Dreamin/typst.ts/releases)
- org-typst-math 的 HTML 导出已实际使用 helper 的 MathML 输出 — [DzmingLi/org-typst-math](https://github.com/DzmingLi/org-typst-math)
- 另有 Quarto 社区提问"Is it possible to render typst formula in html?"(说明需求端在关注) — [quarto-dev discussion #14572](https://github.com/orgs/quarto-dev/discussions/14572)

### Inferences
- 对浏览器笔记组件,MathML 路线的价值在于可访问性、可选中、随 CSS 缩放、无字体下载;代价是渲染依赖浏览器 MathML Core 实现(Chrome 与 Firefox/Safari 差异、`menclose` 缺失),以及 Typst 侧仍标注"实验、勿用于生产"。2026-09 的稳妥做法是:主渲染走 SVG(typst.ts renderer / `typst_svg`),同时可选生成 MathML 作为隐藏无障碍层或复制/导出格式——这恰是 PR #5721 中核心团队提出的方案。
- 0.15 的 MathML 是从 content 而非 frames 生成(架构文档:HTML 导出从 content 出发),因此它不受 comemo 布局缓存影响,理论上更便宜;但 typst.ts 稳定版(0.7.0,Typst 0.14.2)拿不到它,必须用 0.8.0-rc。
- 用 MathML 做"Typst → 其他系统"的中间格式在纯数学上可行(texmath 可读 MathML 再写 TeX),这给出了一条 Typst→MathML→LaTeX 的备选互换路径。

### Gaps
- 未找到 0.15 MathML 实现的官方"支持/不支持元素清单"(如 `cancel`、`underbrace`、`lr` 尺寸、`attach` 四角标、`class` 间距是否完整映射)。
- 未找到 0.15 MathML 输出在 Chrome/Firefox/Safari 三家的对比截图或测评。
- 未确认 typst.ts 0.8.0-rc3 是否已把 MathML 数学暴露在 `typst2hast`/HTML target 里。

---

## 9. 综合:对"可编辑公式 + AI 层"的 Web 笔记组件,Typst 路线的可行架构与取舍

### Takeaway
Typst 路线可行且在"输入贴近自然打字、图表覆盖面、错误可机读"三点上优于 LaTeX/KaTeX 路线,但要付出 ~28 MB 解包(字体为主)的编译器 WASM、跟随 pre-1.0 破坏性变更、以及自行构建诊断→UI 的映射;推荐"Typst 源为主、SVG 渲染、MathML 为无障碍/导出层、LaTeX 仅作导入导出"的混合架构。

### Cited Findings
- 官方架构:编译器无状态、经 `World` 注入文件/字体;增量缓存以元素粒度;HTML 导出从 content 出发 — [architecture.md](https://github.com/typst/typst/blob/main/docs/dev/architecture.md)
- typst.ts 提供 `withAccessModel`、`withPackageRegistry`、`preloadFontData`、`disableDefaultFontAssets`、`incrementalServer` 等钩子 — [snippet.mts](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/contrib/snippet.mts);[compiler.mts](https://github.com/Myriad-Dreamin/typst.ts/blob/main/packages/typst.ts/src/compiler.mts)
- 字体是 WASM 体积大头(+16.4 MB gzip 归因于 `typst-assets`) — [Rustume#682](https://github.com/lgtm-hq/Rustume/issues/682)
- 编译器 WASM 解包 28.4 MB、渲染器 1.09 MB(npm 0.7.0) — [npm web-compiler](https://www.npmjs.com/package/@myriaddreamin/typst-ts-web-compiler);[npm renderer](https://www.npmjs.com/package/@myriaddreamin/typst-ts-renderer)
- 5 页文档记忆化编译 26 ms / 冷 624 ms(原生 tinymist 管线) — [Zed RFC #51633](https://github.com/zed-industries/zed/discussions/51633)
- 社区拒绝原生 LaTeX 数学;MiTeX 约 90% — [Typst Forum #6755](https://forum.typst.app/t/can-typst-natively-support-latex-math/6755)
- Typst pre-1.0、存在破坏性变更(0.15 的 `lr` size 语义、`class` 非递归) — [Changelog 0.15.0](https://typst.app/docs/changelog/0.15.0/);[LWN](https://lwn.net/Articles/1092993/)
- 0.14+ 每次增量编辑比 0.12/0.13 慢 1.6–2.2×(300 页) — [luatex-benchmark](https://github.com/texlode/luatex-benchmark)

### Inferences
- 参考架构(推断,基于上述来源):
  1. 存储格式:每个公式保存 Typst 数学源(`$ ... $` 内部文本)+ 可选缓存的 SVG;AI 层的 prompt 目标语言设为 Typst 数学,并把"预定义算符表 + 常用符号名表"作为系统提示的一部分以减少 `unknown variable`。
  2. 渲染:Web Worker 内长驻 `TypstCompiler`(typst.ts 0.8.0-rc 系或 typst-wasm),固定 preamble(`#set page(width: auto, height: auto, margin: 0pt)`、`#set text(size: ..)` 由 `sys.inputs` 传入主题/字号),`compile({diagnostics:'full'})` 后用 renderer 或 `svg()` 得 SVG;按 em 设置 viewBox 与 `vertical-align` 做基线对齐(1024th 博文做法)。
  3. 错误:把 `DiagnosticMessage.range` 的行列减去 preamble 偏移映射回输入框;按 message 正则识别 `unknown variable` 并触发 AI/规则自动修复(拆空格、`dx`→`dif x`、`limit`→`lim`);包缺失则提示或自托管包。
  4. 互换:导入 LaTeX 用 `tex2typst`;导出 LaTeX 用 `typst2tex` 或 pandoc;导出 HTML 可用 0.15 MathML(实验)或直接内联 SVG。
  5. 图表:按需加载 cetz/fletcher tarball 到自托管 registry(注意 cetz LGPL-3.0),单独队列、更长防抖。
- 与 LaTeX(KaTeX)路线的量化对照点应在实现前自行测:首次可交互时间(WASM 实例化 + 数学字体)、单公式热编译延迟、10 个公式并发编辑时的 worker 队列延迟;公开资料对这三项均无数据。
- 版本策略:锁定 Typst 次版本(如 0.15.x)+ 对应 typst.ts/tex2typst/MiTeX 版本,每次升级跑一套"符号名/错误文本/渲染快照"回归。

### Gaps
- 缺少任何针对"公式级"WASM 渲染的基准;必须自测。
- 未评估 typst.ts 在 Safari/iOS WebKit 上的内存上限与 WASM 体积限制(未找到来源)。
- 未找到 Typst 编译器本身许可证的一手抓取(通行认知为 Apache-2.0,以 [typst/typst](https://github.com/typst/typst) 仓库 LICENSE 为准,本次未单独核验)。
