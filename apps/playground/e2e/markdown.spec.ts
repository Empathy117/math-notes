/**
 * Typora-style Markdown: the markers of what the caret is in are shown, the rest hidden, and a
 * heading's #s are edited as text.
 */
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.mn-inline .mn-static');
  await page.waitForFunction(() => Boolean((window as unknown as { __mn?: unknown }).__mn));
}

/** Click into the note, then put the caret right after the first occurrence of `text` (+ offset). */
async function caretAfter(page: Page, text: string, offset = 0) {
  await page.locator('.ProseMirror p').first().click();
  await page.evaluate(
    ({ text, offset }) => {
      const ed = (window as unknown as { __mn: { editor: any } }).__mn.editor;
      let at = -1;
      ed.state.doc.descendants((n: any, pos: number) => {
        if (at < 0 && n.isText && n.text.includes(text)) at = pos + n.text.indexOf(text) + text.length + offset;
      });
      ed.commands.setTextSelection(at);
    },
    { text, offset },
  );
}

function firstBlock(page: Page) {
  return page.evaluate(() => {
    const n = (window as unknown as { __mn: { editor: any } }).__mn.editor.state.doc.firstChild;
    return { type: n.type.name as string, level: (n.attrs.level ?? null) as number | null, text: n.textContent as string };
  });
}

test.beforeEach(async ({ page }) => {
  await open(page);
});

test("a heading shows its #s while the caret is in it", async ({ page }) => {
  await caretAfter(page, '极限');
  await expect(page.locator('h2 .mn-md-block')).toHaveText('## ');
  await expect(page.locator('h2 .mn-md-block')).toBeVisible();
  await caretAfter(page, '欧拉');
  await expect(page.locator('.mn-md-block')).toHaveCount(0);
});

test("Backspace after a heading's #s turns them into text, a space makes it a heading again", async ({ page }) => {
  await caretAfter(page, '极限与积分', -'极限与积分'.length);
  await page.keyboard.press('Backspace');
  await expect.poll(() => firstBlock(page)).toEqual({ type: 'paragraph', level: null, text: '##极限与积分' });
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Space');
  await expect.poll(() => firstBlock(page)).toEqual({ type: 'heading', level: 1, text: '极限与积分' });
  await expect(page.locator('h1 .mn-md-block')).toHaveText('# ');
});

test('formatting shows its delimiters while the caret is in it; Backspace after the opening one removes it', async ({ page }) => {
  await caretAfter(page, '最基本');
  await expect(page.locator('.mn-md-inline')).toHaveText(['**', '**']);
  await caretAfter(page, '最基本的三角极限', -'最基本的三角极限'.length);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.ProseMirror strong')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __mn: { editor: any } }).__mn.editor.state.doc.child(1).textContent)).toContain(
    '它是最基本的三角极限之一',
  );
});

test('Markdown typed in text becomes formatting: bold, links', async ({ page }) => {
  await caretAfter(page, '复习时把这几条再抄一遍。');
  await page.keyboard.type(' **重点**');
  await expect(page.locator('.ProseMirror p strong').last()).toHaveText('重点');
  await page.keyboard.type(' [官方文档](https://katex.org)');
  const link = page.locator('.ProseMirror p a').last();
  await expect(link).toHaveText('官方文档');
  await expect(link).toHaveAttribute('href', 'https://katex.org');
  await caretAfter(page, '官方');
  await expect(page.locator('.mn-md-inline')).toHaveText(['[', '](https://katex.org)']);
});

test('markers are hidden when the note does not have the focus', async ({ page }) => {
  await caretAfter(page, '极限');
  await expect(page.locator('h2 .mn-md-block')).toBeVisible();
  await page.getByTestId('input').click();
  await expect(page.locator('h2 .mn-md-block')).toBeHidden();
});
