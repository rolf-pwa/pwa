// Detects well-known search/crawler/link-preview bots by User-Agent, so their
// hits never create a Georgia session row and never inflate the "Started"
// count on Analytics. Deliberately conservative: only self-identifying bot
// substrings a real visitor's browser would never send, never a heuristic
// that could catch an unusual but real browser.
// "bot"/"spider"/"crawl" alone already cover the large majority of real
// crawlers (Googlebot, Bingbot, Baiduspider, YandexBot, AhrefsBot,
// SemrushBot, GPTBot, PetalBot, BytesPider, etc.); the rest are
// link-preview/unfurl bots that don't self-identify with those words.
const BOT_UA_PATTERN = /bot|spider|crawl|slurp|facebookexternalhit|whatsapp|bingpreview|embedly|w3c_validator/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_UA_PATTERN.test(userAgent);
}
