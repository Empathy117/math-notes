# 结构化（WYSIWYG / click-to-edit）数学公式编辑器的内部实现调研（截至 2026-09）

> 数据时间：npm 元数据（`npm view`，registry.npmjs.org）、仓库活跃度（GitHub REST API）、包体积（bundlephobia / unpkg）均于 2026-09-25 读取。"Cited Findings" 每条后附来源；"Inferences" 是基于来源的推断，未经实测。

## 1. 内部文档模型是什么？如何映射回 LaTeX？哪些 LaTeX 构造无法往返？

### Takeaway
现有编辑器大致分五类模型：
1. **MathLive**：`Atom` 树（命名 branch）+ 自带的 TeX 排版引擎。未编辑的子树回吐解析时记录的 `verbatimLatex`，编辑过的子树按"紧凑"规范形式重写（默认 `\frac12`、`x^2`）。
2. **MathQuill**：DOM 与节点一一绑定的双向链表树。LaTeX 完全由树重新生成，不保留原始拼写；遇到未知命令时整体解析失败。
3. **MathML/OMML 系**：Wiris MathType、Word、UnicodeMathML。LaTeX 只是导入/导出格式。
4. **TeXmacs / LyX**：自有树模型，LaTeX 通过转换器进出（见第 5 节）。
5. **非结构化**："LaTeX 字符串 + 重新渲染"，包括 Tiptap Mathematics、prosemirror-math、ckeditor5-math、TinyMCE Math。

需要"精确导出 LaTeX"时，只有两条路：以 LaTeX 字符串为唯一真源，或者做源码区间跟踪（MathLive 的 `verbatimLatex`、TeXmacs 的 source tracking 都属于后者）。

### Cited Findings
**MathLive（atom 树）**
- `Atom` 类字段：`type`（如 `'mord'`、`'mop'`、`'first'`、`'root'`、`'array'`）、`command`（如 `'\sin'` 或单字符）、`value`、`verbatimLatex`、`mode`（`ParseMode`）、`parent`、`parentBranch`、`style`、`isFunction`、`captureSelection`（子节点作为整体，不可单独选中）、`skipBoundary`、`subsupPlacement`、`explicitSubsupPlacement`（由 `\limits`/`\nolimits`/`\displaylimits` 设置） — [atom-class.ts](https://github.com/arnog/mathlive/blob/master/src/core/atom-class.ts)
- 子节点按命名 branch 存放：`NAMED_BRANCHES: ['body', 'above', 'below', 'superscript', 'subscript']`。数组/矩阵用 `[row, col]` 作为 cell branch。每个 branch 是"以 `type: 'first'` 占位 atom 开头的数组"（`makeFirstAtom()`），该 'first' atom 承载 branch 内最左侧的光标位置 — [atom-class.ts](https://github.com/arnog/mathlive/blob/master/src/core/atom-class.ts)
- 序列化 `_serialize(options)` 的优先级：①若 `verbatimLatex` 是字符串且未要求展开宏，原样返回；②命令定义自带的 serializer；③`command` + `bodyToLatex()`；④仅 body；⑤`value`/`command`。注释称这样 "allow non-significant punctuation to be preserved when possible" — [atom-class.ts](https://github.com/arnog/mathlive/blob/master/src/core/atom-class.ts)
- 解析时用 `result.verbatimLatex = tokensToString(this.tokens.slice(initialIndex, this.index))` 记录原始 token 片段；`llap`、`rlap`、`class` 等命令刻意不记录 — [parser.ts](https://github.com/arnog/mathlive/blob/master/src/core/parser.ts)
- `isDirty` setter 会清除 `_children`/`_json` 缓存、递增根节点的 `changeCounter`，并使 `verbatimLatex` 需要重新计算，即被编辑过的 atom 不再使用原始拼写 — [atom-class.ts](https://github.com/arnog/mathlive/blob/master/src/core/atom-class.ts)
- 默认紧凑序列化：MathLive 输出 `\frac12` 而非 `\frac{1}{2}`、`\sqrt2` 而非 `\sqrt{2}`、`x^2` 而非 `x^{2}`。2026-08-03 开启的 PR #3055 提议新增静态开关 `MathfieldElement.compactSerialization`（默认 `true` 以兼容），作用于 `\frac`、`\binom`、`\dfrac`、`\sqrt` 和上下标。理由是服务端 LaTeX 解析器通常不实现 TeX 的参数抓取规则，而判分系统需要稳定的规范拼写。截至读取时仍为 open，未见维护者回应 — [arnog/mathlive #3055](https://github.com/arnog/mathlive/issues/3055)
- 其他未解决的往返问题：#3078（2026-09-21，open）"Text runs are serialized without \text{} when defaultMode is "text""，即 text 模式下导出的值离开 mathfield 就不可用；#2420（2024-06-28，open）请求在 `defaultMode` 为 text 时按 LaTeX 而非 Math 解析内容 — [GitHub issues 搜索](https://github.com/arnog/mathlive/issues?q=round-trip)（经 GitHub API 检索）
- 渲染：`atom.render(context)` 生成 `Box`，上下标由 `attachSupsub()` 按 TeXbook 第 445–446 页规则（`supDrop`、`xHeight`、`defaultRuleThickness` 等参数）定位。MathLive 自带排版引擎，不依赖 KaTeX/MathJax — [atom-class.ts](https://github.com/arnog/mathlive/blob/master/src/core/atom-class.ts)
- 编辑模型把整棵树线性化为整数 offset：`model.atoms` 即 `root.children`（按键盘导航顺序展平的所有后代），offset 0 位于第一个 atom 之前，`lastOffset = atoms.length - 1`；`at(offset)` 与 `offsetOf(atom)` 双向映射 — [model-private.ts](https://github.com/arnog/mathlive/blob/master/src/editor-model/model-private.ts)
- `getValue()` 输出格式（master）：`'ascii-math' | 'latex' | 'latex-expanded' | 'latex-unstyled' | 'latex-without-placeholders' | 'typst' | 'math-ml' | 'plain-text' | 'spoken' | 'spoken-text' | 'spoken-ssml' | 'spoken-ssml-with-highlighting'` — [core-types.ts](https://github.com/arnog/mathlive/blob/master/src/public/core-types.ts)。其中 `typst` 自 0.106.0 起提供 — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- MathJSON 解耦：已发布的 0.110.0 仍有 `"math-json"` 格式和 `expression` 属性 — [Interacting guide](https://mathlive.io/mathfield/guides/interacting/)。master 的 `[Unreleased]` 段落写明 `@cortex-js/compute-engine` 不再是依赖（"was never bundled with MathLive; it was only used for its TypeScript types"），移除 `mathfield.expression` getter/setter（改用 `MathfieldElement.computeEngine.parse(mf.getValue())`），移除 `getValue()` 的 `"math-json"`（改用 `...parse(mf.getValue()).json`），`mf.setValue(expr)` 仍接受 MathJSON 对象，默认 context menu 去掉 Evaluate/Simplify/Solve — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)

**MathQuill（DOM 绑定的链表树）**
- `NodeBase` 为双向链表树：`[L]`/`[R]` 兄弟指针、`parent`、`ends[L]`/`ends[R]` 首尾子节点；注释 "Only doing tree node manipulation via these adopt/disown methods guarantees well-formedness of the tree"。每个节点有 `NodeBase.uniqueNodeId()` 生成的 `id`，DOM 元素上挂 `mqBlockNode`/`mqCmdNode` 属性反向指向节点（`getNodeOfElement()`、`linkElementByBlockNode()`、`linkElementByCmdNode()`）；`ctrlSeq` 存 LaTeX 控制序列；`Fragment` 是不脱离父节点的兄弟序列（单向指针）；`Point` 由 `parent`、`[L]`、`[R]` 表示光标位置 — [tree.ts](https://github.com/mathquill/mathquill/blob/master/src/tree.ts)
- LaTeX 解析用 parser combinator（`Parser.string`、`Parser.regex`、`latexMathParser`）。未知命令时 `return fail('unknown command: \\' + ctrlSeq)`；`renderLatexMathFromScratch()` 解析失败时执行 `root.domFrag().empty()`，即整体失败，不做部分恢复。导出为 `exportLatex()` → `this.cleanLatex(this.root.latex())`，`cleanLatex` 用正则去掉命令后多余的空格；`updateLatexMathEfficiently()` 只对末尾数字变化做增量更新 — [latex.ts](https://github.com/mathquill/mathquill/blob/master/src/services/latex.ts)
- 历史上的往返失败：输入 `\vector` 生成的 `\begin{matrix}...` 无法被 MathQuill 自己再解析 — [mathquill #31](https://github.com/mathquill/mathquill/issues/31)（早期 issue，当前状态未核实）

**MathML / OMML 系**
- Wiris MathType web editor 的 JS API 以 MathML 为交换格式：`com.wiris.jsEditor.JsEditor.newInstance({'language': 'en'})`、`editor.insertInto(container)`、`editor.getMathML()`、`editor.setMathML("<math>…</math>")` — [Wiris docs](https://docs.wiris.com/mathtype/en/mathtype-integrations/technical-configurations/embedding-and-customization.html)（该页现需登录，内容来自搜索索引摘要）
- Word 内部用 OMML，其他 Office 应用由 RichEdit 以 UnicodeMath 定义并构建结构 — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- UnicodeMathML 的 autobuildup "manipulate the MathML DOM"，并支持 MathML → UnicodeMath — [UnicodeMathML](https://murrayiii.github.io/UnicodeMathML/)

**非结构化（LaTeX 字符串即真源）**
- Tiptap Mathematics：KaTeX 渲染，节点 `InlineMath`/`BlockMath`，编辑方式是 `onClick(node, pos)` 回调，默认弹出 prompt 让用户改 LaTeX；命令有 `insertInlineMath`、`updateInlineMath`、`deleteInlineMath`、`insertBlockMath`、`updateBlockMath`、`deleteBlockMath` — [Tiptap docs](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)
- prosemirror-math：`math_inline`（`content: text*`、`inline: true`、`atom: true`）与 `math_display`；选中节点时启用嵌套的 ProseMirror 实例编辑 LaTeX 源码，取消选中后用 KaTeX 渲染 — [benrbray/prosemirror-math](https://github.com/benrbray/prosemirror-math)
- ckeditor5-math：balloon 中的 LaTeX 文本框 + 预览，引擎可选 MathJax/KaTeX，输出 `<script type="math/tex">…</script>` 或 `<span class="math-tex">\( … \)</span>` — [isaul32/ckeditor5-math](https://github.com/isaul32/ckeditor5-math)
- TinyMCE Math（付费插件）：模态框中的 LaTeX/MathML 文本框 + 预览，存为 `<tiny-math-inline formula="...">`/`<tiny-math-block formula="...">`，支持的符号参照 KaTeX 列表 — [TinyMCE docs](https://www.tiny.cloud/docs/tinymce/latest/math/)

**TeXmacs / LyX**（详见第 5 节）
- TeXmacs："TeXmacs documents are internally represented by trees"，公式用 `frac`、`rsub`、`rsup` 等标签 — [semedit](https://www.texmacs.org/joris/semedit/semedit.html)；LyX 公式为 `InsetMathHull` 容器，`MathData` 存放 `MathAtom` 序列 — [lyx-cvs](https://www.mail-archive.com/lyx-cvs@lists.lyx.org/msg27325.html)

### Inferences
- MathLive 的往返策略是"未编辑子树按 token 原样回吐 + 编辑过的子树紧凑重写"。对笔记场景（用户在源码视图写的 LaTeX 不希望被改写）可用，但用户一旦在可视化视图里改动某个子表达式，该子表达式及失效的祖先会被重新序列化，可能出现 `\frac{1}{2}` → `\frac12`、空格或花括号变化。如果需要稳定格式，可以等 #3055 合并、自带 fork，或在导出后用自己的 serializer 规范化。
- MathQuill 没有"保留原文"机制，而且解析是全有或全无。它不适合"用户可随意粘贴任意 LaTeX 源码再切回可视化"的笔记场景。
- 对"必须精确导出 LaTeX"的自研组件，一个可行方案是：以 LaTeX 字符串为唯一真源，解析为带源码区间（start/end offset）的 atom 树；可视化编辑某节点时，只把该节点重新序列化并 splice 回原字符串对应区间，其余字节不动。这相当于把 TeXmacs "conservative conversion" 的思想用到公式粒度，MathLive 的 `verbatimLatex` 也是它的弱化版本。

### Gaps
- MathLive 对 `\over`、`\choose`、`%` 注释、`\left.`、`\;` 等具体会如何改写，没有找到逐项文档，需要实测。
- Wiris MathType 内部模型（是否全程 MathML、LaTeX 如何存放）缺少可访问的一手文档（官网文档页已需登录）。
## 2. 点击编辑与光标定位如何实现？（含 MathLive 精确 API）

### Takeaway
- **MathLive**：坐标 → 最近 atom（按 bounding box 距离递归搜索）→ 向上找 `captureSelection` 祖先 → 按 bias/中线决定落在左侧还是右侧 → 得到整数 offset。公开 API 用 `position`（整数 offset）和 `selection`（`{ranges, direction}`）表示光标/选区；`insert(..., {insertionMode:'replaceSelection'})` 替换选区；`getValue(start, end, format)` 取子区间的 LaTeX。
- **MathQuill**：从事件目标沿 DOM 向上找到绑定的节点，再由各节点类的 `seek(clientX, cursor)` 决定位置。公开 API 没有区间级选区读写。
- **LyX/TeXmacs**：以箭头键在树的"槽位"间导航为主。

### Cited Findings
**MathLive：命中测试与选区模型**
- 命中测试流程 `offsetFromPoint(mathfield, x, y, options)`：①越界时返回 `0` 或 `lastOffset`；②`nearestAtomFromPoint()` 用 `getAtomBounds()` 递归找"最深且最近"的 atom，距离取点到矩形的平方距离（点在矩形内为 0）；③沿 parent 链找第一个设置了 `captureSelection` 的祖先；④应用 `bias`：`bias === 0` 且点击在 atom 竖直中线左侧时返回左邻 offset，`bias < 0` 总是偏左 — [pointer-input.ts](https://github.com/arnog/mathlive/blob/master/src/editor-mathfield/pointer-input.ts)
- 数组（矩阵/多行环境）：先按竖直距离确定点击的行（`targetRowIndex`），只在该行的 cell 中搜索 — [pointer-input.ts](https://github.com/arnog/mathlive/blob/master/src/editor-mathfield/pointer-input.ts)
- 拖拽选择调用 `model.extendSelectionTo(anchor, focus)`；双击调用 `selectGroup(model)`；三击选中 `[[0, lastOffset]]`；点击 placeholder/prompt 时把光标放进其 `firstChild` — [pointer-input.ts](https://github.com/arnog/mathlive/blob/master/src/editor-mathfield/pointer-input.ts)
- 选区约束：选区覆盖某容器的全部子节点时自动扩展到父节点（`expandableTypes` = `'genfrac'`、`'subsup'`、`'accent'`、`'box'`、`'overlap'`、`'overunder'`；`surd`、`leftright` 等"通常作为参数的容器"除外）；`setSelection` 会调用 `includeAttachedSubsup()` 把附着的上下标一并选中；结构化范围由 `getSiblingsRange(offset)`、`getBranchRange(offset, branchName)`、`getCellRange(offset)` 提供 — [model-private.ts](https://github.com/arnog/mathlive/blob/master/src/editor-model/model-private.ts)

**MathLive：公开 API（0.110.0）**
- 读写：`value`；`getValue(format?)`、`getValue(start: number, end: number, format?)`、`getValue(range: [Offset, Offset], format?)`；`setValue(value?: string, options?: InsertOptions)`；`insert(s: string, options?: InsertOptions): boolean` — [MathLive API](https://mathlive.io/mathfield/api/)
- `InsertOptions`：`insertionMode?: "replaceSelection" | "replaceAll" | "insertBefore" | "insertAfter"`、`selectionMode?: "placeholder" | "after" | "before" | "item"`、`format?: OutputFormat | "auto"`、`mode?: ParseMode | "auto"`、`style?`、`focus?`、`feedback?`、`scrollIntoView?`、`silenceNotifications?` — [MathLive API](https://mathlive.io/mathfield/api/)
- 光标/选区：`position: number`（getter/setter）、`selection: Readonly<Selection>`（getter/setter）、`selectionIsCollapsed`、`lastOffset`；类型 `Offset = number`、`Range = [start: Offset, end: Offset]`、`Selection = { ranges: Range[]; direction?: 'forward' | 'backward' | 'none' }` — [MathLive API](https://mathlive.io/mathfield/api/)；[core-types.ts](https://github.com/arnog/mathlive/blob/master/src/public/core-types.ts)
- 坐标：`getOffsetFromPoint(x, y, options?: {bias?: -1|0|1}): number`、`getElementInfo(offset): ElementInfo`（字段 `id`〔由 `\htmlId`/`\cssId` 设置〕、`depth`〔顶层为 0〕、`bounds: DOMRect`、`style`、`latex`、`data`、`mode`）。0.99.0 起 `offsetFromPoint()` 改名为 `getOffsetFromPoint()`，`setCaretPoint()` 改为 `mf.position = mf.getOffsetFromPoint(...)`，`scriptDepth()`/`hitboxFromOffset()` 合并为 `getElementInfo()` — [MathLive API](https://mathlive.io/mathfield/api/)；[CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- 命令：`executeCommand(selector: Selector | [Selector, ...unknown[]]): boolean`。导航类 selector 有 `moveToNextChar`、`moveToPreviousChar`、`moveToNextPlaceholder`、`moveToPreviousPlaceholder`、`moveToNextWord`、`moveToGroupStart`/`moveToGroupEnd`、`moveToMathfieldStart`/`moveToMathfieldEnd`、`moveUp`/`moveDown`、`moveToSuperscript`、`moveToSubscript`、`moveToOpposite`、`moveBeforeParent`、`moveAfterParent`；选择类有 `selectAll`、`selectGroup`、`extendToNextChar`、`extendToNextWord`、`extendUp`/`extendDown`、`extendToNextBoundary`、`extendToGroupStart`/`extendToGroupEnd`、`extendToMathFieldStart`/`extendToMathFieldEnd`；编辑类有 `insert`、`deleteBackward`、`deleteForward`、`deleteAll`、`transpose`、`addRowAfter`/`addRowBefore`、`addColumnAfter`/`addColumnBefore`、`removeRow`/`removeColumn`；其他有 `undo`、`redo`、`commit`、`switchMode`、`toggleVirtualKeyboard`、`speak`。带参数的写法为 `["insert", "\\frac{#0}{#?}"]`（`#0` 为选区） — [Commands guide](https://mathlive.io/mathfield/guides/commands/)
- 事件：`input`（带 `inputType`）、`change`（回车或失焦）、`beforeinput`（可 `preventDefault()`；`inputType` 取 `"insertText"`、`"insertLineBreak"`、`"insertFromPaste"`、`"deleteContent"`、`"deleteContentBackward"`、`"deleteContentForward"`、`"deleteByCut"`、`"historyUndo"`、`"historyRedo"`）、`selection-change`、`mode-change`、`move-out`/`focus-out`、`focus`/`blur`/`click` — [Interacting guide](https://mathlive.io/mathfield/guides/interacting/)。`move-out` 的 `detail.direction` 为 `"forward" | "backward" | "upward" | "downward"`，"signals that the user pressed an arrow key or tab key but there was no navigation possible inside the mathfield" — [MathLive API](https://mathlive.io/mathfield/api/)
- `setValue(content, { silenceNotifications: true })` 可避免触发 `input`（外部同步时用来防止回环）；剪贴板 flavor 为 `text/plain`（包裹的 LaTeX）、`application/x-latex`、`application/json`，可用 `onExport()` 定制 — [Interacting guide](https://mathlive.io/mathfield/guides/interacting/)
- 只读与填空：`readOnly: boolean`（"When true, the user cannot edit the mathfield"） — [MathLive API](https://mathlive.io/mathfield/api/)。在 readonly mathfield 中 `\placeholder[id]{value}` 构成可编辑的 prompt（`id` 不能含空格/特殊字符，`{}` 必须存在，例 `\placeholder[numerator]{?}`），此时只有 prompt 可编辑。API 有 `getPrompts()`、`getPromptValue(id, format)`、`setPromptValue(id, content, insertOptions)`、`getPromptState(id)`、`setPromptState(id, state: "correct"|"incorrect"|"undefined", locked?)`、`getPromptRange(id): Range`；文档建议在 `input` 事件中取值，用 Compute Engine 的 `isSame()` 判等 — [Fill-in-the-blank guide](https://mathlive.io/mathfield/guides/fill-in-the-blank/)；[MathLive API](https://mathlive.io/mathfield/api/)
- Compute Engine（0.110.0）：`expression` 返回 boxed MathJSON，可 `.evaluate()`、`.simplify()`、`.isEqual()`、`.isSame()`、`.compile()`；共享实例为 `MathfieldElement.computeEngine` — [Interacting guide](https://mathlive.io/mathfield/guides/interacting/)（master 已计划移除 `expression`，见第 1 节）
- 行为/导航选项：`fractionNavigationOrder`（`"numerator-denominator"` 或 `"denominator-numerator"`）、`scriptDepth`、`defaultMode`（`"inline-math"`、`"math"`、`"text"`） — [Customizing guide](https://mathlive.io/mathfield/guides/customizing/)

**MathQuill**
- 鼠标：`handleMouseDown` 先 `e.preventDefault()`，然后 `while (targetElm) { node = NodeBase.getNodeOfElement(targetElm); if (node) break; targetElm = targetElm.parentElement; }`，找不到就用 `this.root`；定位交给 `node.seek(clientX, cursor)`，由各节点类自行比较水平位置；拖拽时 `cursor.startSelection()`，mousemove 中调用 `ctrlr.seek(lastMousemoveTarget, e.clientX, e.clientY).cursor.select()` — [mouse.ts](https://github.com/mathquill/mathquill/blob/master/src/services/mouse.ts)
- API（interface v3，`MathQuill.getInterface(3)`）：`MQ.MathField(el, config)`、`MQ.StaticMath(el)`、`.latex()`/`.latex(str)`、`.write(latex)`（在光标处写入）、`.cmd(latex)`（对光标或选区执行命令）、`.select()`（全选）、`.clearSelection()`、`.moveToLeftEnd()`/`.moveToRightEnd()`/`.moveToDirEnd(dir)`、`.keystroke('Shift-Left')`、`.typedText(text)`、`.setAriaLabel()`/`.setAriaPostLabel()`；`\MathQuillMathField` 可在静态公式里嵌入可编辑子字段（`.innerFields`、`.makeStatic()`/`.makeEditable()`）；另有实验性的 `.dropEmbedded(pageX, pageY, options)`、`.registerEmbed()` — [Api_Methods.md](https://github.com/mathquill/mathquill/blob/master/docs/Api_Methods.md)
- 配置：`leftRightIntoCmdGoes: 'up' | 'down'`、`spaceBehavesLikeTab`、`restrictMismatchedBrackets`、`supSubsRequireOperand`、`charsThatBreakOutOfSupSub`、`autoCommands`（空格分隔的命令列表，键入即转换）、`autoOperatorNames`、`maxDepth`、`substituteTextarea`；handlers 有 `edit`、`enter`、`moveOutOf`、`deleteOutOf`、`selectOutOf`、`upOutOf`、`downOutOf` — [MathQuill Config](https://docs.mathquill.com/en/latest/Config/)

**LyX / TeXmacs**
- LyX：直接键入 `\commandname[optional]{required}` 即转换为结构，蓝色框标出参数输入位置；例如 `\frac A↓B` 用 ↓ 键从分子移到分母，`B_V`、`B^V` 输入上下标 — [LyX Math manual](https://elyxer.nongnu.org/lyx/Math.html)
- TeXmacs：大型运算符的不可见右边界旁 "there are two cursor positions"（运算符作用域内和作用域外）；在一对空的匹配括号内按 backspace/delete 会删除这对括号 — [semedit](https://www.texmacs.org/joris/semedit/semedit.html)

### Inferences
- 用 MathLive 实现"点击 `lim_{x→0}` 中的 0 并原地编辑"不需要自定义代码：默认指针处理会把光标放进 `subscript` branch。程序化地"选中子表达式并替换"，可用 `mf.selection = {ranges:[[a,b]]}` 加 `mf.insert(latex, {insertionMode:'replaceSelection', selectionMode:'placeholder'})`。"切换到源码视图"用 `mf.getValue('latex')` 和 `mf.setValue(src, {silenceNotifications:true})`。
- MathLive 没有公开"LaTeX 源码字符偏移 ↔ model offset"的映射，只能用 `getValue(start, end)` 取某区间的 LaTeX。如果要在源码视图里高亮当前选中的子表达式，需要自研带 span 的解析器，或者用 `getValue` 结果在源码中做字符串匹配（有歧义）。
- MathQuill 的公开 API 只能全选或清除选区，无法按区间设置选区，也无法读取选区的 LaTeX（据 API 列表判断），不满足"选中子表达式并替换"的程序化需求，除非改内部代码。

### Gaps
- 未找到 MathLive `Selector` 类型的完整权威列表（commands guide 可能不全），也未核实 `focus-out` 事件在 0.110.0 中是否仍存在（interacting guide 列出了它，API 页未列出）。
- LyX 的 cursor 模型（`Cursor`/`DocIterator`/`CursorSlice` 路径表示）没有取得可访问的一手源码文档：lyx.org 的 doxygen 页返回 404，gitweb 因 AI 爬虫被关闭。
## 3. LaTeX 覆盖范围与不支持输入时的行为

### Takeaway
- **MathLive**：覆盖最广（800+ 命令，含 `align`/`gather`/`multline`/`split`、`\ce{}`、braket），错误可编程获取。未知命令生成 `ErrorAtom` 并记录 `unknown-command`，有 `mf.errors`、结构化的 `LatexSyntaxError` 以及独立的 `validateLatex()`（0.110.0 起支持 `macros` 选项）。
- **MathQuill**：只支持一个受限子集，遇到未知命令时整体解析失败。
- **Word**：LaTeX 支持有明确的黑名单，且不支持 `\begin{}`。
- **KaTeX 类方案**：覆盖取决于 KaTeX，错误由 `throwOnError` 控制。

### Cited Findings
- MathLive README："800+ LaTeX commands" — [arnog/mathlive](https://github.com/arnog/mathlive)。参考页列出的环境有 `matrix`、`pmatrix`、`bmatrix`、`Bmatrix`、`vmatrix`、`Vmatrix`、`smallmatrix`、`cases`、`dcases`、`rcases`、`array`、`aligned`、`align`、`gather`、`gathered`、`multline`、`split`、`eqnarray`、`equation` 等；命令包括 `\text{}`/`\mbox{}`、`\operatorname{}`、`\textcolor{}{}`、`\colorbox{}{}`、`\htmlData{}{}`、`\cssId{}{}`、`\class{}{}`、`\enclose{}`、`\cancel{}`、`\ce{}`（mhchem）、`\bra{}`/`\ket{}`/`\braket{}`。该页没有列出 `\newcommand`/`\def`（宏通过 `macros` 选项提供）、`\label`/`\tag`/`\ref`/`\eqref`、`\mathchoice`、`\unit`/`\SI` — [Commands reference](https://mathlive.io/mathfield/reference/commands/)
- 0.104.0 起支持多行环境 `\displaylines`、`gather`、`multline`、`align`、`split`：Return 换行，行首 Backspace 删除该行，context menu 可增删行列 — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- 未知命令：`this.onError({ code: 'unknown-command', arg: command }); return [new ErrorAtom(command)];`；text 模式下未知命令被转成逐字符 atom；`\left` 缺少匹配 `\right` 时报 `'unbalanced-braces'`，并尝试把缺失的定界符设为 `'.'` 来恢复 — [parser.ts](https://github.com/arnog/mathlive/blob/master/src/core/parser.ts)
- `ParserErrorCode` 全集：`'unknown-command' | 'invalid-command' | 'unbalanced-braces' | 'unknown-environment' | 'unbalanced-environment' | 'unbalanced-mode-shift' | 'missing-argument' | 'too-many-infix-commands' | 'unexpected-command-in-string' | 'missing-unit' | 'unexpected-delimiter' | 'unexpected-token' | 'unexpected-end-of-string' | 'improper-alphabetic-constant'`。`LatexSyntaxError<T = ParserErrorCode> = { code: T; arg?: string; latex?: string; before?: string; after?: string }`，`before`/`after` 为出错点前后的 token 上下文 — [core-types.ts](https://github.com/arnog/mathlive/blob/master/src/public/core-types.ts)；[parser.ts](https://github.com/arnog/mathlive/blob/master/src/core/parser.ts)
- `mf.errors` 返回当前内容的 LaTeX 语法错误数组 — [MathLive API](https://mathlive.io/mathfield/api/)。`validateLatex()` 为独立导出函数，0.110.0 起 "accepts an optional `options` argument with a `macros` dictionary, so custom macros are recognized during validation instead of being reported as unknown commands" — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- 安全：0.110.0 修复 #3028 XSS。此前 `\text{}`、`\mbox{}` 的内容未经转义进入 `convertLatexToMarkup()`、编辑器、`<math-span>`/`<math-div>` 和 `convertLatexToMathMl()` 的输出，例如 `\text{<img src=x onerror=alert(1)>}` 可执行脚本。0.104.0 起清洗 `\htmlData{}`，`\href` 只允许 http/https — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- MathQuill：未知命令 `fail('unknown command: \\' + ctrlSeq)`，`latex(str)` 解析失败时清空内容（`root.domFrag().empty()`） — [latex.ts](https://github.com/mathquill/mathquill/blob/master/src/services/latex.ts)。矩阵环境长期缺失 — [mathquill #31](https://github.com/mathquill/mathquill/issues/31)。arnog（MathLive 作者）曾提交 "Add support for all amsmath symbols" 的 PR — [mathquill #615](https://github.com/mathquill/mathquill/pull/615)（合并状态未核实）
- Word LaTeX 线性格式：不支持 `\eqarray`、`\Middle`、`\ldiv`、`\dsmash`，也不支持 `\begin{}`/`\end{}`（改用 `\matrix{}`） — [Microsoft Support](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)
- 渲染型方案：Tiptap Mathematics 通过 `katexOptions`（如 `throwOnError: false`、`macros`）控制 KaTeX 行为 — [Tiptap docs](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)；TinyMCE Math 参照 KaTeX 支持列表 — [TinyMCE docs](https://www.tiny.cloud/docs/tinymce/latest/math/)；Lexical 有 "Better error handling for Katex rendering" 的 issue — [facebook/lexical #4185](https://github.com/facebook/lexical/issues/4185)
- TeXmacs 导入：选项 "Import sophisticated objects as pictures" 会临时编译 LaTeX，把 `\xymatrix`、pspicture、tikzpicture 作为图片导入 — [TeXmacs manual](https://www.texmacs.org/tmweb/manual/webman-convert.en.html)；LyX 对无结构支持的内容用 "Insert ▷ TeX Code"（ERT）原样透传 — [LyX Math manual](https://elyxer.nongnu.org/lyx/Math.html)，例如在公式中用 ERT 写 `\tag{...}` — [LyX wiki FAQ/Math](https://wiki.lyx.org/FAQ/Math)

### Inferences
- 笔记组件可在保存前调用 `validateLatex(latex, {macros})` 做 lint，把 `code`/`arg`/`before`/`after` 显示在源码视图中（类似编译错误面板）。未知命令不会让整个公式失效，但无法结构化编辑其参数；`\foo{a}{b}` 的参数大概率被解析成普通分组（未实测）。
- 渲染不可信 LaTeX（例如同步来的笔记）必须使用 ≥ 0.110.0。
- `\label`/`\tag`/`\ref` 这类"文档级"命令不在 MathLive 的职责范围内，笔记组件应在外层（ProseMirror 节点属性）处理编号和引用，公式内只保留纯数学内容。

### Gaps
- `validateLatex` 的精确签名和返回类型没有在 API 页核实（预期返回 `LatexSyntaxError[]`）。
- MathQuill 当前（2025–2026）支持的命令全集未找到权威列表；Desmos fork 的扩展命令（如矩阵、`\operatorname`）没有核实。
## 4. UnicodeMath / AsciiMath 等线性格式如何定义 auto build-up？

### Takeaway
UnicodeMath 的"auto build-up"本质上是一个**由运算符优先级驱动的增量解析器**：每当用户键入的字符（空格、二元/关系运算符、右括号等）让它前面的文本成为"无歧义的线性格式"，就把这段文本构建成二维结构，触发字符本身被吃掉。AsciiMath/mathup 是一次性的"宽松解析"语法，没有增量构建语义。MathLive 用 inline shortcut 加按键命令（`/`、`^`、`_`）在结构模型上即时变换，并不是真正的线性格式解析。

### Cited Findings
- UTN #28 最新为 v3.3（2025-01-22，作者 Murray Sargent III），定义为 "a format for lightly marked-up representation of mathematical expressions in Unicode"；v3.3 新增 UnicodeMathML web applet 链接 — [UTN #28](https://www.unicode.org/notes/tn28/)
- 简洁性：UnicodeMath 用 3 个字符 "1/2" 表示二分之一，典型 MathML 需 35 个字符；空分数模板在 UnicodeMath 中是单字符 '/'，OMML 需 109 字符，LaTeX `\frac{}{}` 9 字符 — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- 实现分工："In Word, the structures are defined in OMML (Office MathML) and built up by Word, while in the other math-enabled apps, the structures are defined in UnicodeMath and built up by RichEdit"；UnicodeMath 与其他格式的转换 "only implemented in Microsoft desktop apps, the Windows Calculator applet, and on the web in UnicodeMathML" — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- 空格规则（§2.3）：ASCII 空格用于界定操作数，"When the space plays this role, it is eliminated upon build up"；`a_1 b_2` 构建为 a₁b₂；嵌套上下标时 "the space builds up one script at a time"（`a^b^c` 需两个空格）；"Binary and relational operators like + and = build up the whole expression" — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- 运算符优先级表（Table 3.1，按优先级递增）：`CR` → 开括号 `( [ { |├〖` → 闭括号 `) ] } | ┤〗` → `&│` → `space "` → `. , = − + * × · • ▒` → `/ ¦` → `∫∑∏` → `_ ^` → `□ ▭ ◼ √∛∜ ▁ ¯` → combining marks。因此 `α + β/γ` 表示 α + (β/γ)，`(α + β)/γ` 才是整体分数；ASCII `|` 是开还是闭，按同层出现次数的奇偶判定 — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- 括号剥离：分子/分母、上下标、`√` 等函数参数的最外层括号在 build up 时移除，"Parentheses appearing in other contexts are always displayed"。并列变量的隐式乘法优先级极高（仅次于 diacritics），显式 `*`/`·` 则与加号同级 — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- n 元运算符（§3.4）：`∫_0^a xⅆx/(x^2+a^2)` 构建为带上下限的积分；n-aryand 的最外层括号**不**移除；可用 `〖〗`（`\begin` `\end`）作不可见分组；`▒`（U+2592，`\naryand`，别名 `\of`）分隔运算符与被积式；运算符后跟的数字控制 limits 位置（`nLimitsUnderOver 1`、`nLimitsSubSup 2` 等） — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- 数学函数（§3.5）："sin" 等函数名应识别为正体，并后接 Invisible Function Apply U+2061（`\funcapply`），构建时形成二元对象；函数名后紧跟的上下标附着到函数名上（如 sin² x）；函数参数的最外层括号不移除，所以 `sin(x)b` 表示 sin(x)×b，要得到 sin(ω−ω0)t 需用 `〖〗` — [UTN28 v3.3 PDF](https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.3.pdf)
- Word 的 Formula Autobuildup（FAB）："formula autobuildup occurs whenever the user types a character that forces the text preceding the character to be the unambiguous linearly formatted text for a built-up expression as defined by the UTN. As such the character itself is not part of the resulting built-up expression"。已构建对象大多作为操作数处理，但构建代码会查看部分对象内部（例如给下标对象再加上标，会合并为 subsup 对象） — [Murray Sargent, Formula Autobuildup in Word 2007](https://learn.microsoft.com/en-us/archive/blogs/murrays/formula-autobuildup-in-word-2007)
- Word 用法：`Alt + =` 插入公式；`Ctrl + =` 转为 Professional（二维），`Ctrl + Shift + =` 转回 Linear；UnicodeMath 例 `a/(b+c)` 后接空格、`\sqrt(5&a^2)<space>`；LaTeX 例 `\frac{a}{b+c}`、`\sqrt[5]{a^2}`；不支持 `\eqarray`、`\Middle`、`\ldiv`、`\dsmash`，也不支持 `\begin{}`/`\end{}`（改用 `\matrix{}`）；Math AutoCorrect 在后接标点、空格或 Enter 时转换 — [Microsoft Support](https://support.microsoft.com/en-us/office/linear-format-equations-using-unicodemath-and-latex-in-word-2e00618d-b1fd-49d8-8cb4-8d17f25754f8)
- UnicodeMathML（Noah Doersing 原作，Murray Sargent III 维护的 fork `MurrayIII/UnicodeMathML`）：PEG 语法 → AST → 预处理 → MathML 4.0。输入支持 UnicodeMath、LaTeX、英文口述、Nemeth braille，输出 MathML、LaTeX、speech、Nemeth、Unicode TeX。它含 "autobuildup routines that manipulate the MathML DOM"，支持 MathML → UnicodeMath（build down）、Ctrl+Z/Ctrl+Y 撤销和 markdown-it 集成；MIT 许可（依赖 PEG.js、jQuery 等） — [UnicodeMathML](https://murrayiii.github.io/UnicodeMathML/)；npm `unicodemathml` 1.0.7（2025-10-06） — [npm](https://www.npmjs.com/package/unicodemathml)
- AsciiMath 语法：v（变量/符号）、u（一元：`sqrt`、`text`、`bb` 等）、b（二元：`frac`、`root`、`stackrel`）、S（简单表达式）、I（带上下标）、E（表达式或分数）；`(x+1)/2` 渲染时去掉括号；`lim_(N->oo)`；不可见括号 `(:` `:)`、`{:` `:}`；矩阵 `[[a,b],[c,d]]`；`sin`/`lim` 等无需括号；由 ASCIIMathML.js 或 MathJax 实现 — [asciimath.org](http://asciimath.org/)
- mathup：受 AsciiMath 启发的 MathML 生成器，API 为 `mathup(expression, options)`（选项 `decimalMark`、`colSep`、`rowSep`、`display`、`dir`、`bare`），可输出 MathML 字符串、DOM 或 `<math-up>` 自定义元素；"Mathup only parses and translates them, and let the browser do the rendering" — [runarberg/mathup](https://github.com/runarberg/mathup)；npm 1.0.2（2026-06-24，MIT） — [npm](https://www.npmjs.com/package/mathup)
- 其他 JS 实现：`asciimath2ml` 1.0.8（2025-11-29，MPL-2.0） — [npm](https://www.npmjs.com/package/asciimath2ml)；`asciimath2tex` 1.5.0（2024-04-19，Apache-2.0） — [npm](https://www.npmjs.com/package/asciimath2tex)
- MathLive 自带 `convertAsciiMathToLatex()` 与 `convertLatexToAsciiMath()`，`<math-span>`/`<math-div>` 的 `format` 属性可取 `"latex"`、`"ascii-math"`、`"math-json"` — [Static rendering guide](https://mathlive.io/mathfield/guides/static/)
- MathLive inline shortcut 定义：简单形式 `"pi": "\\pi"`，或带上下文条件的对象 `{ after: "space | letter | digit | symbol | fence", value: "\\in" }`；`after` 可取 `"space"`、`"nothing"`、`"surd"`、`"frac"`、`"function"`、`"letter"`、`"digit"`、`"binop"`、`"relop"`、`"punct"`、`"array"`、`"openfence"`、`"closefence"`、`"text"`；另有 `inlineShortcutTimeout`（毫秒）；`onInlineShortcut()` 可识别 "speed" → `\mathrm{speed}` 这类多字符模式 — [Shortcuts guide](https://mathlive.io/mathfield/guides/shortcuts/)
- MathLive keybinding 形如 `{ key: 'ctrl+alt+shift+[KeyT]', ifMode: 'math', command: ['switchMode', 'text'] }`；insert 模板中 `#@` = 选区或隐式参数、`#?` = `\placeholder{}`（这就是"键入 / 把前一个组变成分子"的机制） — [Shortcuts guide](https://mathlive.io/mathfield/guides/shortcuts/)
- MathLive "smart" 选项：`smartMode` 检测到文本输入时切到 text 模式（例 "if x > 0"）；`smartFence` "Automatically convert parentheses to `\left...\right` markup"；`smartSuperscript` 在上标里键入数字后自动跳出；`removeExtraneousParentheses` 自动去掉分子/分母外多余括号；`scriptDepth` 限制上下标层数；`mathModeSpace` 定义数学模式下空格插入什么；`fractionNavigationOrder` 为 `"numerator-denominator"` 或 `"denominator-numerator"` — [Customizing guide](https://mathlive.io/mathfield/guides/customizing/)
- MathLive 0.99.0：shortcut 转换后立即 Backspace 会撤销转换（#2369）；0.108.0：LaTeX 模式下按空格完成命令并退出；`3.14e2` 自动格式化为 `#1\times10^{#2}` — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- Apple Math Notes（非结构化，识别 + 求值）：在 Notes 中键入表达式后接等号即在行内求解，按 Return 插入结果；用 "名称 = 值" 定义变量，变量必须出现在使用它的表达式之前（左侧或上方），被识别后会变色；修改变量值时，依赖它的结果自动更新 — [Apple Support: Solve math in Notes on Mac](https://support.apple.com/guide/notes/solve-math-apda85974595/mac)（内容来自搜索摘要）。iOS 26 的 "Enter formulas and equations in Notes" 页面描述了三种方式：键入表达式加等号、手写表达式加等号、手写一列数字后在下方画横线求和；形如 `y = 5x + 3` 的方程可插入图像 — [Apple Support](https://support.apple.com/guide/iphone/enter-formulas-and-equations-iphb9c2b948f/ios)（直接抓取只得到目录，内容来自搜索摘要）
- Freeform 在 iPad 上也可以"Solve handwritten math problems on a Freeform board"，Math Results 可选 Insert Results / Suggest Results — [Apple Support (Freeform)](https://support.apple.com/en-me/guide/ipad/ipad7bacf66f/ipados)（搜索摘要）。Apple 的 Pages/Numbers/Keynote 则另外支持 LaTeX 与 MathML 公式输入 — [Apple Support HT5321](https://support.apple.com/kb/HT5321)

### Inferences
- 对 "1/2"、"lim_(x->0) sinx/x"、"int_1^2 (x+1)^2 dx" 这类输入，UnicodeMath 的规则可以直接移植成一个"优先级驱动的增量构建器"：每次按键后，尝试把光标前的最长后缀按 Table 3.1 规约，成功就替换为结构节点并吞掉触发字符。`sinx` 需要一个函数名词典（MathLive 的 inline shortcuts 和 Word 的 Math AutoCorrect 都是词典驱动的）。
- AsciiMath 与 UnicodeMath 的简单分数写法相同（UTN 原文指出），所以 web 笔记组件可以只把"AsciiMath/UnicodeMath 风格的粗糙输入"当作**输入法**，内部模型仍以 LaTeX/atom 树为准。MathLive 就是这么做的（inline shortcuts + `convertAsciiMathToLatex()`）。
- UnicodeMath 需要"撤销构建"的语义：构建后用户可能想回到线性文本。MathLive 0.99 的"Backspace 撤销 shortcut"是同一设计思想。
- Apple Math Notes / Freeform 走的是"手写或线性文本识别 + 按 = 求值"路线，不提供二维结构编辑，也没有公开 API，不能复用。"按 = 求值"这个交互可以用 Compute Engine 在自研组件里叠加实现（`ce.parse(latex).evaluate()`）。

### Gaps
- UTN #28 §4（输入方法）与附录 A 语法的完整细节未逐条摘录；Word 中 "partial build-up" 的精确定义未找到一手来源。
- 未找到 MathLive 内置的"UnicodeMath 输入模式"；MathLive 只有 AsciiMath 转换，没有 UnicodeMath 转换。

## 5. TeXmacs 与 LyX 如何在 TeX 兼容模型上做结构化编辑？对"必须导出精确 LaTeX"的编辑器有何启示？

### Takeaway
两者都不以 LaTeX 为内部模型。TeXmacs 用通用标签树（`frac`/`rsub`/`rsup`），后台用 packrat parser 推导语义，并用 homoglyph 加变体机制消歧；LaTeX 往返靠 "conservative conversion"：用 marker 跟踪源码，未修改的部分回吐原文。LyX 把键入的 LaTeX 命令即时映射为 `InsetMath*` 子类构成的树（根为 `InsetMathHull`，cell 为 `MathData` 即 `MathAtom` 序列），未知命令保留为 `InsetMathUnknown`，结构以外的内容用 ERT/"TeX Code" 原样透传。

启示：要精确导出 LaTeX，可以"以源码为真源 + 区间级重写"，也可以"源码跟踪 + 未改动部分回吐"；两种做法都需要"带/不带跟踪各转换一次再对照"的自检。

### Cited Findings
**TeXmacs**
- "TeXmacs documents are internally represented by trees"：复合树由字符串标签（如 `frac`、`rsub`、`rsup`）和子节点构成；传统 TeXmacs 公式是 presentation oriented 的 — [van der Hoeven, Towards semantic mathematical editing](https://www.texmacs.org/joris/semedit/semedit.html)
- 语义编辑方案："we continue to allow the user to enter formulas in a visually oriented way. In the background, we continuously run a packrat parser, which attempts to convert (potentially incomplete) formulas into content markup"。选择 packrat 语法是因为它有无限前瞻、不需要独立 lexer、可以在文档内局部修改语法；实现上先把 TeXmacs 树序列化为 "enriched ASCII strings" 再解析 — [semedit](https://www.texmacs.org/joris/semedit/semedit.html)
- Homoglyph 与不可见运算符：主要障碍是乘法与函数应用的歧义（如 `a(b+c)`），还有不可见乘号、不可见函数应用、不可见分隔符、不可见括号等；用 Tab 的 "variant mechanism" 消歧（例如 `|` 的 "such that" 与绝对值），并区分 `*`（乘法）与空格（函数应用） — [semedit](https://www.texmacs.org/joris/semedit/semedit.html)
- 语法纠错器按固定顺序应用启发式：不可见标记修正 → 括号匹配 → 大型运算符作用域 → 缺失符号插入（主要用于导入的 LaTeX）。在 8 份真实文档、59,504 个公式上，纠错前后错误数分别为 BPR 2,821 → 705、COL 4,158 → 543、MT 308 → 86；剩余错误 "overwhelming[ly]" 来自缺失、错误或多余的不可见乘号与函数应用 — [semedit](https://www.texmacs.org/joris/semedit/semedit.html)
- Conservative conversion（van der Hoeven & Poulain，2014）：TeX 的语法 "can be modified at run time"，也没有形式文法；当时的 LaTeX→MathML 转换器成功率 "varied between 2% and 54%"。方案是在源文档中插入 punctual/scoped marker："at least, we need to mark all paragraphs"，在公式和宏定义周围标得更细可以提高局部性。未修改的子文档用 `invariant` 标签包住原始源码；源文档带和不带 marker 各转换一次，结果不一致时把相关 marker 列入黑名单；"we are still struggling with conservative conversions of user defined macros and metadata such as title information" — [latexconv](https://www.texmacs.org/joris/latexconv/latexconv.html)
- 手册中的相关选项："Keep track of the LaTeX source code"（"allows TeXmacs to import the LaTeX document with added markup in order to track the original sources"，再导出时 tracked sources "as far as possible, re-used"）、"Ensure transparent tracking"、"Dump TeXmacs document into LaTeX code"（把 TeXmacs 文档以无损方式附在导出的 LaTeX 后）、"Replace unrecognized macros"、"Expand user-defined macros"、"Allow for macro definitions in preamble"。无 LaTeX 对应物的特性包括 left primes、big separators、trees、部分表格特性、复杂用户宏等 — [TeXmacs manual: Compatibility with other formats](https://www.texmacs.org/tmweb/manual/webman-convert.en.html)
- 维护：GitHub 镜像 `texmacs/texmacs` 最近推送 2026-09-24，GPL-3.0，657 stars — [texmacs/texmacs](https://github.com/texmacs/texmacs)（GitHub API）

**LyX**
- 输入：直接键入 `\commandname[optional argument]{required argument}` 即转换（手册称 "much faster to use commands instead of the math toolbar"）；`\frac A↓B` 用 ↓ 进入分母，蓝色框标出参数位置，`B_V`、`B^V` 输入上下标；没有结构支持时用 "Insert ▷ TeX Code"。手册指出 `\cfracleft`/`\cfracright` "are no real LaTeX commands but represent the command `\cfrac[alignment]`… Therefore you cannot use them in TeX code"，即 LyX 内部存在不等同于 LaTeX 的伪命令 — [LyX Math manual](https://elyxer.nongnu.org/lyx/Math.html)
- FAQ：键入 `\text` 后按空格进入文本；`M-m r` 或 `\root` 插入根式框；`\tag{...}` 可用 ERT 放进公式；部分命令需要启用 "Use AMS math" — [LyX wiki FAQ/Math](https://wiki.lyx.org/FAQ/Math)
- 源码结构（来自提交记录）：`MathData ar(buffer_)` 用 `push_back()`/`append()` 存放 `MathAtom` 序列，2024 年的提交强制 `MathData` 构造时传入 `Buffer *` — [lyx-cvs: Force a Buffer * argument to MathData constructor](https://www.mail-archive.com/lyx-cvs@lists.lyx.org/msg27325.html)；`InsetMathHull::insetAllowed()` 按 hull 类型检查允许的 inset — [lyx-cvs: intertext](https://www.mail-archive.com/lyx-cvs@lists.lyx.org/msg30049.html)；`MathFactory.cpp` 对未知命令创建 `MathAtom(new InsetMathUnknown(s))` — [LyX sourcedoc MathFactory.cpp](https://www.lyx.org/sourcedoc/latest/MathFactory_8cpp_source.html)（直接访问返回 404，内容来自搜索摘录）；`src/mathed/InsetMathUnknown.cpp` 仍在维护 — [lyx-cvs](https://www.mail-archive.com/lyx-cvs@lists.lyx.org/msg29780.html)

### Inferences
- 教训 1（真源选择）：TeXmacs 付出大量工程（marker、黑名单、invariant 标签）才得到"部分保真"。笔记组件既然必须导出精确 LaTeX，更简单的做法是让 LaTeX 字符串成为唯一真源，结构树只是带 span 的投影，编辑时只重写被改动节点对应的源码区间。
- 教训 2（未知内容）：LyX 的 `InsetMathUnknown`/ERT 与 MathLive 的 `ErrorAtom` + `verbatimLatex` 说明，不认识的命令必须作为"不透明但原样序列化"的 atom 保留，绝不能丢弃。
- 教训 3（内部伪命令）：LyX 的 `\cfracleft` 表明，为了 UX 发明的内部表示必须在序列化层严格还原为合法 LaTeX；MathLive 的 `\placeholder{}` 同理（可用 `'latex-without-placeholders'` 格式导出）。
- 教训 4（语义层可选）：TeXmacs 的统计显示，"从外观推断语义"即使经过纠错仍残留大量错误。若目标只是精确导出 LaTeX（而不是计算），不应引入不可见乘号/函数应用这类语义层；需要计算时再交给 Compute Engine 解析。
- 教训 5（自检）：借鉴 TeXmacs "带/不带 marker 各转换一次"的做法，保存时校验 `serialize(parse(s)) === s`（对未编辑的公式）；不相等就保留原字符串，不写回规范化结果。

### Gaps
- LyX 的 cursor 模型、LaTeX writer（`WriteStream`/`TeXMathStream`）和 `lib/symbols` 符号表格式，都没有取得可访问的一手源码文档（doxygen 404，gitweb 因 AI 爬虫关闭，镜像地址未找到）。
- TeXmacs 公式级 LaTeX 导出规则（例如 `rsub`/`rsup` 如何输出、宏如何展开）在手册中没有细节。
## 6. 维护状态、许可证、体积、无障碍与移动端；MathLive fork 与 npm 所有权

### Takeaway
截至 2026-09：
- **MathLive**：唯一"活跃维护 + MIT + 完整结构化编辑"的开源 web 方案。最新 0.110.0（2026-06-09），仓库 2026-09-11 仍有推送；bundle 约 822 KB min / 225 KB gzip，另加字体。单人维护、半年一个大版本，因此出现了多个第三方 npm fork；没有发现 npm 包所有权转移的证据。
- **MathQuill**：上游自 2025-06 起无推送，npm 包停在 2022 年；Desmos fork 仍在更新，但没有发布到 npm。
- **Wiris MathType**：集成代码 MIT，编辑器核心是商业服务。
- **ckeditor5-math / TinyMCE Math / Tiptap Mathematics**：都是"LaTeX 文本框 + 渲染器"，不是结构化编辑器。
- **无障碍**：MathLive 功能多，但 2026-09 仍有 axe 违规未修复；MathQuill（Desmos）有受 MathSpeak 启发的屏幕阅读器支持。

### Cited Findings
**MathLive：版本、许可、体积**
- npm `mathlive` 0.110.0（2026-06-09），MIT，maintainers 仅 `arnog <arno@arno.org>`，仓库 `github.com/arnog/mathlive`，`dist.unpackedSize` 5,748,726 字节，依赖 `@cortex-js/compute-engine` 0.58.0 — [npm registry](https://registry.npmjs.org/mathlive)
- 版本节奏：0.104.0（2025-02-08）→ 0.105.0（2025-03-27）→ 0.106.0（2025-07-11）→ 0.107.0（2025-08-17）→ 0.108.0（2025-11-10）→ 0.108.3（2026-02-11）→ 0.109.0（2026-03-11）→ 0.109.2（2026-04-29）→ 0.110.0（2026-06-09） — [npm registry](https://registry.npmjs.org/mathlive)。README 称 "semi-annual cadence with major drops around June and January" — [arnog/mathlive](https://github.com/arnog/mathlive)
- GitHub（API，2026-09-25）：最近推送 2026-09-11，2,163 stars，172 个 open issues+PRs，未归档 — [arnog/mathlive](https://github.com/arnog/mathlive)
- 体积：bundlephobia 测得 822,343 B minified、224,817 B gzip — [bundlephobia](https://bundlephobia.com/package/mathlive@0.110.0)。包内 `mathlive.min.js` 843,724 B、`mathlive.min.mjs` 842,878 B、`mathlive-ssr.min.mjs` 396,585 B，另有 `sounds/*.wav`（如 plonk.wav 71,212 B） — [unpkg](https://unpkg.com/mathlive@0.110.0/)。对照 KaTeX 0.18.9：259,733 B / 76,981 B gzip — [bundlephobia](https://bundlephobia.com/package/katex)
- 字体与声音从 URL 加载：`MathfieldElement.fontsDirectory`（"A URL fragment pointing to the directory containing the fonts necessary to render a formula"）、`MathfieldElement.soundsDirectory` — [MathLive API](https://mathlive.io/mathfield/api/)；SSR 用 `import ... from 'mathlive/ssr'` — [Static rendering guide](https://mathlive.io/mathfield/guides/static/)
- 破坏性变更：0.105.0 把原 `./dist/` 下的文件移到包根目录；0.101.0 移除 `mathVirtualKeyboard.actionKeycap` 等属性，改用 `mathVirtualKeyboard.setKeycap()`；master `[Unreleased]` 移除 `expression`/`"math-json"` 并去掉 Compute Engine 依赖 — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)

**MathLive：无障碍**
- 语音：`MathfieldElement.speechEngine: "amazon" | "local"`、`textToSpeechMarkup: "" | "ssml" | "ssml_step" | "mac"`、`readAloudHook`、`speakHook`；输出格式包括 `'spoken'`、`'spoken-ssml'`、`'spoken-ssml-with-highlighting'`、`'math-ml'` — [MathLive API](https://mathlive.io/mathfield/api/)；[core-types.ts](https://github.com/arnog/mathlive/blob/master/src/public/core-types.ts)
- 0.108.0 的 `<math-span>`/`<math-div>` 会自动生成 ARIA label，提供 MathML fallback 和 `role="img"`，可聚焦时 Space/Enter 朗读；虚拟键盘 keycap 带 `aria-label` 与 `data-keycap-value` — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)
- 未解决的问题：#3081（2026-09-23）指出 shadow DOM 内可聚焦的 `<span role="textbox" class="ML__keyboard-sink">` 没有 accessible name，宿主上的 `aria-label` 不会传递进去，宿主的 `role="math"` 导致 axe 报 nested-interactive；候选修复为 PR #3082 — [arnog/mathlive #3081](https://github.com/arnog/mathlive/issues/3081)。另有 #3073（`.ML__sr-only` 逃出滚动容器，撑高页面）、#1444（NVDA + Firefox 无法输入，2022 起 open）、#2298（屏幕阅读器下无法用空格聚焦） — [issues #3073](https://github.com/arnog/mathlive/issues/3073)、[#1444](https://github.com/arnog/mathlive/issues/1444)、[#2298](https://github.com/arnog/mathlive/issues/2298)

**MathLive：移动端与虚拟键盘**
- `mathVirtualKeyboardPolicy`：`"auto"` 为 "the virtual keyboard is triggered when a mathfield is focused on a touch capable device"；`"manual"` 为 "not triggered automatically"；`"sandboxed"` 为 "displayed in the current browsing context (iframe) if it has a defined container or is the top-level browsing context" — [MathLive API](https://mathlive.io/mathfield/api/)
- 单例 `window.mathVirtualKeyboard`，有 `show()`/`hide()`；预置布局 `numeric`、`symbols`、`alphabetic`、`greek`；支持 Shift、长按变体，工具栏提供 Undo/Redo/Paste/Cut/Copy — [Virtual keyboard guide](https://mathlive.io/mathfield/virtual-keyboard/)
- 0.108.0 起键盘布局自适应（横向/纵向切换），readonly 表达式不能再被虚拟键盘修改（#2476）；0.109.0 修复 toggle 按钮的焦点问题（#2946） — [CHANGELOG](https://github.com/arnog/mathlive/blob/master/CHANGELOG.md)；iPad 物理键盘的 composition 在点击 toggle/keycap 时不确认（#1734，2022-11-28 起 open） — [arnog/mathlive #1734](https://github.com/arnog/mathlive/issues/1734)

**MathLive：fork、npm 所有权与 cortex-js 组织**
- npm `mathlive` 的 maintainers 只有 arnog，repository 仍为个人仓库 `arnog/mathlive`，未发现转移到 `cortex-js` 组织或更换 npm owner 的记录 — [npm registry](https://registry.npmjs.org/mathlive)。`cortex-js` 组织托管 Compute Engine（npm `@cortex-js/compute-engine` 0.134.0，2026-09-24，MIT，maintainer arnog，unpacked 45 MB；仓库 2026-09-25 仍有推送，476 stars） — [npm](https://registry.npmjs.org/@cortex-js/compute-engine)；[cortex-js/compute-engine](https://github.com/cortex-js/compute-engine)。README 把框架指南指向 cortexjs.io，主文档在 mathlive.io — [arnog/mathlive](https://github.com/arnog/mathlive)
- 第三方 fork/republish（npm 元数据）：
  - `@lofcz/mathlive` 0.110.11（2026-09-19，"lofcz fork"）：2026-08-10 起连续发布 0.110.1–0.110.11，GitHub 仓库为 `arnog/mathlive` 的 fork，README 未说明原因 — [npm](https://www.npmjs.com/package/@lofcz/mathlive)；[lofcz/mathlive](https://github.com/lofcz/mathlive)
  - `mathlive-tera` 0.120.10（2026-08-02）：版本号高于上游，repository 字段仍指向 `arnog/mathlive`，依赖旧版 compute-engine 0.30.2 — [npm](https://www.npmjs.com/package/mathlive-tera)
  - `@nagwa-limited/mathlive` 3.3.41（2026-09-10）：源码在 Nagwa 私有 GitLab（"nagwa-mathlive-refactor"），额外依赖 `arabic-reshaper` — [npm](https://www.npmjs.com/package/@nagwa-limited/mathlive)
  - `@gotitinc/mathlive` 0.98.6-hf4（2026-09-14 仍在更新）：基于 0.98 的 hotfix 线 — [npm](https://www.npmjs.com/package/@gotitinc/mathlive)
  - `@iqb/mathlive` 0.4.1（2024-12-16，IQB Berlin） — [npm](https://www.npmjs.com/package/@iqb/mathlive)
  - `mathlive-chemistry` 0.109.2-k12.1（2026-05-22）：让 `\ce{...}` 可编辑（关闭 `captureSelection`），并支持简化的 `\chemfig{...}`，以 SVG 形式放进 MathLive 的 Box 模型 — [npm](https://www.npmjs.com/package/mathlive-chemistry)；[DEV 文章](https://dev.to/latoandroid/i-forked-mathlive-to-make-basic-chemistry-formulas-less-awkward-2pbe)
  - 基于 MathLive 的下游包：`@pie-lib/math-input-mathlive` 1.1.4（2026-09-22，依赖 `mathlive ^0.110.0`） — [npm](https://www.npmjs.com/package/@pie-lib/math-input-mathlive)

**MathQuill 与 Desmos fork**
- npm `mathquill` 0.10.1-a（2022-08-10），MPL-2.0，maintainers `laughinghan`、`wensheng` — [npm registry](https://registry.npmjs.org/mathquill)。GitHub 最近推送 2025-06-02，2,870 stars，405 个 open issues+PRs；README 写 "MathQuill is resuming active development and we're committed to getting things running smoothly."，维护者为 Han、Jeanine、Mary — [mathquill/mathquill](https://github.com/mathquill/mathquill)
- Desmos fork `desmosinc/mathquill`：最近推送 2026-08-07，182 stars，GitHub 未识别出 license（README 称 MPL-2.0）；npm 上不存在 `@desmos/mathquill`（查询返回 404） — [desmosinc/mathquill](https://github.com/desmosinc/mathquill)；`@edtr-io/mathquill` 0.11.0（2023-11-30） — [npm](https://www.npmjs.com/package/@edtr-io/mathquill)
- 无障碍：`.setAriaLabel()`、`.getAriaLabel()`、`.setAriaPostLabel(ariaPostLabel, timeout)`、`.getAriaPostLabel()` — [Api_Methods.md](https://github.com/mathquill/mathquill/blob/master/docs/Api_Methods.md)。Desmos 文档称 Abraham Nemeth 创造的 MathSpeak "inspired the screen reader system in MathQuill"；其 Abraham 库提供 `latexToNemeth`、`nemethToLatex`、`latexToUeb`、`uebToLatex` — [Desmos Abraham docs](https://www.desmos.com/api/v1.8/docs/abraham.html)

**其他方案**
- Wiris MathType：`wiris/html-integrations` 为 CKEditor 4/5、TinyMCE 5–8、Froala 和通用 HTML 提供集成包（MIT），仓库 2026-09-17 仍有推送；npm `@wiris/mathtype-*` 8.15.3（2026-09-17） — [wiris/html-integrations](https://github.com/wiris/html-integrations)；[npm](https://www.npmjs.com/package/@wiris/mathtype-generic)
- ckeditor5-math：npm `@isaul32/ckeditor5-math` 43.2.0（2024-10-14，ISC），仓库最近推送 2025-02-20，99 stars；README 写 KaTeX "Tested with version 0.12.0"、MathJax "latest 2.7" — [npm](https://www.npmjs.com/package/@isaul32/ckeditor5-math)；[isaul32/ckeditor5-math](https://github.com/isaul32/ckeditor5-math)
- TinyMCE Math："This plugin is only available as a paid add-on" — [TinyMCE docs](https://www.tiny.cloud/docs/tinymce/latest/math/)
- `@tiptap/extension-mathematics` 3.31.3（2026-09-04，MIT） — [npm](https://www.npmjs.com/package/@tiptap/extension-mathematics)；`@benrbray/prosemirror-math` 1.0.0（2024-04-14），仓库最近推送 2024-09-24，302 stars — [npm](https://www.npmjs.com/package/@benrbray/prosemirror-math)；[benrbray/prosemirror-math](https://github.com/benrbray/prosemirror-math)
- 线性格式库：`MurrayIII/UnicodeMathML` 最近推送 2026-09-14（39 stars，fork 自 `doersino/UnicodeMathML`）；`runarberg/mathup` 最近推送 2026-09-13 — [MurrayIII/UnicodeMathML](https://github.com/MurrayIII/UnicodeMathML)；[runarberg/mathup](https://github.com/runarberg/mathup)

### Inferences
- 选型：MathLive 是默认选择，但应锁定版本。下一个大版本（按半年节奏推测在 2027 年 1 月前后）会落地 `[Unreleased]` 中的破坏性变更，即移除 `expression`/`"math-json"`。
- fork 大量存在的原因（推断）：上游半年一个大版本、单人维护，教育类企业（GotIt、Nagwa、IQB、PIE）需要自带 hotfix 或 RTL/化学等定制，于是用独立 scope 发布。像 `mathlive-tera` 这种"版本号高于上游、repository 字段却指向上游"的包，有供应链混淆风险，应避免使用。
- 体积：225 KB gzip 加字体，对笔记应用偏重。建议静态显示用 KaTeX（77 KB gzip）或服务端 `mathlive-ssr`，只在进入编辑态时动态 `import('mathlive')`。KaTeX 与 MathLive 的排版可能有细微差异，切换时可能出现布局跳动；用 MathLive 静态渲染可以保持一致，代价是更大的包。
- 无障碍：在 #3082 合并前，嵌入方需要自己处理 accessible name 和 `role="math"` 的问题。

### Gaps
- MathQuill、mathup、unicodemathml、asciimath2ml 的 bundle 体积：bundlephobia 返回 429，未测到。
- MathLive 字体包（woff2）总大小未测。
- iOS/Android 软键盘与 IME 在 MathLive 中的系统性表现缺少文档。
- 关于 "npm package owner situation"：只找到 registry 数据（单一 owner、未转移）和多个 fork；如果协调方指的是某个具体事件（例如包名争议），没有找到来源。
## 7. 嵌入富文本编辑器（ProseMirror/Tiptap、CodeMirror 6、Lexical、Slate）的已知痛点

### Takeaway
已知的痛点有：
- **焦点**：浏览器同一时刻只能聚焦一个元素（Marijn Haverbeke 明确指出），所以 `<math-field>` 获得焦点时宿主编辑器必然失焦。
- **选择与光标**：inline atom 节点在段首、拖拽和光标放置上与 contenteditable 的选择机制冲突，Marijn 建议用无 `src` 的 `<img>` 作"缓冲区"。Chromium 中 inline `<math-field>` 会破坏 ArrowDown 导航。
- **IME**：微软注音 IME 的 composition 会吞掉 `insert()` 刚插入的内容。
- **shadow DOM**：事件被重定向到宿主元素，样式只能通过 CSS 变量和 `::part()` 修改。
- **撤销**：存在两套 undo 栈（MathLive 自带 + 宿主 history），需要协调。

主流富文本编辑器的官方方案（Tiptap Mathematics、prosemirror-math、Lexical EquationNode、ckeditor5-math）都回避了结构化编辑，只做"LaTeX 源码 + 渲染"。

### Cited Findings
**ProseMirror / Tiptap**
- 论坛帖 9021（2026-05-19）：把 `MathfieldElement` 做成 inline NodeView（`inline: true, leaf: true, draggable: true, selectable: true, focusable: true`），通过 `input` 事件用 `setNodeMarkup` 同步。问题是聚焦 MathField 后 ProseMirror 的节点选中/焦点消失。Marijn 回复："Browsers will only focus a single element at a time. So you really cannot, if you focus the MathLive control, keep focus in your ProseMirror editor."，建议用 CSS 模拟视觉焦点，并处理方向键在两个控件间的切换 — [discuss.ProseMirror 9021](https://discuss.prosemirror.net/t/focus-issue-on-mathlive-integration-with-prosemirror/9021)
- 论坛帖 8547（2025-09-04）：inline atomic mathField 不设 `draggable: true` 时，段首节点的选区不可靠（左→右拖选失败，右→左选区排除段首节点）；设为 `true` 后选区可靠，但在 `contenteditable=false` 节点上无法精确放置光标。Marijn："You could try to play with the representation to create a 'buffer zone' around the node's core DOM structure. `<img>` tags without an `src` attribute can be a useful way to create something that counts as a text position but isn't actually text."，提问者确认有效 — [discuss.ProseMirror 8547](https://discuss.prosemirror.net/t/inline-atomic-node-selection-issues-mathlive-integration-with-draggable-property-conflict/8547)
- MathLive #2939（2026-01-18，open）：在 TipTap/ProseMirror 段落中内联 `<math-field>` 时，从其前方文本按 ArrowDown，光标会跳到文档末尾；仅 Chromium 可复现 — [arnog/mathlive #2939](https://github.com/arnog/mathlive/issues/2939)
- MathLive #2579（2025-01-10，已关闭）：连续创建多个 math-field 并 `focus()` 后，所有字段都在闪烁，点击后无法输入 — [arnog/mathlive #2579](https://github.com/arnog/mathlive/issues/2579)。#2102（2023，已关闭）：`user-select` CSS 对 mathfield 无效 — [arnog/mathlive #2102](https://github.com/arnog/mathlive/issues/2102)
- prosemirror-math 的做法：`mathSelectPlugin`、NodeView 的 `selectNode`/`deselectNode`、`stopEvent`、`ignoreMutation`、`mathBackspaceCmd`（边界处的退格）、`mathSerializer`（复制为纯文本时加定界符）、输入规则 `REGEX_INLINE_MATH_DOLLARS` — [benrbray/prosemirror-math](https://github.com/benrbray/prosemirror-math)
- Tiptap 官方 Mathematics 扩展的编辑方式是 `onClick(node, pos)`，默认弹 prompt，文档说 "you can do anything on click, e.g. open a dialog to edit the math node" — [Tiptap docs](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)。Tiptap 相关 issue："Content of nested NodeViews will not render until focus"（#1747，React）、"Performance issue (styles recalculation) on Enter when using custom node views"（#7231） — [tiptap #1747](https://github.com/ueberdosis/tiptap/issues/1747)；[tiptap #7231](https://github.com/ueberdosis/tiptap/issues/7231)

**IME / 输入法**
- MathLive #3058（2026-08-13，open）：Windows + Chrome + Microsoft Bopomofo（注音）IME 下，`mf.insert('\\frac{\\placeholder{}}{\\placeholder{}}', { selectionMode: 'placeholder' })` 之后按下物理键 "3"，期望得到 `\frac{3}{\placeholder{}}`，实际得到 `3`。原因是 `onCompositionStart` 无条件删除当前选区；"No automated test can reproduce this"（程序化输入绕过了 IME） — [arnog/mathlive #3058](https://github.com/arnog/mathlive/issues/3058)
- 早期还有 #555（2020，已关闭）"CJK characters are ignored until input valid keys"；#1734（iPad 物理键盘 composition，open） — [arnog/mathlive #555](https://github.com/arnog/mathlive/issues/555)；[#1734](https://github.com/arnog/mathlive/issues/1734)

**Shadow DOM、事件与样式**
- MathLive 的样式只能通过穿透 shadow DOM 的 CSS 变量（`--primary`、`--caret-color`、`--selection-background-color` 等）和 `::part()`（`content`、`container`、`virtual-keyboard-toggle`、`menu-toggle`）修改 — [Customizing guide](https://mathlive.io/mathfield/guides/customizing/)；#2941（2026-02-01，open）请求暴露更多 parts — [arnog/mathlive #2941](https://github.com/arnog/mathlive/issues/2941)
- 真正接收键盘输入的是 shadow root 内的 `<span role="textbox" class="ML__keyboard-sink">` — [arnog/mathlive #3081](https://github.com/arnog/mathlive/issues/3081)
- 与宿主协作的钩子：`move-out` 事件（方向键或 Tab 在 mathfield 内无处可去时触发，带 `detail.direction`）、`focus-out`、`beforeinput`（可取消）、`input`、`change` — [MathLive API](https://mathlive.io/mathfield/api/)；[Interacting guide](https://mathlive.io/mathfield/guides/interacting/)

**Undo/Redo 协调**
- MathLive 有自己的 `undo`/`redo` 命令，`beforeinput` 会以 `inputType` `"historyUndo"`/`"historyRedo"` 通知；虚拟键盘工具栏也有 Undo/Redo — [Commands guide](https://mathlive.io/mathfield/guides/commands/)；[Interacting guide](https://mathlive.io/mathfield/guides/interacting/)；[Virtual keyboard guide](https://mathlive.io/mathfield/virtual-keyboard/)
- `setValue(..., { silenceNotifications: true })` 可以让宿主回写时不触发 `input` — [Interacting guide](https://mathlive.io/mathfield/guides/interacting/)

**CodeMirror 6 / Lexical / Slate**
- CodeMirror 6：widget decoration 可在内容中插入行内或块级 DOM 元素 — [CodeMirror decoration example](https://codemirror.net/examples/decoration/)。论坛上关于"输入型 widget"的讨论没有给出焦点或撤销方面的技术细节，Marijn 只建议参考 boolean toggle widget 示例 — [discuss.CodeMirror 7690](https://discuss.codemirror.net/t/codemirror-6-input-widgets-implementations/7690)
- Lexical：官方 playground 的 EquationNode 基于 KaTeX；相关问题有 "Block math equation is falsely converted to inline equation on MarkdownShortcutPlugin"（#6936）和 KaTeX 渲染错误处理（#4185） — [facebook/lexical #6936](https://github.com/facebook/lexical/issues/6936)；[#4185](https://github.com/facebook/lexical/issues/4185)；[Discussion #2597](https://github.com/facebook/lexical/discussions/2597)
- 社区集成包：`prosemirror-mathlive` 0.0.6（2024-03-12，仓库最近推送 2024-04-01）、`quill-mathlive-blot` 1.5.0（2020-09-04）、`@yayure/ckeditor5-mathlive` 41.4.0（2024-09-02）、`@naviedu/tinymce-equation-plugin` 1.1.15（2026-09-04，使用 MathLive）、`react-latex-editor` 2.0.7（2026-09-09，基于 TipTap）、`vue3-tiptap-katex` 1.1.31（2024-11-22，使用 mathlive） — [npm search: mathlive](https://www.npmjs.com/search?q=mathlive)

### Inferences
推荐的 ProseMirror/Tiptap 集成架构（据以上痛点推断，未实测）：
1. 节点设计：inline `atom: true` 节点，attrs 为 `{ latex }`。非编辑态只放静态渲染（KaTeX 或 MathLive 静态渲染），不在 DOM 里常驻 `<math-field>`。这样可以避开多字段焦点问题（#2579）、Chromium ArrowDown 问题（#2939）和屏幕阅读器噪音（#3081）。
2. 点击进入编辑：点击时挂载 `<math-field>`，用 `mf.position = mf.getOffsetFromPoint(e.clientX, e.clientY)` 把光标直接放到被点击的子元素（例如 lim 下标里的 0）。
3. 事件隔离：NodeView 的 `stopEvent(e)` 对 `e.composedPath()` 包含该 math-field 的事件返回 `true`，`ignoreMutation()` 返回 `true`。shadow DOM 会把 target 重定向为 `<math-field>`，只能用 `composedPath()` 判断。
4. 退出：监听 `move-out`，按 `detail.direction` 把 ProseMirror 选区设到节点前或后，并 `view.focus()`；Esc 或 blur 时提交。
5. 同步与撤销：编辑会话中的 `input` 事件用 `tr.setNodeMarkup(...)` 同步，并设置 `addToHistory: false`；会话结束时提交一次可撤销的事务。这样宿主 undo 把一次公式编辑视为一步，会话内的逐键撤销交给 MathLive 自己的 history。
6. 选区缓冲：按 Marijn 的建议，在 inline atom 两侧放无 `src` 的 `<img>` 作为可落光标的位置。
7. 源码切换：在节点级别切换 `<math-field>` 与 CodeMirror/textarea（编辑同一个 `latex` attr），切回时用 `validateLatex()` 提示错误。
8. 中文输入：用户群以中文为主，必须实测拼音/注音 IME 与 `insert()`、placeholder 的交互（参考 #3058）。

### Gaps
- 没有找到 Slate 与 MathLive/MathQuill 集成的可靠资料。
- 没有找到 Lexical 或 CodeMirror 6 中嵌入 `<math-field>` 的具体问题报告或最佳实践。
- 缺少移动端（iOS Safari 软键盘 + ProseMirror + MathLive 虚拟键盘）的组合测试报告。
