/**
 * Structured one-line JSON audit events for on-device inference — the
 * "auditable log" of the QVAC Hackathon evidence bundle (model loads/unloads
 * and per-call performance: TTFT, token counts, tokens/sec). Events go to the
 * console with a stable prefix so a demo run can be captured into a `.jsonl`
 * file without any storage code in the app:
 *
 *   Android:  adb logcat -s ReactNativeJS | findstr inference-audit
 *   Desktop:  the events appear inline on stdout
 *
 * See `docs/EVIDENCE.md` for the capture procedure and the event schema.
 * This is NOT telemetry: nothing leaves the device — it is a local log line.
 */

export const INFERENCE_AUDIT_PREFIX = '[inference-audit]';

export type InferenceAuditEvent =
  | 'embedding.load'
  | 'embedding.embed'
  | 'llm.load'
  | 'llm.unload'
  | 'llm.completion';

export function auditInference(
  evt: InferenceAuditEvent,
  fields: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console -- intentional: this IS the log sink
  console.log(`${INFERENCE_AUDIT_PREFIX} ${JSON.stringify({ evt, at: Date.now(), ...fields })}`);
}
