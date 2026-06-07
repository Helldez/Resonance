import type { ILlmService } from '@core/ports/ILlmService';
import { stripThinkTags } from '@core/llm/StripThink';
import { TopicConfig } from '@core/config/TopicConfig';

/**
 * Optional on-device LLM naming pass for the topic atlas. Each cluster is
 * summarised into a 2-4 word name from its most-central posts (selected by
 * embedding centrality upstream in `computeTopicAtlas`). No keyword
 * extraction, no regex, no stop-word lists — the LLM does the abstraction, so
 * naming stays embedding-driven and multilingual.
 *
 * Best-effort and non-blocking by contract: the caller keeps the medoid
 * labels and only upgrades the ones this returns. A per-topic failure or
 * timeout drops just that topic; the batch never throws. Runs sequentially
 * because the device hosts a single LLM instance.
 */
export interface NameTopicsDeps {
  readonly llm: ILlmService;
}

export interface NameTopicsInput {
  readonly clusters: ReadonlyArray<{
    readonly topicId: number;
    readonly centralTexts: ReadonlyArray<string>;
  }>;
}

export interface NameTopicsOptions {
  readonly maxTokens: number;
  readonly temperature: number;
  readonly perTopicTimeoutMs: number;
}

export interface TopicName {
  readonly topicId: number;
  readonly name: string;
}

const SYSTEM =
  'You name discussion topics. Given a few posts that belong to the same ' +
  'topic, reply with a single short topic name of 2 to 4 words, in the same ' +
  'language as the posts. Reply with the name only — no quotes, no ' +
  'punctuation, no explanation.';

export async function nameTopics(
  deps: NameTopicsDeps,
  input: NameTopicsInput,
  opts: NameTopicsOptions = TopicConfig.naming,
): Promise<ReadonlyArray<TopicName>> {
  const out: TopicName[] = [];
  for (const cluster of input.clusters) {
    if (cluster.centralTexts.length === 0) {
      continue;
    }
    try {
      const name = await withTimeout(
        nameOne(deps.llm, cluster.centralTexts, opts),
        opts.perTopicTimeoutMs,
      );
      if (name.length > 0) {
        out.push({ topicId: cluster.topicId, name });
      }
    } catch {
      // Drop this topic only; the medoid label stands.
    }
  }
  return out;
}

async function nameOne(
  llm: ILlmService,
  texts: ReadonlyArray<string>,
  opts: NameTopicsOptions,
): Promise<string> {
  const examples = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt = [SYSTEM, '', 'Posts:', examples, '', 'Topic name:'].join('\n');
  const raw = await llm.complete(prompt, {
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    stop: ['\n', 'Posts:', 'Topic name:'],
  });
  return cleanName(stripThinkTags(raw));
}

/** First line, trimmed, with any wrapping quotes removed. char-ops, no regex. */
function cleanName(s: string): string {
  const firstLine = s.split('\n')[0] ?? '';
  return stripWrappingQuotes(firstLine.trim());
}

const QUOTE_CHARS = new Set(['"', "'", '“', '”', '‘', '’', '«', '»', '`']);

function stripWrappingQuotes(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && QUOTE_CHARS.has(s[start])) {
    start++;
  }
  while (end > start && QUOTE_CHARS.has(s[end - 1])) {
    end--;
  }
  return s.slice(start, end).trim();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nameTopics: timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
