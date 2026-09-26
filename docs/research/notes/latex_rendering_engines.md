# LaTeX 数学公式渲染引擎：实现机制、速度与覆盖面（调研笔记，截至 2026-09-25）

> 图例：【旧】= 2024 年以前的信息，可能过时；【摘要】= 只有搜索引擎摘要，原页面打不开，未能核实；【实测】= 本笔记作者 2026-09-25 用 curl 从 CDN、npm registry、GitHub raw 或源码仓库直接测量或 grep 得到（只读取流、没有保存文件、没有执行代码，可以复现）。其余条目都来自所链接的原始页面，基本是意译，项目名、API 名、选项名、错误类型名保留英文。
>
> **版本与维护状态快照（2026-09-25）**
> - KaTeX：MIT。v0.16.0（2022-06-06）→ v0.16.27（2025-12-07）→ v0.17.0（2026-05-22）→ v0.18.0（2026-07-17）→ v0.18.9（2026-09-23），非常活跃 — [npm registry: katex](https://registry.npmjs.org/katex)、[GitHub API](https://api.github.com/repos/KaTeX/KaTeX)
> - MathJax：Apache-2.0。3.0.0（2019-09-04）、3.2.2（2022-06-08）、4.0.0（2025-08-04）、4.1.0（2025-12-16）、4.1.3（2026-07-03），活跃 — [npm registry: mathjax](https://registry.npmjs.org/mathjax)、[GitHub API](https://api.github.com/repos/mathjax/MathJax)
> - Temml（ronkok/Temml）：MIT。0.10.0（2022-12-14）、0.11.0（2025-02-14）、0.13.5（2026-08-28），活跃 — [npm registry: temml](https://registry.npmjs.org/temml)、[GitHub API](https://api.github.com/repos/ronkok/Temml)
> - SwiftLaTeX：AGPL-3.0。最后一个 release 是 v20022022（2022-02-20），最后一次 push 在 2024-06-18，基本停滞 — [GitHub API](https://api.github.com/repos/SwiftLaTeX/SwiftLaTeX)
> - busytex：仓库脚本 MIT（发布的二进制适用 TeX Live 各组件的许可），最后一次 push 在 2026-08-29，活跃 — [GitHub API](https://api.github.com/repos/busytex/busytex)、[README](https://github.com/busytex/busytex)
> - TeXlyre：AGPL-3.0。v0.12.0（2026-09-06），活跃 — [GitHub API](https://api.github.com/repos/TeXlyre/texlyre)
> - drgrice1/tikzjax：最后一次 push 在 2026-06-08（API 没有返回 license）。原版 kisonecat/tikzjax 为 LPPL-1.3c，最后一次 push 在 2024-07-06 — [API drgrice1](https://api.github.com/repos/drgrice1/tikzjax)、[API kisonecat](https://api.github.com/repos/kisonecat/tikzjax)
> - NanoMichael/MicroTeX：MIT，最后一次 push 在 2024-08-06，低活跃 — [GitHub API](https://api.github.com/repos/NanoMichael/MicroTeX)
> - tectonic：最后一次 push 在 2026-08-01（continuous release 2026-07-31）— [GitHub API](https://api.github.com/repos/tectonic-typesetting/tectonic)
> - xenops：MIT。最后一次 push 在 2026-07-30，但作者在 README 里说已无暇维护 — [GitHub API](https://api.github.com/repos/dandavison/xenops)、[README](https://github.com/dandavison/xenops)
> - org-fragtog：MIT。最后一个 release 是 0.4.2（2022-07-14），最后一次 push 在 2023-08-14，稳定但停滞 — [GitHub API](https://api.github.com/repos/io12/org-fragtog)
> - 新 org-latex-preview：GPLv3+（文件头为 GNU Emacs 的 GPL 声明）。**只在 tecosaur 的 fork 的 `dev` 分支上，没有进入任何正式发布的 Org** — [源码](https://code.tecosaur.net/tec/org-mode/src/branch/dev/lisp/org-latex-preview.el)

## Q1：org-latex-preview 怎么做到快？（兼论旧版 org-preview-latex-fragment、xenops、org-fragtog）

### Takeaway
新版 org-latex-preview 由 TEC（tecosaur）和 Karthik Chikmagalur 编写。它的速度来自**摊销**，而不是某个单一技巧：
1. 一个 buffer 里所有待渲染片段写进**同一个 .tex 文件**，每个片段套一层 `preview` 环境，成为 DVI 的一页。
2. preamble 用 `mylatexformat` **dump 成 .fmt**，以 sha1 为键缓存在 `org-persist`，只支持 pdflatex。
3. 用 `org-async-call` 异步起进程，一边读 LaTeX stdout 一边切分出每个片段的错误和几何信息。dvipng 路径用 `--follow` 与 LaTeX **并发**出图。
4. SVG/PNG 按 sha1(处理方式, preamble, 片段, 样式) 缓存。

源码里**找不到常驻（persistent/daemon）TeX 进程**：每个批次都新起进程，启动成本靠 .fmt 压低。**状态更正：到 2026-09，这套系统仍未合入 Org 主线。** Org 9.7 和 9.8 用的都还是旧系统，只做了增量改动。

### Cited Findings
**合入状态（与任务描述里"Org 9.7+"的说法不符）**
- 新系统源码在 `https://code.tecosaur.net/tec/org-mode` 的 `dev` 分支，文件 `lisp/org-latex-preview.el` 共 3354 行。文件头版权年份为 2022-2024，作者署 TEC 与 Karthik Chikmagalur。各 defcustom 标注 `:package-version '(Org . "9.7")`，说明原本打算随 9.7 发布 — [org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)【实测 行数】
- Org 主线（savannah）上请求 `lisp/org-latex-preview.el` 返回 "Not found"。主线 `etc/ORG-NEWS` 顶部是 "Version 10.0 (not released yet)"，这一节里没有 LaTeX preview 重写的条目 — [ORG-NEWS (main)](https://cgit.git.savannah.gnu.org/cgit/emacs/org-mode.git/plain/etc/ORG-NEWS)【实测 grep】
- Org 9.8 发布说明里，LaTeX 预览相关的只有两项：旧系统的 `org-preview-latex-process-alist` 新增了 `xelatex` 进程（经 XDV 出图）；另外新增 `org-link-preview` 框架。没有 `org-latex-preview-mode`、预编译或异步重写 — [Org Release notes](https://orgmode.org/Changes.html)
- GNU ELPA 上 Org 的最新版是 org-9.8.10（2026-08-31）— [ELPA org](https://elpa.gnu.org/packages/org.html)
- Karthik 的安装/排障页要求从 tecosaur fork 的 `dev` 分支安装，并说明合入 Org 之后就不需要这一步 — [abode.karthinks.com/org-latex-preview](https://abode.karthinks.com/org-latex-preview/)
- 2025-08-03，Karthik 在邮件列表发了 "[Pre-Patch] Overhaul of LaTeX preview system: Renaming auto-mode and associated options"，内容是对 draft 版 org-latex-preview.el 的改名提议。可见 2025 年中仍在 pre-patch 阶段 — [mail-archive msg166227](https://www.mail-archive.com/emacs-orgmode@gnu.org/msg166227.html)
- tecosaur 在 GitHub 开了一个仓库，专门跟踪合入前的待办（抓取时有 29 个 open issues）— [tecosaur/org-latex-preview-todos](https://github.com/tecosaur/org-latex-preview-todos)
- 最初的公告 "[Pre-PATCH] Overhaul of the LaTeX preview system" 发布于 2023-03-12。按回帖的引文，宣称的特性包括：批量生成，每秒可处理数百个片段；异步，不阻塞 Emacs；行内预览按字体基线对齐并匹配字号；颜色跟随周围文字和主题；鼠标悬停可查看编译错误。同一回帖（Jun Inoue，2023-05-10）报告了一个 bug：用 XeLaTeX 时，带下伸部的字符（g、j、y）的片段渲染偏小 — [lists.gnu.org 2023-05/msg00207](https://lists.gnu.org/archive/html/emacs-orgmode/2023-05/msg00207.html)（公告原页 [list.orgmode.org](https://list.orgmode.org/orgmode/87lek2up0w.fsf@tec.tecosaur.net/) 抓取时返回 502）

**速度机制 1：多个片段批量进同一个 .tex，一个片段一页**
- `org-latex-preview--create-tex-file` 按顺序把所有片段写进同一个 LaTeX 文件体，每个都包在 `\begin{preview}` … `\end{preview}` 里。`\begin{document}` 之后设置 `\setlength\abovedisplayskip{0pt}`，去掉公式环境前的空白 — [org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)
- preamble 追加 `\usepackage[active,tightpage,auctex,dvips]{preview}`。源码注释对各选项的说明：
  - `tightpage`：把每页收缩到恰好包住片段。
  - `auctex`：在每个 preview 环境的开始和结束处打印伪造的错误信息，专门用来让正则切分 stdout。
  - `dvips`：只有 xelatex 需要，作用是往 XDV 里写入几何数据。
  
  来源同上。
- 页宽由 `org-latex-preview-appearance-options` 的 `:page-width` 决定，默认 0.6，即 `\textwidth` = 0.6`\paperwidth`。完整默认值是 `(:foreground auto :background "Transparent" :scale 1.0 :zoom 1.0 :page-width 0.6 :matchers ("begin" "$1" "$" "$$" "\\(" "\\["))` — 同上

**速度机制 2：把 preamble 预编译成格式文件（format dump）**
- `org-latex-preview-process-alist` 里 dvipng 和 dvisvgm 两个条目的预编译命令都是 `:latex-precompiler ("%l -output-directory %o -ini -jobname=%b \"&%L\" mylatexformat.ltx %f")`。imagemagick 条目改用 `pdftex -output-directory %o -ini -jobname=%b "&pdflatex" mylatexformat.ltx %f` — [org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)
- `org-latex-preview-process-precompile` 默认为 `t`，需要装有 LaTeX 包 mylatexformat — 同上
- 生成 tex 文件时：
  - latex 处理器是 `pdflatex` 且预编译成功：整个 preamble 被替换成一行 `%& <fmt 路径去扩展名>`。
  - 处理器是 `xelatex` 或 `lualatex`：提示不支持预编译。
  - 预编译失败：`display-warning`，并在当前 buffer 里局部关掉预编译。
  
  来源同上。
- `org-latex--precompile`（dev 分支 `ox-latex.el`）的缓存键是 `sha1(preamble ‖ latex-compiler ‖ format-spec 的 %l ‖ ("-temp" 或 default-directory))`，存放在 `org-persist` 的 "LaTeX format file cache" 集合里。`org-latex--precompile-preamble` 用 "mylatexformat" 把 preamble dump 成 `BASEPATH.fmt`，失败时返回 nil 并发出警告 — [ox-latex.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/ox-latex.el)【实测】
- mylatexformat 可以从任意 LaTeX 文件的 preamble 生成格式文件；已 dump 进格式的包加载极快【摘要】— [mylatexformat 文档 (CTAN)](https://ctan.csail.mit.edu/macros/latex2e/contrib/mylatexformat/mylatexformat.pdf)
- 前身思想来自 AUCTeX preview-latex：
  - 首次生成预览时会询问是否缓存 preamble。缓存方式是用 `mylatex.ltx` dump 出格式文件，之后 preamble 一变就自动重新 dump；可以用 `preview-auto-cache-preamble` 设为自动。
  - 生成单个或少量预览时提速最明显。
  - XeLaTeX 完全不能用 preamble 缓存；LuaLaTeX 只有在 preamble 足够简单（不加载 OpenType 字体、不含 Lua 代码）时才行。
  
  【摘要，原页返回 429】— [preview-latex manual: Simple customization](https://www.gnu.org/software/auctex/manual/preview-latex/Simple-customization.html)

**速度机制 3：异步进程链，流式解析 stdout**
- `org-latex-preview--create-image-async` 的源码注释画出了异步调用树：
  - dvisvgm 路径：先编译 tex（stdout 交给 `org-latex-preview--latex-preview-filter`）。不论成功失败，接着抽取图片（stdout 交给 `org-latex-preview--dvisvgm-filter`）。成功后调用 `org-latex-preview--check-all-fragments-produced`（必要时会重跑整棵异步树）并清理临时文件；失败则调用 `org-latex-preview--failure-callback`。
  - dvipng 路径：编译与出图**并行**，dvipng `--follow` 跟随正在写入的 DVI。
  
  实现上，dvipng 时同时发起 `(org-async-call tex-compile-async)` 和 `(org-async-call img-extract-async)`；其他情况只发起编译，出图放在回调里串行 — [org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)【实测 grep】
- 各 filter 持续处理 stdout：
  - latex filter：读取 preview 字号，捕获编译错误，（在 dvipng 场景下）即时更新 overlay。
  - dvisvgm filter：读 SVG 元数据，改颜色，写入 org-persist 或 /tmp 缓存，更新 overlay。
  
  来源同上。
- 命令行：
  - dvipng：`dvipng --follow -D %D -T tight --depth --height -o %B-%%09d.png %f`
  - dvisvgm：运行时拼出 `dvisvgm --page=1- --optimize --clipjoin --relative --no-fonts …`。WebFetch 摘要给出的尾部是 `-v3 --message='processing page {?pageno}...' --bbox=preview -o %B-%%9p.svg %f`。源码开头还会探测 dvisvgm 3.x 的次版本号。
  
  来源同上。
- `org-latex-preview-process-default`：能找到 `dvisvgm` 可执行文件就用 `dvisvgm`，否则用 `dvipng` — 同上
- 源码里 grep "persistent|daemon|server" 只命中 org-persist 缓存的描述，没有常驻 TeX 进程或服务器模式 — 同上【实测 grep】
- 源码专门检查 hyperref：若 preamble 加载了它，就警告它会干扰上报的尺寸信息 — 同上
- 提供 `org-latex-preview-process-finish-functions` 钩子，每批结束时回调，live 预览用它统计耗时 — 同上

**速度机制 4：缓存（哈希键）**
- 片段哈希是 `(sha1 (prin1-to-string (list processing-type preamble string (if svg 'svg (list scale fg)) bg number)))`，也就是：处理方式 + preamble + 片段文本 + 图像类型（PNG 时再加缩放和前景色）+ 背景色 + 公式编号 — [org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)
- `org-latex-preview-cache` 为 `persist` 时走 `org-persist`（`org-persist-read`/`org-persist-register`），否则用临时目录。live 预览单独缓存，上限 `org-latex-preview-live--max-cache-count` = 1024；退出 live 编辑时，把最终图复制进主缓存 — 同上
- Karthik 页面给出的缓存位置示例是 `~/.config/emacs/.local/cache/org-latex/` 和 `.../org/persist/` — [abode.karthinks.com](https://abode.karthinks.com/org-latex-preview/)

**逐片段错误处理**
- 用 preview.sty `auctex` 选项产生的伪错误标记，以正则切分 stdout：
  - 起始标记：`^! Preview: Snippet N started.`
  - 结束标记：`! Preview: Snippet N ended.(H+D x W)`
  - 两者之间的文本就是该片段的错误；先剥掉第一个 "!" 之前的普通日志（LaTeX 错误行一律以 "!" 开头）。
  - 结束标记里的数字配合 `Preview: Tightpage l b r t`，算出 depth、height、width，用于基线对齐。
  
  来源：[org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)【实测】
- 出错片段的显示：左侧 fringe 画一个 `(left-fringe exclamation-mark error)` 感叹号；错误文本以粗体 error face 的 "! " 开头，放进 overlay 的 `help-echo` 作为 tooltip — 同上
- 灾难性失败的恢复：`org-latex-preview--check-all-fragments-produced` 检查每个片段是否都拿到了图片路径。如果输出提前中断，就把"第一个缺图片段的前一个片段"标记为出错，附注说预览生成在这个片段之后崩溃了，然后对剩余片段重新发起整批生成 — 同上【实测】
- 正在处理的片段用 `org-latex-preview-processing-face`（默认 `shadow`）标示（WebFetch 摘要）— 同上

**实时预览（live preview）的调度**
- `org-latex-preview-mode-update-delay` 是 debounce，默认 1 秒；Karthik 的示例配置改成 0.25 — [abode.karthinks.com](https://abode.karthinks.com/org-latex-preview/)
- 节流：`org-latex-preview-live--update-times` 记录最近 3 次预览耗时，`org-latex-preview-mode-update-throttle` 取三者均值，节流间隔因此自适应机器速度。live 预览还支持 `org-edit-special` 打开的 org-src 编辑缓冲区 — [org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)【实测】

**已知坑（Karthik 页面）**
- macOS 上 dvisvgm 的 Ghostscript 配置问题。
- dvisvgm < 3.0 时，显示公式无法居中。
- lualatex 和 xelatex 下不能预编译。
- 新旧 Org 混装会报 "Variable `org-FOO` is void"。

来源：[abode.karthinks.com](https://abode.karthinks.com/org-latex-preview/)
- dvisvgm 处理 TikZ 比 dvipng 好，也是 org-latex-preview 的默认路径【摘要】— [BigEatie: TikZ Images in org-latex-preview](https://bigeatie.com/posts/tikz/)

**旧系统（Org ≤ 9.8 的现行实现）**
- 主线 `org.el` 的默认设置：`org-preview-latex-default-process` 默认 `'dvipng`；`org-preview-latex-image-directory` 默认 `"ltximg/"`；图片文件前缀为 `org-ltximg`。`org-format-latex` 用 `(sha1 (prin1-to-string …))` 生成文件名哈希 — [org.el (main)](https://cgit.git.savannah.gnu.org/cgit/emacs/org-mode.git/plain/lisp/org.el)【实测 grep】
- `org-create-formula-image` 的流程：每个片段各建一个临时 `orgtex*.tex`，内容为 preamble + `\begin{document}` + 片段；然后用 `org-compile-file` 依次跑 latex 和 image converter。`org-compile-file` 内部调用 `shell-command`，是**同步**执行，所以旧系统是"逐片段、同步、每次完整加载 preamble" — [org.el (main)](https://cgit.git.savannah.gnu.org/cgit/emacs/org-mode.git/plain/lisp/org.el)、[org-macs.el (main)](https://cgit.git.savannah.gnu.org/cgit/emacs/org-mode.git/plain/lisp/org-macs.el)【实测】
- Karthik 2022-02-27 的博文：旧 `org-latex-preview` 在中等规模文档上每次首次调用都会让 Emacs 卡住大约一分钟。他写的 `org-auctex` 改用 AUCTeX 的 `preview` 库，作为 drop-in 替代，快得多（文中没有具体数字）【旧】— [Fast Latex previews in Org-mode](https://karthinks.com/software/fast-latex-previews-in-org-mode/)

**xenops（dandavison）**
- 基于 emacs-aio 异步渲染，不打断写作。
- 同时活跃的 latex 任务数上限由 `xenops-math-latex-max-tasks-in-flight` 控制，默认 32。
- 渲染链为 `latex` → DVI → `dvisvgm` → SVG。
- SVG 缓存在 `xenops-cache-directory`（默认 `~/.emacs.d/xenops/cache`）；已有同一内容的图片时不再跑 latex。
- 支持 AUCTeX 的 LaTeX 文档（识别 `TeX-master`）和 org 文档；除数学外也能渲染 table、TikZ 内容。
- 出错时在数学块开头显示黄色警告三角，悬停或右键可以查看诊断；`xenops-doctor` 做环境自检。
- 作者声明目前没有时间维护。

来源：[xenops README](https://github.com/dandavison/xenops)

**org-fragtog（io12）**
- 光标进入 LaTeX 片段时关闭预览，方便编辑；离开时重新开启。它本身只是调用 Org 已有的片段预览功能。
- 启用方式：`(add-hook 'org-mode-hook 'org-fragtog-mode)`。
- 同样的片段语法也可以用在 Markdown 或代码注释里。

来源：[org-fragtog README](https://github.com/io12/org-fragtog)
- 新 org-latex-preview 自带"按光标位置动态显隐 overlay"【摘要】，功能上覆盖了 org-fragtog — [搜索摘要：Pre-PATCH 公告](https://list.orgmode.org/orgmode/87lek2up0w.fsf@tec.tecosaur.net/)

### Inferences
- 快在**吞吐**，不在单片段延迟。一批 N 个片段只起一次 LaTeX 进程、加载一次 .fmt，"每秒数百片段"意味着摊销后每个片段只需几毫秒。但交互编辑单个公式时，延迟下限仍是"起进程 + 读 fmt + dvisvgm"，所以才要 debounce（默认 1 秒）加自适应节流。
- 如果 web 组件要在服务器端或本地后端复刻"真 TeX"这一层，可以直接照搬这套设计：
  - 多片段写进一个文件，每个片段一个 `preview` 页；
  - 用 preview.sty 的 `auctex` 伪错误标记切分日志，得到逐片段错误和 depth/height 基线；
  - preamble 用 mylatexformat dump 成 .fmt，按 sha1 缓存（只对 pdflatex 有效）；
  - SVG 按 sha1(preamble, tex, 样式) 缓存；
  - 某个片段导致后续输出中断时，把它标为坏片段，再重跑剩余片段。
- 任务描述里"persistent LaTeX process"的假设不成立。org-latex-preview 靠的是格式文件加批处理。常驻进程这种模式在 KaTeX 服务端倒是真实存在（Zulip 的 KaTeX server，见 Q7）。

### Gaps
- "每秒数百片段"只是公告里的说法，没找到可复现的基准，也没找到预编译前后的对比数字。
- 新系统何时合入主线（9.9 还是 10.0）没有公开时间表，只能确认 2026-09 时仍未合入。
- xenops 的缓存键由哪些字段组成、错误信息如何解析，没能在源码层面核实。
- 常驻 TeX 进程的其他实现（例如 fork 或快照 TeX 进程状态的做法）不在本次核实范围内。

## Q2：KaTeX 的解析/构建流程、选项、ParseError、覆盖面与速度

### Takeaway
KaTeX 是**同步**渲染器，流程为：自带的 Lexer 和宏展开 → Parser 生成 parse tree → buildHTML / buildMathML 生成 DOM 树。布局使用构建期生成的字体度量表，不需要测量 DOM，也不会引起页面回流，因此单式延迟低，服务端和客户端输出一致。错误通过 `katex.ParseError` 暴露，带 `position`、`length`、`rawMessage`，可以精确定位。2026 年进入 0.17、0.18 系列，有两次破坏性变更：内部 `__defineFunction` API 和 CSS 类名前缀。

### Cited Findings
**实现与定位**
- 官网的说法：同步渲染，不需要让页面回流；布局基于 Knuth 的 TeX；没有依赖；在任何环境下输出相同，因此可以用 Node.js 预渲染成纯 HTML — [katex.org](https://katex.org/)
- 源码模块：`src/Lexer.ts`、`src/MacroExpander.ts`、`src/Parser.ts`、`src/buildTree.ts`、`src/buildHTML.ts`、`src/buildMathML.ts`、`src/domTree.ts`、`src/fontMetrics.ts`、`src/fontMetricsData.js`。其中 `fontMetricsData.js` 的文件头注明由 `buildMetrics.sh` 生成、不可手改，说明度量是构建期预计算的 — [KaTeX src/fontMetricsData.js](https://raw.githubusercontent.com/KaTeX/KaTeX/main/src/fontMetricsData.js)【实测：以上文件在 main 分支均返回 200】
- MathJax 维护者 Davide Cervone（2020）的对比：KaTeX 直接实现 TeXbook Appendix G 的排版规则，不做格式转换；MathJax 则先把所有输入转成内部 MathML 再输出【旧】— [mathjax-users: Are MathJax and KaTeX competitors?](https://groups.google.com/g/mathjax-users/c/aboJLMb50uQ/m/Y77FexF_AwAJ)

**渲染选项（官方文档）**
- `displayMode`：默认 false。
- `output`：取 `html`、`mathml` 或 `htmlAndMathml`，默认 `htmlAndMathml`。
- `leqno`、`fleqn`。
- `throwOnError`：默认 true，遇到不支持的命令或非法 LaTeX 时抛 `ParseError`。
- `errorColor`：默认 `#cc0000`。
- `macros`：对象，值可以是字符串、函数或 expansion 对象。
- `minRuleThickness`、`colorIsTextColor`。
- `maxSize`：默认 Infinity。
- `maxExpand`：默认 1000，防止宏无限展开。
- `strict`：默认 `"warn"`，可取 `false`/`"ignore"`、`true`/`"error"`，或者函数 `(errorCode, errorMsg, token)`。errorCode 包括 `"unknownSymbol"`、`"unicodeTextInMathMode"`、`"mathVsTextUnits"`、`"commentAtEnd"`、`"htmlExtension"`、`"newLineInDisplayMode"`。
- `trust`：默认 false，也可以是函数，参数 context 含 `command`、`url`、`protocol`，以及 `class`、`id`、`style`、`attributes` 等。
- `globalGroup`：默认 false；为 true 时，顶层 `\def`、`\newcommand` 定义的宏会写回 `macros` 参数。

来源：[KaTeX Options](https://katex.org/docs/options)

**错误报告**
- 文档规定：出错时抛 `katex.ParseError`。错误消息里包含 LaTeX 源码，插入 DOM 前必须转义 `& < >`。`throwOnError:false` 时，渲染为 LaTeX 源码，悬停提示错误信息 — [KaTeX Handling Errors](https://katex.org/docs/error)
- `ParseError` 源码：
  - 属性：`name = "ParseError"`；`position` 取 token 的 `loc.start`（0 基）；`length` = `loc.end - loc.start`；`rawMessage` 是不含上下文的原始消息。
  - `message` 格式为 `KaTeX parse error: <msg> at position <start+1>: <上下文>`（1 基），错误在末尾时为 ` at end of input: `。
  - 上下文取出错处前后各最多 15 个字符，超出部分用 "…"，出错段用组合下划线字符标出。
  
  来源：[src/ParseError.ts](https://raw.githubusercontent.com/KaTeX/KaTeX/main/src/ParseError.ts)
- `renderError` 的实现：若 `throwOnError` 为真，或者异常**不是** `ParseError`，都原样抛出；否则生成 `<span class="katex-error" title="{error.toString()}" style="color:{errorColor}">原始表达式</span>`。也就是说，`throwOnError:false` 只兜住 ParseError — [katex.mjs 0.18.9](https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.mjs)【实测】

**覆盖面**
- 支持的环境：
  - 矩阵：`matrix`、`pmatrix`、`bmatrix`、`vmatrix`、`Vmatrix`、`Bmatrix`、`smallmatrix`，以及带可选列对齐参数的 `matrix*` 等变体。
  - `array`、`subarray`。
  - `cases`、`rcases`、`dcases`、`drcases`。
  - `gathered`、`aligned`、`alignedat`。
  - 需要 display 模式的：`equation`、`equation*`、`split`、`align`、`align*`、`gather`、`gather*`、`alignat`、`alignat*`、`CD`。
  - `array` 不支持 `\cline` 和 `\multicolumn`。
  
  来源：[KaTeX Supported Functions](https://katex.org/docs/supported)
- 宏：支持 `\def`、`\gdef`、`\edef`、`\xdef`、`\let`、`\futurelet`、`\newcommand`、`\renewcommand`、`\providecommand`，最多 9 个参数。`\gdef`、`\xdef`、`\global\def` 等全局定义会跨公式保留 — 同上
- HTML 扩展命令 `\href`、`\url`、`\includegraphics`、`\htmlId`、`\htmlClass`、`\htmlStyle`、`\htmlData` 默认禁用（显示为红色命令名），需要 `trust` 放行 — 同上
- 在 katex.mjs 0.18.9 中 grep：找不到 `"\\label"`、`"\\ref"`、`"\\eqref"`、`"\\multicolumn"`、`"\\cline"`、`"\\pdv"`、`"\\dv"`、`"\\ce"`、`prooftree`、`xymatrix`、`multline` 的定义；找得到 `"\\bra"`、`"\\ket"` 和环境名 `"CD"`。由此判断：没有 physics 包、没有 bussproofs、没有 xy-pic、没有 `multline`、不支持 `\label`/`\ref`；mhchem 以独立 contrib 文件提供 — [katex.mjs 0.18.9](https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.mjs)【实测 grep】
- mhchem 扩展文件 `dist/contrib/mhchem.min.js`：33,706 B 原始 / 8,392 B gzip — [jsDelivr](https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/contrib/mhchem.min.js)【实测】

**近期版本变化（CHANGELOG）**
- 0.17.0（2026-05-22）：破坏性变更，内部 `__defineFunction` 不再把属性包在 `props` 里（为性能做的重构，避免解构）。
- 0.18.0（2026-07-17）：破坏性变更，内部 CSS 类名加前缀，针对内部类写的自定义样式或白名单都要改。
- 新增命令：0.18.7 加入 `\reflectbox`、`\mapsfrom`；0.16.42 加入 `\underbracket`、`\overbracket`；0.16.24 支持带 alpha 的十六进制颜色；0.16.16 提供 ESM 导出和 TS 类型；0.16.15 加入 `\mathsfit`；0.16.14 加入 `\dddot`、`\ddddot`；0.16.11 加入 `\emph`。

来源：[KaTeX CHANGELOG](https://raw.githubusercontent.com/KaTeX/KaTeX/main/CHANGELOG.md)

**体积（v0.18.9，jsDelivr）【实测】**
- `katex.min.js`：272,755 B 原始 / 75,887 B gzip。
- `katex.min.css`：24,788 B / 3,509 B。
- `dist/fonts/` 下 woff2 共 20 个文件，合计 259,792 B（例如 `KaTeX_Main-Regular.woff2` 为 26,272 B），实际按用到的字形懒加载。

来源：[katex.min.js](https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.min.js)、[jsDelivr 文件清单 API](https://data.jsdelivr.com/v1/package/npm/katex@0.18.9)

**速度**
- Cervone（2020-05-02）：在配置可比的情况下，MathJax v3 的处理速度约比 KaTeX 慢 2.7 倍；他还指出，不少速度对比漏算了 MathJax 的动态加载开销【旧】— [mathjax-users 讨论](https://groups.google.com/g/mathjax-users/c/aboJLMb50uQ/m/Y77FexF_AwAJ)
- 一个含 611 个公式的页面：MathJax 2.7.1 处理约 4 秒（整页加载 17 秒）；MathJax 3.1 只比 KaTeX 略慢。这是录屏定性对比，没有给 KaTeX 的毫秒数【旧】— [bourne2learn 对比](https://bourne2learn.com/math/svgmath/comparison-svgmath-katex-mathjax.php)

### Inferences
- 在可编辑公式组件里，`ParseError.position` 和 `length` 可以直接映射成编辑器里的错误高亮区间。注意 `position` 是 0 基，而 message 里显示的是 1 基。
- 容错设计：用 `strict` 函数收集非标准写法的告警；外层始终保留 try/catch，因为 `throwOnError:false` 兜不住非 ParseError 异常。
- 笔记级 `\newcommand`：让所有公式共用同一个 `macros` 对象，并打开 `globalGroup` 或使用 `\gdef`，即可在多个公式间共享宏。
- 0.18 改了 CSS 类名前缀，自定义主题要跟着改。

### Gaps
- 没有找到 2024–2026 年的独立基准，没有 KaTeX 0.18 的单式毫秒级延迟数据。本次也没有在本地执行下载的代码做基准测试。
- 渲染管线最后一步（domTree 的 `toMarkup`/`toNode`）的具体实现，没有逐行核实。

## Q3：MathJax 3/4 的架构、懒排版、TeX 扩展包、错误处理与速度

### Takeaway
MathJax 的结构是：input jax（TeX/MathML/AsciiMath）→ 内部 MathML 树 → output jax（CHTML/SVG）。它是 JS 渲染器里覆盖面最广的：physics、mhchem、amscd、bussproofs、mathtools、empheq、action 等都有扩展，但没有 TikZ，xy-pic 只有第三方扩展。错误用 `merror` 节点内联显示，`TexError` **不带源码位置**。默认组件里预装了 `noundefined`，未定义宏会以红色宏名显示，而不是报错。v4（4.0.0 发布于 2025-08-04）带来自动换行、默认字体改为 mathjax-newcm、ES 模块和 `@mathjax/*` 包。tex-chtml 组件约 281 KB（gzip）。

### Cited Findings
**版本与 v4 变化**
- 发布时间：4.0.0 为 2025-08-04，4.1.0 为 2025-12-16，4.1.3 为 2026-07-03，许可证 Apache-2.0 — [npm registry: mathjax](https://registry.npmjs.org/mathjax)、[GitHub API](https://api.github.com/repos/mathjax/MathJax)
- 4.0.0 发布说明的要点：
  - 新增 11 套字体，新默认字体的字符覆盖面大得多；
  - 行内公式和显示公式都支持自动换行；
  - 语音生成移到 web worker 以提升性能；
  - 新增 TeX 扩展，包括从 v2 移植并增强的 `begingroup`，以及几个字体相关扩展；
  - 同时提供 ES6 模块和 CommonJS 模块；
  - 支持在 TeX 和 MathML 里嵌入 HTML；
  - 更新了 mathtools，改进 CHTML 的基线对齐和可伸缩分隔符，增加更多基于 Promise 的转换调用。
  
  来源：[MathJax 4.0.0 release](https://github.com/mathjax/MathJax/releases/tag/4.0.0)
- What's new 页：npm 改用 `@mathjax` 作用域包；expression explorer 默认开启；破坏性变更包括移除 `AllPackages` 等 — [What's New in MathJax v4.0](https://docs.mathjax.org/en/latest/upgrading/whats-new-4.0.html)
- 4.x 后续版本：4.1.0 支持 dark-mode 配色，对话框可移动和缩放；4.1.2 修正 `\large`、`\tiny` 等字号，并提供兼容包 `fontsizev3`；4.1.3 修复 SRE 和语义增强在大表达式上可能死循环的问题 — [MathJax releases](https://github.com/mathjax/MathJax/releases)
- v4 组件 `tex-chtml.js` 内引用的字体包是 `mathjax-newcm-font` — [tex-chtml.js 4.1.3](https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-chtml.js)【实测 grep】

**架构**
- Cervone 的说明：MathJax 接受 TeX、MathML、AsciiMath 输入，输出 HTML、SVG、MathML；所有输入先转成 MathML 再渲染，多一次转换，换来格式灵活性【旧】— [mathjax-users 讨论](https://groups.google.com/g/mathjax-users/c/aboJLMb50uQ/m/Y77FexF_AwAJ)

**TeX 扩展与自动加载**
- 扩展列表（docs latest）：action、ams、amscd、autoload、bbm、bboldx、bbox、begingroup、boldsymbol、braket、bussproofs、cancel、cases、centernot、color、colortbl、colorv2、configmacros、dsfont、empheq、enclose、extpfeil、fontsizev3、gensymb、html、mathtools、mhchem、newcommand、noerrors、noundefined、physics、require、setoptions、tagformat、texhtml、textcomp、textmacros、unicode、units、upgreek、verb。
- 没有移植到当前版本的：autobold、autoload-all、mediawiki-texvc。
- 列表里没有 xypic，也没有 tikz。

来源：[MathJax TeX Extensions](https://docs.mathjax.org/en/latest/input/tex/extensions/index.html)
- 自动加载：`autoload` 扩展存在于除 `input/tex-base` 外所有含 TeX 输入的组件里。首次遇到下列宏或环境时会加载对应包：
  - amscd：`CD` 环境；bussproofs：`prooftree` 环境；
  - mhchem：`\ce`、`\pu`；
  - action：`\toggle`、`\mathtip`、`\texttip`；
  - braket：`\bra`、`\ket`、`\braket` 等；
  - cancel：`\cancel` 等；
  - color：`\color`、`\definecolor` 等；
  - html：`\href`、`\class`、`\style`、`\cssId`、`\data`；
  - newcommand：`\newcommand`、`\renewcommand`、`\newenvironment`、`\def`、`\let` 等；
  - 另有 unicode、verb、extpfeil、enclose、bbox、boldsymbol。
  
  **不会**自动加载、必须显式加载的包：ams、bbm、bboldx、begingroup、cases、centernot、colortbl、dsfont、empheq、mathtools、physics、require、setoptions、textcomp、textmacros、units、upgreek — [MathJax autoload](https://docs.mathjax.org/en/latest/input/tex/extensions/autoload.html)
- TeX input 选项：
  - `packages`：默认 `['base']`；
  - `inlineMath`：默认只有 `\(...\)`，**不含 `$...$`**；
  - `displayMath`：默认 `$$...$$` 和 `\[...\]`；
  - `processEscapes`、`processEnvironments`、`processRefs`：默认 true；
  - `tags`：默认 `'none'`，可设 `'ams'` 或 `'all'`；
  - `maxBuffer`：默认 `5 * 1024`，限制处理中的字符串长度，防止递归定义无限膨胀；
  - `formatError`：默认 `(jax, err) => jax.formatError(err)`，返回表示错误的内部 MathML 树。
  
  来源：[MathJax TeX Input Options](https://docs.mathjax.org/en/latest/options/input/tex.html)

**错误处理**
- 默认 `formatError` 的实现（`ts/input/tex.ts`）：取 `err.message` 的第一行，用 nodeFactory 创建 `'error'` 节点（即 `merror`），带上 `err.id` 和原始 LaTeX（`this.latex`）— [MathJax-src ts/input/tex.ts](https://raw.githubusercontent.com/mathjax/MathJax-src/master/ts/input/tex.ts)【实测】
- `TexError` 的构造函数是 `constructor(public id: string, message: string, ...rest: string[])`，只有 `id` 和 `message`，**不记录源码位置或偏移**；消息里的 `%n`、`%{n}` 占位符用参数替换 — [MathJax-src TexError.ts](https://raw.githubusercontent.com/mathjax/MathJax-src/master/ts/input/tex/TexError.ts)
- `noerrors`：不显示错误信息，改为在 `merror` 里显示原始 TeX。v2 的组合配置默认包含它；v3 起必须显式加载 — [MathJax noerrors](https://docs.mathjax.org/en/latest/input/tex/extensions/noerrors.html)
- `noundefined`：未定义的控制序列显示成宏名本身，不报错。例如 `$X_{\xyz}$` 的下标会显示红色的 `\xyz`。除 `input/tex-base` 外的所有 TeX 组件都**预装**了它。可配置 `color`（默认 'red'）、`background`、`size` — [MathJax noundefined](https://docs.mathjax.org/en/latest/input/tex/extensions/noundefined.html)

**懒排版**
- 启用方式：`loader: {load: ['ui/lazy']}`。
- 只在表达式进入视口时才排版。之前的表达式会先经过 TeX 处理但不输出，以保证宏定义和自动编号正确。
- 选项：`lazyMargin`（默认 '200px'）、`lazyAlwaysTypeset`。
- 用 SVG 输出效果最好，CHTML 也差不多快；`\ref`/`\eqref` 的前向引用可能失效。

来源：[MathJax Lazy Typesetting](https://docs.mathjax.org/en/latest/output/lazy.html)

**体积（jsDelivr）【实测】**
- 4.1.3：
  - `tex-chtml.js`：997,445 B 原始 / 281,185 B gzip（字体另行加载）；
  - `tex-mml-chtml.js`：997,558 B / 281,170 B；
  - `tex-svg.js`：1,849,625 B / 614,935 B（SVG 字形数据打包在内）。
- 3.2.2 `es5/`：
  - `tex-chtml.js`：1,160,989 B / 262,041 B；
  - `tex-svg.js`：2,108,580 B / 676,356 B。

来源：[tex-chtml.js 4.1.3](https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-chtml.js)、[tex-svg.js 4.1.3](https://cdn.jsdelivr.net/npm/mathjax@4.1.3/tex-svg.js)、[tex-chtml.js 3.2.2](https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js)

**xy-pic（第三方）**
- XyJax-v3：基本兼容 Xy-pic 的 MathJax v3 扩展，要求 MathJax 3.1.4+，支持 CHTML 和 SVG；无障碍功能不可用；作者称仍在开发中；许可证 Apache-2.0。README 没有提到 v4 — [sonoisa/XyJax-v3](https://github.com/sonoisa/XyJax-v3)

**速度**
- Cervone（2020）：v3 约比 KaTeX 慢 2.7 倍，但比 v2 大幅提升【旧】— [mathjax-users 讨论](https://groups.google.com/g/mathjax-users/c/aboJLMb50uQ/m/Y77FexF_AwAJ)
- v4 发布说明里唯一明确的性能项，是把语音生成移到 web worker，没有给出排版速度数据 — [MathJax 4.0.0 release](https://github.com/mathjax/MathJax/releases/tag/4.0.0)

### Inferences
- MathJax 的错误只有 `id` 和消息文本，没有位置。编辑器要做错误高亮，得靠自己的预解析（例如先用 KaTeX 或 Temml 解析一遍拿到 position），或者从消息里提取出错的宏名再去源码里搜。
- 默认预装的 `noundefined` 会把未知宏"吞掉"成红字，公式不会整体失败。所以若要把 MathJax 当作回退检测器，必须检查输出里有没有 `merror` 或 noundefined 节点，或者把 noundefined 从包列表里去掉。
- 体积对比：MathJax tex-chtml 约 281 KB gzip，KaTeX JS 约 76 KB gzip 加 CSS 和按需字体。在"KaTeX/Temml 优先、MathJax 回退"的分层方案里，应该**懒加载** MathJax。

### Gaps
- v4 相对 v3 和 KaTeX 的单式渲染耗时没有公开基准。
- v4 字体包 mathjax-newcm 的 woff2 总体积没有测量。
- XyJax 能否在 v4 上使用没有核实。
- ams 包里 `multline` 等环境的具体列表没有逐项核实。

## Q4：Temml（LaTeX → MathML）

### Takeaway
Temml 出自 KaTeX 系的代码（本笔记对照发现，两者的 `ParseError`、`renderError` 代码结构和错误消息格式几乎一致；"KaTeX fork"这一说法本次只在二手资料里见到），只输出 MathML，排版全部交给浏览器的 MathML Core。它是三者中最轻的：`temml.min.js` 约 50 KB gzip，覆盖面介于 KaTeX 和 MathJax 之间，内置 `\label`/`\ref`/`\eqref`、`multline`、`CD`，physics 和 mhchem 以扩展提供。**默认 `throwOnError:false`**，出错时把"原表达式 + 错误信息"作为文本放进 `span.temml-error`。到 2026 年，Chrome/Edge 109+、Firefox、Safari 都支持 MathML（caniuse 全球 95.17%）。

### Cited Findings
- 基本情况：v0.13.5，MIT；把 LaTeX 转成 MathML；在支持 MathML 的 Chrome、Edge、Firefox、Safari 中可用，永远不支持 IE — [Temml Administration](https://temml.org/docs/en/administration.html)
- 安装文件：浏览器端最少需要 `temml.min.js`、`Temml-Local.css` 和 `Temml.woff2`（字体必须与 CSS 放在同一目录）；服务端使用 `temml.cjs` 或 `temml.mjs` — 同上
- API：
  - `temml.render(texString, domElement, options)`、`temml.renderToString`；
  - `renderMathInElement`：自动渲染，默认定界符含 `$$…$$`、`\(…\)`、`\[…\]` 以及 AMS 环境，可用 `fences` 预设或 `delimiters` 数组自定义；
  - `temml.postProcess(element)`：实现 `\ref`、`\eqref`；
  - `temml.definePreamble(texString)`：定义文档级宏；
  - `temml.version`。
  
  来源同上。
- 选项：`displayMode`、`macros`、`annotate`（生成含 TeX 源码的 `<annotation>`）、`throwOnError`、`errorColor`、`strict`、`trust`、`maxSize`（[em, pt] 二元组）、`maxExpand`（默认 1000）、`wrap`（`"none"`/`"tex"`/`"="` 三种软换行模式）、`xml`、`leqno`、`colorIsTextColor` — 同上
- 源码里的默认值和错误行为【实测】：
  - 默认值：`throwOnError = deflt(options, "throwOnError", false)`，`errorColor = "#b22222"`。
  - 若 `throwOnError` 为真或异常不是 `ParseError`，原样抛出；否则生成 `new Span(["temml-error"], [TextNode(expression + "\n\n" + error.toString())])`。
  - 数学模式下出现非法命令时，会 `console.log("Temml parse error: Command … is invalid in math mode.")`。
  - `ParseError` 设置 `self.name = "ParseError"` 和 `self.position = start`；message 同样是 `at position N:`（1 基）或 `at end of input:` 格式。前 80 行里没找到 `length` 和 `rawMessage`。
  
  来源：[temml.mjs 0.13.5](https://cdn.jsdelivr.net/npm/temml@0.13.5/dist/temml.mjs)
- 扩展：`copy-tex`、`mhchem`、`physics`、`texvc`（Wikimedia 的函数）；服务端构建默认已包含 mhchem、physics、texvc — [Temml Administration](https://temml.org/docs/en/administration.html)
- 在 `temml.mjs` 中 grep 到 `"\\ce"`、`"\\pdv"`、`"\\dv"`、`"\\bra"`、`"\\ket"`、`"\\label"`、`"\\ref"`、`"\\eqref"`，以及环境名 `CD`、`multline`；没有 `prooftree` 和 `xymatrix` — [temml.mjs 0.13.5](https://cdn.jsdelivr.net/npm/temml@0.13.5/dist/temml.mjs)【实测 grep】
- 字体：
  - 推荐 Latin Modern；
  - 另有 Asana、Libertinus、NotoSans Math 可选；
  - `Temml-Local.css` 使用系统字体（Cambria Math、STIX TWO、NotoSans Math），但可伸缩箭头显示有问题。
  
  来源：[Temml Administration](https://temml.org/docs/en/administration.html)
- 体积（jsDelivr）【实测】：
  - `temml.min.js`：168,222 B 原始 / 49,710 B gzip；
  - `dist/Temml.woff2`：9,404 B（体积很小，推测是补充字形子集，不是完整数学字体，未核实）；
  - `contrib/mhchem/mhchem.min.js`：34,762 B / 8,234 B。
  
  来源：[temml.min.js](https://cdn.jsdelivr.net/npm/temml@0.13.5/dist/temml.min.js)
- 浏览器支持（caniuse）：Chrome 109+、Edge 109+、Firefox 2+、Safari 10+、Opera 95+、Samsung Internet 21+，全球 95.17%。Chrome 24 曾短暂支持，后因不稳定移除 — [caniuse MathML](https://caniuse.com/mathml)
- 官方对比页只比较 MathML 输出，对象是 Temml 0.13.02、MathJax 4.0、KaTeX 0.16.27、TeXZilla 1.0.2.0：
  - mhchem 在各家都需要扩展；
  - `\newcommand` 在 Temml 和 MathJax 完整支持；
  - `{CD}` 只有 Temml 和 MathJax 部分支持。这一点与 KaTeX 文档列出 `CD` 冲突，推测该页只评价了 KaTeX 的 MathML 输出；
  - KaTeX 缺 `{multline}`，与本笔记 grep 结果一致。
  
  来源：[Temml comparison](https://temml.org/docs/en/comparison.html)；另见 [KaTeX Supported](https://katex.org/docs/supported)
- 规模化的 MathML-first 部署：MediaWiki Math 扩展的 `'native'` 模式（MediaWiki 1.40+）在服务端用 PHP 由 LaTeX 生成 MathML，**没有图片回退**，只有浏览器支持 MathML 时才能正确显示 — [Extension:Math](https://www.mediawiki.org/wiki/Extension:Math)

### Inferences
- Temml 把布局交给浏览器，因此 JS 最小、转换最快。代价是渲染质量取决于各浏览器的 MathML Core 实现和数学字体，跨浏览器一致性不如 KaTeX 的 HTML/CSS 输出。
- 做可编辑组件时，应显式设 `throwOnError:true` 并捕获 `ParseError` 取得 `position`，否则默认行为会把错误文本直接渲染出来。
- Temml 的 `annotate` 选项能把 TeX 源码嵌进 MathML，适合"渲染结果可以反向取回源码"的编辑场景。

### Gaps
- Chromium 和 WebKit 对 MathML Core 各元素的支持差异（如 `menclose`、`mlabeledtr`、可伸缩运算符）没有深入核实。
- 没有 Temml 的渲染速度基准。

## Q5：浏览器内的真 TeX（WASM）与 C++/Rust 数学排版移植

### Takeaway
到 2026 年仍然活跃的方案：
- **busytex**：把 TeX Live 2026 的多个二进制编进一个 WASM，WASM 约 32 MB，数据包 90–400 MB，缓存在 IndexedDB。
- **TeXlyre**：本地优先的编辑器，集成了 SwiftLaTeX、BusyTeX 和 Typst.ts。
- **drgrice1/tikzjax**：只处理 TikZ → SVG，用 WASM 版 e-TeX 加预载格式，含 tikz-cd 和 pgfplots，是图表类内容最实用的"中间层"。

SwiftLaTeX 在 2022 年以后基本停更。tectonic 没有官方浏览器版（只有 Go/wazero 的 WASI 封装 tecgonic）。数学专用的非 TeX 排版引擎有 MicroTeX（C++，低活跃）和 RaTeX（Rust，2026 新项目，WASM 加原生平台，对标 KaTeX）。

### Cited Findings
**完整 TeX 引擎**
- SwiftLaTeX：
  - XeTeX 和 PdfTeX 编译为 WASM，推荐 XeTeX；
  - LaTeX 文件按需从 CTAN 或 `https://texlive.swiftlatex.com` 拉取，也可以自建 Texlive-Ondemand；
  - API 为 `PdfTeXEngine`、`loadEngine()`、`writeMemFSFile()`、`compileLaTeX()`，最后一个返回 PDF 和编译 log；
  - 许可证 AGPL-3.0。
  
  来源：[SwiftLaTeX README](https://github.com/SwiftLaTeX/SwiftLaTeX)
- busytex：
  - 单个 WASM 里包含 `xetex, pdftex, luahbtex, bibtex8, xdvipdfmx, kpsewhich, kpsestat, kpseaccess, kpsereadlink, makeindex`；
  - TeX Live 以数据包形式提供，如 `texlive-basic.data`、`ubuntu-texlive-latex-extra.data`、`ubuntu-texlive-latex-recommended.data`、`ubuntu-texlive-science.data`；
  - 浏览器端组件为 `busytex_pipeline.js`、`busytex_worker.js`（Web Worker）、`busytex.wasm`、`busytex.js`；
  - MIT 只覆盖仓库里的脚本，不覆盖发布的二进制。
  
  来源：[busytex README](https://github.com/busytex/busytex)
- texlyre-busytex：
  - 提供 TeX Live 2026（01.03.26）的 BusyTeX API，支持 XeLaTeX（+bibtex8+dvipdfmx）、PdfLaTeX、LuaLaTeX（LuaHBTeX）；
  - **WASM 文件约 32 MB，数据 90–400 MB**；
  - 通过 Emscripten 的 `EM_PRELOAD_CACHE`（IndexedDB）让已下载的 `.data` 包在刷新后仍然可用；
  - 许可证 AGPL-3.0，派生自 BusyTeX（MIT）。
  
  来源：[TeXlyre/texlyre-busytex](https://github.com/TeXlyre/texlyre-busytex)
- TeXlyre：
  - 浏览器内 WASM 引擎有 SwiftLaTeX（pdfTeX/XeTeX/LuaTeX）、BusyTeX（TeX Live 2026）、Typst.ts；
  - 两个包下载服务器：TeX Live 2020 用基于 SwiftLaTeX 的 on-demand 服务器，TeX Live 2026 用自建服务器；
  - React 前端配 Yjs 文档，存放在 IndexedDB，离线优先，WebRTC 协作；
  - 有专门的 LaTeX/Typst 日志处理器；
  - 许可证 AGPL-3.0，由 NLnet NGI0 Commons Fund 资助。
  
  来源：[TeXlyre README](https://github.com/TeXlyre/texlyre)
- tecgonic：
  - 一个 Go 库，把 Tectonic 的 fork 编译到 `wasm32-wasip1`，用 wazero 运行；
  - bundle（Tectonic 默认 TeX Live bundle v33）以 tar 形式下载；
  - 基准（AMD Ryzen 9 6900HX）：`BenchmarkNew/NoCache` 1360 ms/op，`WithCache` 51 ms/op。这测的是 WASM 模块编译/实例化，不是 LaTeX 编译；
  - v0.2.1（2026-09-04），MIT，文档没有提到浏览器。
  
  来源：[pkg.go.dev tecgonic](https://pkg.go.dev/github.com/mgilbir/tecgonic)
- tectonic 上游在 2026 年仍然活跃，但搜索只找到 tecgonic 和 busytex、SwiftLaTeX 这些相关项目，没找到官方浏览器 WASM 构建 — [GitHub API](https://api.github.com/repos/tectonic-typesetting/tectonic)；[搜索结果](https://github.com/TeXlyre/texlyre-busytex)

**TikZ 专用：TikZJax**
- drgrice1/tikzjax：
  - 把 TeX 的 Pascal 源码编译成 WASM，预载 LaTeX 格式，再执行包含 TikZ 的 preamble；
  - PGF 的 SVG 驱动配合 `drgrice1/dvi2html`，把 DVI 转成 SVG，全程在浏览器内；
  - 可用的包包括 `amsbsy`、`amsfonts`、`amsgen`、`amsmath`、`amsopn`、`amssymb`、`amstext`、`array`、`etoolbox`、`hf-tikz`、`pgfplots`、`tikz-3dplot`、`tikz-cd`、`xparse`；除 external 这类在此场景没有意义的库外，所有已知 TikZ 库都可用；
  - 每个 `text/tikz` script 只在首次出现时运行 TeX，之后缓存 SVG；
  - 用 `data-tex-packages`（JSON）加载包，`data-show-console="true"` 显示 TeX 控制台输出。
  
  来源：[drgrice1/tikzjax](https://github.com/drgrice1/tikzjax)
- tikzjax.com 上原版的 `tikzjax.js` 为 458,758 B（content-length）；wasm 和 core dump 文件用哈希命名，测量请求只返回 263 B 的响应，没能测到大小 — [tikzjax.js](https://tikzjax.com/v1/tikzjax.js)【实测】
- Obsidian TikZJax 插件：
  - 打包了 drgrice1 的 fork，可离线渲染 `tikz` 代码块，要求写 `\usepackage{}` 和 `\begin{document}`…`\end{document}`，文档类是 `standalone`；
  - 内置 chemfig、tikz-cd、circuitikz、pgfplots、array、amsmath、amsfonts、amssymb、tikz-3dplot；
  - MIT，703 stars，88 个 open issues。
  
  来源：[artisticat1/obsidian-tikzjax](https://github.com/artisticat1/obsidian-tikzjax)

**数学专用的排版移植（不是完整 TeX）**
- MicroTeX：
  - C++ 可嵌入的 LaTeX 数学渲染库，支持 `\newcommand` 和数组、矩阵等环境；
  - 后端有 Cairo/GTK、GDI+、Qt，另有 Android 版；使用自定义的 `.clm` 字体格式；
  - README 的 TODO 里列着 "webassembly"，也就是主线没有官方 WASM；
  - MIT（`res` 目录下的字体资源另有许可）；最后一次 push 在 2024-08。
  
  来源：[MicroTeX README](https://github.com/NanoMichael/MicroTeX)
- RaTeX：
  - 一个 Rust 核心完成词法、语法、布局和 display list 生成，后端可以是 CoreGraphics、Android Canvas、Flutter Canvas、Canvas 2D、tiny-skia 或自定义；
  - Web 端通过 WASM/npm 使用；
  - 目标是尽量贴近 KaTeX，用版本化的 golden case 对比语法覆盖、布局和参考图，支持表以 KaTeX 0.16.45 为基准；
  - 覆盖 `\ce`/`\pu` 和 proof tree；
  - MIT，仓库 github.com/erweixin/RaTeX，页面版权 2026。
  
  来源：[ratex.lites.dev](https://ratex.lites.dev/)

**错误回传**
- SwiftLaTeX 的 `compileLaTeX()` 返回编译 log（以及 PDF）— [SwiftLaTeX README](https://github.com/SwiftLaTeX/SwiftLaTeX)
- TikZJax 通过 `data-show-console` 显示 TeX 控制台输出 — [drgrice1/tikzjax](https://github.com/drgrice1/tikzjax)
- TeXlyre 有 LaTeX 日志解析和可视化 — [TeXlyre README](https://github.com/TeXlyre/texlyre)

这类引擎只返回 TeX 原生 log，逐公式错误要自己解析。

### Inferences
- 完整 TeX 的浏览器方案要下载几十到几百 MB（BusyTeX 约 32 MB WASM，数据至少 90 MB），对笔记组件的首屏来说不可接受。它只适合作为**懒加载的可选第三层**，配合 IndexedDB 持久缓存。
- 冷启动的 WASM 实例化本身就可能超过 1 秒。依据是 tecgonic 在原生 wazero 下未缓存时 1360 ms/op；这个数字不是浏览器实测，只作量级参考。
- SwiftLaTeX 和 busytex 输出 PDF（busytex 的二进制列表里只有 `xdvipdfmx`，没有 `dvisvgm`），要嵌进笔记还得经过 pdf.js 或转 SVG。TikZJax 直接输出 SVG，更适合内嵌图表。
- 在浏览器里复刻 org-latex-preview 的做法（把多个片段放进 preview 页、用 `--bbox=preview` 取 SVG），需要一个带 dvisvgm 的 WASM TeX。本次调研没有发现现成项目。

### Gaps
- SwiftLaTeX、busytex、TikZJax 在浏览器里的首次编译和后续编译延迟，都没有找到可靠数据。
- TikZJax 的 wasm 和 core dump 实际体积没能测到。
- RaTeX 的 WASM 体积、性能和成熟度没有核实。
- MicroTeX 的 openmath 等分支是否有 WASM 构建没有核实。

## Q6：各方案的覆盖边界（学生、科研常用构造）

### Takeaway
三个 JS 渲染器都能处理 amsmath 常规环境、`\newcommand` 和 `amscd` 的 `CD`，mhchem 都要扩展。各自的差异：
- physics：MathJax 和 Temml 支持，KaTeX 不支持。
- bussproofs：只有 MathJax 支持。
- `\label`/`\ref`：KaTeX 不支持。
- `multline`：KaTeX 不支持。
- `\multicolumn`/`\cline`：KaTeX 的 array 不支持。

**tikz-cd、TikZ/pgfplots、chemfig、xymatrix 超出所有 JS 渲染器的能力**（xymatrix 只有 MathJax 3 的第三方 XyJax），必须交给 TikZJax 或真 TeX。

### Cited Findings
覆盖矩阵（✓ 支持；✗ 不支持；ext = 需要额外扩展；? = 未核实）：

| 构造 | KaTeX 0.18 | MathJax 4 | Temml 0.13 | TikZJax (drgrice1) | 真 TeX（org-latex-preview / 服务器 / busytex） |
|---|---|---|---|---|---|
| align / cases / matrix 系列 | ✓（align 等需 display） | ✓（ams） | ✓ | amsmath 可用 | ✓ |
| multline | ✗ | ? | ✓ | – | ✓ |
| `\label` / `\ref` / `\eqref` | ✗ | ✓（`tags`/`processRefs`） | ✓（`postProcess`） | – | ✓ |
| array 中的 `\multicolumn` / `\cline` | ✗ | ? | ? | – | ✓ |
| `\newcommand` / `\def` | ✓ | ✓（newcommand 自动加载） | ✓ | ✓ | ✓ |
| physics（`\dv`、`\pdv`） | ✗（`\bra`/`\ket` 内置） | ext（physics，需显式加载） | ext（physics） | – | ✓ |
| mhchem（`\ce`、`\pu`） | ext（contrib） | ✓（自动加载） | ext（mhchem） | – | ✓ |
| amscd `CD` | ✓ | ✓（自动加载） | ✓（MathML 输出仅部分支持） | – | ✓ |
| tikz-cd | ✗ | ✗ | ✗ | ✓ | ✓ |
| xymatrix（xy-pic） | ✗ | 第三方 XyJax-v3（MathJax 3.1.4+） | ✗ | 不在包列表里 | ✓ |
| bussproofs `prooftree` | ✗ | ✓（自动加载） | ✗ | – | ✓ |
| chemfig | ✗ | ✗ | ✗ | Obsidian 插件内置 | ✓ |
| TikZ / pgfplots | ✗ | ✗ | ✗ | ✓ | ✓ |
| `\href` / `\includegraphics` | 需 `trust` | html 扩展（自动加载） | 需 `trust` | – | ✓ |
| `\toggle` / `\mathtip` / `\texttip` | ✗ | ✓（action 自动加载） | ? | – | – |

各单元格的来源：
- KaTeX 的环境与限制：[KaTeX Supported](https://katex.org/docs/supported)；KaTeX 缺失项靠 grep：[katex.mjs 0.18.9](https://cdn.jsdelivr.net/npm/katex@0.18.9/dist/katex.mjs)【实测】
- MathJax 的自动加载与非自动加载：[MathJax autoload](https://docs.mathjax.org/en/latest/input/tex/extensions/autoload.html)；扩展列表（无 xypic/tikz）：[MathJax TeX Extensions](https://docs.mathjax.org/en/latest/input/tex/extensions/index.html)；`tags`/`processRefs`：[MathJax TeX Input Options](https://docs.mathjax.org/en/latest/options/input/tex.html)
- Temml 的扩展与 `postProcess`：[Temml Administration](https://temml.org/docs/en/administration.html)；Temml 的 grep：[temml.mjs 0.13.5](https://cdn.jsdelivr.net/npm/temml@0.13.5/dist/temml.mjs)【实测】；CD 在 MathML 输出下的支持：[Temml comparison](https://temml.org/docs/en/comparison.html)
- TikZJax 的包列表：[drgrice1/tikzjax](https://github.com/drgrice1/tikzjax)；chemfig：[obsidian-tikzjax](https://github.com/artisticat1/obsidian-tikzjax)
- XyJax：[sonoisa/XyJax-v3](https://github.com/sonoisa/XyJax-v3)
- 用户因为 `\toggle`、`\mathtip`、`\texttip` 等 MathJax 独有命令，在 MyST（只用 KaTeX）请求 MathJax 支持（2025-11-16）— [mystmd #2442](https://github.com/jupyter-book/mystmd/issues/2442)

**真 TeX 路径的限制**
- org-latex-preview 用 hyperref 会干扰尺寸信息：[org-latex-preview.el @ dev](https://code.tecosaur.net/tec/org-mode/raw/branch/dev/lisp/org-latex-preview.el)
- 预编译只支持 pdflatex：同上
- TikZ 走 dvisvgm 更好【摘要】：[BigEatie](https://bigeatie.com/posts/tikz/)

**非 TeX 移植**
- RaTeX 声称覆盖 `\ce`、`\pu` 和 proof tree — [ratex.lites.dev](https://ratex.lites.dev/)

### Inferences
- 学生和科研笔记里最常"撞墙"的依次是：交换图（tikz-cd 和 xymatrix；`CD` 只能画简单的方形图）、TikZ/pgfplots 图、chemfig 结构式、bussproofs 证明树、physics 宏、`\label`/`\eqref` 交叉引用。
- 分层建议：前五类属于"图"。Tier-1 用 KaTeX 或 Temml 处理公式，同时预注册常用的 physics 宏（例如用 `macros` 模拟 `\dv`、`\pdv`），可以覆盖大部分行内和块公式。physics、bussproofs 回退到 MathJax；tikz-cd、TikZ、chemfig 直接送 TikZJax 或服务器 TeX。

### Gaps
- MathJax 对 `multline`、`\multicolumn` 的支持，Temml 对 `\multicolumn` 和 action 宏的支持，都没有逐一核实。
- 没有找到"真实笔记语料里各构造出现频率"的统计数据。

## Q7：混合/分层策略的真实实现

### Takeaway
真实项目里的分层形态有四种：
1. **编辑时轻量渲染，产出时真 TeX**：Overleaf 编辑器用 MathJax 4 预览，PDF 由服务器 TeX 编译。
2. **校验 + 服务端 MathML + 客户端 MathJax**：MediaWiki Math。
3. **由用户按需选择层级**：Anki（MathJax 或本地 LaTeX 图片）、Obsidian（MathJax + TikZJax 插件）。
4. **KaTeX 优先，失败时回退 MathJax**：intmath，未能核实原文。

服务端 KaTeX 的性能关键是**常驻进程**（Zulip 的 KaTeX server），平台还会加渲染配额（GitLab）。

### Cited Findings
- **Overleaf**：
  - `services/web/package.json` 依赖 `"mathjax": "^4.1.2"` 和 `"katex": "^0.16.28"`；
  - `load-mathjax.ts` 配置 MathJax：加载 `ui/safe`；在包列表里禁用 `require`（防止加载被禁用的包）和 `textmacros`（v4 默认加载的文本宏）；上下文菜单里禁用 "Math Renderer" 选项，因为只提供 SVG；
  - 另有 `visual-widgets/math.ts`，负责可视化编辑器里的公式小部件。
  - PDF 在服务器端用真 TeX 编译，这是 Overleaf 的公开架构常识，本次没有单独取证。
  
  来源：[overleaf package.json](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/package.json)、[load-mathjax.ts](https://raw.githubusercontent.com/overleaf/overleaf/main/services/web/frontend/js/features/mathjax/load-mathjax.ts)【实测】
  - Overleaf 博客：Rich Text 编辑器更名为 Visual Editor，编辑器内可预览数学符号【摘要】— [Overleaf blog: Visual Editor](https://www.overleaf.com/blog/tagged/Visual%20Editor)
- **MediaWiki Math 扩展**：
  - 输入用 texvc/texvcjs 白名单校验；
  - `'native'` 模式（MW 1.40+）在服务端由 PHP 生成 MathML，没有图片回退；
  - `'mathjax'` 模式（MW 1.42+）类似 native，但在客户端用 MathJax 3 渲染，照顾不支持 MathML 的浏览器；
  - `'mathml'`（Mathoid）是遗留方案：在服务端用 MathJax 把 texvc 输入转成 MathML+SVG，已停止开发，将逐步淘汰，让位于 native；
  - `'png'` 只到 MW ≤1.39；`'source'` 模式不渲染，只输出源码；
  - 渲染结果缓存，可用 `?action=purge&mathpurge=true` 强制重渲；
  - 错误归入两个追踪分类：语法错误进 "Pages with math errors"，渲染管线的临时失败进 "Pages with math render errors"；
  - 页面最后更新于 2026-08-13。
  
  来源：[Extension:Math](https://www.mediawiki.org/wiki/Extension:Math)
- **Anki**：
  - 两种方式并存。MathJax 在浏览器端渲染，定界符 `\(…\)`、`\[…\]`，推荐多数用户使用。
  - LaTeX 方式用标签 `[latex]…[/latex]`、`[$]…[/$]`、`[$$]…[/$$]`，调用本地 LaTeX 加 dvipng 或 dvisvgm 生成图片，缓存在媒体文件夹里以便跨设备同步；preamble 可以按笔记类型修改。
  - 官方警告：LaTeX 代码可能读写本机文件，建议 MathJax 不够用时才用 LaTeX。
  
  来源：[Anki Manual: Math & Symbols](https://docs.ankiweb.net/math.html)
- **Obsidian**：公式用 MathJax 和 LaTeX 语法，官方把可用包指向 MathJax 扩展列表；TikZ 通过社区插件 obsidian-tikzjax（WASM TeX）渲染 — [Obsidian Help: Advanced syntax](https://obsidian.md/help/advanced-syntax)、[obsidian-tikzjax](https://github.com/artisticat1/obsidian-tikzjax)
- **Zulip**：有一个独立的 KaTeX 渲染服务，设置项为 `katex_server` 和 `katex_server_port`（默认 9700）。关掉它能省少量内存，但公式渲染会明显变慢，一条消息里有几十个公式时甚至可能发送失败 — [Zulip system configuration](https://zulip.readthedocs.io/en/latest/production/system-configuration.html)
- **GitLab**：
  - 用 KaTeX 渲染；为防滥用，只渲染前 1000 个行内公式；块公式数量按渲染时间限制，超出的部分以纯文本显示；群组或自托管实例可以关闭这个限制 — [GitLab Markdown docs](https://docs.gitlab.com/user/markdown/)
  - 历史上 `maxExpand` 设为 20，后来改成 1000；前端另有 `MAX_MATH_CHARS` 和 `MAX_RENDER_TIME_MS` 两个限制；超限时每个块要点 "Display anyway"【摘要】— [GitLab MR !111107](https://gitlab.com/gitlab-org/gitlab/-/merge_requests/111107)、[GitLab issue #334557](https://gitlab.com/gitlab-org/gitlab/-/issues/334557)
- **KaTeX 优先 + MathJax 回退**：intmath 的做法是先用 KaTeX 渲染，KaTeX 处理不了的再交给 MathJax；KaTeX 的公式先出现，MathJax 的随后补上【摘要，原页 403】— [intmath: KaTeX with ASCIIMathML input and MathJax fallback](https://www.intmath.com/blog/mathematics/katex-with-asciimathml-input-and-mathjax-fallback-9456)
- **MyST (mystmd)**：HTML 构建只支持 KaTeX（转换代码在 `packages/myst-transforms/src/math.ts`）；2025-11-16 有人提 issue 请求把 MathJax 作为备选，抓取时维护者尚未回应 — [mystmd #2442](https://github.com/jupyter-book/mystmd/issues/2442)
- **Emacs 生态**：org-auctex 用 AUCTeX preview 替代 Org 旧预览【旧】— [karthinks.com](https://karthinks.com/software/fast-latex-previews-in-org-mode/)；新 org-latex-preview 本身只有真 TeX 一层（见 Q1）

### Inferences
以下是根据上文证据推导出的、面向"个人笔记 + 可编辑公式 web 组件"的分层设计：

- **Tier 0 缓存**：键为 `sha1(引擎版本, 笔记级 preamble 或宏表, 公式源码, displayMode, 主题色)`，思路借自 org-latex-preview 的哈希键。
- **Tier 1 同步快速层**：用 KaTeX（HTML 输出，约 76 KB gzip JS 加按需字体）或 Temml（MathML，约 50 KB gzip）。
  - 设 `throwOnError:true`，用 `ParseError.position/length` 做编辑器内的错误下划线；
  - 用 `strict` 函数收集不规范写法；
  - 笔记级 `\newcommand` 通过共享的 `macros` 对象实现。
- **Tier 2 覆盖层**：MathJax 4 懒加载（tex-chtml 约 281 KB gzip，或 tex-svg 约 615 KB gzip）。触发条件有两种：
  - ParseError 属于"未知命令或环境"，而不是语法错误；
  - 静态扫描命中 physics、bussproofs、`\label`/`\eqref`、`multline` 等已知 KaTeX 缺口。
  
  这里要去掉 `noundefined`，否则无法判定失败；并且只能用消息文本定位错误。
- **Tier 3 真 TeX 层**：命中 `\begin{tikzcd}`、`\begin{tikzpicture}`、`\xymatrix`、`\chemfig` 等时：
  - 本地优先的方案：送 TikZJax（浏览器 WASM，首次运行后缓存 SVG）；
  - 允许后端的方案：送服务器 TeX，照搬 org-latex-preview 的做法（批处理进 preview 页 + mylatexformat .fmt + `auctex` 伪错误标记切分逐片段错误 + dvisvgm `--bbox=preview` 出 SVG + 按 sha1 缓存）；
  - 服务端 JS 渲染要用常驻进程（Zulip 的教训）。
- **防滥用和性能配额**：参考 GitLab，限制字符数、每页公式数和累计渲染时间；参考 KaTeX 的 `maxExpand` 和 MathJax 的 `maxBuffer`。

### Gaps
- 没有找到公开的"KaTeX 失败后回退 MathJax"的比例或延迟数据；intmath 原文打不开。
- Overleaf 前端里 KaTeX 依赖的具体用途没有核实。
- 未找到开源笔记产品（Logseq、Joplin、Zettlr 等）实现"JS 渲染器 → 服务器 TeX"自动回退的实例。本次调研只确认了 Anki 和 Obsidian 这类由用户手动选择层级的模式。
