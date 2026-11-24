# Demo checklist

Before the demo: `npm run setup` (Docker running), keys in `apps/api/.env`, `npm run dev`, headphones on.
Check http://localhost:3000/api/health shows everything `true`.

1. **Two users**: Chrome window A → *Sam Consultant*; window B → *Alice Client* (one-click buttons).
2. **Instant request**: B raises "Can't export the monthly report" → appears in A with a *New* tag (no refresh).
3. **Call**: A clicks *Start call* → B's banner *Join call* → B joins.
4. **Screen + voices**: B clicks *Share screen* → A sees B's screen; both talk.
5. **Consent**: B gets *Can we record this call?* → *Yes* → *● Recording* in both windows.
   Show `data/recordings/<id>/composite/seg_*.ts` and `audio/*.ogg` growing during the call.
6. **Rejoin**: refresh B → back in the call, *Share screen* again. A saw "disconnected… waiting".
7. **Second tab**: open B's call URL in another tab → the old tab shows "opened in another tab".
8. **End**: A → *End call* → *Yes, mark resolved*. Both land on the history page; statuses update live
   (*Preparing the video → Making the transcript → Writing the summary*). Queue board: http://localhost:3000/api/admin/queues
9. **History**: video plays and seeks; transcript lines are labelled *Alice Client (Client)* / *Sam Consultant
   (Consultant)*; clicking a line jumps the video; summary with outcome and action items.
10. **Isolation**: log in as *Bob Client* → nothing of Alice's. Run `npm test` and point at
    `apps/api/test/access-control.e2e-spec.ts`.
11. **Failure handling (optional)**: remove `DEEPGRAM_API_KEY`, restart, make a short call → History shows a clear
    error and a *Retry* button; add the key back, click *Retry*.
