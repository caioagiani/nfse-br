# National issuer (Sistema Nacional NFS-e)

From **2026-11-01**, companies in the Simples Nacional (ME and EPP) can no longer issue
NFS-e through the city's own system: Resolução CGSN nº 191/2026 moves them to the
national standard, through the national issuer — web or API. Until 2026-10-31,
GissOnline keeps working as before.

## Authentication

The national API has **one** way in: mutual TLS with the company's **A1 certificate**
(`CERT_PATH` / `CERT_PASSWORD`). There is no token, no login and no separate registration — the
certificate's CNPJ is the identity. `issue`, `cancel`, `national-get`, `national-xml`,
`national-pdf`, `national-docs` and `national-status` all use it, and nothing else.

The Emissor Nacional **web portal** (nfse.gov.br/EmissorNacional) has two other doors: CNPJ and
password, and the certificate through `certificado.nfse.gov.br`. This client does not use the
portal, because the API gives it everything it needs: issuing, events, the invoice by key and the
distribution of every invoice where the CNPJ appears. A CNPJ and password kept in `.env`
(for example `EMISSOR_NACIONAL_LOGIN` / `EMISSOR_NACIONAL_PASSWORD`) are read by nobody here; they
are only useful for opening the web portal by hand.

## Who issues

```bash
NFSE_EMISSOR=nacional        # in .env — or --issuer nacional per command
```

Setting it always wins. Left empty, the CLI decides, and says so in the preview:

| Command | Automatic choice |
| --- | --- |
| `issue` | **national**, for everyone |
| `cancel` | **national** with `--key`; GissOnline with `--number` |
| `replace` | GissOnline, except for a Simples optant after 2026-11-01, who gets the error that says to cancel and issue again |

National is the default because it is the country's standard and, since 2026-11-01, the only
issuer left for the Simples Nacional. A taxpayer who is **not** an ME/EPP apportioned through the
Simples still depends on the city's agreement (see below): in a city that has not adopted the
national issuer, `issue` answers `E0039` and the CLI points to `--issuer giss`.

`issue` and `cancel` then go through the national API. Everything else (queries by number, portal,
directory) stays on GissOnline.

## Before the first invoice: is the city ready?

```bash
nfse national-status
```

```
Shares with national:    yes
Accepts national issuer: no
```

These are two flags **of the city** in the ADN:

| Flag (ADN) | Meaning |
| --- | --- |
| `aderenteAmbienteNacional` | the city shares its own system's invoices with the national base |
| `aderenteEmissorNacional` | the city accepts invoices from the national issuer |

While the second one is `0`, a DPS is refused with `E0039 — O município emissor informado na DPS
deve estar parametrizado para utilizar os emissores públicos nacionais`. **There is an exception**
(RN 239, Annex VI): an ME/EPP (`opSimpNac = 3`) that apportions through the Simples
(`regApTribSN = 1`) and whose competence is on or after **2026-11-01** is not subject to it.
So the flag is not the criterion for that taxpayer: Suzano still answers `0`, and invoices are
issued anyway (first live issue: 2026-11-13). A competence before 2026-11-01 probably still
gets `E0039`. The restricted environment does not apply the exception yet.

## Commands

```bash
nfse national-status                      # the two flags above
nfse national-docs [--from NSU]           # invoices and events where your CNPJ appears
nfse national-get --key K                 # one invoice by its 50-digit access key
nfse national-pdf --key K [--out DIR]     # the DANFSe, generated locally (see below)
nfse national-xml --key K [--out DIR]
nfse danfse nfse.xml [--event FILE]... [--out DIR|FILE]   # offline, from a saved XML

nfse issue --issuer nacional --customer acme --amount 1500 --description "…"
nfse issue --issuer nacional --customer acme --amount 1500 --description "…" --dps 7 --confirm
nfse cancel --issuer nacional --key K --reason 1 --text "Valor informado errado" --confirm
```

`national-docs` already lists the invoices issued through GissOnline: a city that
shares with the national base forwards them, with their national access key.

## How issuing works

The DPS (Declaração de Prestação de Serviço) plays the role of the RPS. It is built from
the same `Rps` the GissOnline path uses, so the tax profile, the directory and the CLI
flags serve both. The SEFIN validates it and answers with the invoice at once, with no
batch and no protocol.

- **Retrying is safe with `--dps`.** The DPS id is city + CNPJ + series + number. Before
  sending, the client asks the SEFIN whether that DPS already became an invoice, and if
  it did, returns that invoice. Without `--dps`, the number is the current Unix time.
- **The series** comes from `nationalSeries` in the profile (default `1`).
- **Simples Nacional**: `opSimpNac` comes from `simplesOption` in the profile, or `3`
  (ME/EPP) when `simplesNacionalOptant` is `1`. When everything is apportioned through
  the Simples (`regApTribSN = 1`), the ISS rate is left out of the DPS, because it comes
  from the PGDAS and not from the invoice.
- **The signature is SHA-256.** GissOnline only validates SHA-1. The national API takes
  SHA-256, so the client uses it there.
- **Cancelling is an event** (`101101`) on the access key, with reason `1` (issuing error),
  `2` (service not provided) or `9` (other) and a justification of 15 to 255 characters.
  `replace` is not available on this path yet: cancel, then issue again.

## DANFSe (the PDF)

The national API no longer renders it. Technical Note 008 (v1.02, 2026-07-14) suspended
`adn.nfse.gov.br/danfse` on 2026-08-03 — it answers `503` since — and moved the duty to
the issuing system: the DANFSe is generated from the invoice XML, following the model in
Annex I. Generated that way it is the official auxiliary document, with the same standing
the API's PDF had.

`national.pdf(key)` does that: one call to `GET /contribuintes/NFSe/{key}/Eventos` on the
ADN returns the invoice and its events, and `renderDanfse` draws DANFSe v2.0. The events
decide the watermark — `SUBSTITUÍDA` for `105102`, `CANCELADA` for `101101`, `105104` and
`305101` — so a PDF never comes out clean for an invoice that no longer stands. That ADN
route only reaches invoices where the certificate's CNPJ appears.

With the XML already in hand (the project that integrates the library usually keeps
it), render it without going to the network or loading the certificate. Pass the event
XMLs and the watermark follows from them, as in `national.pdf`; `status` overrides:

```ts
import { renderDanfse } from "nfse-br";
const pdf = await renderDanfse(xml, { events: [cancellationXml] }); // Uint8Array
const forced = await renderDanfse(xml, { status: "cancelled" });
```

The CLI does the same with `nfse danfse nfse.xml [--event FILE]... [--status ...]`, with
no `.env` and no certificate.

What follows the note to the letter: the Annex I layout and the 2.4.5 positions, A4
portrait on one page, 0.5 pt dividers and a 1 pt border, 5% grey shading, the QR Code
pointing to `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=…`, the "NFS-e SEM
VALIDADE JURÍDICA" header in the restricted environment, only data present in the XML
(`-` where a field is empty), the suppression rules of 2.3 and the ellipsis limits.

Checked against DANFSe printed by the Emissor Nacional itself (MEI invoices, 2026-09):
same blocks, same codes for the generating environment and environment type, `-` for each
missing part of a composite field, optional ISSQN rows dropped when empty, and line
breaks in the description kept. Also checked against the DANFSe the public consultation
returns when our QR Code is scanned (invoice transcribed by the city, `ambGer` 1). That
fixed the official quirks we copy:

- IBGE code printed as `35.52502`, rates as `2,98 %`;
- the provider's phone and e-mail come only from the DPS, never from `emit`;
- special regime "Nenhum" (0) drops the ISSQN regime row;
- `0 - PIS/COFINS/CSLL Não Retidos`, with the code in front;
- `R$ 0,00`, not `-`, in exclusions, IBS/CBS total and net + IBS/CBS when the invoice has
  no `IBSCBS` group. The last one is wrong on their side (the net is not zero), but it
  is what the official document prints;
- the description takes only the room its text needs; the rest goes to the additional
  information.

Fonts: the note names Arial and Microsoft Sans Serif, which are proprietary. The PDF
embeds Liberation Sans instead (SIL OFL 1.1, shipped in `assets/fonts` with its licence).
It has the same metrics as Arial, so the layout does not move, and it is subset to the
characters used, like the official PDF. Embedded, it looks the same in every reader; with
the standard Helvetica, some readers dropped the bold labels. A character the font lacks
(an emoji in a description) prints as `?`.

## What the live service taught us (ME/EPP, Simples, ISS not withheld)

Confirmed by real issuing on 2026-11-13 (Mobizon, Suzano; notes 1 to 4) and by the Infocus
accountants:

- **No ISS rate in the DPS.** `pAliq` is forbidden without withholding (RN 657, `E0625`) and
  required only with it (minimum 1,8%). Leave it out, and do not repeat a rate in the additional
  information: the invoice's tax is the DAS, not a rate printed on it. `--rate` is still required by
  the CLI's own validation, but it does not go into the DPS.
- **`IBSCBS` group left out.** It is optional for Simples optants until 2027 (Annex VI v1.04.01).
  The SEFIN accepted the invoice without it.
- **`totTrib`**: an ME/EPP must send `pTotTribSN`, never `indTotTrib` (`E0712`).
- **PIS/COFINS**: the profile's CST (`08`, no incidence) goes out as `<piscofins><CST>08</CST>`.
  `tpRetPisCofins = 0` ("not withheld") is left blank, which the accountants confirmed. Base, rates and
  amounts go only when they exist.
- **Numbering.** The SEFIN numbers invoices (`nNFSe`) sequentially per issuer, starting at 1,
  apart from GissOnline's own sequence (last: 585). `nDPS` is ours: pass `--dps N` in sequence;
  without it the CLI uses the Unix time and a retry is no longer idempotent. A number is not
  reused after an invoice is cancelled.
- **A shared GissOnline invoice is not a national one.** Notes shown in the national portal with
  `ambGer = 1` were generated by the city and mirrored. A national issue has `ambGer = 2`,
  `tpEmis = 1`.
- **Codes are the taxpayer's, not the CLI's.** The default profile is software development
  (item 01.04). Mobizon's top-up of SMS credit uses item `01.09.02` (`cTribNac 010902`), CNAE
  `6319400` and NBS `117031000`. Passing `--item 01.09` yields `010901` (audio): use `01.09.02`.
  The official NBS list has no SMS entry; `1.1703.10.00` is described there as "books, newspapers,
  periodicals… online", `1.1703.99.00` ("other online content") is the closest by description.

## Restricted environment: a newer layout

Since 2026-10-20 the restricted environment validates against schemas newer than the production
ones (`schemas/nacional-restrita/`, from `esquemas_prod_restrita_20261020.zip`):

- `finNFSe` (`0` = regular) is required directly in `infDPS`, after `tpEmit`;
- inside `cServ`, `cNBS` comes before `xDescServ`;
- the CNPJ type accepts letters, and the IBS/CBS group gained fields.

The builder applies the new layout only with `--env homologacao`. Production still follows the
layout of 2026-02-09. When production adopts NT 009 (date not published), Simples optants
(`opSimpNac` 3 or 4) must also send `regApIBSCBSSN` (`1` = IBS and CBS apportioned by the Simples)
and `cAtvSN` (`07` = services under Annex III only; `09` = subject to the Fator R), and the builder
should switch on the layout version instead of `environment`.

## Hosts

| | Production | Restricted (test) |
| --- | --- | --- |
| SEFIN (issue, query, events) | `sefin.nfse.gov.br/SefinNacional` | `sefin.producaorestrita.nfse.gov.br/SefinNacional` |
| ADN (distribution, events, parameters) | `adn.nfse.gov.br` | `adn.producaorestrita.nfse.gov.br` |

`--env homologacao` selects the restricted environment, which has no fiscal effect.

Schemas: `schemas/nacional/` holds the official production XSD v1.01 (2026-02-09), from
<https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual>.
Do not confuse it with **NFS-e Via**, a separate layout used only for road tolls (service
`220101`).
