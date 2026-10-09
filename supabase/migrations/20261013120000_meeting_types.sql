-- Meeting types for booking, managed in the app instead of in code. Staff see every active type marked for staff; the
-- client portal gets only the types marked for clients (served by portal-validate). The schedule URL is the Google
-- appointment-schedule page, which also gives the embeddable URL.
CREATE TABLE IF NOT EXISTS public.meeting_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  label text NOT NULL,
  client_label text,                 -- the name clients see, when it differs
  minutes integer,
  note text,
  url text NOT NULL,
  embed_url text,                    -- null when the link can't be shown inside a page
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  staff_visible boolean NOT NULL DEFAULT true,
  client_visible boolean NOT NULL DEFAULT false
);
ALTER TABLE public.meeting_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage meeting types" ON public.meeting_types FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'email') LIKE '%@prosperwise.ca') WITH CHECK ((auth.jwt() ->> 'email') LIKE '%@prosperwise.ca');
CREATE POLICY "Service manages meeting types" ON public.meeting_types FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.meeting_types FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_types TO authenticated;
GRANT ALL ON public.meeting_types TO service_role;

INSERT INTO public.meeting_types (label, minutes, note, url, embed_url, sort_order, client_label, staff_visible, client_visible) VALUES
  ('Quarterly Review', 60, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0cTZuvx-sJC7-U2dieS9IzrpSkJvICdJF8xp1aNAfnsiWZORWJl85cJiNFlblO8alWCbqNrvMj', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0cTZuvx-sJC7-U2dieS9IzrpSkJvICdJF8xp1aNAfnsiWZORWJl85cJiNFlblO8alWCbqNrvMj?gv=true', 0, 'Quarterly Review (In Person)', true, true),
  ('Annual Stewardship Review', 60, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3gyqtEUjcZ6DClNHt3UPnuS17-bqIo-5fStjgKnZnUqC8cJDTR6V8rGXoUXi5ZHGh0QxsLwin_', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ3gyqtEUjcZ6DClNHt3UPnuS17-bqIo-5fStjgKnZnUqC8cJDTR6V8rGXoUXi5ZHGh0QxsLwin_?gv=true', 1, NULL, true, false),
  ('Charter Development Session', 60, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0WBGCqb7mvBweQ5lRt8tPk-KcTZf8ZHRT1xMHvInYtpgkXXB5BMALt7gA1R3r7E_3v5WvmDk4Z', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0WBGCqb7mvBweQ5lRt8tPk-KcTZf8ZHRT1xMHvInYtpgkXXB5BMALt7gA1R3r7E_3v5WvmDk4Z?gv=true', 2, NULL, true, false),
  ('Sovereignty Survey', 90, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ2OCWM5PQ0LgBC9JN75R3JZyoOnN6npNH8j9nSQaRHfSB1gL18gtZ5qPULeSb0-dGZjvA5GC0Wb', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ2OCWM5PQ0LgBC9JN75R3JZyoOnN6npNH8j9nSQaRHfSB1gL18gtZ5qPULeSb0-dGZjvA5GC0Wb?gv=true', 3, NULL, true, false),
  ('Interim Strategy Consultation', 60, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ2H6IjhFNJ1SJi1VYOHhShYcKxVttMB-hi06-hGJbwFQ4acB554DP1KpsJSRN8vLo8bjY9G2Z1i', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ2H6IjhFNJ1SJi1VYOHhShYcKxVttMB-hi06-hGJbwFQ4acB554DP1KpsJSRN8vLo8bjY9G2Z1i?gv=true', 4, NULL, true, false),
  ('Administration Session', 30, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0K1gDPij7zWsSyPEwiG9BZ4VrKk3kzKC8p_O3TJcJHvJmmb7cj51h-AqOyeDWBEorIXbjeK0oa', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0K1gDPij7zWsSyPEwiG9BZ4VrKk3kzKC8p_O3TJcJHvJmmb7cj51h-AqOyeDWBEorIXbjeK0oa?gv=true', 5, 'Admin Meeting', true, true),
  ('Clarity Call with Rolf', 15, 'Google Meet. Finds out whether a Sovereignty Survey fits.', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1sjX9SS8Z7UEvF2Kmj2KpfIXIo_5QVxd-vm26u2H8PZYHHZWP9sGJf8y9cQm3KIuo6unxpp3hO', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1sjX9SS8Z7UEvF2Kmj2KpfIXIo_5QVxd-vm26u2H8PZYHHZWP9sGJf8y9cQm3KIuo6unxpp3hO?gv=true', 6, NULL, true, false),
  ('Networking / Coffee', 60, 'In person. For lawyers, accountants and other professionals.', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1tstp5kshnYVnQjOb1NfMsQfufaIHnRGInUVp3uOXzzkGfGMnA9xjM-61U7xbuV1LjqFd4VToW', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ1tstp5kshnYVnQjOb1NfMsQfufaIHnRGInUVp3uOXzzkGfGMnA9xjM-61U7xbuV1LjqFd4VToW?gv=true', 7, NULL, true, false),
  ('Quarterly Review (Video)', 60, NULL, 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0szGL8FEh0_NKc2p1nlspTMjB04I_FbY6kT79edq_rODjTDWiD7SI107MiFJcZIamJXyY4QmTR', 'https://calendar.google.com/calendar/appointments/schedules/AcZssZ0szGL8FEh0_NKc2p1nlspTMjB04I_FbY6kT79edq_rODjTDWiD7SI107MiFJcZIamJXyY4QmTR?gv=true', 8, NULL, false, true);
