# How AI was used and checked

The project was built with an AI coding assistant (Claude Code). The approach:

1. **Plan first, in writing.** The requirements were turned into a reviewed plan (architecture, data model, API,
   state machines, failure cases, tests) before any code. Major choices were made by the developer after discussing
   options: e.g. LiveKit + server-side Egress instead of browser-to-browser WebRTC, 3 recording outputs instead of
   diarization, BullMQ instead of a home-made Postgres queue, local-only instead of deployment.
2. **One module at a time**, each with its interfaces and failure cases spelled out.
3. **Verify everything that can be verified**: type-check, lint, automated tests, and real runs against the actual
   Docker services (health check, login, requests, LiveKit room creation, WebSocket delivery through the proxy,
   signed LiveKit webhooks reaching the API).
4. **Small commits** so the history shows what changed and why.

## Things the checks caught (and how they were fixed)

| Issue found | How it was caught | Fix |
|---|---|---|
| `ParticipantInfo_Kind` is not exported by `livekit-server-sdk` | Type-check | Recognise recorders by their `EG_` identity; real users are matched by id anyway |
| Socket listeners registered before login were never attached | Code review of the socket helper | Listener registry re-applied on every (re)connect |
| Egress in Docker could not reach LiveKit's `127.0.0.1` ICE candidates | Design check of container networking | Egress shares LiveKit's network namespace (`network_mode: service:livekit`) |
| `docker compose restart` fails for a container sharing another's network | Running setup | Recreate both containers in order (`up --force-recreate`) |
| npm 12 blocks dependency install scripts (esbuild, Prisma, ffmpeg) | `npm install` warnings | Explicit `allowScripts` list in `package.json` (others denied) |
| BullMQ custom job ids may not contain `:` | Known library rule, checked while writing the queue code | Ids use `-` |
| Test files truncating one shared test DB in parallel broke each other | Running the full suite | `maxWorkers: 1` with a comment explaining why |
| A webhook can arrive before the recorder row exists | Reasoning about event order | Start times are also taken from the final `egress_ended` event; a fallback job asks LiveKit if an end event never comes |
| Two "Start call" clicks at once could create two calls | Test written for the race | Partial unique indexes in Postgres; the test proves only one call is created |
| Tailwind v4 cannot `@apply` custom classes declared with `@layer components` | Production build (`npm run build`) | Shared classes declared with `@utility` |
| Composite recording aborted: "Start signal not received" | Real-media smoke test (`npm run e2e:smoke`) + Egress logs | LiveKit advertised only `127.0.0.1`; Egress's headless Chrome won't connect from a container address to loopback. Now LiveKit offers its container IP **and** a loopback candidate (`enable_loopback_candidate`) |
| Only one of the two voice recorders started | Smoke test + DB rows (second start timed out) | Egress reserves CPU per recorder and Colima has 4 CPUs; lowered `cpu_cost` for local use |
| Voice files only appear when a recorder finishes | Smoke test checked too early | Check after the call ends (documented) |
| API watch mode stopped emitting after a production build | `npm run dev` failed: `dist/main` missing | Removed TypeScript `incremental` (Nest `deleteOutDir` + incremental cache skips emit); ignore `*.tsbuildinfo` |
| ESLint `no-undef` flagged browser globals in TypeScript files | Lint | Disabled for TS (the compiler already checks it), as typescript-eslint recommends |

## Real-media smoke test
`npm run e2e:smoke` drives two Chrome sessions (fake mic + fake screen) through the real UI, LiveKit and Egress:
login → instant request → call → consent → screen received by the consultant → composite segments written during the
call → one voice file per person → end → history processing. It found the two recording bugs above.

## What was checked by hand
- Real screen sharing, both microphones, the consent flow, recording files appearing during the call, playback and
  seeking, refresh/rejoin and second-tab behaviour (see `docs/demo-checklist.md`). These involve browser permissions and
  real media, so they are not automated.
