# ProsperWise Portal — Project Standards

Durable conventions for this codebase. Follow these unless the user explicitly asks for an exception.

## Advisor app vs. client Portal — scope boundary

This codebase contains two distinct UI systems that share some primitives but have different design identities:

- **Advisor/staff app** — everything rendered through `src/shared/components/AppLayout.tsx` (the icon-rail sidebar + header shell): `src/modules/crm/`, `src/modules/pm/`, `src/modules/billing/`, `src/modules/audit/`, etc. Dense, Asana-inspired layout patterns (see below).
- **Client Portal** — `src/modules/portal/`, served at `/portal` and `/vfo` routes, with its own "Sanctuary" branding and layout.

**Default rule: changes made for the Advisor app should not affect the Portal, and vice versa, unless explicitly asked.** Several shared primitives (`Card`/`CardTitle`, etc.) are imported by both. When a change is Advisor-specific, scope it — e.g. via a wrapping class such as `.advisor-app` on `AppLayout`'s root, with the override written as a scoped CSS rule — rather than changing the shared component's default, which would silently bleed into the Portal.

## UI / Layout Standards (Advisor/staff app)

- **Content width**: the Advisor app's page content wrapper (`src/shared/components/AppLayout.tsx`, the `<main>` child div) uses `max-w-screen-2xl` (1536px), **not** `mx-auto`. Content hugs the sidebar with the wrapper's own padding rather than centering in the leftover viewport width — centering there creates a large, visually awkward gap between the sidebar and the page content on wide screens. The width is capped (not left unbounded) to avoid uncomfortable line lengths on text-heavy pages and over-stretched grid/sidebar cards (e.g. the Dashboard) on very large or ultrawide monitors.
  - This applies to every page rendered through `AppLayout` — it's a shared wrapper, not a per-page setting.

- **Dense list rows**: use `ListRow` / `ListRowStatic` (`src/shared/components/ListRow.tsx`) for list pages instead of a `Card` per row. These render a single-line row with no Card chrome — just a bottom divider and tight padding (`flex items-center gap-4 border-b border-border px-3 py-2.5 text-sm ... hover:bg-muted/50 last:border-0`) — matching the dense, Asana-inspired look established across Contacts, Households, Corporations, AdminVfo, and the Families tree/detail-panel pattern.
  - `ListRow` renders as a react-router `Link` (pass `to`); `ListRowStatic` renders a plain `div`, for rows that need mixed interactive children (e.g. a per-row delete button) rather than one whole-row link target — never nest another interactive/link element inside a `ListRow`'s `Link`.
  - New Advisor list pages should default to this pattern rather than a Card-tile grid, unless the content genuinely doesn't compress into single-line rows (e.g. a free-text-heavy page, a conversation view, an expandable-JSON detail view).

- **Card headings use the sans body font, not the display serif**: `CardTitle` (`src/shared/components/ui/card.tsx`) renders as an `<h3>` and carries a `card-title` marker class. A global `h1, h2, h3, h4` base rule in `src/index.css` would otherwise force every heading (including card titles) into the Playfair Display serif font. In the Advisor app, an unlayered, `.advisor-app`-scoped override at the bottom of `src/index.css` sets card headings to the sans font (Inter) instead — Rolf's preference, matching the plain-sans look of the Dashboard's "Daily Briefing" placeholder.
  - Scoped to `CardTitle` specifically — page `h1` titles and entity names elsewhere (which explicitly use `font-serif`/`font-display`) keep the serif treatment. Only card headings changed.
  - The Portal also renders `CardTitle` in several places and is unaffected — it keeps the serif card headings, per the scope boundary above.

## Database migrations

- **Every `CREATE TABLE` migration must include its own explicit `GRANT ... TO authenticated;` / `GRANT ALL ... TO service_role;`** right after the table definition, matching the pattern in e.g. `supabase/migrations/20260918160000_add_household_charters.sql`. Don't rely on Supabase's implicit default grant — Supabase is discontinuing that for anything created on/after 2026-10-30 (their "Data API access changes for new tables" notice), and migration `20260923132703_fix_data_api_grants_before_oct30_change.sql` only backstops tables that already exist as of that migration plus a Postgres `ALTER DEFAULT PRIVILEGES` rule for future ones — it's not a substitute for writing the grant yourself. Omitting it silently breaks Data API access to that table the moment the implicit grant stops applying.
