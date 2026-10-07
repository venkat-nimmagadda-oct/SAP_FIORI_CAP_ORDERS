\set ON_ERROR_STOP on
CREATE SCHEMA orderhistory_id_test;
SET search_path TO orderhistory_id_test;
CREATE TABLE orders_portal_orderhistory (id integer PRIMARY KEY, marker text);

\ir ../migrations/001-orderhistory-id.sql

DO $$
BEGIN
    IF (SELECT last_value FROM orders_portal_orderhistory_id_seq) <> 1 THEN
        RAISE EXCEPTION 'Empty history must start at 1';
    END IF;
END $$;

INSERT INTO orders_portal_orderhistory (marker) VALUES ('generated');
INSERT INTO orders_portal_orderhistory (id, marker) VALUES (100, 'existing');
\ir ../migrations/001-orderhistory-id.sql
\ir ../migrations/001-orderhistory-id.sql

DO $$
DECLARE
    generated_id integer;
BEGIN
    INSERT INTO orders_portal_orderhistory (marker) VALUES ('after migration')
        RETURNING id INTO generated_id;
    IF generated_id <> 101 THEN
        RAISE EXCEPTION 'Expected 101, received %', generated_id;
    END IF;
    IF (SELECT count(*) FROM orders_portal_orderhistory
        WHERE (id = 1 AND marker = 'generated') OR (id = 100 AND marker = 'existing')) <> 2 THEN
        RAISE EXCEPTION 'Existing history changed';
    END IF;
    IF pg_get_serial_sequence('orders_portal_orderhistory', 'id')
        IS DISTINCT FROM 'orderhistory_id_test.orders_portal_orderhistory_id_seq' THEN
        RAISE EXCEPTION 'Sequence ownership missing';
    END IF;
END $$;

SELECT setval('orders_portal_orderhistory_id_seq', 500, true);
\ir ../migrations/001-orderhistory-id.sql

DO $$
DECLARE
    generated_id integer;
BEGIN
    INSERT INTO orders_portal_orderhistory (marker) VALUES ('ahead sequence')
        RETURNING id INTO generated_id;
    IF generated_id <> 501 THEN
        RAISE EXCEPTION 'Sequence was rewound: %', generated_id;
    END IF;
END $$;

DROP SCHEMA orderhistory_id_test CASCADE;
