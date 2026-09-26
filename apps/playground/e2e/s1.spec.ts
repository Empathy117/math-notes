/**
 * S1 acceptance gates (docs/spikes/S1 行内编辑三档实测.md), codified as regression tests
 * so a MathLive / Tiptap upgrade can be checked in one run.
 */
import { expect, test, type Page } from '@playwright/test';

type Mode = 'inplace' | 'overlay' | 'popover';

const ORIGINAL_FIRST = '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1';

async function open(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.mn-inline .mn-static');
  await page.waitForFunction(() => Boolean((window as unknown as { __mn?: unknown }).__mn));
}

async function setMode(page: Page, mode: Mode) {
  await page.evaluate((m) => {
    const sel = document.querySelector('[data-testid=mode]') as HTMLSelectElement;
    sel.value = m;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, mode);
}

function firstStatic(page: Page) {
  return page.locator('.mn-inline .mn-static').first();
}

async function clickInside(page: Page, fx = 0.5, fy = 0.6) {
  const box = await firstStatic(page).boundingBox();
  if (!box) throw new Error('no static box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForFunction(() => {
    const mf = document.querySelector('math-field') as (HTMLElement & { hasFocus(): boolean }) | null;
    return Boolean(mf?.hasFocus());
  });
}

function field(page: Page) {
  return page.evaluate(() => {
    const mf = document.querySelector('math-field') as
      | (HTMLElement & { hasFocus(): boolean; position: number; lastOffset: number; value: string })
      | null;
    return mf
      ? { exists: true, focused: mf.hasFocus(), position: mf.position, last: mf.lastOffset, value: mf.value }
      : { exists: false, focused: false, position: -1, last: -1, value: '' };
  });
}

function selection(page: Page) {
  return page.evaluate(() => {
    const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
    const s = ed.state.selection;
    const $from = ed.state.doc.resolve(s.from);
    return {
      from: s.from as number,
      to: s.to as number,
      empty: s.empty as boolean,
      type: s.constructor.name as string,
      nodeBefore: ($from.nodeBefore?.type.name as string | undefined) ?? null,
      nodeAfter: ($from.nodeAfter?.type.name as string | undefined) ?? null,
      text: ed.state.doc.textBetween(s.from, s.to, ' ', '⟦math⟧') as string,
      docSize: ed.state.doc.content.size as number,
    };
  });
}

function mathLatex(page: Page, which: 'inline' | 'block', index = 0) {
  return page.evaluate(
    ({ which, index }) => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      const out: string[] = [];
      ed.state.doc.descendants((n: any) => {
        if (n.type.name === (which === 'inline' ? 'mathInline' : 'mathBlock')) out.push(n.attrs.latex);
      });
      return out[index];
    },
    { which, index },
  );
}

function firstInlinePos(page: Page) {
  return page.evaluate(() => {
    const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
    let pos: number | null = null;
    ed.state.doc.descendants((n: any, p: number) => {
      if (pos === null && n.type.name === 'mathInline') pos = p;
    });
    return (pos as number | null) ?? -1;
  });
}

function lastMetric(page: Page) {
  return page.evaluate(() => {
    const m = (window as unknown as { __mn: { getMetrics: () => any[] } }).__mn.getMetrics();
    return m[m.length - 1];
  });
}

for (const mode of ['inplace', 'overlay', 'popover'] as Mode[]) {
  test.describe(`inline ${mode}`, () => {
    test.beforeEach(async ({ page }) => {
      await open(page);
      await setMode(page, mode);
    });

    test('click opens the field with the caret inside; Escape commits once; one undo reverts', async ({ page }) => {
      await clickInside(page);
      const f = await field(page);
      expect(f.exists).toBe(true);
      expect(f.position).toBeGreaterThanOrEqual(0);
      expect(f.position).toBeLessThanOrEqual(f.last);
      await page.keyboard.type('+9');
      await page.keyboard.press('Escape');
      await expect.poll(() => field(page)).toMatchObject({ exists: false });
      expect(await mathLatex(page, 'inline')).toContain('+9');
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => mathLatex(page, 'inline')).toBe(ORIGINAL_FIRST);
    });

    test('ArrowRight at the end exits right after the node; ArrowLeft re-enters at the end', async ({ page }) => {
      const pos = await firstInlinePos(page);
      await clickInside(page);
      await page.evaluate(() => {
        const mf = document.querySelector('math-field') as any;
        mf.position = mf.lastOffset;
      });
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => field(page)).toMatchObject({ exists: false });
      const s = await selection(page);
      expect(s.from).toBe(pos + 1);
      expect(s.nodeBefore).toBe('mathInline');
      // The host editor must really own the focus again after an exit.
      expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => field(page)).toMatchObject({ exists: true, focused: true });
      const f = await field(page);
      expect(f.position).toBe(f.last);
    });

    test('ArrowDown inside the field exits after the node instead of jumping to the document end', async ({ page }) => {
      const pos = await firstInlinePos(page);
      await clickInside(page);
      // From inside a fraction, ArrowDown legitimately moves numerator → denominator; test from the end.
      await page.evaluate(() => {
        const mf = document.querySelector('math-field') as any;
        mf.position = mf.lastOffset;
      });
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => field(page)).toMatchObject({ exists: false });
      const s = await selection(page);
      expect(s.from).toBe(pos + 1);
    });

    test('layout: entering edit mode does not move the node; line height change is bounded', async ({ page }) => {
      await clickInside(page);
      const m = await lastMetric(page);
      expect(Math.abs(m.nodeAfter.y - m.nodeBefore.y)).toBeLessThanOrEqual(0.5);
      const lineDelta = m.lineAfter && m.lineBefore ? m.lineAfter.height - m.lineBefore.height : 0;
      // MathLive used to put \lim's limits below in inline style (+5.5px at 17px); the limits
      // shim and the field's KaTeX-matching size and line height keep the line as it was.
      expect(lineDelta).toBeLessThanOrEqual(0.5);
    });
  });
}

test.describe('selection across formulas', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('drag text → formula → text selects across the node', async ({ page }) => {
    const box = await firstStatic(page).boundingBox();
    if (!box) throw new Error('no box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x - 40, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 40, y, { steps: 8 });
    await page.mouse.up();
    const s = await selection(page);
    expect(s.text).toContain('⟦math⟧');
    expect(await field(page)).toMatchObject({ exists: false });
  });

  test('drag starting at a paragraph-leading formula selects across it (ProseMirror forum #8547)', async ({ page }) => {
    const leading = page.locator('.mn-inline .mn-static').nth(4);
    const box = await leading.boundingBox();
    if (!box) throw new Error('no box');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x - 3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 120, y, { steps: 10 });
    await page.mouse.up();
    const s = await selection(page);
    expect(s.text.startsWith('⟦math⟧')).toBe(true);
    expect(await field(page)).toMatchObject({ exists: false });
  });

  test('Shift+ArrowRight across the node extends the selection without opening the field', async ({ page }) => {
    const pos = await firstInlinePos(page);
    // A real click gives the editor DOM focus (headless Chromium ignores a bare view.focus() here).
    await page.locator('.ProseMirror p').first().click();
    await page.evaluate((p) => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      ed.commands.setTextSelection(p);
    }, pos);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true);
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const s = await selection(page);
    expect(s.from).toBe(pos);
    expect(s.to).toBe(pos + 2);
    expect(await field(page)).toMatchObject({ exists: false });
  });

  test('replacing a selection inside a subscript keeps the surrounding structure (D8 protocol)', async ({ page }) => {
    await clickInside(page);
    const out = await page.evaluate(() => {
      const mf = document.querySelector('math-field') as any;
      // Offsets 1..4 are the subscript "x \to 0" of \lim in the sample formula.
      mf.selection = { ranges: [[1, 4]] };
      const selected = mf.getValue(mf.selection.ranges[0][0], mf.selection.ranges[0][1], 'latex');
      // Splicing serialized ranges does NOT reassemble the formula: document the fact.
      const [s, e] = mf.selection.ranges[0];
      const spliced = mf.getValue(0, s, 'latex') + mf.getValue(s, e, 'latex') + mf.getValue(e, mf.lastOffset, 'latex');
      mf.insert('y \\to 1', { insertionMode: 'replaceSelection', format: 'latex', selectionMode: 'after' });
      return { selected, spliced, whole: mf.getValue('latex') };
    });
    expect(out.selected.replace(/\s/g, '')).toBe('x\\to0');
    expect(out.spliced.replace(/\s/g, '')).not.toBe('\\lim_{x\\to0}\\frac{\\sinx}{x}=1');
    // The field carries the limits shim (adapter/latex-shims.ts); the stored formula does not.
    expect(out.whole.replace(/\s/g, '')).toBe('\\lim\\displaylimits_{y\\to1}\\frac{\\sinx}{x}=1');
  });
});

test.describe('block formula', () => {
  test('click opens in place; ArrowDown exits to the start of the next paragraph', async ({ page }) => {
    await open(page);
    const box = await page.locator('.mn-block .mn-static').first().boundingBox();
    if (!box) throw new Error('no box');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
    await expect.poll(() => field(page)).toMatchObject({ exists: true, focused: true });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => field(page)).toMatchObject({ exists: false });
    const s = await selection(page);
    expect(s.text).toBe('');
    expect(s.nodeBefore).toBeNull();
    expect(s.nodeAfter).toBe('text');
  });
});

test.describe('input box and conversion', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('literal LaTeX is inserted without the AI', async ({ page }) => {
    await page.getByTestId('input').fill('x^2+y^2=1');
    await page.getByTestId('input').press('Enter');
    await expect(page.getByTestId('status')).toContainText('未调用 AI');
    await expect.poll(async () => {
      const all = await page.evaluate(() => {
        const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
        const out: string[] = [];
        ed.state.doc.descendants((n: any) => {
          if (n.type.name === 'mathInline') out.push(n.attrs.latex);
        });
        return out;
      });
      return all.includes('x^2+y^2=1');
    }).toBe(true);
  });

  test('fuzzy input goes through the resolver', async ({ page }) => {
    await page.getByTestId('input').fill('(x+1)^2从1到2的定积分');
    await page.getByTestId('input').press('Enter');
    await expect(page.getByTestId('status')).toContainText('定积分');
    await expect(page.getByTestId('input')).toHaveValue('');
  });

  test('out-of-scope content is reported as a boundary and the input is preserved', async ({ page }) => {
    await page.getByTestId('input').fill('画一个 tikz 交换图');
    await page.getByTestId('input').press('Enter');
    await expect(page.getByTestId('status')).toHaveClass(/mn-status-boundary/);
    await expect(page.getByTestId('status')).toContainText('超出');
    await expect(page.getByTestId('input')).toHaveValue('画一个 tikz 交换图');
  });

  test('selected text converts to a formula with Cmd/Ctrl+Shift+E', async ({ page }) => {
    await page.locator('.ProseMirror p').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type(' sin x');
    // Headless Chromium delivers keys faster than ProseMirror re-syncs the DOM selection; pace them.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+ArrowLeft');
      await page.waitForTimeout(40);
    }
    await page.keyboard.press('ControlOrMeta+Shift+E');
    await expect(page.getByTestId('status')).toContainText('已把选中文字转为公式');
    const latex = await page.evaluate(() => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      const last = ed.state.doc.lastChild;
      let out: string | null = null;
      last.descendants((n: any) => {
        if (n.type.name === 'mathInline') out = n.attrs.latex;
      });
      return out;
    });
    expect(latex).toBe('\\sin x');
  });
});
