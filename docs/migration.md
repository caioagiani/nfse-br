# Migrating from `gissonline-nfse` 1.x

`gissonline-nfse` is deprecated; its last version is 1.9.0. The package continues as
`nfse-br`, from 2.0.0. The GissOnline code paths behave as before — what changes is the
name, the layout of the repository, the errors and the default issuer.

## Checklist

1. **Node 22 or later.** Node 20 is out of support and was dropped.
2. **Swap the dependency and the import.**
   ```bash
   npm remove gissonline-nfse && npm install nfse-br
   ```
   ```ts
   import { NfseClient } from "nfse-br";   // was "gissonline-nfse"
   ```
   `GissClient` and `GissClientOptions` still exist as aliases of `NfseClient`, so a code
   base can move without touching every call site.
3. **CLI.** The command is `nfse`; `giss` stays as an alias, and the `.env` is the same.
4. **Pass `--issuer giss` to keep issuing through GissOnline.** `issue` now goes to the
   national issuer by default. Set `NFSE_EMISSOR=giss` to keep the old behaviour for every
   command, or pass `--issuer giss` per call. `cancel --number` and `replace` stay on
   GissOnline; `cancel --key` is national. In a city that has not adopted the national
   issuer, `issue` answers `E0039`.
5. **Error handling by text.** See below.
6. **XSD paths.** Only if you pointed `validateAgainstSchema` at the old folders.

## GissOnline is deprecated

The GissOnline code (`client.nfse`, `client.nfsc`, `PortalService`, `--issuer giss`) is
kept and still works, but it is legacy:

- Since **2026-11-01** a Simples Nacional optant (ME/EPP) can no longer issue through it
  (Res. CGSN 191/2026). For them the national issuer is the only way.
- It keeps answering queries and issuing for taxpayers outside the Simples, in the 32
  cities listed in [municipalities.md](municipalities.md).
- It receives bug fixes, not new features. New work goes to the national issuer.
- `client.nfse` and `client.nfsc` are marked `@deprecated`, so editors strike them through;
  nothing is removed, and the CLI prints a notice on stderr when it issues through
  GissOnline.

## What changed

| 1.x | 2.x |
| --- | --- |
| `gissonline-nfse` | `nfse-br` (`NfseClient`; `GissClient` is an alias) |
| `docs/schemas*` folders | `schemas/<provider>/`: `schemas/giss/prestados`, `schemas/giss/tomados/vigente`, `schemas/nacional` |
| GissOnline only | adds the national issuer: `client.national`, and `client.issue`/`previewIssue`/`cancel` (2.1) |
| plain `Error` for network and timeout | `NfseError` subclasses with `code`, `retryable`, `outcomeUnknown` |
| Node 20 | Node 22 or later |

The library does not pick a provider for you: `client.nfse` and `client.nfsc` are
GissOnline, `client.national` and `client.issue` are the national system. Only the CLI
chooses by command, as described above.

## Errors

In 1.x a lost connection surfaced as the raw Node error (`connect ECONNREFUSED …`) and a
timeout as a plain `Error("Timeout de 60000ms em …")`. From 2.0 every failure is an
`NfseError`, and **the message text changed**: it is now a sentence that says what
happened and what to do. Code that decided from the text (`error.message.includes("ECONNRESET")`)
must decide from fields instead:

```ts
import { NfseError, TransportError } from "nfse-br";

try {
  await client.nfse.issueRps(rps);
} catch (error) {
  if (error instanceof TransportError) {
    // error.code === "TRANSPORT"; the Node error is in error.cause, the errno in
    // error.details.errno
  }
  if (error instanceof NfseError && error.outcomeUnknown) {
    // a write may have gone through: repeat with the SAME RPS number
  }
}
```

The full table of codes is in [errors.md](errors.md).

## Also new since 1.9

- `onExchange` on the client: every GissOnline SOAP exchange (signed request, raw response
  or the error) reaches your callback, to store the XML of each operation.
- `timeoutMs` on the portal credentials, and as the third argument of
  `PortalService.listActivities` (default 60 s).
- `issueRps` no longer treats `A02` (concurrent query) as "RPS not found", keeps the
  messages of a rejected batch, and does not lose the protocol when the final lookup fails.
- `PortalService.listActivities` throws a `PortalError` when the answer has no list,
  instead of returning an empty one.
