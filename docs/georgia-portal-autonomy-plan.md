# Georgia in the client portal: answering simple requests without a task

Draft, 2026-11-04. The decisions Rolf has made are marked **Decided**; the rest is a proposal.

**Status:** stage 1 (foundations) is built and changes no behaviour: the request outcome columns, the master switch and per-category modes (all off), the audit table, the gate and triage rules (`_shared/georgia-triage.ts`) and the iA self-serve rules (`_shared/ia-self-serve.ts`). The policy form also has an optional **iA product** field. Stage 2 (shadow) is built: with the master switch on, each submitted request is triaged and what Georgia would have done is recorded on the request and in the audit log, while the request is handled exactly as before. The page **Back office, Georgia autonomy** holds the switch, the per-category modes (off or shadow for now) and the review, where Rolf marks each call Right or Wrong; a category is ready at 20 reviewed and 95% right. Stage 3 builds the replies (answer, document pointer, meeting offer, iA self-serve, contact update) and the draft mode.

## Goal

Georgia answers simple, non-financial client requests herself. Today every submitted request becomes a task for Rolf, however small.

## How it works today

- **Chat** (`portal-assistant`): Georgia answers from the knowledge base and the client's own request list, says when Rolf is away, offers a booking page, and can flag a conversation as urgent or routine. For anything administrative she opens the request form.
- **A submitted request** is acknowledged, closed in the portal, and turned into a client-visible task for Rolf (`request-task.ts`). This happens for every type: banking and withdrawal, personal info, document, data access, general inquiry.
- Volume to date: 47 requests since February (24 banking or withdrawal, 15 general, 6 document, 2 personal info) and 5 chat conversations.

## Decided

- **iA investments (Rolf, 2026-11-04):** iA is rolling out self-serve investment changes. For now the client can do **deposits** themselves; everything else on the investment side stays with Rolf until iA releases more. **Banking changes on investment accounts stay with Rolf** for now.
- **Withdrawals are never self-serve**, for compliance reasons. They stay with Rolf, whatever iA allows.
- **Georgia never emails a document.** She always refers the client to My Documents.
- **My Client Space** is already linked in the portal sidebar, and the deposit steps are self-explanatory there. A first-time user must create an account and is asked for a contract number. Rolf has the number on file, and Georgia may give it to the client securely in the portal chat (see below).
- **First scope:** status and "where is my..." answers; pointing the client to a document already on file; contact-detail updates; meeting logistics; and, for deposits, pointing the client to iA Financial's self-serve client space (Georgia never does these herself).
- **Autonomy:** draft first, then graduate, category by category.
- **Contact-detail changes:** Georgia applies them and tells Rolf (see the safeguards below).
- **Visibility:** a notification to Rolf for each request Georgia handles.

## What stays with Rolf, whatever the model thinks

A fixed gate runs before the model. These go straight to a task, as now:

- Anything that moves money or that Georgia would carry out on an account: withdrawals (never self-serve), transfers, ownership changes, and banking changes on investment accounts.
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
| Documents | Tells the client which document it is and that it is in My Documents, and where. Never sends one by email. | If the document is not in My Documents, she hands over so Rolf can add it |
| Meetings | Offers the right booking page, says what a meeting is for, says what is booked | Never claims to have booked one |
| iA self-serve | Tells the client what they can do in My Client Space (deposits, insurance banking and payment changes) and, for a first-time user, gives them their own contract number securely | Needs the approved entry: see below |
| Contact details | Phone, mailing address, email: confirms the new value with the client, applies it, notifies Rolf | See the safeguards below |

### iA self-serve content

Georgia must not describe iA's screens from memory. Her source is a short entry Rolf approves ([draft](georgia-ia-self-serve-entry.md)), built from iA's own guide "List of transactions available online" (SRM503-178A, March 2026) and Rolf's note on investments. She answers only from it, and anything not in it becomes a task. She never asks for or stores banking details in the portal; the current "banking and withdrawal" form should stop collecting them once this is live.

What the guide says a client can do alone in **My Client Space**:

- **Every insurance contract** (Access Life, Transition, Term, Whole, Participating, Universal): change banking information, change payment date, change contact information.
- **Modernized contracts only:** change payment frequency or method, change beneficiary (except irrevocable), delay, stop or reinstate payments. "Modernized" means Access Life sold since April 2024, Transition sold since 24 November 2025, and Term and Whole Life sold since 30 March 2026. Participating and Universal Life are never modernized.
- **Investments:** deposits, for now.

Everything else (decreasing or terminating cover, changing the advisor, changing name, sex or date of birth, coverage changes, loans and withdrawals, transfers and investment instructions) is done by the advisor in iA's Advisor Centre, by EVO online changes, or on a paper form, so it stays with Rolf.

**Georgia has to know whether a contract is modernized.** The CRM's policy type is too coarse (it cannot tell Access Life from Term, or Participating from Whole Life), so each policy now has an optional **iA product** field, set on the policy form and named as iA's guide names the products. A small pure rule (`isModernized`, in `_shared/ia-self-serve.ts`) decides from the product, the issue date and the carrier, and she never guesses: with no product recorded it decides only the clear cases (Universal Life, living benefits, anything sold before April 2024, Term sold since 30 March 2026) and otherwise hands the request to Rolf. Another carrier's policy is never self-serve at iA.

**iA's list will change** (investments are rolling out now), so the capabilities are kept as data Rolf can switch on, not as wording baked into a prompt.

### Giving a first-time client their contract number

iA's My Client Space asks a first-time user to create an account with a contract number. The CRM holds it (the policy number on a policy, the account number on an account). Georgia may show it to the client in the portal chat, with these limits:

- **Signed in only.** The client is in the portal on a verified session (OTP), and the request comes through the portal token. The tool takes no client id: it can only read the signed-in person's own contracts.
- **Their own contracts only.** Never a spouse's, a child's or another family member's, and never for a client who is not signed in.
- **Only the product they asked about** (insurance policy or investment account), and only the number needed to register, not balances or other details.
- **Kept out of the model and the transcript.** The portal shows the number in a secure card. The model never receives it, and the stored conversation keeps it masked (for example "ending 4821"), so it is not sent back to the model on later turns or sitting in the thread Rolf and the log read.
- **Logged.** Each time she shows a number, an audit entry records who, which contract and when (never the number itself), and Rolf is notified, as for every request she handles.
- If the client cannot be matched to exactly one contract, she hands over.

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

- Approve or correct the [iA self-serve entry](georgia-ia-self-serve-entry.md). It is the only thing Georgia will say about iA.
- Beneficiary changes on newer policies are self-serve at iA. Recommended: leave them with Rolf because of the estate-planning side, and have Georgia mention the option only if he says so.
