import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TransportError, ValidationError } from "../src/domain/errors.ts";
import { LookupError, lookupCompany, lookupParty, lookupZip } from "../src/services/lookup-service.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** `fetch` falso por prefixo de rota; registra as URLs e os cabeçalhos. */
function brasilApi(routes: Record<string, () => Response>) {
  const seen: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    seen.push({ url: String(input), headers: init.headers as Record<string, string> });
    const key = Object.keys(routes).find((k) => String(input).includes(k));
    if (!key) throw new Error(`Rota não prevista: ${input}`);
    return routes[key]!();
  }) as typeof fetch;
  return seen;
}

const COMPANY = {
  razao_social: "L.A. MOTORS LTDA",
  nome_fantasia: "",
  logradouro: "",
  numero: "100",
  bairro: "CENTRO",
  cep: "08600000",
  municipio: "SUZANO",
  uf: "SP",
  codigo_municipio_ibge: 3552502,
  email: "a@b.com",
  ddd_telefone_1: "1140000000",
  descricao_situacao_cadastral: "ATIVA",
  opcao_pelo_simples: false,
};

describe("lookupZip", () => {
  it("resolve o CEP e se identifica com User-Agent", async () => {
    const seen = brasilApi({
      "/cep/v2/08600000": () => json({ cep: "08600000", street: "Rua A", neighborhood: "Centro", city: "Suzano", state: "SP" }),
    });
    const zip = await lookupZip("08.600-000");
    assert.deepEqual(zip, { zipCode: "08600000", street: "Rua A", district: "Centro", city: "Suzano", state: "SP" });
    assert.match(seen[0]!.headers["User-Agent"]!, /nfse-br/);
  });

  it("CEP com tamanho errado recusa antes de chamar a rede", async () => {
    const seen = brasilApi({});
    await assert.rejects(lookupZip("123"), ValidationError);
    assert.equal(seen.length, 0);
  });

  it("404, 429 e 5xx viram LookupError com mensagens distintas", async () => {
    for (const [status, pattern] of [[404, /not found/], [429, /rate limited/], [503, /HTTP 503/]] as const) {
      brasilApi({ "/cep/": () => json({}, status) });
      await assert.rejects(lookupZip("08600000"), (e: LookupError) => e instanceof LookupError && e.status === status && pattern.test(e.message));
    }
  });

  it("falha de rede é TransportError", async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    }) as typeof fetch;
    await assert.rejects(lookupZip("08600000"), TransportError);
  });
});

describe("lookupCompany", () => {
  it("lê a empresa; campo vazio vira undefined", async () => {
    brasilApi({ "/cnpj/v1/10966296000153": () => json(COMPANY) });
    const company = await lookupCompany("10.966.296/0001-53");
    assert.equal(company.legalName, "L.A. MOTORS LTDA");
    assert.equal(company.tradeName, undefined);
    assert.equal(company.street, undefined);
    assert.equal(company.cityCode, "3552502");
    assert.equal(company.simplesNacionalOptant, false);
  });

  it("CNPJ com tamanho errado recusa antes de chamar a rede", async () => {
    const seen = brasilApi({});
    await assert.rejects(lookupCompany("123"), ValidationError);
    assert.equal(seen.length, 0);
  });
});

describe("lookupParty", () => {
  it("completa a rua pelo CEP quando o cadastro da Receita veio sem ela", async () => {
    brasilApi({
      "/cnpj/v1/": () => json(COMPANY),
      "/cep/v2/08600000": () => json({ cep: "08600000", street: "Rua das Flores", neighborhood: "Vila", city: "Suzano", state: "SP" }),
    });
    const party = await lookupParty("10966296000153");
    assert.equal(party.street, "Rua das Flores");
    assert.equal(party.district, "CENTRO", "o bairro do cadastro vence o do CEP");
  });

  it("falha do CEP não derruba a consulta da empresa", async () => {
    brasilApi({ "/cnpj/v1/": () => json(COMPANY), "/cep/v2/": () => json({}, 500) });
    const party = await lookupParty("10966296000153");
    assert.equal(party.legalName, "L.A. MOTORS LTDA");
    assert.equal(party.street, undefined);
  });

  it("com rua no cadastro não consulta o CEP", async () => {
    const seen = brasilApi({ "/cnpj/v1/": () => json({ ...COMPANY, logradouro: "RUA X" }) });
    assert.equal((await lookupParty("10966296000153")).street, "RUA X");
    assert.equal(seen.length, 1);
  });
});
