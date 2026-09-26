/**
 * Typing inside formulas, text mode, and the conversion paths added after S1: Space and Enter
 * stay in the formula, arrows at the edge leave it, text mode edits the source with a live
 * preview, selected text and the whole note convert to formulas.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
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

function docText(page: Page) {
  return page.evaluate(() => (window as unknown as { __mn: { editor: any } }).__mn.editor.state.doc.textContent as string);
}

/** Click a formula's static render to open it, then put the caret at the end. */
async function clickFormula(page: Page, selector: string, index: number, fx = 0.5) {
  const box = await page.locator(selector).nth(index).boundingBox();
  if (!box) throw new Error(`no box for ${selector} #${index}`);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2);
}

async function openStructured(page: Page, selector: string, index: number) {
  await clickFormula(page, selector, index);
  await page.waitForFunction(() => Boolean((document.querySelector('math-field') as any)?.hasFocus()));
  await page.evaluate(() => {
    const mf = document.querySelector('math-field') as any;
    mf.position = mf.lastOffset;
  });
}

function field(page: Page) {
  return page.evaluate(() => {
    const mf = document.querySelector('math-field') as any;
    return mf ? { exists: true, value: mf.getValue('latex') as string } : { exists: false, value: '' };
  });
}

/** Select from the start of `first` to the end of `last` (text occurrences), with the editor focused. */
async function selectBetween(page: Page, first: string, last: string) {
  await page.locator('.ProseMirror p').first().click();
  await page.evaluate(
    ({ first, last }) => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      let from = -1;
      let to = -1;
      ed.state.doc.descendants((n: any, pos: number) => {
        if (!n.isText) return;
        if (from < 0 && n.text.includes(first)) from = pos + n.text.indexOf(first);
        if (n.text.includes(last)) to = pos + n.text.indexOf(last) + last.length;
      });
      ed.commands.setTextSelection({ from, to });
    },
    { first, last },
  );
}

/** Keys one by one, paced: headless Chromium delivers them faster than the editors settle. */
async function keys(page: Page, ...list: string[]) {
  for (const k of list) {
    await page.keyboard.press(k);
    await page.waitForTimeout(30);
  }
}

test.describe('typing inside a formula', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('Space types a visible space; around operators TeX keeps its own spacing', async ({ page }) => {
    await openStructured(page, '.mn-inline .mn-static', 1); // e^{i\pi} + 1 = 0
    await keys(page, 'Space', 'a', 'Space', 'b', 'Space', 'Equal', 'Space', '2');
    await expect.poll(async () => (await field(page)).value.replace(/\s/g, '')).toMatch(/=0\\;a\\;b=2$/);
    await keys(page, 'Escape');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    expect((await latexOf(page, 'mathInline'))[1]!.replace(/\s/g, '')).toMatch(/=0\\;a\\;b=2$/);
  });

  test('Space inside an exponent still steps out of it', async ({ page }) => {
    await openStructured(page, '.mn-inline .mn-static', 1);
    await keys(page, '+', 'y', '^', 'n', 'Space', 'z');
    await expect.poll(async () => (await field(page)).value.replace(/\s/g, '')).toMatch(/\+y\^\{?n\}?z$/);
  });

  test('Enter in a block formula starts a new line; the result is gathered and renders', async ({ page }) => {
    await openStructured(page, '.mn-block .mn-static', 0);
    await keys(page, 'Enter', 'y', '=', '1');
    await expect.poll(() => field(page)).toMatchObject({ exists: true });
    await keys(page, 'Enter', 'z');
    await keys(page, 'Escape');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    const block = (await latexOf(page, 'mathBlock'))[0]!.replace(/\s/g, '');
    expect(block).toMatch(/^\\begin\{gathered\}\\int.*\\\\y=1\\\\z\\end\{gathered\}$/);
    await expect(page.locator('.mn-block .mn-static').first()).not.toHaveClass(/mn-error/);
  });

  test('Space in a row of a multi-line formula types a space instead of leaving the environment', async ({ page }) => {
    await openStructured(page, '.mn-block .mn-static', 0);
    await keys(page, 'Enter', 'y', 'Space', 'z');
    await expect.poll(async () => (await field(page)).value.replace(/\s/g, '')).toMatch(/\\\\y\\;z\\end\{gathered\}$/);
  });

  test('Enter in an inline formula finishes it and leaves the caret after it', async ({ page }) => {
    await openStructured(page, '.mn-inline .mn-static', 1);
    await keys(page, 'Enter');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    const nodeBefore = await page.evaluate(() => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      return ed.state.selection.$from.nodeBefore?.type.name ?? null;
    });
    expect(nodeBefore).toBe('mathInline');
  });

  test('typing dx stores \\mathrm{d}, which KaTeX renders', async ({ page }) => {
    await openStructured(page, '.mn-inline .mn-static', 1);
    await keys(page, '+', 'd', 'x');
    await keys(page, 'Escape');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    const latex = (await latexOf(page, 'mathInline'))[1]!;
    expect(latex).not.toContain('differentialD');
    await expect(page.locator('.mn-inline .mn-static').nth(1)).not.toHaveClass(/mn-error/);
  });

  test('a formula opened and left alone keeps its stored bytes', async ({ page }) => {
    const before = await latexOf(page, 'mathInline');
    await openStructured(page, '.mn-inline .mn-static', 0);
    await keys(page, 'Escape');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    expect(await latexOf(page, 'mathInline')).toEqual(before);
  });

  test('Backspace in an emptied formula removes it', async ({ page }) => {
    const count = (await latexOf(page, 'mathInline')).length;
    await openStructured(page, '.mn-inline .mn-static', 1);
    await page.evaluate(() => (document.querySelector('math-field') as any).setValue(''));
    await keys(page, 'Backspace');
    await expect.poll(async () => (await latexOf(page, 'mathInline')).length).toBe(count - 1);
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
  });
});

test.describe('new formulas from the keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    // A real click gives the editor DOM focus; the caret is then set directly, because headless
    // Chromium syncs a clicked selection into ProseMirror later than the next key arrives.
    await page.locator('.ProseMirror p').last().click();
    await page.evaluate(() => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    });
  });

  test(`${'Cmd/Ctrl'}+Shift+E with nothing selected opens an empty formula; one undo takes it away`, async ({ page }) => {
    const before = await latexOf(page, 'mathInline');
    await page.keyboard.press('ControlOrMeta+Shift+E');
    await page.waitForFunction(() => Boolean((document.querySelector('math-field') as any)?.hasFocus()));
    await keys(page, 'x', '+', '1', 'ArrowRight');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    await expect.poll(() => latexOf(page, 'mathInline')).toEqual([...before, 'x+1']);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => latexOf(page, 'mathInline')).toEqual(before);
  });

  test('an empty new formula left with Escape leaves nothing behind', async ({ page }) => {
    const text = await docText(page);
    const before = await latexOf(page, 'mathInline');
    await page.keyboard.press('ControlOrMeta+Shift+E');
    await page.waitForFunction(() => Boolean((document.querySelector('math-field') as any)?.hasFocus()));
    await keys(page, 'Escape');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    expect(await latexOf(page, 'mathInline')).toEqual(before);
    expect(await docText(page)).toBe(text);
  });

  test('$…$ typed in text becomes a formula', async ({ page }) => {
    await page.keyboard.type(' $a+b$');
    await expect.poll(async () => (await latexOf(page, 'mathInline')).at(-1)).toBe('a+b');
  });

  test('$$ on an empty line opens a block formula; leaving it at the end of the note adds a line to write on', async ({ page }) => {
    await page.keyboard.press('Enter');
    await page.keyboard.type('$$');
    await page.waitForFunction(() => Boolean((document.querySelector('.mn-block math-field') as any)?.hasFocus()));
    await keys(page, 'y', '=', '2', 'ArrowRight');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    await expect.poll(async () => (await latexOf(page, 'mathBlock')).at(-1)).toBe('y=2');
    await page.keyboard.type('after');
    const last = await page.evaluate(() => (window as unknown as { __mn: { editor: any } }).__mn.editor.state.doc.lastChild.textContent);
    expect(last).toBe('after');
  });
});

test.describe('text mode', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.locator('[data-testid=editor-kind] [data-value=source]').click();
  });

  test('a click shows the LaTeX source with a live preview; → at the end leaves; one undo reverts', async ({ page }) => {
    const original = (await latexOf(page, 'mathInline'))[1]!;
    await clickFormula(page, '.mn-inline .mn-static', 1);
    const input = page.locator('input.mn-source-field');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(original);
    const preview = page.locator('.mn-preview');
    await expect(preview.locator('.katex')).toBeVisible();

    await page.keyboard.type(' + \\sqrt{2}');
    await expect(preview.locator('annotation')).toHaveText(`${original} + \\sqrt{2}`);
    await page.keyboard.type(' \\frac{');
    await expect(preview).toHaveClass(/mn-preview-error/);
    await keys(page, 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace', 'Backspace');
    await expect(preview).not.toHaveClass(/mn-preview-error/);

    await keys(page, 'ArrowRight');
    await expect(input).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    expect((await latexOf(page, 'mathInline'))[1]).toBe(`${original} + \\sqrt{2}`);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await latexOf(page, 'mathInline'))[1]).toBe(original);
  });

  test('Enter in a block formula source adds a formula line', async ({ page }) => {
    await clickFormula(page, '.mn-block .mn-static', 0, 0.3);
    const area = page.locator('textarea.mn-source-field');
    await expect(area).toBeFocused();
    await keys(page, 'End', 'Enter');
    await page.keyboard.type('y = 1');
    await keys(page, 'Escape');
    await expect(area).toHaveCount(0);
    const block = (await latexOf(page, 'mathBlock'))[0]!;
    expect(block).toMatch(/^\\begin\{gathered\}\n[\s\S]* \\\\\ny = 1\n\\end\{gathered\}$/);
    await expect(page.locator('.mn-block .mn-static').first()).not.toHaveClass(/mn-error/);
  });
});

test.describe('converting text', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('selecting text shows a bubble whose button converts it', async ({ page }) => {
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' sin x');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
      await page.waitForTimeout(40);
    }
    const button = page.getByTestId('bubble-convert');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByTestId('status')).toContainText('已把选中文字转为公式');
    await expect.poll(async () => (await latexOf(page, 'mathInline')).at(-1)).toBe('\\sin x');
    await expect(button).toBeHidden();
  });

  test('converting a selection across paragraphs changes only the descriptions in it', async ({ page }) => {
    const text = await docText(page);
    await selectBetween(page, '下面几段是听写进来的', '复习时把这几条再抄一遍。');
    const button = page.getByTestId('bubble-convert');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByTestId('status')).toContainText('已把选中文字里的 5 处公式描述转成公式');
    // Every sentence around the descriptions is still there, paragraph by paragraph.
    const paragraphs = await page.evaluate(() => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      const out: string[] = [];
      ed.state.doc.forEach((n: any) => out.push(n.type.name === 'mathBlock' ? `[block] ${n.attrs.latex}` : n.textContent));
      return out.slice(-5);
    });
    expect(paragraphs).toEqual([
      '下面几段是听写进来的，公式还都是文字。点顶部的「一键转公式」，只有描述公式的地方会变成公式。',
      '二次方程的求根公式是 ，其中  叫判别式。',
      '圆的面积是 ，周长是 ；这半句只是普通笔记。',
      '[block] \\sin^{2} x + \\cos^{2} x = 1',
      '复习时把这几条再抄一遍。',
    ]);
    await expect(button).toBeHidden();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => docText(page)).toBe(text);
  });

  test('converting part of a paragraph leaves the rest of it alone', async ({ page }) => {
    await selectBetween(page, '其中 b的平方', '叫判别式');
    await page.keyboard.press('ControlOrMeta+Shift+E');
    await expect(page.getByTestId('status')).toContainText('已把选中文字里的 1 处公式描述转成公式');
    const paragraph = await page.evaluate(() => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      let out: any = null;
      ed.state.doc.forEach((n: any) => {
        if (n.textContent.startsWith('二次方程')) out = n.toJSON().content.map((c: any) => c.text ?? `[${c.attrs.latex}]`);
      });
      return out;
    });
    expect(paragraph).toEqual(['二次方程的求根公式是 x等于2a分之负b加减根号下b的平方减4ac，其中 ', '[b^{2} - 4ac]', ' 叫判别式。']);
  });

  test('one click converts every formula description, and one undo restores the text', async ({ page }) => {
    const text = await docText(page);
    await page.getByTestId('scan').click();
    await expect(page.getByTestId('status')).toContainText('已把 5 处公式描述转成公式');
    const inline = await latexOf(page, 'mathInline');
    expect(inline).toEqual(expect.arrayContaining(['x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}', 'b^{2} - 4ac', '\\pi r^{2}', '2\\pi r']));
    expect(await latexOf(page, 'mathBlock')).toContain('\\sin^{2} x + \\cos^{2} x = 1');
    // Ordinary note text is untouched.
    expect(await docText(page)).toContain('这半句只是普通笔记');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => docText(page)).toBe(text);
  });
});
