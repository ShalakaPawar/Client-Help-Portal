# Demo video script (~8 minutes)

**Before recording:** Docker running · `npm run dev` (4 processes: shared, api, worker, web) · keys in `apps/api/.env` ·
headphones on · http://localhost:3000/api/health shows everything `true` (including `worker`).
Arrange: **window A (left) = consultant**, **window B (right) = client**, plus a terminal and the `data/recordings`
folder in Finder.

| Time | Do | Say |
|---|---|---|
| 0:00 | Show the README deliverables list | "Client Help Portal: Vue 3, NestJS, TypeScript, Postgres, Redis, self-hosted LiveKit with server-side recording. Everything runs locally from one `npm run setup`." |
| 0:30 | A: click **Sam Consultant**. B: click **Alice Client** | "Login is stored per tab, so two windows are two different users." |
| 0:50 | B: raise "Can't export the monthly report" | "Alice raises a request…" |
| 1:00 | Point at A: the request appears with a **New** tag | "…and it appears on the consultant's dashboard instantly, over a WebSocket. No refresh." |
| 1:15 | A: **Start call**. B: **Join call** | "The consultant starts the call; the client gets a Join button. LiveKit carries the media: browsers never connect to each other directly, which is what makes server-side recording possible." |
| 1:40 | B: consent dialog → **Yes, record** | "Recording needs the client's consent first. Consent is stored on the server; only the backend can start the recorder. Saying no keeps the call going unrecorded." |
| 2:00 | B: **Share screen**, pick a window. Both talk | "Alice shares her screen; we can both talk." |
| 2:30 | Finder: open `data/recordings/<newest>/composite`, show `seg_*.ts` growing | "The recording is written while the call runs: 4-second segments of screen plus both voices. Separately, each person's mic is recorded to its own file, which gives exact speaker labels later." |
| 3:00 | B: refresh the page | "If the client refreshes, they're taken straight back into the call. Recording never stopped: it runs on the server." |
| 3:30 | B: re-share screen. Optionally open B's call URL in a second tab → old tab says "moved" | "Same user in a second tab: the newest tab wins." |
| 4:00 | A: **End call** → **Yes, mark resolved** | "The consultant ends the call and marks the request resolved." |
| 4:15 | Both land on History: watch statuses: preparing video → transcript → summary | "Processing runs in a separate worker process: ffmpeg makes a seekable MP4, Deepgram transcribes each voice file, Claude writes the summary." |
| 5:00 | Play the video; click a transcript line | "Speaker labels are exact (Alice Client (Client) / Sam Consultant (Consultant)) and clicking a line jumps the video to that moment." |
| 5:30 | Show the summary: overview, issues, resolution, action items | "The summary uses a fixed JSON schema; the transcript is treated as untrusted input, so the model summarises instead of following instructions in it." |
| 6:00 | Log out B, log in **Bob Client**, open History | "Bob sees none of Alice's data. Everything not yours is a 404, so its existence isn't even revealed." |
| 6:30 | Terminal: `npm test` (or show the result) | "The required access-control test plus data-isolation tests: requests, calls, LiveKit tokens, recordings, transcripts and notifications." |
| 7:00 | Terminal: `node scripts/isolation-check.mjs` (or show the saved table in LIMITS.md) | "Process isolation: API latency is the same while the worker processes long recordings and even when the worker is killed; the queued job finishes after a restart." |
| 7:40 | Show `docs/` (DESIGN, LIMITS, COSTS, AI_USAGE) | "Design document, measured limits, LLM costs, and how AI was used and checked, including the bugs the checks caught." |

**Tips:** keep each window ≥ 1200 px wide · close other tabs that use the mic · if the screen picker shows no windows,
grant Chrome "Screen Recording" in macOS System Settings → Privacy & Security.
