# Orders Portal

The Orders Portal is an SAP CAP application for viewing and processing failed supplier orders.

## Project Structure

| File or Folder | Purpose |
|---|---|
| `app/` | SAP Fiori applications for Failed Orders and All Orders |
| `db/` | CAP CDS entities, data types, and physical table mappings |
| `srv/` | CAP service definitions and business logic |
| `database/manual-migrations/` | Reference copies of manually managed PostgreSQL changes |
| `test/` | Local application regression tests |
| `mta.yaml` | SAP BTP Multi-Target Application deployment descriptor |
| `xs-security.json` | XSUAA scopes and role definitions |
| `package.json` | Application dependencies, scripts, and CAP configuration |

## Local Validation

Validate the service implementation:

```sh
node --check srv/service.js
```

Run the atomic-lock regression tests:

```sh
node --test --test-concurrency=1 test/acquire-lock.test.js
```

Create the production CAP build:

```sh
npx cds build --production
```

## PostgreSQL Schema Management

The physical Orders Portal PostgreSQL tables are created and maintained manually in the on-premises PostgreSQL database.

The CAP application uses the CDS model under `db/` for entity definitions, data types, service projections, OData metadata, validation, and physical table mapping.

The CAP database deployer and `cf deploy` do not automatically execute files under `database/manual-migrations/`.

## OrderHistory ID Sequence

The Cancel flow creates a new OrderHistory record without copying the Failed Orders technical ID.

PostgreSQL generates the new OrderHistory ID using:

```text
orders_portal_orderhistory_id_seq
```

The required database setup has already been completed in environments where the following verification succeeds.

Verify the OrderHistory ID default:

```sql
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders_portal_orderhistory'
  AND column_name = 'id';
```

Expected default:

```text
nextval('orders_portal_orderhistory_id_seq'::regclass)
```

Verify that the sequence exists:

```sql
SELECT
    to_regclass(
        'public.orders_portal_orderhistory_id_seq'
    ) AS sequence_name;
```

Expected result:

```text
orders_portal_orderhistory_id_seq
```

If both verification queries return the expected results, do not execute the migration again.

If a future environment or manually rebuilt schema is missing the sequence or column default, an authorized database user can apply:

```sh
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f database/manual-migrations/001-orderhistory-id.sql
```

This is a manual database operation. It is not executed by the CAP application, the CAP database deployer, or `cf deploy`.

Do not run the following regression script against DEV, QA, or PROD:

```text
database/manual-migrations/test/orderhistory-id.sql
```

That script is intended only for an approved disposable PostgreSQL test database.

## Record Locking

The application uses these fields to prevent concurrent processing of the same failed order:

- `isProcessing`
- `lockedBy`
- `lockedAt`
- `lockExpiresAt`

Lock acquisition uses one atomic conditional database update.

A request can acquire a lock when:

- `isProcessing` is false;
- `isProcessing` is null;
- `lockExpiresAt` is null; or
- the previous lock has expired.

The affected-row count determines whether lock acquisition succeeded:

- One updated row means the lock was acquired.
- Zero updated rows means the request is blocked or the record does not exist.

A scheduled lock-release job is not required. Failed processing releases the lock through the application flow, and expired locks can be replaced by a later request.

## QA Validation

Before QA validation:

1. Confirm the pull request checks and required approval are complete.
2. Build and deploy the approved application revision.
3. Verify the OrderHistory sequence and ID default using the read-only queries above.
4. Do not run the migration again if the expected sequence and default already exist.
5. Confirm the QA CPI destination and environment configuration.
6. Test one approved Cancel record.
7. Confirm the record is removed from Failed Orders.
8. Confirm a new Cancelled record appears in All Orders.
9. Test one approved Resend record.
10. Confirm only one CPI request is generated for that record.

## Learn More

Learn more at [SAP Cloud Application Programming Model](https://cap.cloud.sap).