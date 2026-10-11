-- Reading or exporting the audit log is itself recorded. The log table only accepts inserts from the server, so
-- the staff page goes through this function, which writes the entry as the signed-in staff member.
CREATE OR REPLACE FUNCTION public.record_vault_audit_export(p_filters jsonb, p_row_count integer, p_kind text DEFAULT 'csv_export')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt() ->> 'email', '') NOT LIKE '%@prosperwise.ca' THEN
    RAISE EXCEPTION 'staff only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_kind NOT IN ('csv_export', 'integrity_check') THEN
    RAISE EXCEPTION 'unknown kind' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT email INTO v_email FROM public.profiles WHERE user_id = auth.uid();
  INSERT INTO public.vault_audit_log (actor_type, actor_id, actor_label, actor_email, action, metadata)
  VALUES ('staff', auth.uid(), 'staff', COALESCE(v_email, auth.jwt() ->> 'email'), 'audit_log_' || p_kind,
          jsonb_build_object('filters', COALESCE(p_filters, '{}'::jsonb), 'row_count', p_row_count));
END $$;
REVOKE ALL ON FUNCTION public.record_vault_audit_export(jsonb, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_vault_audit_export(jsonb, integer, text) TO authenticated;
