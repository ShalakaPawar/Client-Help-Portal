# Client Help Portal

A consultant supports several clients. When a client is stuck they raise a help request; the consultant starts a
screen-share call from it. With the client's consent the call (screen + both voices) is **recorded on the server while
it runs**. Afterwards both people get the recording, a **speaker-labelled transcript** (click a line to jump the video)
and a **summary** in their history.

**Stack:** Vue 3 · NestJS · TypeScript · PostgreSQL (Prisma) · Redis (BullMQ) · self-hosted LiveKit + LiveKit Egress ·
Deepgram (speech-to-text) · Claude (summary). Everything runs locally.

---

## Quick start

**You need:** Node 20+ (22 recommended, see `.nvmrc`), Docker (Docker Desktop or Colima with the Compose plugin,
≥ 4 GB RAM for Docker), Chrome, headphones. For transcripts/summaries: a Deepgram key and an Anthropic key.

```bash
git clone <repo-url> && cd client-help-portal
npm ci
npm run setup      # safe to re-run: secrets, Docker services, migrations, demo accounts
# add DEEPGRAM_API_KEY and ANTHROPIC_API_KEY to apps/api/.env  (optional, needed for transcript + summary)
npm run dev        # http://localhost:5173
```

The first `npm run setup` downloads the LiveKit Egress image (large, several minutes).

### Demo accounts (password `Demo1234!`, or use the one-click buttons)

| Account | Role | Notes |
|---|---|---|
| `consultant@demo.com` (Sam) | Consultant | Assigned: client1–3 |
| `client1@demo.com` (Alice), `client2@demo.com` (Bob), `client3@demo.com` (Carol) | Client | |
| `consultant2@demo.com` (Riya) → `client4@demo.com` (Dan) | | Only there to prove data isolation |

**Two users at once:** login is stored per tab (sessionStorage), so open two Chrome windows and log in as a different
user in each.

### Demo flow
1. Window A: **consultant**. Window B: **client1**.
2. B raises a request → it appears on A's dashboard instantly.
3. A clicks **Start call** → B sees **Join call** → B joins and clicks **Share screen**; both talk (use headphones).
4. B is asked for consent → **Yes, record** → both see **● Recording**. Files appear in `data/recordings/` during the call.
5. Try a refresh in B mid-call → B is taken back into the call (re-pick the screen).
6. A clicks **End call** → marks resolved or not.
7. **History** → the video, the transcript ("Alice Client (Client): …"), click a line to seek, and the summary.
8. Log in as `client2` → none of client1's data is visible.

Queue dashboard (dev): http://localhost:3000/api/admin/queues · Health: http://localhost:3000/api/health

---

## Architecture

```
 Client window (Vue)                                Consultant window (Vue)
   publishes screen + mic                             publishes mic
        │   └──────── WebRTC media ───────┐   ┌──────────────┘
        │ REST + WebSocket (Socket.IO)     ▼   ▼
        ▼                          ┌─────────────────────┐   hidden recorder   ┌──────────────────────┐
  Vite :5173 (proxy) ──▶ NestJS ──▶│ LiveKit server (SFU)│◀───────────────────▶│ LiveKit Egress        │
                     :3000  ▲  API └─────────────────────┘                     │ composite (HLS, 4 s)  │
                            │  tokens, egress start/stop                       │ + 1 .ogg per mic      │
                            └─ webhooks (joined/left, track, egress) ─────────  └──────────┬───────────┘
                                                                                          ▼
   Postgres (truth) · Redis (BullMQ jobs + timers) · data/recordings/ (shared folder) ◀──────┘
   BullMQ job after the call: ffmpeg (HLS → seekable MP4) → Deepgram per voice file → merge → Claude summary
```

| Channel | Carries |
|---|---|
| REST | Every change: login, requests, start/join/end call, consent, LiveKit token, history, video link |
| WebSocket (Socket.IO) | Notifications only: `request:created`, `call:incoming`, `call:ended`, `recording:status`, `processing:updated` |
| LiveKit (WebRTC) | Live screen + voices between the browsers (never through NestJS) |
| LiveKit webhooks → NestJS | Presence, new microphone tracks, recorder started/ended |
| BullMQ | Processing job and delayed timers (ring timeout, auto-end, 30-min cap, recorder safety check) |

### Recording (3 outputs per call)
| Output | Made by | Used for |
|---|---|---|
| `composite/` HLS segments → `final/composite.mp4` | RoomComposite egress (screen + both voices) | Playback, click-to-seek |
| `audio/client-N.ogg` | Track egress on the client's mic | Client's transcript lines |
| `audio/consultant-N.ogg` | Track egress on the consultant's mic | Consultant's transcript lines |

Separate voice files give **exact** speaker labels (no diarization guessing) and keep both people's words when they talk
over each other. Each recorder's start time from LiveKit puts every line on the video timeline.

### Repository
```
apps/api      NestJS: auth, requests, calls, livekit (tokens, webhooks), recordings (egress), processing, history
apps/web      Vue 3: dashboards, call room (livekit-client), history with player + transcript
packages/shared   enums, response types and socket event types used by both
docker/       LiveKit/Egress config templates (filled by setup)
scripts/      setup.mjs, db-reset.mjs
docs/         decisions.md, AI_USAGE.md, demo-checklist.md
```

---

## Requirements → where they are met

| Requirement | How |
|---|---|
| 1. Two roles, seeded users, simple login, two windows | `prisma/seed.ts`, JWT in sessionStorage, one-click login |
| 2. Request appears instantly | REST create → Socket.IO `request:created` to the consultant |
| 3. Screen-share call, both talk | LiveKit room per call; client publishes screen + mic, consultant mic |
| 4. Consent before recording; recorded + uploaded during the call | Consent saved server-side, only then NestJS starts Egress; segments/voice files written live |
| 5. Transcript + summary in the background, shown with the recording | BullMQ job; History detail page |
| 6. Users only see their own data + a test | `ScopeService` filters every query (404 if not yours); `test/access-control.e2e-spec.ts` |
| Stretch: speaker labels · click-to-seek · rejoin after refresh | Per-voice files · Range-served MP4 + utterance timestamps · `GET /calls/active` + fresh LiveKit token |

---

## Tests

```bash
npm test          # API (Jest, real Postgres test DB) + web (Vitest)
npm run typecheck && npm run lint
```

- **Required:** `apps/api/test/access-control.e2e-spec.ts`: client2 and an unassigned consultant get 404 on client1's
  request, call, history, video link and LiveKit token; lists never include it; no login → 401; forged webhook → 401.
- `call-recording.e2e-spec.ts`: call lifecycle, two simultaneous "Start call" clicks → exactly one call, consent rules,
  recorder orchestration (duplicates ignored, new voice piece after refresh), finalize queued exactly once, partial recordings.
- `processing.e2e-spec.ts`: transcript on the video timeline with labels, permanent vs retryable provider errors,
  summary failure keeps the transcript, silence.
- Unit tests: transcript merge + echo removal, state rules, ffmpeg/Deepgram/Claude adapters, web seek/highlight helpers.

LiveKit and the AI providers are test doubles in tests; the running app never uses fakes.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm run setup` says Docker is not running | Start Docker Desktop / `colima start` |
| `docker compose` not found (Colima) | `brew install docker-compose` and link it into `~/.docker/cli-plugins` |
| Health shows `livekit: false` | `docker compose ps`; `npm run setup` again (recreates LiveKit/Egress) |
| No sound / echo | Click "Turn on sound" if shown; use headphones |
| "Microphone access is blocked" | Allow the mic in Chrome's address bar, then Unmute |
| History says "Deepgram is not configured" | Add the key to `apps/api/.env`, restart `npm run dev`, click Retry |
| "ffmpeg not found" | `npm rebuild ffmpeg-static`, or install ffmpeg and set `FFMPEG_PATH` |
| Start fresh | `npm run db:reset` (asks first) |

## Known limitations
- Runs on one machine: LiveKit is bound to 127.0.0.1 and there is no TURN/HTTPS, so the two windows must be on the same computer.
- Egress runs headless Chrome (large image, ~2–4 GB RAM) and loads its layout page from the internet.
- Calls are capped at 30 minutes (`MAX_CALL_MINUTES`). Two-person calls only. English transcription.
- After a refresh the client must pick the screen again; the video shows a short gap.
- Talking over each other appears as separate lines in time order. Echo needs headphones (plus browser echo cancellation and a merge-time dedupe).

See [`docs/decisions.md`](docs/decisions.md) for every design choice with alternatives and trade-offs, and
[`docs/AI_USAGE.md`](docs/AI_USAGE.md) for how AI was used and checked.
