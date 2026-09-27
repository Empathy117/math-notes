/**
 * NodeView for inline and block math nodes (design doc D3, D10).
 *
 * Non-editing state: a static KaTeX render, nothing else mounted.
 * Editing state: an editor mounted according to the mode:
 *   - block / inline 'inplace' : the structural field replaces the static render inside the node DOM
 *   - inline 'overlay'         : the static render is hidden, the field floats over it in a portal
 *   - inline 'popover'         : the static render stays, the field opens below it in a portal
 *   - 'source' (text mode)     : the LaTeX source replaces the static render, a live KaTeX preview
 *                                floats below it
 *
 * Keys inside a formula stay in the formula: Space and (in block formulas) Enter edit it. An
 * arrow key with nowhere left to go, Escape, Enter in an inline formula and Cmd/Ctrl+Enter leave
 * it, the host caret landing in text beside the node.
 *
 * Commit happens once per session (leaving or blur) as a single transaction, so the host's undo
 * treats one formula edit as one step. A formula nobody changed is not written back, so its
 * stored bytes survive the editor's re-serialization (D1); an emptied formula is removed.
 */
import type { NodeViewRendererProps } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import type { StructuredMathEditor, StructuredMathEditorFactory } from '../adapter/types';
import type { RenderResult } from '../render/katex';

export type InlineEditMode = 'inplace' | 'overlay' | 'popover';
export type EditMode = InlineEditMode | 'block' | 'source';
/** 'structured': edit the rendered formula (MathLive). 'source': edit its LaTeX text with a live preview. */
export type MathEditorKind = 'structured' | 'source';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutMetrics {
  id: string;
  mode: EditMode;
  nodeBefore: Rect;
  nodeAfter: Rect;
  lineBefore: Rect | null;
  lineAfter: Rect | null;
}

function toRect(r: DOMRect): Rect {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export interface MathNodeViewConfig {
  display: 'inline' | 'block';
  getInlineMode: () => InlineEditMode;
  getEditorKind: () => MathEditorKind;
  factory: StructuredMathEditorFactory;
  sourceFactory: StructuredMathEditorFactory;
  render: (latex: string, display: 'inline' | 'block') => RenderResult;
  macros?: () => Record<string, string> | undefined;
  registry: Map<string, MathNodeView>;
  onMetrics?: (m: LayoutMetrics) => void;
}

export interface OpenOptions {
  /**
   * The node was just inserted, empty and outside the undo history, to be filled in this
   * session. Leaving it records the finished formula as one insertion (one undo takes it away);
   * leaving it empty removes it without a trace.
   */
  fresh?: boolean;
}

interface Session {
  editor: StructuredMathEditor;
  mode: EditMode;
  portal?: HTMLElement;
  cleanup: (() => void)[];
  /** The user changed the value in this session. */
  dirty: boolean;
  /**
   * The value once the editor is mounted. MathLive reports typing asynchronously, so a quick
   * "type, Escape" ends the session before `change` arrives; comparing with this catches it.
   */
  baseline?: string;
  fresh: boolean;
}

/** Where a written-back node is, or was when it was removed. */
interface Written {
  pos: number;
  size: number;
  removed: boolean;
}

export class MathNodeView implements NodeView {
  readonly dom: HTMLElement;
  private readonly staticEl: HTMLElement;
  private node: PMNode;
  private session: Session | null = null;
  private pendingKey: KeyboardEvent | null = null;
  private consumedKey: KeyboardEvent | null = null;

  constructor(
    private readonly props: NodeViewRendererProps,
    private readonly cfg: MathNodeViewConfig,
  ) {
    this.node = props.node;
    const isBlock = cfg.display === 'block';
    this.dom = document.createElement(isBlock ? 'div' : 'span');
    this.dom.className = `mn-math ${isBlock ? 'mn-block' : 'mn-inline'}`;
    this.dom.setAttribute(isBlock ? 'data-math-block' : 'data-math-inline', '');
    this.dom.dataset['id'] = this.id;
    this.staticEl = document.createElement(isBlock ? 'div' : 'span');
    this.staticEl.className = 'mn-static';
    // ProseMirror would mark the whole node view `contenteditable=false`. Two reasons to
    // keep the wrapper editable and let only the static core opt out:
    //  1. Buffer zones (ProseMirror forum #8547): the browser then has caret positions
    //     around the core, so a selection can start at a paragraph-leading formula.
    //  2. MathLive stops accepting keystrokes when its host inherits `contenteditable=false`
    //     (observed with 0.110.0), and the field is mounted inside this wrapper.
    // `ignoreMutation` keeps ProseMirror from reading anything typed into the wrapper, and
    // its selection sync moves a caret out of the wrapper right after it lands there.
    this.dom.setAttribute('contenteditable', 'true');
    this.staticEl.setAttribute('contenteditable', 'false');
    if (!isBlock) this.dom.appendChild(makeBuffer());
    this.dom.appendChild(this.staticEl);
    if (!isBlock) this.dom.appendChild(makeBuffer());
    this.renderStatic();
    this.dom.addEventListener('mousedown', this.onMouseDown);
    cfg.registry.set(this.id, this);
  }

  get id(): string {
    return String(this.node.attrs['id'] ?? '');
  }

  get latex(): string {
    return String(this.node.attrs['latex'] ?? '');
  }

  isEditing(): boolean {
    return this.session !== null;
  }

  get currentEditor(): StructuredMathEditor | null {
    return this.session?.editor ?? null;
  }

  // ---------------------------------------------------------------- static

  renderStatic(latex: string = this.latex): void {
    const r = this.cfg.render(latex, this.cfg.display);
    if (r.ok) {
      this.staticEl.innerHTML = r.html;
      this.staticEl.classList.remove('mn-error');
      this.staticEl.removeAttribute('title');
    } else {
      this.staticEl.textContent = latex || '∅';
      this.staticEl.classList.add('mn-error');
      this.staticEl.title = r.message;
    }
  }

  private readonly onMouseDown = (ev: MouseEvent): void => {
    if (this.session || ev.button !== 0 || !this.props.editor.isEditable) return;
    if (!this.staticEl.contains(ev.target as globalThis.Node)) return;
    ev.preventDefault();
    this.open({ x: ev.clientX, y: ev.clientY });
  };

  // ---------------------------------------------------------------- session

  open(at?: { x: number; y: number } | { caret: 'start' | 'end' }, opts: OpenOptions = {}): void {
    if (this.session || !this.props.editor.isEditable) return;
    const kind = this.cfg.getEditorKind();
    const mode: EditMode = kind === 'source' ? 'source' : this.cfg.display === 'block' ? 'block' : this.cfg.getInlineMode();
    const before = this.measure();

    const factory = kind === 'source' ? this.cfg.sourceFactory : this.cfg.factory;
    const editor = factory.create({
      latex: this.latex,
      display: this.cfg.display,
      macros: this.cfg.macros?.(),
    });
    const session: Session = { editor, mode, cleanup: [], dirty: false, fresh: Boolean(opts.fresh) };
    this.session = session;
    const host = editor.element;
    host.classList.add('mn-field');
    // Do not set `contenteditable="false"` on the host: MathLive treats that as read-only
    // and stops accepting keystrokes (observed with 0.110.0).

    if (mode === 'block' || mode === 'inplace' || mode === 'source') {
      this.staticEl.style.display = 'none';
      this.dom.insertBefore(host, this.staticEl);
      this.dom.classList.add('mn-editing');
      if (mode === 'source') this.openPreview(session);
    } else {
      const portal = document.createElement('div');
      portal.className = `mn-portal mn-portal-${mode}`;
      portal.appendChild(host);
      document.body.appendChild(portal);
      session.portal = portal;
      this.copyTypography(portal);
      if (mode === 'overlay') {
        this.staticEl.style.visibility = 'hidden';
        // The placeholder is resized to the field's width. `nowrap` stops its content from
        // wrapping when narrower; it must NOT get `overflow: hidden`, which would move an
        // inline-block's baseline to its bottom edge and grow the line by ~10px.
        this.staticEl.style.whiteSpace = 'nowrap';
      }
      // The popover starts overlaid so the click point can be mapped to a caret position.
      let placement: 'overlay' | 'popover' = 'overlay';
      const reposition = (): void => this.positionPortal(portal, placement);
      reposition();
      const ro = new ResizeObserver(() => {
        if (mode === 'overlay') this.syncOverlayWidth(host);
        reposition();
      });
      ro.observe(host);
      window.addEventListener('scroll', reposition, true);
      window.addEventListener('resize', reposition);
      session.cleanup.push(() => {
        ro.disconnect();
        window.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
        portal.remove();
      });
      if (mode === 'popover') {
        session.cleanup.push(editor.on('change', ({ latex }) => this.renderStatic(latex)));
        session.cleanup.push(() => {
          placement = 'popover';
        });
        // Switch to the real popover placement once the caret has been placed.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (this.session !== session) return;
            placement = 'popover';
            reposition();
          }),
        );
      }
    }

    session.cleanup.push(
      editor.on('change', () => {
        session.dirty = true;
      }),
    );
    session.cleanup.push(
      editor.on('moveOut', ({ direction }) =>
        this.exit(direction === 'backward' || direction === 'upward' ? 'before' : 'after'),
      ),
    );
    session.cleanup.push(editor.on('copy', ({ latex, data }) => this.copyAsFormula(latex, data, editor)));

    // Capture phase: runs before the editor's own key handling (MathLive's is inside its shadow
    // root). It also remembers the key being dispatched, so that an exit triggered by `move-out`
    // (which fires synchronously inside the field's keydown handling) can stop that same keydown
    // from also reaching ProseMirror and moving the caret a second time.
    const onKeyDownCapture = (ev: KeyboardEvent): void => {
      this.pendingKey = ev;
      if (this.session === session) this.handleKey(ev, session);
    };
    host.addEventListener('keydown', onKeyDownCapture, true);
    session.cleanup.push(() => host.removeEventListener('keydown', onKeyDownCapture, true));

    const onFocusOut = (ev: FocusEvent): void => {
      const next = ev.relatedTarget as globalThis.Node | null;
      if (next && (host.contains(next) || session.portal?.contains(next))) return;
      // MathLive moves focus internally on mount; decide after the browser settles.
      setTimeout(() => {
        if (this.session === session && !editor.hasFocus()) this.commit();
      }, 0);
    };
    host.addEventListener('focusout', onFocusOut);
    session.cleanup.push(() => host.removeEventListener('focusout', onFocusOut));

    requestAnimationFrame(() => {
      if (this.session !== session) return;
      session.baseline = editor.getValue();
      if (at && 'x' in at) {
        editor.focusAt('end');
        editor.focusAt(editor.positionFromPoint(at.x, at.y));
      } else {
        editor.focusAt(at?.caret ?? 'end');
      }
      const after = this.measure();
      this.cfg.onMetrics?.({
        id: this.id,
        mode,
        nodeBefore: before.node,
        nodeAfter: after.node,
        lineBefore: before.line,
        lineAfter: after.line,
      });
    });
  }

  /** Keys the session decides before the editor sees them. */
  private handleKey(ev: KeyboardEvent, session: Session): void {
    if (ev.isComposing || ev.keyCode === 229 || ev.defaultPrevented) return;
    const mod = ev.metaKey || ev.ctrlKey;
    const consume = (): void => {
      ev.preventDefault();
      ev.stopPropagation();
      this.consumedKey = ev;
    };
    if (ev.key === 'Escape') {
      consume();
      this.exit('after');
    } else if (ev.key === 'Enter') {
      // Shift+Enter in the source of a block formula is a plain newline: source layout only.
      if (session.mode === 'source' && this.cfg.display === 'block' && ev.shiftKey && !mod) return;
      consume();
      if (mod || this.cfg.display === 'inline') this.exit('after');
      else session.editor.insertLineBreak();
    } else if (ev.key === 'Backspace' && !mod && session.editor.getValue() === '') {
      consume();
      this.exit('before');
    }
  }

  /**
   * Commit the current value and leave the field, placing the host caret before or after
   * the node. Usually called from inside the field's own keystroke handling (`move-out`,
   * Escape), so the field is torn down in a microtask: destroying it synchronously makes
   * MathLive finish the keystroke on a dead element (TypeError in its announcer).
   */
  exit(where: 'before' | 'after'): void {
    const key = this.pendingKey;
    if (key && !key.defaultPrevented) {
      key.preventDefault();
      key.stopPropagation();
      this.consumedKey = key;
    }
    const session = this.session;
    if (!session) return;
    this.session = null;
    const latex = session.editor.getValue();
    const land = (at: Written | null): void => {
      if (at) this.placeCaret(where === 'after' && !at.removed ? at.pos + at.size : at.pos, where);
    };
    if (session.fresh || latex.trim() === '') {
      // Replacing or removing the node detaches the field at once, which is as bad as destroying
      // it for a keystroke still in flight: finish once the keystroke is done.
      queueMicrotask(() => {
        this.teardown(session);
        land(this.write(session, latex));
      });
      return;
    }
    queueMicrotask(() => this.teardown(session));
    land(this.write(session, latex));
  }

  /** End the session and write the value back as ONE transaction. */
  commit(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    const latex = session.editor.getValue();
    this.teardown(session);
    this.write(session, latex);
  }

  /**
   * Write an ended session's value back. Only a value the user changed is written, so a formula
   * that was just looked at keeps its bytes (D1). An emptied formula is removed. A fresh formula
   * was inserted outside the history (see OpenOptions.fresh); it is put back in as one undoable
   * insertion, or dropped without a trace when it stayed empty.
   */
  private write(session: Session, latex: string): Written | null {
    const pos = this.props.getPos();
    if (pos === undefined) return null;
    const { view } = this.props.editor;
    const size = this.node.nodeSize;
    if (latex.trim() === '') {
      const tr = view.state.tr.delete(pos, pos + size);
      view.dispatch(session.fresh ? tr.setMeta('addToHistory', false) : tr);
      return { pos, size: 0, removed: true };
    }
    if (session.fresh) {
      const node = this.node.type.create({ ...this.node.attrs, latex });
      view.dispatch(view.state.tr.delete(pos, pos + size).setMeta('addToHistory', false));
      view.dispatch(view.state.tr.insert(pos, node));
      return { pos, size: node.nodeSize, removed: false };
    }
    const changed = session.dirty || (session.baseline !== undefined && latex !== session.baseline);
    if (changed && latex !== this.latex) {
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, latex }));
    } else {
      this.renderStatic();
    }
    return { pos, size, removed: false };
  }

  /**
   * Put the host caret in text next to `pos` and give the host the focus back. Beside a block
   * formula with no text on that side (the document's first or last node, another block
   * formula), an empty paragraph is added so there is somewhere to keep typing.
   */
  private placeCaret(pos: number, where: 'before' | 'after'): void {
    const { view } = this.props.editor;
    view.dispatch(caretBeside(view, pos, where === 'before' ? -1 : 1));
    view.focus();
  }

  private teardown(session: Session): void {
    for (const c of session.cleanup.splice(0)) c();
    session.editor.destroy();
    this.staticEl.style.display = '';
    this.staticEl.style.visibility = '';
    this.staticEl.style.width = '';
    this.staticEl.style.whiteSpace = '';
    this.dom.classList.remove('mn-editing');
  }

  /**
   * LaTeX copied inside the formula also goes on the clipboard as a formula node's HTML, so pasted
   * into the note it is a formula again; plain-text targets get the LaTeX. The whole of a block
   * formula stays a block formula, a part of one becomes inline. What does not render (a partial
   * source selection such as `\frac{a`) is left as text.
   */
  private copyAsFormula(latex: string, data: DataTransfer, editor: StructuredMathEditor): void {
    // MathLive may copy a formula with its source spacing and read it back without.
    const squash = (s: string) => s.replace(/\s+/g, '');
    const display = this.cfg.display === 'block' && squash(latex) === squash(editor.getValue()) ? 'block' : 'inline';
    const type = this.node.type.schema.nodes[display === 'block' ? 'mathBlock' : 'mathInline'];
    if (!type || latex.trim() === '' || !this.cfg.render(latex, display).ok) return;
    const dom = DOMSerializer.fromSchema(type.schema).serializeNode(type.create({ latex }));
    if (dom instanceof Element) data.setData('text/html', dom.outerHTML);
  }

  // ---------------------------------------------------------------- text-mode preview

  /** The live KaTeX render of the source being typed, floating below the node. */
  private openPreview(session: Session): void {
    const block = this.cfg.display === 'block';
    const portal = document.createElement('div');
    portal.className = `mn-portal mn-preview mn-preview-${this.cfg.display}`;
    const body = document.createElement('div');
    body.className = 'mn-preview-body';
    const note = document.createElement('div');
    note.className = 'mn-preview-note';
    portal.append(body, note);
    // Clicking the preview must not take the focus away from the source.
    portal.addEventListener('mousedown', (ev) => ev.preventDefault());
    document.body.appendChild(portal);
    session.portal = portal;
    this.copyTypography(portal);
    const keys = block ? 'Enter 换行 · Esc 完成' : 'Enter / Esc 完成 · 方向键到头离开';

    const render = (latex: string): void => {
      portal.classList.remove('mn-preview-error');
      if (latex.trim() === '') {
        body.textContent = '';
        note.textContent = `输入 LaTeX，例如 \\frac{a}{b} · ${keys}`;
        return;
      }
      const r = this.cfg.render(latex, this.cfg.display);
      if (r.ok) {
        body.innerHTML = r.html;
        note.textContent = keys;
      } else {
        // Keep the last good render visible; say what is wrong under it.
        portal.classList.add('mn-preview-error');
        note.textContent = r.position !== undefined ? `第 ${r.position + 1} 个字符附近：${r.message}` : r.message;
      }
    };
    const reposition = (): void => this.positionPreview(portal);
    render(session.editor.getValue());
    reposition();
    session.cleanup.push(
      session.editor.on('change', ({ latex }) => {
        render(latex);
        reposition();
      }),
    );
    const ro = new ResizeObserver(reposition);
    ro.observe(session.editor.element);
    ro.observe(portal);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    session.cleanup.push(() => {
      ro.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      portal.remove();
    });
  }

  /** Below the node (above it when there is no room), clamped to the viewport. */
  private positionPreview(portal: HTMLElement): void {
    const anchor = this.dom.getBoundingClientRect();
    const w = portal.offsetWidth;
    const h = portal.offsetHeight;
    const margin = 8;
    let left = this.cfg.display === 'block' ? anchor.left + (anchor.width - w) / 2 : anchor.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight - margin && anchor.top - h - 6 > margin) top = anchor.top - h - 6;
    portal.style.left = `${left + window.scrollX}px`;
    portal.style.top = `${top + window.scrollY}px`;
  }

  // ---------------------------------------------------------------- portal helpers

  private copyTypography(portal: HTMLElement): void {
    const cs = getComputedStyle(this.dom);
    portal.style.fontFamily = cs.fontFamily;
    portal.style.fontSize = cs.fontSize;
    portal.style.lineHeight = cs.lineHeight;
    portal.style.color = cs.color;
  }

  private positionPortal(portal: HTMLElement, placement: 'overlay' | 'popover'): void {
    const rect = this.staticEl.getBoundingClientRect();
    const left = rect.left + window.scrollX;
    const top = placement === 'overlay' ? rect.top + window.scrollY : rect.bottom + window.scrollY + 6;
    portal.style.left = `${left}px`;
    portal.style.top = `${top}px`;
    if (placement === 'overlay') portal.style.height = `${rect.height}px`;
    else portal.style.height = '';
  }

  /** Keep the hidden placeholder exactly as wide as the floating field so the following text reflows with it. */
  private syncOverlayWidth(host: HTMLElement): void {
    const w = host.getBoundingClientRect().width;
    if (w > 0) this.staticEl.style.width = `${w}px`;
  }

  private measure(): { node: Rect; line: Rect | null } {
    const line = this.dom.closest('p, li, h1, h2, h3, h4, blockquote');
    return {
      node: toRect(this.dom.getBoundingClientRect()),
      line: line ? toRect(line.getBoundingClientRect()) : null,
    };
  }

  // ---------------------------------------------------------------- ProseMirror NodeView API

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs['latex'] !== this.node.attrs['latex'];
    const idChanged = node.attrs['id'] !== this.node.attrs['id'];
    if (idChanged) {
      this.cfg.registry.delete(this.id);
      this.cfg.registry.set(String(node.attrs['id'] ?? ''), this);
    }
    this.node = node;
    this.dom.dataset['id'] = this.id;
    if (!this.session && changed) this.renderStatic();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('mn-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('mn-selected');
  }

  stopEvent(ev: Event): boolean {
    if (ev === this.consumedKey) return true;
    const s = this.session;
    if (!s) {
      // We open the field ourselves on mousedown; keep ProseMirror from turning the click into a node selection.
      return ev.type === 'mousedown' && this.staticEl.contains(ev.target as globalThis.Node);
    }
    const path = ev.composedPath();
    return path.includes(s.editor.element) || (s.portal ? path.includes(s.portal) : false);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    const session = this.session;
    if (session) {
      this.session = null;
      this.teardown(session);
    }
    this.dom.removeEventListener('mousedown', this.onMouseDown);
    if (this.cfg.registry.get(this.id) === this) this.cfg.registry.delete(this.id);
  }
}

function caretBeside(view: EditorView, pos: number, dir: -1 | 1): Transaction {
  const { state } = view;
  const $pos = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)));
  if ($pos.parent.inlineContent) return state.tr.setSelection(TextSelection.create(state.doc, $pos.pos));
  const neighbour = dir > 0 ? $pos.nodeAfter : $pos.nodeBefore;
  if (neighbour?.isTextblock) return state.tr.setSelection(TextSelection.create(state.doc, $pos.pos + dir));
  const paragraph = state.schema.nodes['paragraph'];
  if (!paragraph || !$pos.parent.canReplaceWith($pos.index(), $pos.index(), paragraph)) {
    return state.tr.setSelection(TextSelection.near($pos, dir));
  }
  const tr = state.tr.insert($pos.pos, paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, $pos.pos + 1)).setMeta('addToHistory', false);
}

function makeBuffer(): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'mn-buf';
  img.alt = '';
  img.setAttribute('aria-hidden', 'true');
  // Images are draggable by default; a mousedown on one would start a native image
  // drag instead of anchoring a text selection at the line start.
  img.draggable = false;
  return img;
}
