# Design decisions

Each decision: **choice**, **why**, **trade-off accepted**.

## Product rules
| Topic | Decision |
|---|---|
| Consultant scope | Consultants see only their assigned clients (`User.consultantId`). |
| Consent | Only the client consents, once per call, before anything is recorded. Saying no → the call continues unrecorded. The client can stop recording mid-call; what was recorded is kept and processed. The consent text mentions Deepgram and Claude. |
| Live calls | One live call per consultant and per request, enforced by partial unique indexes (not just a check in code). |
| Timers | Ring timeout 2 min → MISSED · a disconnect is announced to the other side only if the person is still gone after 60 s (a quick refresh stays silent) · both gone 3 min → auto-end · 30-min cap with a warning 5 min before · LiveKit `room_finished` ends any call still marked live. |
| Ending | Either participant can end; the consultant marks the request resolved or keeps it open. |

## Technical choices
| # | Decision | Why | Trade-off accepted |
|---|---|---|---|
| 1 | npm workspaces (`apps/api`, `apps/web`, `packages/shared`) | One install; shared enums/types/events stop frontend–backend drift | No build caching (not needed) |
| 2 | Vue 3 + Vite + Pinia + Tailwind | Required stack; simple consistent UI without a component library | A few hand-made components |
| 3 | One NestJS process (API + BullMQ processors) | Simplest to run and explain | Processing shares CPU with the API (ffmpeg only stream-copies) |
| 4 | PostgreSQL + Prisma | Concurrent writers, partial unique indexes, readable schema + migrations | Docker required; partial indexes are hand-written SQL in the migration |
| 5 | JWT in **sessionStorage** | Two windows can be two users; survives refresh (rejoin) | Readable by JS (XSS risk) → Vue escaping, no `v-html`, Content-Security-Policy; no refresh tokens (8 h) |
| 6 | Scoped queries in `ScopeService`, **404** for others' data | The filter is part of every query, so it can't be forgotten; 404 doesn't reveal existence | 404 can hide bugs while debugging (logs keep request ids) |
| 7 | Socket.IO over WebSocket for notifications | Rooms per user, reconnect, Nest support; the DB stays the truth (refetch after reconnect) | One more dependency (SSE would also work) |
| 8 | **Self-hosted LiveKit** (SFU) | Media passes through a server, so it can be recorded; reconnects, duplicate-tab handling and webhooks built in; no account | Heavier Docker setup; one-machine demo |
| 9 | **Server-side recording with LiveKit Egress** | Survives the client refreshing/closing the tab; consent enforced (only the backend starts recorders); no upload code in the browser | Egress uses headless Chrome; "uploaded while running" = segments written during the call |
| 10 | **3 outputs**: composite video + one voice file per person | Exact speaker labels, overlapping speech kept, server timestamps align lines to the video | 3 recorders; ~2× transcription minutes |
| 11 | Composite: speaker layout, 720p30, 4 s HLS segments | Built-in layout; half the CPU of 1080p; ≤ 4 s lost if Egress crashes | Small screen text may be soft |
| 12 | Shared local folder (`data/recordings`, mounted into Egress) | No object-storage service; same files for API and Egress | One machine only |
| 13 | **BullMQ + Redis** | Retries/backoff, delayed jobs (timers survive restarts), stuck-job recovery, dashboard | Job state outside Postgres → add jobs after commit, fixed job ids, startup re-queue |
| 14 | Deepgram nova-3, one request per voice file | Accepts Ogg/Opus, sentence timestamps for seeking, no diarization needed | English only |
| 15 | Claude (`claude-opus-5-5`, effort low) with a JSON schema | Valid output for the UI; prompt treats the transcript as untrusted; no invented action items | Model configurable via `CLAUDE_MODEL` |
| 16 | Signed 5-minute video URL + HTTP Range | `<video>` can't send our header; Range makes seeking work | Link expires → the page silently gets a new one |
| 17 | AI keys optional at boot, never faked | Cloners can run everything else; jobs fail with a clear `PROVIDER_NOT_CONFIGURED` | — |
| 18 | One error shape `{statusCode, code, message, requestId}` | Stable codes for the UI and tests | — |
| 19 | Library majors pinned to the last well-known stable lines (NestJS 11, Prisma 6, TS 5.9) | Newer majors (NestJS 12, Prisma 8 rc, TS 7) were not verifiable during the build | Not on the very latest majors |

## Not built (and how it would grow)
TURN + HTTPS for calls across machines · object storage (S3) instead of a local folder · API and processing workers as
separate scaled processes with the Socket.IO Redis adapter · multi-party calls.
