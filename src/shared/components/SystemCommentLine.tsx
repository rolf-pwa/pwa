/** A system line in a task's thread (a task or action item completed or reopened): the words, and when. */
export function SystemCommentLine({ body, at }: { body: string; at: string }) {
  const when = new Date(at).toLocaleString("en-CA", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="text-center text-xs italic text-muted-foreground" data-testid="system-comment">
      {body} · {when}
    </div>
  );
}
