import assert from "node:assert/strict";
import { describe, it } from "node:test";
import forge from "node-forge";
import { CertificateError } from "../src/domain/errors.ts";
import { CertificatePool } from "../src/infra/certificate-pool.ts";

const keys = forge.pki.rsa.generateKeyPair(1024);

/** `.pfx` de verdade, com a validade escolhida. */
function pfx(cn: string, notAfter: Date, password = "segredo"): { pfx: Buffer; password: string } {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date("2026-01-01");
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: "commonName", value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return { pfx: Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"), password };
}

const FAR = new Date("2030-01-01");

function setup(options = {}) {
  let now = new Date("2026-11-14T12:00:00Z").getTime();
  const pool = new CertificatePool({ now: () => now, ...options });
  let opened = 0;
  const source = (cn: string, notAfter = FAR) => () => (opened++, pfx(cn, notAfter));
  return { pool, source, opened: () => opened, advance: (ms: number) => (now += ms) };
}

describe("CertificatePool", () => {
  it("abre uma vez e serve do cache nas próximas", async () => {
    const { pool, source, opened } = setup();
    const a = await pool.get("empresa-1", source("A"));
    const b = await pool.get("empresa-1", source("A"));
    assert.equal(a, b);
    assert.equal(opened(), 1);
    assert.deepEqual(pool.stats(), { size: 1, hits: 1, misses: 1, loads: 1, evictions: 0 });
  });

  it("empresas diferentes têm entradas diferentes", async () => {
    const { pool, source, opened } = setup();
    const a = await pool.get("1", source("A"));
    const b = await pool.get("2", source("B"));
    assert.notEqual(a.subject, b.subject);
    assert.equal(opened(), 2);
  });

  it("pedidos simultâneos da mesma empresa dividem uma abertura", async () => {
    const { pool, opened } = setup();
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const slow = async () => (await gate, pfx("A", FAR));
    const all = Promise.all([pool.get("x", slow), pool.get("x", slow), pool.get("x", slow)]);
    release();
    const [first, ...rest] = await all;
    assert.ok(rest.every((c) => c === first));
    assert.equal(opened(), 0, "a fonte compartilhada não passou pelo contador");
    assert.equal(pool.stats().loads, 1);
  });

  it("o TTL vence: depois dele reabre", async () => {
    const { pool, source, opened, advance } = setup({ ttlMs: 1000 });
    await pool.get("x", source("A"));
    advance(999);
    await pool.get("x", source("A"));
    assert.equal(opened(), 1);
    advance(2);
    await pool.get("x", source("A"));
    assert.equal(opened(), 2);
    assert.equal(pool.stats().evictions, 1);
  });

  it("certificado perto de vencer sai do cache e a fonte é consultada de novo", async () => {
    const { pool, source, opened, advance } = setup({ expiryMarginMs: 60_000, ttlMs: 86_400_000 });
    // o relógio do pool começa em 2026-11-14T12:00Z: vence 2 horas depois
    const expiring = new Date("2026-11-14T14:00:00Z");
    await pool.get("x", source("velho", expiring));
    advance(3_600_000); // ainda falta 1 hora
    await pool.get("x", source("velho", expiring));
    assert.equal(opened(), 1);
    advance(3_600_000 - 30_000); // faltam 30 s: dentro da margem
    const renewed = await pool.get("x", source("renovado", FAR));
    assert.equal(opened(), 2);
    assert.equal(renewed.subject, "renovado");
  });

  it("certificado já vencido não entra no cache", async () => {
    const { pool, source, opened } = setup();
    await pool.get("x", source("vencido", new Date("2026-01-02")));
    assert.equal(pool.stats().size, 0);
    await pool.get("x", source("vencido", new Date("2026-01-02")));
    assert.equal(opened(), 2);
  });

  it("version diferente ignora o cache (A1 trocado no banco)", async () => {
    const { pool, source, opened } = setup();
    await pool.get("x", source("A"), { version: "v1" });
    await pool.get("x", source("A"), { version: "v1" });
    assert.equal(opened(), 1);
    const replaced = await pool.get("x", source("B"), { version: "v2" });
    assert.equal(replaced.subject, "B");
    assert.equal(opened(), 2);
  });

  it("invalidate tira a empresa na hora", async () => {
    const { pool, source, opened } = setup();
    await pool.get("x", source("A"));
    assert.equal(pool.invalidate("x"), true);
    assert.equal(pool.invalidate("x"), false);
    await pool.get("x", source("A"));
    assert.equal(opened(), 2);
  });

  it("o limite de entradas descarta a menos usada", async () => {
    const { pool, source, opened } = setup({ maxEntries: 2 });
    await pool.get("a", source("A"));
    await pool.get("b", source("B"));
    await pool.get("a", source("A")); // a vira a mais recente
    await pool.get("c", source("C")); // estoura: sai a "b"
    assert.equal(pool.stats().size, 2);
    await pool.get("a", source("A"));
    assert.equal(opened(), 3, "a continuou em cache");
    await pool.get("b", source("B"));
    assert.equal(opened(), 4, "b foi descartada");
  });

  it("falha ao abrir não é guardada, e a próxima tentativa reabre", async () => {
    const { pool } = setup();
    await assert.rejects(pool.get("x", () => ({ pfx: pfx("A", FAR).pfx, password: "errada" })), CertificateError);
    assert.equal(pool.stats().size, 0);
    const ok = await pool.get("x", () => pfx("A", FAR));
    assert.equal(ok.subject, "A");
  });

  it("falha da própria fonte propaga e não trava as próximas chamadas", async () => {
    const { pool } = setup();
    await assert.rejects(pool.get("x", async () => Promise.reject(new Error("banco fora"))), /banco fora/);
    assert.equal((await pool.get("x", () => pfx("A", FAR))).subject, "A");
  });

  it("clear esvazia tudo", async () => {
    const { pool, source } = setup();
    await pool.get("a", source("A"));
    await pool.get("b", source("B"));
    pool.clear();
    assert.equal(pool.stats().size, 0);
    assert.equal(pool.stats().evictions, 2);
  });

  it("recusa configuração inválida", () => {
    assert.throws(() => new CertificatePool({ ttlMs: 0 }), RangeError);
    assert.throws(() => new CertificatePool({ maxEntries: 0 }), RangeError);
    assert.throws(() => new CertificatePool({ expiryMarginMs: -1 }), RangeError);
  });
});
