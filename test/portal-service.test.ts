import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ConfigError, PortalError, ValidationError } from "../src/domain/errors.ts";
import { PortalService } from "../src/providers/giss/portal-service.ts";
import { testPfx } from "./helpers.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CITY = "3552502";
const jwt = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** `fetch` falso: a rota mais específica (maior prefixo de "MÉTODO caminho") responde. */
function portal(routes: Record<string, (call: Call, nth: number) => Response>) {
  const calls: Call[] = [];
  const count = new Map<string, number>();
  globalThis.fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init.method ?? "GET",
      path: url.pathname + url.search,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const key = Object.keys(routes)
      .filter((k) => `${call.method} ${call.path}`.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`Rota não prevista no teste: ${call.method} ${call.path}`);
    const nth = (count.get(key) ?? 0) + 1;
    count.set(key, nth);
    return routes[key]!(call, nth);
  }) as typeof fetch;
  return calls;
}

const company = {
  documento: "37969249000110",
  razaoSocial: "EMPRESA TESTE",
  inscricaoMunicipal: "53624",
  idEmpresa: 7,
  idCliente: 3,
  clienteReferencia: "ref-3",
  tipoEmpresa: 1,
};

/** As rotas do login em três passos, comuns a qualquer sessão. */
const login = (tokens: { final?: () => Response } = {}) => ({
  "POST /service-empresa/api/login/token": (call: Call) =>
    call.headers.PARAM_LOGIN
      ? (tokens.final ?? (() => json({ access_token: "final-token" })))()
      : json({ access_token: "initial-token", codigo_usuario: "99" }),
  "GET /service-empresa/api/login/permissao": () =>
    json({ conteudo: { codigoUsuario: "99", empresas: [company, { ...company, documento: "11111111000111", idEmpresa: 8 }] } }),
});

const credentials = { login: "123.456.789-09", password: "senha", cityCode: CITY };

describe("PortalService.authenticate", () => {
  it("login por senha em três passos, na primeira empresa", async () => {
    const calls = portal(login());
    const session = (await PortalService.authenticate(credentials)).session;
    assert.equal(session.token, "final-token");
    assert.equal(session.companyId, 7);
    assert.equal(session.legalName, "EMPRESA TESTE");
    assert.equal(calls.length, 3);
    assert.match(calls[0]!.body!, /grant_type=password/);
    assert.match(calls[0]!.body!, /username=12345678909/);
    assert.equal(calls[2]!.headers.PARAM_PRIV, "empresa=7");
  });

  it("escolhe a empresa pelo CNPJ e recusa um CNPJ que não está vinculado", async () => {
    portal(login());
    const second = await PortalService.authenticate({ ...credentials, cnpj: "11.111.111/0001-11" });
    assert.equal(second.session.companyId, 8);
    await assert.rejects(PortalService.authenticate({ ...credentials, cnpj: "00000000000000" }), ConfigError);
  });

  it("login pelo certificado: assina o nonce e troca pelo token", async () => {
    const calls = portal({
      ...login(),
      "GET /service-empresa/api/login/certificado/nonce": () =>
        json({ conteudo: Buffer.from("nonce-bytes").toString("base64") }),
      "POST /service-empresa/api/login/certificado/token": () =>
        json({ conteudo: { access_token: jwt({ CODIGO_USUARIO: "99" }) } }),
    });
    const session = (
      await PortalService.authenticate({
        certificate: testPfx("segredo"),
        certificatePassword: "segredo",
        cityCode: CITY,
      })
    ).session;
    assert.equal(session.userCode, "99");
    const exchange = JSON.parse(calls.find((c) => c.path.endsWith("certificado/token"))!.body!);
    assert.ok(exchange.signature.length > 100);
    assert.equal(exchange.nonce, Buffer.from("nonce-bytes").toString("base64"));
  });

  it("senha recusada vira PortalError com o status", async () => {
    portal({ "POST /service-empresa/api/login/token": () => json({ mensagem: "inválido" }, 401) });
    await assert.rejects(PortalService.authenticate(credentials), (e: PortalError) => e instanceof PortalError && e.status === 401);
  });
});

describe("PortalService — sessão e cadastro", () => {
  const open = async (extra: Record<string, (call: Call, nth: number) => Response> = {}) => {
    const calls = portal({ ...login(), ...extra });
    const service = await PortalService.authenticate(credentials);
    calls.length = 0;
    return { service, calls };
  };

  it("401 no meio do uso refaz o login uma vez e repete a chamada", async () => {
    const { service, calls } = await open({
      "GET /service-empresa/api/cliente-fornecedor/cliente/": (_c, nth) =>
        nth === 1 ? json({}, 401) : json({ conteudo: [{ documento: "52884617000110", tipo: 1 }] }),
    });
    const parties = await service.list();
    assert.equal(parties.length, 1);
    assert.ok(calls.filter((c) => c.path.includes("/login/")).length >= 3, "refez o login");
  });

  it("um 401 que persiste depois do novo login é erro", async () => {
    const { service } = await open({
      "GET /service-empresa/api/cliente-fornecedor/cliente/": () => json({}, 401),
    });
    await assert.rejects(service.list(), PortalError);
  });

  it("list filtra pelo papel e findByTaxId procura pelos dígitos", async () => {
    const { service } = await open({
      "GET /service-empresa/api/cliente-fornecedor/cliente/3/empresa/7/tipo/1": () =>
        json({ conteudo: [
          { documento: "52884617000110", tipo: 1, razaoSocial: "Cliente" },
          { documento: "60977243000106", tipo: 2, razaoSocial: "Fornecedor" },
        ] }),
    });
    assert.equal((await service.list(2)).length, 1);
    assert.equal((await service.findByTaxId("52.884.617/0001-10"))?.razaoSocial, "Cliente");
    assert.equal(await service.findByTaxId("52.884.617/0001-10", 2), undefined);
  });

  it("update marca alterado no cadastro e nos grupos, e exige o id", async () => {
    const { service, calls } = await open({
      "PUT /service-empresa/api/cliente-fornecedor/": () => json({ conteudo: { id: 5 } }),
    });
    await assert.rejects(service.update({ documento: "1" } as never), ValidationError);
    await service.update({ id: 5, documento: "1", endereco: { logradouro: "Rua" }, email: { email: "a@b.c" } } as never);
    const sent = JSON.parse(calls.at(-1)!.body!);
    assert.equal(sent.alterado, true);
    assert.equal(sent.endereco.alterado, true);
    assert.equal(sent.email.alterado, true);
  });

  it("create envia o cadastro; remove desativa", async () => {
    const { service, calls } = await open({
      "POST /service-empresa/api/cliente-fornecedor/": () => json({ conteudo: { id: 9 } }),
      "PUT /service-empresa/api/cliente-fornecedor/anula": () => json({ conteudo: null }),
    });
    assert.equal((await service.create({ documento: "1" } as never)).id, 9);
    await service.remove({ id: 9, documento: "1" } as never);
    assert.equal(JSON.parse(calls.at(-1)!.body!).ativo, false);
  });

  it("cityName acha o município pelo código IBGE na lista da UF", async () => {
    const { service } = await open({
      "GET /service-objetos-compartilhados/api/municipio-ibge/listar/35": () =>
        json({ conteudo: [{ idMunicipioIbge: 3552502, municipio: "SUZANO" }] }),
    });
    assert.equal(await service.cityName(CITY), "SUZANO");
    await assert.rejects(service.cityName(3500000), ValidationError);
  });

  it("companyActivities recusa resposta sem lista e devolve a lista válida", async () => {
    let valid = false;
    const { service } = await open({
      "GET /service-atividade/api/atividade/servicos/enquadrados/aliquotas/3/7/": () =>
        valid ? json({ conteudo: [{ codigo: "6319400", descricao: "Portais" }] }) : json({ sucesso: false }),
    });
    await assert.rejects(service.companyActivities("2026-11-13"), PortalError);
    valid = true;
    assert.equal((await service.companyActivities("2026-11-13")).length, 1);
  });

  it("renew troca a sessão", async () => {
    const { service } = await open();
    const before = service.session.token;
    const renewed = await service.renew();
    assert.equal(renewed.token, "final-token");
    assert.equal(before, "final-token");
  });
});

describe("PortalService — documentos e Fale Conosco", () => {
  const open = async (extra: Record<string, (call: Call, nth: number) => Response>) => {
    const calls = portal({ ...login(), ...extra });
    const service = await PortalService.authenticate(credentials);
    calls.length = 0;
    return { service, calls };
  };

  it("invoiceDocument baixa o PDF e recusa um erro com HTTP 200", async () => {
    let ok = true;
    const { service } = await open({
      "GET /service-relatorio/api/relatorio/pdf/3/nota/": () =>
        ok
          ? new Response(Buffer.from("%PDF-1.4"), { headers: { "content-type": "application/pdf" } })
          : json({ mensagem: "erro" }),
    });
    assert.equal((await service.invoiceDocument("123")).subarray(0, 5).toString(), "%PDF-");
    ok = false;
    await assert.rejects(service.invoiceDocument("123"), PortalError);
  });

  it("lista, lê, conta e marca mensagens", async () => {
    const raw = { id: 10, titulo: "Dúvida", mensagem: "texto", dataDeEnvio: "2026-11-01", lida: false, respondida: true, resposta: "ok", anexos: [{ id: 1, nomesArquivos: "a.pdf", ehAnexoAuditor: true }] };
    const { service, calls } = await open({
      "GET /service-empresa/api/fale-conosco/listar-por-usuario/99": () => json({ conteudo: [raw] }),
      "GET /service-empresa/api/fale-conosco/buscar/10": () => json({ conteudo: raw }),
      "GET /service-empresa/api/fale-conosco/contar-nao-lidas/99": () => json({ conteudo: 2 }),
      "PUT /service-empresa/api/fale-conosco/marcar-como-lida/10": () => json({ conteudo: null }),
    });
    const [message] = await service.listMessages();
    assert.equal(message!.subject, "Dúvida");
    assert.equal(message!.answer, "ok");
    assert.equal(message!.attachments[0]!.fromAuditor, true);
    assert.equal((await service.getMessage(10)).id, 10);
    assert.equal(await service.unreadMessages(), 2);
    await service.markMessageAsRead(10);
    assert.equal(calls.at(-1)!.method, "PUT");
  });

  it("sendMessage monta o corpo com usuário, empresa e contato", async () => {
    const { service, calls } = await open({
      "POST /service-empresa/api/fale-conosco/": () => json({ conteudo: null }),
    });
    await service.sendMessage({ subject: "Assunto", body: "Corpo", contact: { name: "Caio", email: "c@x.com" } });
    const sent = JSON.parse(calls.at(-1)!.body!);
    assert.equal(sent.titulo, "Assunto");
    assert.equal(sent.usuario.id, 99);
    assert.equal(sent.empresa.idEmpresa, 7);
    assert.equal(sent.nomeContato, "Caio");
    assert.equal(sent.telefoneContato, undefined);
  });

  it("messageAttachment baixa o arquivo binário", async () => {
    const { service } = await open({
      "GET /service-empresa/api/fale-conosco/download?idMensagem=10&idAnexo=1": () =>
        new Response(Buffer.from("conteudo"), { headers: { "content-type": "application/octet-stream" } }),
    });
    assert.equal((await service.messageAttachment(10, 1)).toString(), "conteudo");
  });
});
