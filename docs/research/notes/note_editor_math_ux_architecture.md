# 笔记/文档编辑器中的数学公式集成：交互模型与编辑器架构调研（截至 2026-09）

> 状态：v3（七个关键问题均已成文）。约定：每条事实后附一手或最接近一手的来源 URL；标注「（搜索摘要）」者表示只在搜索结果摘要中看到、未能抓取原页核实；无法证实的内容一律放入各节 Gaps。项目名、API 名、选项名、代码标识符保留英文原文。

## Q1 行内公式的编辑交互模型有哪些？哪些产品用哪种？取舍是什么？

### Takeaway
实际产品可归为五类：(A) 光标进入即就地展开源码（CM6/Emacs 系：Obsidian Live Preview、Overleaf Visual Editor、Zettlr、Typora 行内公式、org-mode + org-fragtog）；(B) 原子节点 + 锚定弹层编辑器（Notion、RemNote、AFFiNE/BlockSuite、Milkdown Crepe、Plate、Tiptap 自定义 `onClick`、Logseq/Obsidian 的 MathLive 插件）；(C) 就地结构化（WYSIWYG）编辑（Mathcha、Word、Google Docs、MathLive 类控件）；(D) 整块/整单元格源码-渲染切换（Logseq、Jupyter、marimo）；(E) 非 LaTeX 的「计算型」行内建议（Apple Math Notes）。用户想要的「点击默认不塌缩为源码」是 B/C 类的默认行为；A 类默认塌缩，其代价（布局跳动、编辑时看不到渲染）被 Overleaf 与 Latex Suite 用「光标上方实时预览 tooltip」部分补偿。

### Cited Findings

#### (A) 光标进入即就地展开源码
- Obsidian 官方：「Live Preview shows formatted text inline while hiding most Markdown syntax」「When your cursor enters formatted content, the underlying syntax becomes visible for editing」；`Ctrl/Cmd+E` 在 Reading 与 Editing 视图间切换，可给命令 "Toggle Live Preview/Source mode" 绑定热键 — [Obsidian Help: Views and editing mode](https://obsidian.md/help/edit-and-read)；数学用 `$`/`$$` + MathJax — [Obsidian Help: Advanced syntax](https://obsidian.md/help/advanced-syntax)
- Obsidian 的代价：编辑长公式后光标移开，源码被更矮的渲染结果替换，视口跳动、光标在屏幕上大幅上移；2023-09-01 报告，2026-07-14 staff 建议改提 Feature Request，2026-08-16 移入 "Bug Graveyard"，未解决 — [Obsidian Forum #66219](https://forum.obsidian.md/t/when-collapsing-equations-for-live-preview-leave-cursor-at-the-same-position-relative-to-the-screen/66219)
- Obsidian 插件 Latex Suite：「inline math preview」在 `$ ... $` 内输入时弹出 tooltip 实时渲染；「conceal」把源码中的 `\dot{x}^{2}` 显示为 "ẋ²"、光标靠近时恢复（可给方向键导航设延迟；需 JuliaMono 等字体）；Tab「tabout」跳出公式或下一个闭括号；matrix 环境中 Tab 插 `&`、Enter 插 `\\` — [obsidian-latex-suite README](https://raw.githubusercontent.com/artisticat1/obsidian-latex-suite/main/README.md)
- Obsidian 插件 "No More Flickering Inline Math"（RyotaUshio）：Live Preview 中在 `$...$` 内输入/移动会闪烁，根因是 Obsidian 不把 `$ ...$`/`$... $`（定界符内侧紧挨空格）识别为数学；插件在进入行内公式时插入 `${} ... {}$`，空括号由装饰隐藏，离开时自动删除；与 Latex Suite 同用需修改 snippet 中的 `$1` — [obsidian-inline-math README](https://raw.githubusercontent.com/RyotaUshio/obsidian-inline-math/master/README.md)
- Obsidian 插件 MathLinks：在 frontmatter 写 `mathLink`（或 `mathLink: auto` 模板替换，如 "iff"→`$\Leftrightarrow$`），指向该笔记的链接文本以 MathJax 渲染；支持 Reading/Live Preview/Canvas；「No changes are made to your notes」；对外暴露 API；Source mode 下仅支持 Wikilinks — [obsidian-mathlinks README](https://raw.githubusercontent.com/zhaoshenzhai/obsidian-mathlinks/master/README.md)
- Obsidian 插件 "MathLive in Editor Mode"（MizarZh，repo `obsidian-mathlive-codemirror`）：用 CM6 widget 在 LaTeX 渲染块下方放一个 MathLive 编辑器，可切换 global/block/inline 与 MathLive/内置 MathJax；inline widget 的焦点保持是「experimental focus-preservation path」且「depends on internal editor behavior」；v0.4.3（约 2026-07）— [Obsidian Stats](https://www.obsidianstats.com/plugins/mathlive-in-editor-mode)
- Overleaf Visual Editor：selection 与公式区间相交即不渲染 widget、露出 LaTeX（`shouldDecorate = state.readOnly || !selectionIntersects(state.selection, extents)`）；环境类公式（`$Environment`）按整行判断（`shouldDecorateFromLineEdges`）— [overleaf atomic-decorations.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/visual/atomic-decorations.ts)
- Overleaf Code 模式「math preview」：光标在公式内且 selection 为空时，在光标上方 8px 弹出 tooltip 实时渲染；公式语法有错时不显示；可经 compartment（`setMathPreview`）开关 — [overleaf math-preview.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/math-preview.ts)
- Zettlr（CM6）：`if (rangeInSelection(state.selection, node.from, node.to, includeAdjacent)) { return undefined }`——selection 覆盖（可含相邻）时不创建 widget、显示源码；数学在语法树中作为带 `$` 标记的 `InlineCode`/`FencedCode` 节点识别（`shouldHandleNode`），经 `katexToElem()` 渲染；widget 默认忽略所有事件，点击选择与右键菜单另由工具函数处理 — [Zettlr render-math.ts](https://raw.githubusercontent.com/Zettlr/Zettlr/master/source/common/modules/markdown-editor/renderers/render-math.ts)
- Typora：「Moving the cursor to the middle of a span element will expand that element into the Markdown source」（行内公式属于 span，因此属 A 类）；行内公式须在偏好设置 Markdown 标签页启用；「To trigger an inline preview for inline math: input "$", then press the ESC key」— [Typora Markdown Reference](https://support.typora.io/Markdown-Reference/)。块公式 `$$`+Return 进入「input mode」源码区，Up/Down、Cmd/Ctrl+Return、点 ✓ 或点别处结束；MathJax v3；AMS 自动编号、`\label`/`\ref` — [Typora Math docs](https://support.typora.io/Math/)
- ProseMirror 社区对 Typora 行为的拆解（benrbray，2020-06-12）：Property A=光标在公式内显示源码、离开后 KaTeX 渲染；Property B=点击或方向键无缝进出。用 `contentDOM` 可满足 B 不能满足 A；无 `contentDOM` + `atom:true` + 嵌套编辑器（`selectNode`/`deselectNode`）满足 A，但内部光标总落在开头；Desmos 的 Denis 建议在 `dispatchTransaction` 中追踪进入方向并调用内部编辑器 `moveToLeftEnd()`/`moveToRightEnd()`；Marijn 建议用 node decoration 标记「光标在此公式内」，并指出 ProseMirror 依赖浏览器原生光标移动 — [discuss.prosemirror.net #2906](https://discuss.prosemirror.net/t/replicating-typoras-inline-display-math-editing/2906)。该讨论产出了 prosemirror-math：「math as part of the text itself, rather than as an 'atom' that can only be edited through a dialog box」— [prosemirror-math README](https://raw.githubusercontent.com/benrbray/prosemirror-math/master/README.md)
- Emacs org-mode：`org-latex-preview`（`C-c C-x C-l`）生成图片并「overlay it over the source code」— [Org Manual](https://orgmode.org/manual/Previewing-LaTeX-fragments.html)；org-fragtog 在光标进入/离开片段时自动切换预览（post-command-hook + overlays），MIT，445 stars — [org-fragtog](https://github.com/io12/org-fragtog)；TEC 与 Karthink 的预览系统重写（边输入边预览、公式编号一致、`org-latex-preview-auto-mode`→`org-latex-preview-mode` 等更名）原计划进 Org 9.8 — [emacs-orgmode 邮件](https://www.mail-archive.com/emacs-orgmode@gnu.org/msg166227.html)，但当前 Org 9.8 release notes 只列出 `xelatex` 预览进程等增量改进，未包含该重写 — [Org Changes](https://orgmode.org/Changes.html)

#### (B) 原子节点 + 锚定弹层（popover）编辑器
- Notion：行内公式三种创建法——输入 `$$公式$$` 自动转换；`ctrl/cmd + shift + E` 打开输入框；选中段落中的文本后点格式菜单 `√x` 或按 `ctrl/cmd + shift + E` 直接转成公式。点击行内公式打开编辑器，修改实时反映到页面；「navigate to equations using arrow keys—the input opens automatically」；块公式 `/math`；KaTeX；复制行内公式得到源码 — [Notion Help: Math equations](https://www.notion.com/help/math-equations)
- RemNote：输入 `$$` 弹出带实时预览的 LaTeX 弹层，Done 或 Enter 完成；「click on it or move the cursor over it with the arrow keys to reopen the popup」；默认 inline，下拉菜单或 `Alt+B` 切 block；可在公式里选中局部点「Create Cloze」做挖空卡片（Alt+点击多段）；AI 自然语言→LaTeX 建议点 Accept 或按 Tab 接受；KaTeX — [RemNote Help](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- AFFiNE/BlockSuite（`@blocksuite/affine-inline-latex`，npm 0.22.4 — [npm](https://www.npmjs.com/package/@blocksuite/affine-inline-latex)）：点击行内公式节点 `preventDefault()` 后 `toggleEditor()`，经 `createLitPortal` 在节点下方弹出 `latex-editor-menu`；KaTeX `katex.render(latex, container, { displayMode: false })`，空值显示 "Equation" 占位、出错显示 "Error equation" — [latex-node.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-node.ts)；弹层编辑面是绑定 `yText` 的嵌套 `<rich-text>`，用 Shiki `codeToTokensBase()` 做 LaTeX 语法高亮，Enter 确认（`abortController.abort()`）、Shift+Enter 换行、✓ 图标关闭，未见 Escape 处理 — [latex-editor-menu.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-editor-menu.ts)
- Milkdown Crepe：行内公式由 `LatexInlineTooltip` 弹层编辑（确认按钮 `inlineEditConfirm`）；块公式复用 CodeMirror 代码块（`language === 'latex'`）+ KaTeX `renderToString(displayMode: true)` 预览；未启用 CodeMirror 时抛错 — [Milkdown crepe/feature/latex/index.ts](https://raw.githubusercontent.com/Milkdown/milkdown/main/packages/crepe/src/feature/latex/index.ts)
- Plate（`@platejs/math`）：行内 void `inline_equation`「opens a popover when the inline void node is selected and the selection is collapsed」，弹层内 textarea，Enter 提交，Escape 关闭并恢复初始表达式 — [Plate Equation docs](https://platejs.org/docs/equation)
- Tiptap `@tiptap/extension-mathematics`：`inlineMath`/`blockMath` 不自带编辑 UI，靠 `inlineOptions`/`blockOptions` 的 `onClick`，官方示例用浏览器 `prompt()`，可换自定义弹层 — [Tiptap Mathematics docs](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- Lexical playground：单击把公式提升为 `NodeSelection`（`useLexicalNodeSelection`），双击才就地把 KaTeX 渲染换成 textarea/input 源码框（介于 A/B 之间）— [Lexical EquationComponent.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationComponent.tsx)
- Logseq 插件 logseq-live-math：弹层集成 MathLive，`Ctrl+Shift+M`、`/math`、输入 `$$` 或鼠标选中已有公式触发，编辑时「real-time update of the LaTeX formula in the block」，Enter 确认写回（`$`/`$$`）；MathLive 对 `align`/`split` 支持欠佳 — [logseq-live-math README](https://raw.githubusercontent.com/AllanChain/logseq-live-math/main/README.md)
- Obsidian 插件 MathLive（danzilberdan）：命令 "Add inline math"/"Add full-line math" 打开 MathLive 可视化编辑器后插入；先选中文本则以选区为初始内容；支持公式图片 OCR；仅桌面端 — [Obsidian 插件页](https://community.obsidian.md/plugins/mathlive)；[GitHub](https://github.com/danzilberdan/obsidian-mathlive)（搜索摘要）
- Anytype：已实现行内 LaTeX（`$E = mc^2$`），专用块 `/latex` — [Anytype Docs](https://doc.anytype.io/anytype/create/editor/inline-latex)；社区多年请求后标记 Implemented — [Anytype Community](https://community.anytype.io/t/inline-latex-addition/2315)

#### (C) 就地结构化（WYSIWYG）编辑
- Mathcha：作者自写数学符号渲染（非 MathJax/KaTeX）；代码编辑器式「suggestion box」（`\` 触发，按名称/分类/「Draw to Find」手绘查找），「keep the flow of input smoothly…without moving away from keyboard」；括号高度随内容自动调整；matrix/cases/aligned/gathered；LaTeX 导入导出、PDF 打印，2017 年称在做 TikZ 导出 — [Mathcha 作者博客 2017](https://nhabuiduc.wordpress.com/2017/09/05/mathcha-wysiwyg-online-math-editor/)；`$` 插行内公式、`^`/`_` 上下标；非英语输入法下快捷键可能失效 — [Mathcha Docs: Shortcuts](https://www.mathcha.io/documentation/shortcuts/)
- Microsoft Word：`Alt+=` 插入公式；linear（UnicodeMath 或 LaTeX，「the equation as source text」）与 professional 两种显示；空格自动 build-up；`Ctrl+=` linear→professional、`Ctrl+Shift+=` 反向；LaTeX 不支持 `\begin{}`/`\end{}`（用 `\matrix{}`）等 — [MS Support: Linear format](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)；点击公式出现 Equation Tools；可手写 Ink Equation 并在插入前预览 — [MS Support: Write an equation](https://support.microsoft.com/en-us/office/write-an-equation-or-formula-1d01cabc-ceb1-458d-bc70-7f9737722702)
- Google Docs：Insert → Symbols → Equation；从 Greek letters/Relations/Math operators 等菜单选符号；`\` + 符号名 + 空格插入（`\alpha`），`\` 后 Shift+6 / Shift+- 输入上下标；官方页未提 LaTeX 源码输入 — [Google Docs Help](https://support.google.com/docs/answer/160749)；第三方开源插件 Auto-LaTeX Equations 扫描 `$$...$$` 等定界符转换 — [Workspace Marketplace](https://workspace.google.com/marketplace/app/autolatex_equations/850293439076)
- MathLive `<math-field>`：提供「text-area like APIs (`value`, `selection`, `executeCommand()`)」、虚拟键盘、800+ LaTeX 命令、导入导出 LaTeX/MathML/ASCIIMath/Typst/MathJSON、屏幕阅读器 math-to-speech — [MathLive GitHub](https://github.com/arnog/mathlive)

#### (D) 整块/整单元格源码-渲染切换
- Logseq：用户长期抱怨「Typing raw latex…no realtime preview」，2020-12 至 2025-08 持续请求 Typora 式预览/MathLive，线程无官方回复 — [Logseq forum](https://discuss.logseq.com/t/better-math-experience/69)；已知问题：`\[ \]` 被渲染为行内（[#11292](https://github.com/logseq/logseq/issues/11292)）、行首行内公式被显示为块（[#4066](https://github.com/logseq/logseq/issues/4066)）
- Jupyter：Markdown 单元格中 MathJax 支持行内 `$...$` 与 `\begin{equation}` 显示公式 — [Jupyter Notebook docs](https://jupyter-notebook.readthedocs.io/en/stable/examples/Notebook/Working%20With%20Markdown%20Cells.html)；双击已渲染单元格进入原始源码编辑、Shift+Enter 渲染（搜索摘要）；JupyterLab 曾有「Math not rendering until after pressing Run twice」— [jupyterlab #3336](https://github.com/jupyterlab/jupyterlab/issues/3336)
- marimo：只含 `mo.md` 的单元格自动显示在 Markdown 编辑器，可在右上角切换 Markdown/Python 视图；LaTeX 建议用 raw string（勾选右下角 `r`），插值用 f-string（勾选 `f`）；`$`/`$$`/`\[ \]`；KaTeX — [marimo Markdown docs](https://docs.marimo.io/api/markdown/)

#### (E) 计算型行内建议
- Apple Notes Math Notes：表达式后键入 `=` 即求值，默认以 suggestion 显示、Return 插入；Format → Math Results 可选 Insert Results / Suggest Results / Off；`变量=值` 定义变量（须在使用处左侧或上方），变量改变时结果自动更新 — [Apple Support](https://support.apple.com/guide/notes/solve-math-apda85974595/mac)

#### 横向对比：键盘进出、跨文本选择、移动端
- 键盘进入：Notion、RemNote 方向键移到公式即自动打开编辑器（见上）；CM6 用 `EditorView.atomicRanges` 让光标跳过 widget — [CodeMirror Decoration Example](https://codemirror.net/examples/decoration/)；Latex Suite 用 Tab 跳出 — [README](https://raw.githubusercontent.com/artisticat1/obsidian-latex-suite/main/README.md)
- 键盘退出：Typora 用 Up/Down 或 Cmd/Ctrl+Return — [Typora Math](https://support.typora.io/Math/)；Plate Enter/Escape — [Plate](https://platejs.org/docs/equation)；Lexical Escape 后 `node.selectNext(0, 0)` 把光标放到公式后 — [EquationComponent.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationComponent.tsx)；MathLive 在光标越过边界时派发 `move-out`（`ev.detail.direction`，可 `preventDefault()`）— [MathLive: Interacting](https://mathlive.io/mathfield/guides/interacting/)
- 跨文本+公式拖选：Overleaf 在鼠标按住期间冻结装饰重算以免公式在拖选中来回切换 — [atomic-decorations.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/visual/atomic-decorations.ts)；ProseMirror inline atom + MathLive 的段首拖选失效问题见 Q3 — [#8547](https://discuss.prosemirror.net/t/inline-atomic-node-selection-issues-mathlive-integration-with-draggable-property-conflict/8547)
- 移动端：MathLive `mathVirtualKeyboardPolicy` 默认 `"auto"`（触屏设备聚焦即显示虚拟键盘），`"manual"` 配合 `mathVirtualKeyboard.show()/hide()`，`"sandboxed"` 用于 iframe；布局 `numeric`/`symbols`/`alphabetic`/`greek` 等可自定义 — [MathLive: Virtual keyboard](https://mathlive.io/mathfield/guides/virtual-keyboard/)；CM6 论坛有「Can't backspace on empty line with widget on Android in CM6」— [discuss.codemirror.net #3557](https://discuss.codemirror.net/t/cant-backspace-on-empty-line-with-widget-on-android-in-cm6/3557)（仅标题）

### Inferences
- A 类在 CM6 中实现成本最低（一个 StateField + selection 相交判断），代价是布局跳动与编辑时看不到渲染；Overleaf math preview / Latex Suite inline preview 的「光标上方 tooltip」是现成补偿方案，也可复用为 AI 修改的预览位。
- 用户目标（点击不塌缩、就地结构化或锚定弹层、可切源码）最贴近 B+C 组合：原子节点默认渲染，单击=选中节点（Lexical/Plate 模式），回车/双击/方向键进入=弹层或就地 MathLive，另有全局「源码模式」开关（Obsidian 的 "Toggle Live Preview/Source mode" 即先例）。
- RemNote「在公式里选中局部→Create Cloze」说明「公式内局部选择→对局部施加动作」在弹层模型下已被产品化，可作为「选中公式局部→标注→让 AI 改」的交互先例。
- 键盘可达性是弹层模型必须补的一环：Notion/RemNote 的「方向键移到公式即打开」和 MathLive `move-out` 事件组合起来即可实现双向无鼠标进出。
- A 类对移动端相对友好（只是纯文本编辑）；C 类依赖 MathLive 虚拟键盘，需要处理系统键盘与虚拟键盘的冲突（见 Gaps）。

### Gaps
- 未取得 Notion、RemNote、AFFiNE 在移动端的公式编辑一手描述；Obsidian MathLive 插件仅桌面端的原因未知。
- Anytype 行内公式的编辑 UI（弹层还是就地）未取得一手描述。
- Jupyter「双击进入编辑、Shift+Enter 渲染」只来自搜索摘要。
- Mathcha 的实现架构（DOM/canvas、是否开源）无公开资料；Mathcha 为闭源产品。

## Q2 「源码 + 装饰」编辑器与「结构化文档树」编辑器在嵌入公式 widget 上的架构差异

### Takeaway
CM6 路线：文档就是 LaTeX/Markdown 纯文本，公式只是 `Decoration.replace` + `WidgetType` 的视图层替换，用 `EditorView.atomicRanges` 让光标跳过；撤销、复制、协同（Y.Text）都天然字符级，但「在 widget 里做结构化编辑」与原子范围冲突，需要自理焦点。结构化路线：公式是 schema 里的 inline atom/void/decorator 节点（ProseMirror/Tiptap node view、Lexical `DecoratorNode`、Slate/Plate void、BlockSuite inline delta 属性），LaTeX 多存为属性（协同为整条 LWW），要自理节点两侧光标、拖选、嵌套编辑器的撤销与焦点；其回报是「点击不塌缩」「弹层/结构化编辑」天然成立。

### Cited Findings

#### 源码 + 装饰（CodeMirror 6）
- 「Decorations that significantly change the vertical layout…replacing line breaks or inserting block widgets, must be provided directly」（StateField），间接（ViewPlugin）装饰只在视口计算后读取；`EditorView.atomicRanges`「will make sure cursor motion skips the ranges」— [CodeMirror Decoration Example](https://codemirror.net/examples/decoration/)
- 「Only directly provided decoration sets may influence the vertical block structure of the editor, but only indirectly provided ones can read the editor's viewport」— [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- Overleaf：公式装饰在 `StateField`，同时提供给 `EditorView.decorations` 与 `EditorView.atomicRanges`；display math 为 `block: math.displayMode` 的块 widget；「never decorate inside math」；鼠标按住期间不重算装饰 — [overleaf atomic-decorations.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/visual/atomic-decorations.ts)
- Overleaf `MathWidget extends WidgetType`：`eq()` 比较 `math`/`displayMode`/`preamble`；`toDOM()` 建 `div`/`span`（`ol-cm-math`）后 `window.setTimeout` 异步渲染；`updateDOM()` 重渲染并 `view.requestMeasure()`；`ignoreEvent()` 对 mouseup 与 inline 公式的 mousedown 特殊处理；`estimatedHeight`；`coordsAt()`；`MathJax.tex2svgPromise()`；销毁后放弃渲染；错误加 `ol-cm-math-error` — [overleaf visual-widgets/math.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/visual/visual-widgets/math.ts)
- Marijn：`atomicRanges` 无法通知 widget「光标进来了」，应写 transaction filter 在 selection 落入区间时移动它并附带 effect 替换 widget（widget 无状态）；提问者发现 `atomicRanges` 先于其 filter 生效，倾向自实现 — [discuss.codemirror.net #6399](https://discuss.codemirror.net/t/detect-cursor-motion-into-atomicranges-widget/6399)

#### 结构化文档树
- ProseMirror 嵌套编辑器范式（footnote 示例）：`atom: true`；`selectNode()` 时 `open()` 创建内部 `EditorView`；`dispatchInner` 用 `StepMap.offset(this.getPos() + 1)` 把内部 step 映射到外部文档；内部 keymap 把 `Mod-z`/`Mod-y` 转给外部 `undo`/`redo`（统一撤销栈）；以 `fromOutside` meta 防回环；`update()` 用 `findDiffStart` 只替换变化部分以吸收远端修改；`stopEvent()` 对内部视图内事件返回 true；`ignoreMutation()` — [ProseMirror footnote example](https://prosemirror.net/examples/footnote/)
- prosemirror-math：`math_inline`/`math_display` 是「含文本内容」的原子节点（源码是节点 text content），`math-nodeview.ts` 负责渲染/编辑切换，`mathBackspaceCmd` 处理边界退格，`mathSerializer` 挂 `clipboardTextSerializer` — [prosemirror-math README](https://raw.githubusercontent.com/benrbray/prosemirror-math/master/README.md)
- Tiptap：`inlineMath`/`blockMath` 节点 + 命令 `insertInlineMath({ latex, pos })`、`updateInlineMath`、`deleteInlineMath`、`insertBlockMath`…；`katexOptions`；CSS `.tiptap-mathematics-render--editable`、`[data-type="inline-math"]` — [Tiptap Mathematics docs](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- Lexical `EquationNode extends DecoratorNode<JSX.Element>`：`__equation`、`__inline`；`createDOM()` 建 `span`/`div`（`role="math"` + aria-label）；`getTextContent()` 返回 LaTeX；`updateDOM()` 仅 inline 变化时返回 true；`decorate()` 渲染 `EquationComponent` — [Lexical EquationNode.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationNode.tsx)
- Slate：所有 Element（含 void）必须至少含一个 Text 后代，以保证 selection 的 anchor/focus 总能落点；inline 节点不能是块的首/尾子节点、也不能与另一 inline 相邻，Slate 规范化时自动插入 `{ text: '' }` 间隔 — [Slate: Normalizing](https://docs.slatejs.org/concepts/11-normalizing)；[Slate: Nodes](https://docs.slatejs.org/concepts/02-nodes)（搜索摘要）
- Plate：`inline_equation` 为 inline void，LaTeX 存 `texExpression` — [Plate Equation docs](https://platejs.org/docs/equation)
- BlockSuite/AFFiNE：行内公式不是独立节点而是 inline delta 上的属性 `latex`，编辑提交时 `this.editor.formatText({ index, length }, { latex })` — [latex-node.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-node.ts)

#### 光标与选择
- Lexical：两个 DecoratorNode 相邻时因 `contenteditable="false"` 浏览器不画光标（可输入但不可见），报告者建议学 Slate 插空文本节点 — [lexical #2285](https://github.com/facebook/lexical/issues/2285)；另有「Caret has wrong visual position…between decorator nodes」[#3156](https://github.com/facebook/lexical/issues/3156)、「Impossible to set cursor between decorator nodes using mouse」[#3157](https://github.com/facebook/lexical/issues/3157)、「Line deletion at a soft wrap also removes an inline decorator from the neighbouring visual line」[#9234](https://github.com/facebook/lexical/issues/9234)（后三者仅标题）
- Lexical v0.46.0（约 2026-06）：修复「Caret stuck when block has no leading or trailing text」(#8604)；新增 `setDOMUnmanaged(dom, {captureSelection: true})` 可把任意 DOM 子树标为 selection-captured (#8588)；「Ignore `beforeinput`/`input` in captured decorators (Firefox 152)」(#8740)；编辑器可挂在 open shadow tree 内而不丢 selection/focus/IME (#8694)；远端光标改用 CSS Custom Highlight API (#8550) — [newreleases: lexical v0.46.0](https://newreleases.io/project/github/facebook/lexical/release/v0.46.0)
- ProseMirror 依赖浏览器原生光标移动，Marijn 认为 `contenteditable=false` 可能有助于公式节点的光标定位 — [discuss.prosemirror.net #2906](https://discuss.prosemirror.net/t/replicating-typoras-inline-display-math-editing/2906)

#### 撤销/重做
- ProseMirror 嵌套编辑器把撤销委托给外部编辑器，保证单一撤销栈 — [footnote example](https://prosemirror.net/examples/footnote/)
- Lexical 公式在退出编辑时一次性 `node.setEquation(equationValue)`（编辑中间态不写入文档）— [EquationComponent.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationComponent.tsx)
- y-codemirror.next 提供 `Y.UndoManager`，每个客户端各自的撤销历史，避免撤销别人的修改 — [y-codemirror.next README](https://raw.githubusercontent.com/yjs/y-codemirror.next/main/README.md)

#### 复制/粘贴
- Notion 复制行内公式得到源码 — [Notion Help](https://www.notion.com/help/math-equations)；prosemirror-math 纯文本复制输出 `$...$`/`$$...$$` — [README](https://raw.githubusercontent.com/benrbray/prosemirror-math/master/README.md)；Lexical `getTextContent()` 返回 LaTeX — [EquationNode.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationNode.tsx)；Lexical 有「Equation copy and paste behaviour in edit mode is incorrect」— [lexical #4086](https://github.com/facebook/lexical/issues/4086)（仅标题）

#### IME
- CM6：光标紧邻 widget 时 IME 组字会触发 `cm-widgetBuffer` 重建、打断组字（Safari 26.5 / macOS 15.7.7）；Marijn 于 2026-07-02 确认「two misbehaviors」并提交修复（tile 复用顺序；`resolveInline` 相对 collapsing decoration 的光标定位）— [discuss.codemirror.net #9799](https://discuss.codemirror.net/t/ime-input-may-break-when-cursor-is-adjacent-to-widget-due-to-cm-widgetbuffer-reconstruction/9799)；同类报告：「Composition issues in Firefox on Mac with widgets」[#5988](https://discuss.codemirror.net/t/composition-issues-in-firefox-on-mac-with-widgets/5988)、「IME Selection Is Not Updated When decoration.mark Contains Multiple decoration.replace Decorations」[#9785](https://discuss.codemirror.net/t/bug-ime-selection-is-not-updated-when-decoration-mark-contains-multiple-decoration-replace-decorations/9785)（仅标题）
- Lexical v0.46.0 修复 Safari IME（#8598）、Firefox composition end（#8680）、组字中删除（#8701）、韩文 IME 自动补全（#8574）— [newreleases](https://newreleases.io/project/github/facebook/lexical/release/v0.46.0)
- Mathcha：非英语输入法下快捷键可能失效 — [Mathcha Docs](https://www.mathcha.io/documentation/shortcuts/)

#### 协同（Yjs）
- Y.XmlElement 属性的变更格式「equivalent to the Y.MapEvent change format」，即按 key 的 last-writer-wins；子节点变更用 Quill delta 风格 — [Yjs docs: Y.XmlElement](https://docs.yjs.dev/api/shared-types/y.xmlelement)
- y-prosemirror 让 ProseMirror state 与 Y.XmlFragment 双向同步（ySyncPlugin/ProsemirrorBinding）— [y-prosemirror](https://github.com/yjs/y-prosemirror)（搜索摘要）；已知问题：属性不进快照（[Yjs community](https://discuss.yjs.dev/t/snapshotting-prosemirror-nodes-with-attributes/732)）、无文本内容时属性更新失效（[y-prosemirror #30](https://github.com/yjs/y-prosemirror/issues/30)）（仅标题）
- y-codemirror.next 以 `yCollab` 把 Y.Text 绑定到 CM6，含远端光标/选区（awareness），MIT — [README](https://raw.githubusercontent.com/yjs/y-codemirror.next/main/README.md)
- AFFiNE 公式弹层的编辑面直接绑定 `yText`，`yTextObserver` 驱动 `latexSignal`，再 `formatText(..., { latex })` 写回宿主 inline delta — [latex-editor-menu.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-editor-menu.ts)；[latex-node.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-node.ts)

#### 开源构件许可与维护状态（已核实部分）
- MathLive：MIT，2.2k stars，半年一次大版本（约 6 月、1 月）+ 补丁版 — [GitHub](https://github.com/arnog/mathlive)
- Tiptap Mathematics：2025-06 随 10 个 Pro 扩展一起以 MIT 开源 — [Tiptap blog](https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap)；[HN](https://news.ycombinator.com/item?id=44202103)
- Tiptap Tracked Changes 为单独售卖产品；AI Toolkit 许可未写明 — [Tiptap AI Toolkit](https://tiptap.dev/docs/ai/ai-toolkit/client/agents/review-changes)
- BlockNote AI（`@blocknote/xl-ai`）：「fully open source, but released under a copyleft license」，商用需 Business 订阅 — [BlockNote AI](https://www.blocknotejs.org/docs/features/ai)
- `@codemirror/merge`：MIT — [README](https://raw.githubusercontent.com/codemirror/merge/main/README.md)；y-codemirror.next：MIT — [README](https://raw.githubusercontent.com/yjs/y-codemirror.next/main/README.md)；org-fragtog：MIT — [GitHub](https://github.com/io12/org-fragtog)；MathJax4-for-Obsidian：MIT（MathJax 本身 Apache-2.0）— [GitHub](https://github.com/TheTenth-THU/MathJax4-for-Obsidian)
- prosemirror-math：MIT，302 stars，25 个 open issues，README 仍欢迎贡献（未见最近发版日期）— [GitHub](https://github.com/benrbray/prosemirror-math)
- obsidian-latex-suite：MIT，约 2.5k stars，1,024 commits — [GitHub](https://github.com/artisticat1/obsidian-latex-suite)
- Lexical：MIT（©2026 Meta），23.9k stars，仍为 0.x 版本号（v0.46.0）— [GitHub](https://github.com/facebook/lexical)
- Milkdown：MIT，11.9k stars，「plugin-driven WYSIWYG markdown Editor, inspired by Typora, built on top of prosemirror and remark」— [GitHub](https://github.com/Milkdown/milkdown)
- BlockSuite：MPL 2.0（弱 copyleft，修改其文件需开源这些文件），约 6k stars，自称「currently in its early stage」，基于 web components 而非 React — [GitHub](https://github.com/toeverything/blocksuite)
- Plate：MIT（monorepo，含 AI 包），16.6k stars — [GitHub](https://github.com/udecode/plate)
- KaTeX：MIT，20.4k stars，模板中引用 0.18.9 — [GitHub](https://github.com/KaTeX/KaTeX)；MathJax：Apache-2.0，当前主版本 4.x（`mathjax@4`），内置屏幕阅读器支持与 speech 生成 — [GitHub](https://github.com/mathjax/MathJax)
- 活跃度信号：ProseMirror 维护者 2025-09 仍在论坛答疑（[#8547](https://discuss.prosemirror.net/t/inline-atomic-node-selection-issues-mathlive-integration-with-draggable-property-conflict/8547)）；CM6 维护者 2026-07 修复 IME 问题（[#9799](https://discuss.codemirror.net/t/ime-input-may-break-when-cursor-is-adjacent-to-widget-due-to-cm-widgetbuffer-reconstruction/9799)）；Lexical v0.46.0 约 2026-06 发布（[newreleases](https://newreleases.io/project/github/facebook/lexical/release/v0.46.0)）

### Inferences
- 两条路线的本质差异是「真相源」：CM6 以文本为真相、渲染是投影，所以复制/撤销/协同/Markdown 往返几乎零成本，但结构化编辑必须在「投影」里再开一个编辑器；树路线以节点为真相，结构化编辑与「点击不塌缩」天然，但序列化、协同粒度、节点两侧光标都要自理。
- 协同粒度：LaTeX 存属性（Tiptap `latex`、Plate `texExpression`、Lexical `__equation`、BlockSuite `latex`）→ Yjs 下整条公式 LWW，两人同时改同一公式会丢一方；存为节点文本（prosemirror-math）或纯文本（CM6 + Y.Text）→ 字符级合并。对个人学习系统，LWW 一般可接受。
- 光标落点问题是树路线的共性：Slate 用空文本节点、ProseMirror 建议无 `src` 的 `<img>`、Lexical 报告者也建议插空文本——设计组件时应在公式节点两侧预留「可落光标的非内容位置」。
- 粗略构建成本（本人估算，非来源数据）：
  - 路线 1「CM6 + Overleaf 式 widget + 弹层 MathLive」：MVP 约 2–4 人周；难点在 widget 焦点交接、IME 邻接 widget、布局跳动；协同（y-codemirror.next）与源码模式几乎免费。
  - 路线 2「ProseMirror/Tiptap inline atom + node view 内嵌 MathLive（就地结构化）」：MVP 约 3–6 人周；难点在拖选/光标（#8547）、嵌套撤销、Markdown 往返（remark-math）；Tiptap Mathematics（MIT）可作起点。
  - 路线 3「Lexical DecoratorNode」：与路线 2 相当，React 倾向更强；v0.46 的 `captureSelection` 可能降低嵌入 MathLive 的难度。
  - 路线 4「直接用 BlockSuite 或 Milkdown Crepe 的现成公式」：最快，但交互被框架定型（弹层源码编辑，无结构化）。
- 「框架无关 Web Component」：CM6、ProseMirror、Tiptap core 为纯 JS，MathLive 本身是 custom element（`<math-field>`），BlockSuite 用 Lit web components（`createLitPortal`）；Plate/Slate 绑定 React，不适合框架无关目标。

### Gaps
- 上列项目许可证已从 GitHub 仓库页核实，但多数仓库页未显示最近发版日期（prosemirror-math、Milkdown、Plate、BlockSuite 的最近发版日期未取得）；ProseMirror、CodeMirror 6 核心包、Tiptap core 的许可证本轮未单独抓取（Tiptap Mathematics 的 MIT 已核实）。
- MathLive 内部撤销栈与宿主编辑器撤销栈如何协调，未找到官方指南。
- CM6 history 的 `isolateHistory`/`addToHistory` 等 API 原文未能从参考手册抓取（页面过长被截断）。

## Q3 在这些框架中嵌入可交互公式输入框（如 MathLive）的已知问题与修复

### Takeaway
三大框架都遇到同一个根问题：可交互控件（MathLive、textarea、嵌套编辑器）要吃掉鼠标/键盘/选择事件，而宿主编辑器也要这些事件来做选择、拖拽和光标移动。已知修复：ProseMirror 用 node view 的 `stopEvent`/`ignoreMutation` + 在节点两侧放无 `src` 的 `<img>` 作「buffer zone」；CM6 用 `ignoreEvent`、在 widget 内部子元素上放 `contenteditable=true`、并用 transaction filter 自理「光标进入」；Lexical 用命令监听（`SELECTION_CHANGE_COMMAND`、`KEY_ESCAPE_COMMAND`）与 `getActiveElement` 管焦点，v0.46 起还可用 `setDOMUnmanaged(..., {captureSelection: true})`。

### Cited Findings
- ProseMirror + MathLive（2025-09-03，ConsecrateHQ）：spec `{group:"inline", inline:true, atom:true, selectable:true, draggable:true}`；无 `draggable` 时选择不可靠、段首节点从左往右拖选完全失效；有 `draggable: true` 时选择可靠但 MathLive 无法在点击处放置内部光标；Arc 与 Zen 表现一致 — [discuss.prosemirror.net #8547](https://discuss.prosemirror.net/t/inline-atomic-node-selection-issues-mathlive-integration-with-draggable-property-conflict/8547)
- 同帖 Marijn（2025-09-04）：点击应激活节点并让其内部获得焦点，而从边界拖动应在外层创建选择，二者根本冲突；建议「create a 'buffer zone' around the node's core DOM structure. `<img>` tags without an `src` attribute can be a useful way to create something that counts as a text position but isn't actually text」；失败尝试：手动扩展拖选的 selection 插件、改写 `mousedown`/`ondrag`、零宽空格 CSS、把光标放 index 1；提问者当天确认有效但未贴最终代码 — 同上
- ProseMirror 嵌套编辑器事件隔离：`stopEvent()` 返回 `this.innerView && this.innerView.dom.contains(event.target)`；`ignoreMutation()` 忽略内部 DOM 变动 — [footnote example](https://prosemirror.net/examples/footnote/)
- ProseMirror「进入方向」问题：无 `contentDOM` 的嵌套编辑器方案中内部光标总落在开头；Desmos 的做法是在每次 `dispatchTransaction` 时对所有注册的公式 NodeView 调 `updateCursorPos(state)` 判断从左还是从右进入，再 `moveToLeftEnd()`/`moveToRightEnd()`，并用 `TextSelection.create()` 设置内部选择；Marijn 建议改用插件维护「cursor is in this math node」的 node decoration — [discuss.prosemirror.net #2906](https://discuss.prosemirror.net/t/replicating-typoras-inline-display-math-editing/2906)
- CM6 widget 焦点：CM 会给 widget 设 `contenteditable=false`；Marijn：「You should be able to introduce new `contenteditable=true` child elements inside of them」，并配合 `ignoreEvent`；提问者最终发现把 contenteditable 放到子元素而非 widget 根上即可正常聚焦，普通 `<input>` 本就可用 — [discuss.codemirror.net #5178](https://discuss.codemirror.net/t/focusing-inputs-within-widgets/5178)
- CM6：可点击 widget 在编辑器有焦点时需点两次（第一次编辑器失焦）— [discuss.codemirror.net #7433](https://discuss.codemirror.net/t/link-widget-is-clicked-only-if-editor-is-out-of-focus/7433)；contenteditable widget 的 `focusin` target 可能是整个编辑器容器 — [#6792](https://discuss.codemirror.net/t/how-to-get-focusin-events-on-a-custom-widget-decoration/6792)（搜索摘要）
- CM6：`atomicRanges` 不能回调 widget，需 transaction filter（且 `atomicRanges` 先于 filter 移动光标）— [#6399](https://discuss.codemirror.net/t/detect-cursor-motion-into-atomicranges-widget/6399)；Obsidian「MathLive in Editor Mode」的 inline 焦点保持仍是实验性、依赖编辑器内部行为 — [Obsidian Stats](https://www.obsidianstats.com/plugins/mathlive-in-editor-mode)
- CM6 解析层问题：Obsidian 输入中的 `$ x$` 暂时不被识别为数学而闪烁，插件以隐藏的 `{}` 占位修复 — [obsidian-inline-math README](https://raw.githubusercontent.com/RyotaUshio/obsidian-inline-math/master/README.md)
- Lexical：`SELECTION_CHANGE_COMMAND` 中焦点离开输入框即 `onHide()`；`KEY_ESCAPE_COMMAND` 中用 `getActiveElement(inputElem)`（注释：shadow root 中 `document.activeElement` 返回 shadow host）；`onHide()` 在 `editor.update()` 里 `node.setEquation(equationValue)`，可选 `node.selectNext(0, 0)`；`LexicalErrorBoundary` 包裹 `KatexRenderer` — [EquationComponent.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationComponent.tsx)
- Lexical v0.46.0：`setDOMUnmanaged(dom, {captureSelection: true})`（#8588）、captured decorators 中忽略 `beforeinput`/`input`（#8740）、shadow tree 支持（#8694）— [newreleases](https://newreleases.io/project/github/facebook/lexical/release/v0.46.0)
- MathLive 嵌入用 API：`value`；`getValue(format)`（`"latex"`、`"latex-expanded"`、`"math-json"`、`"ascii-math"`、`"spoken-text"`、`"mathML"`）；`setValue(latex, {silenceNotifications: true})` 防事件回环；`getValue(range, 'latex')` 取选区片段；`executeCommand()`；事件 `input`（含 `inputType`）、`change`（Enter 或失焦）、`selection-change`、`move-out`/`focus-out`（`ev.detail.direction`，可 `preventDefault()`）；`applyStyle(style, {range})` — [MathLive: Interacting](https://mathlive.io/mathfield/guides/interacting/)

### Inferences
- 推荐的 ProseMirror 嵌入配方（综合 #8547/#2906/footnote 示例）：inline atom 节点，node view DOM = `[img(无src)] [math-field] [img(无src)]`；`stopEvent` 放行 math-field 内部事件；`ignoreMutation` 返回 true；MathLive `input` 事件不直接逐字写回，而在 `change`/失焦时一次 `setNodeMarkup` 提交（对齐 Lexical 的「退出时提交」，保证一次撤销）；监听 `move-out` 按方向把外层光标放到节点前/后。
- CM6 嵌入配方：widget 根保持 `contenteditable=false`，MathLive 作为子元素；`ignoreEvent()` 对 math-field 内事件返回 true；由 keymap/transaction filter 在「方向键撞上 widget」时把焦点交给 math-field（而不是依赖 `atomicRanges` 跳过）；提交时一次 `dispatch({changes})` 改写底层 LaTeX 文本。
- 对 IME：中文用户在公式旁输入是高频场景，CM6（#9799，2026-07 才修）与 Lexical（v0.46 多个 IME 修复）都在近期修过邻接装饰的组字问题，应锁定较新版本并做中文 IME 回归测试。

### Gaps
- #8547 最终可用代码未公开；buffer `<img>` 是放在 node view DOM 内还是作为 widget decoration，Marijn 未具体说明。
- 未找到 MathLive 官方「嵌入 ProseMirror/CM6/Lexical」指南，也未找到 MathLive 与宿主撤销栈协调的资料。

## Q4 序列化：Markdown/HTML/自定义节点，如何无损往返

### Takeaway
几乎所有产品把原始 LaTeX 字符串当作唯一真相，渲染结果只作缓存/展示：Markdown 边界用 `$`/`$$`（以 remark-math/micromark 为事实标准），HTML 边界用带 data 属性或 class 的元素（Lexical base64 属性、micromark `math-inline`/`math-display`），剪贴板纯文本输出带定界符的 LaTeX。主要往返风险来自各家 `$` 规则不一致（空格、货币符号、`\[ \]`、```` ```math ````）。

### Cited Findings
- micromark-extension-math：`singleDollarTextMath` 默认 `true`（「Single dollars work in Pandoc…but often interfere with 'normal' dollars in text」）；行内闭合 `$` 数量必须等于开启数量；块公式用 ≥2 个 `$` 的 fence，闭合 fence 数量须 ≥ 开启数量；HTML 输出 `<span class="math math-inline">` / `<div class="math math-display">`（KaTeX）；与 GitHub 的实现不兼容 — [micromark-extension-math readme](https://raw.githubusercontent.com/micromark/micromark-extension-math/main/readme.md)
- Pandoc `tex_math_dollars`：开 `$` 右侧须紧跟非空白、闭 `$` 左侧须紧跟非空白且其后不能紧跟数字（故 `$20,000 and $30,000` 不是数学），字面 `$` 用反斜杠转义 — [Pandoc manual 8.13 Math](https://pandoc.org/demo/example33/8.13-math.html)（搜索摘要）
- GitHub：行内 `$...$` 或 `` $`...`$ ``（后者用于与 Markdown 语法冲突的表达式）；块用 `$$` 或 ```` ```math ````；公式内 `\$`、公式外用 `<span>$</span>` 转义；MathJax — [GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions)
- Obsidian 的 `$$` 在 GitHub 渲染不佳，而 ```` ```math ```` 在 GitHub 正常、在 Obsidian Live Preview 不预览 — [Obsidian Forum #66555](https://forum.obsidian.md/t/math-block-live-preview/66555)
- Typora 非兼容模式：开头 `$` 后与结尾 `$` 前不能有空格/制表符，另有兼容旧文档的 legacy 模式；「Not all export formats support math」— [Typora Math](https://support.typora.io/Math/)
- RemNote 粘贴：`$...$`→inline（要求定界符外侧各有空格）、`$$...$$` 与 `\[ \]`→block — [RemNote Help](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- Plate：`@platejs/markdown` + `remark-math`，`$...$`↔`inline_equation`、块数学↔`equation`，序列化从 `texExpression` 写回；输入规则 `MathRules.markdown()` 在代码块与公式内禁用 — [Plate Equation docs](https://platejs.org/docs/equation)
- Milkdown Crepe：`remarkMathPlugin`/`remarkMathBlockPlugin`，块公式即 `latex` 代码块 — [crepe latex](https://raw.githubusercontent.com/Milkdown/milkdown/main/packages/crepe/src/feature/latex/index.ts)
- Lexical：`exportDOM()` 用 `encodeEquation()`（UTF-8 安全 base64，规避 `btoa/atob` 非拉丁字符限制）写 `data-lexical-equation`，`data-lexical-inline` 存模式，并输出 KaTeX 渲染；`importDOM` 解码 — [EquationNode.tsx](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-playground/src/nodes/EquationNode.tsx)；已知问题「Block math equation is falsely converted to inline equation on MarkdownShortcutPlugin」— [lexical #6936](https://github.com/facebook/lexical/issues/6936)（仅标题）
- BlockSuite：LaTeX 为 inline delta 属性 `latex`；包内有 `markdown.ts` 与 `adapters/` 目录负责格式转换 — [latex-node.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-node.ts)；[目录](https://github.com/toeverything/AFFiNE/tree/canary/blocksuite/affine/inlines/latex/src)
- prosemirror-math `mathSerializer`（`clipboardTextSerializer`）输出 `$...$`/`$$...$$`；Notion 复制行内公式得到源码 — [prosemirror-math](https://raw.githubusercontent.com/benrbray/prosemirror-math/master/README.md)；[Notion Help](https://www.notion.com/help/math-equations)
- Tiptap `migrateMathStrings(editor, regex)`/`createMathMigrateTransaction`/`mathMigrationRegex`：把旧文档里 `$` 包裹字符串批量迁移成节点 — [Tiptap Mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- Anytype 社区要求支持 `$E = mc^2$` 与 `$$` 以兼容导出 Markdown，此前从 Notion 导入的行内 LaTeX 会被移除 — [Anytype Community](https://community.anytype.io/t/inline-latex-addition/2315)（搜索摘要）
- MathML 路线：KaTeX `output` 可选 `html`/`mathml`/`htmlAndMathml`（默认，后者附带 MathML 供无障碍）— [KaTeX options](https://katex.org/docs/options)；Temml 是去掉 HTML 输出、只产 MathML Core 的 KaTeX 分支，覆盖度称与 MathJax 相当，最小安装字体约 10kb，Chromium 用系统字体有渲染 bug、推荐 Latin Modern（380KB）— [Temml GitHub](https://github.com/ronkok/Temml)（搜索摘要）
- MathLive 可导出 LaTeX/MathML/ASCIIMath/Typst/MathJSON — [MathLive GitHub](https://github.com/arnog/mathlive)
- Word 的 linear format 支持 UnicodeMath 与 LaTeX，但 LaTeX 子集有限（无 `\begin{}`/`\end{}`）— [MS Support](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)

### Inferences
- 建议组件内部以「LaTeX 字符串 + inline/display 标志」为节点唯一数据；Markdown 进出统一走 remark-math/micromark（parse 与 serialize 同一套规则可保证幂等往返），不要自写正则。
- 若需兼容 Pandoc 与 Obsidian，序列化时应避免产生会被 Pandoc 规则拒绝的形式（`$ x$`、`$x$5`），必要时把行内公式输出为 `$...$` 并对正文中货币 `$` 统一转义。
- HTML/剪贴板：沿用 KaTeX `htmlAndMathml`（或 Temml 纯 MathML）+ data 属性保存原始 LaTeX（学 Lexical，用 UTF-8 安全编码），粘贴时优先读 data 属性，其次读 MathML 中的 TeX annotation（待核实），最后才用纯文本 `$` 正则。
- MathLive 的 `latex-expanded`/`math-json` 等格式可能与用户手写 LaTeX 不同（宏展开、规范化），往返时应保存用户原文，而不是每次从 MathLive 反向导出（待验证 MathLive 是否保持原始写法）。

### Gaps
- mdast-util-math 的节点类型（`inlineMath`/`math`）与 to-markdown 行为未在本轮抓取原文。
- KaTeX MathML 输出中是否包含 `<annotation encoding="application/x-tex">` 未在本轮核实。
- Notion 的 Markdown 导出格式、Word 内部 OMML 与 LaTeX 互转的保真度未取得一手资料。

## Q5 「选中文本转公式」命令及其实现

### Takeaway
明确支持「选中文本→公式」的有 Notion（`Cmd/Ctrl+Shift+E` 或格式菜单 `√x`）、Plate（`insertInlineEquation` 默认取选中字符串）、Milkdown Crepe（`toggleLatexCommand` 双向切换）、Obsidian MathLive 插件（选区作初始内容）；实现几乎都是一个事务：「用 math 节点（LaTeX = 选中文本）替换选区」，反向则「删节点 + 插入其 LaTeX 文本」。

### Cited Findings
- Notion：选中段落中的文本后点 `√x` 或按 `ctrl/cmd + shift + E` 转为行内公式 — [Notion Help](https://www.notion.com/help/math-equations)
- Plate：`insertInlineEquation(editor, texExpression?, options?)`「Defaults to the selected string when no expression is passed」；`insertEquation(editor, options)` 插空白块公式 — [Plate Equation docs](https://platejs.org/docs/equation)
- Milkdown Crepe `toggleLatexCommand`：选区不是公式时 `replaceSelectionWith(mathInlineSchema.type(ctx).create({ value: text }))`；选中的是公式节点时删除节点并 `insertText(content, latexPos)` 还原为文本；找不到节点返回 `false` — [crepe latex command.ts](https://raw.githubusercontent.com/Milkdown/milkdown/main/packages/crepe/src/feature/latex/command.ts)
- Tiptap：`insertInlineMath({ latex, pos })` 等命令 `pos` 省略时作用于当前 selection；批量用 `migrateMathStrings` — [Tiptap Mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- Lexical：`$createEquationNode(equation, isInline)` 创建节点，playground 通过 Insert → Equation 对话框插入，MarkdownShortcutPlugin 中也用它 — [lexical #6936](https://github.com/facebook/lexical/issues/6936)；[Discussion #3331](https://github.com/facebook/lexical/discussions/3331)（搜索摘要）
- Obsidian MathLive 插件：先选中文本则以选区为 MathLive 初始内容 — [插件页](https://community.obsidian.md/plugins/mathlive)（搜索摘要）
- Obsidian Latex Suite「visual snippets」：选中数学内容后键入单字符包裹（`U`→`\underbrace`、`O`→`\overbrace`、`C`→`\cancel`、`K`→`\cancelto`、`B`→`\underset`）；命令 "Box current equation"（`\boxed{}`）、"Select current equation"；snippet 选项 `v` 表示基于选区 — [Latex Suite README](https://raw.githubusercontent.com/artisticat1/obsidian-latex-suite/main/README.md)
- RemNote：在公式内选中局部 →「Create Cloze」— [RemNote Help](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- BlockSuite 行内公式包内有 `command.ts`（内容未抓取）；提交时 `formatText({ index, length }, { latex })`——即在文本区间上加 `latex` 属性，天然支持「把选中区间变成公式」— [latex-node.ts](https://raw.githubusercontent.com/toeverything/AFFiNE/canary/blocksuite/affine/inlines/latex/src/latex-node/latex-node.ts)

### Inferences
- ProseMirror/Tiptap 实现：`const text = state.doc.textBetween(from, to); tr.replaceSelectionWith(schema.nodes.inlineMath.create({ latex: text }))`，然后把选区设为 `NodeSelection` 并立即打开弹层（让用户修正把普通文本当 LaTeX 的错误，如 `x^2` 正确、`α` 需转 `\alpha`）。
- CM6 源码路线实现：`view.dispatch({ changes: { from, to, insert: '$' + text + '$' } })`；源码模式下即完成，渲染由装饰自动接管。
- 「转换」还可以接 AI：RemNote 已把「自然语言→LaTeX」做成 Tab 接受的建议，因此「选中『x 的平方加一』→转公式」可先跑 AI 规范化再生成节点。
- 反向命令（公式→文本）也值得提供（Milkdown 先例），便于纠错与粘贴到纯文本环境。

### Gaps
- Word 是否支持「选中已有文本按 `Alt+=` 转公式」未在官方页面找到描述。
- Lexical playground 的 `INSERT_EQUATION_COMMAND` 是否使用当前选中文本未能抓取源码核实（原始文件路径 404）。
- BlockSuite `command.ts` 中是否有「选区转公式」命令未核实。

## Q6 AI 辅助编辑选区：选区捕获、预览、接受/拒绝、撤销

### Takeaway
三种主流 UX：(1) 选区旁建议卡片 + Replace / Insert below / Regenerate（Copilot in Word、Notion AI）；(2) 就地 inline diff（红删绿增）+ Accept/Reject（含逐 hunk）（Cursor Cmd+K、Tiptap AI Toolkit、BlockNote、Plate chat 模式、CM6 `@codemirror/merge`）；(3) ghost 建议 + 单键接受（Apple Math Notes 的 Return、RemNote 的 Tab）。实现要点：选区序列化（Plate 用 Markdown 占位替换）发给模型；建议以「仅本地可见的装饰」或「临时 suggestion 节点/marks」呈现；接受时把所有流式操作合并成一个 undo 批次（Plate `withAIBatch`）。

### Cited Findings
- Notion AI：选中文本 → `Edit with AI` → 指令（fix grammar、make it shorter、change the tone）→ accept、discard 或 try again — [Notion Help: Notion AI for docs](https://www.notion.com/help/guides/notion-ai-for-docs)
- Copilot in Word：选中文本 → 左侧页边 Copilot 图标 → Auto Rewrite；同时生成多个版本，用箭头切换；Replace / Insert below / Regenerate；可「begin typing directly within the suggestion box」在接受前修改 — [MS Support: Rewrite with Copilot](https://support.microsoft.com/en-us/word/copilot/rewrite-text-with-copilot-in-word)
- Cursor inline edit：选中 → `Cmd/Ctrl+K` → 描述 → Return；可继续输入 follow-up 再 Return 迭代；`Opt/Alt+Return` 切提问模式，回答后输入 "do it" 应用 — [Cursor Docs](https://cursor.com/docs/inline-edit/overview)；第三方教程：修改作为待定提案呈现，删除行红、新增行绿，头部 Reject 与 Accept（⌘+↵），每个 hunk 有 Undo/Keep — [learncursor.dev](https://www.learncursor.dev/learn/cursor-basics/cursor-inline-edit)
- Overleaf AI：AI Assistant 左侧栏侧面板；Error Assist 在编译错误日志中；Writefull 语言建议「shown inline as you write」；改写/同义词经 robot/TeXGPT 图标或「floating AI sparkle menu that appears when you select text」，可用动作随选区长度过滤；Equation Generator 在 Insert 菜单或未选中内容时的 TeXGPT 按钮，可从图片或文字生成 LaTeX — [Overleaf docs: AI features](https://docs.overleaf.com/integrations-and-add-ons/ai-features)；2025-06 推出 — [Digital Science](https://www.digital-science.com/blog/2025/06/digital-science-launches-new-cutting-edge-ai-writing-tools-for-20-million-overleaf-users/)
- Plate AI：`AIPlugin` 给流式文本加 `ai` mark；`AIChatPlugin` 管菜单/状态/transforms；`replacePlaceholders` 把 `{editor}`、`{blockSelection}`、`{prompt}` 替换成序列化 Markdown；`streamInsertChunk` 反序列化 Markdown 块并就地更新/追加；`mode: 'chat'` 时 `applyAISuggestions` 把 AI 输出与保存的 `chatNodes` diff 并写入临时 suggestion 节点（`AILeaf`）；`tf.aiChat.accept()`、`rejectAISuggestions`、`tf.ai.discardPreview()`；`withAIBatch`「groups editor operations into a single history batch and flags it as AI-generated so `tf.ai.undo()` removes it safely」— [Plate AI docs](https://platejs.org/docs/ai)
- Tiptap AI Toolkit：suggestions 是「decoration-based UI that's ephemeral and only visible to the current user」；preview 模式（修改前提议）与 review 模式（先应用、可凭 suggestion 撤回）；`toolkit.executeTool()`（`reviewOptions`）、`acceptSuggestion()`/`rejectSuggestion()`/`acceptAllSuggestions()`/`rejectAllSuggestions()`；持久且协同可见的 Tracked Changes 另售 — [Tiptap AI Toolkit](https://tiptap.dev/docs/ai/ai-toolkit/client/agents/review-changes)；旧 AI Suggestion（`provider.acceptToolCall()`/`rejectToolCall()`）与 AI Changes（`acceptAiChange`/`rejectAiChange`/…，拒绝时把该范围恢复为旧文档内容）已 deprecated — [Tiptap AI Changes](https://tiptap.dev/docs/ai/deprecated/changes/overview)
- BlockNote AI：流式 + 一键 accept/reject；`@blocknote/xl-ai` copyleft — [BlockNote AI](https://www.blocknotejs.org/docs/features/ai)；`@blocknote/prosemirror-suggest-changes`（v0.1.3）为 ProseMirror schema 加 suggestion marks — [npm](https://www.npmjs.com/package/@blocknote/prosemirror-suggest-changes)；另有 Google Docs 式建议模式插件 — [prosemirror-suggestion-mode](https://github.com/davefowler/prosemirror-suggestion-mode)
- CM6 diff 构件 `@codemirror/merge`：`MergeView`（并排）与 `unifiedMergeView`（单编辑器内联），选项 `original`、`mergeControls`、`highlightChanges`、`gutter`、`collapseUnchanged`，块级 `acceptChunk`/`rejectChunk`/`getChunks`/`updateOriginalDoc`，MIT — [@codemirror/merge README](https://raw.githubusercontent.com/codemirror/merge/main/README.md)
- RemNote：公式弹层中自然语言→LaTeX 建议，点 Accept 或按 Tab 接受 — [RemNote Help](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- Apple Math Notes：结果以 suggestion 显示，Return 接受；可改为自动插入或关闭 — [Apple Support](https://support.apple.com/guide/notes/solve-math-apda85974595/mac)
- 公式局部选择的可取用 API：MathLive `getValue(range, 'latex')` 取选区 LaTeX、`selection-change` 事件、`applyStyle(style, {range})` 给局部加样式 — [MathLive: Interacting](https://mathlive.io/mathfield/guides/interacting/)

### Inferences
- 「选中公式局部 → 标注 → 让 AI 改」的推荐流程：在 MathLive 中取 `selection` 与 `getValue(range, 'latex')` 得到局部 LaTeX，连同整条公式 LaTeX 与上下文发给模型，要求只返回替换后的整条 LaTeX；预览时在弹层内并排显示「原渲染 / 新渲染」，并在源码层用 `@codemirror/merge` 的 `unifiedMergeView` 或字符 diff 标红绿；接受 = 一次事务替换节点属性（或 CM6 一次 `changes`），拒绝 = 丢弃临时状态。
- 预览应「仅本地可见」（Tiptap 装饰式 suggestion 的思路），避免在协同文档里写入临时节点；若需要持久审阅再引入 suggestion marks（BlockNote/prosemirror-suggest-changes）。
- 撤销：参照 Plate `withAIBatch`，把 AI 修改（包括流式中间步骤）合并为一个 history 事件；在 ProseMirror 中可在接受时用单个 transaction 提交，在 CM6 中用单个 transaction（必要时加 `isolateHistory` 注解，API 细节待核实）。
- 标注的持久化：`applyStyle` 给局部上色可能被序列化进 LaTeX（如颜色命令），会污染源码；标注更宜存为「公式节点 + LaTeX 字符偏移区间」的旁注数据（待验证 MathLive 的样式序列化行为）。

### Gaps
- Notion AI 编辑时是否以行内红绿 diff 呈现、Notion 的撤销粒度，未取得一手资料（仅第三方摘要称有 Replace / Insert below / Try again / Discard）。
- Cursor 官方文档未描述 diff 呈现与撤销，现有细节来自第三方教程。
- 未找到任何产品对「公式内部局部」做 AI 修改的一手实现描述（Overleaf 的选区 AI 菜单作用于 LaTeX 源码文本，是否特殊处理数学未见说明）。

## Q7 单页大量公式时的性能经验

### Takeaway
性能取决于两件事：渲染库成本（MathJax 明显重于 KaTeX；超长公式 KaTeX 也会超线性变慢）与编辑器是否只渲染可见部分（CM6 有视口渲染，ProseMirror/Lexical 把整个文档放进 DOM）。成熟做法：widget `eq()` 复用 DOM、按 (LaTeX, 模式, 宏/preamble) 缓存渲染结果（LRU）、异步/防抖渲染、缓存测得高度作 `estimatedHeight`、拖选期间暂停重算、不可见时延迟渲染。

### Cited Findings
- CM6：「CodeMirror doesn't render the entire document, when that document is big」，只渲染可见部分加边距；对整个文档保存高度信息（先估计，绘制时实测）；视口外坐标查询无效 — [CodeMirror System Guide](https://codemirror.net/docs/guide/)
- ProseMirror：「ProseMirror doesn't do viewporting…The library puts the entire document in the DOM, yes」（Marijn，2022-10）— [discuss.prosemirror.net #4972](https://discuss.prosemirror.net/t/improving-performance-loading-on-scroll/4972)
- Lexical vs ProseMirror 压测（Emergence Engineering，2024-10）：一小时自动输入；Lexical 开 history 时约 23 分钟内存涨到 3.9 GB 崩溃，关 history 为 10–70 MB；ProseMirror 全程 6–18 MB；ProseMirror 布局次数为 Lexical 的 2–2.5 倍；初始包 158 KB vs 160 KB — [Emergence Engineering](https://emergence-engineering.com/blog/lexical-prosemirror-comparison)
- Overleaf `MathWidget`：`eq()` 在 LaTeX/displayMode/preamble 不变时复用 DOM；`setTimeout` 异步 + `MathJax.tex2svgPromise()`；渲染后缓存高度作 `estimatedHeight`（未渲染按每行 40px 估）；销毁后放弃渲染 — [overleaf math.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/visual/visual-widgets/math.ts)；鼠标按住期间暂停重算装饰 — [atomic-decorations.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/visual/atomic-decorations.ts)；Code 模式 math preview 无防抖 — [math-preview.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/source-editor/extensions/math-preview.ts)
- Zettlr：`updateDOM` 中 `if (dom.dataset.equation === this.equation) { return true }` 跳过重复渲染，`eq` 复用 widget — [Zettlr render-math.ts](https://raw.githubusercontent.com/Zettlr/Zettlr/master/source/common/modules/markdown-editor/renderers/render-math.ts)
- Obsidian：数学密集笔记在 Live Preview 中「got stuck and I can barely type any letters」（2022-03，无官方回复）— [Obsidian Forum #34140](https://forum.obsidian.md/t/performance-problem-for-math-heavy-notes/34140)；另有「Poor performance in live preview mode」— [#50136](https://forum.obsidian.md/t/poor-performance-in-live-preview-mode/50136)（仅标题）
- Obsidian 社区插件 MathJax4-for-Obsidian / Latest MathJax：独立 MathJax 4 引擎，提供 LRU formula cache（大小可配）与 Live Preview 渲染防抖，CHTML 或 SVG 输出，preamble `.tex` 文件热更新；默认与内置渲染共存，另有接管 `MathJax.tex2chtml` 的实验模式 — [MathJax4-for-Obsidian](https://github.com/TheTenth-THU/MathJax4-for-Obsidian)；插件页称 Obsidian 自带 MathJax 落后上游 — [Latest MathJax 插件页](https://community.obsidian.md/plugins/latest-mathjax)（搜索摘要）
- ProseMirror 嵌套编辑器方案在每次 transaction 更新所有公式 NodeView，Desmos/benrbray 承认公式上百时可能成问题（其文档通常少于十个）— [discuss.prosemirror.net #2906](https://discuss.prosemirror.net/t/replicating-typoras-inline-display-math-editing/2906)
- KaTeX：`macros` 对象会被 `\gdef`/`\global\let` 修改，传同一对象可在多次调用间共享宏状态；`maxExpand` 默认 1000 防无限展开；`maxSize` 限制尺寸 — [KaTeX options](https://katex.org/docs/options)
- KaTeX 超长公式渲染超线性，粘贴大矩阵等可能每次渲染 3–17 秒，且在每次输入停顿后在主线程重跑 — [InstantLaTeX #36](https://github.com/jonbaldie/InstantLaTeX/issues/36)（小型项目 issue，搜索摘要，仅作佐证）
- MathLive：共享字体懒加载，并「defers rendering until visible」— [MathLive GitHub](https://github.com/arnog/mathlive)
- Logseq 曾长期使用 KaTeX 0.13.18，落后于当时的 0.16.4 — [logseq #8877](https://github.com/logseq/logseq/issues/8877)（搜索摘要）

### Inferences
- 缓存键必须包含所有影响输出的输入：LaTeX、display/inline、宏/preamble（Overleaf 的 `eq()` 就比较 preamble）；若共享 KaTeX `macros` 对象，某条公式中的 `\gdef` 会污染其他公式的缓存，应每次传新宏对象或把宏定义纳入缓存键。
- 在 ProseMirror/Lexical 这类「全文入 DOM」的编辑器中，大量公式应：node view 先渲染占位（固定/估计高度），用 IntersectionObserver 进入视口再渲染 KaTeX；渲染结果以 LaTeX 哈希缓存；选 KaTeX（同步、快）做正文渲染，MathJax 只在需要完整宏包时用。
- 结构化编辑器（MathLive）实例不宜每个公式常驻：只在被编辑的那一个公式挂载 `<math-field>`，其余用静态 KaTeX/`<math-span>`，否则数百个 mathfield 的内存与事件开销不可控（推断，未找到实测数据）。
- 布局跳动（Obsidian #66219）与性能同源：渲染前后高度差。缓存测得高度并用作占位/`estimatedHeight`（Overleaf 做法）可同时缓解两者。

### Gaps
- 未找到 Notion、Obsidian、Overleaf 官方公布的「每页 N 个公式」性能数据或内部缓存策略说明。
- 搜索摘要称 Overleaf 于 2026-06 升级到 MathJax 4，未找到一手来源核实。
- CSS `content-visibility` 用于公式密集文档的效果未找到实测资料。
