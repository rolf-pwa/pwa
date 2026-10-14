import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

const STAGES: { name: string; meaning: string; you: string }[] = [
  { name: "Preparing", meaning: "The quarter's rebalancing window is open and nothing has been shared with the family. Georgia has not emailed them and will not.", you: "Work out the family's rebalancing (it can take days). When it is ready, click Publish to portal and write a short summary the client will read." },
  { name: "Waiting for the client", meaning: "You published it. Georgia emails both adults an invitation to review it in the portal, then reminders. The family reads the proposal first and consents afterwards.", you: "Nothing, unless you need to change it: Edit updates what the client sees, Take back removes it from the portal (Georgia stops inviting)." },
  { name: "To carry out", meaning: "A client reviewed it and acknowledged it in the portal. The acknowledgement and the exact proposal they saw are stored with the family's records, and a task was created for you.", you: "Carry out the rebalancing at the custodian, then click Mark done. That tells the family in their portal." },
  { name: "Done", meaning: "Carried out and the family has been told.", you: "Nothing." },
];

const STATUSES: { name: string; meaning: string }[] = [
  { name: "Open", meaning: "Not booked yet. Georgia invites both adults on the first day of the window, then reminds them on her usual schedule." },
  { name: "Booked", meaning: "A matching meeting is on the calendar. Georgia stops inviting and the booking shows on the client's portal." },
  { name: "Held", meaning: "The meeting took place." },
  { name: "With a person", meaning: "Georgia handed it to you: no email on file, a reply that needs a human, they asked us to stop emailing, or time is running out with nothing booked. A task was created for you. Resolve it, then Resume or leave it." },
  { name: "Paused", meaning: "Georgia is ignoring this one until you press Resume (the play button). Use the pause button on any open or booked row." },
  { name: "(tracking only)", meaning: "The window was already open before Georgia went live. She watches for a booking but never invites for it." },
  { name: "(shadow)", meaning: "Recorded in shadow mode only. Nothing was sent." },
];

/** A standing reminder on Georgia Reviews of what each label and button means and what Rolf does at each step. */
export function ReviewAgentGuide() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <BookOpen className="h-5 w-5 text-accent" />
          <CardTitle className="text-lg">How this page works</CardTitle>
          <span className="ml-auto text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6 text-sm">
          <section>
            <h3 className="mb-1 font-semibold">The basics</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Each family owes meetings by quarter according to its tier (summary in the Mode card). Georgia keeps the list up to date, so you never add meetings by hand.</li>
              <li>On the first day of a meeting's window Georgia emails both adults to book it, then sends reminders. Booking links open on the family's portal.</li>
              <li>When a meeting is booked on your Google calendar, Georgia notices within about 30 minutes. The booking shows here and on the client's portal.</li>
              <li>If time is running out and nothing is booked, or a reply needs a person, the family comes to you as a task and shows "With a person".</li>
              <li>Without a ratified Charter (or a Virtual Family Office) nothing binds a family's households together, so each household is tiered on its own assets and listed on its own as Family: Household. Chartered families and VFOs stay pooled.</li>
              <li>Families whose advisory relationship has ended are dropped automatically.</li>
              <li>Mode: Off does nothing, Shadow records what she would do, Live sends real emails.</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Portfolio rebalancing: your steps</h3>
            <p className="mb-2 text-muted-foreground">Rebalancing is different from a meeting because it takes days of your work and the client consents after they have seen it. Georgia never emails about it until you publish.</p>
            <div className="space-y-2">
              {STAGES.map((s, i) => (
                <div key={s.name} className="rounded-md border p-3">
                  <div className="font-medium">{i + 1}. {s.name}</div>
                  <p className="text-muted-foreground">{s.meaning}</p>
                  <p><span className="font-medium">You: </span>{s.you}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-muted-foreground">If a client chooses "I'd like to talk first" instead of acknowledging, Georgia pauses her reminders for two weeks, you get a task and a notification, and they are pointed to the Interim Strategy Session booking. After you speak, carry on from Waiting for the client.</p>
            <p className="mt-2 text-muted-foreground">When a rebalancing window opens, one task, "Prepare the Q# rebalancing", is created for you as the checklist for the whole quarter.</p>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">What the labels mean</h3>
            <dl className="space-y-1.5">
              {STATUSES.map((s) => (<div key={s.name}><dt className="inline font-medium">{s.name}: </dt><dd className="inline text-muted-foreground">{s.meaning}</dd></div>))}
            </dl>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Quarter headings</h3>
            <p className="text-muted-foreground">Each quarter counts meetings that are not booked, booked, done and with a person, plus rebalancings still to carry out. Past quarters are collapsed. Use the filters to see only what needs you: "Needs a person" lists the families Georgia handed back.</p>
          </section>
        </CardContent>
      )}
    </Card>
  );
}
