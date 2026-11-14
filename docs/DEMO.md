# Submission demo

[Watch the recorded dashboard demo](demo.webm) (2 minutes 11 seconds).

The recording uses the actual Next.js dashboard and Express/BullMQ backend,
real PostgreSQL and Redis, and **real Ethereal SMTP**. Ethereal captures the
messages; it does not deliver to real recipient inboxes. Captions explain each
step. The backend is actually terminated and restarted during the recording.

## What the recording demonstrates

1. Register and sign in with an email/password account. Google OAuth is an
   alternative, described in the main README.
2. Compose an HTML email for Alice, Bob, and Charlie at `example.com`.
3. Choose a future send time, a two-second recipient delay, and an hourly limit
   of **two**. Submit the campaign and show all three emails in Scheduled.
4. Stop the backend while the emails are still in the future. PostgreSQL and
   Redis continue running. The recorder verifies that the API is offline.
5. Restart the same backend against the same stores. Refresh the dashboard and
   show the original scheduled emails, without recreating the campaign.
6. Wait for the original scheduled time. Show the two completed emails in Sent,
   including persisted Ethereal preview links.
7. Show the third email still in Scheduled, delayed to the next UTC hour by the
   sender quota. This is the optional rate-limit demonstration.
8. Reload the dashboard to verify that the session and persisted records remain.

Recording evidence is in [demo-evidence.json](demo-evidence.json). Still frames:
[Scheduled](demo-scheduled.png), [Sent](demo-sent.png),
[rate-limit deferral](demo-rate-limit.png).

## Reproduce manually

Follow the root README's setup steps. Use three recipients and set the campaign's
hourly limit to two. Choose a send time at least one minute in the future.

After submission, stop **only the backend** with Ctrl+C, then restart it with
`npm --prefix backend run dev`. Keep Redis/PostgreSQL running and retain their
Docker volumes. Refresh the dashboard; the original emails remain scheduled.
At the scheduled time, two messages move to Sent and the third is deferred.

The short demo does not wait a full hour for the third email. The automated
integration check separately verifies that a deferred email is delivered after
quota becomes available, using the isolated test services and an accelerated
delay. It also covers abrupt termination, transient SMTP failure, queue recovery,
and cross-campaign send spacing.

## Submission checklist

- Repository: `https://github.com/reigen002/email_scheduler` (private).
- Reviewer: `Mitrajit` has write access, verified during preparation.
- Backend and frontend source files are included in the parent repository.
- README includes setup, Ethereal/environment configuration, architecture,
  implemented features, and assumptions/trade-offs.
- Demo is shorter than five minutes and covers scheduling, dashboard views,
  restart persistence, and bonus rate-limit behavior.
- No `.env` credentials, dependency folders, build outputs, or preserved nested
  Git history belong in the submission commit.
- Submit the repository URL and demo through
  https://forms.gle/2qmgDJxV3HZmf9Pt8 after the prepared changes are pushed.
