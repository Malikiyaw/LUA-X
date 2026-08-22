/**
 * Pure twin-agent helpers shared by the API surfaces.
 * The Vercel function (api/ai/generate.ts) carries a self-contained copy of
 * basicLuauIssue because serverless functions cannot import monorepo
 * workspaces — keep the two implementations behaviorally identical.
 */

/**
 * Lightweight Lua/Luau structural sanity gate applied between agent rounds.
 * Detects truncated or grossly broken generated scripts without rejecting
 * valid Luau-only syntax: it only fails on unbalanced brackets, unterminated
 * strings/comments, or obviously truncated tails.
 */
export function basicLuauIssue(source: string): string | null {
  if (typeof source !== 'string' || !source.trim()) return 'script content is empty.';
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let i = 0;
  const n = source.length;
  let lastMeaningful = '';
  while (i < n) {
    const ch = source[i]!;
    const next = i + 1 < n ? source[i + 1]! : '';
    if (ch === '-' && next === '-') {
      if (source.slice(i, i + 4) === '--[[') {
        const close = source.indexOf(']]', i + 4);
        if (close === -1) return 'unterminated block comment.';
        i = close + 2;
        continue;
      }
      const lineEnd = source.indexOf('\n', i);
      i = lineEnd === -1 ? n : lineEnd + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = source[j]!;
        if (c === '\\') { j += 2; continue; }
        if (c === ch) { closed = true; break; }
        if (c === '\n') break;
        j += 1;
      }
      if (!closed) return 'unterminated string literal.';
      lastMeaningful = ch;
      i = j + 1;
      continue;
    }
    if (ch === '[' && next === '[') {
      const close = source.indexOf(']]', i + 2);
      if (close === -1) return 'unterminated long string.';
      lastMeaningful = ']';
      i = close + 2;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth -= 1;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth -= 1;
    if (parenDepth < 0) return 'unbalanced parentheses.';
    if (braceDepth < 0) return 'unbalanced braces.';
    if (bracketDepth < 0) return 'unbalanced square brackets.';
    if (!/\s/.test(ch)) lastMeaningful = ch;
    i += 1;
  }
  if (parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0) {
    return `unbalanced brackets at end of source (paren=${parenDepth}, brace=${braceDepth}, bracket=${bracketDepth}).`;
  }
  if (lastMeaningful === '=' || lastMeaningful === ',') {
    return 'source appears truncated mid-expression.';
  }
  return null;
}

export type AgentTraceEvent = { at: number; stage: string; role: string; model?: string; message: string };

export function traceEvent(
  trace: AgentTraceEvent[],
  role: string,
  stage: string,
  message: string,
  model?: string,
): void {
  trace.push(model ? { at: Date.now(), stage, role, model, message } : { at: Date.now(), stage, role, message });
}
