# Approximate costs: LLM (Claude) only

Scope: the Claude call that writes each call's summary. Speech-to-text, LiveKit/Egress compute and storage are not
included (see [LIMITS.md](LIMITS.md) for their resource use).

## 1. What one call costs: measured
Every summary stores Claude's real token usage (`Summary.inputTokens`, `outputTokens`, `latencyMs`). Two real calls
(scripted two-person support dialog spoken by macOS voices, through LiveKit → Egress → Deepgram → Claude):

| Call length | Transcript lines | Input tokens | Output tokens | Claude latency | Model |
|---|---|---|---|---|---|
| 0:34 | 11 | 1,147 | 231 | 3.5 s | `claude-haiku-5-5` |
| 1:59 | 33 | 2,077 | 282 | 2.7 s | `claude-haiku-5-5` |

From these two points (linear fit):
- **Input ≈ 690 + 650 × minutes.** About 690 tokens are fixed: instructions + JSON output schema + request title. The rest grows with the transcript (≈ 42 tokens per transcript line, ≈ 16 lines per minute in this dialog).
- **Output ≈ 230 + 36 × minutes.** The summary has a fixed shape, so output grows slowly. Includes the model's (low-effort) thinking tokens.

| Call length | Input tokens | Output tokens |
|---|---|---|
| 5 min | ~3,900 | ~410 |
| 15 min | ~10,400 | ~770 |
| 30 min (cap) | ~20,200 | ~1,310 |

## 2. Price per call
Prices per million tokens (input / output), Anthropic API list prices, Nov 2026, **re-check before relying on them**:
Haiku 5.5 $0.10 / $0.50 · Sonnet 5.5 $2 / $10 · Opus 5.5 $4 / $20.

| Call length | `claude-haiku-5-5` (used in this demo) | `claude-sonnet-5-5` | `claude-opus-5-5` (code default) |
|---|---|---|---|
| 5 min | $0.0006 | $0.012 | $0.024 |
| 15 min | $0.0014 | $0.029 | $0.057 |
| 30 min | $0.0027 | $0.054 | $0.107 |

## 3. Per month (average call 15 min)
| Calls / month | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| 100 | $0.14 | $2.90 | $5.70 |
| 1,000 | $1.40 | $29 | $57 |
| 10,000 | $14 | $290 | $570 |

## 4. Notes and assumptions
- **Model choice is one setting**: `CLAUDE_MODEL` in `apps/api/.env`. The demo uses Haiku 5.5. The code default is Opus 5.5 (best quality); its cost is ~40× Haiku's.
- **Sonnet/Opus numbers use the token counts measured with Haiku.** Thinking tokens differ by model even at `effort: low`, so Sonnet/Opus output may be somewhat higher. Switch `CLAUDE_MODEL`, run `SPEECH=1 npm run e2e:smoke`, and read the new row's token columns to measure exactly.
- **Speech density matters**: a fast talker or a monologue gives more tokens per minute than this dialog; silence gives fewer. Calls with no speech cost **$0** (Claude is not called).
- **Retries**: a failed attempt that reached Claude is billed; BullMQ retries at most 3× on temporary errors. Permanent errors (bad key, refusal) are not retried.
- **Prompt caching** wouldn't help: the fixed prompt (~690 tokens) is below the minimum cacheable size, and each transcript is different.
- **One Claude call per recorded call.** Re-opening History never calls Claude again; the summary is stored.

## 5. How to query real costs
```sql
-- Average tokens and cost per summary for a model (Haiku prices shown)
SELECT model, count(*) AS summaries,
       round(avg("inputTokens")) AS avg_in, round(avg("outputTokens")) AS avg_out,
       round(sum("inputTokens") * 0.10 / 1e6 + sum("outputTokens") * 0.50 / 1e6, 4) AS total_usd
FROM "Summary" WHERE "inputTokens" IS NOT NULL GROUP BY model;
```
