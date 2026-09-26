# math-notes

AI 辅助的"公式 + 文字"笔记组件。底部输入模糊描述或不精准公式，AI 只产出公式；公式渲染后可直接点进去结构化编辑；将来复用到 learning-oj。

设计与调研在 `docs/`：`docs/design/设计稿.md` 是当前设计（v0.3，七项决策已定），`docs/research/` 是调研报告与六份笔记，`docs/spikes/` 是各轮实测结果。

## 结构

```
packages/core       纯 TS 核心：意图分类、MathLive 适配层、KaTeX 渲染、Tiptap 公式节点、AI 契约与 DeepSeek 适配器
apps/playground     Vite + React 演示与实验台，含 Playwright 回归
spikes/s4-ai-corpus AI 语料评测器（需要你的 DeepSeek 密钥）
docs                设计、调研、spike 结果
```

## 命令

```bash
pnpm install
pnpm dev                                  # 打开 http://localhost:5180，AI 为 mock
DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=... pnpm dev   # 真实 AI，密钥只留在 dev server 里（Claude 预览里用 playground-ai 配置，读 spikes/s4-ai-corpus/.env）
pnpm -r --if-present test                 # 单元测试
pnpm -C apps/playground test:e2e          # Playwright 回归（首次先 pnpm -C apps/playground exec playwright install chromium）
pnpm -r --if-present typecheck
cd spikes/s4-ai-corpus && pnpm eval       # AI 语料评测，密钥读环境变量或该目录的 .env，结果在 results/
```

## 进度

- S0 输入意图分类器：完成，63 例。
- S1 行内编辑三档实测：完成，21 个回归用例通过；结论见 `docs/spikes/S1 行内编辑三档实测.md`。
- S2 IME 矩阵：清单已写，待人工执行。
- S4 AI 语料：完成三轮。deepseek-flash 必须关闭思考（适配器已默认关闭）；开发集 97 条、留出集 75 条各跑三轮全过，歧义暴露 10/10、17/17，完整结果 p50 0.82 s；结论见 `docs/spikes/S4 AI 语料评测.md`。
- 编辑体验：Typora 式 Markdown（光标所在处显示 `##`、`**` 等标记，标题开头退格删空格改级别）、文本模式（点公式变 LaTeX 源码、弹窗实时预览）、选中文字的"转为公式"气泡与整篇一键转公式（都只替换公式描述，AI 只回逐字引文，宿主定位替换）；`\lim` 行内编辑与渲染不一致已修；公式里空格、回车留在公式内，方向键走到头离开。回归 44 个用例（`e2e/s1.spec.ts`、`e2e/editing.spec.ts`、`e2e/markdown.spec.ts`）。
- S3 能力语料、S5 安全语料、S6 性能：未开始。
