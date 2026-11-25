# Client Help Portal: design

How the system is built and why. Measured details: [LIMITS.md](LIMITS.md) · [COSTS.md](COSTS.md).

## 1. What it is
A consultant supports several clients. A stuck client raises a help request; the consultant starts a screen-share
call from it. If the client agrees, the call (screen + both voices) is recorded on the server while it runs.
Afterwards both people see the video, a speaker-labelled transcript (click a line to jump the video) and a summary.

- **Stack:** Vue 3 · NestJS · TypeScript · PostgreSQL (Prisma) · Redis (BullMQ) · self-hosted LiveKit + Egress · Deepgram · Claude.
- **Runs:** on one machine. `npm ci` → `npm run setup` → add the 2 AI keys to `apps/api/.env` → `npm run dev` → http://localhost:5173 (API on :4610).

## 2. Accounts and roles
| Account (password `Demo1234!`) | Role | Can do |
|---|---|---|
| `admin@demo.com` | Admin | Add consultants, pick the default consultant, change any client's consultant. **No** access to requests, calls or history. |
| `consultant@demo.com` (Sam) | Consultant | Sees only his clients' requests; starts and ends calls; history. **Default consultant** for new signups. |
| `client1/2/3@demo.com` (Alice, Bob, Carol) | Client | Raise requests, join calls, consent, history of their own calls. |
| `consultant2@demo.com` (Riya) → `client4@demo.com` (Dan) | | Second pair, used to show that data is isolated. |

New clients sign up at `/signup` (clients only) and get the default consultant automatically. If there is no default
consultant, they see "wait until a consultant is assigned" and can't raise requests yet.

## 3. Architecture
```
                   BROWSERS (Chrome, one login per window; admin uses the same app at /admin)
+-- CLIENT WINDOW -------------------------------+            +-- CONSULTANT WINDOW ---------------------------+
| Vue 3 app (livekit-client)                     |            | Vue 3 app (livekit-client)                     |
| publishes screen share + mic                   |            | publishes mic, sees screen                     |
| consent, stop recording                        |            | starts / ends calls                            |
| history: video + transcript                    |            | history: video + transcript                    |
+------------------------------------------------+            +------------------------------------------------+
                         |                                                          |
                         | REST (HTTP) + WebSocket                                  | WebRTC media + LiveKit signalling
                         v  (via Vite :5173 proxy)                                  v
+-- API PROCESS  NestJS :4610 ---------------------------+          +-- LIVEKIT + EGRESS (Docker) ---------+
| REST: login, client signup, admin, requests,           |          | SFU: forwards each person's tracks   |
|       calls, history, video links                      |          | one room per call: call-{id}         |
| WebSocket (Socket.IO + Redis adapter)                  |          | accepts only our signed tokens       |
|   -> notifications to user:{id} rooms only             | --API--> | webhooks -> API                      |
| LiveKit: tokens, rooms, start/stop Egress              | <-hooks- |                                      |
| Webhooks from LiveKit (signature checked)              |          | EGRESS (recorder, Docker):           |
| Timers queue (BullMQ): ring timeout, grace,            |          |  composite: screen + both voices     |
|   auto-end, 30-min cap, recorder check                 |          |    -> 4 s HLS segments DURING call   |
| Guards + ScopeService: your data only (404);           |          |  track egress per mic -> .ogg        |
|   admin manages accounts, sees no calls                |          +--------------------------------------+
| NO ffmpeg, NO AI calls in this process                 |
+--------------------------------------------------------+
                         | adds job "process recording" after the call (Redis)      | writes files
                         v                                                          v
+-- WORKER PROCESS  NestJS (src/worker.ts) --------------+          +-- SHARED FOLDER ---------------------+
| Processing queue only (no HTTP, no sockets)            |          | ./data/recordings/{recordingId}/     |
| 1 FINALIZE  ffmpeg: HLS -> seekable MP4 (nice)         |          |  composite/ seg_*.ts (live)          |
| 2 TRANSCRIBE Deepgram per voice file                   |          |  audio/ client-1.ogg,                |
| 3 MERGE     offsets, speaker labels, echo              |          |         consultant-1.ogg             |
| 4 SUMMARIZE Claude, JSON schema, usage saved           |          |  final/ composite.mp4                |
| notifies browsers via Redis emitter                    |          | mounted in Egress as /data           |
| crash/restart: job waits in queue, resumes             |          +--------------------------------------+
+--------------------------------------------------------+
                         |                              |                           |
                         v                              v                           v
+-- DATA + EXTERNAL -------------------------------------------------------------------------------------------+
| +--------------------------------+   +--------------------------------+   +--------------------------------+ |
| | PostgreSQL (Docker)            |   | Redis (Docker)                 |   | External APIs (worker only)    | |
| | users, requests, calls,        |   | BullMQ: processing, timers     |   | Deepgram nova-3 (speech)       | |
| | recordings, transcripts,       |   | Socket.IO adapter/emitter      |   | Claude (summary)               | |
| | summaries (+ token usage)      |   | LiveKit + Egress coordination  |   | keys only on the server        | |
| | partial unique indexes:        |   +--------------------------------+   +--------------------------------+ |
| | one live call per consultant   |                                                                           |
| +--------------------------------+                                                                           |
+--------------------------------------------------------------------------------------------------------------+
```

**In plain words**
- The **browsers** only connect, publish and play. The call's media goes browser → LiveKit → other browser, never through our API.
- The **API process** decides who may do what: login, signup, requests, who may join a call (it issues the LiveKit pass), and when recording starts and stops.
- **LiveKit** forwards the live call. **Egress** is its recorder; it writes the files into a shared folder while the call runs.
- The **worker process** does the heavy work after the call: video file, transcript, summary. It has no web server, so a slow or crashed job can't affect users.
- **Postgres** holds all data. **Redis** holds the job queues and passes the worker's notifications to the browsers. Recordings are files on disk.

| Channel | Carries |
|---|---|
| REST (HTTP) | Every change: login, signup, requests, start/join/end call, consent, history, video link, admin |
| WebSocket (Socket.IO) | Instant notifications to the right user only (new request, incoming call, call ended, progress) |
| WebRTC via LiveKit | The live screen and voices |
| LiveKit webhooks → API | Who joined/left, a microphone appeared, a recorder started/finished |
| BullMQ (Redis) | The processing job (worker) and timers (ring timeout, grace, auto-end, 30-min cap) |

### What gets recorded (3 files per call)
| File | Used for |
|---|---|
| `final/composite.mp4`: screen + both voices (made from 4 s segments written during the call) | Watching the call; seeking |
| `audio/client-N.ogg`: the client's microphone only | The client's transcript lines |
| `audio/consultant-N.ogg`: the consultant's microphone only | The consultant's transcript lines |

Separate voice files mean every transcript line has the right speaker, even when people talk over each other.

## 4. Key decisions (and why, in one line)
| Area | Decision | Why |
|---|---|---|
| Structure | One repo: web app, API, shared types | One install; frontend and backend can't disagree on data shapes |
| Processes | API and worker are separate processes | Heavy or failing processing never slows or breaks the app for users |
| Database | PostgreSQL + Prisma | Reliable for several writers; can guarantee "one live call per consultant" itself |
| Login | JWT stored per browser tab | Two windows can be two different users; a refresh keeps you logged in |
| Data access | Every query is filtered to "your" rows; anything else is 404 | You can't forget a check, and nobody learns that other data exists |
| Admin | Separate role for accounts only | Someone can manage consultants without seeing anyone's calls |
| Signup | Clients only, auto-assigned to the default consultant | New clients can get help at once; staff accounts stay controlled |
| Live media | Self-hosted LiveKit server | The server sees the media, so it can record; works offline with no account |
| Recording | Recorded on the server by Egress, after consent | Survives the client refreshing or closing the tab; the client must agree first |
| Recording files | Video + one voice file per person | Exact speaker labels without guessing |
| Video settings | 720p, built-in "speaker" layout, 4 s segments | Readable screen text at half the CPU of 1080p; little lost if something crashes |
| Storage | Local shared folder | Nothing extra to install; the API and recorder see the same files |
| Jobs | BullMQ on Redis | Retries, delays and recovery after restarts come built in |
| Speech-to-text | Deepgram, one request per voice file | Accurate sentence timestamps for click-to-seek |
| Summary | Claude with a fixed JSON format (model set in `.env`) | Always valid for the page; the transcript is treated as text to summarise, not instructions |
| Video link | Signed link valid 5 minutes, one recording only | A video tag can't send the login token; the link is useless to others later |
| Notifications | Socket.IO, one private room per user | Instant updates that only reach the people involved |
| AI keys | Optional at start, never faked | The app runs without them; processing then shows a clear message |

## 5. How things flow

### 5.1 Request → call → consent
```
       Client browser                  NestJS                  LiveKit server            Consultant browser
       ==============                  ======                  ==============            ==================
              |                           |                           |                           |
              | POST /requests            |                           |                           |
              |-------------------------->|                           |                           |
              |                           |-- save, then emit         |                           |
              |                           | socket  request:created   |                           |
              |                           |------------------------------------------------------>|
              |                           |                           |                           |
              |                           | POST /requests/:id/calls  |                           |
              |                           |<------------------------------------------------------|
              |                           |-- WAITING + ring timer    |                           |
              |                           | createRoom call-{id}      |                           |
              |                           |-------------------------->|                           |
              | socket call:incoming      |                           |                           |
              |<--------------------------|                           |                           |
              | POST /calls/:id/join      |                           |                           |
              |-------------------------->|                           |                           |
              | 200 + LiveKit token       |                           |                           |
              |<--------------------------|                           |                           |
              |                           | GET .../livekit-token     |                           |
              |                           |<------------------------------------------------------|
              |                           | LiveKit token             |                           |
              |                           |------------------------------------------------------>|
              |   token: JWT signed with our LiveKit secret, room call-{id}, identity = userId    |
              |   client may publish screen + mic, consultant may publish mic; both subscribe     |
              |                           |                           |                           |
              | connect(ws://localhost:7880, token)                   |                           |
              |------------------------------------------------------>|                           |
              |                           |                           | connect(ws..., token)     |
              |                           |                           |<--------------------------|
              |                           |                           |-- verify token + room     |
              |                           | hook: participant_joined  |                           |
              |                           |<--------------------------|                           |
              |                           |-- Call ACTIVE             |                           |
              |   LiveKit negotiates WebRTC with each browser itself (no Socket.IO signalling)    |
              | publish screen + mic      |                           |                           |
              |------------------------------------------------------>|                           |
              |                           |                           | forward screen + mic      |
              |                           |                           |-------------------------->|
              |                           |                           | publish mic               |
              |                           |                           |<--------------------------|
              | forward consultant mic    |                           |                           |
              |<------------------------------------------------------|                           |
              |                           |                           |                           |
              |-- consent modal: Allow    |                           |                           |
              | POST /calls/:id/consent   |                           |                           |
              |-------------------------->|                           |                           |
              |                           |  -> recording starts (Flow 2)                         |
              |                           |                           |                           |
```

### 5.2 Recording on the server
```
           NestJS                  LiveKit server              LiveKit Egress             ./data/recordings
           ======                  ==============              ==============             =================
              |                           |                           |                           |
              |-- consent GRANTED saved   |                           |                           |
              | StartRoomComposite        |                           |                           |
              |-------------------------->|                           |                           |
              | StartTrackEgress x2       |                           |                           |
              |-------------------------->|                           |                           |
              |                           | assign jobs (Redis)       |                           |
              |                           |-------------------------->|                           |
              |                           | join as hidden recorder   |                           |
              |                           |<--------------------------|                           |
              | hook: egress_started x3   |                           |                           |
              |<--------------------------|                           |                           |
              |-- save egress ids + start |                           |                           |
              |-- socket recording:status |                           |                           |
              |                           |                           |                           |
              |                           | LOOP while the call runs  |                           |
              |                           |                           | composite seg_N.ts / 4s   |
              |                           |                           |-------------------------->|
              |                           |                           | append client-1.ogg       |
              |                           |                           |-------------------------->|
              |                           |                           | append consultant-1.ogg   |
              |                           |                           |-------------------------->|
              |                           |                           |                           |
              |          a mic track appears later (late join, refresh, mic re-enabled)           |
              | hook: track_published     |                           |                           |
              |<--------------------------|                           |                           |
              | StartTrackEgress (new)    |                           |                           |
              |-------------------------->|                           |                           |
              |-- new voice piece+offset  |                           |                           |
              |                           |                           |                           |
              |                  call ends: End button / auto-end / 30-min cap                    |
              | StopEgress (all)          |                           |                           |
              |-------------------------->|                           |                           |
              |                           |                           | last segment + playlist   |
              |                           |                           |-------------------------->|
              | hook: egress_ended x N    |                           |                           |
              |<--------------------------|                           |                           |
              |-- all ended -> BullMQ job |                           |                           |
              |                           |                           |                           |
```

### 5.3 After the call (worker process)
```
+--------------------------------------------------------+
| 1. CALL ENDS  (End button / auto-end / 30-min cap)     |
|    NestJS: StopEgress for all recorders,               |
|    deleteRoom, Call = ENDED, Recording = STOPPING      |
+--------------------------------------------------------+
                            |
                            v
+--------------------------------------------------------+
| 2. WAIT FOR EGRESS  (webhooks)                         |   <-- an egress ended with an error -> marked missing,
|    egress_ended for composite + every voice piece      |         the rest is still processed (partial = true)
|    all done -> Recording = FINALIZING                  |       no webhook within 2 min -> timer job checks the
|    add BullMQ job (jobId = recordingId)                |         Egress API status (webhooks can be missed)
+--------------------------------------------------------+
                            |
                            v
+--------------------------------------------------------+
| 3. FINALIZE  (ffmpeg subprocess)                       |   <-- ffmpeg error -> segments kept, Recording FAILED,
|    composite/index.m3u8 + seg_*.ts                     |         error shown + Retry button
|      -> final/composite.mp4 (copy, +faststart)         |
|    list voice pieces: client-1..N, consultant-1..N     |
|    Recording = AVAILABLE  (video playable now)         |
+--------------------------------------------------------+
                            |
                            v
+--------------------------------------------------------+
| 4. TRANSCRIBE  (Deepgram nova-3)                       |   <-- 429 / 5xx / timeout -> BullMQ retry x3, backoff
|    each voice piece (.ogg) -> utterances + timestamps  |       400 / 401 / no key -> fail now, clear message
|    pieces in parallel (concurrency limit)              |       a speaker with no audio -> other speaker only
|    processing = TRANSCRIBING                           |
+--------------------------------------------------------+
                            |
                            v
+--------------------------------------------------------+
| 5. MERGE  (pure function transcript-merge)             |   <-- overlapping speech -> both lines kept,
|    offset = voice media start - video media start      |         shown in time order
|    label "Client 1 (Client)" / "Sam (Consultant)"      |
|    drop echo duplicates, sort by start time            |
|    save Transcript                                     |
+--------------------------------------------------------+
                            |
                            v
+--------------------------------------------------------+
| 6. SUMMARIZE  (Claude, structured output + zod)        |   <-- refusal / invalid output -> 1 retry -> FAILED,
|    overview, issues, resolution, actions, outcome      |         transcript + video stay available
|    processing = SUMMARIZING -> save Summary            |
+--------------------------------------------------------+
                            |
                            v
+--------------------------------------------------------+
| 7. DONE  processing = DONE                             |
|    socket processing:updated -> client + consultant    |
|    both History pages refresh live                     |
+--------------------------------------------------------+
```

### 5.4 Watching and click-to-seek
```
              Browser (History detail page)                                      NestJS
              =============================                                      ======
                            |                                                       |
                            | GET /recordings/:id/media-token  (Bearer JWT)         |
                            |------------------------------------------------------>|
                            |                                                       |-- ScopeService: my recording?
                            | { url: "/media/<signed token, 5 min>" }               |
                            |<------------------------------------------------------|
                            |-- <video src="/media/<token>">                        |
                            | GET /media/<token>   Range: bytes=0-                  |
                            |------------------------------------------------------>|
                            |                                                       |-- verify signature + expiry
                            | 206 Partial Content (streamed)                        |
                            |<------------------------------------------------------|
                            |                                                       |
                      user clicks a transcript line -> video.currentTime = startMs / 1000
                            | GET /media/<token>   Range: bytes=N-                  |
                            |------------------------------------------------------>|
                            | 206 (only that part of the file)                      |
                            |<------------------------------------------------------|
                            |                                                       |
                   token expired -> 401 -> page gets a new token -> resumes at the same time
                            |                                                       |
```

### 5.5 Drops, refresh, second tab
```
           Client browser                          NestJS                        LiveKit (+ Egress)
           ==============                          ======                        ==================
                  |                                   |                                   |
                  |                           A. network blip                             |
                  | connection drops                  |                                   |
                  |---------------------------------------------------------------------->|
                  |-- "Reconnecting..." banner        |                                   |
                  | auto-reconnect (SDK, same room)   |                                   |
                  |---------------------------------------------------------------------->|
                  |           recording never stopped (it runs on the server)             |
                  |                                   |                                   |
                  |                     B. page refresh / tab closed                      |
                  |                                   | hook: participant_left            |
                  |                                   |<----------------------------------|
                  |                                   |-- grace timer 60 s (BullMQ)       |
                  |                                   |-- notify consultant: Client left  |
                  |-- page reloads; token in          |                                   |
                  |-- sessionStorage still valid      |                                   |
                  | GET /calls/active                 |                                   |
                  |---------------------------------->|                                   |
                  | call + fresh LiveKit token        |                                   |
                  |<----------------------------------|                                   |
                  | connect again, same identity      |                                   |
                  |---------------------------------------------------------------------->|
                  |                                   | hook: participant_joined          |
                  |                                   |<----------------------------------|
                  |                                   |-- cancel grace timer              |
                  |-- pick the screen again           |                                   |
                  | publish screen + mic              |                                   |
                  |---------------------------------------------------------------------->|
                  |                                   | hook: track_published             |
                  |                                   |<----------------------------------|
                  |                                   | StartTrackEgress (new piece)      |
                  |                                   |---------------------------------->|
                  composite kept recording the whole time; the gap shows no screen briefly
                  |                                   |                                   |
                  |                   C. same user opens a second tab                     |
                  | 2nd tab connects, same identity   |                                   |
                  |---------------------------------------------------------------------->|
                  |        LiveKit drops the older session with the same identity         |
                  | old tab: Disconnected             |                                   |
                  |<----------------------------------------------------------------------|
                  |-- "Call moved to another tab"     |                                   |
                  |                                   |                                   |
                  |    D. both gone 3 min -> auto-end job -> StopEgress + deleteRoom      |
                  |                   -> process whatever was recorded                    |
                  |                                   |                                   |
```

### 5.6 States
```
HELP REQUEST
                 start call                   end (resolved)
   [ OPEN ] -------------------> [ IN_CALL ] -------------------> [ RESOLVED ]
     |  ^                             |
     |  +-----------------------------+
     |     end (still open) / call missed
     |
     +--- client cancels ---> [ CANCELLED ]

CALL
                 client joins (participant_joined)     end / auto-end / 30-min cap
   [ WAITING ] ------------------------------> [ ACTIVE ] --------------------------> [ ENDED ]
       |
       +--- 2-min ring timeout ---> [ MISSED ]

RECORDING
                      granted              egress_started             call ends / stop
 [ PENDING_CONSENT ] ---------> [ STARTING ] ------------> [ RECORDING ] ----------> [ STOPPING ]
         |                                                                                |
         +--- declined ---> [ NONE ]                                     all egress_ended |
                                                                                          v
                      [ AVAILABLE ] <---- ffmpeg ok ---- [ FINALIZING ] <-----------------+
                                                            |      ^
                                              ffmpeg error  v      | Retry
                                                       [ FAILED ] -+

PROCESSING (transcript + summary)
  [ PENDING ] ---> [ TRANSCRIBING ] ---> [ SUMMARIZING ] ---> [ DONE ]
                          |                     |
                          +----------+----------+
                                     | retries used up
                                     v
                                [ FAILED ] --- Retry button ---> [ PENDING ]
                                (if the summary failed, the transcript is kept)
```

## 6. Data
| Table | Holds |
|---|---|
| User | name, email, password hash, role (client / consultant / admin), assigned consultant, "is default consultant" |
| HelpRequest | client, consultant, title, description, status (open / in call / resolved / cancelled) |
| Call | request, client, consultant, LiveKit room, status, consent, start and end times |
| Recording | status, video start time, length, "partly recorded", processing status, last error |
| RecordingEgress | one row per recorder: video or voice, whose voice, media start time, file |
| Transcript | lines: speaker, role, start/end (ms), text |
| Summary | overview, issues, resolution, action items, outcome, model, tokens used |
| WebhookEvent | LiveKit event ids already handled (so repeats are ignored) |

Database rules: one live call per consultant and per request; one default consultant at most; a microphone track is
recorded only once.

## 7. Who can see what
| Data | Client | Consultant | Admin |
|---|---|---|---|
| Help requests | own | own clients' | none |
| Calls, LiveKit pass | own | own clients' | none |
| Recordings, transcripts, summaries | own | own clients' | none |
| Notifications | own | own | none |
| Consultants and client assignments | own consultant's name | none | all |

Anything outside these returns **404**. The API and the worker are separate processes: the worker can be stopped or
crash and the app keeps working; finished calls wait in the queue and are processed when it's back.

## 8. When things go wrong
| Situation | What happens |
|---|---|
| Network blip | The call reconnects by itself; recording continues on the server |
| Client refreshes / closes the tab | Rejoins the same call; the video has a short gap; voice continues in a new file |
| Same user opens a second tab | The new tab takes over; the old one says the call moved |
| Someone leaves | The other person is told after 60 s; if both are gone for 3 min the call ends and is processed |
| Client never answers | After 2 min the call is "missed" and the request is open again |
| All recorders busy | The call goes on without recording; the page says so |
| Worker stopped | The app works normally; processing waits and resumes |
| Deepgram / Claude down or key missing | Clear message on the history page with a Retry button; the video still plays |
| Call ended by either person | Both pages leave the call; opening an ended call shows its history |

## 9. Limits (measured on this Mac; Docker has 4 CPUs; details in LIMITS.md)
- **One recorded call at a time.** More calls can run, but only one is recorded; to record more, give Docker more CPUs.
- The video starts ~7–9 s after consent; the voices start at once (so the transcript still covers those seconds).
- ~7.5 MB of storage per call-minute; ~8 s from end of call to summary.
- Both windows on the same computer; English only; calls capped at 30 minutes; two people per call.

## 10. Cost of the AI summary (Claude only; details in COSTS.md)
Measured with `claude-haiku-5-5`: about **$0.0014 for a 15-minute call** (~$1.40 per 1,000 calls).
The model is one setting (`CLAUDE_MODEL`); Opus 5.5 is roughly 40× that.

## 11. Tests and checks
| Command | What it proves | Safe during a demo? |
|---|---|---|
| `npm test` | 77 API tests (access control, data and process isolation, signup/admin, calls, recording, processing) + 12 web tests | Yes: own test database |
| `npm run typecheck`, `npm run lint` | Code is consistent | Yes |
| `node scripts/isolation-check.mjs` | API stays fast while the worker is busy or killed | Not while recording: it keeps the worker busy for about a minute |
| `npm run e2e:smoke` (`SPEECH=1`, `ENDED_BY=client`) | A real call end to end; transcript timing matches the video | Not while recording: it uses the only recorder |

Both scripts use their own temporary accounts and delete everything they create, so the demo accounts stay clean.

## 12. Repository
```
apps/api      NestJS: main.ts (API) and worker.ts (worker); prisma/ (schema, migrations, seed); test/
apps/web      Vue 3 app: login, signup, dashboards, call room, history, admin
packages/shared   types and event names used by both
docker/       LiveKit and Egress config templates (filled in by setup)
scripts/      setup, db-reset, isolation-check
e2e/          real-call smoke test (two Chrome sessions)
docs/         DESIGN, LIMITS, COSTS
```
