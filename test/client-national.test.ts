import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NfseClient, type NationalInvoiceInput } from "../src/index.ts";
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
