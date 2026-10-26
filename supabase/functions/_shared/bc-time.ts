// bc-time.ts: British Columbia stops changing its clocks. Clocks went forward on 2026-03-08 and do NOT go back on 2026-11-01: B.C. stays
// on UTC-7 ("Pacific Time") for good. The time zone data in the edge runtime still says "America/Vancouver" falls back to UTC-8 on that date,
// so every Pacific time it formatted from then on was an hour early (a meeting reminder for a 10:00 meeting said 9:00 PST).
//
// Importing this file makes "America/Vancouver" mean UTC-7 from the moment the clocks would have gone back, in Intl.DateTimeFormat and in
// Date's toLocaleString / toLocaleDateString / toLocaleTimeString, and labels it "PT". Earlier dates are untouched (they were PDT or PST).
// Once the runtime's zone data has the change this is harmless: both zones give the same answer.

/** 2026-11-01 02:00 PDT: the instant B.C. would have turned its clocks back, and does not. */
export const BC_PERMANENT_FROM = Date.UTC(2026, 10, 1, 9, 0);
const VAN = "America/Vancouver";
const FIXED = "Etc/GMT+7"; // UTC-7 all year

const Native = Intl.DateTimeFormat;
const alt = new WeakMap<object, Intl.DateTimeFormat>();
const label = (s: string) => s.replace(/GMT-7/g, "PT");
const toMs = (d?: Date | number) => (d === undefined ? Date.now() : typeof d === "number" ? d : d.getTime());

/** Hours from UTC for Pacific time at this instant: -7 or -8 (-7 always from the permanent date). */
export function pacificOffsetHours(ms: number): number {
  if (ms >= BC_PERMANENT_FROM) return -7;
  const p = Object.fromEntries(new Native("en-US", { timeZone: VAN, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const minute = Math.floor(ms / 60_000) * 60_000;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - minute) / 3_600_000);
}

class BcDateTimeFormat extends Native {
  constructor(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    super(locales, options);
    if (options?.timeZone === VAN) alt.set(this, new Native(locales, { ...options, timeZone: FIXED }));
  }
  override formatToParts(d?: Date | number): Intl.DateTimeFormatPart[] {
    const a = alt.get(this);
    if (!(a && toMs(d) >= BC_PERMANENT_FROM)) return super.formatToParts(d);
    return a.formatToParts(d).map((p) => (p.type === "timeZoneName" ? { ...p, value: label(p.value) } : p));
  }
}

// Intl's `format` is a getter that hands back a function bound to the formatter; keep that shape.
Object.defineProperty(BcDateTimeFormat.prototype, "format", {
  configurable: true,
  get(this: Intl.DateTimeFormat) {
    // deno-lint-ignore no-explicit-any
    const base = (Object.getOwnPropertyDescriptor(Native.prototype, "format") as any).get.call(this) as (d?: Date | number) => string;
    return (d?: Date | number) => {
      const a = alt.get(this);
      return a && toMs(d) >= BC_PERMANENT_FROM ? label(a.format(d)) : base(d);
    };
  },
});

function Patched(locales?: string | string[], options?: Intl.DateTimeFormatOptions) { return new BcDateTimeFormat(locales, options); }
Patched.prototype = BcDateTimeFormat.prototype;
Patched.supportedLocalesOf = Native.supportedLocalesOf.bind(Native);

// deno-lint-ignore no-explicit-any
const g = globalThis as any;
if (!g.__bcTimePatched) {
  g.__bcTimePatched = true;
  // deno-lint-ignore no-explicit-any
  (Intl as any).DateTimeFormat = Patched;
  for (const m of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"] as const) {
    // deno-lint-ignore no-explicit-any
    const orig = (Date.prototype as any)[m] as (l?: unknown, o?: Intl.DateTimeFormatOptions) => string;
    // deno-lint-ignore no-explicit-any
    (Date.prototype as any)[m] = function (this: Date, locales?: unknown, options?: Intl.DateTimeFormatOptions) {
      if (options?.timeZone === VAN && this.getTime() >= BC_PERMANENT_FROM) return label(orig.call(this, locales, { ...options, timeZone: FIXED }));
      return orig.call(this, locales, options);
    };
  }
}
