/**
 * O CLI de ponta a ponta contra um servidor HTTPS local que faz as vezes da SEFIN e do ADN.
 * O endereço entra por NFSE_NATIONAL_SEFIN/NFSE_NATIONAL_ADN e o certificado do servidor,
 * autoassinado, por NODE_EXTRA_CA_CERTS — nada do código sob teste é trocado.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import forge from "node-forge";
import { PROVIDER_CNPJ, SUZANO, testPfx } from "./helpers.ts";

function localTls() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const attrs = [{ name: "commonName", value: "127.0.0.1" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
}

type Handler = (url: string) => { status?: number; json: unknown } | undefined;

describe("CLI — comandos nacionais contra um servidor local", () => {
  const tls = localTls();
  const dir = mkdtempSync(join(tmpdir(), "nfse-cli-net-"));
  const caFile = join(dir, "ca.pem");
  writeFileSync(caFile, tls.cert);
  writeFileSync(join(dir, "cert.pfx"), testPfx("segredo"));

  let handler: Handler = () => undefined;
  const seen: string[] = [];
  let server: Server;
  let base = "";

  before(async () => {
    server = createServer(tls, (req, res) => {
      seen.push(`${req.method} ${req.url}`);
      const reply = handler(req.url ?? "") ?? { status: 404, json: {} };
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.json));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  function run(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k))),
      CERT_PATH: "cert.pfx",
      CERT_PASSWORD: "segredo",
      GISS_CNPJ: PROVIDER_CNPJ,
      GISS_ISC_MUNICIPAL: "53624",
      GISS_CODIGO_MUNICIPIO: SUZANO,
      NFSE_NATIONAL_SEFIN: `${base}/sefin`,
      NFSE_NATIONAL_ADN: `${base}/adn`,
      NODE_EXTRA_CA_CERTS: caFile,
    };
    return new Promise((done) => {
      const child = spawn(process.execPath, [resolve("src/cli/index.ts"), "--env", "homologacao", ...args], { cwd: dir, env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("close", (status) => done({ status, stdout, stderr }));
    });
  }

  it("national-status lê o convênio do município no ADN", async () => {
    handler = (url) =>
      url === `/adn/parametrizacao/${SUZANO}/convenio`
        ? { json: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 1 } } }
        : undefined;
    const result = await run("national-status");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Shares with national:\s+yes/);
    assert.match(result.stdout, /Accepts national issuer: yes/);
    assert.match(result.stdout, new RegExp(`${base.replace(/[.]/g, "\\.")}/sefin`));
  });

  it("national-status avisa quando o município não aceita o emissor nacional", async () => {
    handler = () => ({ json: { parametrosConvenio: { aderenteAmbienteNacional: 1, aderenteEmissorNacional: 2 } } });
    const result = await run("national-status");
    assert.match(result.stdout, /Accepts national issuer: no/);
    assert.match(result.stdout, /E0039/);
  });

  it("national-rates mostra a alíquota; sem regime especial, não inventa um", async () => {
    handler = (url) =>
      /\/01\.09\.02\.001\/\d{4}-\d{2}-\d{2}\/aliquota$/.test(url)
        ? { json: { aliquotas: { "01.09.02.001": [{ Incidencia: "SIM", Aliq: 4, DtIni: "2025-12-04T00:00:00", DtFim: null }] } } }
        : undefined;
    const result = await run("national-rates", "--item", "010902001");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ISS 4% \(incidence SIM\) since 2025-12-04/);
    assert.doesNotMatch(result.stdout, /Special regime/);
  });

  it("national-rates diz que o município não parametrizou o serviço", async () => {
    handler = () => undefined;
    const result = await run("national-rates", "--item", "010902001");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /has not parameterised 010902001/);
  });

  it("national-get: nota inexistente sai com código 1 e o código HTTP", async () => {
    handler = () => ({ status: 404, json: { erros: [{ Codigo: "E1234", Descricao: "NFS-e não encontrada" }] } });
    const result = await run("national-get", "--key", "1".repeat(50));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /404|NFS-e não encontrada/);
  });

  it("endereço de uma ponta só é recusado antes de qualquer chamada", async () => {
    seen.length = 0;
    const env = { ...process.env, NFSE_NATIONAL_SEFIN: `${base}/sefin`, NFSE_NATIONAL_ADN: "" };
    const child = await new Promise<{ status: number | null; stderr: string }>((done) => {
      const p = spawn(process.execPath, [resolve("src/cli/index.ts"), "national-status"], {
        cwd: dir,
        env: { ...env, CERT_PATH: "cert.pfx", CERT_PASSWORD: "segredo", GISS_CNPJ: PROVIDER_CNPJ, GISS_ISC_MUNICIPAL: "53624", NODE_EXTRA_CA_CERTS: caFile },
      });
      let stderr = "";
      p.stderr.on("data", (c) => (stderr += c));
      p.on("close", (status) => done({ status, stderr }));
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /NFSE_NATIONAL_SEFIN and NFSE_NATIONAL_ADN together/);
    assert.equal(seen.length, 0);
  });
});
