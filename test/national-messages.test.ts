import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { NotSupportedError, ValidationError } from "../src/domain/errors.ts";
import type { ForeignTrade } from "../src/domain/types.ts";
import { SCHEMA_DIRECTORIES, validateAgainstSchema } from "../src/validation/schema-validator.ts";
import {
  nfseNumberFromKey,
  parseNationalEvent,
  brasiliaDateTime,
  buildCancellationEvent,
  buildDps,
  dpsId,
  nationalTaxCode,
  parseNationalNfse,
  type DpsContext,
} from "../src/providers/nacional/messages.ts";
import { PROVIDER_CNPJ, SUZANO, sampleRps } from "./helpers.ts";

const context: DpsContext = {
  environment: 2,
  cnpj: PROVIDER_CNPJ,
  cityCode: SUZANO,
  series: "1",
  number: "7",
  simplesOption: 3,
  issueDate: new Date("2026-10-06T15:00:00Z"),
};

/** Conteúdo de uma tag, ou `undefined` quando ela não aparece. */
const tag = (xml: string, name: string) =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];

describe("dpsId", () => {
  it("monta DPS + município + tipo + CNPJ + série + número com 45 caracteres", () => {
    const id = dpsId(context);
    assert.equal(id, "DPS355250223796924900011000001000000000000007");
    assert.equal(id.length, 45);
  });

  it("aceita CNPJ formatado", () => {
    assert.equal(dpsId({ ...context, cnpj: "37.969.249/0001-10" }), dpsId(context));
  });
});

describe("nationalTaxCode", () => {
  it("completa o desdobramento quando o item vem só com subitem", () => {
    assert.equal(nationalTaxCode("01.09"), "010901");
    assert.equal(nationalTaxCode("1.9"), "010901");
  });

  it("mantém o desdobramento informado", () => {
    assert.equal(nationalTaxCode("17.01.02"), "170102");
    // 01.09 sozinho é áudio (010901); a recarga de SMS é vídeo, imagem e texto (010902)
    assert.equal(nationalTaxCode("01.09.02"), "010902");
  });

  it("recusa o que não vira seis dígitos", () => {
    assert.throws(() => nationalTaxCode("abc"), /cTribNac/);
    assert.throws(() => nationalTaxCode("01.09.01.01"), /cTribNac/);
  });
});

describe("brasiliaDateTime", () => {
  it("usa o fuso -03:00 e recua um minuto", () => {
    assert.equal(
      brasiliaDateTime(new Date("2026-10-06T15:00:30Z")),
      "2026-10-06T11:59:30-03:00",
    );
  });
});

describe("buildDps", () => {
  const xml = buildDps(sampleRps(), context);

  it("declara namespace e versão do leiaute nacional", () => {
    assert.match(xml, /<DPS xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse" versao="1\.01">/);
    assert.match(xml, /<infDPS Id="DPS355250223796924900011000001000000000000007">/);
  });

  it("preenche a identificação da declaração", () => {
    assert.equal(tag(xml, "tpAmb"), "2");
    assert.equal(tag(xml, "dhEmi"), "2026-10-06T11:59:00-03:00");
    assert.equal(tag(xml, "serie"), "1");
    assert.equal(tag(xml, "nDPS"), "7");
    assert.equal(tag(xml, "dCompet"), "2026-10-06");
    assert.equal(tag(xml, "tpEmit"), "1");
    assert.equal(tag(xml, "cLocEmi"), SUZANO);
  });

  it("identifica o prestador só pelo CNPJ e pelo regime", () => {
    const prest = /<prest>.*<\/prest>/.exec(xml)?.[0] ?? "";
    assert.equal(tag(prest, "CNPJ"), PROVIDER_CNPJ);
    assert.doesNotMatch(prest, /<IM>/);
    assert.equal(tag(prest, "opSimpNac"), "3");
    assert.equal(tag(prest, "regApTribSN"), "1");
    assert.equal(tag(prest, "regEspTrib"), "0");
  });

  it("leva tomador com documento só em dígitos, endereço e contato", () => {
    const toma = /<toma>.*<\/toma>/.exec(xml)?.[0] ?? "";
    assert.equal(tag(toma, "CNPJ"), "52884617000110");
    assert.equal(tag(toma, "xNome"), "Cliente &amp; Filhos Ltda");
    assert.equal(tag(toma, "cMun"), SUZANO);
    assert.equal(tag(toma, "CEP"), "08675000");
    assert.equal(tag(toma, "fone"), "1144445555");
    assert.equal(tag(toma, "email"), "fin@cliente.com.br");
  });

  it("usa CPF quando o tomador não tem CNPJ", () => {
    const rps = sampleRps({ taker: { cpf: "123.456.789-09", legalName: "Pessoa" } });
    const toma = /<toma>.*<\/toma>/.exec(buildDps(rps, context))?.[0] ?? "";
    assert.equal(tag(toma, "CPF"), "12345678909");
    assert.doesNotMatch(toma, /<CNPJ>/);
  });

  it("converte o item da LC 116 e leva NBS e descrição", () => {
    assert.equal(tag(xml, "cLocPrestacao"), SUZANO);
    assert.equal(tag(xml, "cTribNac"), "010401");
    assert.equal(tag(xml, "cNBS"), "115021000");
    assert.equal(tag(xml, "xDescServ"), "Desenvolvimento de software");
  });

  it("ME/EPP apurando pelo Simples não destaca alíquota", () => {
    assert.equal(tag(xml, "vServ"), "1500.00");
    assert.equal(tag(xml, "tribISSQN"), "1");
    assert.equal(tag(xml, "tpRetISSQN"), "1");
    assert.doesNotMatch(xml, /<pAliq>/);
  });

  it("não optante leva a alíquota do perfil", () => {
    const other = buildDps(sampleRps(), { ...context, simplesOption: 1 });
    assert.equal(tag(other, "pAliq"), "3.07");
    assert.doesNotMatch(other, /<regApTribSN>/);
  });

  it("ME/EPP com apuração fora do Simples leva a alíquota", () => {
    const other = buildDps(sampleRps(), { ...context, simplesApportionment: 2 });
    assert.equal(tag(other, "regApTribSN"), "2");
    assert.equal(tag(other, "pAliq"), "3.07");
  });

  it("ISS retido pelo tomador vira tpRetISSQN 2", () => {
    const withheld = sampleRps({ profile: { issWithheld: 1 } });
    assert.equal(tag(buildDps(withheld, context), "tpRetISSQN"), "2");
  });

  it("traduz a exigibilidade do ABRASF", () => {
    const of = (issTaxability: number) =>
      tag(buildDps(sampleRps({ profile: { issTaxability } }), context), "tribISSQN");
    assert.equal(of(2), "4"); // não incidência
    assert.equal(of(4), "3"); // exportação
    assert.equal(of(5), "2"); // imunidade
  });

  it("recusa exigibilidade sem equivalente nacional", () => {
    const rps = sampleRps({ profile: { issTaxability: 3 } });
    assert.throws(() => buildDps(rps, context), /Exigibilidade 3/);
  });

  it("omite retenções e descontos zerados", () => {
    assert.doesNotMatch(xml, /<vRetCP>|<vRetIRRF>|<vRetCSLL>/);
    assert.doesNotMatch(xml, /<vDescCondIncond>/);
    assert.doesNotMatch(xml, /<infoCompl>/);
  });

  it("leva PIS/COFINS do perfil (CST 08) sem zeros nem retenção de não retidos", () => {
    const piscofins = /<piscofins>(.*?)<\/piscofins>/.exec(xml)?.[1];
    assert.equal(piscofins, "<CST>08</CST>");
  });

  it("leva retenções, descontos e informação complementar quando há valor", () => {
    const full = buildDps(
      sampleRps({
        inss: 10,
        incomeTax: 22.5,
        csll: 69.75,
        unconditionalDiscount: 5,
        additionalInformation: "Pedido 42",
      }),
      context,
    );
    assert.equal(tag(full, "vRetCP"), "10.00");
    assert.equal(tag(full, "vRetIRRF"), "22.50");
    assert.equal(tag(full, "vRetCSLL"), "69.75");
    assert.equal(tag(full, "vDescIncond"), "5.00");
    assert.doesNotMatch(full, /<vDescCond>/);
    assert.equal(tag(full, "xInfComp"), "Pedido 42");
  });

  it("totTrib: ME/EPP nunca leva o indicador (E0712); os demais, indTotTrib 0 sem percentual", () => {
    assert.equal(tag(xml, "pTotTribSN"), "0.00");
    assert.doesNotMatch(xml, /<indTotTrib>/);
    assert.equal(tag(buildDps(sampleRps(), { ...context, simplesOption: 1 }), "indTotTrib"), "0");
    const withRate = sampleRps({
      profile: { approximateTaxes: { simplesNacional: 6 } },
    });
    const other = buildDps(withRate, context);
    assert.equal(tag(other, "pTotTribSN"), "6.00");
    assert.doesNotMatch(other, /<indTotTrib>/);
    // não optante nunca usa o percentual do Simples
    assert.equal(tag(buildDps(withRate, { ...context, simplesOption: 1 }), "indTotTrib"), "0");
  });

  it("traduz o regime especial do ABRASF", () => {
    const of = (specialTaxRegime: number) =>
      tag(buildDps(sampleRps({ profile: { specialTaxRegime } }), context), "regEspTrib");
    assert.equal(of(1), "3");
    assert.equal(of(4), "1");
    assert.equal(of(6), "0");
  });
});

describe("buildCancellationEvent", () => {
  const accessKey = "35525021237969249000110000000000058026090101823674";
  const input = {
    environment: 1 as const,
    cnpj: PROVIDER_CNPJ,
    accessKey,
    reason: 1 as const,
    justification: "  Valor informado errado  ",
    eventDate: new Date("2026-10-06T15:00:00Z"),
  };

  it("monta o pedido do evento 101101", () => {
    const xml = buildCancellationEvent(input);
    assert.match(xml, new RegExp(`<infPedReg Id="PRE${accessKey}101101">`));
    assert.equal(`PRE${accessKey}101101`.length, 59);
    assert.equal(tag(xml, "tpAmb"), "1");
    assert.equal(tag(xml, "CNPJAutor"), PROVIDER_CNPJ);
    assert.equal(tag(xml, "chNFSe"), accessKey);
    assert.equal(tag(xml, "xDesc"), "Cancelamento de NFS-e");
    assert.equal(tag(xml, "cMotivo"), "1");
    assert.equal(tag(xml, "xMotivo"), "Valor informado errado");
  });

  it("exige justificativa de 15 a 255 caracteres", () => {
    assert.throws(() => buildCancellationEvent({ ...input, justification: "curta" }), /15 a 255/);
    assert.throws(
      () => buildCancellationEvent({ ...input, justification: "x".repeat(256) }),
      /15 a 255/,
    );
    assert.doesNotThrow(() => buildCancellationEvent({ ...input, justification: "x".repeat(255) }));
  });
});

describe("parseNationalNfse", () => {
  const xml = readFileSync(new URL("./fixtures/national-nfse.xml", import.meta.url), "utf8");
  const nfse = parseNationalNfse(xml);

  it("lê chave, número e situação", () => {
    assert.equal(nfse.accessKey, "35525021237969249000110000000000058126100000000001");
    assert.equal(nfse.number, "581");
    assert.equal(nfse.documentNumber, "12345");
    assert.equal(nfse.status, "100");
    assert.equal(nfse.processedAt, "2026-10-06T10:00:00-03:00");
    assert.equal(nfse.competence, "2026-10-06");
    assert.equal(nfse.issuingCity, "SUZANO");
  });

  it("separa emitente de tomador", () => {
    assert.equal(nfse.issuerCnpj, PROVIDER_CNPJ);
    assert.equal(nfse.issuerName, "EMPRESA TESTE LTDA");
    assert.equal(nfse.takerTaxId, "52884617000110");
    assert.equal(nfse.takerName, "Cliente & Filhos Ltda");
  });

  it("converte valores para número", () => {
    assert.equal(nfse.serviceAmount, 1500);
    assert.equal(nfse.netAmount, 1500);
    assert.equal(nfse.description, "Desenvolvimento de software");
    assert.equal(nfse.xml, xml);
  });

  it("não quebra com XML sem os campos", () => {
    const empty = parseNationalNfse("<NFSe/>");
    assert.equal(empty.accessKey, "");
    assert.equal(empty.number, undefined);
    assert.equal(empty.serviceAmount, undefined);
  });
});

describe("buildDps — o que ainda não é suportado", () => {
  it("intermediário, obra e substituição", () => {
    const base = sampleRps();
    const cases = [
      { ...base, intermediary: { legalName: "X", cnpj: "1", cityCode: SUZANO } },
      { ...base, construction: { workCode: "1" } },
      { ...base, replacedRps: { number: 1, series: "A" } },
    ];
    for (const rps of cases) {
      assert.throws(() => buildDps(rps, context), NotSupportedError);
    }
  });

  it("lista tudo o que falta de uma vez", () => {
    const base = sampleRps();
    assert.throws(
      () => buildDps({ ...base, construction: { workCode: "1" }, replacedRps: { number: 1, series: "A" } }, context),
      (error: unknown) =>
        error instanceof NotSupportedError &&
        Array.isArray(error.details["unsupported"]) &&
        (error.details["unsupported"] as string[]).length === 2,
    );
  });

  it("erros de entrada são ValidationError", () => {
    assert.throws(() => nationalTaxCode("x"), ValidationError);
  });
});


describe("eventos distribuídos pelo ADN", () => {
  const key = "35525021237969249000110000000000052926030000000004";
  const replacement = "35525021237969249000110000000000053026030000000004";
  const xml =
    `<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infEvento Id="EVT${key}105102001">` +
    `<dhProc>2026-03-02T19:52:05-03:00</dhProc><pedRegEvento versao="1.00"><infPedReg Id="PRE${key}105102">` +
    `<dhEvento>2026-03-25T13:28:22-03:00</dhEvento><CNPJAutor>${PROVIDER_CNPJ}</CNPJAutor><chNFSe>${key}</chNFSe>` +
    `<e105102><xDesc>Cancelamento de NFS-e por Substituição</xDesc><cMotivo>99</cMotivo>` +
    `<xMotivo>NFS-e substituida pelo emissor</xMotivo><chSubstituta>${replacement}</chSubstituta></e105102>` +
    `</infPedReg></pedRegEvento></infEvento></evento>`;

  it("lê tipo, nota, substituta e datas", () => {
    const event = parseNationalEvent(xml);
    assert.equal(event.code, "105102");
    assert.equal(event.description, "Cancelamento de NFS-e por Substituição");
    assert.equal(event.accessKey, key);
    assert.equal(event.nfseNumber, "529");
    assert.equal(event.replacementKey, replacement);
    assert.equal(event.reason, "NFS-e substituida pelo emissor");
    assert.equal(event.requestedAt, "2026-03-25T13:28:22-03:00");
    assert.equal(event.processedAt, "2026-03-02T19:52:05-03:00");
  });

  it("número da nota sai da chave; chave inválida não inventa número", () => {
    assert.equal(nfseNumberFromKey(replacement), "530");
    assert.equal(nfseNumberFromKey("123"), undefined);
  });
});

describe("buildDps — tomador no exterior e comExt", () => {
  const trade: ForeignTrade = {
    serviceMode: "1",
    relationship: "0",
    currency: "220",
    foreignAmount: 1000,
    providerSupport: "01",
    takerSupport: "01",
    temporaryGoods: "1",
    exportRegistration: "123456789012",
    shareWithMdic: "0",
  };
  const abroad = {
    nif: "98-7654321",
    legalName: "Acme Inc",
    foreignAddress: {
      countryCode: "0840",
      countryIso: "US",
      fullAddress: "100 Main St, Suite 4",
      postalCode: "10001",
      city: "New York",
      region: "NY",
    },
  };
  const exported = () => {
    const base = sampleRps({ taker: abroad });
    return { ...base, service: { ...base.service, issTaxability: 4, foreignTrade: trade } };
  };

  it("monta o comExt na ordem do XSD, depois do cServ", () => {
    const xml = buildDps(exported(), context);
    assert.match(
      xml,
      /<\/cServ><comExt><mdPrestacao>1<\/mdPrestacao><vincPrest>0<\/vincPrest><tpMoeda>220<\/tpMoeda><vServMoeda>1000\.00<\/vServMoeda><mecAFComexP>01<\/mecAFComexP><mecAFComexT>01<\/mecAFComexT><movTempBens>1<\/movTempBens><nRE>123456789012<\/nRE><mdic>0<\/mdic><\/comExt><infoCompl>|<\/cServ><comExt>/,
    );
    assert.equal(tag(xml, "nDI"), undefined);
    assert.equal(tag(xml, "tribISSQN"), "3", "exportação de serviço");
  });

  it("tomador estrangeiro leva NIF e endExt em ISO de 2 letras", () => {
    const xml = buildDps(exported(), context);
    assert.equal(tag(xml, "NIF"), "98-7654321");
    assert.equal(tag(xml, "cPais"), "US");
    assert.equal(tag(xml, "xCidade"), "New York");
    assert.doesNotMatch(xml, /<CNPJ>(?!37969249000110)/);
    assert.doesNotMatch(xml, /<endNac>/);
  });

  it("DPS completa valida contra o XSD nacional", () => {
    const result = validateAgainstSchema(buildDps(exported(), { ...context, environment: 1 }), "DPS_v1.01.xsd", SCHEMA_DIRECTORIES.national);
    if (result === null) return; // sem xmllint
    assert.deepEqual(result.errors, []);
  });

  it("sem NIF, o motivo vai em cNaoNIF", () => {
    const { nif, ...noNif } = abroad;
    void nif;
    const base = sampleRps({ taker: { ...noNif, nifAbsentReason: 1 } });
    const xml = buildDps({ ...base, service: { ...base.service, issTaxability: 4, foreignTrade: trade } }, context);
    assert.equal(tag(xml, "cNaoNIF"), "1");
    assert.equal(tag(xml, "NIF"), undefined);
  });

  it("número e bairro do endereço têm substitutos e podem ser informados", () => {
    const xml = buildDps(exported(), context);
    assert.match(xml, /<xLgr>100 Main St, Suite 4<\/xLgr><nro>S\/N<\/nro><xBairro>New York<\/xBairro>/);
    const base = sampleRps({ taker: { ...abroad, foreignAddress: { ...abroad.foreignAddress, number: "100", district: "Midtown" } } });
    assert.match(buildDps(base, context), /<nro>100<\/nro><xBairro>Midtown<\/xBairro>/);
  });

  const invalid: [string, object, RegExp][] = [
    ["sem o país em ISO", { foreignAddress: { ...abroad.foreignAddress, countryIso: undefined } }, /ISO de 2 letras/],
    ["país em minúsculas", { foreignAddress: { ...abroad.foreignAddress, countryIso: "us" } }, /ISO de 2 letras/],
    ["sem NIF e sem motivo", { nif: undefined }, /nif.*nifAbsentReason/],
    ["com CNPJ", { cnpj: "37969249000110" }, /não tem CNPJ nem CPF/],
    ["com endereço do Brasil", { address: { street: "R", number: "1", district: "B", cityCode: SUZANO, state: "SP", zipCode: "08600000" } }, /foreignAddress/],
    ["só NIF, sem endereço", { foreignAddress: undefined }, /precisa do `foreignAddress`/],
  ];
  for (const [name, change, pattern] of invalid) {
    it(`recusa tomador estrangeiro ${name}`, () => {
      assert.throws(
        () => buildDps(sampleRps({ taker: { ...abroad, ...change } as never }), context),
        (error: unknown) => error instanceof ValidationError && pattern.test(error.message),
      );
    });
  }
});
