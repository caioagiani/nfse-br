import type { Environment } from "../../config/index.ts";
import {
  NationalError,
  NfseError,
  ValidationError,
  type ServiceMessage,
} from "../../domain/errors.ts";
import type { XmlSigner } from "../../domain/signature-policy.ts";
import type { Rps } from "../../domain/types.ts";
import type { Certificate } from "../../infra/certificate.ts";
import {
  callNational,
  packXml,
  parseJson,
  unpackXml,
  type NationalResponse,
} from "./national-client.ts";
import {
  buildCancellationEvent,
  buildDps,
  buildManifestationEvent,
  dpsId,
  parseNationalEvent,
  parseNationalNfse,
  type DpsContext,
  type ManifestationInput,
  type Replacement,
  type NationalEvent,
  type NationalCancellationReason,
  type NationalEnvironment,
  type NationalNfse,
  type SimplesOption,
} from "./messages.ts";
import { digitsOnly, isoDate } from "../../infra/xml.ts";
import { danfseStatus } from "./danfse/danfse-data.ts";
import { renderDanfse } from "./danfse/danfse-pdf.ts";

/**
 * Hosts do Sistema Nacional NFS-e. A SEFIN emite e registra eventos; o ADN
 * (Ambiente de Dados Nacional) distribui documentos, gera o DANFSe e publica
 * a parametrização dos municípios. "Produção restrita" é o ambiente de testes.
 */
export const NATIONAL_HOSTS = {
  producao: {
    sefin: "https://sefin.nfse.gov.br/SefinNacional",
    adn: "https://adn.nfse.gov.br",
  },
  homologacao: {
    sefin: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
    adn: "https://adn.producaorestrita.nfse.gov.br",
  },
} as const;

/** Uma faixa de vigência da alíquota do ISS de um serviço no município. */
export interface ServiceRate {
  /** "SIM" quando o serviço sofre incidência no município */
  incidence?: string;
  /** Alíquota do município, em %. O Simples recolhe pela do anexo (DAS), não por esta. */
  rate?: number;
  from: string;
  to?: string;
}

/** Um regime especial de tributação do serviço no município. */
export interface SpecialRegime {
  /** Situação da configuração no município (1, 2 ou 3, como a API publica) */
  status: number;
  from: string;
  to?: string;
  notes?: string;
}

/** Adesão do município ao Sistema Nacional, como o ADN a publica. */
export interface MunicipalAgreement {
  /** Compartilha as notas do sistema próprio com o ambiente nacional */
  sharesWithNational: boolean;
  /** Aceita emissão pelos emissores públicos (web e API). Sem isso: E0039. */
  usesNationalIssuer: boolean;
  raw: Record<string, unknown>;
}

export interface NationalIssueOptions {
  series: string | number;
  number: string | number;
  simplesOption: SimplesOption;
  simplesApportionment?: 1 | 2 | 3;
  /** A nota nova substitui outra: o grupo `subst` da DPS */
  replaces?: Replacement;
}

export interface NationalIssueOutcome {
  /**
   * `issued`: emitida agora. `already-issued`: a DPS já tinha virado nota antes
   * desta chamada. `reconciled`: o envio falhou sem resposta, e a consulta
   * seguinte achou a nota — ela foi emitida, só a resposta se perdeu.
   */
  status: "issued" | "already-issued" | "reconciled";
  dpsId: string;
  nfse: NationalNfse;
  alerts: ServiceMessage[];
}

/** Documento distribuído pelo ADN — notas e eventos em que o CNPJ aparece. */
export interface DistributedDocument {
  nsu: number;
  accessKey: string;
  type: string;
  xml: string;
}

export interface NationalServiceOptions {
  certificate: Certificate;
  /** Assinador SHA-256 — ver `createXmlSigner(certificate, "sha256")` */
  signer: XmlSigner;
  environment: Environment;
  cnpj: string;
  /** Município do emitente (IBGE, 7 dígitos) */
  cityCode: string;
  debug?: boolean;
  /** Substitui o transporte HTTPS — para testes, ou para passar por um proxy */
  transport?: typeof callNational;
  /**
   * Outros endereços no lugar dos oficiais do ambiente — um proxy corporativo, um
   * servidor de testes. O certificado do cliente vai a quem estiver lá: só aponte
   * para um destino em que você confie.
   */
  hosts?: NationalHosts;
}

export interface NationalHosts {
  sefin: string;
  adn: string;
}

export class NationalService {
  readonly hosts: NationalHosts;
  private readonly options: NationalServiceOptions;

  constructor(options: NationalServiceOptions) {
    this.options = options;
    this.hosts = options.hosts ?? NATIONAL_HOSTS[options.environment];
  }

  get environmentCode(): NationalEnvironment {
    return this.options.environment === "producao" ? 1 : 2;
  }

  /** Parâmetros do convênio do município. Pública na prática, mas exige mTLS. */
  async agreement(cityCode = this.options.cityCode): Promise<MunicipalAgreement> {
    const body = await this.json<{ parametrosConvenio?: Record<string, unknown> }>(
      `${this.hosts.adn}/parametrizacao/${cityCode}/convenio`,
    );
    const raw = body.parametrosConvenio ?? {};
    return {
      sharesWithNational: raw["aderenteAmbienteNacional"] === 1,
      usesNationalIssuer: raw["aderenteEmissorNacional"] === 1,
      raw,
    };
  }

  /**
   * Alíquotas do ISS de um serviço no município, vigentes na competência (hoje, por padrão).
   * `null` quando o município não parametrizou o serviço: emitir com ele seria rejeitado,
   * então vale consultar antes. `serviceCode` é o código completo, com os 3 dígitos do
   * município: `01.09.02.001` ou `010902001`.
   */
  async serviceRates(
    serviceCode: string,
    competence: Date | string = new Date(),
    cityCode = this.options.cityCode,
  ): Promise<ServiceRate[] | null> {
    const code = parameterServiceCode(serviceCode);
    const body = await this.parameter<{ aliquotas?: Record<string, RawRate[]> | null }>(
      `${cityCode}/${code}/${isoDate(competence)}/aliquota`,
    );
    const list = body?.aliquotas?.[code];
    return list ? list.map(toServiceRate) : null;
  }

  /** Todas as faixas de alíquota que o município já teve para o serviço; `null` se não o parametrizou. */
  async serviceRateHistory(
    serviceCode: string,
    cityCode = this.options.cityCode,
  ): Promise<ServiceRate[] | null> {
    const code = parameterServiceCode(serviceCode);
    const body = await this.parameter<{ aliquotas?: Record<string, RawRate[]> | null }>(
      `${cityCode}/${code}/historicoaliquotas`,
    );
    const list = body?.aliquotas?.[code];
    return list ? list.map(toServiceRate) : null;
  }

  /** Regimes especiais de tributação do serviço na competência; `null` se o município não tem nenhum. */
  async specialRegimes(
    serviceCode: string,
    competence: Date | string = new Date(),
    cityCode = this.options.cityCode,
  ): Promise<SpecialRegime[] | null> {
    const code = parameterServiceCode(serviceCode);
    const body = await this.parameter<{
      regimesEspeciais?: Record<string, Record<string, RawRegime[]>> | null;
    }>(`${cityCode}/${code}/${isoDate(competence)}/regimes_especiais`);
    const groups = body?.regimesEspeciais?.[code];
    if (!groups) return null;
    return Object.values(groups)
      .flat()
      .map((r) => ({ status: r.situacao, from: r.dataInicio, to: r.dataFim ?? undefined, notes: r.observacoes ?? undefined }));
  }

  /**
   * Retenções de ISS que o município determina na competência, como a API as publica
   * (artigo sexto e retenções por código de serviço).
   */
  async withholdings(
    competence: Date | string = new Date(),
    cityCode = this.options.cityCode,
  ): Promise<Record<string, unknown> | null> {
    const body = await this.parameter<{ retencoes?: Record<string, unknown> | null }>(
      `${cityCode}/${isoDate(competence)}/retencoes`,
    );
    return body?.retencoes ?? null;
  }

  /** GET na API de parâmetros do ADN; o 404 daqui quer dizer "não parametrizado", não falha. */
  private async parameter<T>(route: string): Promise<T | null> {
    const url = `${this.hosts.adn}/parametrizacao/${route}`;
    const response = await this.call(url);
    if (response.status === 404) return null;
    return this.unwrap<T>(url, response);
  }

  /** DPS montada e assinada, sem enviar — para conferência e validação. */
  previewDps(rps: Rps, options: NationalIssueOptions): string {
    return this.signDps(rps, options).xml;
  }

  /**
   * Emite a NFS-e a partir da DPS. Idempotente pelo id da DPS: se a mesma
   * série e número já viraram nota, devolve essa nota em vez de reenviar.
   */
  async issue(rps: Rps, options: NationalIssueOptions): Promise<NationalIssueOutcome> {
    const { id, xml } = this.signDps(rps, options);

    const existing = await this.findByDps(id);
    if (existing) {
      return { status: "already-issued", dpsId: id, nfse: existing, alerts: [] };
    }

    let body: { nfseXmlGZipB64?: string; alertas?: unknown };
    try {
      body = await this.json(`${this.hosts.sefin}/nfse`, {
        method: "POST",
        json: { dpsXmlGZipB64: packXml(xml) },
      });
    } catch (error) {
      return this.reconcile(id, error);
    }
    if (!body.nfseXmlGZipB64) {
      throw new NationalError("/nfse", 200, [], body, { details: { dpsId: id } });
    }

    return {
      status: "issued",
      dpsId: id,
      nfse: parseNationalNfse(unpackXml(body.nfseXmlGZipB64)),
      alerts: messagesOf(body.alertas),
    };
  }

  /**
   * O envio falhou sem que se saiba se a SEFIN processou. Pergunta pela DPS:
   * se virou nota, a emissão aconteceu; se não, o erro original volta com o
   * id da DPS, que é o que torna a nova tentativa segura.
   */
  private async reconcile(id: string, error: unknown): Promise<NationalIssueOutcome> {
    const uncertain =
      error instanceof NfseError && (error.outcomeUnknown || error.code === "UNAVAILABLE");
    if (!uncertain) {
      if (error instanceof NfseError) Object.assign(error.details, { dpsId: id });
      throw error;
    }

    const found = await this.findByDps(id).catch(() => undefined);
    if (found) return { status: "reconciled", dpsId: id, nfse: found, alerts: [] };

    Object.assign(error.details, { dpsId: id });
    // `null`: a SEFIN confirmou que a DPS não virou nota — nada foi emitido.
    // `undefined`: a consulta também falhou, e o resultado segue incerto.
    Object.assign(error, { outcomeUnknown: found === undefined });
    throw error;
  }

  /** Nota gerada a partir de uma DPS, ou `null` se a DPS não virou nota. */
  async findByDps(id: string): Promise<NationalNfse | null> {
    const url = `${this.hosts.sefin}/dps/${id}`;
    const response = await this.call(url);
    if (response.status === 404) return null;
    const body = this.unwrap<{ chaveAcesso?: string }>(url, response);
    return body.chaveAcesso ? this.get(body.chaveAcesso) : null;
  }

  async get(accessKey: string): Promise<NationalNfse> {
    const body = await this.json<{ nfseXmlGZipB64?: string }>(
      `${this.hosts.sefin}/nfse/${accessKey}`,
    );
    if (!body.nfseXmlGZipB64) throw new NationalError(`/nfse/${accessKey}`, 200, [], body);
    return parseNationalNfse(unpackXml(body.nfseXmlGZipB64));
  }

  /**
   * A NFS-e e todos os seus eventos (cancelamento, substituição...), numa
   * consulta só ao ADN. Só alcança notas em que o CNPJ do certificado aparece.
   */
  async withEvents(accessKey: string): Promise<{ xml: string; events: NationalEvent[] }> {
    const url = `${this.hosts.adn}/contribuintes/NFSe/${accessKey}/Eventos`;
    const body = await this.json<{
      LoteDFe?: { ChaveAcesso: string; TipoDocumento: string; ArquivoXml: string }[];
    }>(url);
    const documents = (body.LoteDFe ?? []).map((d) => ({ type: d.TipoDocumento, xml: unpackXml(d.ArquivoXml) }));
    const nfse = documents.find((d) => d.type === "NFSE");
    if (!nfse) {
      throw new NationalError(new URL(url).pathname, 200, [], body, {
        code: "UNEXPECTED_RESPONSE",
        retryable: false,
      });
    }
    return {
      xml: nfse.xml,
      events: documents.filter((d) => d.type !== "NFSE").map((d) => parseNationalEvent(d.xml)),
    };
  }

  /**
   * DANFSe v2.0 em PDF, gerado aqui a partir do XML (NT 008): a API nacional
   * que o gerava foi suspensa em 03/08/2026. Os eventos da nota decidem a
   * marca d'água — CANCELADA ou SUBSTITUÍDA —, então um PDF nunca sai limpo
   * para uma nota que já não vale.
   */
  async pdf(accessKey: string): Promise<Buffer> {
    const { xml, events } = await this.withEvents(accessKey);
    return Buffer.from(await renderDanfse(xml, { status: danfseStatus(events) }));
  }

  /**
   * Cancela pelo evento 101101. Devolve o XML do evento registrado.
   * Fora do prazo do município, a SEFIN recusa e pede análise fiscal (evento 101103).
   */
  async cancel(
    accessKey: string,
    reason: NationalCancellationReason,
    justification: string,
  ): Promise<string> {
    const event = buildCancellationEvent({
      environment: this.environmentCode,
      cnpj: this.options.cnpj,
      accessKey,
      reason,
      justification,
    });
    return this.registerEvent(accessKey, 101101, event);
  }

  /**
   * Manifesta-se sobre uma nota: confirma ou rejeita, como prestador, tomador ou
   * intermediário. O CNPJ do certificado precisa ser o dessa parte na nota; a SEFIN
   * recusa o resto. Devolve o XML do evento registrado.
   */
  async manifest(
    accessKey: string,
    options: Omit<ManifestationInput, "environment" | "cnpj" | "accessKey">,
  ): Promise<string> {
    const { xml, eventCode } = buildManifestationEvent({
      ...options,
      environment: this.environmentCode,
      cnpj: this.options.cnpj,
      accessKey,
    });
    return this.registerEvent(accessKey, eventCode, xml);
  }

  private async registerEvent(accessKey: string, eventCode: number, event: string): Promise<string> {
    const signed = this.options.signer.sign(event, {
      referenceXPath: "//*[local-name(.)='infPedReg']",
      id: `PRE${accessKey}${eventCode}`,
      targetXPath: "/*",
    });
    this.log("pedRegEvento", signed);

    const body = await this.json<{ eventoXmlGZipB64?: string }>(
      `${this.hosts.sefin}/nfse/${accessKey}/eventos`,
      { method: "POST", json: { pedidoRegistroEventoXmlGZipB64: packXml(signed) } },
    );
    return body.eventoXmlGZipB64 ? unpackXml(body.eventoXmlGZipB64) : "";
  }

  /**
   * Documentos em que o CNPJ do certificado aparece — emitidos e recebidos,
   * inclusive os que o município compartilha a partir do sistema próprio.
   * Lê a partir do NSU informado, em lotes de até 50.
   */
  async distribution(fromNsu = 0): Promise<DistributedDocument[]> {
    // Sem `cnpjConsulta` o ADN de produção responde 400 REJEICAO (TipoConsulta
    // "InscricaoCertificado", sem mensagem de erro) mesmo com certificado válido; com o CNPJ
    // do próprio certificado a consulta funciona (TipoConsulta "CnpjBase").
    const url = `${this.hosts.adn}/contribuintes/DFe/${fromNsu}?cnpjConsulta=${digitsOnly(this.options.cnpj)}&lote=true`;
    const response = await this.call(url);
    if (response.status === 404) return [];
    const body = this.unwrap<{
      LoteDFe?: { NSU: number; ChaveAcesso: string; TipoDocumento: string; ArquivoXml: string }[];
    }>(url, response);
    return (body.LoteDFe ?? []).map((d) => ({
      nsu: d.NSU,
      accessKey: d.ChaveAcesso,
      type: d.TipoDocumento,
      xml: unpackXml(d.ArquivoXml),
    }));
  }

  /**
   * Notas que **outros emitiram contra o seu CNPJ** (serviços tomados), lidas da
   * distribuição do ADN a partir de um NSU. Devolve também `nextNsu`: guarde-o e
   * passe como `fromNsu` na próxima chamada para ler só o que é novo.
   *
   * Cada página da distribuição traz até 50 documentos, entre notas e eventos, emitidos
   * e recebidos; aqui só ficam as notas em que o tomador é o certificado e o emitente é
   * outro. `maxPages` limita a leitura de uma vez (padrão 20, mil documentos): se
   * parou no limite, `complete` é falso e `nextNsu` continua de onde parou.
   */
  async received(
    fromNsu = 0,
    { maxPages = 20 }: { maxPages?: number } = {},
  ): Promise<{ invoices: NationalNfse[]; nextNsu: number; complete: boolean }> {
    const own = digitsOnly(this.options.cnpj);
    const invoices: NationalNfse[] = [];
    let cursor = fromNsu;
    for (let page = 0; page < maxPages; page++) {
      const batch = await this.distribution(cursor);
      if (batch.length === 0) return { invoices, nextNsu: cursor, complete: true };
      for (const document of batch) {
        if (document.type !== "NFSE") continue;
        let nfse: NationalNfse;
        try {
          nfse = parseNationalNfse(document.xml);
        } catch {
          continue;
        }
        if (digitsOnly(nfse.takerTaxId ?? "") === own && digitsOnly(nfse.issuerCnpj ?? "") !== own) {
          invoices.push(nfse);
        }
      }
      cursor = Math.max(...batch.map((d) => d.nsu)) + 1;
    }
    return { invoices, nextNsu: cursor, complete: false };
  }

  private signDps(rps: Rps, options: NationalIssueOptions): { id: string; xml: string } {
    const context: DpsContext = {
      environment: this.environmentCode,
      cnpj: this.options.cnpj,
      cityCode: this.options.cityCode,
      ...options,
    };
    const id = dpsId(context);
    const xml = this.options.signer.sign(buildDps(rps, context), {
      referenceXPath: "//*[local-name(.)='infDPS']",
      id,
      targetXPath: "/*",
    });
    this.log("DPS", xml);
    return { id, xml };
  }

  private call(url: string, init: { method?: "GET" | "POST"; json?: unknown } = {}) {
    const transport = this.options.transport ?? callNational;
    return transport(url, { certificate: this.options.certificate, ...init });
  }

  private async json<T>(url: string, init: { method?: "GET" | "POST"; json?: unknown } = {}) {
    return this.unwrap<T>(url, await this.call(url, init));
  }

  private unwrap<T>(url: string, response: NationalResponse): T {
    if (response.status < 200 || response.status >= 300) throw this.failure(url, response);
    const body = parseJson<T>(response);
    if (body === null) throw this.failure(url, response);
    this.log(`← ${url}`, JSON.stringify(body).slice(0, 2000));
    return body;
  }

  private failure(url: string, response: NationalResponse): NationalError {
    const body = parseJson<Record<string, unknown>>(response) ?? response.body.toString("utf8");
    const messages =
      typeof body === "object" ? messagesOf(body["erros"] ?? body["erro"] ?? body["Erros"]) : [];
    return new NationalError(new URL(url).pathname, response.status, messages, body);
  }

  private log(label: string, content: string): void {
    if (this.options.debug) console.error(`\n--- ${label} ---\n${content}`);
  }
}

interface RawRate {
  Incidencia?: string;
  Aliq?: number;
  DtIni: string;
  DtFim?: string | null;
}
interface RawRegime {
  situacao: number;
  dataInicio: string;
  dataFim?: string | null;
  observacoes?: string | null;
}

const toServiceRate = (raw: RawRate): ServiceRate => ({
  incidence: raw.Incidencia,
  rate: raw.Aliq,
  from: raw.DtIni,
  to: raw.DtFim ?? undefined,
});

/**
 * A API de parâmetros pede o código completo do serviço com pontos, como
 * `01.09.02.001`: seis dígitos nacionais mais três do município. Sem os pontos ou
 * só com seis dígitos ela responde "o código deve ter nove dígitos".
 */
export function parameterServiceCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 9) {
    throw new ValidationError(
      `Código de serviço com 9 dígitos (6 nacionais + 3 do município, ex.: 01.09.02.001): recebi "${code}"`,
    );
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`;
}

/** A API alterna `Codigo`/`codigo` e lista/objeto único conforme a rota. */
function messagesOf(value: unknown): ServiceMessage[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item: Record<string, unknown>) => ({
    code: String(item["Codigo"] ?? item["codigo"] ?? ""),
    message: String(item["Descricao"] ?? item["descricao"] ?? ""),
    correction: (item["Complemento"] ?? item["complemento"]) as string | undefined,
  }));
}
