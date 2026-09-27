/**
 * The README's GIFs. Each test records one interaction with the playground and writes
 * docs/media/<name>.gif. Scenes use the sample note, or a short note of their own when the
 * sample would only be clutter. Each ends by checking the note itself, so a GIF never shows
 * something the document does not hold.
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { JSONContent } from '@tiptap/core';
import { Demo } from './recorder';

/** 1.5× the 900px viewport: sharp on high-density screens, still a few hundred KB per GIF. */
const WIDTH = 1350;

function save(demo: Demo, name: string): void {
  const bytes = demo.saveGif(fileURLToPath(new URL(`../../../docs/media/${name}.gif`, import.meta.url)), { width: WIDTH });
  console.log(`${name}.gif  ${Math.round(bytes / 1024)} KB`);
}

/** Scroll the first `selector` whose text starts with `text` to `offset` px below the top. */
async function scrollToText(page: Page, selector: string, text: string, offset: number): Promise<void> {
  await page.evaluate(
    ({ selector, text, offset }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent?.startsWith(text));
      if (!el) throw new Error(`no ${selector} starting with ${text}`);
      scrollTo(0, el.getBoundingClientRect().top + scrollY - offset);
    },
    { selector, text, offset },
  );
}

/** Replace the sample note with the demo's own. */
async function setNote(page: Page, ...content: JSONContent[]): Promise<void> {
  await page.evaluate((content) => {
    (window as unknown as { __mn: { editor: any } }).__mn.editor.commands.setContent({ type: 'doc', content });
  }, content);
}

const heading = (text: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const paragraph = (text?: string): JSONContent => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

/** The note's non-empty blocks, formulas as [latex] ([[latex]] for block formulas). */
function outline(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    (window as unknown as { __mn: { editor: any } }).__mn.editor.state.doc.forEach((block: any) => {
      if (block.type.name === 'mathBlock') return out.push(`[[${block.attrs.latex}]]`);
      let s = '';
      block.forEach((n: any) => (s += n.isText ? n.text : n.type.name === 'mathInline' ? `[${n.attrs.latex}]` : ''));
      if (s) out.push(s);
    });
    return out;
  });
}

/** The on-screen box of the first occurrence of `text` in the note. */
function textBox(page: Page, text: string) {
  return page.evaluate((text) => {
    const walker = document.createTreeWalker(document.querySelector('.ProseMirror')!, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = n.textContent!.indexOf(text);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, at + text.length);
      const { x, y, width, height } = range.getClientRects()[0]!;
      return { x, y, width, height };
    }
    throw new Error(`no text ${text}`);
  }, text);
}

function status(page: Page, text: string) {
  return page.getByTestId('status').filter({ hasText: text }).waitFor();
}

test('convert-all', async ({ page }) => {
  const demo = new Demo(page, { x: 780, y: 440 });
  await demo.open();
  await scrollToText(page, '.ProseMirror h2', '口述笔记', 76);
  const before = await outline(page);

  await demo.start();
  await demo.pause(700);
  // The caret goes where one was writing; the conversion then keeps this part of the note in view.
  await demo.click(page.locator('.ProseMirror p').last(), { fx: 0.97, ms: 700 });
  await demo.pause(500);
  await demo.click(page.getByTestId('scan'), { ms: 800 });
  await status(page, '处公式描述转成公式');
  expect(await outline(page)).toContain('圆的面积是 [\\pi r^{2}]，周长是 [2\\pi r]；这半句只是普通笔记。');
  await demo.pause(500);
  await demo.moveTo(demo.home, { ms: 700 });
  await demo.pause(2800);
  await demo.press('ControlOrMeta+z', ['⌘', 'Z']);
  await demo.pause(1500);
  await demo.stop();
  expect(await outline(page)).toEqual(before);
  save(demo, 'convert-all');
});

test.describe(() => {
  test.use({ viewport: { width: 900, height: 470 } });

  test('describe', async ({ page }) => {
    const demo = new Demo(page, { x: 780, y: 250 });
    await demo.open();
    await setNote(page, heading('课堂笔记'), paragraph('定积分：'), paragraph('极限：'));
    const line = (i: number) => page.locator('.ProseMirror p').nth(i);
    const input = page.getByTestId('input');

    await demo.start();
    await demo.pause(600);
    await demo.click(line(0), { fx: 0.6 });
    await demo.pause(300);
    await demo.click(input, { fx: 0.25, ms: 600 });
    await demo.type('(x+1)^2从1到2的定积分', 65);
    await demo.pause(250);
    await demo.press('Enter', ['⏎']);
    await status(page, '定积分');
    await demo.pause(1300);
    await demo.click(line(1), { fx: 0.6, ms: 700 });
    await demo.pause(300);
    await demo.click(input, { fx: 0.25, ms: 600 });
    await demo.type('limit->0(sinx/x)', 65);
    await demo.pause(250);
    await demo.press('Enter', ['⏎']);
    await page.locator('.mn-chip').waitFor();
    await demo.pause(1600);
    // AI was not sure: it says how it read the input, and the other reading is one click away.
    await demo.click(page.locator('.mn-chip'), { ms: 700 });
    await status(page, '已改为');
    await demo.pause(1200);
    await demo.moveTo(demo.home, { ms: 700 });
    await demo.pause(1500);
    await demo.stop();
    expect(await outline(page)).toEqual([
      '课堂笔记',
      '定积分：[\\int_1^2 (x+1)^2 \\, dx]',
      '极限：[\\lim_{x \\to 0} \\sin\\left(\\frac{x}{x}\\right)]',
    ]);
    save(demo, 'describe');
  });

  test('visual-edit', async ({ page }) => {
    const demo = new Demo(page, { x: 780, y: 300 });
    await demo.open();
    // Open and leave a formula once, so the recording does not catch MathLive loading its fonts.
    await page.locator('.mn-block .mn-static').first().click();
    await page.locator('math-field').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('math-field').waitFor({ state: 'detached' });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await demo.start();
    await demo.pause(700);
    // Click the 0 under lim: the formula opens where it is, the caret right after that 0.
    const zero = page.locator('.mn-inline .mn-static').first().locator('.msupsub .mord', { hasText: /^0$/ }).last();
    await demo.click(zero, { fx: 0.8, fy: 0.55, ms: 800 });
    const field = page.locator('math-field');
    await field.waitFor();
    await demo.pause(700);
    await demo.press('Backspace', ['⌫']);
    await demo.pause(250);
    await demo.type('oo', 220);
    await demo.pause(700);
    const box = (await field.boundingBox())!;
    await demo.click({ x: box.x + box.width - 4, y: box.y + box.height * 0.55 }, { ms: 600 });
    await demo.pause(350);
    await demo.press('Backspace', ['⌫']);
    await demo.type('0', 150);
    await demo.pause(700);
    // → at the end leaves the formula; the caret goes on in the text.
    await demo.press('ArrowRight', ['→']);
    await field.waitFor({ state: 'detached' });
    await demo.pause(900);
    await demo.moveTo(demo.home, { ms: 700 });
    await demo.pause(1500);
    await demo.stop();
    expect((await outline(page))[1]!.replace(/\s/g, '')).toBe('考虑极限[\\lim_{x\\to\\infty}\\frac{\\sinx}{x}=0]，它是最基本的三角极限之一。');
    save(demo, 'visual-edit');
  });

  test('source-mode', async ({ page }) => {
    const demo = new Demo(page, { x: 780, y: 300 });
    await demo.open();
    await scrollToText(page, '.ProseMirror p', '欧拉公式', 70);

    await demo.start();
    await demo.pause(600);
    await demo.click(page.locator('[data-testid=editor-kind] [data-value=source]'), { ms: 800 });
    await demo.pause(500);
    // In text mode a click shows the formula's LaTeX, with a live preview under it.
    await demo.click(page.locator('.mn-block .mn-static').nth(1), { fx: 0.52, ms: 700 });
    const source = page.locator('textarea.mn-source-field');
    await source.waitFor();
    await demo.pause(900);
    const box = (await source.boundingBox())!;
    await demo.click({ x: box.x + 15, y: box.y + box.height / 2 }, { ms: 600 });
    await demo.pause(250);
    await demo.type('\\det', 140);
    await demo.pause(600);
    await demo.click({ x: box.x + box.width - 30, y: box.y + box.height / 2 }, { ms: 600 });
    await demo.pause(250);
    await demo.type(' = -2', 140);
    await demo.pause(1100);
    await demo.press('Escape', ['esc']);
    await source.waitFor({ state: 'detached' });
    await demo.pause(700);
    await demo.moveTo(demo.home, { ms: 700 });
    await demo.pause(1500);
    await demo.stop();
    expect(await outline(page)).toContain('[[\\det\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} = -2]]');
    save(demo, 'source-mode');
  });

  test('typing', async ({ page }) => {
    const demo = new Demo(page, { x: 780, y: 250 });
    await demo.open();
    await setNote(page, paragraph());

    await demo.start();
    await demo.pause(600);
    await demo.click(page.locator('.ProseMirror p').first(), { fx: 0.3 });
    await demo.pause(300);
    // Markdown as in Typora: `## ` makes a heading, `$…$` a formula.
    await demo.type('## 小结');
    await demo.pause(300);
    await demo.press('Enter');
    await demo.type('勾股定理 $a^2+b^2=c^2$');
    await demo.pause(500);
    await demo.press('Enter');
    await demo.type('圆的面积 pi r^2 与半径的平方成正比。');
    await demo.pause(500);
    // Select an informal formula; the bubble turns it into a real one.
    const pr2 = await textBox(page, 'pi r^2');
    const y = pr2.y + pr2.height / 2;
    await demo.drag({ x: pr2.x + 1, y }, { x: pr2.x + pr2.width - 1, y }, 700);
    const bubble = page.getByTestId('bubble-convert');
    await bubble.waitFor();
    await demo.pause(500);
    await demo.click(bubble, { ms: 600 });
    await status(page, '已把选中文字转为公式');
    await demo.pause(900);
    await demo.moveTo(demo.home, { ms: 700 });
    await demo.pause(1500);
    await demo.stop();
    expect(await outline(page)).toEqual(['小结', '勾股定理 [a^2+b^2=c^2]', '圆的面积 [\\pi r^2] 与半径的平方成正比。']);
    save(demo, 'typing');
  });
});
