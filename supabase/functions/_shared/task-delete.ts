// task-delete.ts: when a task may be deleted. Pure.
// A task is for mistakes and duplicates to be deleted; anything a client or professional has written in, or that has a filed meeting record, is part of
// the firm's record and is closed instead.

export interface DeleteFacts { hasMeetingRecord: boolean; clientComments: number; professionalComments: number }

/** Why a task cannot be deleted, in words for Rolf; null when it can be. */
export function deleteBlocker(f: DeleteFacts): string | null {
  if (f.hasMeetingRecord) return "A meeting record has been filed for this task, so it is part of the record. Close it instead.";
  if (f.clientComments > 0) return "The client has written in this task, so it is part of the record. Close it instead.";
  if (f.professionalComments > 0) return "A professional has written in this task, so it is part of the record. Close it instead.";
  return null;
}
