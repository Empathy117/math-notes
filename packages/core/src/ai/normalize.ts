/**
 * Host-side clean-up of model output before validation (design doc D6 pre-processing).
 * The model is asked not to emit delimiters or \label, but the host never relies on that.
 */

/** Remove ```fences```, $…$, $$…$$, \[…\], \(…\) around a formula. */
export function stripDelimiters(latex: string): string {
  let s = latex.trim();
  const fence = /^```(?:latex|tex|math)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1]!.trim();
  const pairs: [RegExp, number][] = [
    [/^\$\$([\s\S]*)\$\$$/, 1],
    [/^\\\[([\s\S]*)\\\]$/, 1],
    [/^\\\(([\s\S]*)\\\)$/, 1],
    [/^\$([\s\S]*)\$$/, 1],
  ];
  for (const [re, g] of pairs) {
    const m = re.exec(s);
    if (m) {
      s = m[g]!.trim();
      break;
    }
  }
  return s;
}

/** Drop constructs the renderer never accepts inline: \label{…}, \tag{…}, \tag*{…}. */
export function stripForbidden(latex: string): string {
  return latex
    .replace(/\\label\{[^}]*\}/g, '')
    .replace(/\\tag\*?\{[^}]*\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * A model that forgets to double a backslash in JSON turns \frac into a form feed plus "rac",
 * \theta into a tab plus "heta", and so on; JSON.parse accepts them silently. Those control
 * characters never belong in LaTeX, so put the command back. \n is left alone: real newlines
 * separate rows in multi-line output.
 */
export function restoreEscapes(latex: string): string {
  return latex
    .replace(/\f(?=[a-zA-Z])/g, '\\f')
    .replace(/\x08(?=[a-zA-Z])/g, '\\b')
    .replace(/\r(?=[a-zA-Z])/g, '\\r')
    .replace(/\t(?=[a-zA-Z])/g, '\\t');
}

export function normalizeModelLatex(latex: string): string {
  // Restore first: trimming and whitespace folding would eat the control characters.
  return stripForbidden(stripDelimiters(restoreEscapes(latex)));
}

/**
 * Parse the JSON object a model returned, tolerating code fences, leading prose, and the slips
 * `repairJson` mends.
 */
export function parseModelJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  const candidates: string[] = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) candidates.unshift(fence[1]!);
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of [...candidates, ...candidates.map(repairJson)]) {
    if (c === null) continue;
    try {
      const v = JSON.parse(c) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Mend slips a model makes in otherwise complete JSON (all seen in S4 despite JSON mode): a
 * LaTeX backslash left undoubled where it is not a JSON escape (`\,` `\int`), a trailing
 * comma, closing brackets left off at the end. A string cut off mid-way is left alone: that
 * is a truncated answer, not a slip.
 */
function repairJson(s: string): string | null {
  const closers: string[] = [];
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === '\\') {
        const next = s[i + 1] ?? '';
        const escape = /["\\/bfnrt]/.test(next) || (next === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6)));
        // A backslash that starts no JSON escape is a LaTeX backslash: keep it literally.
        out += escape ? ch + next : '\\\\';
        if (escape) i++;
        continue;
      }
      out += ch;
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') closers.push('}');
    else if (ch === '[') closers.push(']');
    else if (ch === '}' || ch === ']') {
      if (closers.pop() !== ch) return null;
      out = out.replace(/,\s*$/, '');
    }
    out += ch;
  }
  if (inString) return null;
  return out.replace(/,\s*$/, '') + closers.reverse().join('');
}
