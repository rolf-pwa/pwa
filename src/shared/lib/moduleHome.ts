// moduleHome.ts: the first step of a breadcrumb is the module the page belongs to (CRM, Professionals, Workbench...), not the old Dashboard. A page keeps writing "Dashboard"
// first; this swaps it for its module's home, so every page's trail begins where its own module does. Pure.
export interface Crumb { label: string; href?: string }
interface Module { label: string; home: string; prefixes: string[]; /** When the page's own list is the module's home, that crumb replaces the root rather than following it. */ listIsHome?: boolean }

export const MODULES: Module[] = [
  { label: "CRM", home: "/families", prefixes: ["/families", "/households", "/contacts", "/corporations", "/properties", "/former-clients", "/leads"] },
  { label: "Professionals", home: "/professionals", prefixes: ["/professionals"], listIsHome: true },
  { label: "Holding Tank", home: "/holding-tank", prefixes: ["/holding-tank"], listIsHome: true },
  { label: "Workbench", home: "/workbench", prefixes: ["/workbench", "/quarterly-review", "/quarterly-vfo-audit"], listIsHome: true },
  { label: "Projects", home: "/projects", prefixes: ["/projects"] },
  { label: "Pipeline", home: "/pipeline", prefixes: ["/pipeline"] },
  { label: "Insurance", home: "/insurance", prefixes: ["/insurance"] },
  { label: "Investments", home: "/investments", prefixes: ["/investments"] },
];
/** Where a page with no module of its own starts: Today. */
export const TODAY: Crumb = { label: "Today", href: "/briefing" };

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
export const moduleOf = (path: string | undefined | null): Module | null => (path ? MODULES.find((m) => m.prefixes.some((p) => under(path, p))) ?? null : null);

/** The trail with a leading "Dashboard" replaced by the page's module home. The module comes from the crumb after it (a household link means CRM), else from the page's own address. */
export function withModuleRoot(items: Crumb[], pathname: string): Crumb[] {
  if (!items.length || items[0].href !== "/dashboard") return items;
  const rest = items.slice(1);
  const mod = moduleOf(rest.find((c) => c.href)?.href) ?? moduleOf(pathname);
  if (!mod) return [TODAY, ...rest];
  if (mod.listIsHome && rest[0]?.href === mod.home) return rest; // "Pros" is Professionals' own home: no second step
  return [{ label: mod.label, href: mod.home }, ...rest];
}
