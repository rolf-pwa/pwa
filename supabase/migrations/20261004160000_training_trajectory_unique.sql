-- One trajectory per source event, so building trajectories from action_brain_events
-- is idempotent (re-running an export can never duplicate training pairs).
-- Deliberately NOT a partial index: PostgREST's upsert issues a plain
-- ON CONFLICT (source_event_id), which Postgres can only match to a
-- non-partial unique index. NULL source_event_ids stay allowed (NULLs are
-- distinct), so manually-added pairs aren't affected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_training_trajectories_source_event
  ON public.ai_training_trajectories (source_event_id);
