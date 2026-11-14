/**
 * Testes de contrato: falam com o ambiente de homologação nacional de verdade
 * (`producaorestrita`), com o seu certificado A1. Só leitura — nada é emitido.
 *
 * Ficam fora do `npm test` e do CI padrão porque dependem do certificado e do
 * serviço do governo estar no ar. Rodam com `npm run test:contract`, ou pelo
 * workflow manual `contract.yml`. Sem `CERT_PATH` e `CERT_PASSWORD`, tudo é pulado.
 *
 * O que se confere aqui é o formato da resposta, não valores: é o que quebra
 * quando a SEFIN/ADN muda o contrato e os testes com mock continuam verdes.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { NfseClient } from "../../src/index.ts";

const configured = Boolean(process.env.CERT_PATH && process.env.CERT_PASSWORD);
const SUZANO = "3552502";

describe("contrato — ambiente nacional de homologação", { skip: !configured && "sem CERT_PATH/CERT_PASSWORD" }, () => {
  let client: NfseClient;
  before(() => {
    client = new NfseClient({ environment: "homologacao" });
  });

  it("convênio do município devolve as flags de adesão", async () => {
    const agreement = await client.national.agreement(SUZANO);
    assert.equal(typeof agreement.sharesWithNational, "boolean");
    assert.equal(typeof agreement.usesNationalIssuer, "boolean");
    assert.ok(Object.keys(agreement.raw).length > 0, "resposta sem parametrosConvenio");
  });

  it("alíquota: o município parametrizado devolve uma lista, o resto devolve null", async () => {
    const rates = await client.national.serviceRates("01.09.02.001", new Date(), SUZANO);
    assert.ok(rates === null || (Array.isArray(rates) && rates.every((r) => typeof r.rate === "number")));
    assert.equal(await client.national.serviceRates("99.99.99.999", new Date(), SUZANO), null);
  });

  it("DPS que nunca foi enviada: findByDps devolve null, não erro", async () => {
    const cnpj = client.config.cnpj.padStart(14, "0");
    const id = `DPS${SUZANO}2${cnpj}99999999999999999999`;
    assert.equal(id.length, 45);
    assert.equal(await client.national.findByDps(id), null);
  });

  it("distribuição: a consulta pelo CNPJ do certificado responde sem rejeição", async () => {
    // Em produção o ADN rejeitava (400 REJEICAO, sem mensagem) a consulta sem cnpjConsulta.
    const documents = await client.national.distribution(0);
    assert.ok(Array.isArray(documents));
  });

  it("chave inexistente vira NationalError com o código HTTP", async () => {
    await assert.rejects(client.national.get("0".repeat(50)), (error: { name?: string; status?: number }) => {
      return error.name === "NationalError" && typeof error.status === "number";
    });
  });
});
