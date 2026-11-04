# Georgia in the client portal: answering simple requests without a task

Draft, 2026-11-04. Nothing here is built. The decisions Rolf has made are marked **Decided**; the rest is a proposal.

## Goal

Georgia answers simple, non-financial client requests herself. Today every submitted request becomes a task for Rolf, however small.

## How it works today

- **Chat** (`portal-assistant`): Georgia answers from the knowledge base and the client's own request list, says when Rolf is away, offers a booking page, and can flag a conversation as urgent or routine. For anything administrative she opens the request form.
- **A submitted request** is acknowledged, closed in the portal, and turned into a client-visible task for Rolf (`request-task.ts`). This happens for every type: banking and withdrawal, personal info, document, data access, general inquiry.
- Volume to date: 47 requests since February (24 banking or withdrawal, 15 general, 6 document, 2 personal info) and 5 chat conversations.

## Decided

- **First scope:** status and "where is my..." answers; sending a document already on file; contact-detail updates; meeting logistics; and, for deposits and banking-detail changes, pointing the client to iA Financial's self-serve client space (Georgia never does these herself).
- **Autonomy:** draft first, then graduate, category by category.
- **Contact-detail changes:** Georgia applies them and tells Rolf (see the safeguards below).
- **Visibility:** a notification to Rolf for each request Georgia handles.

## What stays with Rolf, whatever the model thinks

A fixed gate runs before the model. These go straight to a task, as now:

- Anything that moves money or that Georgia would carry out on an account: withdrawals, transfers, ownership changes.
- Beneficiary changes.
- Investment, tax or legal advice.
- Urgent matters (death, illness, fraud, distress): the existing urgent flag.
- Data access and data deletion requests (PIPEDA, with legal timing).
- Anything about another person or family.
- A name change, which is a legal and compliance matter.

## Outcomes

Each request ends in one of four outcomes, recorded on the request:

| Outcome | What happens | Task? |
|---|---|---|
| Answered | Georgia replies from the knowledge base or the client's own data | No |
| Done | Georgia does a safe action (sends a document link, applies a contact detail) | No |
| Drafted | Georgia prepares the reply or action; Rolf approves in one click | A short task, already filled in |
| Handed over | Same as today | Yes |

"Draft first, then graduate" means each category starts at Drafted and moves to Answered or Done only after it has run cleanly for a few weeks.

## The categories

| Category | Georgia does | Notes |
|---|---|---|
| Status | Says where a request, task, document or meeting stands, from the database | Reads only the client's own data |
| Documents | Points to, or sends a link to, a document already in the client's vault | Only what the client could open in My Documents already |
| Meetings | Offers the right booking page, says what a meeting is for, says what is booked | Never claims to have booked one |
| iA self-serve | Gives the client the steps and link for iA's client space (a deposit, new banking details, statements) | Needs vetted content: see below |
| Contact details | Phone, mailing address, email: confirms the new value with the client, applies it, notifies Rolf | See the safeguards below |

### iA self-serve content

Georgia must not describe iA's screens from memory. The plan needs a short knowledge-base entry, written and approved by Rolf, listing what iA's client space lets a client do (deposits, banking details, statements, tax slips), where each is, and what still needs the advisor. Georgia answers only from that entry, and anything not in it becomes a task. She never asks for or stores banking details in the portal. The current "banking and withdrawal" form should stop collecting them once this is live.

### Contact-detail safeguards

The portal login finds a client by their email address, so changing an email changes how they sign in. That makes email the one risky field.

- The client must be signed in to the portal (OTP) and confirm the change in chat.
- **Phone and mailing address:** applied, with the previous value kept so Rolf can undo with one click.
- **Email:** a code is sent to the new address and must be entered, and a notice goes to the old address. The old value is kept.
- Rolf is notified of every change, with old and new values. Every change is written to an audit trail.
- A name change, and a change that would make a household or family member's details differ from the rest of the record, is handed over.

## Model and data changes (proposed)

- `portal_requests`: `outcome` (answered, done, drafted, handed_over), `handled_by`, and a link to the audit entry.
- `georgia_autonomy_config`: one row per category with its mode (off, shadow, draft, auto), plus one master switch like the text assistant's.
- `georgia_actions` (audit): what Georgia did, for whom, the old and new values, and an undo.
- `request-task.ts` gains a triage step ahead of task creation; the gate lives in a pure, tested module.
- The chat tools gain read tools (status, documents, meetings) and one write tool (update contact detail), each scoped to the signed-in client by the portal token.

## Rollout

1. **Foundations.** The columns, the config table, the audit log, the triage module and its tests. No change in behaviour.
2. **Shadow.** Georgia triages and drafts every request but still makes the task as today, and records what she would have done. Rolf compares for a couple of weeks.
3. **Informational categories** (status, documents, meetings, iA self-serve): Drafted, then Answered once clean.
4. **Contact details**, starting with phone and mailing address, then email.
5. **Review.** Weekly, in the Monday meeting: counts by outcome, anything she was unsure of, anything Rolf corrected.

## Risks to keep an eye on

- A client saying one thing and meaning a financial request. The gate runs on the client's own words and on the request type, and the model can only move a request towards Rolf, never away from him.
- Georgia inventing a process. She answers only from the knowledge base and the client's own data, and says when she doesn't know.
- Compliance: conversations and actions are kept for the record, and the client is told they are talking to Georgia, the firm's assistant.
- The Google billing block currently stops every model call, so nothing here can be tested live until it is cleared.

## Open items for Rolf

- The iA self-serve entry: what the client space supports, and the links.
- Whether withdrawals belong in the iA self-serve list too, or stay with Rolf.
- Which documents Georgia may send: statements, tax slips, confirmation letters, or only what is already in My Documents.
