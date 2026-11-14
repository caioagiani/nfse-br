import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NationalError, ValidationError } from "../src/domain/errors.ts";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import { NATIONAL_HOSTS, NationalService, parameterServiceCode } from "../src/providers/nacional/national-service.ts";
import { fakeTransport, PROVIDER_CNPJ, SUZANO, testCertificate } from "./helpers.ts";

const { adn } = NATIONAL_HOSTS.producao;
const base = `${adn}/parametrizacao/${SUZANO}`;

function service(routes: Parameters<typeof fakeTransport>[0]) {
  const { transport, calls } = fakeTransport(routes);
  const certificate = testCertificate();
  const national = new NationalService({
    certificate,
    signer: createXmlSigner(certificate, "sha256"),
    environment: "producao",
    cnpj: PROVIDER_CNPJ,
    cityCode: SUZANO,
    transport,
  });
  return { national, calls };
}

describe("parameterServiceCode", () => {
  it("aceita com ou sem pontos e devolve o formato da API", () => {
    assert.equal(parameterServiceCode("010902001"), "01.09.02.001");
    assert.equal(parameterServiceCode("01.09.02.001"), "01.09.02.001");
  });

  it("recusa o que não tem nove dígitos, como a API (6 nacionais + 3 do município)", () => {
    assert.throws(() => parameterServiceCode("010902"), ValidationError);
    assert.throws(() => parameterServiceCode("1.09.02.001"), ValidationError);
  });
});

describe("NationalService — parâmetros municipais", () => {
  it("serviceRates lê a alíquota vigente na competência", async () => {
    const { national, calls } = service({
      [`${base}/01.09.02.001/2026-11-13/aliquota`]: () => ({
        json: {
          aliquotas: { "01.09.02.001": [{ Incidencia: "SIM", Aliq: 4, DtIni: "2025-12-04T00:00:00", DtFim: null }] },
        },
      }),
    });
    const rates = await national.serviceRates("010902001", "2026-11-13");
    assert.deepEqual(rates, [{ incidence: "SIM", rate: 4, from: "2025-12-04T00:00:00", to: undefined }]);
    assert.equal(calls.length, 1);
  });

  it("serviço não parametrizado (404) devolve null, não erro", async () => {
    const { national } = service({
      [`${base}/99.99.99.999/`]: () => ({ status: 404, json: { aliquotas: null, mensagem: "Alíquotas não encontradas." } }),
    });
    assert.equal(await national.serviceRates("999999999", "2026-11-13"), null);
  });

  it("outro erro HTTP continua sendo erro", async () => {
    const { national } = service({ [`${base}/`]: () => ({ status: 500, json: { mensagem: "falha" } }) });
    await assert.rejects(national.serviceRates("010902001", "2026-11-13"), NationalError);
  });

  it("serviceRateHistory e withholdings usam as rotas do swagger", async () => {
    const { national, calls } = service({
      [`${base}/01.09.02.001/historicoaliquotas`]: () => ({
        json: { aliquotas: { "01.09.02.001": [{ Incidencia: "SIM", Aliq: 3, DtIni: "2020-01-01T00:00:00", DtFim: "2025-12-03T00:00:00" }] } },
      }),
      [`${base}/2026-11-13/retencoes`]: () => ({ json: { retencoes: { artigoSexto: { habilitado: true } } } }),
    });
    const history = await national.serviceRateHistory("01.09.02.001");
    assert.equal(history?.[0]?.to, "2025-12-03T00:00:00");
    assert.deepEqual(await national.withholdings("2026-11-13"), { artigoSexto: { habilitado: true } });
    assert.equal(calls.length, 2);
  });

  it("specialRegimes achata os grupos e devolve null sem regime", async () => {
    const { national } = service({
      [`${base}/01.09.02.001/2026-11-13/regimes_especiais`]: () => ({
        json: { regimesEspeciais: { "01.09.02.001": { "1": [{ situacao: 2, dataInicio: "2025-01-01T00:00:00", dataFim: null, observacoes: "x" }] } } },
      }),
      [`${base}/01.04.01.001/`]: () => ({ status: 404, json: { regimesEspeciais: null } }),
    });
    assert.deepEqual(await national.specialRegimes("01.09.02.001", "2026-11-13"), [
      { status: 2, from: "2025-01-01T00:00:00", to: undefined, notes: "x" },
    ]);
    assert.equal(await national.specialRegimes("01.04.01.001", "2026-11-13"), null);
  });
});
