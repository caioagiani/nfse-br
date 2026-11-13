import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NfseClient } from "../src/index.ts";
import { PROVIDER_CNPJ, sampleRps, testPfx } from "./helpers.ts";

const client = () =>
  new NfseClient({
    environment: "producao",
    city: "suzano",
    cnpj: PROVIDER_CNPJ,
    municipalRegistration: "53624",
    certificate: testPfx("segredo"),
    certificatePassword: "segredo",
  });

describe("NfseClient — emissão nacional como padrão", () => {
  it("previewIssue assina uma DPS nacional, série 1 e ME/EPP para optante do Simples", () => {
    const xml = client().previewIssue(sampleRps(), { number: 7 });
    assert.match(xml, /<DPS [^>]*xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse"/);
    assert.match(xml, new RegExp(`Id="DPS35525022${PROVIDER_CNPJ}`));
    assert.match(xml, /<serie>1<\/serie>/);
    assert.match(xml, /<nDPS>7<\/nDPS>/);
    assert.match(xml, /<opSimpNac>3<\/opSimpNac>/);
  });

  it("série e opção do Simples podem ser trocadas", () => {
    const xml = client().previewIssue(sampleRps(), { number: 8, series: "2", simplesOption: 1 });
    assert.match(xml, /<serie>2<\/serie>/);
    assert.match(xml, /<opSimpNac>1<\/opSimpNac>/);
  });

  it("undefined explícito não apaga o padrão", () => {
    const xml = client().previewIssue(sampleRps(), { number: 10, series: undefined, simplesOption: undefined });
    assert.match(xml, /<serie>1<\/serie>/);
    assert.match(xml, /<opSimpNac>3<\/opSimpNac>/);
  });

  it("issue e cancel passam pelo serviço nacional", async () => {
    const c = client();
    const calls: unknown[][] = [];
    c.national.issue = (async (...args: unknown[]) => (calls.push(["issue", ...args]), { status: "issued" })) as never;
    c.national.cancel = (async (...args: unknown[]) => (calls.push(["cancel", ...args]), "ok")) as never;

    await c.issue(sampleRps(), { number: 9 });
    await c.cancel("K".repeat(50), 1, "Erro na emissao do servico");

    assert.equal(calls[0]![0], "issue");
    assert.deepEqual(calls[0]![2], { series: "1", simplesOption: 3, number: 9 });
    assert.deepEqual(calls[1], ["cancel", "K".repeat(50), 1, "Erro na emissao do servico"]);
  });
});
