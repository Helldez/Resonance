/**
 * Qwen3 in "thinking" mode emits <think>...</think> blocks before the real
 * answer. Strip them so only the reply text remains. char-walk per AGENTS.md
 * (no regex). Shared by every core use-case that consumes LLM output.
 */
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export function stripThinkTags(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith(THINK_OPEN, i)) {
      const close = s.indexOf(THINK_CLOSE, i + THINK_OPEN.length);
      if (close === -1) {
        // Unclosed think block — drop everything from here to end.
        break;
      }
      i = close + THINK_CLOSE.length;
      continue;
    }
    out += s[i];
    i++;
  }
  return out.trim();
}
