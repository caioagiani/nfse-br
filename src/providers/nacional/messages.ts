import { NotSupportedError, ValidationError } from "../../domain/errors.ts";
import type { Address, ForeignAddress, ForeignTrade, Rps, ServiceTaker } from "../../domain/types.ts";
import {
  amount,
  digitsOnly,
  element,
  group,
  isoDate,
  requiredGroup,
  unescapeXml,
  xmlDocument,
} from "../../infra/xml.ts";

/**
 * Mensagens do Sistema Nacional NFS-e — leiaute v1.01 (Anexo I da SE/CGNFS-e).
 *
 * A DPS (Declaração de Prestação de Serviço) faz o papel do RPS: o contribuinte
 * declara, a SEFIN Nacional valida e devolve a NFS-e. É montada a partir do
 * mesmo `Rps` que o GissOnline recebe, para que perfil, catálogo e opções do
 * CLI sirvam aos dois emissores sem duplicação.
 */
export const NATIONAL_NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
export const NATIONAL_VERSION = "1.01";
const APPLICATION = "nfse-br";

/** 1 = produção, 2 = produção restrita (o "homologação" do nacional). */
export type NationalEnvironment = 1 | 2;

/** 1 = não optante, 2 = MEI, 3 = ME/EPP. */
export type SimplesOption = 1 | 2 | 3;

export interface DpsContext {
  environment: NationalEnvironment;
  cnpj: string;
  /** Município do emitente — o `cLocEmi` */
  cityCode: string;
  series: string | number;
  number: string | number;
  simplesOption: SimplesOption;
  /** Regime de apuração do Simples: 1 = tudo pelo SN (padrão para ME/EPP) */
  simplesApportionment?: 1 | 2 | 3;
  issueDate?: Date;
}

/**
 * Identificador da DPS: "DPS" + município (7) + tipo de inscrição (1, 2 = CNPJ)
 * + inscrição (14) + série (5) + número (15). É por ele que a SEFIN reconhece
 * um reenvio — a mesma DPS nunca gera duas notas.
 */
export function dpsId(context: Pick<DpsContext, "cityCode" | "cnpj" | "series" | "number">): string {
  return (
    "DPS" +
    context.cityCode +
    "2" +
    digitsOnly(context.cnpj).padStart(14, "0") +
    String(context.series).padStart(5, "0") +
    String(context.number).padStart(15, "0")
  );
}

/**
 * Data e hora com o fuso de Brasília, no formato que o XSD aceita
 * (`-03:00`, nunca `Z`). Recua um minuto: relógio local adiantado em relação
 * ao da SEFIN faz a DPS ser recusada como emitida no futuro.
 */
export function brasiliaDateTime(date = new Date()): string {
  const shifted = new Date(date.getTime() - 3 * 3_600_000 - 60_000);
  return `${shifted.toISOString().slice(0, 19)}-03:00`;
}

/** Item da LC 116 ("01.09" ou "01.09.01") → código de tributação nacional (6 dígitos). */
export function nationalTaxCode(serviceListItem: string): string {
  const parts = serviceListItem.split(".").map((p) => p.padStart(2, "0"));
  if (parts.length === 2) parts.push("01");
  const code = parts.join("");
  if (!/^\d{6}$/.test(code)) {
    throw new ValidationError(
      `Item da lista "${serviceListItem}" não vira um cTribNac de 6 dígitos`,
      { provider: "nacional", details: { serviceListItem } },
    );
  }
  return code;
}

/**
 * `ExigibilidadeISS` do ABRASF → `tribISSQN` nacional. As tabelas não se
 * sobrepõem: isenção, por exemplo, deixa de ser exigibilidade e vira benefício
 * municipal — não há conversão honesta, então falha.
 */
const TAXABILITY: Record<number, number> = { 1: 1, 2: 4, 4: 3, 5: 2 };

/** `RegimeEspecialTributacao` do ABRASF → `regEspTrib` nacional. MEI e ME/EPP saem do regime especial. */
const SPECIAL_REGIME: Record<number, number> = { 1: 3, 2: 2, 3: 6, 4: 1, 5: 0, 6: 0 };

export function buildDps(rps: Rps, context: DpsContext): string {
  const id = dpsId(context);
  const issuedAt = brasiliaDateTime(context.issueDate);
  const { service } = rps;
  const values = service.amounts;

  assertSupported(rps);

  const taxability = TAXABILITY[service.issTaxability];
  if (taxability === undefined) {
    throw new NotSupportedError(
      `Exigibilidade ${service.issTaxability} não tem equivalente direto no padrão nacional`,
      { provider: "nacional", details: { issTaxability: service.issTaxability } },
    );
  }

  const simplesMeEpp = context.simplesOption === 3;
  const apportionment = simplesMeEpp ? (context.simplesApportionment ?? 1) : undefined;

  return xmlDocument({
    root: "DPS",
    xmlns: NATIONAL_NAMESPACE,
    attributes: { versao: NATIONAL_VERSION },
    body: [
      requiredGroup(
        "infDPS",
        [
          element("tpAmb", context.environment),
          element("dhEmi", issuedAt),
          element("verAplic", APPLICATION),
          element("serie", String(context.series)),
          element("nDPS", String(context.number)),
          element("dCompet", isoDate(rps.competenceDate)),
          element("tpEmit", 1),
          // Produção restrita (esquemas de 2026-10-20): finNFSe passou a ser
          // obrigatório em infDPS. A produção ainda segue o leiaute de 2026-02-09.
          context.environment === 2 ? element("finNFSe", 0) : undefined,
          element("cLocEmi", context.cityCode),
          group("prest", [
            element("CNPJ", digitsOnly(context.cnpj)),
            // O IM fica de fora: o cadastro nacional já a conhece, e uma
            // divergência de formato com o município recusaria a nota.
            group("regTrib", [
              element("opSimpNac", context.simplesOption),
              element("regApTribSN", apportionment),
              element(
                "regEspTrib",
                rps.specialTaxRegime ? (SPECIAL_REGIME[rps.specialTaxRegime] ?? 0) : 0,
              ),
            ]),
          ]),
          rps.taker && takerGroup(rps.taker),
          group("serv", [
            group("locPrest", [element("cLocPrestacao", String(service.cityCode))]),
            group("cServ", [
              element("cTribNac", nationalTaxCode(service.serviceListItem)),
              // Leiaute de 2026-10-20 (restrita): cNBS vem antes de xDescServ
              ...(context.environment === 2
                ? [element("cNBS", service.nbsCode), element("xDescServ", service.description)]
                : [element("xDescServ", service.description), element("cNBS", service.nbsCode)]),
            ]),
            service.foreignTrade && foreignTradeGroup(service.foreignTrade),
            group("infoCompl", [element("xInfComp", rps.additionalInformation)]),
          ]),
          group("valores", [
            group("vServPrest", [element("vServ", amount(values.services))]),
            group("vDescCondIncond", [
              element("vDescIncond", positive(values.unconditionalDiscount)),
              element("vDescCond", positive(values.conditionalDiscount)),
            ]),
            group("trib", [
              group("tribMun", [
                element("tribISSQN", taxability),
                // 1 = não retido, 2 = retido pelo tomador.
                element("tpRetISSQN", service.issWithheld === 1 ? 2 : 1),
                // ME/EPP que apura tudo pelo Simples não destaca alíquota: ela
                // sai do PGDAS, não da nota. Nos demais casos vai a do perfil.
                simplesMeEpp && apportionment === 1
                  ? undefined
                  : element("pAliq", amount(values.rate)),
              ]),
              group("tribFed", [
                // Como a DPS espelhada pela GissOnline (nota 585): CST e tipo de
                // retenção; base, alíquotas e valores só quando houver.
                values.pisCofins &&
                  group("piscofins", [
                    element("CST", values.pisCofins.cst),
                    element("vBCPisCofins", positive(values.pisCofins.taxableAmount)),
                    element("pAliqPis", positive(values.pisCofins.pisRate)),
                    element("pAliqCofins", positive(values.pisCofins.cofinsRate)),
                    element("vPis", positive(values.pisCofins.pisAmount)),
                    element("vCofins", positive(values.pisCofins.cofinsAmount)),
                    // 0 (não retidos) fica em branco: a Infocus confirmou que não precisa preencher
                    element("tpRetPisCofins", positive(values.pisCofins.withholdingType)),
                  ]),
                element("vRetCP", positive(values.inss)),
                element("vRetIRRF", positive(values.incomeTax)),
                element("vRetCSLL", positive(values.csll)),
              ]),
              group("totTrib", [
                // ME/EPP: a SEFIN recusa o indicador (E0712) — só o percentual do Simples
                simplesMeEpp
                  ? element("pTotTribSN", amount(values.approximateTaxes?.simplesNacional ?? 0))
                  : context.simplesOption !== 1 && values.approximateTaxes?.simplesNacional
                    ? element("pTotTribSN", amount(values.approximateTaxes.simplesNacional))
                    : element("indTotTrib", 0),
              ]),
            ]),
          ]),
        ],
        { Id: id },
      ),
    ],
  });
}

/**
 * O que o RPS do GissOnline aceita e a DPS ainda não leva. Falhar aqui é
 * melhor que emitir uma nota sem o tomador estrangeiro ou sem o intermediário
 * — o envio passaria, e a nota sairia errada.
 */
function assertSupported(rps: Rps): void {
  const missing = [
    rps.intermediary && "intermediário",
    rps.construction && "obra",
    rps.replacedRps && "substituição de nota",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new NotSupportedError(
      `O emissor nacional ainda não monta: ${missing.join(", ")}. Emita pelo GissOnline ou pelo Emissor Nacional web.`,
      { provider: "nacional", details: { unsupported: missing } },
    );
  }
}

function positive(value: number | undefined): string | undefined {
  return value && value > 0 ? amount(value) : undefined;
}

function takerGroup(taker: ServiceTaker): string {
  const abroad = Boolean(taker.nif || taker.foreignAddress || taker.nifAbsentReason !== undefined);
  if (abroad) assertForeignTaker(taker);
  return group("toma", [
    element("CNPJ", taker.cnpj && digitsOnly(taker.cnpj)),
    element("CPF", !taker.cnpj && taker.cpf ? digitsOnly(taker.cpf) : undefined),
    element("NIF", !taker.cnpj && !taker.cpf ? taker.nif : undefined),
    element(
      "cNaoNIF",
      !taker.cnpj && !taker.cpf && !taker.nif ? taker.nifAbsentReason : undefined,
    ),
    element("xNome", taker.legalName),
    taker.address && addressGroup(taker.address),
    taker.foreignAddress && foreignAddressGroup(taker.foreignAddress),
    element("fone", taker.contact?.phone && digitsOnly(taker.contact.phone)),
    element("email", taker.contact?.email),
  ]);
}

/**
 * Tomador no exterior: o XSD pede o NIF ou o motivo de não tê-lo (`cNaoNIF`), e o
 * país no padrão ISO de 2 letras — o código de 4 dígitos do ABRASF não serve aqui.
 */
function assertForeignTaker(taker: ServiceTaker): void {
  const fail = (message: string): never => {
    throw new ValidationError(message, { provider: "nacional", details: { taker: taker.legalName } });
  };
  if (taker.cnpj || taker.cpf) fail("Tomador no exterior não tem CNPJ nem CPF: informe o NIF e o endereço no exterior");
  if (taker.address) fail("Tomador no exterior usa `foreignAddress`, não `address`");
  if (!taker.nif && taker.nifAbsentReason === undefined) {
    fail("Tomador no exterior precisa do `nif` ou do motivo de não tê-lo (`nifAbsentReason`: 0, 1 ou 2)");
  }
  const foreign = taker.foreignAddress;
  if (!foreign) return fail("Tomador no exterior precisa do `foreignAddress`");
  if (!/^[A-Z]{2}$/.test(foreign.countryIso ?? "")) {
    fail("O emissor nacional pede o país no formato ISO de 2 letras: informe `foreignAddress.countryIso` (ex.: \"US\")");
  }
}

function foreignAddressGroup(address: ForeignAddress): string {
  return group("end", [
    group("endExt", [
      element("cPais", address.countryIso),
      element("cEndPost", address.postalCode),
      element("xCidade", address.city),
      element("xEstProvReg", address.region),
    ]),
    // O XSD exige logradouro, número e bairro; o endereço do exterior vem numa linha só,
    // então o número e o bairro têm substitutos quando o chamador não os separa.
    element("xLgr", address.fullAddress),
    element("nro", address.number ?? "S/N"),
    element("xBairro", address.district ?? address.city),
  ]);
}

/** Grupo `comExt`: exportação ou importação de serviço (LC 214/2025). */
function foreignTradeGroup(trade: ForeignTrade): string {
  return group("comExt", [
    element("mdPrestacao", trade.serviceMode),
    element("vincPrest", trade.relationship),
    element("tpMoeda", trade.currency),
    element("vServMoeda", amount(trade.foreignAmount)),
    element("mecAFComexP", trade.providerSupport),
    element("mecAFComexT", trade.takerSupport),
    element("movTempBens", trade.temporaryGoods),
    element("nDI", trade.importDeclaration),
    element("nRE", trade.exportRegistration),
    element("mdic", trade.shareWithMdic),
  ]);
}

function addressGroup(address: Address): string {
  return group("end", [
    group("endNac", [
      element("cMun", String(address.cityCode)),
      element("CEP", digitsOnly(address.zipCode)),
    ]),
    element("xLgr", address.street),
    element("nro", address.number),
    element("xCpl", address.complement),
    element("xBairro", address.district),
  ]);
}

/** 1 = erro na emissão, 2 = serviço não prestado, 9 = outros. */
export type NationalCancellationReason = 1 | 2 | 9;

export interface CancellationInput {
  environment: NationalEnvironment;
  cnpj: string;
  accessKey: string;
  reason: NationalCancellationReason;
  /** Justificativa livre, de 15 a 255 caracteres */
  justification: string;
  eventDate?: Date;
}

/** Evento 101101 — o cancelamento no padrão nacional é um evento sobre a nota. */
export function buildCancellationEvent(input: CancellationInput): string {
  const justification = input.justification.trim();
  if (justification.length < 15 || justification.length > 255) {
    throw new ValidationError(
      "A justificativa do cancelamento precisa ter de 15 a 255 caracteres",
      { provider: "nacional", details: { length: justification.length } },
    );
  }

  return xmlDocument({
    root: "pedRegEvento",
    xmlns: NATIONAL_NAMESPACE,
    attributes: { versao: NATIONAL_VERSION },
    body: [
      requiredGroup(
        "infPedReg",
        [
          element("tpAmb", input.environment),
          element("verAplic", APPLICATION),
          element("dhEvento", brasiliaDateTime(input.eventDate)),
          element("CNPJAutor", digitsOnly(input.cnpj)),
          element("chNFSe", input.accessKey),
          group("e101101", [
            element("xDesc", "Cancelamento de NFS-e"),
            element("cMotivo", input.reason),
            element("xMotivo", justification),
          ]),
        ],
        { Id: `PRE${input.accessKey}101101` },
      ),
    ],
  });
}

export type ManifestationRole = "provider" | "taker" | "intermediary";

/**
 * Motivos de rejeição (`cMotivo`): 1 duplicidade, 2 já emitida pelo tomador, 3 não
 * ocorrência do fato gerador, 4 responsabilidade tributária, 5 valor/serviço/data, 9 outros.
 */
export type RejectionReason = 1 | 2 | 3 | 4 | 5 | 9;

/** Código do evento e `xDesc` que o XSD exige, por quem se manifesta. */
const MANIFESTATION = {
  provider: { confirm: [202201, "Confirmação do Prestador"], reject: [202205, "Rejeição do Prestador"] },
  taker: { confirm: [203202, "Confirmação do Tomador"], reject: [203206, "Rejeição do Tomador"] },
  intermediary: { confirm: [204203, "Confirmação do Intermediário"], reject: [204207, "Rejeição do Intermediário"] },
} as const;

export interface ManifestationInput {
  environment: NationalEnvironment;
  cnpj: string;
  accessKey: string;
  /** Quem se manifesta: o CNPJ do certificado precisa ser o dessa parte na nota */
  role: ManifestationRole;
  action: "confirm" | "reject";
  /** Só na rejeição */
  reason?: RejectionReason;
  /** Só na rejeição, opcional: de 15 a 255 caracteres */
  justification?: string;
  eventDate?: Date;
}

/** Eventos de manifestação sobre uma NFS-e: confirmação ou rejeição pelo prestador, tomador ou intermediário. */
export function buildManifestationEvent(input: ManifestationInput): {
  xml: string;
  eventCode: number;
} {
  const [eventCode, who] = MANIFESTATION[input.role][input.action];
  const rejecting = input.action === "reject";
  const justification = input.justification?.trim();

  if (rejecting && ![1, 2, 3, 4, 5, 9].includes(input.reason as number)) {
    throw new ValidationError("Rejeição precisa de `reason`: 1, 2, 3, 4, 5 ou 9", {
      provider: "nacional",
      details: { reason: input.reason },
    });
  }
  if (!rejecting && (input.reason !== undefined || justification)) {
    throw new ValidationError("`reason` e `justification` só valem na rejeição", { provider: "nacional" });
  }
  if (justification !== undefined && (justification.length < 15 || justification.length > 255)) {
    throw new ValidationError("A justificativa da rejeição precisa ter de 15 a 255 caracteres", {
      provider: "nacional",
      details: { length: justification.length },
    });
  }

  const xml = xmlDocument({
    root: "pedRegEvento",
    xmlns: NATIONAL_NAMESPACE,
    attributes: { versao: NATIONAL_VERSION },
    body: [
      requiredGroup(
        "infPedReg",
        [
          element("tpAmb", input.environment),
          element("verAplic", APPLICATION),
          element("dhEvento", brasiliaDateTime(input.eventDate)),
          element("CNPJAutor", digitsOnly(input.cnpj)),
          element("chNFSe", input.accessKey),
          group(`e${eventCode}`, [
            element("xDesc", `Manifestação de NFS-e - ${who}`),
            element("cMotivo", rejecting ? input.reason : undefined),
            element("xMotivo", rejecting ? justification : undefined),
          ]),
        ],
        { Id: `PRE${input.accessKey}${eventCode}` },
      ),
    ],
  });
  return { xml, eventCode };
}

/** O essencial de uma NFS-e nacional, lido do XML devolvido pela SEFIN ou pelo ADN. */
export interface NationalNfse {
  accessKey: string;
  number?: string;
  /** Número do DF-e no ambiente nacional */
  documentNumber?: string;
  status?: string;
  processedAt?: string;
  competence?: string;
  issuerCnpj?: string;
  issuerName?: string;
  takerTaxId?: string;
  takerName?: string;
  serviceAmount?: number;
  netAmount?: number;
  description?: string;
  issuingCity?: string;
  xml: string;
}

export function parseNationalNfse(xml: string): NationalNfse {
  const text = (tag: string, scope = xml): string | undefined => {
    const match = new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`).exec(scope);
    return match?.[1] === undefined ? undefined : unescapeXml(match[1]);
  };
  const section = (tag: string): string =>
    new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`).exec(xml)?.[0] ?? "";
  const number = (value: string | undefined) =>
    value === undefined ? undefined : Number(value);

  const emitter = section("emit");
  const taker = section("toma");

  return {
    accessKey: /<infNFSe[^>]*Id="NFS(\d{50})"/.exec(xml)?.[1] ?? "",
    number: text("nNFSe"),
    documentNumber: text("nDFSe"),
    status: text("cStat"),
    processedAt: text("dhProc"),
    competence: text("dCompet"),
    issuerCnpj: text("CNPJ", emitter),
    issuerName: text("xNome", emitter),
    takerTaxId: text("CNPJ", taker) ?? text("CPF", taker),
    takerName: text("xNome", taker),
    serviceAmount: number(text("vServ")),
    netAmount: number(text("vLiq")),
    description: text("xDescServ"),
    issuingCity: text("xLocEmi"),
    xml,
  };
}

/** Evento de uma NFS-e (cancelamento, substituição...), como o ADN o distribui. */
export interface NationalEvent {
  /** Tipo do evento: 101101 cancelamento, 105102 cancelamento por substituição... */
  code?: string;
  description?: string;
  /** Chave da NFS-e a que o evento se refere */
  accessKey?: string;
  /** Número da NFS-e, tirado da chave */
  nfseNumber?: string;
  /** Chave da nota substituta, nos cancelamentos por substituição */
  replacementKey?: string;
  reason?: string;
  /** Quando o autor pediu o evento */
  requestedAt?: string;
  processedAt?: string;
  xml: string;
}

export function parseNationalEvent(xml: string): NationalEvent {
  const text = (tag: string): string | undefined => {
    const match = new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`).exec(xml);
    return match?.[1] === undefined ? undefined : unescapeXml(match[1].trim());
  };
  const accessKey = text("chNFSe");
  return {
    code: /<(?:\w+:)?e(\d{6})>/.exec(xml)?.[1],
    description: text("xDesc"),
    accessKey,
    nfseNumber: accessKey ? nfseNumberFromKey(accessKey) : undefined,
    replacementKey: text("chSubstituta"),
    reason: text("xMotivo"),
    requestedAt: text("dhEvento"),
    processedAt: text("dhProc"),
    xml,
  };
}

/**
 * Número da NFS-e dentro da chave de acesso: município (7), ambiente (1),
 * tipo de inscrição (1), CNPJ/CPF (14) e então o número, com 13 dígitos.
 */
export function nfseNumberFromKey(accessKey: string): string | undefined {
  if (!/^\d{50}$/.test(accessKey)) return undefined;
  return String(Number(accessKey.slice(23, 36)));
}
