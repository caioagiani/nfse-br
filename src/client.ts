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
import { callSoap, type SoapService } from "./providers/giss/soap-client.ts";
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
   * Chamado a cada troca SOAP com o GissOnline: o envio já assinado e o retorno
   * bruto — ou o erro, inclusive SOAP Fault e falha de rede. Serve para guardar
   * o XML de cada operação sem embrulhar o transporte.
   */
  onExchange?: (exchange: SoapExchange) => void;
  /**
   * Perfil fiscal do prestador (item, CNAE, NBS, regime…), por cima do
   * `DEFAULT_PROFILE`. É o que `issue` usa; cada nota só informa o que varia.
   */
  profile?: Partial<IssuingProfile>;
}

/** Uma troca SOAP com o GissOnline, entregue a `onExchange`. */
export interface SoapExchange {
  service: SoapService;
  operation: string;
  /** O XML enviado, já assinado */
  request: string;
  /** O retorno bruto; ausente quando a chamada falhou */
  response?: string;
  /** A falha, quando houve (SOAP Fault, rede, certificado) */
  error?: unknown;
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
 * Fachada do pacote.
 *
 * Carrega o certificado uma vez, monta o assinador e entrega o Sistema Nacional
 * NFS-e (`national`, `issue`, `previewIssue`, `cancel`) e, como legado, os
 * Web Services SOAP do GissOnline (`nfse`, `nfsc`). O cadastro de participantes
 * do GissOnline não passa por aqui — vive na API REST do portal, em `PortalService`.
 */
/** Marca a config quando o certificado não veio de um arquivo. */
const MEMORY_CERTIFICATE = "<in-memory>";

export class NfseClient {
  readonly config: GissConfig;
  readonly certificate: Certificate;
  /** Sistema Nacional NFS-e — o emissor principal. Mesmo certificado, assinatura SHA-256 */
  readonly national: NationalService;
  readonly #profile: IssuingProfile;
  /**
   * GissOnline, serviços prestados (SOAP).
   * @deprecated Legado. Desde 01/11/2026 o Simples Nacional (ME/EPP) não emite mais pelo
   * GissOnline (Res. CGSN 191/2026): use `issue`, `previewIssue` e `cancel`, ou `national`.
   * Segue funcionando para consultas e para quem está fora do Simples; recebe só correções.
   */
  readonly nfse: NfseService;
  /**
   * GissOnline, serviços tomados (SOAP).
   * @deprecated Legado, junto com `nfse`: o GissOnline é substituído pelo Sistema Nacional NFS-e.
   */
  readonly nfsc: NfscService;

  constructor(options: NfseClientOptions = {}) {
    const { debug = false, certificate, profile, onExchange, ...overrides } = options;
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
      ...(onExchange && { transport: observed(onExchange) }),
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

/** `callSoap` que conta cada troca ao observador, sem alterar o que ele devolve ou lança. */
function observed(onExchange: (exchange: SoapExchange) => void): typeof callSoap {
  // Um observador que lança não pode mudar o resultado de uma emissão.
  const notify = (exchange: SoapExchange) => {
    try {
      onExchange(exchange);
    } catch {
      // só observa
    }
  };
  return async (operation, request, options) => {
    const base = { service: options.service, operation, request };
    try {
      const response = await callSoap(operation, request, options);
      notify({ ...base, response: response.xml });
      return response;
    } catch (error) {
      notify({ ...base, error });
      throw error;
    }
  };
}

/** Nome anterior a 2.0, quando o cliente só falava com o GissOnline. */
export const GissClient = NfseClient;
export type GissClient = NfseClient;
/** Nome anterior a 2.0. */
export type GissClientOptions = NfseClientOptions;
