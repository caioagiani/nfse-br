import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { NATIONAL_REJECTION_CODES, describeNationalCode } from "../src/index.ts";

describe("catálogo de rejeições do emissor nacional", () => {
  it("traz os códigos vistos no serviço real, com o texto oficial", () => {
    for (const code of ["E0039", "E0625", "E0712", "E1235", "E1203", "E1260"]) {
      assert.ok(describeNationalCode(code)?.message, code);
    }
    assert.match(describeNationalCode("E0712")!.message, /indTotTrib/);
    assert.deepEqual(describeNationalCode("E1260")!.fields, ["NFSe/versao"]);
  });

  it("código desconhecido devolve undefined", () => {
    assert.equal(describeNationalCode("E0000"), undefined);
    assert.equal(describeNationalCode("A02"), undefined);
  });

  it("todo código tem o formato Exxxx e uma mensagem", () => {
    const entries = Object.entries(NATIONAL_REJECTION_CODES);
    assert.ok(entries.length > 400);
    for (const [code, { message }] of entries) {
      assert.match(code, /^E\d{4}$/);
      assert.ok(message.length > 5, code);
    }
  });

  it("a tabela do guia tem todos os códigos do catálogo", () => {
    const doc = readFileSync(new URL("../docs/national-errors.md", import.meta.url), "utf8");
    const listed = [...doc.matchAll(/^\| `(E\d{4})` \|/gm)].map((m) => m[1]);
    for (const code of Object.keys(NATIONAL_REJECTION_CODES)) assert.ok(listed.includes(code), code);
  });
});
