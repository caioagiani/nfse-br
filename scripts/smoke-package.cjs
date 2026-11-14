// Carrega o pacote já construído do jeito que um projeto CommonJS o faria.
// `require()` de ESM só funciona no Node 22.12+ e falha se o grafo tiver
// top-level await — o que este script pega antes de um usuário pegar.
const nfse = require("../dist/index.js");

for (const name of ["NfseClient", "describeNationalCode", "parameterServiceCode", "NfseError"]) {
  if (nfse[name] === undefined) {
    console.error(`export ausente no require(): ${name}`);
    process.exit(1);
  }
}
console.log(`require("nfse-br") ok: ${Object.keys(nfse).length} exports`);
