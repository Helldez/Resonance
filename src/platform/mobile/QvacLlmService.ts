import type { ILlmService, LlmGenerateOptions } from '@core/ports/ILlmService';

/**
 * LLM service backed by QVAC's `llamacpp-completion` plugin running in the
 * Bare worklet.
 *
 * Stub for now — wired in Milestone 2.
 */
export class QvacLlmService implements ILlmService {
  async initialize(): Promise<void> {
    // TODO M2
  }
  async shutdown(): Promise<void> {
    // TODO M2
  }
  async complete(_prompt: string, _options: LlmGenerateOptions): Promise<string> {
    throw new Error('QvacLlmService.complete: not implemented (M2)');
  }
  async completeStream(
    _prompt: string,
    _options: LlmGenerateOptions,
    _onChunk: (chunk: string) => void,
  ): Promise<void> {
    throw new Error('QvacLlmService.completeStream: not implemented (M2)');
  }
}
