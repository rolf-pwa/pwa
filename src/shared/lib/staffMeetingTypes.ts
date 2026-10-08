// Every meeting type on Rolf's Google Calendar booking page
// (https://calendar.google.com/calendar/appointments/AcZssZ3Edv0-dF_AX1v9OIgnxfXSVIqy1GCcpWscL6U=).
// For STAFF use only: some of these are prospect or professional-network meetings that clients should never see.
// The client portal keeps its own shorter list in meetingBookingLinks.ts.

const BASE = "https://calendar.google.com/calendar/appointments/schedules";

const type = (label: string, minutes: number, scheduleId: string, note?: string) => ({
  label,
  minutes,
  note,
  url: `${BASE}/${scheduleId}`,
  // ?gv=true is what Google's own embed code adds so the booking page can be shown in an iframe.
  embedUrl: `${BASE}/${scheduleId}?gv=true`,
});

export const STAFF_MEETING_TYPES = [
  type("Quarterly Review", 60, "AcZssZ0cTZuvx-sJC7-U2dieS9IzrpSkJvICdJF8xp1aNAfnsiWZORWJl85cJiNFlblO8alWCbqNrvMj"),
  type("Annual Stewardship Review", 60, "AcZssZ3gyqtEUjcZ6DClNHt3UPnuS17-bqIo-5fStjgKnZnUqC8cJDTR6V8rGXoUXi5ZHGh0QxsLwin_"),
  type("Charter Development Session", 60, "AcZssZ0WBGCqb7mvBweQ5lRt8tPk-KcTZf8ZHRT1xMHvInYtpgkXXB5BMALt7gA1R3r7E_3v5WvmDk4Z"),
  type("Sovereignty Survey", 90, "AcZssZ2OCWM5PQ0LgBC9JN75R3JZyoOnN6npNH8j9nSQaRHfSB1gL18gtZ5qPULeSb0-dGZjvA5GC0Wb"),
  type("Interim Strategy Consultation", 60, "AcZssZ2H6IjhFNJ1SJi1VYOHhShYcKxVttMB-hi06-hGJbwFQ4acB554DP1KpsJSRN8vLo8bjY9G2Z1i"),
  type("Administration Session", 30, "AcZssZ0K1gDPij7zWsSyPEwiG9BZ4VrKk3kzKC8p_O3TJcJHvJmmb7cj51h-AqOyeDWBEorIXbjeK0oa"),
  type("Clarity Call with Rolf", 15, "AcZssZ1sjX9SS8Z7UEvF2Kmj2KpfIXIo_5QVxd-vm26u2H8PZYHHZWP9sGJf8y9cQm3KIuo6unxpp3hO", "Google Meet. Finds out whether a Sovereignty Survey fits."),
  type("Networking / Coffee", 60, "AcZssZ1tstp5kshnYVnQjOb1NfMsQfufaIHnRGInUVp3uOXzzkGfGMnA9xjM-61U7xbuV1LjqFd4VToW", "In person. For lawyers, accountants and other professionals."),
] as const;

export type StaffMeetingType = (typeof STAFF_MEETING_TYPES)[number];
