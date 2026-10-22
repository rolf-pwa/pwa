import { Check, Circle } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import type { RebalanceAuthorizations as Authorizations } from "@/modules/crm/lib/reviewAgent";

const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { timeZone: "America/Vancouver", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Exactly what the clients authorized: each item they were shown, who ticked it and when, and each person's recorded response with the wording they agreed to. */
export function RebalanceAuthorizations({ a }: { a: Authorizations }) {
  const done = a.items.filter((i) => i.authorizedBy).length;
  return (
    <Card id="authorizations">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">Client authorizations</CardTitle>
          <Badge variant={a.allAuthorized ? "default" : "secondary"} className="text-[10px]">{a.completedAt ? "Done" : a.allAuthorized ? "All authorized, to carry out" : a.items.length ? `${done} of ${a.items.length} authorized` : "Waiting"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">Published {when(a.publishedAt)}. These are the changes the clients were shown, with who authorized each and when.</p>
        {a.items.length === 0 ? <p className="text-muted-foreground">This rebalancing carries no item-by-item proposal. See each person's response below.</p> : (
          <ul className="space-y-1.5" data-testid="authorized-items">
            {a.items.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                {i.authorizedBy ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-label="Authorized" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not yet authorized" />}
                <div className="min-w-0"><p>{i.text}</p><p className="text-xs text-muted-foreground">{i.authorizedBy ? `Authorized by ${i.authorizedBy}, ${when(i.authorizedAt!)}` : "Not yet authorized"}</p></div>
              </li>
            ))}
          </ul>
        )}
        {a.responses.length > 0 && (
          <div className="space-y-1.5">
            <p className="font-medium">Responses</p>
            {a.responses.map((r, idx) => (
              <details key={idx} className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer">{r.who}: {r.decision === "acknowledged" ? `authorized${r.count !== null ? ` ${r.count} item${r.count === 1 ? "" : "s"}` : ""}` : "wants to talk first"}, {when(r.at)}</summary>
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">Wording they agreed to (version {r.statementVersion}): {r.statementText}</p>
              </details>
            ))}
          </div>
        )}
        {a.note && <details><summary className="cursor-pointer text-xs text-muted-foreground">Your note to the client</summary><p className="mt-1 whitespace-pre-wrap text-xs">{a.note}</p></details>}
      </CardContent>
    </Card>
  );
}
