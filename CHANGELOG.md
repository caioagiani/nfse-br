# [2.1.0](https://github.com/[secure]/nfse-br/compare/v2.0.1...v2.1.0) (2026-11-13)


### Features

* **nacional:** issue and cancel on the client, national first ([#26](https://github.com/[secure]/nfse-br/issues/26)) ([fa11165](https://github.com/[secure]/nfse-br/commit/fa11165865936c3b4ee0c40ba5873f99f89fb243))

## [2.0.1](https://github.com/[secure]/nfse-br/compare/v2.0.0...v2.0.1) (2026-11-13)


### Bug Fixes

* **docs:** drop maintainer release notes from the README ([#25](https://github.com/[secure]/nfse-br/issues/25)) ([caeae87](https://github.com/[secure]/nfse-br/commit/caeae875faa6347330f29e98fb275238175cb245))

# [2.0.0](https://github.com/[secure]/nfse-br/compare/v1.9.0...v2.0.0) (2026-11-13)


* feat!: national NFS-e issuer, typed errors, and rename to nfse-br ([#23](https://github.com/[secure]/nfse-br/issues/23)) ([1e8f70f](https://github.com/[secure]/nfse-br/commit/1e8f70f037750cfeda7a08ee294baca225a88c32)), closes [#22](https://github.com/[secure]/nfse-br/issues/22)


### BREAKING CHANGES

* the package is now nfse-br, and the bundled XSD moved
from docs/schemas* to schemas/. validateAgainstSchema defaults to
schemas/giss/prestados.

* ci: run the test suite before publishing a release

* ci: run the tests as their own job on Node 22 and 24

* ci: test once, on the lowest supported Node
* Node 20 is no longer supported (end of life in April
2026). engines now requires Node 22 or later.

* fix(nfsc): drop the supplier Contato group when there is no phone

* refactor(giss): make the SOAP transport injectable

* test(giss): cover issuing, signatures, parsing, storage and the CLI

* fix(nfsc): refuse a supplier contact without a phone

* feat(nacional): show keys, parties and events in the document list

* feat(nacional): render the DANFSe locally, per NT 008

* fix(messages): decode numeric character references

* feat(nacional): match the DANFSe printed by the Emissor Nacional

* chore(deps): update xml-crypto and audit runtime dependencies

* fix(nacional): match the DANFSe from the public consultation

* feat(nacional): embed DANFSe fonts and render from a saved XML

* fix(nacional): follow what the live SEFIN accepts for ME/EPP

Confirmed by issuing in production (Suzano, Simples, ISS not withheld):
- totTrib: send pTotTribSN, never indTotTrib (E0712)
- PIS/COFINS: send the profile CST; leave tpRetPisCofins 0 blank
- restricted environment: finNFSe in infDPS and cNBS before xDescServ,
  per the 2026-10-20 schemas (schemas/nacional-restrita)

* docs(nacional): record what the live service taught us

- E0039 does not apply to ME/EPP apportioning through the Simples with
  competence on or after 2026-11-01 (RN 239); the ADN flag is not the criterion
- no ISS rate in the DPS without withholding (RN 657), no IBSCBS before 2027
- numbering, nDPS, the 01.09.02 code, and the restricted-environment layout
- print the Simples deadline warning on stderr so --xml stays pipeable

* docs: lead with the national issuer, GissOnline as legacy for Simples

* feat(cli)!: pick the national issuer for Simples optants

With NFSE_EMISSOR and --issuer unset, issue/replace use the national issuer
for an optant of the Simples Nacional from 2026-11-01, and cancel --key
always does. Anyone else stays on GissOnline. Setting either option wins.
* a Simples optant who relied on the GissOnline default must
now pass --issuer giss (or NFSE_EMISSOR=giss).

* test(cli): cover the automatic issuer, cancel by key and 01.09.02

Also fix the gotchas and the CLI doc that still said the city flag decides.

* feat(cli)!: make the national issuer the default for issue

issue goes national when NFSE_EMISSOR and --issuer are unset; cancel follows
its argument (--key national, --number GissOnline). A city that has not
adopted the national issuer answers E0039 and the CLI points to --issuer giss.
* issue no longer defaults to GissOnline; pass --issuer giss
or set NFSE_EMISSOR=giss.

* fix(storage): use the taker's city as the IBS/CBS incidence location

With cIndOp 100301 the portal requires the taker's municipality (E160), not the provider's.

* docs: describe the national issuer first in the package description

# [1.9.0](https://github.com/[secure]/gissonline-nfse/compare/v1.8.0...v1.9.0) (2026-10-02)


### Features

* **nfse:** issue service exports with comExt and the foreign address ([#21](https://github.com/[secure]/gissonline-nfse/issues/21)) ([8652a0c](https://github.com/[secure]/gissonline-nfse/commit/8652a0c9cffb638f83c725f8ff436e7f2fae3953))

# [1.8.0](https://github.com/[secure]/gissonline-nfse/compare/v1.7.0...v1.8.0) (2026-08-19)


### Features

* **portal:** read and open Fale Conosco messages ([#20](https://github.com/[secure]/gissonline-nfse/issues/20)) ([cb6fc21](https://github.com/[secure]/gissonline-nfse/commit/cb6fc21b9d1b732624400cd0b9e74c367eea88ed))

# [1.7.0](https://github.com/[secure]/gissonline-nfse/compare/v1.6.0...v1.7.0) (2026-08-19)


### Features

* **portal:** municipal activity table and certificate login ([#19](https://github.com/[secure]/gissonline-nfse/issues/19)) ([1707ec8](https://github.com/[secure]/gissonline-nfse/commit/1707ec84d34cbecde6871fcec5357c9da253a001))

# [1.6.0](https://github.com/caioagiani/gissonline-nfse/compare/v1.5.0...v1.6.0) (2026-08-19)


### Features

* expose invoice.rps and the lookup helpers, with runnable examples ([#18](https://github.com/caioagiani/gissonline-nfse/issues/18)) ([92c9401](https://github.com/caioagiani/gissonline-nfse/commit/92c9401fcb084eb1f5ccf26daedea9e7d459d879))

# [1.5.0](https://github.com/caioagiani/gissonline-nfse/compare/v1.4.1...v1.5.0) (2026-08-18)


### Features

* **config:** support the 32 cities that publish the Web Service ([#17](https://github.com/caioagiani/gissonline-nfse/issues/17)) ([ac74a58](https://github.com/caioagiani/gissonline-nfse/commit/ac74a58a4f3bcffbeebba82186256ca071d146b2))

## [1.4.1](https://github.com/caioagiani/gissonline-nfse/compare/v1.4.0...v1.4.1) (2026-08-18)


### Bug Fixes

* **storage:** require the ISS rate when the tax is chargeable ([#15](https://github.com/caioagiani/gissonline-nfse/issues/15)) ([eb4493c](https://github.com/caioagiani/gissonline-nfse/commit/eb4493cd0c1668adddf317dc0d129839b84edf85))

# [1.4.0](https://github.com/caioagiani/gissonline-nfse/compare/v1.3.0...v1.4.0) (2026-08-18)


### Features

* **nfse:** issue without the risk of issuing twice ([#16](https://github.com/caioagiani/gissonline-nfse/issues/16)) ([065af45](https://github.com/caioagiani/gissonline-nfse/commit/065af45d3d826ea815fc2014d0614f9def8228f3))

# [1.3.0](https://github.com/caioagiani/gissonline-nfse/compare/v1.2.0...v1.3.0) (2026-08-18)


### Features

* **infra:** accept the certificate from memory or already parsed ([#13](https://github.com/caioagiani/gissonline-nfse/issues/13)) ([54c2182](https://github.com/caioagiani/gissonline-nfse/commit/54c2182f3df530ed4e326846f894d66cb8cc6fd8)), closes [#14](https://github.com/caioagiani/gissonline-nfse/issues/14)

# [1.2.0](https://github.com/caioagiani/gissonline-nfse/compare/v1.1.1...v1.2.0) (2026-08-18)


### Features

* **cli:** download the PDF and XML of an issued invoice ([#12](https://github.com/caioagiani/gissonline-nfse/issues/12)) ([2216e7f](https://github.com/caioagiani/gissonline-nfse/commit/2216e7f6c6a76d660ee8a270dfb54049ea0674f2))

# Changelog

## [1.1.1](https://github.com/caioagiani/gissonline-nfse/compare/v1.1.0...v1.1.1) (2026-08-18)


### Bug Fixes

* **portal:** restore contact fields and make updates persist ([#9](https://github.com/caioagiani/gissonline-nfse/issues/9)) ([6ad10b1](https://github.com/caioagiani/gissonline-nfse/commit/6ad10b18e478b35fb0e62bc6cdc29e872a5caae0))
