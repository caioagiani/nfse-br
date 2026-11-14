import { loadCertificate, type Certificate } from "./certificate.ts";

/** Onde buscar o `.pfx` de uma empresa — chamado só quando o cache não serve. */
export type CertificateSource = () =>
  | { pfx: Buffer | string; password: string }
  | Promise<{ pfx: Buffer | string; password: string }>;

export interface CertificatePoolOptions {
  /** Quanto um certificado fica em memória sem ser pedido de novo. Padrão 10 min */
  ttlMs?: number;
  /** Teto de certificados guardados; passando disso, sai o menos usado. Padrão 500 */
  maxEntries?: number;
  /**
   * Antecedência com que um certificado é tratado como vencido. Padrão 1 minuto: assinar
   * com um A1 prestes a vencer falha no meio da requisição.
   */
  expiryMarginMs?: number;
  /** Relógio, para testes */
  now?: () => number;
}

export interface CertificatePoolStats {
  size: number;
  hits: number;
  misses: number;
  /** Aberturas de `.pfx` que realmente aconteceram */
  loads: number;
  /** Saídas por TTL, vencimento, troca de versão, limite ou `invalidate` */
  evictions: number;
}

interface Entry {
  certificate: Certificate;
  version: string | undefined;
  loadedAt: number;
}

/**
 * Cache de certificados A1 abertos, para quem atende muitas empresas.
 *
 * Abrir um `.pfx` leva ~16 ms; o cache evita repetir isso e, mais importante, junta pedidos
 * simultâneos da mesma empresa numa abertura só. O custo é manter chaves privadas na memória
 * do processo, então ele se protege:
 *
 * - **TTL curto** (10 min): a chave não fica indefinidamente.
 * - **Vencimento**: um certificado vencido, ou a menos de `expiryMarginMs` de vencer, nunca é
 *   servido do cache nem guardado nele — a fonte é consultada de novo e pode devolver o renovado.
 * - **Troca do A1**: passe `version` (a data de atualização ou o hash do `.pfx` guardado no seu
 *   banco); mudou, o cache é ignorado. `invalidate(id)` faz o mesmo na hora.
 * - **Limite de entradas**, descartando o menos usado.
 * - Falha ao abrir (senha errada, arquivo ruim) **não** é guardada.
 */
export class CertificatePool {
  readonly #entries = new Map<string, Entry>();
  readonly #loading = new Map<string, Promise<Certificate>>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #margin: number;
  readonly #now: () => number;
  #hits = 0;
  #misses = 0;
  #loads = 0;
  #evictions = 0;

  constructor({ ttlMs = 600_000, maxEntries = 500, expiryMarginMs = 60_000, now = Date.now }: CertificatePoolOptions = {}) {
    if (!(ttlMs > 0) || !Number.isInteger(maxEntries) || maxEntries < 1 || expiryMarginMs < 0) {
      throw new RangeError("CertificatePool: ttlMs > 0, maxEntries inteiro >= 1 e expiryMarginMs >= 0");
    }
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#margin = expiryMarginMs;
    this.#now = now;
  }

  /**
   * O certificado da empresa `id`. `load` só roda quando não há um válido em cache.
   * `version` identifica o conteúdo guardado na sua base: mudou, o cache não vale.
   */
  async get(id: string, load: CertificateSource, { version }: { version?: string } = {}): Promise<Certificate> {
    const cached = this.#entries.get(id);
    if (cached && this.#usable(cached, version)) {
      this.#hits++;
      // reinsere para marcar como o mais recente
      this.#entries.delete(id);
      this.#entries.set(id, cached);
      return cached.certificate;
    }
    if (cached) this.#drop(id);

    this.#misses++;
    // pedidos simultâneos da mesma empresa dividem uma abertura
    const pending = this.#loading.get(id);
    if (pending) return pending;

    const opening = (async () => {
      const { pfx, password } = await load();
      const certificate = loadCertificate(pfx, password);
      this.#loads++;
      // vencido não entra: o chamador recebe o erro claro do uso, e a próxima chamada reabre
      if (certificate.validTo.getTime() - this.#margin > this.#now()) {
        this.#entries.set(id, { certificate, version, loadedAt: this.#now() });
        this.#trim();
      }
      return certificate;
    })().finally(() => this.#loading.delete(id));
    this.#loading.set(id, opening);
    return opening;
  }

  /** Tira uma empresa do cache — chame quando ela trocar o certificado. */
  invalidate(id: string): boolean {
    return this.#drop(id);
  }

  /** Esvazia tudo. */
  clear(): void {
    for (const id of [...this.#entries.keys()]) this.#drop(id);
  }

  stats(): CertificatePoolStats {
    return { size: this.#entries.size, hits: this.#hits, misses: this.#misses, loads: this.#loads, evictions: this.#evictions };
  }

  #usable(entry: Entry, version: string | undefined): boolean {
    const now = this.#now();
    return (
      now - entry.loadedAt < this.#ttlMs &&
      entry.certificate.validTo.getTime() - this.#margin > now &&
      entry.version === version
    );
  }

  #drop(id: string): boolean {
    const had = this.#entries.delete(id);
    if (had) this.#evictions++;
    return had;
  }

  #trim(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value as string;
      this.#drop(oldest);
    }
  }
}
