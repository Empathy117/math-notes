/**
 * S4: run the AI corpora against a live model and score them.
 *
 *   pnpm eval        # DEEPSEEK_API_KEY / DEEPSEEK_MODEL from the environment or ./.env
 *
 * corpus.json holds generate / convert cases (design doc D6), edit-corpus.json selection
 * rewrites (D8). SUITE=heldout runs heldout.json and heldout-edit.json instead: cases written
 * after the prompt was tuned on the dev corpus and never used for tuning, to check that fixes
 * generalize. Optional: DEEPSEEK_BASE_URL (default https://api.deepseek.com),
 * DEEPSEEK_THINKING (disabled | enabled; unset = the adapter default, disabled), MAX_TOKENS,
 * CONCURRENCY (3), FILTER (substring of id or category), LIMIT (first N cases of each corpus).
 *
 * Generate cases go through resolveWithRetry, the sync gate's one retry on a KaTeX rejection,
 * which is also the host's path. Scoring:
 * - Formula cases (expected ok / ambiguous): the model answers with a formula whose primary
 *   LaTeX is equivalent to the expected one or an accepted spelling (normalized string, Compute
 *   Engine structure, or numeric value), matches `pattern` when given, and renders in KaTeX.
 *   Answering ok where ambiguous was expected, or the reverse, is not a failure; it is counted
 *   as unexposed or false ambiguity.
 * - Ambiguity exposed: status ambiguous, and one of the expected other readings is offered.
 * - Unsupported cases: status unsupported and features name the expected package.
 * - Retry: the first answer failed KaTeX and was sent back once. `retry` cases instead start
 *   from a given rejected answer, to test the retry prompt itself.
 * - Numeric consistency, for cases with a known value: the model's claimed value and Compute
 *   Engine's value of the returned LaTeX against the truth, plus what the host's own check
 *   (value of the LaTeX vs the claimed value) would report.
 * - Edit cases: status as expected; for ok, the replacement fragment is equivalent to the
 *   expected one and renders.
 *
 * Requests are streamed so the time to the first answer token can be recorded; the stream is
 * reassembled into the non-streaming response the adapter parses.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  buildGenerateMessages,
  createDeepSeekResolver,
  parseModelJson,
  resolveWithRetry,
  type MathContext,
  type MathEditResult,
  type MathResolver,
  type MathResult,
} from '@math-notes/core/ai';
import { renderKatex } from '@math-notes/core/render';
import { close, equivalent, equivalentToAny, matchesPattern, numeric, type Judgment } from './judge';

interface Expect {
  latex?: string;
  /** Other spellings of the same formula, e.g. \mathbf{a} for \vec{a}. */
  accept?: string[];
  /** Ambiguous cases only: the other readings the model should offer. */
  alternatives?: string[];
  features?: string[];
  /** Exact value, for cases that evaluate to a number. */
  value?: string;
  /** Regex the LaTeX, whitespace removed, must match (see judge.ts). */
  pattern?: string;
}

interface Case {
  id: string;
  category: string;
  kind?: 'generate' | 'convert';
  input: string;
  context?: MathContext;
  /** Start from this rejected answer, to test the retry prompt itself. */
  retry?: { latex: string; message: string };
  expect: Expect & { status: MathResult['status'] };
}

interface EditCase {
  id: string;
  category: string;
  instruction: string;
  fullLatex: string;
  selectionLatex: string;
  expect: Expect & { status: MathEditResult['status'] };
}

interface Numeric {
  claimed: string | null;
  /** The model's claimed value equals the known value; null if it claimed none. */
  claimedOk: boolean | null;
  /** Compute Engine's value of the returned LaTeX equals the known value; null if it gives no number. */
  evaluatedOk: boolean | null;
  /** What the host's consistency check would say (value of the LaTeX vs claimed); null if it cannot run. */
  hostCheck: boolean | null;
}

interface Wire {
  firstTokenMs: number | null;
  finishReason: string | null;
  completionTokens: number | null;
}

interface Timing extends Wire {
  latencyMs: number;
  /** The model returned parseable JSON. */
  jsonOk: boolean;
}

interface Outcome extends Timing {
  id: string;
  category: string;
  input: string;
  expect: Case['expect'];
  got: Omit<MathResult, 'raw'> | { error: string };
  /** The case started from a given rejected answer (tests the retry prompt itself). */
  fromRetry: boolean;
  /** The first answer the renderer rejected, which was sent back once. */
  retried: { latex: string; message: string } | null;
  statusExact: boolean;
  /** Right kind of answer: a formula for formula cases, unsupported with the feature, not_math. */
  statusOk: boolean;
  latexOk: boolean | null;
  judge: string;
  rendersOk: boolean | null;
  katexWarnings: string[];
  ambiguityExposed: boolean | null;
  falseAmbiguity: boolean | null;
  numeric: Numeric | null;
  pass: boolean;
}

interface EditOutcome extends Timing {
  id: string;
  category: string;
  instruction: string;
  expect: EditCase['expect'];
  got: Omit<MathEditResult, 'raw'> | { error: string };
  statusOk: boolean;
  latexOk: boolean | null;
  judge: string;
  rendersOk: boolean | null;
  pass: boolean;
}

interface StreamChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { completion_tokens?: number };
}

const apiKey = process.env['DEEPSEEK_API_KEY'];
if (!apiKey) {
  console.error('DEEPSEEK_API_KEY is not set. Put it in spikes/s4-ai-corpus/.env or run: DEEPSEEK_API_KEY=... pnpm eval');
  process.exit(2);
}
const model = process.env['DEEPSEEK_MODEL'] ?? 'deepseek-flash';
const baseUrl = process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com';
const thinking = process.env['DEEPSEEK_THINKING'];
const maxTokens = Number(process.env['MAX_TOKENS'] ?? 0);
const concurrency = Number(process.env['CONCURRENCY'] ?? 3);
const filter = process.env['FILTER'];
const limit = Number(process.env['LIMIT'] ?? 0);
const suite = process.env['SUITE'] === 'heldout' ? 'heldout' : 'dev';
const corpusFiles =
  suite === 'heldout' ? { generate: './heldout.json', edit: './heldout-edit.json' } : { generate: './corpus.json', edit: './edit-corpus.json' };

/** The host inserts from the input box inline by default, the stricter of the two modes. */
const check = (latex: string) => renderKatex(latex, { display: 'inline' });

/** A formula scored against `latex` / `accept`, and `pattern` when given. */
function scoreFormula(e: Expect, latex: string): Judgment {
  if (e.latex) {
    const m = equivalentToAny([e.latex, ...(e.accept ?? [])], latex);
    if (m.ok && e.pattern && !matchesPattern(e.pattern, latex)) return { ok: false, judge: 'pattern-miss' };
    return m;
  }
  if (e.pattern) return matchesPattern(e.pattern, latex) ? { ok: true, judge: 'pattern' } : { ok: false, judge: 'pattern-miss' };
  return { ok: false, judge: 'no-expectation' };
}

function scoreLatex(c: Case, got: MathResult): Judgment {
  const primary = scoreFormula(c.expect, got.latex);
  if (primary.ok || c.expect.status !== 'ambiguous') return primary;
  // Ambiguous input: the model led with another reading but offers the expected one as an
  // alternative, one click away in the chip.
  for (const alt of got.alternatives) {
    const r = scoreFormula(c.expect, alt.latex);
    if (r.ok) return { ok: true, judge: r.judge + ':model-alt' };
  }
  return primary;
}

function exposesAmbiguity(c: Case, got: MathResult): boolean {
  if (got.status !== 'ambiguous' || got.alternatives.length === 0) return false;
  const readings = c.expect.alternatives ?? [];
  if (readings.length === 0) return true;
  const offered = [got.latex, ...got.alternatives.map((a) => a.latex)];
  return readings.some((r) => offered.some((o) => equivalent(r, o).ok));
}

function scoreNumeric(c: Case, got: MathResult): Numeric | null {
  const claimed = got.consistency.kind === 'numeric' ? (got.consistency.expected ?? null) : null;
  if (!c.expect.value && claimed === null) return null;
  const truth = c.expect.value ? numeric(c.expect.value) : null;
  const claimedValue = claimed !== null ? numeric(claimed) : null;
  const evaluated = got.latex ? numeric(got.latex) : null;
  return {
    claimed,
    claimedOk: truth === null || claimed === null ? null : claimedValue !== null && close(truth, claimedValue),
    evaluatedOk: truth === null || evaluated === null ? null : close(truth, evaluated),
    hostCheck: claimedValue === null || evaluated === null ? null : close(evaluated, claimedValue),
  };
}

/** Same request as the adapter's, streamed; records timing and hands back a plain completion. */
function streamingFetch(wire: Wire, t0: number): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const res = await fetch(url, {
      ...init,
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    });
    if (!res.ok || !res.body) return res;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let content = '';
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        const chunk = JSON.parse(data) as StreamChunk;
        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          wire.firstTokenMs ??= Math.round(performance.now() - t0);
          content += choice.delta.content;
        }
        if (choice?.finish_reason) wire.finishReason = choice.finish_reason;
        const used = chunk.usage?.completion_tokens;
        if (used !== undefined) wire.completionTokens = (wire.completionTokens ?? 0) + used;
      }
    }
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: wire.finishReason }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

/** A resolver whose requests are timed into `wire`, from `t0`. */
function timedResolver(wire: Wire, t0: number): MathResolver {
  return createDeepSeekResolver({
    apiKey: apiKey!,
    model,
    baseUrl,
    fetch: streamingFetch(wire, t0),
    ...(maxTokens > 0 ? { maxTokens } : {}),
    ...(thinking ? { extraBody: { thinking: { type: thinking } } } : {}),
  });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runCase(c: Case): Promise<Outcome> {
  const wire: Wire = { firstTokenMs: null, finishReason: null, completionTokens: null };
  const t0 = performance.now();
  const resolver = timedResolver(wire, t0);
  const req = { kind: c.kind ?? 'generate', input: c.input, context: { locale: 'zh-CN' as const, ...c.context } };
  let got: MathResult | null = null;
  let retried: Outcome['retried'] = null;
  let error = '';
  try {
    if (c.retry) got = await resolver.resolve({ ...req, retry: c.retry });
    else {
      const r = await resolveWithRetry(resolver, req, check);
      got = r.result;
      retried = r.retried ?? null;
    }
  } catch (e) {
    error = errorMessage(e);
  }
  const latencyMs = Math.round(performance.now() - t0);

  const formulaCase = c.expect.status === 'ok' || c.expect.status === 'ambiguous';
  const answeredFormula = got !== null && (got.status === 'ok' || got.status === 'ambiguous');
  let latexOk: boolean | null = null;
  let judge = got ? 'n/a' : 'error';
  let rendersOk: boolean | null = null;
  let katexWarnings: string[] = [];
  if (got && answeredFormula) {
    const r = check(got.latex);
    rendersOk = r.ok;
    katexWarnings = r.warnings;
    if (formulaCase) ({ ok: latexOk, judge } = scoreLatex(c, got));
  }

  let statusOk = false;
  if (got && formulaCase) statusOk = answeredFormula;
  else if (got && c.expect.status === 'unsupported') {
    const want = c.expect.features ?? [];
    statusOk =
      got.status === 'unsupported' &&
      (want.length === 0 || want.some((f) => got.features.some((g) => g.toLowerCase().includes(f.toLowerCase()))));
  } else if (got) statusOk = got.status === c.expect.status;

  const { raw, ...gotNoRaw } = got ?? { raw: undefined };
  return {
    id: c.id,
    category: c.category,
    input: c.input,
    expect: c.expect,
    got: got ? (gotNoRaw as Omit<MathResult, 'raw'>) : { error },
    latencyMs,
    ...wire,
    jsonOk: got !== null && parseModelJson(String(raw ?? '')) !== null,
    fromRetry: c.retry !== undefined,
    retried,
    statusExact: got?.status === c.expect.status,
    statusOk,
    latexOk,
    judge,
    rendersOk,
    katexWarnings,
    ambiguityExposed: c.expect.status === 'ambiguous' ? got !== null && exposesAmbiguity(c, got) : null,
    falseAmbiguity: c.expect.status === 'ok' ? got?.status === 'ambiguous' : null,
    numeric: got ? scoreNumeric(c, got) : null,
    pass: statusOk && latexOk !== false && rendersOk !== false,
  };
}

async function runEditCase(c: EditCase): Promise<EditOutcome> {
  const wire: Wire = { firstTokenMs: null, finishReason: null, completionTokens: null };
  const t0 = performance.now();
  let got: MathEditResult | null = null;
  let error = '';
  try {
    got = await timedResolver(wire, t0).edit({
      kind: 'edit',
      instruction: c.instruction,
      fullLatex: c.fullLatex,
      selectionLatex: c.selectionLatex,
      context: { locale: 'zh-CN' },
    });
  } catch (e) {
    error = errorMessage(e);
  }
  const latencyMs = Math.round(performance.now() - t0);
  let latexOk: boolean | null = null;
  let judge = got ? 'n/a' : 'error';
  let rendersOk: boolean | null = null;
  if (got?.status === 'ok') {
    rendersOk = check(got.replacementLatex).ok;
    if (c.expect.status === 'ok') ({ ok: latexOk, judge } = scoreFormula(c.expect, got.replacementLatex));
  }
  const statusOk = got?.status === c.expect.status;
  const { raw, ...gotNoRaw } = got ?? { raw: undefined };
  return {
    id: c.id,
    category: c.category,
    instruction: c.instruction,
    expect: c.expect,
    got: got ? (gotNoRaw as Omit<MathEditResult, 'raw'>) : { error },
    latencyMs,
    ...wire,
    jsonOk: got !== null && parseModelJson(String(raw ?? '')) !== null,
    statusOk,
    latexOk,
    judge,
    rendersOk,
    pass: statusOk && latexOk !== false && rendersOk !== false,
  };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
        process.stderr.write(`.`);
      }
    }),
  );
  return out;
}

function pct(n: number, d: number): string {
  return d === 0 ? '–' : `${Math.round((100 * n) / d)}% (${n}/${d})`;
}

/** Share of `os` for which `f` is true, over the outcomes where `f` applies (not null). */
function rate<T>(os: T[], f: (o: T) => boolean | null): string {
  const vs = os.map(f).filter((v): v is boolean => v !== null);
  return pct(vs.filter(Boolean).length, vs.length);
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!;
}

function latencyLine(label: string, os: Timing[]): string {
  const first = os.map((o) => o.firstTokenMs).filter((v): v is number => v !== null);
  const total = os.map((o) => o.latencyMs);
  return `延迟（${label}）：首 token p50 ${quantile(first, 0.5)} ms，p95 ${quantile(first, 0.95)} ms；总耗时 p50 ${quantile(total, 0.5)} ms，p95 ${quantile(total, 0.95)} ms，最大 ${Math.max(0, ...total)} ms`;
}

function describeGot(o: Outcome): string {
  if ('error' in o.got) return `错误：${o.got.error}`;
  const alts = o.got.alternatives.length ? ` alternatives=${o.got.alternatives.map((a) => `\`${a.latex}\``).join(' ')}` : '';
  const nots = o.got.notations.length ? ` notations=${o.got.notations.map((a) => `\`${a.latex}\``).join(' ')}` : '';
  const feats = o.got.features.length ? ` features=${JSON.stringify(o.got.features)}` : '';
  return `status=${o.got.status} latex=\`${o.got.latex}\`${alts}${nots}${feats} interp=${o.got.interpretation}`;
}

/** An empty latex means the first answer was unusable (cut off or broken JSON), not rejected. */
function describeRetry(r: { latex: string; message: string }): string {
  return r.latex ? `首轮 \`${r.latex}\` 被 KaTeX 拒绝（${r.message}）` : `首轮输出不可用（${r.message}）`;
}

function describeEdit(o: EditOutcome): string {
  if ('error' in o.got) return `错误：${o.got.error}`;
  return `status=${o.got.status} replacement=\`${o.got.replacementLatex}\` interp=${o.got.interpretation ?? ''}`;
}

function report(outcomes: Outcome[], edits: EditOutcome[], fewShotOverlap: string[]): string {
  const retryCases = outcomes.filter((o) => o.fromRetry);
  const generated = outcomes.filter((o) => !o.fromRetry);
  const formula = generated.filter((o) => o.expect.status === 'ok' || o.expect.status === 'ambiguous');
  const retried = generated.filter((o) => o.retried !== null);
  const ambiguousPassed = generated.filter((o) => o.expect.status === 'ambiguous' && o.pass);
  const all: Timing[] = [...outcomes, ...edits];
  const tokens = all.map((o) => o.completionTokens).filter((v): v is number => v !== null);
  const numericCases = outcomes.filter((o) => o.numeric !== null);
  const valueCases = numericCases.filter((o) => o.expect.value !== undefined);
  const hostChecks = numericCases.filter((o) => o.numeric!.claimed !== null);
  const passed = outcomes.filter((o) => o.pass).length + edits.filter((o) => o.pass).length;
  const L: string[] = [];

  L.push(`# S4 结果（${suite === 'heldout' ? '留出集' : '开发集'}） ${new Date().toISOString()}`);
  L.push('');
  L.push(
    `模型：\`${model}\`；思考：${thinking ?? 'disabled（适配器默认）'}；max_tokens：${maxTokens || '1200（适配器默认）'}；生成用例 ${outcomes.length}，改写用例 ${edits.length}；总通过率：${pct(passed, all.length)}`,
  );
  L.push(`与 few-shot 示例重叠的用例：${fewShotOverlap.length ? fewShotOverlap.join('、') : '无'}`);
  if (outcomes.length) L.push(latencyLine('生成', outcomes));
  if (edits.length) L.push(latencyLine('改写', edits));
  L.push(
    `输出 token：p50 ${quantile(tokens, 0.5)}，最大 ${Math.max(0, ...tokens)}；被 max_tokens 截断 ${all.filter((o) => o.finishReason === 'length').length} 条；没有可用 JSON ${all.filter((o) => !o.jsonOk).length} 条`,
  );
  L.push('');
  L.push('## S4 指标（生成与转换）');
  L.push('');
  L.push('| 指标 | 结果 | 口径 |');
  L.push('|---|---|---|');
  L.push(`| 生成准确率 | ${rate(formula, (o) => o.pass)} | 期望 ok / ambiguous：给出公式，主解释等价（有 pattern 时还须匹配），KaTeX 接受 |`);
  L.push(`| 歧义暴露率 | ${rate(generated, (o) => o.ambiguityExposed)} | 期望 ambiguous：答 ambiguous 且给出了期望的另一种读法 |`);
  L.push(`| 歧义主解释一致 | ${rate(ambiguousPassed, (o) => !o.judge.endsWith(':model-alt'))} | 期望 ambiguous 且通过：主解释就是期望读法，不是靠 alternatives 兜住的 |`);
  L.push(`| 误报歧义 | ${rate(generated, (o) => o.falseAmbiguity)} | 期望 ok 却答 ambiguous；主解释正确时不算失败，只多一个 chip |`);
  L.push(`| 越界识别率 | ${rate(generated, (o) => (o.expect.status === 'unsupported' ? o.statusOk : null))} | 期望 unsupported：答 unsupported 且 features 含期望包名 |`);
  L.push(`| 非数学识别 | ${rate(generated, (o) => (o.expect.status === 'not_math' ? o.statusOk : null))} | 期望 not_math |`);
  L.push(`| 误拒 | ${rate(formula, (o) => !o.statusOk)} | 期望公式，却答 unsupported / not_math 或请求出错 |`);
  L.push(`| 首轮触发重试 | ${pct(retried.length, generated.length)} | 第一次的公式被 KaTeX 拒绝，或输出不可用（截断、JSON 损坏），同步门重问一次 |`);
  L.push(`| 重试后通过 | ${rate(retried, (o) => o.pass)} | 上一行里，重试之后通过的 |`);
  L.push(`| 重试提示词 | ${rate(retryCases, (o) => o.pass)} | retry 类：从给定的被拒回答出发，改正后通过 |`);
  L.push(`| KaTeX 严格警告 | ${rate(outcomes, (o) => (o.rendersOk === null ? null : o.katexWarnings.length > 0))} | 能渲染，但严格模式报了警告 |`);
  L.push(`| 给出记号变体 | ${rate(generated, (o) => ('error' in o.got ? null : o.got.notations.length > 0))} | notations 非空，仅作记录 |`);
  L.push(`| 模型声明了值 | ${rate(valueCases, (o) => o.numeric!.claimed !== null)} | 有已知值的用例：consistency 为 numeric |`);
  L.push(`| 声明的值正确 | ${rate(valueCases, (o) => o.numeric!.claimedOk)} | 有已知值且声明了值：consistency.expected 等于真值 |`);
  L.push(`| CE 求值正确 | ${rate(valueCases, (o) => o.numeric!.evaluatedOk)} | 有已知值的用例：Compute Engine 对返回 LaTeX 求值等于真值（求不出的不计） |`);
  L.push(
    `| 一致性检查 | 可运行 ${pct(hostChecks.filter((o) => o.numeric!.hostCheck !== null).length, hostChecks.length)}，报不一致 ${hostChecks.filter((o) => o.numeric!.hostCheck === false).length} 条 | 模型声明 numeric 时，宿主用 CE 求值与声明值比对 |`,
  );
  if (edits.length) {
    L.push('');
    L.push('## 选区改写（D8）');
    L.push('');
    L.push('| 指标 | 结果 | 口径 |');
    L.push('|---|---|---|');
    L.push(`| 通过率 | ${rate(edits, (o) => o.pass)} | status 正确；ok 时替换片段等价且 KaTeX 可渲染 |`);
    L.push(`| status 正确 | ${rate(edits, (o) => o.statusOk)} | ok / unclear / unsupported 与期望一致 |`);
    L.push(`| 替换片段等价 | ${rate(edits, (o) => o.latexOk)} | 期望 ok 且答 ok：片段与期望等价；把整条公式都返回的会在这里失败 |`);
  }
  L.push('');
  L.push('## 分类别');
  L.push('');
  L.push('| 类别 | 通过 | 答对类型 | status 完全一致 | latex 等价 | KaTeX 可渲染 | 歧义被暴露 | 误报歧义 | 首轮被拒 |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  const byCat = new Map<string, Outcome[]>();
  for (const o of outcomes) byCat.set(o.category, [...(byCat.get(o.category) ?? []), o]);
  for (const [cat, os] of byCat) {
    L.push(
      `| ${cat} | ${rate(os, (o) => o.pass)} | ${rate(os, (o) => o.statusOk)} | ${rate(os, (o) => o.statusExact)} | ${rate(os, (o) => o.latexOk)} | ${rate(os, (o) => o.rendersOk)} | ${rate(os, (o) => o.ambiguityExposed)} | ${rate(os, (o) => o.falseAmbiguity)} | ${os.filter((o) => o.retried).length} |`,
    );
  }
  const editCats = new Map<string, EditOutcome[]>();
  for (const o of edits) editCats.set(o.category, [...(editCats.get(o.category) ?? []), o]);
  for (const [cat, os] of editCats) {
    L.push(`| ${cat} | ${rate(os, (o) => o.pass)} | ${rate(os, (o) => o.statusOk)} | ${rate(os, (o) => o.statusOk)} | ${rate(os, (o) => o.latexOk)} | ${rate(os, (o) => o.rendersOk)} | – | – | – |`);
  }
  L.push('');
  const failures = outcomes.filter((o) => !o.pass);
  const editFailures = edits.filter((o) => !o.pass);
  L.push(`## 未通过（${failures.length + editFailures.length}）`);
  L.push('');
  for (const f of failures) {
    L.push(
      `- **${f.id}** \`${f.input}\` → 期望 status=${f.expect.status}${f.expect.latex ? ` latex=\`${f.expect.latex}\`` : ''}${f.expect.pattern ? ` pattern=\`${f.expect.pattern}\`` : ''}；得到 ${describeGot(f)}；判定 ${f.judge}${f.rendersOk === false ? '；KaTeX 拒绝' : ''}${f.finishReason === 'length' ? '；被截断' : ''}${f.retried ? `；${describeRetry(f.retried)}` : ''}`,
    );
  }
  for (const f of editFailures) {
    L.push(
      `- **${f.id}** 「${f.instruction}」 → 期望 status=${f.expect.status}${f.expect.latex ? ` latex=\`${f.expect.latex}\`` : ''}；得到 ${describeEdit(f)}；判定 ${f.judge}${f.rendersOk === false ? '；KaTeX 拒绝' : ''}`,
    );
  }
  L.push('');
  const notes = outcomes.filter(
    (o) =>
      o.pass &&
      (o.ambiguityExposed === false ||
        o.falseAmbiguity === true ||
        o.retried !== null ||
        o.katexWarnings.length > 0 ||
        !['string', 'n/a', 'pattern'].includes(o.judge)),
  );
  L.push(`## 通过但值得看一眼（${notes.length}）`);
  L.push('');
  for (const o of notes) {
    const why = [
      o.ambiguityExposed === false ? '歧义未暴露' : '',
      o.falseAmbiguity ? '误报歧义' : '',
      o.retried ? `${describeRetry(o.retried)}，重试后通过` : '',
      o.katexWarnings.length ? `KaTeX 警告 ${o.katexWarnings.join('；')}` : '',
      !['string', 'n/a', 'pattern'].includes(o.judge) ? `判定 ${o.judge}` : '',
    ].filter(Boolean);
    L.push(`- **${o.id}** \`${o.input}\` → ${describeGot(o)}；${why.join('，')}`);
  }
  L.push('');
  L.push('## 数值一致');
  L.push('');
  L.push('| 用例 | 返回 LaTeX | 真值 | 模型声明 | 声明正确 | CE 求值正确 | 宿主检查 |');
  L.push('|---|---|---|---|---|---|---|');
  const mark = (v: boolean | null) => (v === null ? '–' : v ? '✓' : '✗');
  for (const o of numericCases) {
    const n = o.numeric!;
    const latex = 'error' in o.got ? '' : o.got.latex;
    L.push(`| ${o.id} | \`${latex}\` | ${o.expect.value ?? '–'} | ${n.claimed ?? '–'} | ${mark(n.claimedOk)} | ${mark(n.evaluatedOk)} | ${mark(n.hostCheck)} |`);
  }
  L.push('');
  L.push('## 判定方式统计');
  L.push('');
  const judges = new Map<string, number>();
  for (const o of [...outcomes, ...edits]) judges.set(o.judge, (judges.get(o.judge) ?? 0) + 1);
  for (const [j, n] of judges) L.push(`- ${j}: ${n}`);
  return L.join('\n') + '\n';
}

async function loadCorpus<T extends { id: string; category: string }>(file: string): Promise<T[]> {
  let cases = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8')) as T[];
  if (filter) cases = cases.filter((c) => c.id.includes(filter) || c.category.includes(filter));
  if (limit > 0) cases = cases.slice(0, limit);
  return cases;
}

async function main(): Promise<void> {
  const cases = await loadCorpus<Case>(corpusFiles.generate);
  const editCases = await loadCorpus<EditCase>(corpusFiles.edit);
  // The few-shot inputs are the user turns before the final one.
  const fewShots = new Set(
    buildGenerateMessages({ kind: 'generate', input: '' })
      .slice(1, -1)
      .filter((m) => m.role === 'user')
      .map((m) => m.content),
  );
  const fewShotOverlap = cases.filter((c) => fewShots.has(c.input)).map((c) => c.id);
  console.error(
    `suite=${suite} model=${model} thinking=${thinking ?? 'default'} base=${baseUrl} cases=${cases.length}+${editCases.length} concurrency=${concurrency}`,
  );

  const outcomes = await pool(cases, concurrency, runCase);
  const edits = await pool(editCases, concurrency, runEditCase);
  process.stderr.write('\n');
  const md = report(outcomes, edits, fewShotOverlap);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + (suite === 'heldout' ? '-heldout' : '');
  await mkdir(new URL('./results/', import.meta.url), { recursive: true });
  await writeFile(
    new URL(`./results/${stamp}.json`, import.meta.url),
    JSON.stringify({ suite, model, baseUrl, thinking: thinking ?? null, maxTokens: maxTokens || null, outcomes, edits }, null, 2),
  );
  await writeFile(new URL(`./results/${stamp}.md`, import.meta.url), md);
  console.log(md);
  console.error(`written: spikes/s4-ai-corpus/results/${stamp}.{json,md}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
