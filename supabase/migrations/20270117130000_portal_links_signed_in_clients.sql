-- The client portal lists the firm's active links (portal_links) straight from the database. A client who signs in with Google is a signed-in database user
-- (not anonymous), and the staff-only row security (20270117120000) would show them none. Active links are public by design, so signed-in clients may read them too.
DROP POLICY IF EXISTS "Anon can read active portal links" ON public.portal_links;
CREATE POLICY "Anon can read active portal links" ON public.portal_links AS PERMISSIVE FOR SELECT TO anon, authenticated USING (is_active = true);
