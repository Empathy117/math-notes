/**
 * Copy and paste with formulas: a copy of the note keeps its formulas in the plain text as $…$ and
 * $$…$$, a copy made inside a formula (either editor) is its LaTeX and pastes into the note as a
 * formula, and a formula pasted into the source loses its $.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.waitForSelector('.mn-inline .mn-static');
  await page.waitForFunction(() => Boolean((window as unknown as { __mn?: unknown }).__mn));
}

function latexOf(page: Page, which: 'mathInline' | 'mathBlock') {
  return page.evaluate((which) => {
    const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
    const out: string[] = [];
    ed.state.doc.descendants((n: any) => {
      if (n.type.name === which) out.push(n.attrs.latex);
    });
    return out;
  }, which);
}

/** What the last copy put on the clipboard. */
function clipboard(page: Page) {
  return page.evaluate(async () => {
    const out = { plain: '', html: '' };
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/plain')) out.plain = await (await item.getType('text/plain')).text();
      if (item.types.includes('text/html')) out.html = await (await item.getType('text/html')).text();
    }
    return out;
  });
}

async function clickFormula(page: Page, selector: string, index: number) {
  const box = await page.locator(selector).nth(index).boundingBox();
  if (!box) throw new Error(`no box for ${selector} #${index}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Select from the start of `first` to the end of `last` (text occurrences), with the editor focused. */
async function selectBetween(page: Page, first: string, last: string) {
  await page.locator('.ProseMirror p').last().click();
  await page.evaluate(
    ({ first, last }) => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      let from = -1;
      let to = -1;
      ed.state.doc.descendants((n: any, pos: number) => {
        if (!n.isText) return;
        if (from < 0 && n.text.includes(first)) from = pos + n.text.indexOf(first);
        if (to < 0 && n.text.includes(last)) to = pos + n.text.indexOf(last) + last.length;
      });
      ed.commands.setTextSelection({ from, to });
    },
    { first, last },
  );
}

async function caretAtEnd(page: Page) {
  await page.locator('.ProseMirror p').last().click();
  await page.evaluate(() => {
    const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
  });
}

test.beforeEach(async ({ page }) => {
  await open(page);
});

test('a copy of the note has its formulas as $…$ and $$…$$ in plain text; pasted back they are formulas', async ({ page }) => {
  const inline = (await latexOf(page, 'mathInline'))[0]!;
  const block = (await latexOf(page, 'mathBlock'))[0]!;
  await selectBetween(page, '考虑极限', '欧拉公式');
  await page.keyboard.press('ControlOrMeta+c');
  const plain = `考虑极限 $${inline}$，它是最基本的三角极限之一。\n\n$$\n${block}\n$$\n\n欧拉公式`;
  expect((await clipboard(page)).plain).toBe(plain);

  const input = page.getByTestId('input');
  await input.click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(input).toHaveValue(plain);

  await caretAtEnd(page);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await latexOf(page, 'mathInline')).at(-1)).toBe(inline);
  expect((await latexOf(page, 'mathBlock')).at(-1)).toBe(block);
});

test('in visual mode a copied formula is its stored LaTeX, and pastes into the note as a formula', async ({ page }) => {
  await page.locator('[data-testid=editor-kind] [data-value=structured]').click();
  await clickFormula(page, '.mn-inline .mn-static', 0);
  await page.waitForFunction(() => Boolean((document.querySelector('math-field') as any)?.hasFocus()));
  // Nothing selected: MathLive copies the whole formula.
  await page.keyboard.press('ControlOrMeta+c');
  const copied = await clipboard(page);
  // MathLive's own serialization, without the \displaylimits the editor gets (latex-shims).
  expect(copied.plain).toBe('\\lim_{x\\to0}\\frac{\\sin x}{x}=1');
  expect(copied.html).toContain('data-math-inline');

  await page.keyboard.press('Escape');
  await caretAtEnd(page);
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(async () => (await latexOf(page, 'mathInline')).at(-1)).toBe('\\lim_{x\\to0}\\frac{\\sin x}{x}=1');
});

test.describe('text mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.locator('[data-testid=editor-kind] [data-value=source]').click();
  });

  test('copied source pastes into the note as a formula; a $…$ formula pastes into the source without its $', async ({ page }) => {
    const original = (await latexOf(page, 'mathInline'))[0]!;
    await clickFormula(page, '.mn-inline .mn-static', 0);
    const input = page.locator('input.mn-source-field');
    await expect(input).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    const copied = await clipboard(page);
    expect(copied.plain).toBe(original);
    expect(copied.html).toContain('data-math-inline');

    await page.keyboard.press('Escape');
    await caretAtEnd(page);
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await latexOf(page, 'mathInline')).at(-1)).toBe(original);

    await page.evaluate(() => navigator.clipboard.writeText('$y^2$'));
    await clickFormula(page, '.mn-inline .mn-static', 1);
    await expect(input).toBeFocused();
    await page.keyboard.type(' + ');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(input).toHaveValue('e^{i\\pi} + 1 = 0 + y^2');
  });

  test('a whole block formula copies as a block formula, a part of it as inline, a part that does not render as text', async ({ page }) => {
    await clickFormula(page, '.mn-block .mn-static', 0);
    const area = page.locator('textarea.mn-source-field');
    await expect(area).toBeFocused();
    const select = (part: string | null) =>
      area.evaluate((el: HTMLTextAreaElement, part) => {
        const at = part === null ? 0 : el.value.indexOf(part);
        el.setSelectionRange(at, part === null ? el.value.length : at + part.length);
      }, part);

    await select(null);
    await page.keyboard.press('ControlOrMeta+c');
    expect((await clipboard(page)).html).toContain('data-math-block');

    await select('\\frac{19}{3}');
    await page.keyboard.press('ControlOrMeta+c');
    const part = await clipboard(page);
    expect(part.plain).toBe('\\frac{19}{3}');
    expect(part.html).toContain('data-math-inline');

    await select('\\frac{(x+1)^3}');
    await page.keyboard.press('ControlOrMeta+c');
    const broken = await clipboard(page);
    expect(broken.plain).toBe('\\frac{(x+1)^3}');
    expect(broken.html).toBe('');
  });
});
