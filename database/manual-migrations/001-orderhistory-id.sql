BEGIN;

LOCK TABLE orders_portal_orderhistory IN SHARE ROW EXCLUSIVE MODE;

CREATE SEQUENCE IF NOT EXISTS orders_portal_orderhistory_id_seq;

SELECT setval(
    'orders_portal_orderhistory_id_seq',
    GREATEST(
        COALESCE((SELECT MAX(id)::bigint FROM orders_portal_orderhistory), 0) + 1,
        (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END
         FROM orders_portal_orderhistory_id_seq)
    ),
    false
);

ALTER TABLE orders_portal_orderhistory
    ALTER COLUMN id SET DEFAULT nextval('orders_portal_orderhistory_id_seq');

ALTER SEQUENCE orders_portal_orderhistory_id_seq
    OWNED BY orders_portal_orderhistory.id;

COMMIT;
