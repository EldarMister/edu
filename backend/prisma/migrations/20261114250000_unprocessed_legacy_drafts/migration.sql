-- An old draft never crossed the posting boundary. Do not mark it accounted
-- merely because it existed before the cutover. Genuine versioned snapshots
-- created by the new posting flow are left untouched.
UPDATE order_items oi SET stock_accounting_snapshot=NULL
FROM orders o
WHERE o.id=oi.order_id AND o.cafe_id IS NOT DISTINCT FROM oi.cafe_id AND o.status='draft'
AND oi.stock_accounting_snapshot='{"version":1,"legacyRecorded":true}'::jsonb;
