/**
 * Mirror of the mobile QVAC LLM service. Same rationale as
 * `QvacEmbeddingService` — pure `@qvac/sdk` consumer with no
 * RN/Expo-specific code path.
 */
export { QvacLlmService } from '../mobile/QvacLlmService';
export type { LlmProgressCallback } from '../mobile/QvacLlmService';
