// pack-readiness.ts: what is still missing before Rolf can prepare a household's Portfolio Review or rebalancing. Pure, from the pack.
import type { Pack } from "./portfolio-review.ts";

export interface Readiness {
  /** Things Rolf must supply or scan before the pack is trustworthy. */
  todo: string[];
  /** Worth a look, but not blocking. */
  notes: string[];
  ready: boolean;
}

export function packReadiness(pack: Pack): Readiness {
  const todo = [...pack.gaps];
  // A death-benefit reset can only be proposed when its last reset date is known.
  for (const r of pack.resets.rows) {
    if ((r.status === "reset" || r.status === "no_room") && !r.lastResetDate) todo.push(`Record the last reset date for ${r.name || r.number} (${r.owner ?? "owner"}).`);
  }
  const notes = pack.exceptions.filter((e) => e.severity === "attention").map((e) => e.text);
  return { todo: [...new Set(todo)], notes, ready: todo.length === 0 };
}
