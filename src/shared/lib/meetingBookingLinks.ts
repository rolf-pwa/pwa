// Google Calendar Appointment Schedules used for one-click meeting booking,
// embedded via iframe both in the client VFO portal and the staff CRM.
// embedUrl appends ?gv=true to the resolved schedule URL — Google's booking
// pages send X-Frame-Options: SAMEORIGIN by default, and ?gv=true is what
// Google's own "embed" code generator adds to bypass that for iframe use.
export const MEETING_BOOKING_LINKS = [
  {
    label: "Admin Meeting",
    url: "https://calendar.app.google/eG6iJbayFnQ11fNY7",
    embedUrl: "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0K1gDPij7zWsSyPEwiG9BZ4VrKk3kzKC8p_O3TJcJHvJmmb7cj51h-AqOyeDWBEorIXbjeK0oa?gv=true",
  },
  {
    label: "Quarterly Review (In Person)",
    url: "https://calendar.app.google/atvjMpeCKyDfkvgUA",
    embedUrl: "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0cTZuvx-sJC7-U2dieS9IzrpSkJvICdJF8xp1aNAfnsiWZORWJl85cJiNFlblO8alWCbqNrvMj?gv=true",
  },
  {
    label: "Quarterly Review (Video)",
    url: "https://calendar.app.google/KpBjsrne5w7dFm22A",
    embedUrl: "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0szGL8FEh0_NKc2p1nlspTMjB04I_FbY6kT79edq_rODjTDWiD7SI107MiFJcZIamJXyY4QmTR?gv=true",
  },
] as const;

/**
 * The address to show inside the page for a booking link, or null when it can only open on its own. A meeting type whose address is
 * already a Google appointment schedule can always be shown in the page: ?gv=true is what Google's own embed code adds, and the stored
 * embed address may simply be the same as the link.
 */
export function bookingEmbedSrc(url: string, embedUrl?: string | null): string | null {
  if (embedUrl && embedUrl !== url) return embedUrl;
  if (/^https:\/\/calendar\.google\.com\/calendar\/(?:u\/\d+\/)?appointments\/schedules\//.test(url)) return url.includes("gv=true") ? url : `${url}${url.includes("?") ? "&" : "?"}gv=true`;
  return null;
}
