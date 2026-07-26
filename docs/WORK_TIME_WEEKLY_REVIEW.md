# Work Time Weekly Review

Sprint F adds weekly Work Time review pages:

- `GET /admin/work-time/weekly`
- `GET /admin/work-time/weekly/:driverUuid?week=YYYY-MM-DD`

Weeks are Monday to Sunday. The weekly summary uses grouped SQL over `work_days`, with entry metadata aggregated in a single joined subquery. It avoids per-driver or per-day N+1 queries.

The weekly summary shows driver totals, day counts, open days, anomaly days, manual correction days and approval counts. The driver detail page shows daily rows and links each day to `/admin/work-time/:uuid`.

Bulk review supports approval, rejection and correction-required actions. Open days and sync-conflict days are blocked unless an explicit override is supplied with a reason; every updated day receives a `work_time_audit` row.

Warnings are operational only. They are not legal or tachograph compliance findings.
