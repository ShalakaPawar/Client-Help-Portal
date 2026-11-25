# Known limits

Measured on the development machine: MacBook (Apple Silicon), Docker via Colima with **4 CPUs / 6 GB RAM**,
everything local. Numbers come from `npm run e2e:smoke` (real browsers, LiveKit, Egress) and
`node scripts/isolation-check.mjs`. Re-run them to measure another machine.

## 1. Capacity
| Limit | Value | How it was measured / why |
|---|---|---|
| **Calls recorded at the same time** | **1** on a 4-CPU Docker VM | Two calls consented at once: the first got its recorders; the second got `503 RECORDER_UNAVAILABLE` ("all recorders are busy") and continued **unrecorded**. Egress reserves CPU per recorder (composite 2.0 + 0.5 per voice, of 4.0 available). Composite recording peaked at ~3.5 cores (headless Chrome + H.264 encoding). |
| Live (unrecorded) calls at the same time | Not the bottleneck locally | LiveKit only forwards media (no transcoding); limited by bandwidth/CPU of the machine, not measured here. |
| People per call | 2 | Design scope (client + consultant). |
| Maximum call length | 30 min (`MAX_CALL_MINUTES`) | Timer job ends the call; a warning shows 5 min before. |
| Processing throughput | 2 recordings at a time per worker (`concurrency: 2`) | More throughput = more worker processes (BullMQ spreads jobs). |

**To record more calls at once:** run more Egress instances (each needs ~3–4 CPUs at 720p) or lower the composite
quality. The per-recorder CPU costs are set in `docker/egress.yaml.template`.

## 2. Timing
| What | Measured |
|---|---|
| Request → consultant dashboard | Instant (WebSocket push; < 100 ms locally) |
| Consent → voice recorders running | ~0.5 s |
| Consent → composite (video) recorder running | **~7–9 s** (Egress starts a headless Chrome first). The first seconds after consent are in the voice files (so in the transcript) but not in the video. |
| End of call → summary ready | **8.0 s** for a 34 s call, **7.3 s** for a 2-min call (ffmpeg remux + 2× Deepgram + Claude 2.7–3.5 s); roughly constant for short calls |
| Finalize (ffmpeg remux) of a 3-minute recording | ~1–2 s of work; 3 recordings queued together finished within ~8 s each including queue wait |
| Voice `.ogg` files appear | When each recorder stops (end of call), not during the call |

## 3. Process isolation (API vs worker)
`node scripts/isolation-check.mjs --minutes 3 --jobs 3`: 60 alternating "raise request" + "list requests" calls per phase.

| Phase | p50 | p95 | Errors |
|---|---|---|---|
| Worker idle | 3.6 ms | 9.6 ms | 0 |
| Worker processing 3 × 3-min recordings | 4.3 ms | 10.0 ms | 0 |
| **Worker process killed** | 4.4 ms | 7.0 ms | 0 |

With the worker killed, `/api/health` reports `worker: false`, a call that ends is queued (`FINALIZING`), and a
replacement worker finished it 1.5 s after starting.

## 4. Storage
| Output | Measured | Per 30-min call |
|---|---|---|
| Composite video (720p30 H.264 + AAC, final MP4) | ~7.3–7.5 MB/min (measured on 34 s and 2-min calls; high-motion test video; a real, mostly static screen share is usually smaller) | ~225 MB |
| Voice file, per person (Opus/Ogg) | ~0.55 MB/min | ~17 MB each |
| HLS segments during the call | Same size as the MP4; deleted after the MP4 is made | — |

Recordings are kept until `npm run db:reset`. There is no automatic retention/cleanup.

## 5. Functional limits
- **One machine only.** LiveKit is reached via 127.0.0.1 and there is no TURN server or HTTPS, so both browser windows must be on the same computer.
- **Recording starts at consent**, not at call start; the composite video starts ~7–9 s after that.
- **Refresh during a call**: the client must pick the screen again; the video shows a short gap; their voice continues in a new voice file (`client-2.ogg`).
- **Talking over each other** is transcribed (each voice is separate) but shown as separate lines in time order.
- **Echo**: without headphones the consultant's voice can leak into the client's mic; browser echo cancellation and a merge-time de-duplication reduce it.
- **English** transcription only (`language=en`).
- **Video links** are signed bearer links valid for 5 minutes: whoever has the link in that window can play that one recording.
- **Login** lasts 8 hours (no refresh tokens); stored in sessionStorage (one login per window).
- **AI processing needs internet and valid keys**; without them the call still works and History shows a clear error with Retry.
- **Egress layout page** comes from the Egress container itself, but Deepgram and Claude are external services.
