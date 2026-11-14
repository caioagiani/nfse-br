import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NfseClient, NfseError, type NationalInvoiceInput } from "../src/index.ts";
import { PROVIDER_CNPJ, testPfx } from "./helpers.ts";

const taker = {
  cnpj: "52884617000110",
  legalName: "Cliente Teste Ltda",
  address: { street: "Rua A", number: "10", district: "Centro", cityCode: "3552502", state: "SP", zipCode: "08600000" },
};
const invoice = (extra: Partial<NationalInvoiceInput> = {}): NationalInvoiceInput => ({
  number: 7,
  taker,
  serviceAmount: 550,
  description: "Recarga de conta",
  ...extra,
});

const client = (profile = {}) =>
  new NfseClient({
    environment: "producao",
    city: "suzano",
    cnpj: PROVIDER_CNPJ,
    municipalRegistration: "53624",
    certificate: testPfx("segredo"),
    certificatePassword: "segredo",
    profile,
  });

describe("NfseClient — emissão nacional", () => {
  it("previewIssue monta e assina a DPS só com os dados da nota, sem alíquota", () => {
    const xml = client().previewIssue(invoice());
    assert.match(xml, /<DPS [^>]*xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse"/);
    assert.match(xml, new RegExp(`Id="DPS35525022${PROVIDER_CNPJ}00001000000000000007"`));
    assert.match(xml, /<opSimpNac>3<\/opSimpNac>/);
    assert.doesNotMatch(xml, /<pAliq>/);
  });

  it("o profile do client define o serviço de todas as notas", () => {
    const xml = client({ serviceListItem: "01.09.02", nbsCode: "117031000" }).previewIssue(invoice());
    assert.match(xml, /<cTribNac>010902<\/cTribNac>/);
    assert.match(xml, /<cNBS>117031000<\/cNBS>/);
  });

  it("série da nota vence a do perfil, que vence o padrão", () => {
    assert.match(client().previewIssue(invoice()), /<serie>1<\/serie>/);
    assert.match(client({ nationalSeries: "3" }).previewIssue(invoice()), /<serie>3<\/serie>/);
    assert.match(client({ nationalSeries: "3" }).previewIssue(invoice({ series: "9" })), /<serie>9<\/serie>/);
  });

  it("quem não é do Simples continua exigindo a alíquota", () => {
    assert.throws(() => client({ simplesNacionalOptant: 2 }).previewIssue(invoice()), /alíquota/i);
  });

  it("issue e cancel passam pelo serviço nacional", async () => {
    const c = client();
    const calls: unknown[][] = [];
    c.national.issue = (async (...args: unknown[]) => (calls.push(["issue", ...args]), { status: "issued" })) as never;
    c.national.cancel = (async (...args: unknown[]) => (calls.push(["cancel", ...args]), "ok")) as never;

    await c.issue(invoice({ number: 9 }));
    await c.cancel("K".repeat(50), 1, "Erro na emissao do servico");

    assert.equal(calls[0]![0], "issue");
    assert.deepEqual(calls[0]![2], { number: 9, series: "1", simplesOption: 3, simplesApportionment: undefined });
    assert.deepEqual(calls[1], ["cancel", "K".repeat(50), 1, "Erro na emissao do servico"]);
  });
});

describe("NfseClient — endereços do nacional", () => {
  it("usa os oficiais do ambiente por padrão", () => {
    assert.equal(client().national.hosts.sefin, "https://sefin.nfse.gov.br/SefinNacional");
  });

  it("nationalHosts troca a SEFIN e o ADN", () => {
    const custom = { sefin: "https://proxy.local/sefin", adn: "https://proxy.local/adn" };
    const proxied = new NfseClient({
      environment: "producao",
      city: "suzano",
      cnpj: PROVIDER_CNPJ,
      municipalRegistration: "53624",
      certificate: testPfx("segredo"),
      certificatePassword: "segredo",
      nationalHosts: custom,
    });
    assert.deepEqual(proxied.national.hosts, custom);
  });
});

describe("NfseClient — issueMany", () => {
  const outcome = (n: number) => ({ status: "issued", dpsId: `DPS${n}`, nfse: { n }, alerts: [] });
  const withIssue = (impl: (number: number) => Promise<unknown>) => {
    const c = client();
    c.national.issue = ((_rps: unknown, dps: { number: number }) => impl(Number(dps.number))) as never;
    return c;
  };

  it("emite cada nota e devolve um resultado por posição", async () => {
    const c = withIssue(async (n) => outcome(n));
    const results = await c.issueMany([invoice({ number: 1 }), invoice({ number: 2 }), invoice({ number: 3 })], { concurrency: 2 });
    assert.deepEqual(results.map((r) => [r.index, r.status]), [[0, "issued"], [1, "issued"], [2, "issued"]]);
    assert.equal(results[2]!.input.number, 3);
  });

  it("uma nota que falha não impede as outras, e o erro vem no resultado", async () => {
    const c = withIssue(async (n) => {
      if (n === 2) throw new NfseError("recusada", { code: "REJECTED" });
      return outcome(n);
    });
    const results = await c.issueMany([invoice({ number: 1 }), invoice({ number: 2 }), invoice({ number: 3 })]);
    assert.deepEqual(results.map((r) => r.status), ["issued", "failed", "issued"]);
    assert.match(String((results[1] as { error: Error }).error), /recusada/);
  });

  it("falha passageira é repetida; a recusa definitiva não", async () => {
    const attempts: Record<number, number> = {};
    const c = withIssue(async (n) => {
      attempts[n] = (attempts[n] ?? 0) + 1;
      if (n === 1 && attempts[n]! < 3) throw new NfseError("rede", { code: "TRANSPORT", retryable: true });
      if (n === 2) throw new NfseError("recusada", { code: "REJECTED", retryable: false });
      return outcome(n);
    });
    const results = await c.issueMany([invoice({ number: 1 }), invoice({ number: 2 })], { retries: 2, retryDelayMs: 1 });
    assert.equal(attempts[1], 3);
    assert.equal(attempts[2], 1);
    assert.deepEqual(results.map((r) => r.status), ["issued", "failed"]);
  });

  it("esgotadas as tentativas, a falha vai para o resultado", async () => {
    const c = withIssue(async () => {
      throw new NfseError("rede", { code: "TRANSPORT", retryable: true });
    });
    const [result] = await c.issueMany([invoice()], { retries: 1, retryDelayMs: 1 });
    assert.equal(result!.status, "failed");
  });

  it("número de DPS repetido recusa a lista inteira antes de enviar qualquer nota", async () => {
    let sent = 0;
    const c = withIssue(async (n) => (sent++, outcome(n)));
    await assert.rejects(
      c.issueMany([invoice({ number: 1 }), invoice({ number: 2 }), invoice({ number: "0002" })]),
      /appears twice, at items 1 and 2/,
    );
    assert.equal(sent, 0);
  });

  it("série diferente não é duplicata", async () => {
    const c = withIssue(async (n) => outcome(n));
    const results = await c.issueMany([invoice({ number: 1, series: "1" }), invoice({ number: 1, series: "2" })]);
    assert.deepEqual(results.map((r) => r.status), ["issued", "issued"]);
  });

  it("nota inválida recusa a lista e diz qual item", async () => {
    let sent = 0;
    const c = client({ simplesNacionalOptant: 2 });
    c.national.issue = (async () => (sent++, outcome(1))) as never;
    await assert.rejects(
      c.issueMany([invoice({ number: 1, rate: 2 }), invoice({ number: 2 })]),
      (error: NfseError) => error.details["index"] === 1 && /alíquota/i.test(error.message),
    );
    assert.equal(sent, 0);
  });

  it("onProgress conta as notas concluídas", async () => {
    const c = withIssue(async (n) => outcome(n));
    const seen: Array<[number, number]> = [];
    await c.issueMany([invoice({ number: 1 }), invoice({ number: 2 })], { onProgress: (done, total) => void seen.push([done, total]) });
    assert.deepEqual(seen, [[1, 2], [2, 2]]);
  });

  it("repetir a lista depois de uma falha só emite o que faltou", async () => {
    const issued = new Set<number>();
    let failNext = true;
    const c = withIssue(async (n) => {
      if (issued.has(n)) return { ...outcome(n), status: "already-issued" };
      if (n === 2 && failNext) throw new NfseError("fora do ar", { code: "UNAVAILABLE" });
      issued.add(n);
      return outcome(n);
    });
    const list = [invoice({ number: 1 }), invoice({ number: 2 })];
    assert.deepEqual((await c.issueMany(list)).map((r) => r.status), ["issued", "failed"]);
    failNext = false;
    assert.deepEqual((await c.issueMany(list)).map((r) => r.status), ["already-issued", "issued"]);
  });
});

describe("NfseClient — exportação de serviço", () => {
  it("previewIssue monta o tomador estrangeiro e o comExt", () => {
    const xml = client({ issTaxability: 4 }).previewIssue(
      invoice({
        taker: {
          nif: "98-7654321",
          legalName: "Acme Inc",
          foreignAddress: {
            countryCode: "0840",
            countryIso: "US",
            fullAddress: "100 Main St",
            postalCode: "10001",
            city: "New York",
            region: "NY",
          },
        } as never,
        foreignTrade: {
          serviceMode: "1",
          relationship: "0",
          currency: "220",
          foreignAmount: 100,
          providerSupport: "01",
          takerSupport: "01",
          temporaryGoods: "1",
          shareWithMdic: "0",
        },
      }),
    );
    assert.match(xml, /<NIF>98-7654321<\/NIF>/);
    assert.match(xml, /<cPais>US<\/cPais>/);
    assert.match(xml, /<comExt><mdPrestacao>1<\/mdPrestacao>/);
    assert.match(xml, /<tribISSQN>3<\/tribISSQN>/);
  });
});

describe("NfseClient — replace", () => {
  it("emite a nota nova com a chave da antiga, o motivo e a justificativa", async () => {
    const c = client();
    const calls: unknown[][] = [];
    c.national.issue = (async (...args: unknown[]) => (calls.push(args), { status: "issued" })) as never;
    await c.replace("7".repeat(50), invoice({ number: 12 }), "02", "Enquadramento no Simples retroativo");
    const dps = calls[0]![1] as { number: number; replaces: unknown };
    assert.equal(dps.number, 12);
    assert.deepEqual(dps.replaces, {
      accessKey: "7".repeat(50),
      reason: "02",
      justification: "Enquadramento no Simples retroativo",
    });
  });
});
