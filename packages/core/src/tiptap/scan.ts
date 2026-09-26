/**
 * Conversion of formula descriptions (the note's "text described" math) into formula nodes, for
 * the whole note or a selection. The model reads a linear projection of the textblocks (design
 * doc D13, reduced to what this needs) and answers with quotes; every text offset of the
 * projection maps back to a document position, so a located quote becomes a document range and
 * the text around it is never touched.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import { chunkScanBlocks, locateScanSpans, mayHoldFormula, type ScanBlock, type ScanRejection } from '../ai/scan';
import type { LatexCheck } from '../ai/retry';
import type { MathScanRequest, MathScanResult } from '../ai/types';
import type { MathConversion } from './math-node';

export interface ProjectedBlock extends ScanBlock {
  /** Document position of each text offset; -1 inside a formula, a line break or another inline node. */
  positions: number[];
  /**
   * A top-level paragraph holding only text and, with a range, lying wholly inside it: a
   * description that fills it becomes a block formula.
   */
  plainParagraph: boolean;
}

/**
 * The note's textblocks as text, inline formulas as $…$ and inline code in backticks (code blocks
 * are skipped). With a range, only what lies inside it: a block the range cuts shows just its part,
 * a formula counts when it lies wholly inside.
 */
export function projectTextblocks(doc: PMNode, range?: { from: number; to: number }): ProjectedBlock[] {
  const out: ProjectedBlock[] = [];
  const inside = (from: number, to: number) => !range || (from >= range.from && to <= range.to);
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true;
    if (node.type.spec.code) return false;
    let text = '';
    const positions: number[] = [];
    const protectedRanges: [number, number][] = [];
    let onlyText = true;
    let cut = false;
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? '';
        let chunk = '';
        const chunkPositions: number[] = [];
        for (let i = 0; i < t.length; i++) {
          if (!inside(at + i, at + i + 1)) {
            cut = true;
            continue;
          }
          chunk += t[i];
          chunkPositions.push(at + i);
        }
        if (!chunk) return;
        if (child.marks.some((m) => m.type.spec.code)) {
          // Inline code is shown in backticks, as Markdown writes it, and never converted.
          protectedRanges.push([text.length, text.length + chunk.length + 2]);
          positions.push(-1, ...chunkPositions, -1);
          text += `\`${chunk}\``;
        } else {
          positions.push(...chunkPositions);
          text += chunk;
        }
        return;
      }
      onlyText = false;
      if (!inside(at, at + child.nodeSize)) {
        cut = true;
        return;
      }
      const shown =
        child.type.name === 'mathInline' ? `$${String(child.attrs['latex'] ?? '')}$` : child.type.name === 'hardBreak' ? '\n' : '\uFFFC';
      protectedRanges.push([text.length, text.length + shown.length]);
      for (let i = 0; i < shown.length; i++) positions.push(-1);
      text += shown;
    });
    if (!range || text !== '') {
      out.push({
        id: `b${out.length}`,
        text,
        positions,
        protectedRanges,
        plainParagraph: onlyText && !cut && node.type.name === 'paragraph' && parent === doc,
      });
    }
    return false;
  });
  return out;
}

/** The document range of text offsets [start, end) when they are one run of text, else null. */
export function textRange(block: ProjectedBlock, start: number, end: number): { from: number; to: number } | null {
  if (start < 0 || end > block.text.length || start >= end) return null;
  const from = block.positions[start]!;
  if (from < 0) return null;
  for (let i = start + 1; i < end; i++) if (block.positions[i] !== from + (i - start)) return null;
  return { from, to: from + (end - start) };
}

export interface FoundDescription extends MathConversion {
  quote: string;
  interpretation: string;
}

export interface ScanOutcome {
  found: FoundDescription[];
  rejected: ScanRejection[];
  /** Blocks sent to the model. */
  scanned: number;
}

export interface ScanOptions {
  /** Only the text in this document range (a selection); the whole note when absent. */
  range?: { from: number; to: number };
  signal?: AbortSignal;
  /** Text per request; a long note goes out in several requests. */
  maxChars?: number;
  /** Requests in flight at once. */
  concurrency?: number;
}

/**
 * Ask the model for the formula descriptions in `doc` (or in `opts.range` of it) and turn its
 * quotes into document ranges, dropping what cannot be located or rendered. Apply the result
 * with `convertRangesToMath` to the same document it was computed for.
 */
export async function findFormulaDescriptions(
  doc: PMNode,
  scan: (req: MathScanRequest, opts?: { signal?: AbortSignal }) => Promise<MathScanResult>,
  check: LatexCheck,
  opts: ScanOptions = {},
): Promise<ScanOutcome> {
  const blocks = projectTextblocks(doc, opts.range).filter((b) => mayHoldFormula(b.text));
  const chunks = chunkScanBlocks(blocks, opts.maxChars ?? 1500);
  const results: MathScanResult[] = new Array(chunks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < chunks.length) {
      const i = next++;
      const chunk = chunks[i]!;
      results[i] = await scan({ kind: 'scan', blocks: chunk.map((b) => ({ id: b.id, text: b.text })) }, { signal: opts.signal });
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, chunks.length) }, worker));

  const { located, rejected } = locateScanSpans(
    blocks,
    results.flatMap((r) => r.spans),
    check,
  );
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const found: FoundDescription[] = [];
  for (const span of located) {
    const block = byId.get(span.block)!;
    const range = textRange(block, span.start, span.end);
    if (!range) {
      rejected.push({ span, reason: 'overlap' });
      continue;
    }
    const fills = block.plainParagraph && block.text.slice(0, span.start).trim() === '' && block.text.slice(span.end).trim() === '';
    found.push({ ...range, latex: span.latex, display: fills ? 'block' : 'inline', quote: span.quote, interpretation: span.interpretation });
  }
  return { found, rejected, scanned: blocks.length };
}
