import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyIntent,
  createDeepSeekResolver,
  findFormulaDescriptions,
  MarkdownReveal,
  mathExtensions,
  mathLiveFactory,
  newMathId,
  renderKatex,
  resolveWithRetry,
  type InlineEditMode,
  type LayoutMetrics,
  type MathAlternative,
  type MathEditorKind,
  type MathGenerateRequest,
  type MathResolver,
  type MathResult,
} from '@math-notes/core';
import { mockResolver } from './mock-resolver';
import { sampleDoc } from './sample-doc';

interface Status {
  kind: 'ok' | 'pending' | 'warn' | 'ambiguous' | 'boundary';
  text: string;
  /** The formula this status is about, and the other readings the chips switch it to (D6). */
  formula?: { id: string; latex: string; interpretation: string };
  alternatives?: MathAlternative[];
}

type Busy = 'insert' | 'convert' | 'scan' | null;

// Real AI only when the dev server was started with DEEPSEEK_API_KEY (see vite.config.ts);
// the browser talks to the /api/deepseek proxy and never sees the key.
const resolver: MathResolver = __AI_PROXY__
  ? createDeepSeekResolver({ apiKey: '', baseUrl: __AI_PROXY__, model: __AI_MODEL__ })
  : mockResolver;
const resolverLabel = __AI_PROXY__ ? `DeepSeek · ${__AI_MODEL__}` : 'mock';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';

type Resolved = { result: MathResult; retried: boolean } | { error: string };

/**
 * Ask the resolver, with the sync gate's one retry on a KaTeX rejection (D6). A formula that
 * still does not render comes back as an error, so nothing broken gets inserted.
 */
async function resolveForInsert(req: MathGenerateRequest, display: 'inline' | 'block'): Promise<Resolved> {
  const check = (latex: string) => renderKatex(latex, { display });
  try {
    const { result, retried } = await resolveWithRetry(resolver, req, check);
    if (result.status === 'ok' || result.status === 'ambiguous') {
      const r = check(result.latex);
      if (!r.ok) return { error: `AI 给出的公式重试后仍无法渲染（${r.message}），原文已保留。` };
    }
    return { result, retried: retried !== undefined };
  } catch (e) {
    return { error: `AI 调用失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Selected text as the AI should read it: formulas inside it as $…$. */
function textOf(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, ' ', (leaf) => (leaf.type.name === 'mathInline' ? `$${String(leaf.attrs['latex'])}$` : ' '));
}

/** Briefly highlight formulas that just appeared, so a conversion is easy to spot. */
function flash(ids: string[]): void {
  for (const id of ids) {
    const el = document.querySelector<HTMLElement>(`.mn-math[data-id="${id}"]`);
    if (!el) continue;
    el.classList.add('mn-flash');
    setTimeout(() => el.classList.remove('mn-flash'), 1600);
  }
}

function loadKind(): MathEditorKind {
  try {
    return localStorage.getItem('mn:editor-kind') === 'source' ? 'source' : 'structured';
  } catch {
    return 'structured';
  }
}

function saveKind(kind: MathEditorKind): void {
  try {
    localStorage.setItem('mn:editor-kind', kind);
  } catch {
    /* private window: the choice just is not remembered */
  }
}

declare global {
  interface Window {
    __mn?: {
      editor: unknown;
      classifyIntent: typeof classifyIntent;
      getMetrics: () => LayoutMetrics[];
      setMode: (m: InlineEditMode) => void;
      setEditorKind: (k: MathEditorKind) => void;
    };
  }
}

export function App() {
  const [mode, setMode] = useState<InlineEditMode>('inplace');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [editorKind, setEditorKind] = useState<MathEditorKind>(loadKind);
  const kindRef = useRef(editorKind);
  kindRef.current = editorKind;
  const [display, setDisplay] = useState<'auto' | 'inline' | 'block'>('auto');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusyState] = useState<Busy>(null);
  const busyRef = useRef<Busy>(null);
  const setBusy = (b: Busy) => {
    busyRef.current = b;
    setBusyState(b);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<LayoutMetrics[]>([]);
  const metricsRef = useRef<LayoutMetrics[]>([]);

  const extensions = useMemo(
    () => [
      // Typora: [text](url) typed or pasted becomes a link, which opens with Cmd/Ctrl+click only.
      StarterKit.configure({ link: { openOnClick: false, markdownLinks: true } }),
      MarkdownReveal,
      ...mathExtensions({
        factory: mathLiveFactory,
        render: (latex, d) => renderKatex(latex, { display: d }),
        getInlineMode: () => modeRef.current,
        getEditorKind: () => kindRef.current,
        onMetrics: (m) => {
          metricsRef.current = [...metricsRef.current.slice(-19), m];
          setMetrics(metricsRef.current);
        },
      }),
    ],
    [],
  );

  const editor = useEditor({ extensions, content: sampleDoc, immediatelyRender: true });

  const chooseKind = useCallback((k: MathEditorKind) => {
    setEditorKind(k);
    saveKind(k);
  }, []);

  useEffect(() => {
    window.__mn = {
      editor,
      classifyIntent,
      getMetrics: () => metricsRef.current,
      setMode: (m) => setMode(m),
      setEditorKind: chooseKind,
    };
  }, [editor, chooseKind]);

  // Close the menu on a click elsewhere or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const insert = useCallback(
    (latex: string, d: 'inline' | 'block'): string => {
      const id = newMathId();
      editor.chain().focus().insertMath({ latex, display: d, id }).run();
      flash([id]);
      return id;
    },
    [editor],
  );

  const submit = useCallback(async () => {
    const input = text;
    const r = classifyIntent(input);
    if (r.decision === 'none' || busyRef.current) return;
    const chosen = (fallback: 'inline' | 'block') => (display === 'auto' ? fallback : display);
    if (r.decision === 'direct') {
      insert(r.latex ?? '', chosen(r.display ?? 'inline'));
      setText('');
      setStatus({ kind: 'ok', text: `直接插入，未调用 AI（${r.kind}）` });
      return;
    }
    setBusy('insert');
    setStatus({ kind: 'pending', text: `AI 解析中…（${r.kind}：${r.reasons.join('，')}）` });
    const d = chosen('inline');
    const got = await resolveForInsert({ kind: 'generate', input, context: { locale: 'zh-CN' } }, d);
    setBusy(null);
    if ('error' in got) {
      setStatus({ kind: 'warn', text: got.error });
      return;
    }
    const res = got.result;
    if (res.status === 'ok' || res.status === 'ambiguous') {
      const id = insert(res.latex, d);
      setText('');
      setStatus({
        kind: res.status,
        text: got.retried ? `${res.interpretation}（按渲染器报错重试过一次）` : res.interpretation,
        formula: { id, latex: res.latex, interpretation: res.interpretation },
        alternatives: res.alternatives,
      });
    } else if (res.status === 'unsupported') {
      setStatus({
        kind: 'boundary',
        text: `${res.interpretation}（${res.features?.join('、')}）目前超出本编辑器的渲染范围。这不是识别错误，原文已保留，可后续添加支持。`,
      });
    } else {
      setStatus({ kind: 'warn', text: '没有识别出数学内容。' });
    }
  }, [text, display, insert]);

  /**
   * Find the formula descriptions in the note, or in a range of it, and convert them in one
   * transaction: only the described formulas change, the text around them stays (D13).
   */
  const convertDescriptions = useCallback(
    async (range?: { from: number; to: number }) => {
      const scan = resolver.scan?.bind(resolver);
      if (!scan) {
        setStatus({ kind: 'warn', text: '当前接入的 AI 不支持识别公式描述。' });
        return;
      }
      const where = range ? '选中文字里' : '笔记里';
      setBusy(range ? 'convert' : 'scan');
      setStatus({ kind: 'pending', text: `AI 正在找${where}用文字描述的公式…` });
      if (!range) {
        // A formula being edited commits on blur; let it land before reading the note.
        (document.activeElement as HTMLElement | null)?.blur?.();
        await new Promise((r) => setTimeout(r, 0));
      }
      const doc = editor.state.doc;
      try {
        const outcome = await findFormulaDescriptions(doc, scan, (latex) => renderKatex(latex, { display: 'inline' }), { range });
        if (!editor.state.doc.eq(doc)) {
          setStatus({ kind: 'warn', text: `识别期间笔记有改动，没有替换。${range ? '重新选中后再转一次即可。' : '再点一次「一键转公式」即可。'}` });
          return;
        }
        if (!outcome.found.length) {
          setStatus({ kind: 'ok', text: `${where}没有找到用文字描述的公式，原文保留。` });
          return;
        }
        const items = outcome.found.map((f) => ({ ...f, id: newMathId() }));
        const chain = editor.chain().focus().convertRangesToMath(items);
        // A converted selection collapses to its end, so the bubble does not offer the same text again.
        if (range) chain.command(({ tr }) => !!tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(range.to)), -1)));
        chain.run();
        flash(items.map((i) => i.id));
        const kept = outcome.rejected.length ? `；另有 ${outcome.rejected.length} 处没把握，原文保留` : '';
        setStatus({
          kind: 'ok',
          text: `已把${range ? '选中文字里的' : ''} ${items.length} 处公式描述转成公式，其余文字不变${kept}。${MOD}Z 可一次撤销。`,
        });
      } catch (e) {
        setStatus({ kind: 'warn', text: `AI 调用失败：${e instanceof Error ? e.message : String(e)}` });
      } finally {
        setBusy(null);
      }
    },
    [editor],
  );

  /**
   * The whole selection is one formula: literal LaTeX, or a short piece of informal math with no
   * prose around it (`sin x`, `lim x->0 sinx/x`). A selection that fills a paragraph becomes a
   * block formula.
   */
  const convertWhole = useCallback(
    async (from: number, to: number, selected: string, intent: ReturnType<typeof classifyIntent>) => {
      let latex = intent.decision === 'direct' ? intent.latex : undefined;
      let result: MathResult | undefined;
      if (latex === undefined) {
        setBusy('convert');
        setStatus({ kind: 'pending', text: 'AI 解析选中文字…' });
        const got = await resolveForInsert({ kind: 'convert', input: selected, context: { locale: 'zh-CN' } }, 'inline');
        setBusy(null);
        if ('error' in got) {
          setStatus({ kind: 'warn', text: got.error });
          return;
        }
        result = got.result;
        if (result.status !== 'ok' && result.status !== 'ambiguous') {
          setStatus({
            kind: 'boundary',
            text: result.status === 'unsupported' ? '选中的内容超出本编辑器的渲染范围，原文保留。' : '选中的文字不像公式，原文保留。',
          });
          return;
        }
        latex = result.latex;
      }
      // The AI took a moment: replace what was selected, and only if it is still there as it was.
      if (textOf(editor.state.doc, from, to).trim() !== selected) {
        setStatus({ kind: 'warn', text: '识别期间这段文字被改动了，没有替换。' });
        return;
      }
      const $from = editor.state.doc.resolve(from);
      const fills = $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parentOffset === 0 && to === $from.end();
      const id = newMathId();
      editor
        .chain()
        .focus()
        .convertRangesToMath([{ from, to, latex, display: fills ? 'block' : 'inline', id }])
        .command(({ tr }) => !!tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(to)), -1)))
        .run();
      flash([id]);
      setStatus({
        kind: result?.status === 'ambiguous' ? 'ambiguous' : 'ok',
        text: result?.interpretation ? `已把选中文字转为公式：${result.interpretation}` : '已把选中文字转为公式',
        formula: { id, latex, interpretation: result?.interpretation ?? '' },
        alternatives: result?.alternatives,
      });
    },
    [editor],
  );

  /**
   * Selected text → formulas. Only the formula descriptions in the selection are converted, as
   * the one-click conversion does for the whole note; a selection that is itself one formula
   * (see convertWhole) is converted as a whole.
   */
  const convertSelection = useCallback(async () => {
    const { from, to, empty } = editor.state.selection;
    if (empty || busyRef.current) return;
    const doc = editor.state.doc;
    const selected = textOf(doc, from, to).trim();
    if (!selected) return;
    const $from = doc.resolve(from);
    const oneBlock = $from.parent.isTextblock && $from.sameParent(doc.resolve(to));
    const intent = classifyIntent(selected);
    if (oneBlock && (intent.decision === 'direct' || intent.kind === 'gray')) await convertWhole(from, to, selected, intent);
    else await convertDescriptions({ from, to });
  }, [editor, convertWhole, convertDescriptions]);

  const scanAll = useCallback(async () => {
    if (!busyRef.current) await convertDescriptions();
  }, [convertDescriptions]);

  /** Switch the formula the status is about to another reading; the old one becomes a chip. */
  const chooseAlternative = useCallback(
    (alt: MathAlternative) => {
      const f = status?.formula;
      if (!f || !editor.commands.updateMath(f.id, alt.latex)) return;
      setStatus({
        kind: status.kind,
        text: `已改为：${alt.interpretation.replace(/^改为\s*/, '')}`,
        formula: { id: f.id, latex: alt.latex, interpretation: alt.interpretation },
        alternatives: [
          { latex: f.latex, interpretation: '改回原来的读法' },
          ...(status.alternatives ?? []).filter((a) => a !== alt && a.latex !== f.latex),
        ],
      });
    },
    [editor, status],
  );

  // Cmd/Ctrl+Shift+E in the note: selected text → formula; with nothing selected, a new formula
  // at the caret. Not while a formula is being edited: the note's selection is stale then.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') || !editor.view.hasFocus()) return;
      e.preventDefault();
      if (!editor.state.selection.empty) void convertSelection();
      else editor.chain().focus().insertEmptyMath('inline').run();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editor, convertSelection]);

  const last = metrics[metrics.length - 1];

  return (
    <div className="mn-app">
      <header className="mn-topbar">
        <div className="mn-topbar-inner">
          <div className="mn-brand">
            <span className="mn-logo" aria-hidden="true">
              ∑
            </span>
            <span>math-notes</span>
          </div>

          <div className="mn-seg" role="radiogroup" aria-label="公式编辑方式" data-testid="editor-kind">
            <button
              type="button"
              role="radio"
              aria-checked={editorKind === 'structured'}
              data-value="structured"
              title="点公式直接在公式框里改"
              onClick={() => chooseKind('structured')}
            >
              可视
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={editorKind === 'source'}
              data-value="source"
              title="点公式显示 LaTeX 源码，弹窗实时预览"
              onClick={() => chooseKind('source')}
            >
              文本
            </button>
          </div>

          <div className="mn-spacer" />

          <button
            type="button"
            className="mn-btn mn-btn-primary"
            data-testid="scan"
            onClick={() => void scanAll()}
            disabled={busy === 'scan'}
            title="让 AI 找出笔记里用文字描述的公式，一次全部转换"
          >
            {busy === 'scan' ? <span className="mn-spinner" aria-hidden="true" /> : <IconSparkle />}
            {busy === 'scan' ? '识别中…' : '一键转公式'}
          </button>
          <button
            type="button"
            className="mn-btn mn-btn-icon"
            title={`撤销（${MOD}Z）`}
            aria-label="撤销"
            onClick={() => editor.chain().focus().undo().run()}
          >
            <IconUndo />
          </button>
          <div className="mn-menu" ref={menuRef}>
            <button
              type="button"
              className="mn-btn mn-btn-icon"
              aria-label="更多"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <IconMore />
            </button>
            <div className="mn-menu-panel" hidden={!menuOpen}>
              <section>
                <h3>快捷键</h3>
                <dl className="mn-keys">
                  <dt>
                    <kbd>
                      {MOD}
                      {SHIFT}E
                    </kbd>
                  </dt>
                  <dd>选中文字里的公式描述转成公式；没选中时插入公式</dd>
                  <dt>
                    <kbd>$…$</kbd> <kbd>$$</kbd>
                  </dt>
                  <dd>打字输入公式；段首 $$ 是块级公式</dd>
                  <dt>
                    <kbd>#</kbd> <kbd>**</kbd> <kbd>&gt;</kbd>
                  </dt>
                  <dd>Markdown 语法照打；光标所在处显示标记，标题开头退格删掉 # 后的空格</dd>
                  <dt>
                    <kbd>→</kbd> <kbd>←</kbd>
                  </dt>
                  <dd>公式里走到头就离开公式，继续写文字</dd>
                  <dt>
                    <kbd>Enter</kbd>
                  </dt>
                  <dd>块级公式换行；行内公式完成</dd>
                  <dt>
                    <kbd>Esc</kbd>
                  </dt>
                  <dd>完成编辑</dd>
                </dl>
              </section>
              <section>
                <h3>设置</h3>
                <label className="mn-field-row">
                  可视模式的行内公式
                  <select value={mode} onChange={(e) => setMode(e.target.value as InlineEditMode)} data-testid="mode">
                    <option value="inplace">就地编辑</option>
                    <option value="overlay">浮层覆盖</option>
                    <option value="popover">下方弹层</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => {
                    editor.commands.setContent(sampleDoc);
                    setMenuOpen(false);
                  }}
                >
                  重置示例笔记
                </button>
              </section>
              {last && (
                <section className="mn-metrics" data-testid="metrics">
                  <h3>调试</h3>
                  最近一次进入编辑：<code>{last.mode}</code> · 节点高度变化{' '}
                  <code>{(last.nodeAfter.height - last.nodeBefore.height).toFixed(1)}px</code> · 顶部偏移{' '}
                  <code>{(last.nodeAfter.y - last.nodeBefore.y).toFixed(1)}px</code>
                  {last.lineBefore && last.lineAfter && (
                    <>
                      {' '}
                      · 行高变化 <code>{(last.lineAfter.height - last.lineBefore.height).toFixed(1)}px</code>
                    </>
                  )}
                </section>
              )}
            </div>
          </div>
          <span className="mn-badge" data-testid="resolver" title="当前接入的 AI">
            AI：{resolverLabel}
          </span>
        </div>
      </header>

      <main className="mn-page">
        <div className="mn-paper" data-editor-kind={editorKind}>
          <EditorContent editor={editor} />
        </div>
        <p className="mn-tip">
          {editorKind === 'source' ? '文本模式：点公式显示 LaTeX 源码，下方弹窗实时预览。' : '可视模式：点公式直接在公式框里改。'}
          空格、回车都留在公式里，<kbd>→</kbd> 走到头离开公式。
        </p>
      </main>

      <BubbleMenu
        editor={editor}
        className="mn-bubble"
        options={{ placement: 'top', offset: 8 }}
        shouldShow={({ editor: ed, view, state, from, to }) =>
          ed.isEditable &&
          view.hasFocus() &&
          state.selection instanceof TextSelection &&
          !state.selection.empty &&
          textOf(state.doc, from, to).trim() !== ''
        }
      >
        {busy === 'convert' ? (
          <span className="mn-bubble-busy">
            <span className="mn-spinner" aria-hidden="true" /> 识别中…
          </span>
        ) : (
          <button
            type="button"
            data-testid="bubble-convert"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void convertSelection()}
            title="把选中文字里用文字描述的公式转成公式，其余文字不变"
          >
            <span className="mn-bubble-icon" aria-hidden="true">
              ∑
            </span>
            转为公式
            <kbd>
              {MOD}
              {SHIFT}E
            </kbd>
          </button>
        )}
      </BubbleMenu>

      <footer className="mn-composer">
        <div className="mn-composer-card">
          <textarea
            data-testid="input"
            rows={2}
            value={text}
            placeholder="用文字描述或随手写公式，回车插入。例如：(x+1)^2从1到2的定积分 · limit->0(sinx/x) · x^2+y^2=1"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="mn-composer-bar">
            <div className="mn-seg mn-seg-sm" role="radiogroup" aria-label="插入为">
              {(
                [
                  ['auto', '自动'],
                  ['inline', '行内'],
                  ['block', '块级'],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={display === value} onClick={() => setDisplay(value)}>
                  {label}
                </button>
              ))}
            </div>
            {status && (
              <span className={`mn-status mn-status-${status.kind}`} data-testid="status" role="status">
                {status.kind === 'pending' && <span className="mn-spinner" aria-hidden="true" />}
                <span className="mn-status-text">{status.text}</span>
                {status.formula &&
                  status.alternatives?.map((a) => (
                    <button key={a.latex} type="button" className="mn-chip" onClick={() => chooseAlternative(a)} title={a.latex}>
                      {a.interpretation}
                    </button>
                  ))}
              </span>
            )}
            <button
              type="button"
              className="mn-btn mn-btn-primary mn-send"
              onClick={() => void submit()}
              disabled={!text.trim() || busy === 'insert'}
            >
              {busy === 'insert' ? <span className="mn-spinner" aria-hidden="true" /> : null}
              插入
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function IconSparkle() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5zM12.5 10.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconUndo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 3L2 6.5 5.5 10M2.5 6.5h7a4 4 0 010 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}
