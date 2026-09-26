# S4：AI 语料评测

对应设计稿 D6 的契约与 S4 门槛。语料分两套：

- **开发集**（默认）：提示词是对着它调的。
  - `corpus.json`：80 条生成与转换用例。内容有中文描述、英文口述、不精准公式、中英混合、越界请求、非数学，也有作用范围、页面上下文、选中文字转换、多行公式、点名宏包命令、重试提示词。
  - `edit-corpus.json`：17 条选区改写（D8）。
- **留出集**（`SUITE=heldout`）：只用来验证修改能否推广到没见过的输入，不要拿它调提示词。如果在留出集上发现问题并修了，就另写新用例来验证修复。
  - `heldout.json`：64 条生成用例。包括同类歧义的其他表面形式、不该标歧义的对照题、长尾记号、化学式和单位、复杂长公式、边界，以及后来补写的验证用例。
  - `heldout-edit.json`：11 条选区改写。

运行需要你自己的 DeepSeek 密钥。密钥从环境变量读，或者从本目录的 `.env` 读（`.env` 已被 .gitignore 忽略）：

```bash
cd spikes/s4-ai-corpus
printf 'DEEPSEEK_API_KEY=你的密钥\nDEEPSEEK_MODEL=deepseek-flash\n' > .env
pnpm eval                  # 开发集
SUITE=heldout pnpm eval    # 留出集
```

可选环境变量：
- `DEEPSEEK_BASE_URL`：默认 `https://api.deepseek.com`。
- `DEEPSEEK_THINKING`：`disabled` 或 `enabled`；不设时用适配器默认值，即关闭。
- `MAX_TOKENS`：不设时用适配器默认值 1200。
- `CONCURRENCY`：默认 3。
- `FILTER`：按 id 或类别子串筛选，两份语料都生效，例如 `FILTER=scope`。
- `LIMIT`：每份语料只跑前 N 条。

结果写到 `results/<时间戳>.md` 与 `.json`，留出集的文件名带 `-heldout` 后缀。结论见 `docs/spikes/S4 AI 语料评测.md`。

## 语料字段

- `kind`：`generate`（默认）或 `convert`。
- `context`：传给模型的 `MathContext`，例如 `notation`、`surroundingText`。
- `retry`：从这个被拒的回答开始（给出 latex 与报错），用来直接测重试提示词。
- `expect.latex`：期望的主解释。
- `expect.accept`：同一公式的其他写法，例如 `\mathbf{a}` 对 `\vec{a}`。
- `expect.alternatives`：只用于 ambiguous 用例，放其他读法。
- `expect.pattern`：正则，匹配去掉空白后的 LaTeX。给写法太多、没法逐一列出的答案用（多行环境），也给会被规范化抹掉的记号用（`\mathrm{d}`）。和 `latex` 同时给出时，两者都要满足。
- `expect.value`：能求值用例的精确值。
- `expect.features`：越界用例期望的包名。

## 判分

- **生成**：走 `resolveWithRetry`，和宿主的路径一样。KaTeX 拒绝，或输出不可用（截断、JSON 损坏）时，同步门会重问一次；宿主语义检查（`offerKnownReadings`）补上的读法也算在结果里。
  - 期望 ok / ambiguous 的用例：模型要给出公式，主解释与 `latex` 或 `accept` 等价，满足 `pattern`，KaTeX 在行内模式下能渲染。等价判定依次比较规范化字符串、Compute Engine 结构、数值，见 `judge.ts`。
  - ok 和 ambiguous 答反了不算失败，分别计入"歧义未暴露"和"误报歧义"。
  - 期望 ambiguous 时，要答 ambiguous 并给出语料里的某一种读法，才算"歧义被暴露"。模型把另一种读法当成主解释、期望读法放进 alternatives 的，也算通过，`judge` 记为 `model-alt`，单独统计为"歧义主解释一致"。
- **越界**：`status` 为 unsupported，且 `features` 含期望的包名。
- **重试**：统计首轮触发重试的比例，以及重试之后是否通过。`retry` 类用例单独统计"重试提示词"通过率。
- **数值一致**：模型声明的 `consistency.expected` 和 Compute Engine 对返回 LaTeX 的求值，都要对上真值。另外记录宿主的一致性检查能不能运行、有没有误报；Compute Engine 求不出数时跳过。
- **选区改写**：status 与期望一致；答 ok 时，替换片段与期望等价，KaTeX 能渲染。把整条公式都返回的，会在"替换片段等价"这一项失败。
- **延迟**：请求以流式发送，记录首个正文 token 的时间和总耗时。
- 报告开头列出与 few-shot 示例重叠的用例，应当为"无"。

判定为 `unparsed` 的失败，说明 Compute Engine 解析不了其中一方，需要人工看一眼，不一定是模型错。
