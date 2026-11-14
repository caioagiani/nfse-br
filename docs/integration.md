# Integrating into your system

How the package fits a business that already has its own database: customers in a table,
one or more companies issuing, a job that emits at the end of the month. **Nothing here uses
the local `data/` folder** — `ContactRepository` and `ProfileRepository` exist for the CLI. In
a system, your database is the register and the package only receives the data at the moment
of issuing.

The example issues through the national system (the default). Every name below is part of the
public API.

## The shape of an integration

```
your database ──► map to the package's types ──► client.issueMany ──► results ──► your database
   (customers,        (a function you write         (idempotent by         (status, access
    DPS numbers)       once: toTaker)                DPS number)            key, errors)
```

## 1. Map your rows to a taker

```ts
import type { ServiceTaker } from "nfse-br";

const toTaker = (c: CustomerRow): ServiceTaker => ({
  cnpj: c.cnpj,
  legalName: c.legal_name,
  address: {
    street: c.street,
    number: c.number,
    district: c.district,
    cityCode: c.ibge_code,   // IBGE, 7 digits
    state: c.state,
    zipCode: c.zip,
  },
  contact: { email: c.email },
});
```

A taker abroad uses `nif` and `foreignAddress` instead; see
[national.md](national.md#exporting-a-service-foreign-taker-and-comext).

## 2. One client per company

The fiscal profile (service item, NBS, regime) is the company's, so it goes in the client; each
invoice only brings what varies. For many companies, keep the opened certificates in a
[`CertificatePool`](configuration.md#caching-certificates-for-many-companies-certificatepool).

```ts
import { CertificatePool, NfseClient } from "nfse-br";

const certificates = new CertificatePool();

async function clientFor(company: CompanyRow) {
  const certificate = await certificates.get(
    company.id,
    async () => ({ pfx: await vault.read(company.id), password: await vault.password(company.id) }),
    { version: company.certificate_updated_at },
  );
  return new NfseClient({
    environment: "producao",
    city: company.city_slug,             // e.g. "suzano"
    cityCode: company.ibge_code,
    cnpj: company.cnpj,
    municipalRegistration: company.municipal_registration,
    certificate,
    profile: { serviceListItem: company.service_item, nbsCode: company.nbs },
  });
}
```

## 3. Reserve the DPS number **before** sending

The DPS number is the idempotency key: sending the same number twice never issues two invoices.
That only protects you if the number was saved before the request, so a crash can be repeated
safely.

```ts
// one transaction: reserve the numbers and mark the rows as "sending"
const rows = await db.transaction(async (tx) => {
  const due = await tx.query("select * from charges where status = 'due' for update skip locked");
  for (const row of due) {
    row.dps = await tx.nextDpsNumber(company.id);          // your counter, per series
    await tx.query("update charges set dps = $1, status = 'sending' where id = $2", [row.dps, row.id]);
  }
  return due;
});
```

Numbers are unique per series and need not be contiguous; a gap does no harm.

## 4. Issue, and store what came back

```ts
const client = await clientFor(company);

const results = await client.issueMany(
  rows.map((row) => ({
    number: row.dps,
    taker: toTaker(row.customer),
    serviceAmount: row.amount,
    description: `Subscription ${row.period}`,
  })),
  { concurrency: 4, ratePerSecond: 5 },
);

for (const result of results) {
  const row = rows[result.index]!;
  if (result.status === "issued" || result.status === "already-issued" || result.status === "reconciled") {
    await db.query("update charges set status = 'issued', access_key = $1, nfse_number = $2 where id = $3",
      [result.nfse.accessKey, result.nfse.number, row.id]);
  } else {
    await db.query("update charges set status = 'failed', error = $1 where id = $2",
      [describe(result), row.id]);
  }
}
```

`issueMany` validates every invoice **before** sending the first one: an invalid invoice, or a
repeated DPS number, throws `ValidationError` with `details.index` and nothing is issued. After
that a failure never stops the others. Statuses: `issued`, `already-issued` (the number had
already become an invoice), `reconciled` (the answer was lost but the invoice exists),
`failed`, `skipped`.

## 5. Decide what to do with a failure

```ts
import { NfseError, describeNationalCode } from "nfse-br";

function describe(result: { status: "failed"; error: unknown }) {
  const error = result.error;
  if (!(error instanceof NfseError)) return String(error);
  if (error.outcomeUnknown) return "unknown outcome: run the batch again";   // safe: same DPS numbers
  if (error.retryable) return `temporary: ${error.message}`;
  return error.message;                                                      // a refusal: fix the data
}
```

- **`outcomeUnknown`** or **`retryable`**: run the same list again. What was issued comes back as
  `already-issued`; only the rest is sent.
- **Not retryable**: the SEFIN refused it. The message carries the national code (`E0039`…);
  `describeNationalCode("E0039")` and [national-errors.md](national-errors.md) say what to fix.
  Do not retry the same data.

## 6. Cancel, replace, and read what others issued against you

```ts
await client.cancel(accessKey, 1, "Valor informado errado na emissao");        // event 101101
await client.replace(accessKey, corrected, "99", "Correcao do valor do servico");

// services taken: invoices others issued against your CNPJ
let cursor = await db.getCursor(company.id);                                    // starts at 0
const { invoices, nextNsu } = await client.received(cursor);
for (const invoice of invoices) await db.saveReceived(company.id, invoice);
await db.setCursor(company.id, nextNsu);
```

## 7. Audit and observe

- `new NfseClient({ onExchange })` receives every SOAP exchange with GissOnline (signed request
  and raw answer, or the error) for your audit log. The national requests use `debug` or your
  own transport.
- `certificates.stats()` and the `status` of each result feed a dashboard.
- Run `npm run test:contract` in CI (see [CONTRIBUTING.md](../CONTRIBUTING.md)) so a change in
  the government contract shows up before a customer does.

## What this does not do

It does not queue: a job that crashes is simply run again, which is safe, but scheduling and
queues (BullMQ, pg-boss…) are yours. It does not keep the customer register or the DPS counter:
those are your tables, which is the point.
