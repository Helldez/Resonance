# Evidence bundle — auditable inference log

The QVAC Hackathon's 3-stage verification asks for an auditable, structured
log of a standard demo run: model loads/unloads and per-call inference
performance (TTFT, token counts, tokens/sec).

Resonance emits exactly that as **one-line JSON events** on the console,
prefixed with `[inference-audit]` (`src/platform/shared/InferenceAudit.ts`,
hooked into `QvacLlmService` and `QvacEmbeddingService`). Nothing leaves the
device — these are local log lines, not telemetry.

## Event schema

Every line is `[inference-audit] {…json…}` with `evt` and `at` (epoch ms):

| `evt` | Fields |
|---|---|
| `embedding.load` | `model`, `loadMs` |
| `embedding.embed` | `textChars`, `dim`, `ms` |
| `llm.load` | `model`, `loadMs` |
| `llm.unload` | `model` |
| `llm.completion` | `outcome` (`ok`/`stop`/`stalled`), `promptChars`, `tokens` (completion tokens — the stream yields one token per chunk), `ttftMs` (first token, includes prefill), `tokensPerSec` (decode-phase rate, excludes prefill), `totalMs` |

## Capturing a demo run

Start from a **fresh install** (or clear the app's data) on every device in
the demo: the bounded top-200 inbox lives in the local SQLite and survives
network-version bumps, so a device used for development still holds its old
test posts. A clean install guarantees the recorded feed contains only what
the demo itself produces.

**Android** (app logs land in logcat under the `ReactNativeJS` tag):

```powershell
adb logcat -c   # clear, then perform the demo run on the device
adb logcat -d -s ReactNativeJS | Select-String inference-audit |
  ForEach-Object { ($_ -split '\[inference-audit\] ')[1] } |
  Out-File -Encoding utf8 demo-run.jsonl
```

**Desktop test peer** (events appear inline on stdout):

```powershell
npm run desktop:peer 2>&1 | Tee-Object run.log
# then: Select-String inference-audit run.log → demo-run.jsonl as above
```

The resulting `demo-run.jsonl` is the artifact submitted alongside the demo
video; the hardware specs of the device that produced it are listed in the
submission form (with system-profiler screenshots, per the rules).
