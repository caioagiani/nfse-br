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
import {
  buildRps,
  DEFAULT_PROFILE,
  type IssueInput,
  type IssuingProfile,
} from "./storage/profile-repository.ts";
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
  /**
   * Perfil fiscal do prestador (item, CNAE, NBS, regime…), por cima do
   * `DEFAULT_PROFILE`. É o que `issue` usa; cada nota só informa o que varia.
   */
  profile?: Partial<IssuingProfile>;
}

/** Uma nota nacional: só o que varia por emissão. O resto vem do `profile` do client. */
export interface NationalInvoiceInput
  extends Omit<IssueInput, "rpsNumber" | "rpsType" | "series"> {
  /** Número da DPS, escolhido por você. Repetir o mesmo número nunca emite duas notas. */
  number: string | number;
  /** Série da DPS; por padrão `profile.nationalSeries`, ou "1" */
  series?: string | number;
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
  readonly #profile: IssuingProfile;
  /** GissOnline, serviços prestados (SOAP). Legado: o Simples Nacional não emite mais por ele */
  readonly nfse: NfseService;
  /** GissOnline, serviços tomados (SOAP) */
  readonly nfsc: NfscService;

  constructor(options: NfseClientOptions = {}) {
    const { debug = false, certificate, profile, ...overrides } = options;
    this.#profile = { ...DEFAULT_PROFILE, ...profile };

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

  /** Emite pelo Sistema Nacional, com o perfil do client e os dados desta nota. */
  issue(invoice: NationalInvoiceInput): Promise<NationalIssueOutcome> {
    const { rps, dps } = this.#compose(invoice);
    return this.national.issue(rps, dps);
  }

  /** A DPS assinada que `issue` enviaria, sem enviar nada. */
  previewIssue(invoice: NationalInvoiceInput): string {
    const { rps, dps } = this.#compose(invoice);
    return this.national.previewDps(rps, dps);
  }

  /** Cancela uma nota nacional pela chave de acesso (evento 101101). */
  cancel(accessKey: string, reason: NationalCancellationReason, justification: string) {
    return this.national.cancel(accessKey, reason, justification);
  }

  #compose({ number, series, ...input }: NationalInvoiceInput) {
    const profile = { ...this.#profile, ...input.profile };
    const optant = profile.simplesNacionalOptant === 1;
    const apportionment = profile.simplesApportionment ?? 1;

    // ME/EPP apurada pelo Simples e sem retenção de ISS não envia alíquota na DPS
    // (RN 657). O `buildRps` a exige só por causa do GissOnline, então o placeholder
    // fica aqui dentro e nunca chega ao XML. Em qualquer outro caso, a falta é erro.
    const rateIsOptional = optant && profile.issWithheld !== 1 && apportionment === 1;

    return {
      rps: buildRps(profile, { ...input, rate: input.rate ?? (rateIsOptional ? 0 : undefined) }),
      dps: {
        number,
        series: series ?? profile.nationalSeries ?? "1",
        simplesOption: profile.simplesOption ?? (optant ? 3 : 1),
        simplesApportionment: profile.simplesApportionment,
      } satisfies NationalIssueOptions,
    };
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
