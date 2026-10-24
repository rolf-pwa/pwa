// pageViews.ts: which screen a path is, for the page-view log. Ids and tokens are taken out so "/households/<id>/needs" and another household's are the same screen. Pure.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_TOKEN = /^[A-Za-z0-9_-]{24,}$/;

export function screenOf(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean).map((p) => (UUID.test(p) || LONG_TOKEN.test(p) || /^\d{4,}$/.test(p) ? ":id" : p.toLowerCase()));
  return ("/" + parts.join("/")).slice(0, 200);
}
