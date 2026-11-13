# nfse-br

Node/TypeScript client and CLI for Brazilian service invoices (NFS-e), with two issuing
systems behind one certificate and one command line:

- **Sistema Nacional NFS-e** (SEFIN + ADN): the national issuer, and the way to issue for the
  **Simples Nacional** since 2026-11-01 (Res. CGSN 191/2026). Issue, cancel, query, DANFSe.
  See [docs/national.md](docs/national.md).
- **GissOnline** (legacy for the Simples): the Web Services of **32 cities** (24 in São Paulo,
  including Guarulhos, Santos and Santo André). It follows ABRASF 2.04 with the LC 214/2025
  extensions (NT SE/CGNFS-e nº 007). The city is one environment variable; see
  [docs/municipalities.md](docs/municipalities.md).

Formerly `gissonline-nfse`. The `giss` command and `GissClient` still work as aliases.

On GissOnline it covers all **16 operations** of the two published SOAP services: `nfse`
(services provided) and `nfsc` (services received). It also covers the portal REST API,
the only way to reach the customer and supplier directory and the municipal activity table.

- Issue, cancel and replace invoices, single or in batches
- Queries by period, competence, number range, RPS and protocol
- The city activity table, where `CodigoTributacaoMunicipio` and its LC 116 item come from
- Declaration of received services (supplier invoices)
- XMLDSig signing with an A1 certificate, in the shape each operation requires
- Portal login with that same certificate, so no CPF and password are needed
- Fale Conosco messages: read the replies from the city hall, and open new ones
- Validation against the official XSD before sending
- National issuer: issue, cancel, query, DANFSe and the distribution of every invoice
  where your CNPJ appears
- Typed errors that say whether a retry is safe; see [docs/errors.md](docs/errors.md)
- No write operation fires without `--confirm`

## Which system issues?

| Taxpayer | Issue with | Notes |
| --- | --- | --- |
| ME/EPP in the Simples Nacional | **National** (the default) | GissOnline stopped issuing for them on 2026-11-01. Confirmed in production (Suzano, 2026-11-13) |
| Not in the Simples | National is also the default | In a city that has not adopted it, `issue` answers `E0039`: pass `--issuer giss` (check with `nfse national-status`) |
| MEI | National web issuer | Not exercised by this client; RN 239 exempts MEI from the city agreement too |

GissOnline is still the way to **read** what it already holds: invoices issued until
2026-10-31, the customer and supplier directory, the activity table and the Fale Conosco
messages. Its issuing, cancelling and replacing are still in the client, but a Simples optant
should not count on them: GissOnline blocks them since 2026-11-01, and on 2026-11-13 its
homologation environment refused an RPS with `E160` (schema). Not tested in production.

Numbering is separate: the national system numbers invoices from 1 per issuer, apart from
GissOnline's sequence. `nDPS` (the request number) is yours to choose with `--dps`.

## Requirements

- Node 22+. Running from the repository without a build needs 22.18+, where `.ts` files
  execute natively
- A1 ICP-Brasil digital certificate (`.pfx`) for the provider
- `xmllint` (optional) — enables XSD validation before sending

## Install

### As a package

```bash
npm install nfse-br        # in a project
npm install -g nfse-br     # or globally, for the nfse command
```

The `nfse` binary (with `giss` kept as an alias) becomes available in the shell and reads the `.env` of the current
directory. Shell completion for bash and zsh is described in [docs/cli.md](docs/cli.md#shell-completion).

### From the repository

```bash
npm install
cp .env.example .env                    # fill in the credentials
cp /path/to/certificate.pfx cert/       # the folder ships empty
npm run nfse -- latest                  # same as `nfse latest`
```

Scripts: `npm run build` (compiles to `dist/`), `npm run typecheck`, `npm run nfse`.

`cert/` and `data/` are versioned empty (just a `.gitkeep`) to mark where the files go —
their contents never enter the repository.

## Quick start

```bash
# National issuer — the default for `issue` (use --issuer giss for a city that has not adopted it)
nfse national-status                      # the city's agreement (see docs/national.md)
nfse issue --customer acme --amount 1500 --description "Consulting" --dps 7
nfse issue --customer acme --amount 1500 --description "Consulting" --dps 7 --confirm
nfse national-pdf --key <50-digit key>    # the DANFSe, rendered from the invoice XML
nfse cancel --key <key> --reason 1 --text "Wrong service code, will be reissued" --confirm
```

For an ME/EPP apportioned through the Simples the DPS carries no ISS rate (the DAS carries
it). Pass `--item`, `--cnae` and `--nbs` of the service you are billing: the default profile
is software development. Use `--dps N` in sequence so a retry is safe. The step by step, with
what the service refused and why, is in [docs/national.md](docs/national.md).

```bash
# GissOnline (queries, directory, and issuing where the city still serves you)
nfse latest                               # the most recent invoices
nfse activities --company                 # activity codes this company can use
nfse issue --issuer giss --customer acme --amount 1500 --description "Consulting"
nfse issue --issuer giss --customer acme --amount 1500 --description "Consulting" --confirm
nfse pdf --number 573                     # the invoice as a file
```

```ts
import { NfseClient, PortalService } from "nfse-br";

// `nfse` and `nfsc` are the two Web Services; `config` and `certificate` come
// resolved. Destructuring a service is safe — destructuring a method is not.
const { nfse, config, certificate } = new NfseClient();

const { invoices } = await nfse.queryProvidedServices({
  issuePeriod: { from: "2026-07-01", to: "2026-07-31" },
});

// CodigoTributacaoMunicipio and its LC 116 item, from the city's own table.
// This route is public — no login, no certificate:
const activities = await PortalService.listActivities(config.cityCode);
// [{ code: "6319400", serviceListItem: "1.09", description: "Portais…", rate: 4 }, …]

// Anything company-specific needs a session. The A1 that signs the RPS opens
// the portal too, so no CPF and password are required:
const portal = await PortalService.authenticate({ certificate, cityCode: config.cityCode });
const mine = await portal.companyActivities();   // rate valid today, by default
```

Nothing that writes fires without `--confirm`.

## Documentation

| | |
| --- | --- |
| [examples/](examples/) | Runnable scripts, all checked against production |
| [docs/cli.md](docs/cli.md) | Every command, completion, documents and lookups |
| [docs/municipalities.md](docs/municipalities.md) | The cities that publish the Web Service |
| [docs/library.md](docs/library.md) | Using it as a package, and the 16 operations |
| [docs/configuration.md](docs/configuration.md) | `.env`, serving several companies, tax profile, homologation |
| [docs/issuing.md](docs/issuing.md) | What actually issues an invoice, and why |
| [docs/national.md](docs/national.md) | The national issuer: the 2026-11-01 move for Simples Nacional, what the live service accepts, numbering |
| [docs/errors.md](docs/errors.md) | Error codes, retries, and what is safe to repeat |
| [docs/gotchas.md](docs/gotchas.md) | What the live service taught us the hard way |
| [docs/architecture.md](docs/architecture.md) | Layers, patterns, mTLS, SOAP and the signature |

Under `docs/`: technical manuals (Services Provided v1.6, Services Received/CST v2.5,
PIS/COFINS/CSLL v1.0), XML samples and the errors and alerts spreadsheet. The XSD live
in `schemas/`, one folder per provider.
Source: <https://suzano.giss.com.br/giss-ajuda/desenvolvedores.html>.

`schemas/giss/tomados/vigente/` carries the services-received XSD with the `tipos` v1_01
merged over v1_00 — necessary because the published v1_01 is a delta that does not compile
on its own. The originals stay untouched in the directory above.

## Security

Never committed (already covered by `.gitignore`):

- `.env` — certificate password and portal credentials
- `cert/*` — the `.pfx` and exported PEM files (the key is written **without a passphrase**,
  mode `0600`)
- `data/*` — local directory and tax profile, holding third-party data

Two notes on the code: the `APP_ID` in `portal-service.ts` is not a secret — it is a public
constant from the portal bundle, sent by any browser that opens the site. And the signature
uses `rsa-sha1` with a `sha1` digest: weak by today's standards, but it is what the service
validates (manual, section 6.3).

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by a
local hook and a CI check. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Releasing

Fully automatic. Merging a pull request into `main` is the whole ritual:
[semantic-release](https://semantic-release.gitbook.io) reads the conventional
commits, works out the version, writes the changelog, tags, opens the GitHub
release, and publishes to npm through
[trusted publishing](https://docs.npmjs.com/trusted-publishers) — OIDC, no token
stored anywhere.

| Commit | Release |
| --- | --- |
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `chore:`, `ci:`, `docs:`, `test:` | none |

Which is why the commit type matters: it is the only input to the version. A
`fix` labelled as `chore` never ships.

## Disclaimer

Independent project, not affiliated with Eicon, GissOnline or the Comitê Gestor da NFS-e. The portal REST API is
internal and has no public contract — it may change without notice. Issuing, cancelling or
replacing an invoice has real tax effects: check the profile values with your accountant
before using `--confirm` in production.

## License

MIT
