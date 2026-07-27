# Work Time Performance Review

## Scope

Reviewed query surfaces:

- Work Time weekly summary.
- Work Time export CSV/JSON.
- Work Time conflict list and detail.

## Recommended EXPLAIN ANALYZE Commands

Run against a production-sized copy before large customer rollout:

```sql
EXPLAIN ANALYZE
SELECT d.driver_uuid, d.driver_name, COUNT(*) AS day_count,
       SUM(d.total_work_ms) AS total_work_ms,
       SUM(d.driving_ms) AS driving_ms,
       SUM(d.break_ms) AS break_ms,
       SUM(d.rest_ms) AS rest_ms,
       SUM(d.availability_ms) AS availability_ms
FROM work_days d
WHERE d.deleted_at IS NULL
  AND d.work_date BETWEEN CURRENT_DATE - INTERVAL '7 day' AND CURRENT_DATE
GROUP BY d.driver_uuid, d.driver_name
ORDER BY d.driver_name ASC;
```

```sql
EXPLAIN ANALYZE
SELECT d.*, t.name AS tour_name
FROM work_days d
LEFT JOIN tours t ON t.uuid = d.tour_uuid
WHERE d.deleted_at IS NULL
  AND d.work_date >= CURRENT_DATE - INTERVAL '30 day'
ORDER BY d.work_date ASC, d.driver_name ASC;
```

```sql
EXPLAIN ANALYZE
SELECT *
FROM work_time_conflicts
WHERE driver_uuid = '00000000-0000-4000-8000-000000000000'
ORDER BY created_at DESC
LIMIT 100;
```

## Index Review

Existing Sprint H schema already benefits from UUID primary/unique indexes. For production-sized Work Time data, keep or add these indexes:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_days_review
ON work_days (work_date DESC, driver_uuid, approval_status)
WHERE deleted_at IS NULL;
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_time_conflicts_driver_created
ON work_time_conflicts (driver_uuid, created_at DESC);
```

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_time_entries_day_active
ON work_time_entries (work_day_uuid, start_time ASC)
WHERE deleted_at IS NULL;
```

## Findings

- Weekly review and export queries are bounded by date filters in normal use and should remain index-friendly.
- Conflict list is already limited to 100 rows and ordered by `created_at DESC`.
- The highest risk query is unfiltered export on very large data sets; keep admin workflows date-filtered and consider streaming exports if records grow beyond typical weekly/monthly review volumes.

## Result

No code-level query rewrite was required in Sprint I. The recommended indexes are documented for production maintenance because creating concurrent indexes depends on deployment permissions and data volume windows.
