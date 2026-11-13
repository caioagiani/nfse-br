import { loadConfig, type GissConfig } from "./config/index.ts";
import type { PartyIdentification } from "./domain/types.ts";
import {
  loadCertificate,
  type Certificate,
  type CertificateInput,
} from "./infra/certificate.ts";
import { createXmlSigner } from "./infra/xml-signer.ts";
import type { QueryResult } from "./providers/giss/messages/parser.ts";
import { NfscService } from "./providers/giss/nfsc-service.ts";
import {
  NationalService,
  type NationalIssueOptions,
  type NationalIssueOutcome,
} from "./providers/nacional/national-service.ts";
import type { NationalCancellationReason } from "./providers/nacional/messages.ts";
import type { Rps } from "./domain/types.ts";
import { NfseService } from "./providers/giss/nfse-service.ts";

export interface NfseClientOptions extends Partial<GissConfig> {
  /**
   * Certificado a usar, no lugar de `certificatePath`: o caminho do .pfx, o
   * arquivo em memória, ou um `Certificate` já carregado. A última forma evita
   * reabrir o PKCS#12 a cada instância, que é a parte cara.
   */
  certificate?: CertificateInput;
  /** Loga na saída de erro os XMLs enviados e recebidos */
  debug?: boolean;
}

/**
 * Fachada sobre os dois Web Services SOAP.
 *
 * Carrega o certificado uma vez, monta o assinador e entrega os serviços
 * `nfse` (serviços prestados) e `nfsc` (serviços tomados) já configurados.
 * O cadastro de participantes não passa por aqui — vive na API REST do portal,
 * em `PortalService`.
 */
/** Marca a config quando o certificado não veio de um arquivo. */
const MEMORY_CERTIFICATE = "<in-memory>";

export class NfseClient {
  readonly config: GissConfig;
  readonly certificate: Certificate;
  /** Sistema Nacional NFS-e — o emissor principal. Mesmo certificado, assinatura SHA-256 */
  readonly national: NationalService;
  /** GissOnline, serviços prestados (SOAP). Legado: o Simples Nacional não emite mais por ele */
  readonly nfse: NfseService;
  /** GissOnline, serviços tomados (SOAP) */
  readonly nfsc: NfscService;

  constructor(options: NfseClientOptions = {}) {
    const { debug = false, certificate, ...overrides } = options;

    // `CERT_PATH` e `CERT_PASSWORD` só existem para abrir o arquivo: quando o
    // certificado chega pronto, nada disso é necessário e exigir as variáveis
    // impediria o uso sem `.env`. Um .pfx em memória ainda precisa da senha.
    const fromMemory = certificate !== undefined && typeof certificate !== "string";
    const parsed = fromMemory && !Buffer.isBuffer(certificate);
    this.config = loadConfig({
      ...(fromMemory ? { certificatePath: MEMORY_CERTIFICATE } : {}),
      ...(parsed ? { certificatePassword: "" } : {}),
      ...overrides,
    });
    this.certificate = loadCertificate(
      certificate ?? this.config.certificatePath,
      this.config.certificatePassword,
    );

    const signer = createXmlSigner(this.certificate);
    const shared = {
      host: this.config.host,
      certificate: this.certificate,
      signer,
      cityCode: this.config.cityCode,
      debug,
    };

    this.nfse = new NfseService({
      ...shared,
      provider: this.provider,
      version: this.config.version,
    });
    this.nfsc = new NfscService({ ...shared, taker: this.provider });
    this.national = new NationalService({
      certificate: this.certificate,
      signer: createXmlSigner(this.certificate, "sha256"),
      environment: this.config.environment,
      cnpj: this.config.cnpj,
      cityCode: this.config.cityCode,
      debug,
    });
  }

  /**
   * Emite pelo Sistema Nacional. O `number` é o da DPS e vem de você, estável
   * entre as tentativas: repetir o mesmo número nunca gera duas notas.
   * Série "1" e a opção do Simples (ME/EPP quando o RPS é de optante) saem do
   * padrão; passe `series` e `simplesOption` para mudar.
   */
  issue(
    rps: Rps,
    options: Pick<NationalIssueOptions, "number"> & Partial<NationalIssueOptions>,
  ): Promise<NationalIssueOutcome> {
    return this.national.issue(rps, this.#nationalOptions(rps, options));
  }

  /** A DPS assinada que `issue` enviaria, sem enviar nada. */
  previewIssue(
    rps: Rps,
    options: Pick<NationalIssueOptions, "number"> & Partial<NationalIssueOptions>,
  ): string {
    return this.national.previewDps(rps, this.#nationalOptions(rps, options));
  }

  /** Cancela uma nota nacional pela chave de acesso (evento 101101). */
  cancel(accessKey: string, reason: NationalCancellationReason, justification: string) {
    return this.national.cancel(accessKey, reason, justification);
  }

  #nationalOptions(
    rps: Rps,
    options: Pick<NationalIssueOptions, "number"> & Partial<NationalIssueOptions>,
  ): NationalIssueOptions {
    // Um `undefined` explícito não pode apagar o padrão, como faria um spread simples.
    const given = Object.fromEntries(
      Object.entries(options).filter(([, value]) => value !== undefined),
    );
    return {
      series: "1",
      simplesOption: rps.simplesNacionalOptant === 1 ? 3 : 1,
      ...given,
    } as NationalIssueOptions;
  }

  /** Identificação do prestador configurado no `.env`. */
  get provider(): PartyIdentification {
    return {
      cnpj: this.config.cnpj,
      municipalRegistration: this.config.municipalRegistration,
    };
  }

  /**
   * Percorre todas as páginas de uma consulta paginada até esgotar os
   * resultados (o serviço devolve no máximo 50 notas por página).
   */
  async *paginate(
    query: (page: number) => Promise<QueryResult>,
    pageLimit = 200,
  ): AsyncGenerator<QueryResult> {
    for (let page = 1; page <= pageLimit; page++) {
      const result = await query(page);
      yield result;
      if (result.invoices.length < 50) return;
    }
  }
}

/** Nome anterior a 2.0, quando o cliente só falava com o GissOnline. */
export const GissClient = NfseClient;
export type GissClient = NfseClient;
/** Nome anterior a 2.0. */
export type GissClientOptions = NfseClientOptions;
