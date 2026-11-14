import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { PROVIDER_CNPJ, testPfx } from "./helpers.ts";

describe("CLI", () => {
  it("lista os comandos e a opção do emissor nacional na ajuda", () => {
    const run = spawnSync(process.execPath, ["src/cli/index.ts", "--help"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    for (const command of ["national-status", "national-get", "national-pdf", "national-xml", "national-docs"]) {
      assert.match(run.stdout, new RegExp(`\\b${command}\\b`));
    }
    assert.match(run.stdout, /--issuer giss\|nacional/);
  });
});

describe("CLI — erros", () => {
  const cli = resolve("src/cli/index.ts");
  /** Diretório sem .env e ambiente sem as variáveis do projeto. */
  const run = (...args: string[]) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k)),
    );
    return spawnSync(process.execPath, [cli, ...args], {
      cwd: mkdtempSync(join(tmpdir(), "nfse-cli-")),
      env,
      encoding: "utf8",
    });
  };

  it("configuração ausente: código CONFIG e próximo passo, saída 1", () => {
    const result = run("latest");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Variável de ambiente ausente: CERT_PATH/);
    assert.match(result.stderr, /code: CONFIG/);
    assert.match(result.stderr, /Check \.env/);
  });

  it("danfse: PDF a partir do XML salvo, sem configuração nem certificado", () => {
    const out = mkdtempSync(join(tmpdir(), "nfse-danfse-"));
    const result = run(
      "danfse",
      resolve("test/fixtures/national-nfse-full.xml"),
      "--event",
      resolve("test/fixtures/national-event-replaced.xml"),
      "--out",
      out,
    );
    assert.equal(result.status, 0, result.stderr);
    const file = join(out, "nfse-35525022237969249000110000000000060026100000000009.pdf");
    assert.equal(readFileSync(file).subarray(0, 5).toString(), "%PDF-");
    assert.match(result.stdout, /KB\)/);

    assert.equal(run("danfse").status, 1);
    const badStatus = run("danfse", resolve("test/fixtures/national-nfse-full.xml"), "--status", "x");
    assert.match(badStatus.stderr, /--status must be cancelled or replaced/);
  });

  it("certificado inexistente: código CERTIFICATE", () => {
    const env = { CERT_PATH: "/nao/existe.pfx", CERT_PASSWORD: "x", GISS_CNPJ: "1", GISS_ISC_MUNICIPAL: "1" };
    const withCert = spawnSync(process.execPath, [cli, "latest"], {
      cwd: mkdtempSync(join(tmpdir(), "nfse-cli-")),
      env: { ...process.env, ...env },
      encoding: "utf8",
    });
    assert.equal(withCert.status, 1);
    assert.match(withCert.stderr, /Não foi possível ler o certificado/);
    assert.match(withCert.stderr, /code: CERTIFICATE/);
  });
});


describe("CLI — fluxo offline com certificado de teste", () => {
  const cli = resolve("src/cli/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "nfse-cli-flow-"));
  writeFileSync(join(cwd, "cert.pfx"), testPfx("segredo"));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k))),
    CERT_PATH: "cert.pfx",
    CERT_PASSWORD: "segredo",
    GISS_CNPJ: PROVIDER_CNPJ,
    GISS_ISC_MUNICIPAL: "53624",
    GISS_AMBIENTE: "homologacao",
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

  it("cadastra o cliente localmente e lista", () => {
    const add = run("customer-add", "--tax-id", "52.884.617/0001-10", "--name", "Cliente Teste Ltda", "--alias", "teste");
    assert.equal(add.status, 0, add.stderr);
    const saved = JSON.parse(readFileSync(join(cwd, "data/contacts.json"), "utf8"));
    assert.equal(saved.customers[0].taxId, "52884617000110");
    assert.match(run("customers").stdout, /Cliente Teste Ltda/);
  });

  it("issue sem --confirm mostra o XML assinado e não envia nada", () => {
    const preview = run("issue", "--issuer", "giss", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--xml");
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /^<\?xml[\s\S]*<GerarNfseEnvio/);
    assert.match(preview.stdout, /<tipos:Cnpj>52884617000110<\/tipos:Cnpj>/);
    assert.match(preview.stdout, /<SignatureValue>/);

    const summary = run("issue", "--issuer", "giss", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2");
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /Nothing was sent/);
  });

  it("issue emite pelo nacional quando ninguém escolhe o emissor", () => {
    const result = run("issue", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--dps", "7");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /national issuer, the default/);
    assert.doesNotMatch(result.stdout, /GerarNfseEnvio/);
  });

  it("issue sem alíquota falha antes do envio, com código VALIDATION", () => {
    const result = run("issue", "--customer", "teste", "--amount", "1500", "--description", "Software");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /E163/);
    assert.match(result.stderr, /code: VALIDATION/);
  });

  it("cliente desconhecido não vira nota", () => {
    const result = run("issue", "--customer", "ninguem", "--amount", "10", "--description", "x", "--rate", "2");
    assert.equal(result.status, 1);
  });

  it("emissor nacional: prévia da DPS assinada em SHA-256", () => {
    const result = run("issue", "--issuer", "nacional", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--dps", "7", "--xml");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<DPS [^>]*xmlns="http:\/\/www\.sped\.fazenda\.gov\.br\/nfse"/);
    assert.match(result.stdout, new RegExp(`Id="DPS35525022${PROVIDER_CNPJ}0000[0-9]{1}000000000000007"`));
    assert.match(result.stdout, /rsa-sha256/);
  });

  it("emissor automático: cancel --key vai ao nacional, cancel --number não", () => {
    const key = "35525022379692490001100000000000000126116808946208";
    const national = run("cancel", "--key", key, "--reason", "1", "--text", "Erro na emissao do servico");
    assert.equal(national.status, 0, national.stderr);
    assert.match(national.stdout, new RegExp(`Would cancel ${key}`));

    const city = run("cancel", "--number", "10", "--reason", "1");
    assert.match(city.stdout, /Would cancel invoice 10/);
  });

  it("emissor explícito vence o automático (NFSE_EMISSOR=giss)", () => {
    const result = spawnSync(
      process.execPath,
      [cli, "issue", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--xml"],
      { cwd, env: { ...env, NFSE_EMISSOR: "giss" }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GerarNfseEnvio/);
  });

  it("emissor automático: quem não é do Simples também emite pelo nacional, mas replace fica no GissOnline", () => {
    const other = mkdtempSync(join(tmpdir(), "nfse-cli-nao-simples-"));
    writeFileSync(join(other, "cert.pfx"), testPfx("segredo"));
    mkdirSync(join(other, "data"));
    writeFileSync(join(other, "data/profile.json"), JSON.stringify({ simplesNacionalOptant: 2 }));
    writeFileSync(
      join(other, "data/contacts.json"),
      readFileSync(join(cwd, "data/contacts.json"), "utf8"),
    );
    const issue = spawnSync(
      process.execPath,
      [cli, "issue", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2", "--dps", "7", "--xml"],
      { cwd: other, env, encoding: "utf8" },
    );
    assert.equal(issue.status, 0, issue.stderr);
    assert.match(issue.stdout, /<DPS /);
    assert.doesNotMatch(issue.stdout, /GerarNfseEnvio/);

    const replace = spawnSync(
      process.execPath,
      [cli, "replace", "--number", "10", "--reason", "1", "--customer", "teste", "--amount", "1500", "--description", "Software", "--rate", "2"],
      { cwd: other, env, encoding: "utf8" },
    );
    assert.doesNotMatch(replace.stderr, /not available on the national issuer/);
  });
});

describe("CLI — national-rates", () => {
  const cli = resolve("src/cli/index.ts");
  it("exige --item antes de qualquer chamada", () => {
    const cwd = mkdtempSync(join(tmpdir(), "nfse-cli-rates-"));
    writeFileSync(join(cwd, "cert.pfx"), testPfx("segredo"));
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k))),
      CERT_PATH: "cert.pfx",
      CERT_PASSWORD: "segredo",
      GISS_CNPJ: PROVIDER_CNPJ,
      GISS_ISC_MUNICIPAL: "53624",
    };
    const run = spawnSync(process.execPath, [cli, "national-rates"], { cwd, env, encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /--item/);
    assert.match(run.stderr, /code: VALIDATION/);
  });
});

describe("CLI — comandos offline e validação de argumentos", () => {
  const cli = resolve("src/cli/index.ts");
  const cwd = mkdtempSync(join(tmpdir(), "nfse-cli-offline-"));
  writeFileSync(join(cwd, "cert.pfx"), testPfx("segredo"));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GISS_|CERT_|NFSE_)/.test(k))),
    CERT_PATH: "cert.pfx",
    CERT_PASSWORD: "segredo",
    GISS_CNPJ: PROVIDER_CNPJ,
    GISS_ISC_MUNICIPAL: "53624",
  };
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: "utf8" });

  it("cert mostra o titular, a validade e o prestador", () => {
    const result = run("cert");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Holder:\s+EMPRESA TESTE/);
    assert.match(result.stdout, /Valid until:\s+2027-01-01/);
    assert.match(result.stdout, new RegExp(`CNPJ ${PROVIDER_CNPJ} / IM 53624`));
  });

  it("cities filtra por estado", () => {
    const result = run("cities", "--state", "SP");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /guarulhos\s+3518800\s+Guarulhos\/SP/);
    assert.doesNotMatch(result.stdout, /\/RJ/);
  });

  it("comando desconhecido sai com 1", () => {
    const result = run("bogus");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command: bogus/);
  });

  it("argumentos que faltam falham antes de qualquer chamada", () => {
    assert.match(run("cancel", "--reason", "1").stderr, /Provide the invoice --number/);
    assert.match(run("national-get").stderr, /Provide the 50-digit access --key/);
    assert.match(run("danfse").stderr, /Usage: nfse danfse/);
    for (const args of [["cancel", "--reason", "1"], ["national-get"], ["danfse"]]) {
      assert.equal(run(...args).status, 1);
    }
  });

  it("cliente e fornecedor: cadastra, lista e remove no diretório local", () => {
    const add = run("customer-add", "--tax-id", "52.884.617/0001-10", "--name", "Cli Ltda", "--alias", "cli");
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /customer saved: Cli Ltda \(52884617000110\)/);
    assert.match(add.stdout, /Warning: no address/);

    assert.match(run("customers").stdout, /52884617000110\s+\|\s+Cli Ltda\s+\|\s+\(cli\)/);
    assert.match(run("suppliers").stdout, /No supplier in the local directory/);

    const supplier = run("supplier-add", "--tax-id", "60977243000106", "--name", "Forn SA");
    assert.equal(supplier.status, 0, supplier.stderr);
    assert.match(run("suppliers").stdout, /60977243000106/);

    assert.match(run("customer-rm", "--tax-id", "52884617000110").stdout, /customer removed/);
    assert.match(run("customers").stdout, /No customer in the local directory/);
    assert.match(run("suppliers").stdout, /60977243000106/, "remover o cliente não toca o fornecedor");
  });

  it("issue com cliente fora do diretório não vira nota", () => {
    const result = run("issue", "--issuer", "giss", "--customer", "ninguem", "--amount", "10", "--rate", "2");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Customer "ninguem" is not in the local directory/);
  });

  it("profile imprime o perfil fiscal padrão", () => {
    const profile = JSON.parse(run("profile").stdout);
    assert.equal(profile.serviceListItem, "01.04");
    assert.equal(profile.pisCofins.cst, "08");
    assert.equal(profile.simplesNacionalOptant, 1);
  });
});
