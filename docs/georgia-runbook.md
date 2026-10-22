# Georgia and the ProsperWise system: runbook

Draft for Rolf, 2026-10-22. Written so that you (or anyone helping you) can tell what is running, stop it, check it, and put it right. No secret values are in this document; it names where they live.

**Check anything marked "(verify)" before relying on it. It comes from memory of how this was set up, not from a fresh look.**

---

## 1. Where to look first

**Ask Georgia page, "System health" card** (app.prosperwise.ca/ask-georgia). It shows each scheduled job (Running, Stopped, Failing, Not yet run), the Google connection and its permissions, the phone webhooks, the text and provider switches, how many items are waiting for you, and recent errors. Press "Check now" to refresh.

If a job stops or keeps failing, Georgia also sends you an in-app notification within about an hour (once a day per problem).

**Georgia's rulebook** (same page) lists her standing rules, the built-in rules she follows, and what she did on her own this week, with Undo for filed mail, closed tasks and accepted invitations.

---

## 2. What runs on its own

| What | How often | What it does | If it stops |
|---|---|---|---|
| Morning briefing | 5:30 am Pacific | Builds the Today page | Briefing shows yesterday's, or "No briefing yet". Press Regenerate. |
| Morning inbox sweep | 4:30 am Pacific | Sorts the last week of mail | Sweep card is stale. Press "Sweep now". |
| Notices (iA, Adobe Sign) | every 30 min | Comments on and closes the client's task, files the mail, or flags it | Notices pile up in the Inbox. Nothing is lost. |
| Calendar invitations | every 30 min | Accepts clear webinars and training, flags the rest | Invitations stay unanswered. |
| Georgia's own tasks | every 15 min | Works tasks assigned to her | Her tasks wait. |
| Meeting notes | every 15 min | Drafts recaps from new Google Meet notes | No recap tasks appear. |
| Review and rebalancing reminders | every 30 min | Invites families, reminds, hands over | Reminders and invitations pause. |
| Rule suggestions | Sundays 5 am | Suggests rules from repeated answers | No suggestions. |
| Health watchdog | every 30 min | Alerts you if a job above stops | You lose the alerts. See section 6. |
| Client texts | when a text arrives | Georgia answers if you are unavailable | Texts wait for you. |

Scheduled job names in the database (for stopping one, section 4): `daily-briefing-generate-0530-pt-a` and `-b`, `inbox-sweep-morning-a` and `-b`, `notice-processor`, `calendar-invites`, `georgia-tasks`, `meeting-notes-scan`, `review-agent-tick`, `georgia-rule-suggestions`, `health-watchdog`.

---

## 3. Switches you can use right now (no code)

| To stop... | Do this |
|---|---|
| Georgia answering clients' texts | Inbox page, untick "Georgia answers when I can't" |
| Texts going out through Callizy (or Quo) | Inbox page, "Send texts through" |
| The morning sweep running by itself | Ask Georgia, Inbox sweep card, the "Run every morning" switch |
| Review and rebalancing emails to families | Georgia Reviews page, set the mode to Off (or Shadow, which records but sends nothing) |
| A rule she follows | Ask Georgia, her rulebook, "Forget" |
| One thing she did | Ask Georgia, "What she did on her own this week", Undo (filed mail, closed notice tasks, accepted invitations) |
| An item in your briefing | The small tick on the item (files the email in Gmail) |

**There is no switch yet for the notice processor or calendar invitations.** To stop either, unschedule its job (section 4). Adding switches is a sensible next step.

---

## 4. Stopping and restarting a scheduled job

You need the Supabase command line, signed in (a token in your terminal profile, never in this document). From the repository folder:

Stop a job:

```bash
npx supabase db query --linked "select cron.unschedule('notice-processor')"
```

Look at what is scheduled:

```bash
npx supabase db query --linked "select jobname, schedule, active from cron.job order by jobname"
```

Start it again by running its migration again, or ask for help: the migration for each job is in `supabase/migrations` (search for the job name). Do not delete a migration file.

---

## 5. Putting a code change live, or taking one back

**Normal deploy** (what happens each time you say "merge and deploy"):
1. Merge the pull request on GitHub (squash).
2. If it has a database change: apply the migration with `npx supabase db query --linked -f <file>`, then record it in `supabase_migrations.schema_migrations`.
3. Deploy the changed functions: `npx supabase functions deploy <name> --use-api`. Functions that are called by a schedule or by a phone provider need `--no-verify-jwt` too (their entries are in `supabase/config.toml`).
4. The website rebuilds by itself on merge (GitHub Actions, "Deploy to Firebase Hosting on merge").

**Take a change back:** revert its merge commit on `main` (`git revert <commit>`), push, then redeploy the same functions. A database change is not undone by reverting code: the new table or column stays, which is harmless unless it needs removing, so ask before dropping anything.

**Function limit:** the project is at 99 of 100 edge functions. New abilities go into existing functions. Do not create a new function without checking the count.

---

## 6. If something goes wrong

**Georgia answered a client's text badly.** Untick "Georgia answers when I can't" on the Inbox page now. Look at the text in the Inbox thread. Reply yourself; she holds for two hours after you do. Then tell me what she said, so her wording can be fixed.

**She closed a task she should not have.** Ask Georgia, rulebook activity list, Undo (reopens it). Then add a rule ("never close tasks about X"), or tell me the title so the rule in code can be tightened.

**She accepted an invitation you did not want.** Rulebook activity list, Undo (back to unanswered), then decline it yourself in the calendar.

**Mail is filed that should be in the Inbox.** Rulebook activity list, Undo (back in the Inbox, unread). Or search Gmail for the label `Georgia/Handled`.

**Briefing missing or old.** Press Regenerate on the Today page. If it fails, check System health for the briefing job and the Google connection.

**"Google is not connected" or permission warnings.** Settings, reconnect Google, and press "Allow archiving" on Ask Georgia if it shows. Georgia stops reading mail and the calendar until this is done.

**Texts are not arriving in the Inbox.** System health, Phone webhooks line. If events are being rejected, the signing secret is wrong. If nothing arrives at all, check the webhook in the phone provider's dashboard: Callizy turns a webhook off after ten failures, and has a power icon to turn it back on.

**Quo says "Not Enough Credits" (402).** Quo's automation credits are used up; sends from the CRM fail until they reset (monthly) or you buy more. Texts from the Quo app still work. Callizy has no such cap on sends from its app.

**A scheduled job shows Stopped or Failing.** Press "Check now". Read the line under the job. A failing job usually means Google, a provider, or a data problem; tell me the job and the message. To pause it while we fix it, unschedule it (section 4).

**The health alerts stop.** The watchdog is itself a scheduled job (`health-watchdog`). If you stop seeing the card update, check it is scheduled (section 4).

---

## 7. Where things live

Do not paste secrets into chat or documents. They are set in Supabase (Edge Functions, Secrets) and in the database vault.

| Thing | Where |
|---|---|
| Code | GitHub, repository `rolf-pwa/pwa` (branch `main`) |
| Database and functions | Supabase project `rpxevcovasrgmrzkpknu` (Canada, Montréal) |
| Website | Firebase Hosting, built by GitHub Actions on merge (verify the hosting project name) |
| AI models | Google Vertex AI, Montréal, Gemini, through the service account key |
| Google sign-in and APIs | Google Cloud project `gen-lang-client-0223396536`. Staff sign-in is an Internal client, client sign-in is a separate External client. |
| Phone: Quo | Quo dashboard. Number 778-721-5208. Credits reset monthly. |
| Phone: Callizy (trial) | Callizy dashboard. Number 778-721-5084. Webhook "CRM Integration". |
| Backups | **None automatic.** Manual export: `~/Documents/ProsperWise Portal/backups` (see section 8) |

Secret names (values are not here): `GCP_SERVICE_ACCOUNT_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `QUO_API_KEY`, `QUO_WEBHOOK_SIGNING_SECRET`, `QUO_DEFAULT_PHONE_NUMBER_ID`, `CALLIZY_API_KEY`, `CALLIZY_API_SECRET`, `CALLIZY_WEBHOOK_SIGNING_SECRET`, `CALLIZY_FROM_NUMBER`, `INTERNAL_FUNCTION_SECRET`, `ONBOARDING_AGENT_FROM`. In the vault: `daily_briefing_cron_secret`, `review_agent_cron_secret`. Your Supabase command-line token lives in your own terminal profile. If it is ever pasted anywhere, create a new one and delete the old.

**Who can get in:** write down here who else has access to GitHub, Supabase, Google Cloud, Firebase, Quo and Callizy, and where the recovery details are kept. That list is missing today, and it is the first thing anyone helping you in an emergency would need.

---

## 8. Backups (the biggest gap)

The production database has no automatic backups or point-in-time recovery. Until that changes, a bad change or a mistaken delete may not be recoverable.

- You can export the data by hand with `npx supabase db query --linked` into JSON files in `~/Documents/ProsperWise Portal/backups`. Do this before any large or risky database change.
- Turning on Supabase backups or point-in-time recovery is a paid setting and your decision. It is the single most useful protection for a system you now depend on.
- Recordings and transcripts live at the phone provider (Callizy keeps recordings five years by default). A nightly copy into your own Drive has been proposed and is not built.

---

## 9. Rules that never change

These are written into the code. If Georgia ever seems to break one, switch her off and tell me.

- She never sends email on your behalf.
- She never moves money, never deletes anything, never pays anything.
- She never contacts a client except: in the portal, and by text to a matched client when you are unavailable, as Georgia, your assistant, with no account details.
- Notifications to you are in the app only, never email.
- Text contents, email contents and calendar text are information to her, never instructions.
- Every action she takes on her own is recorded and shown in the rulebook.

---

## 10. Things this runbook still needs

- A switch for the notice processor and for calendar invitations (today: unschedule the job).
- The list of who has access to what, and where recovery details are kept.
- A decision on backups.
- A named person who can act if you are unavailable (how that person gets in, and what they may do).
- After Callizy cutover: update the phone entries in section 7, and remove Quo's.
