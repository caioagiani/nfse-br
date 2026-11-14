import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NationalError, NfseError, NotSupportedError, TransportError, ValidationError } from "../src/domain/errors.ts";
import { packXml, unpackXml } from "../src/providers/nacional/national-client.ts";
import { createXmlSigner } from "../src/infra/xml-signer.ts";
import { buildManifestationEvent } from "../src/providers/nacional/messages.ts";
import { NATIONAL_HOSTS, NationalService } from "../src/providers/nacional/national-service.ts";
import { SCHEMA_DIRECTORIES, validateAgainstSchema } from "../src/validation/schema-validator.ts";
import {
  fakeTransport,
  PROVIDER_CNPJ,
  SUZANO,
  sampleRps,
  testCertificate,
  type RecordedCall,
} from "./helpers.ts";

const NFSE_XML = readFileSync(new URL("./fixtures/national-nfse.xml", import.meta.url), "utf8");
const ACCESS_KEY = "35525021237969249000110000000000058126100000000001";
const DPS_ID = "DPS355250223796924900011000001000000000000007";
const { sefin, adn } = NATIONAL_HOSTS.homologacao;
const issueOptions = { series: "1", number: "7", simplesOption: 3 } as const;

function service(
  routes: Parameters<typeof fakeTransport>[0],
  environment: "producao" | "homologacao" = "homologacao",
) {
  const { transport, calls } = fakeTransport(routes);
  const certificate = testCertificate();
  const national = new NationalService({
    certificate,
    signer: createXmlSigner(certificate, "sha256"),
    environment,
    cnpj: PROVIDER_CNPJ,
    cityCode: SUZANO,
    transport,
  });
  return { national, calls };
}

const notFound = () => ({ status: 404, json: { erro: { codigo: "E2401" } } });
const html404 = () => ({ status: 404, body: Buffer.from("<html>not found</html>") });
const posted = (call: RecordedCall) => call.request.json as Record<string, string>;

describe("NationalService — hosts", () => {
  it("homologação aponta para a produção restrita", () => {
    const { national } = service({});
    assert.equal(national.environmentCode, 2);
    assert.match(national.hosts.sefin, /producaorestrita/);
  });

  it("produção aponta para os hosts oficiais", () => {
    const { national } = service({}, "producao");
    assert.equal(national.environmentCode, 1);
    assert.equal(national.hosts.sefin, "https://sefin.nfse.gov.br/SefinNacional");
    assert.equal(national.hosts.adn, "https://adn.nfse.gov.br");
  });
});

describe("NationalService.agreement", () => {
  it("lê as duas flags do convênio do município", async () => {
    const { national, calls } = service({
      [`${adn}/parametrizacao/${SUZANO}/convenio`]: () => ({
        json: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 0 } },
      }),
    });
    const agreement = await national.agreement();
    assert.equal(agreement.sharesWithNational, true);
    assert.equal(agreement.usesNationalIssuer, false);
    assert.equal(calls[0]?.request.certificate, testCertificate());
  });

  it("consulta outro município quando informado", async () => {
    const { national, calls } = service({
      [`${adn}/parametrizacao/3550308/convenio`]: () => ({
        json: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 1 } },
      }),
    });
    assert.equal((await national.agreement("3550308")).usesNationalIssuer, true);
    assert.equal(calls.length, 1);
  });
});

describe("NationalService.issue", () => {
  it("envia a DPS assinada, compactada, e devolve a nota", async () => {
    const { national, calls } = service({
      [`${sefin}/dps/`]: notFound,
      [`${sefin}/nfse`]: () => ({
        status: 201,
        json: {
          chaveAcesso: ACCESS_KEY,
          nfseXmlGZipB64: packXml(NFSE_XML),
          alertas: [{ Codigo: "A001", Descricao: "Alerta de teste" }],
        },
      }),
    });

    const outcome = await national.issue(sampleRps(), issueOptions);

    assert.equal(outcome.status, "issued");
    assert.equal(outcome.dpsId, DPS_ID);
    assert.equal(outcome.nfse.accessKey, ACCESS_KEY);
    assert.deepEqual(outcome.alerts, [{ code: "A001", message: "Alerta de teste", correction: undefined }]);

    assert.equal(calls[0]?.url, `${sefin}/dps/${DPS_ID}`);
    const send = calls[1]!;
    assert.equal(send.url, `${sefin}/nfse`);
    assert.equal(send.request.method, "POST");
    const dps = unpackXml(posted(send)["dpsXmlGZipB64"]!);
    assert.match(dps, /<tpAmb>2<\/tpAmb>/);
    assert.match(dps, /<\/infDPS><Signature /);
    assert.match(dps, /rsa-sha256/);
  });

  it("não reenvia uma DPS que já virou nota", async () => {
    const { national, calls } = service({
      [`${sefin}/dps/`]: () => ({ json: { chaveAcesso: ACCESS_KEY } }),
      [`${sefin}/nfse/${ACCESS_KEY}`]: () => ({ json: { nfseXmlGZipB64: packXml(NFSE_XML) } }),
    });

    const outcome = await national.issue(sampleRps(), issueOptions);

    assert.equal(outcome.status, "already-issued");
    assert.equal(outcome.nfse.number, "581");
    assert.ok(calls.every((c) => c.request.method !== "POST"));
  });

  it("transforma a recusa em NationalError com os códigos", async () => {
    const { national } = service({
      [`${sefin}/dps/`]: html404,
      [`${sefin}/nfse`]: () => ({
        status: 400,
        json: {
          idDPS: DPS_ID,
          erros: [{ Codigo: "E0039", Descricao: "Município não parametrizado", Complemento: "x" }],
        },
      }),
    });

    await assert.rejects(national.issue(sampleRps(), issueOptions), (error: unknown) => {
      assert.ok(error instanceof NationalError);
      assert.equal(error.status, 400);
      assert.deepEqual(error.messages, [
        { code: "E0039", message: "Município não parametrizado", correction: "x" },
      ]);
      assert.match(error.message, /\/SefinNacional\/nfse → HTTP 400: \[E0039\]/);
      return true;
    });
  });

  it("recusa resposta de sucesso sem a nota", async () => {
    const { national } = service({
      [`${sefin}/dps/`]: notFound,
      [`${sefin}/nfse`]: () => ({ status: 201, json: { chaveAcesso: ACCESS_KEY } }),
    });
    await assert.rejects(national.issue(sampleRps(), issueOptions), NationalError);
  });

  it("previewDps não toca a rede", () => {
    const { national, calls } = service({});
    const xml = national.previewDps(sampleRps(), issueOptions);
    assert.match(xml, new RegExp(`Id="${DPS_ID}"`));
    assert.equal(calls.length, 0);
  });
});

describe("NationalService.findByDps / get", () => {
  it("devolve null quando a DPS não existe", async () => {
    const { national } = service({ [`${sefin}/dps/`]: notFound });
    assert.equal(await national.findByDps(DPS_ID), null);
  });

  it("propaga erros que não são 404", async () => {
    const { national } = service({
      [`${sefin}/dps/`]: () => ({ status: 503, body: Buffer.from("Service Unavailable") }),
    });
    await assert.rejects(national.findByDps(DPS_ID), /HTTP 503: Service Unavailable/);
  });

  it("lê o erro no formato singular da consulta", async () => {
    const { national } = service({
      [`${sefin}/nfse/`]: () => ({
        status: 404,
        json: { erro: { codigo: "E2401", descricao: "Chave de acesso não encontrada." } },
      }),
    });
    await assert.rejects(national.get(ACCESS_KEY), (error: unknown) => {
      assert.ok(error instanceof NationalError);
      assert.equal(error.messages[0]?.code, "E2401");
      return true;
    });
  });

  it("recusa HTML onde se esperava JSON", async () => {
    const { national } = service({
      [`${sefin}/nfse/`]: () => ({ status: 200, body: Buffer.from("<html/>") }),
    });
    await assert.rejects(national.get(ACCESS_KEY), NationalError);
  });
});

describe("NationalService.pdf", () => {
  const lote = (...docs: Array<{ type: string; xml: string }>) => ({
    json: {
      StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
      LoteDFe: docs.map((d, i) => ({ NSU: i + 1, ChaveAcesso: ACCESS_KEY, TipoDocumento: d.type, ArquivoXml: packXml(d.xml) })),
    },
  });
  const replacement =
    `<evento xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento><pedRegEvento><infPedReg>` +
    `<chNFSe>${ACCESS_KEY}</chNFSe><e105102><xDesc>Cancelamento de NFS-e por Substituição</xDesc></e105102>` +
    `</infPedReg></pedRegEvento></infEvento></evento>`;

  it("gera o DANFSe localmente a partir da nota e dos eventos do ADN (a API do PDF foi suspensa)", async () => {
    const { national, calls } = service({
      [`${adn}/contribuintes/NFSe/`]: () => lote({ type: "NFSE", xml: NFSE_XML }),
    });
    const pdf = await national.pdf(ACCESS_KEY);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, `${adn}/contribuintes/NFSe/${ACCESS_KEY}/Eventos`);
  });

  it("evento de substituição chega aos eventos lidos", async () => {
    const { national } = service({
      [`${adn}/contribuintes/NFSe/`]: () => lote({ type: "NFSE", xml: NFSE_XML }, { type: "EVENTO", xml: replacement }),
    });
    const { events } = await national.withEvents(ACCESS_KEY);
    assert.deepEqual(events.map((e) => e.code), ["105102"]);
    assert.equal((await national.pdf(ACCESS_KEY)).subarray(0, 5).toString(), "%PDF-");
  });

  it("nota que o ADN não acha: NOT_FOUND com o código do serviço", async () => {
    const { national } = service({
      [`${adn}/contribuintes/NFSe/`]: () => ({
        status: 404,
        json: { LoteDFe: [], Erros: [{ Codigo: "E2240", Descricao: "Nenhum documento localizado" }] },
      }),
    });
    await assert.rejects(national.pdf(ACCESS_KEY), (error) => {
      assert.ok(error instanceof NationalError);
      assert.equal(error.code, "NOT_FOUND");
      assert.match(error.message, /\[E2240\] Nenhum documento localizado/);
      return true;
    });
  });

  it("lote sem a NFS-e não vira PDF vazio", async () => {
    const { national } = service({
      [`${adn}/contribuintes/NFSe/`]: () => lote({ type: "EVENTO", xml: replacement }),
    });
    await assert.rejects(national.pdf(ACCESS_KEY), (error) => error instanceof NationalError && error.code === "UNEXPECTED_RESPONSE");
  });
});

describe("NationalService.cancel", () => {
  it("registra o evento 101101 assinado na chave da nota", async () => {
    const { national, calls } = service({
      [`${sefin}/nfse/${ACCESS_KEY}/eventos`]: () => ({
        status: 201,
        json: { eventoXmlGZipB64: packXml("<evento/>") },
      }),
    });

    const event = await national.cancel(ACCESS_KEY, 2, "Servico nao foi prestado");

    assert.equal(event, "<evento/>");
    const call = calls[0]!;
    assert.equal(call.request.method, "POST");
    const request = unpackXml(posted(call)["pedidoRegistroEventoXmlGZipB64"]!);
    assert.match(request, new RegExp(`<infPedReg Id="PRE${ACCESS_KEY}101101">`));
    assert.match(request, /<cMotivo>2<\/cMotivo>/);
    assert.match(request, new RegExp(`<Reference URI="#PRE${ACCESS_KEY}101101">`));
    assert.match(request, /<\/infPedReg><Signature /);
  });

  it("valida a justificativa antes de enviar", async () => {
    const { national, calls } = service({});
    await assert.rejects(national.cancel(ACCESS_KEY, 1, "curta"), /15 a 255/);
    assert.equal(calls.length, 0);
  });
});

describe("NationalService.manifest", () => {
  const route = () => ({
    [`${sefin}/nfse/${ACCESS_KEY}/eventos`]: () => ({ status: 201, json: { eventoXmlGZipB64: packXml("<evento/>") } }),
  });

  const cases: [string, "provider" | "taker" | "intermediary", "confirm" | "reject", number, string][] = [
    ["confirmação do prestador", "provider", "confirm", 202201, "Confirmação do Prestador"],
    ["confirmação do tomador", "taker", "confirm", 203202, "Confirmação do Tomador"],
    ["confirmação do intermediário", "intermediary", "confirm", 204203, "Confirmação do Intermediário"],
    ["rejeição do prestador", "provider", "reject", 202205, "Rejeição do Prestador"],
    ["rejeição do tomador", "taker", "reject", 203206, "Rejeição do Tomador"],
    ["rejeição do intermediário", "intermediary", "reject", 204207, "Rejeição do Intermediário"],
  ];
  for (const [name, role, action, code, who] of cases) {
    it(`${name}: evento ${code}, assinado, no id e na descrição do XSD`, async () => {
      const { national, calls } = service(route());
      await national.manifest(ACCESS_KEY, {
        role,
        action,
        ...(action === "reject" ? { reason: 3 as const, justification: "Fato gerador nao ocorreu" } : {}),
      });
      const request = unpackXml(posted(calls[0]!)["pedidoRegistroEventoXmlGZipB64"]!);
      assert.match(request, new RegExp(`<infPedReg Id="PRE${ACCESS_KEY}${code}">`));
      assert.match(request, new RegExp(`<e${code}><xDesc>Manifestação de NFS-e - ${who}</xDesc>`));
      assert.match(request, new RegExp(`<Reference URI="#PRE${ACCESS_KEY}${code}">`));
      assert.equal(/<cMotivo>3<\/cMotivo>/.test(request), action === "reject");
    });
  }

  it("o XML de cada manifestação valida contra o XSD de eventos", () => {
    for (const [, role, action] of cases) {
      const { xml } = buildManifestationEvent({
        environment: 1,
        cnpj: PROVIDER_CNPJ,
        accessKey: ACCESS_KEY,
        role,
        action,
        ...(action === "reject" ? { reason: 9 as const, justification: "Outro motivo qualquer aqui" } : {}),
      });
      const result = validateAgainstSchema(xml, "pedRegEvento_v1.01.xsd", SCHEMA_DIRECTORIES.national);
      if (result === null) return; // sem xmllint
      assert.deepEqual(result.errors, [], `${role} ${action}`);
    }
  });

  it("recusa antes de enviar: rejeição sem motivo, motivo na confirmação, justificativa curta", async () => {
    const { national, calls } = service(route());
    await assert.rejects(national.manifest(ACCESS_KEY, { role: "taker", action: "reject" }), /`reason`/);
    await assert.rejects(national.manifest(ACCESS_KEY, { role: "taker", action: "confirm", reason: 1 }), /só valem na rejeição/);
    await assert.rejects(
      national.manifest(ACCESS_KEY, { role: "taker", action: "reject", reason: 1, justification: "curta" }),
      /15 a 255/,
    );
    assert.equal(calls.length, 0);
  });

  it("a recusa da SEFIN (ex.: não é o tomador da nota) vira NationalError", async () => {
    const { national } = service({
      [`${sefin}/nfse/${ACCESS_KEY}/eventos`]: () => ({ status: 400, json: { erro: [{ codigo: "E0001", descricao: "autor invalido" }] } }),
    });
    await assert.rejects(national.manifest(ACCESS_KEY, { role: "taker", action: "confirm" }), NationalError);
  });
});

describe("NationalService.received", () => {
  const TAKER = "52884617000110";
  const issuedBy = (cnpj: string, taker: string) =>
    NFSE_XML.replace(/<emit><CNPJ>\d+<\/CNPJ>/, `<emit><CNPJ>${cnpj}</CNPJ>`).replace(/<toma><CNPJ>\d+<\/CNPJ>/, `<toma><CNPJ>${taker}</CNPJ>`);
  const doc = (nsu: number, type: string, xml: string) => ({
    NSU: nsu,
    ChaveAcesso: ACCESS_KEY,
    TipoDocumento: type,
    ArquivoXml: packXml(xml),
  });
  const asTaker = (routes: Parameters<typeof fakeTransport>[0]) => {
    const { transport, calls } = fakeTransport(routes);
    const certificate = testCertificate();
    return {
      calls,
      national: new NationalService({
        certificate,
        signer: createXmlSigner(certificate, "sha256"),
        environment: "homologacao",
        cnpj: TAKER,
        cityCode: SUZANO,
        transport,
      }),
    };
  };
  const page = (...docs: ReturnType<typeof doc>[]) => ({ json: { LoteDFe: docs } });

  it("fica só com as notas emitidas por outros contra o seu CNPJ, e ignora eventos", async () => {
    const { national } = asTaker({
      [`${adn}/contribuintes/DFe/0`]: () =>
        page(
          doc(1, "NFSE", issuedBy("37969249000110", TAKER)), // recebida
          doc(2, "NFSE", issuedBy(TAKER, "11222333000181")), // emitida por mim
          doc(3, "EVENTO", "<evento/>"),
          doc(4, "NFSE", "<nao-e-nota"), // lixo não derruba a leitura
        ),
      [`${adn}/contribuintes/DFe/5`]: () => ({ status: 404, json: {} }),
    });
    const result = await national.received();
    assert.deepEqual(result.invoices.map((i) => i.issuerCnpj), ["37969249000110"]);
    assert.equal(result.nextNsu, 5);
    assert.equal(result.complete, true);
  });

  it("segue pelas páginas e devolve o cursor para continuar depois", async () => {
    const { national, calls } = asTaker({
      [`${adn}/contribuintes/DFe/10`]: () => page(doc(10, "NFSE", issuedBy("37969249000110", TAKER)), doc(11, "EVENTO", "<e/>")),
      [`${adn}/contribuintes/DFe/12`]: () => page(doc(12, "NFSE", issuedBy("37969249000110", TAKER))),
      [`${adn}/contribuintes/DFe/13`]: () => page(doc(13, "NFSE", issuedBy("37969249000110", TAKER))),
    });
    const stopped = await national.received(10, { maxPages: 2 });
    assert.equal(stopped.invoices.length, 2);
    assert.equal(stopped.complete, false, "parou no limite de páginas");
    assert.equal(stopped.nextNsu, 13);
    assert.equal(calls.length, 2);
  });

  it("sem nada novo devolve lista vazia e o mesmo cursor", async () => {
    const { national } = asTaker({ [`${adn}/contribuintes/DFe/42`]: () => ({ status: 404, json: {} }) });
    assert.deepEqual(await national.received(42), { invoices: [], nextNsu: 42, complete: true });
  });
});

describe("NationalService.distribution", () => {
  it("descompacta os documentos do lote", async () => {
    const { national, calls } = service({
      [`${adn}/contribuintes/DFe/`]: () => ({
        json: {
          StatusProcessamento: "DOCUMENTOS_LOCALIZADOS",
          LoteDFe: [
            { NSU: 79, ChaveAcesso: ACCESS_KEY, TipoDocumento: "NFSE", ArquivoXml: packXml(NFSE_XML) },
          ],
        },
      }),
    });

    const documents = await national.distribution(78);

    assert.equal(calls[0]?.url, `${adn}/contribuintes/DFe/78?cnpjConsulta=${PROVIDER_CNPJ}&lote=true`);
    assert.deepEqual(documents, [{ nsu: 79, accessKey: ACCESS_KEY, type: "NFSE", xml: NFSE_XML }]);
  });

  it("lista vazia quando não há nada depois do NSU", async () => {
    const { national } = service({
      [`${adn}/contribuintes/DFe/`]: () => ({ status: 404, json: { StatusProcessamento: "NENHUM_DOCUMENTO_LOCALIZADO" } }),
    });
    assert.deepEqual(await national.distribution(500), []);
  });
});

describe("NationalService.issue — falhas no envio", () => {
  const lost = () => {
    throw new TransportError("POST /SefinNacional/nfse (nacional): falha de rede", {
      outcomeUnknown: true,
    });
  };

  it("resposta perdida, nota existe: devolve como reconciliada", async () => {
    let lookups = 0;
    const { national } = service({
      [`${sefin}/dps/`]: () =>
        ++lookups === 1 ? notFound() : { json: { chaveAcesso: ACCESS_KEY } },
      [`${sefin}/nfse/${ACCESS_KEY}`]: () => ({ json: { nfseXmlGZipB64: packXml(NFSE_XML) } }),
      [`${sefin}/nfse`]: lost,
    });
    const outcome = await national.issue(sampleRps(), issueOptions);
    assert.equal(outcome.status, "reconciled");
    assert.equal(outcome.nfse.accessKey, ACCESS_KEY);
  });

  it("resposta perdida, SEFIN confirma que não há nota: erro sem incerteza", async () => {
    const { national } = service({ [`${sefin}/dps/`]: notFound, [`${sefin}/nfse`]: lost });
    await assert.rejects(national.issue(sampleRps(), issueOptions), (error) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.outcomeUnknown, false);
      assert.equal(error.retryable, true);
      assert.equal(error.details["dpsId"], DPS_ID);
      return true;
    });
  });

  it("resposta perdida e consulta também falha: segue incerto", async () => {
    let lookups = 0;
    const { national } = service({
      [`${sefin}/dps/`]: () => {
        if (++lookups === 1) return notFound();
        throw new TransportError("consulta caiu");
      },
      [`${sefin}/nfse`]: lost,
    });
    await assert.rejects(national.issue(sampleRps(), issueOptions), (error) => {
      assert.ok(error instanceof NfseError);
      assert.equal(error.outcomeUnknown, true);
      assert.equal(error.details["dpsId"], DPS_ID);
      return true;
    });
  });

  it("503 no envio também confere a DPS antes de desistir", async () => {
    let lookups = 0;
    const { national } = service({
      [`${sefin}/dps/`]: () =>
        ++lookups === 1 ? notFound() : { json: { chaveAcesso: ACCESS_KEY } },
      [`${sefin}/nfse/${ACCESS_KEY}`]: () => ({ json: { nfseXmlGZipB64: packXml(NFSE_XML) } }),
      [`${sefin}/nfse`]: () => ({ status: 503, body: Buffer.from("<html>503</html>") }),
    });
    assert.equal((await national.issue(sampleRps(), issueOptions)).status, "reconciled");
  });

  it("recusa de regra não reconcilia, e leva o id da DPS", async () => {
    let lookups = 0;
    const { national } = service({
      [`${sefin}/dps/`]: () => (lookups++, notFound()),
      [`${sefin}/nfse`]: () => ({
        status: 400,
        json: { erros: [{ Codigo: "E0039", Descricao: "não parametrizado" }] },
      }),
    });
    await assert.rejects(national.issue(sampleRps(), issueOptions), (error) => {
      assert.ok(error instanceof NationalError);
      assert.equal(error.code, "REJECTED");
      assert.equal(error.retryable, false);
      assert.equal(error.outcomeUnknown, false);
      assert.equal(error.details["dpsId"], DPS_ID);
      return true;
    });
    assert.equal(lookups, 1);
  });

  it("recursos ainda não montados falham antes de qualquer envio", async () => {
    const { national, calls } = service({});
    const works = { ...sampleRps(), construction: { workCode: "1" } };
    await assert.rejects(national.issue(works, issueOptions), NotSupportedError);
    // tomador no exterior incompleto também não chega ao envio
    const foreign = sampleRps({ taker: { nif: "123", legalName: "Acme Inc." } });
    await assert.rejects(national.issue(foreign, issueOptions), ValidationError);
    assert.equal(calls.length, 0);
  });
});

