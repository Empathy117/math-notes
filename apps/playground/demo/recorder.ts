/**
 * Drives the playground like a person would (a visible pointer that glides, keys typed at a
 * human pace) while recording the page, then encodes the recording as a GIF with ffmpeg.
 *
 * Frames come from Chromium's screencast: one PNG per repaint with its timestamp, so pauses
 * cost nothing while recording and keep their real length in the GIF.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CDPSession, Locator, Page } from '@playwright/test';
import { overlay } from './overlay';

type Point = { x: number; y: number };
type Target = Locator | Point;

export interface GifOptions {
  /** Output width in pixels; the height keeps the viewport's aspect ratio. */
  width: number;
  fps?: number;
}

export class Demo {
  private cdp: CDPSession | null = null;
  private frames: { png: Buffer; t: number }[] = [];
  private stoppedAt = 0;
  private at: Point;

  /** `home`: where the pointer rests when recording starts; gliding back there makes the GIF loop seamlessly. */
  constructor(
    readonly page: Page,
    readonly home: Point = { x: 790, y: 150 },
  ) {
    this.at = home;
  }

  /** Load the playground with the overlay, and wait until formulas and fonts are ready. */
  async open(): Promise<void> {
    await this.page.addInitScript(overlay);
    await this.page.goto('/');
    await this.page.waitForSelector('.mn-inline .mn-static');
    await this.page.waitForFunction(() => Boolean((window as unknown as { __mn?: unknown }).__mn));
    await this.page.evaluate(() => document.fonts.ready);
  }

  // ------------------------------------------------------------------ recording

  async start(): Promise<void> {
    const vp = this.page.viewportSize()!;
    const dpr = await this.page.evaluate(() => devicePixelRatio);
    await this.page.mouse.move(this.at.x, this.at.y);
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      this.frames.push({ png: Buffer.from(data, 'base64'), t: metadata.timestamp ?? Date.now() / 1000 });
      this.cdp?.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', {
      format: 'png',
      maxWidth: Math.round(vp.width * dpr),
      maxHeight: Math.round(vp.height * dpr),
      everyNthFrame: 1,
    });
    // Nudge the pointer so the first frame is painted right away.
    await this.page.mouse.move(this.at.x + 1, this.at.y);
    await this.page.mouse.move(this.at.x, this.at.y);
  }

  async stop(): Promise<void> {
    this.stoppedAt = Date.now() / 1000;
    await this.cdp?.send('Page.stopScreencast');
    await this.cdp?.detach();
    this.cdp = null;
  }

  /** Encode the recording; returns the file size in bytes. */
  saveGif(file: string, { width, fps = 20 }: GifOptions): number {
    if (!this.frames.length) throw new Error('nothing was recorded');
    const dir = mkdtempSync(join(tmpdir(), 'mn-demo-'));
    try {
      const list = ['ffconcat version 1.0'];
      this.frames.forEach((f, i) => {
        const name = `${String(i).padStart(5, '0')}.png`;
        writeFileSync(join(dir, name), f.png);
        const next = this.frames[i + 1]?.t ?? this.stoppedAt;
        list.push(`file '${name}'`, `duration ${Math.max(next - f.t, 0.001).toFixed(4)}`);
      });
      // The concat demuxer drops the last entry's duration unless the file is listed once more.
      list.push(`file '${String(this.frames.length - 1).padStart(5, '0')}.png'`);
      writeFileSync(join(dir, 'frames.txt'), list.join('\n'));
      mkdirSync(dirname(file), { recursive: true });
      const filters = [
        `fps=${fps}`,
        `scale=${width}:-2:flags=lanczos`,
        'split[a][b]',
        '[a]palettegen=max_colors=256:stats_mode=full[p]',
        '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
      ];
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'), '-filter_complex', filters.join(','), '-loop', '0', file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return statSync(file).size;
  }

  // ------------------------------------------------------------------ acting

  pause(ms: number): Promise<void> {
    return this.page.waitForTimeout(ms);
  }

  /** Where on a target to point: its box at fractions (fx, fy), or a point as given. */
  async point(target: Target, fx = 0.5, fy = 0.5): Promise<Point> {
    if (!('boundingBox' in target)) return target;
    const box = await target.boundingBox();
    if (!box) throw new Error(`no box for ${String(target)}`);
    return { x: box.x + box.width * fx, y: box.y + box.height * fy };
  }

  /** Glide the pointer to a target along an eased path, as a hand would. */
  async moveTo(target: Target, { fx = 0.5, fy = 0.5, ms = 650 }: { fx?: number; fy?: number; ms?: number } = {}): Promise<void> {
    const to = await this.point(target, fx, fy);
    const from = this.at;
    const steps = Math.max(6, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      await this.page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      // Half a step: delivering each move takes about as long again.
      await this.page.waitForTimeout(ms / steps / 2);
    }
    this.at = to;
  }

  async click(target: Target, opts: { fx?: number; fy?: number; ms?: number } = {}): Promise<void> {
    await this.moveTo(target, opts);
    await this.pause(140);
    await this.page.mouse.down();
    await this.pause(70);
    await this.page.mouse.up();
  }

  /** Press the mouse at `from`, glide to `to` and release: a drag selection. */
  async drag(from: Target, to: Target, ms = 900): Promise<void> {
    await this.moveTo(from);
    await this.pause(120);
    await this.page.mouse.down();
    await this.moveTo(to, { ms });
    await this.page.mouse.up();
  }

  async type(text: string, delay = 85): Promise<void> {
    await this.page.keyboard.type(text, { delay });
  }

  /** Press a key; with a caption, show it on screen as the key goes down. */
  async press(key: string, caption?: string[]): Promise<void> {
    if (caption) await this.page.evaluate((c) => (window as unknown as { __demo: { keys(c: string[]): void } }).__demo.keys(c), caption);
    await this.page.keyboard.press(key);
    await this.pause(180);
  }
}
