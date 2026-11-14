import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NfseClient, PortalError, PortalService, callSoap, type SoapExchange } from "../src/index.ts";
import { readSoapResponse } from "../src/providers/giss/soap-client.ts";
import { PROVIDER_CNPJ, testPfx } from "./helpers.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("PortalService.listActivities", () => {
  it("devolve a lista quando ela vem", async () => {
    globalThis.fetch = (async () =>
      json({ conteudo: [{ codigo: "6319400", descricao: "Portais" }] })) as typeof fetch;
    const list = await PortalService.listActivities("3552502");
    assert.equal(list.length, 1);
  });

  it("resposta sem a lista é erro, não lista vazia", async () => {
    globalThis.fetch = (async () => json({ mensagem: "algo deu errado" })) as typeof fetch;
    await assert.rejects(PortalService.listActivities("3552502"), PortalError);
  });

  it("sucesso:false é erro mesmo com uma lista presente", async () => {
    globalThis.fetch = (async () => json({ sucesso: false, conteudo: [], mensagem: "negado" })) as typeof fetch;
    await assert.rejects(PortalService.listActivities("3552502"), PortalError);
  });

  it("o tempo limite é configurável e vira erro de timeout", async () => {
    globalThis.fetch = ((_url: unknown, init: RequestInit) =>
      new Promise((_, reject) => {
        // AbortSignal.timeout não segura o event loop; sem este timer o Node 22 encerra o teste
        const keepAlive = setTimeout(() => {}, 5000);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        });
      })) as typeof fetch;
    const started = Date.now();
    await assert.rejects(PortalService.listActivities("3552502", undefined, 30), /30ms/);
    assert.ok(Date.now() - started < 5000);
  });
});

describe("NfseClient — onExchange", () => {
  const client = (onExchange: (e: SoapExchange) => void) =>
    new NfseClient({
      environment: "producao",
      city: "suzano",
      cnpj: PROVIDER_CNPJ,
      municipalRegistration: "53624",
      host: "https://127.0.0.1:1",
      certificate: testPfx("segredo"),
      certificatePassword: "segredo",
      onExchange,
    });

  it("entrega o envio assinado e o erro de rede, e relança o erro", async () => {
    const seen: SoapExchange[] = [];
    await assert.rejects(client((e) => seen.push(e)).nfse.queryProvidedServices({ issuePeriod: { from: "2026-11-01", to: "2026-11-30" } }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.service, "nfse");
    assert.match(seen[0]!.request, /<Signature/);
    assert.ok(seen[0]!.error);
    assert.equal(seen[0]!.response, undefined);
  });

  it("um observador que lança não muda o resultado", async () => {
    const error = await client(() => {
      throw new Error("observador quebrado");
    })
      .nfse.queryProvidedServices({ issuePeriod: { from: "2026-11-01", to: "2026-11-30" } })
      .catch((e: Error) => e);
    assert.doesNotMatch(String((error as Error).message), /observador quebrado/);
  });
});

describe("SOAP — o envelope bruto acompanha o erro", () => {
  const fault =
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>falhou</faultstring></soap:Fault></soap:Body></soap:Envelope>';

  it("SOAP Fault leva o envelope em details", () => {
    try {
      readSoapResponse("GerarNfse", 500, fault);
      assert.fail("deveria lançar");
    } catch (error) {
      const { details } = error as { details: Record<string, unknown> };
      assert.equal(details.envelope, fault);
      assert.equal(details.status, 500);
    }
  });

  it("HTTP 5xx com HTML (UNAVAILABLE) também leva o corpo", () => {
    try {
      readSoapResponse("GerarNfse", 503, "<html>fora do ar</html>");
      assert.fail("deveria lançar");
    } catch (error) {
      const e = error as { code: string; details: Record<string, unknown> };
      assert.equal(e.code, "UNAVAILABLE");
      assert.equal(e.details.envelope, "<html>fora do ar</html>");
    }
  });

  it("callSoap é exportado para quem embrulha o transporte", () => {
    assert.equal(typeof callSoap, "function");
  });
});
