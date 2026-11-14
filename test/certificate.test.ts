import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import forge from "node-forge";
import { CertificateError } from "../src/domain/errors.ts";
import { exportPem, loadCertificate } from "../src/infra/certificate.ts";
import { testCertificate, testPfx } from "./helpers.ts";

describe("loadCertificate", () => {
  const pfx = testPfx("segredo");

  it("abre o .pfx com a senha certa", () => {
    const certificate = loadCertificate(pfx, "segredo");
    assert.equal(certificate.subject, "EMPRESA TESTE:37969249000110");
    assert.equal(certificate.certificatePem, testCertificate().certificatePem);
    assert.match(certificate.privateKeyPem, /BEGIN RSA PRIVATE KEY/);
    assert.deepEqual(certificate.chainPem, []);
  });

  it("senha errada diz que é a senha", () => {
    assert.throws(
      () => loadCertificate(pfx, "errada"),
      (error: unknown) =>
        error instanceof CertificateError && error.message === "Senha do certificado incorreta",
    );
  });

  it("arquivo que não é PKCS#12", () => {
    assert.throws(() => loadCertificate(Buffer.from("não sou um pfx"), "x"), /não é um PKCS#12/);
  });

  it("caminho inexistente", () => {
    assert.throws(
      () => loadCertificate("/caminho/que/nao/existe.pfx", "x"),
      (error: unknown) =>
        error instanceof CertificateError &&
        /Não foi possível ler o certificado/.test(error.message) &&
        error.details["path"] === "/caminho/que/nao/existe.pfx",
    );
  });

  it("sem senha", () => {
    assert.throws(() => loadCertificate(pfx), CertificateError);
  });

  it("um Certificate já carregado volta como está", () => {
    const loaded = testCertificate();
    assert.equal(loadCertificate(loaded), loaded);
  });
});

/** Um certificado autoassinado qualquer, para compor cadeias e chaves que não casam. */
function selfSigned(cn: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date("2026-01-01");
  cert.validity.notAfter = new Date("2027-01-01");
  const attrs = [{ name: "commonName", value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { keys, cert };
}

function pfxOf(key: forge.pki.PrivateKey | null, certs: forge.pki.Certificate[], password: string) {
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, certs, password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

describe("loadCertificate — formas do arquivo", () => {
  const holder = testCertificate();
  const holderKey = forge.pki.privateKeyFromPem(holder.privateKeyPem);
  const holderCert = forge.pki.certificateFromPem(holder.certificatePem);

  it("lê o .pfx por caminho", () => {
    const path = join(mkdtempSync(join(tmpdir(), "nfse-cert-")), "a.pfx");
    writeFileSync(path, testPfx("segredo"));
    assert.equal(loadCertificate(path, "segredo").subject, "EMPRESA TESTE:37969249000110");
  });

  it("separa o certificado do titular da cadeia, em qualquer ordem", () => {
    const ca = selfSigned("AC INTERMEDIARIA");
    const pfx = pfxOf(holderKey, [ca.cert, holderCert], "segredo");
    const loaded = loadCertificate(pfx, "segredo");
    assert.equal(loaded.certificatePem, holder.certificatePem);
    assert.equal(loaded.chainPem.length, 1);
    assert.match(loaded.chainPem[0]!, /BEGIN CERTIFICATE/);
  });

  it("sem chave privada no arquivo", () => {
    const pfx = pfxOf(null, [holderCert], "segredo");
    assert.throws(() => loadCertificate(pfx, "segredo"), /Nenhuma chave privada/);
  });

  it("chave que não casa com nenhum certificado do arquivo", () => {
    const other = selfSigned("OUTRO");
    const pfx = pfxOf(holderKey, [other.cert], "segredo");
    assert.throws(() => loadCertificate(pfx, "segredo"), /Certificado do titular não encontrado/);
  });
});

describe("exportPem", () => {
  it("grava certificado, chave e bundle, com permissão 600", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "nfse-pem-")), "novo");
    const files = exportPem(testCertificate(), dir);

    assert.equal(files.chain, undefined, "sem cadeia, sem chain.pem");
    assert.equal(readFileSync(files.certificate, "utf8"), testCertificate().certificatePem);
    assert.match(readFileSync(files.key, "utf8"), /PRIVATE KEY/);
    assert.equal(readFileSync(files.bundle, "utf8"), testCertificate().certificatePem);
    assert.equal(statSync(files.key).mode & 0o777, 0o600);
  });

  it("com cadeia, grava também chain.pem e a inclui no bundle", () => {
    const ca = selfSigned("AC");
    const certificate = { ...testCertificate(), chainPem: [forge.pki.certificateToPem(ca.cert)] };
    const files = exportPem(certificate, mkdtempSync(join(tmpdir(), "nfse-pem-")));

    assert.ok(files.chain);
    assert.equal(readFileSync(files.chain, "utf8"), certificate.chainPem[0]);
    assert.equal(
      readFileSync(files.bundle, "utf8"),
      certificate.certificatePem + certificate.chainPem[0],
    );
  });
});
