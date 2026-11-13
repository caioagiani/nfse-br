# nfse-br

Node/TypeScript client and CLI for Brazilian service invoices (NFS-e) through the
**Sistema Nacional NFS-e** (SEFIN + ADN) — the issuer for the **Simples Nacional** since
2026-11-01 (Res. CGSN 191/2026). One A1 certificate, one command line.
Formerly `gissonline-nfse`; the `giss` command and `GissClient` still work as aliases.

- Issue and cancel invoices, signed in SHA-256 over mutual TLS
- Query by access key or DPS, and the distribution of every invoice where your CNPJ appears
- DANFSe rendered locally from the invoice XML (NT 008)
- Validation against the official XSD before sending
- Typed errors that say whether a retry is safe; see [docs/errors.md](docs/errors.md)
- No write operation fires without `--confirm`

The step by step, with what the live service accepts and refuses, is in
[docs/national.md](docs/national.md). The other guides are in [docs/](docs/).

> **GissOnline is legacy.** The Web Services of 32 cities (ABRASF 2.04) are still in the
> client for reading what they hold and for taxpayers outside the Simples, but a Simples
> optant cannot issue there anymore. Pass `--issuer giss` to use them; see
> [docs/municipalities.md](docs/municipalities.md).

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
nfse national-status                      # the city's agreement (see docs/national.md)
nfse issue --customer acme --amount 1500 --description "Consulting" --dps 7
nfse issue --customer acme --amount 1500 --description "Consulting" --dps 7 --confirm
nfse national-pdf --key <50-digit key>    # the DANFSe, rendered from the invoice XML
nfse cancel --key <key> --reason 1 --text "Wrong service code, will be reissued" --confirm
```

For an ME/EPP apportioned through the Simples the DPS carries no ISS rate (the DAS carries
it). Pass `--item`, `--cnae` and `--nbs` of the service you are billing: the default profile
is software development. Use `--dps N` in sequence so a retry is safe.

```ts
import { NfseClient } from "nfse-br";

const client = new NfseClient({
  // The fiscal profile lives in the client; each invoice only brings what varies.
  profile: { serviceListItem: "01.09.02", cnaeCode: "6319400", nbsCode: "117031000" },
});

const invoice = {
  number: 5, // the DPS number: reusing it never issues twice
  serviceAmount: 550,
  description: "Recarga de conta",
  taker: {
    cnpj: "10966296000153",
    legalName: "L.A. MOTORS LTDA",
    address: {
      street: "Rua das Flores",
      number: "100",
      district: "Centro",
      cityCode: "3552502",
      state: "SP",
      zipCode: "08600000",
    },
  },
};

client.previewIssue(invoice); // the signed DPS, nothing sent
const { nfse } = await client.issue(invoice);
await client.cancel(nfse.accessKey, 1, "Erro na emissao do servico");
```

GissOnline queries and the portal directory are in [docs/library.md](docs/library.md).

## Contributing

Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by a
local hook and a CI check. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Disclaimer

Independent project, not affiliated with Eicon, GissOnline or the Comitê Gestor da NFS-e. The portal REST API is
internal and has no public contract — it may change without notice. Issuing, cancelling or
replacing an invoice has real tax effects: check the profile values with your accountant
before using `--confirm` in production.

## License

MIT
