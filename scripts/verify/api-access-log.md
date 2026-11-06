# API access log check (manual, monthly or after any security change)

The weekly job (`security_weekly_check`, Mondays 13:00 UTC) covers policies, row security and non-browser sessions. It cannot see the API request log, because
only the Supabase dashboard exposes it. Run this in Dashboard > Logs > Logs Explorer (set the time range to the longest available):

```sql
select
  timestamp,
  request.method as method,
  request.path as path,
  response.status_code as status,
  request.headers.user_agent as user_agent,
  request.cf.country as country
from logs
where source = 'edge_logs'
  and request.path like '/rest/v1/%'
  and request.headers.user_agent not like 'Deno/%'
  and request.sb.jwt.authorization.payload.subject != '140aaffa-abce-4de8-9756-7013f32642d0'
order by timestamp desc
limit 200
```

Expected: browser traffic from the staff account only. Look for `curl`, `python`, `node`, `PostmanRuntime` or other non-browser agents, any `200` on a table path
from a non-staff subject, and unfamiliar countries. Anything else: run `scripts/verify/open-policies.sql` and tell the advisor.
