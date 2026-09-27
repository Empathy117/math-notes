/**
 * Runs in the page before the app (addInitScript, so it must stay self-contained). Headless
 * screenshots have no mouse pointer: draw one that follows the mouse and hides while typing, a
 * ripple where it clicks, and a caption for the shortcuts a demo presses (`window.__demo.keys`).
 */
export function overlay(): void {
  const ARROW =
    '<svg width="19" height="26" viewBox="0 0 16 22"><path d="M1.5 1.5v15.2l3.9-3.6 2.6 6.1 2.7-1.2-2.6-6h5.3z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const BEAM_PATH = 'M3.5 2.5c2 0 3.5.6 3.5 2v13c0 1.4-1.5 2-3.5 2M10.5 2.5c-2 0-3.5.6-3.5 2v13c0 1.4 1.5 2 3.5 2';
  const BEAM = `<svg width="14" height="22" viewBox="0 0 14 22"><path d="${BEAM_PATH}" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="${BEAM_PATH}" fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  const Z = 2147483000;
  const css = `
    .demo-pointer { position: fixed; left: 0; top: 0; pointer-events: none; z-index: ${Z + 2}; visibility: hidden; }
    .demo-pointer svg { display: block; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.28)); }
    .demo-ripple { position: fixed; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
      background: rgba(53,99,233,.18); border: 2px solid rgba(53,99,233,.5); pointer-events: none; z-index: ${Z + 1};
      animation: demo-ripple .45s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.2); opacity: 0 } }
    .demo-keys { position: fixed; left: 50%; bottom: 148px; transform: translateX(-50%); display: flex; gap: 6px;
      padding: 7px; border-radius: 12px; background: rgba(29,33,40,.9); box-shadow: 0 8px 24px rgba(16,24,40,.25);
      pointer-events: none; z-index: ${Z}; opacity: 0; transition: opacity .15s; }
    .demo-keys.on { opacity: 1; }
    .demo-key { min-width: 30px; padding: 5px 9px; border-radius: 7px; background: rgba(255,255,255,.14); color: #fff;
      text-align: center; font: 600 16px/1.25 system-ui, -apple-system, 'PingFang SC', sans-serif; }
  `;

  let pointer: HTMLElement;
  let keys: HTMLElement;
  let hideKeys = 0;
  let keysShownAt = 0;
  let shape = '';

  const setShape = (next: 'arrow' | 'beam'): void => {
    if (next === shape) return;
    shape = next;
    pointer.innerHTML = next === 'beam' ? BEAM : ARROW;
  };

  /** An I-beam over text the user can type into, the arrow everywhere else. */
  const shapeAt = (x: number, y: number): 'arrow' | 'beam' => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'arrow';
    const cursor = getComputedStyle(el).cursor;
    if (cursor === 'text') return 'beam';
    if (cursor !== 'auto') return 'arrow';
    return el.closest('textarea, input, [contenteditable="true"]') ? 'beam' : 'arrow';
  };

  const place = (x: number, y: number): void => {
    setShape(shapeAt(x, y));
    // The arrow's hotspot is its tip, the I-beam's its middle.
    const [dx, dy] = shape === 'beam' ? [7, 11] : [2, 2];
    pointer.style.transform = `translate(${x - dx}px, ${y - dy}px)`;
    pointer.style.visibility = 'visible';
  };

  const mount = (): void => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    pointer = document.createElement('div');
    pointer.className = 'demo-pointer';
    keys = document.createElement('div');
    keys.className = 'demo-keys';
    document.body.append(keys, pointer);
    setShape('arrow');

    addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true);
    addEventListener(
      'mousedown',
      (e) => {
        const ripple = document.createElement('div');
        ripple.className = 'demo-ripple';
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 500);
      },
      true,
    );
    addEventListener(
      'keydown',
      () => {
        // macOS hides the pointer while typing, until the mouse moves again.
        pointer.style.visibility = 'hidden';
        // A caption belongs to the keys it was shown for: other typing takes it away.
        if (performance.now() - keysShownAt > 200) keys.classList.remove('on');
      },
      true,
    );
  };

  (window as unknown as { __demo: unknown }).__demo = {
    keys(labels: string[], ms = 1100): void {
      keys.replaceChildren(
        ...labels.map((l) => {
          const k = document.createElement('span');
          k.className = 'demo-key';
          k.textContent = l;
          return k;
        }),
      );
      keys.classList.add('on');
      keysShownAt = performance.now();
      clearTimeout(hideKeys);
      hideKeys = window.setTimeout(() => keys.classList.remove('on'), ms);
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}
