# National issuer: rejection codes

The map for whoever integrates. A rejection is **definitive**: the SEFIN refused the DPS
and nothing was issued, so repeating the same request changes nothing until the data
does. A network failure with no answer is the opposite case, and is covered in
[errors.md](errors.md) (`reconciled`, `outcomeUnknown`).

```ts
import { NationalError, describeNationalCode } from "nfse-br";

try {
  await client.issue(invoice);
} catch (error) {
  if (!(error instanceof NationalError)) throw error;
  for (const { code, message } of error.messages) {
    // the field the rule is about, from the official catalog
    console.log(code, message, describeNationalCode(code)?.fields);
  }
}
```

`describeNationalCode(code)` returns the official text and, when the rule is about one
field, its XML path. It returns `undefined` for a code that is not in the catalog.

## Seen on the live service

These came back from the real SEFIN while this client was built (Suzano, Simples
Nacional, 2026-11-13). What each one asked for is in [national.md](national.md).

| Code | What it means here | What to do |
| --- | --- | --- |
| `E0039` | the city is not parameterised for the national issuers | an ME/EPP apportioned through the Simples with competence on or after 2026-11-01 is exempt (RN 239), so check the competence; otherwise issue through the city system (`--issuer giss`) |
| `E0625` | an ISS rate was sent without withholding (ME/EPP) | do not send `pAliq`; only with `tpRetISSQN` ≠ 1 is it required |
| `E0712` | `indTotTrib` was sent by an ME/EPP | send `pTotTribSN` instead |
| `E1235` | the XML failed the schema | validate against the XSD of the environment: the restricted one follows a newer layout (`schemas/nacional-restrita/`) |

## Reading the catalog

- `E12xx`: the transmission itself, before any business rule: certificate (`E1200`–`E1209`,
  with `E1203` for an expired one), compression and encoding (`E1225`–`E1229`), schema
  (`E1235`) and layout version (`E1260`).
- `E0xxx` and `E16xx`: the DPS content, field by field. The **Field** column says which.
- The catalog is the one in the annex of NT 009 (layout 1.04.01). It is the **new** layout:
  a code may not apply to production yet, and production may answer with one that is not
  here. Treat the service's own `message` as the truth, and this table as a map.

## All codes

Source: Annex VI of NT 009 SE/CGNFS-e v1.04.01, sheets "RN DPS_NFS-e" and
"RN_RECEPCAO_DPS". Generated, 492 codes.

| Code | Message | Field |
| --- | --- | --- |
| `E0001` | O prazo de aceitação da versão do leiaute da DPS expirou. | `NFSe/infNFSe/DPS/versao` |
| `E0004` | Conteúdo do identificador informado na DPS difere da concatenação dos campos correspondentes. | `NFSe/infNFSe/DPS/infDPS/id` |
| `E0006` | Ambiente informado diverge do ambiente de recebimento para o qual o emitente enviou a DPS. | `NFSe/infNFSe/DPS/infDPS/tpAmb` |
| `E0008` | A data e hora de emissão da DPS deve ser anterior ou igual à data do seu processamento (dhProc) pelo Sistema Nacional NFS-e. | `NFSe/infNFSe/DPS/infDPS/dhEmi` |
| `E0010` | A série informada na DPS não pertence à faixa definida para o tipo de emissor utilizado para a sua emissão. | `NFSe/infNFSe/DPS/infDPS/serie` |
| `E0014` | Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada a partir de uma DPS enviada anteriormente. |  |
| `E0015` | A data de competência informada na DPS não pode ser posterior à data de emissão (dhEmi) da DPS. | `NFSe/infNFSe/DPS/infDPS/dCompet` |
| `E0016` | A data de competência deve ser igual ou posterior à data de ativação do convênio do município emissor informado na DPS, exceto quando o emitente for MEI na data de competência informada. |  |
| `E0018` | A data de competência informada na DPS deve ser igual ou posterior à data de inscrição do CNPJ do emitente no cadastro CNPJ. |  |
| `E0020` | A data de competência informada na DPS deve ser igual ou posterior à data de inscrição do CPF do emitente no cadastro CPF. |  |
| `E0023` | A data de competência informada na DPS deve ser igual ou posterior à data do indicador municipal, registrada no CNC do município correspondente ao município emissor da DPS (cLocEmi). |  |
| `E0025` | A data de competência informada na DPS deve ser igual ou posterior à data autorização de uso do emissores, registrada no CNC do município correspondente ao município emissor da DPS (cLocEmi) para o contribuinte. |  |
| `E0027` | Em caso de importação de serviço o emitente da DPS dever ser obrigatoriamente o tomador/adquirente ou intermediário. |  |
| `E0029` | O motivo da emissão não pode ser preenchido se o emitente for o prestador de serviço. | `NFSe/infNFSe/DPS/infDPS/cMotivoEmisTI` |
| `E0031` | Se o emitente for o tomador/adquirente ou intermediário de serviço (tpEmit = 2 ou 3, respectivamente), então este campo deve ser preenchido obrigatoriamente somente pelo valor 1 - Importação de Serviço. |  |
| `E0034` | Não é permitido informar nenhuma chave de acesso de NFSe. | `NFSe/infNFSe/DPS/infDPS/chNFSeRej` |
| `E0037` | O código do município emissor informado na DPS é inexistente no cadastro de convênio municipal do sistema nacional. | `NFSe/infNFSe/DPS/infDPS/cLocEmi` |
| `E0038` | A situação do convênio do município emissor informado na DPS deve ser "ATIVO" no cadastro de convênio municipal do sistema nacional. |  |
| `E0039` | O município emissor informado na DPS deve estar parametrizado para utilizar os emissores públicos nacionais, conforme parametrização do município no Sistema Nacional NFS-e, exceto quando o emitente for MEI ou ME/EPP apurando o ISSQN pelo Simples Nacional, quando a data de competência informada na DPS for igual ou posterior à 01/11/2026. |  |
| `E0041` | O município emissor não corresponde ao município do emitente MEI no CNPJ. |  |
| `E0042` | Chave de NFS-e a ser substituída é inválida. | `NFSe/infNFSe/DPS/infDPS/substchSubstda` |
| `E0044` | NFS-e não existe na base de dados do autorizador de NFS-e nacional. Informe uma chave de NFS-e existente. |  |
| `E0046` | Uma NFS-e cancelada não pode ser substituída. Informe uma chave de NFS-e não cancelada anteriormente. |  |
| `E0050` | Uma NFS-e não pode ser substituída fora do prazo estabelecido pelo município emissor da NFS-e. |  |
| `E0056` | NFS-e não pode ser substituída pois não possui identificação do tomador. |  |
| `E0058` | Não poderá ocorrer a substituição de NFS-e com alteração da identificação do não emitente, conforme parametrização do município emissor da NFS-e. |  |
| `E0059` | Os campos data de competência (dCompet), subitem da lista nacional de serviços (cTribNac), código complementar municipal (cTribMun) e local da prestação (cLocPrestacao), não podem ser alterados quando a opção do simples nacional for Não Optante (opSimpNac = 1), se a opção do simples nacional continuar como Não Optante (opSimpNac = 1) na data de competência da nota substituta. |  |
| `E0060` | Os campos data de competência (dCompet), identificação do Tomador (se identificado na DPS da nota original (CPF/CNPJ/NIF)) e valor do serviço (vServ), não podem ser alterados quando a opção do simples nacional for: 1) Não Optante (opSimpNac = 1) na nota original e a opção do simples nacional mudar para MEI (opSimpNac = 2) ou ME/EPP (opSimpNac = 3) na data de competência da nota substituta. |  |
| `E0061` | Os campos data de competência (dCompet), identificação do Tomador (se identificado na DPS da nota original (CPF/CNPJ/NIF)) e valor do serviço (vServ), não podem ser alterados quando a opção do simples nacional for: 1) MEI (opSimpNac = 2) na nota original e a opção do simples nacional continuar como MEI (opSimpNac = 2) ou ME/EPP (opSimpNac = 3), na data de competência da nota substituta. |  |
| `E0062` | Os campos data de competência (dCompet), subitem da lista nacional de serviços (cTribNac), código complementar municipal (cTribMun) e local da prestação (cLocPrestacao), não podem ser alterados quando a opção do simples nacional for: 1) MEI (opSimpNac = 2) na nota original e a opção do simples nacional mudar para Não Optante (opSimpNac = 1), na data de competência da nota substituta. |  |
| `E0063` | Os campos data de competência (dCompet), identificação do Tomador (se identificado na DPS da nota original (CPF/CNPJ/NIF)) e valor do serviço (vServ), não podem ser alterados quando a opção do simples nacional for: 1) ME/EPP (opSimpNac = 3) na nota original e a opção do simples nacional continuar como ME/EPP (opSimpNac = 3) ou mudar para MEI (opSimpNac = 2), na data de competência da nota substituta. |  |
| `E0064` | Os campos data de competência (dCompet), subitem da lista nacional de serviços (cTribNac), código complementar municipal (cTribMun) e local da prestação (cLocPrestacao), não podem ser alterados quando a opção do simples nacional for: 1) ME/EPP (opSimpNac = 3) na nota original e a opção do simples nacional mudar para Não Optante (opSimpNac = 1), na data de competência da nota substituta. |  |
| `E0065` | Não é possível substituição da NFS-e que tenha sido gerada em ambientes geradores diferentes. |  |
| `E0066` | Não é permitido cancelar esta NFS-e por substituição, pois há um bloqueio do Evento de Cancelamento de NFS-e ativo para este evento, definido pelo município emissor da NFS-e, que abrange o período de competência da nota. |  |
| `E0068` | Não é possível a substituição desta NFS-e pois a mesma possui registro de Evento de Solicitação de Análise Fiscal para Cancelamento de NFS-e aguardando resposta. Para mais informações, consultar a Administração Tributária Municipal do município emissor da NFS-e. |  |
| `E0070` | Não é possível a substituição desta NFS-e pois já ocorreu uma manifestação de confirmação de serviço. Para mais informações, consultar a Administração Tributária Municipal do município emissor da NFS-e. |  |
| `E0072` | Não é possível a substituição desta NFS-e pois já ocorreu uma manifestação tácita da NFS-e. Para mais informações, consultar a Administração Tributária Municipal do município emissor da NFS-e. |  |
| `E0074` | Não é permitido realizar a substituição para NFS-e que possua Evento de Tributos Recolhidos vinculado, conforme parametrização do município de incidência do ISSQN. Para mais informações, consultar a Administração Tributária Municipal do município emissor da NFS-e. |  |
| `E0076` | Não é permitido realizar a substituição para NFS-e que possua Evento de Bloqueio de Ofício para o Evento de Cancelamento de NFS-e por Substituição vigente. |  |
| `E0078` | Quando o campo cMotivo = 99, o campo xMotivo deve informado obrigatoriamente. | `NFSe/infNFSe/DPS/infDPS/substxMotivo` |
| `E0080` | CNPJ do prestador informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/prest/CNPJ` |
| `E0082` | CNPJ do emitente prestador não encontrado no cadastro CNPJ na data de competência. |  |
| `E0084` | CNPJ do emitente prestador não possui estabelecimento ou domicílio em um município correspondente ao município emissor, na data de competência informada na DPS, conforme cadastros CNPJ e CNC NFS-e. |  |
| `E0086` | O CNPJ do prestador de serviço não pode ser informado na DPS pois o emitente da NFS-e é o tomador/adquirente ou intermediário. Trata-se de uma NFS-e de importação de serviço e o prestador deve ser identificado pelo NIF. |  |
| `E0096` | CPF do prestador informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/prest/CPF` |
| `E0098` | CPF do emitente prestador não encontrado no cadastro CPF na data de competência. |  |
| `E0099` | CPF do emitente prestador não possui estabelecimento ou domicílio em um município correspondente ao município emissor, na data de competência informada na DPS, conforme cadastro nacional complementar NFS-e (cLocEmi + CPF + IM informados na DPS para o prestador devem existir no CNC NFS-e). |  |
| `E0109` | o CPF do prestador de serviço não pode ser informado na DPS pois o emitente da NFS-e é o tomador/adquirente ou intermediário. Trata-se de uma NFS-e de importação de serviço e o prestador deve ser identificado pelo NIF. |  |
| `E0112` | O prestador de serviço, quando emitente da DPS, não pode ser identificado pelo NIF. | `NFSe/infNFSe/DPS/infDPS/prest/NIF` |
| `E0113` | O NIF ou cNaoNIF do prestador deve ser informado quando o grupo de informações de endereço no exterior do prestador de serviços foi informado. |  |
| `E0114` | O prestador de serviço, quando emitente da DPS, somente pode ser identificado pelo CNPJ ou CPF. |  |
| `E0115` | Valor 0 para o motivo da não informação do NIF do prestador não é permitido na Sefin do Sistema Nacional NFS-e. |  |
| `E0116` | A IM deve ser informada para o emitente prestador do serviço na DPS, conforme informações complementares registradas no CNC NFS-e do município emissor informado na DPS. | `NFSe/infNFSe/DPS/infDPS/prest/IM` |
| `E0119` | IM do emitente prestador não está autorizado a emitir NFS-e, conforme informações complementares registradas no CNC NFS-e do município emissor informado na DPS. |  |
| `E0120` | IM do prestador não deve ser informado, pois não existem informações complementares registradas no CNC NFS-e do município emissor informado na DPS. |  |
| `E0121` | O nome ou razão social do prestador não deve ser informado quando o emitente da DPS for o próprio prestador. | `NFSe/infNFSe/DPS/infDPS/prest/xNome` |
| `E0122` | O nome ou razão social do prestador deve ser informado quando o emitente da DPS não for o próprio prestador. |  |
| `E0123` | O preenchimento do nome empresarial é obrigatório quando o prestador for identificado com NIF. |  |
| `E0124` | O grupo de informações de endereço nacional não pode ser informado quando o emitente da NFS-e for o tomador/adquirente ou intermediário do serviço (tpEmit = 2 ou 3). | `NFSe/infNFSe/DPS/infDPS/prest/end/endNac` |
| `E0125` | O IM informado está inativo no CNC NFS-e do município emissor para a data de competência informada na DPS. |  |
| `E0128` | O endereço do prestador do serviço não deve ser informado na DPS quando o próprio prestador for o emitente da DPS. |  |
| `E0129` | O endereço do prestador deve ser informado na DPS quando o prestador não for o emitente da DPS. | `NFSe/infNFSe/DPS/infDPS/prest/end` |
| `E0130` | O código do município para o endereço do prestador do serviço não existe conforme tabela de município do IBGE. | `NFSe/infNFSe/DPS/infDPS/prest/end/endNac/cMun` |
| `E0132` | O código do município informado na DPS para o endereço do prestador do serviço, identificado pelo CNPJ, não corresponde ao município registrado em seus cadastros na data de competência informada na DPS. |  |
| `E0134` | O código do município informado na DPS para o endereço do prestador do serviço, identificado pelo CPF, não corresponde ao município registrado em seus cadastros na data de competência informada na DPS. |  |
| `E0138` | O CEP informado para o endereço nacional do prestador do serviço não existente ou não pertence ao município informado na DPS. Informe um CEP existente e que pertença ao município informado para o endereço do prestador do serviço na DPS. | `NFSe/infNFSe/DPS/infDPS/prest/end/endNac/CEP` |
| `E0142` | O grupo de informações de endereço no exterior deve ser informado obrigatoriamente quando o emitente da NFS-e for o tomador/adquirente ou intermediário do serviço (tpEmit = 2 ou 3). | `NFSe/infNFSe/DPS/infDPS/prest/end/endExt` |
| `E0146` | O código de país informado para o endereço no exterior do prestador do serviço não existe ou é igual ao código do Brasil. Informe um código de país existente e diferente do código do Brasil (BR) para o endereço no exterior do prestador do serviço, conforme tabela de país do ANEXO_A-MUNICIPIO_IBGE-PAISES_ISO2-SNNFSe-ESPEC. | `NFSe/infNFSe/DPS/infDPS/prest/end/endExt/cPais` |
| `E0148` | Email inválido. | `NFSe/infNFSe/DPS/infDPS/prest/email` |
| `E0160` | No mês de competência da NFS-e, a opção de situação perante o Simples Nacional, do prestador, informada na DPS não está de acordo com o cadastro Simples Nacional. | `NFSe/infNFSe/DPS/infDPS/prest/regTrib/opSimpNac` |
| `E0161` | NFS-e cujo emitente for MEI (opSimpNac = 2) somente poderá ser compartilhada pelo município com o ADN se a data de competência, informada na NFS-e, for menor ou igual a 31/08/2023. |  |
| `E0162` | Não é permitido ao não optante do Simples Nacional e o MEI preencherem o campo de indicação do regime de apuração dos tributos apurados. | `NFSe/infNFSe/DPS/infDPS/prest/regTrib/regApTribSN` |
| `E0163` | NFS-e cujo emitente for ME/EPP (opSimpNac = 3) somente poderá ser compartilhada pelo município com o ADN se a data de competência, informada na NFS-e, for menor ou igual a 01/11/2026. |  |
| `E0166` | É obrigatório o preenchimento do campo de regime de apuração dos tributos do SN para o optante do Simples Nacional ME/EPP ou com opção Pendente. |  |
| `E0172` | O Regime Especial de Tributação deve ser "Nenhum" (regEspTrib = 0) quando o serviço prestado for diferente de Tributável (tribISSQN = 1), ou seja, tribISSQN = 2, 3 ou 4. | `NFSe/infNFSe/DPS/infDPS/prest/regTrib/regEspTrib` |
| `E0174` | Quando o prestador da NFS-e é MEI (opSimpNac = 2) o regime especial de tributação deve ser "Nenhum" (regEspTrib = 0). |  |
| `E0175` | Quando o prestador optante pelo Simples Nacional tiver o regime de apuração dos tributos ocorrendo também pelo Simples Nacional, o regime especial de tributação do ISSQN deve ser "Nenhum" (regEspTrib = 0). |  |
| `E0176` | É permitido informar Profissional Autônomo na DPS somente se o prestador de serviço estiver parametrizado como Profissional Autônomo, na data de competência informada na DPS, em pelo menos um dos municípios, emissor ou de incidência do ISSQN (cLocIncid ou cLocEmi) ou se estiver admitido sem verificação (parâmetro "Informado na DPS pelo Emitente - Sem verificação"), conforme parametrização do município de incidência do ISSQN na data de competência informada na DPS. |  |
| `E0177` | Regime especial de tributação informado na DPS não é admitido na parametrização do município de incidência do ISSQN. |  |
| `E0178` | Regime especial de tributação não permitido para o prestador do serviço com código de tributação na data de competência, informados na DPS, conforme parametrização do município de incidência do ISSQN. |  |
| `E0188` | CNPJ do tomador informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/toma/CNPJ` |
| `E0190` | CNPJ do tomador não encontrado no cadastro CNPJ. |  |
| `E0194` | CNPJ do emitente tomador não possui estabelecimento ou domicílio em um município correspondente ao município emissor, na data de competência informada na DPS, conforme cadastros CNPJ e CNC NFS-e. |  |
| `E0202` | Na emissão da NFS-e não é permitido que o prestador do serviço seja igual ao tomador do serviço. |  |
| `E0204` | CNPJ ou CPF do tomador não foi informado, mas existe uma indicação para retenção do ISSQN na DPS no campo de tipo de "Retenção do ISSQN". |  |
| `E0206` | CPF do tomador informado na DPS é inválido. |  |
| `E0207` | CPF do tomador não encontrado no cadastro CPF. |  |
| `E0212` | CPF do emitente tomador não possui estabelecimento ou domicílio em um município correspondente ao município emissor, na data de competência informada na DPS, conforme cadastros CPF e CNC NFS-e. |  |
| `E0222` | O tomador de serviço, quando emitente da DPS, não pode ser identificado pelo NIF. | `NFSe/infNFSe/DPS/infDPS/toma/NIF` |
| `E0223` | O NIF ou cNaoNIF do tomador deve ser informado quando o grupo de informações de endereço no exterior do tomador de serviços foi informado. |  |
| `E0224` | O tomador de serviço, quando emitente da DPS, somente pode ser identificado pelo CNPJ ou CPF. |  |
| `E0225` | O nome ou razão social do tomador/adquirente não pode ser informado quando o emitente da DPS for o próprio tomador/adquirente. | `NFSe/infNFSe/DPS/infDPS/toma/xNome` |
| `E0226` | Valor 0 para o motivo da não informação do NIF do tomador não é permitido na Sefin do Sistema Nacional NFS-e. |  |
| `E0228` | A IM deve ser informada para o emitente tomador do serviço na DPS, conforme informações complementares registradas no CNC NFS-e do município emissor informado na DPS. | `NFSe/infNFSe/DPS/infDPS/toma/IM` |
| `E0229` | O IM informado está inativo no CNC NFS-e do município emissor para a data de competência informada na DPS. |  |
| `E0231` | IM do emitente tomador não está autorizado a emitir NFS-e, conforme informações complementares registradas no CNC NFS-e do município emissor informado na DPS. |  |
| `E0232` | IM do tomador não deve ser informado, pois não existem informações complementares registradas no CNC NFS-e do município emissor informado na DPS. |  |
| `E0233` | O nome tomador deve ser preenchido obrigatoriamente quando o CNPJ, CPF ou NIF do tomador/adquirente for preenchido. |  |
| `E0235` | O endereço nacional do tomador do serviço deve ser informado na DPS quando o tomador for identificado pelo CNPJ. | `NFSe/infNFSe/DPS/infDPS/toma/end/endNac` |
| `E0236` | O endereço nacional do tomador do serviço não deve ser informado na DPS quando o próprio tomador do serviço for o emitente da DPS. | `NFSe/infNFSe/DPS/infDPS/toma/end` |
| `E0237` | O endereço nacional do tomador do serviço deve ser informado na DPS quando o valor do ISSQN for retido pelo tomador, exceto se o emitente da DPS é o próprio tomador do serviço. |  |
| `E0238` | O código do município informado na DPS para o endereço do tomador do serviço não existe conforme tabela de município do IBGE. | `NFSe/infNFSe/DPS/infDPS/toma/end/endNac/cMun` |
| `E0239` | O tomador/adquirente de serviço dever ser obrigatoriamente identificado por CNPJ ou CPF e seu endereço nacional informado, se houver tributação do IBS/CBS e a incidência ocorrer no município do seu endereço no Brasil. |  |
| `E0240` | O CEP informado para o endereço nacional do tomador do serviço não existe ou não pertence ao município do endereço do tomador. | `NFSe/infNFSe/DPS/infDPS/toma/end/endNac/CEP` |
| `E0241` | O tomador/adquirente de serviço dever ser obrigatoriamente identificado e seu endereço nacional informado, se houver retenção do ISSQN ou se o município de incidência do ISSQN ocorrer no município do endereço do tomador/adquirente de serviço. |  |
| `E0242` | O grupo de informações de endereço no exterior deve ser informado obrigatoriamente quando o tomador for identificado por NIF ou não NIF. | `NFSe/infNFSe/DPS/infDPS/toma/end/endExt` |
| `E0243` | O tomador/adquirente de serviço dever ser obrigatoriamente identificado por CNPJ ou CPF e seu endereço nacional informado, se houver tributação do IBS/CBS, a incidência ocorrer no município do seu endereço no Brasil e houver a informação de que o destinatário é o próprio adquirente (indDest = 0). |  |
| `E0246` | O código de país informado para o endereço no exterior do tomador do serviço não existe ou é igual ao código do Brasil. Informe um código de país existente e diferente do código do Brasil (BR) para o endereço no exterior do tomador do serviço, no caso de envio da DPS para a Sefin Nacional NFS-e. Caso a NFS-e esteja sendo compartilhada para o AND NFS-e e o código de país informado para o endereço no exterior do tomador do serviço Município não possui a informação no sistema próprio, informe (ZZ), conforme tabela de país do ANEXO_A-MUNICIPIO_IBGE-PAISES_ISO2-SNNFSe-ESPEC. | `NFSe/infNFSe/DPS/infDPS/toma/end/endExt/cPais` |
| `E0247` | Email inválido. | `NFSe/infNFSe/DPS/infDPS/toma/email` |
| `E0248` | CNPJ do intermediário informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/interm/CNPJ` |
| `E0250` | CNPJ do intermediário não encontrado no cadastro CNPJ. |  |
| `E0254` | CNPJ do emitente intermediário não possui estabelecimento ou domicílio em um município correspondente ao município emissor, na data de competência informada na DPS, conforme cadastros CNPJ e CNC NFS-e. |  |
| `E0262` | Na emissão da NFS-e não é permitido que o prestador do serviço seja igual ao intermediário do serviço. |  |
| `E0264` | CNPJ ou CPF do intermediário não foi informado, mas existe uma indicação para retenção do ISSQN na DPS no campo de tipo de "Retenção do ISSQN". |  |
| `E0266` | CPF do intermediário informado na DPS é inválido. |  |
| `E0268` | CPF do intermediário não encontrado no cadastro CPF. |  |
| `E0272` | CPF do emitente intermediário não possui estabelecimento ou domicílio em um município correspondente ao município emissor, na data de competência informada na DPS, conforme cadastros CPF e CNC NFS-e. |  |
| `E0280` | O intermediário de serviço, quando emitente da DPS, não pode ser identificado pelo NIF. | `NFSe/infNFSe/DPS/infDPS/interm/NIF` |
| `E0281` | O NIF ou cNaoNIF do intermediário deve ser informado quando o grupo de informações de endereço no exterior do intermediário de serviços foi informado. |  |
| `E0284` | O intermediário de serviço, quando emitente da DPS, somente pode ser identificado pelo CNPJ ou CPF. |  |
| `E0286` | Valor 0 para o motivo da não informação do NIF do intermediário não é permitido na Sefin do Sistema Nacional NFS-e. |  |
| `E0287` | A IM não foi informada para o emitente intermediário do serviço na DPS. | `NFSe/infNFSe/DPS/infDPS/interm/IM` |
| `E0288` | O IM informado está inativo no CNC NFS-e do município emissor para a data de competência informada na DPS. |  |
| `E0289` | IM do emitente intermediário não está autorizado a emitir NFS-e, conforme informações complementares registradas no CNC NFS-e do município emissor informado na DPS. |  |
| `E0290` | IM do intermediário não deve ser informado, pois não existem informações complementares registradas no CNC NFS-e do município emissor informado na DPS. |  |
| `E0291` | O endereço do intermediário do serviço não deve ser informado na DPS quando o próprio tomador do serviço for o emitente da DPS. | `NFSe/infNFSe/DPS/infDPS/interm/end` |
| `E0292` | O nome intermediário deve ser preenchido obrigatoriamente quando o NIF do intermediário for preenchido. | `NFSe/infNFSe/DPS/infDPS/interm/xNome` |
| `E0293` | O endereço nacional do intermediário do serviço deve ser informado na DPS quando o valor do ISSQN for retido pelo intermediário, exceto se o emitente da DPS é o intermediário do serviço. |  |
| `E0294` | O código do município informado na DPS para o endereço do intermediário do serviço não existe conforme tabela de município do IBGE. | `NFSe/infNFSe/DPS/infDPS/interm/end/endNac/cMun` |
| `E0296` | O CEP informado para o endereço nacional do intermediário do serviço não existe ou não pertence ao município do endereço do intermediário. | `NFSe/infNFSe/DPS/infDPS/interm/end/endNac/CEP` |
| `E0298` | O grupo de informações de endereço no exterior deve ser informado obrigatoriamente quando o intermediário for identificado pelo NIF e o emitente por CNPJ. | `NFSe/infNFSe/DPS/infDPS/interm/end/endExt` |
| `E0299` | O código de país informado para o endereço no exterior do intermediário do serviço não existe ou é igual ao código do Brasil. Informe um código de país existente e diferente do código do Brasil (BR) para o endereço no exterior do intermediário do serviço, conforme tabela de país ISO2. | `NFSe/infNFSe/DPS/infDPS/interm/end/endExt/cPais` |
| `E0300` | Email inválido. | `NFSe/infNFSe/DPS/infDPS/interm/email` |
| `E0302` | O código do local da prestação do serviço não existe conforme a tabela de municípios IBGE disponibilizada no ANEXO_A-MUNICIPIO_IBGE-PAISES_ISO2-SNNFSe. | `NFSe/infNFSe/DPS/infDPS/serv/locPrest/cLocPrestacao` |
| `E0304` | Informe um código de país existente diferente de Brasil (BR), conforme tabela de país ISO2. | `NFSe/infNFSe/DPS/infDPS/serv/locPrest/cPaisPrestacao` |
| `E0309` | O sistema NFS-e não aceita o compartilhamento de NFS-e com novos fatos gerados de IBS/CBS (cTribNac = 99.03.xx ou 99.04.01). |  |
| `E0310` | O código de tributação nacional informado não existe conforme a lista de serviços nacional do Sistema Nacional NFS-e. | `NFSe/infNFSe/DPS/infDPS/serv/cServ/cTribNac` |
| `E0312` | O código de tributação nacional informado não está administrado pelo município de incidência do ISSQN na data de competência informada na DPS, conforme a lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E0314` | O código de tributação municipal informado não existe ou não está administrado pelo município de incidência do ISSQN na data de competência informada na DPS, | `NFSe/infNFSe/DPS/infDPS/serv/cServ/cTribMun` |
| `E0315` | Não é permitido informar 000 para o código de tributação municipal na DPS. |  |
| `E0316` | Código da lista NBS informado inexistente tabela de NBS do sistema. | `NFSe/infNFSe/DPS/infDPS/serv/cServ/cNBS` |
| `E0318` | É obrigatório informar na DPS um item da NBS para casos de exportação de serviço. |  |
| `E0320` | É obrigatório informar na DPS um item da NBS para casos de importação de serviço. |  |
| `E0322` | É obrigatório informar na DPS um item da NBS se for declarada qualquer informação de IBS/CBS. |  |
| `E0330` | É obrigatório prestar informações de comércio exterior para as situações de exportação de serviços. | `NFSe/infNFSe/DPS/infDPS/serv/comExt` |
| `E0331` | É obrigatório prestar informações de comércio exterior para as situações de importação de serviços. |  |
| `E0333` | Valor 0 para o modo de prestação não é permitido na Sefin do Sistema Nacional NFS-e. | `NFSe/infNFSe/DPS/infDPS/serv/comExt/mdPrestacao` |
| `E0341` | Valor 0 para o Mecanismo de apoio/fomento ao Comércio Exterior utilizado pelo prestador do serviço não é permitido na Sefin do Sistema Nacional NFS-e. | `NFSe/infNFSe/DPS/infDPS/serv/comExt/mecAFComexP` |
| `E0343` | Valor 0 para o Mecanismo de apoio/fomento ao Comércio Exterior utilizado pelo tomador do serviço não é permitido na Sefin do Sistema Nacional NFS-e. | `NFSe/infNFSe/DPS/infDPS/serv/comExt/mecAFComexT` |
| `E0345` | Valor 0 para o Vínculo da Operação à Movimentação Temporária de Bens não é permitido na Sefin do Sistema Nacional NFS-e. | `NFSe/infNFSe/DPS/infDPS/serv/comExt/movTempBens` |
| `E0352` | O preenchimento do campo nDUIMP (Número da Declaração Única de Importação) é obrigatório quando o campo (movTempBens) Vínculo da Operação à Movimentação Temporária de Bens for igual a 2. | `NFSe/infNFSe/DPS/infDPS/serv/comExt/nDUIMP` |
| `E0354` | O preenchimento dos campos nDUIMP (Número da Declaração Única de Importação) ou nDUE (Número da Declaração Única de Exportação) não é permitido quando o campo (movTempBens) Vínculo da Operação à Movimentação Temporária de Bens for igual a 1. |  |
| `E0356` | O preenchimento do campo nDUE (Número da Declaração Única de Exportação) é obrigatório quando o campo (movTempBens) Vínculo da Operação à Movimentação Temporária de Bens for igual a 3. |  |
| `E0370` | O grupo de informações de obra é obrigatório quando o código de tributação nacional pertencer a um dos subitens 07.02.01, 07.02.02, 07.04.01, 07.05,01, 07.05.02, 07.06.01, 07.06.02, 07.07.01, 07.08.01, 07.17.01, 07.19.01, 1414.03 e 14.14.04 da lista de serviços. | `NFSe/infNFSe/DPS/infDPS/servobra` |
| `E0372` | O grupo de informações de obra não é permitido quando o código de tributação nacional não pertencer a algum dos subitens 07.02.01, 07.02.02, 07.04.01, 07.05,01, 07.05.02, 07.06.01, 07.06.02, 07.07.01, 07.08.01, 07.17.01, 07.19.01, 1414.03 e 14.14.04 da lista de serviços, com exceção do código 99.01.01. |  |
| `E0373` | Código CIB inválido. | `NFSe/infNFSe/DPS/infDPS/serv/obra/cCIB` |
| `E0380` | Informe um CEP correspondente ao município do local da prestação do serviço informado nesta DPS para indicar corretamente o endereço da obra. | `NFSe/infNFSe/DPS/infDPS/serv/obra/end/CEP` |
| `E0382` | O CEP não deve ser informado quando o endereço da obra ocorrer no exterior do país. |  |
| `E0384` | O grupo de informações de endereço da atividade de obra ocorrido no exterior deve ser informado quando o país do local da prestação for informado na DPS. | `NFSe/infNFSe/DPS/infDPS/serv/obra/end/endExt` |
| `E0386` | O grupo de informações de endereço da atividade de obra ocorrido no exterior não deve ser informado quando o município do local da prestação for informado na DPS. |  |
| `E0390` | O grupo de informações de Atividade/Evento é obrigatório quando o código de tributação nacional pertencer ao item 12 ou subitem 17.10 da lista de serviços. | `NFSe/infNFSe/DPS/infDPS/serv/atvEvento` |
| `E0392` | O grupo de informações de Atividade/Evento não é permitido quando o código de tributação nacional não pertencer ao item 12 ou subitem 17.10 da lista de serviços, com exceção do código 99.01.01. |  |
| `E0393` | É permitido informar o codigo do município da atividade/evento somente se o código de tributaçáo nacional (cTribNac) pertencer aos subitens 12.13 ou 17.10. | `NFSe/infNFSe/DPS/infDPS/serv/atvEvento/cMun` |
| `E0394` | Se o código do município da atividade/evento for informado, deve ser diverso do código do município do local da prestação (cLocPrestacao). |  |
| `E0395` | O código do município da atividade/evento não existe, conforme tabela de municípios do IBGE. |  |
| `E0398` | Informe um CEP correspondente ao município do local da prestação do serviço informado nesta DPS para indicar corretamente o endereço da atividade ou evento. | `NFSe/infNFSe/DPS/infDPS/serv/atvEvento/end/CEP` |
| `E0400` | O CEP não deve ser informado quando o endereço da atividade de evento ocorrer no exterior do país. |  |
| `E0402` | O grupo de informações de endereço da atividade de evento ocorrido no exterior deve ser informado quando o país do local da prestação for informado na DPS. | `NFSe/infNFSe/DPS/infDPS/serv/atvEvento/end/endExt` |
| `E0404` | O grupo de informações de endereço da atividade de evento ocorrido no exterior não deve ser informado quando o município do local da prestação for informado na DPS. |  |
| `E0420` | O documento de referência deve ser obrigatoriamente informado quando o emitente da DPS for o tomador ou intermediário do serviço. | `NFSe/infNFSe/DPS/infDPS/serv/infoCompl/docRef` |
| `E0423` | O valor recebido deve ser informado na DPS quando o intermediário do serviço for o emitente da DPS. | `NFSe/infNFSe/DPS/infDPS/valores/vServPrest/vReceb` |
| `E0424` | O valor recebido não deve ser informado na DPS quando o prestador, tomador ou intermediário do serviço for o emitente da DPS. |  |
| `E0425` | O valor recebido não pode ser menor que o valor do serviço informado na DPS. |  |
| `E0427` | O valor do serviço deve ser maior ou igual ao somatório dos valores informados para Desconto Incondicionado, Deduções/Reduções e Benefício Municipal. | `NFSe/infNFSe/DPS/infDPS/valores/vServPrest/vServ` |
| `E0428` | O valor do serviço deve ser maior ou igual ao somatório dos valores informados para Desconto Incondicionado, Desconto Condicionado, Deduções/Reduções, Benefício Municipal, valores de tributos devidos CP, IRRF, CSLL e ISSQN se o valor deste tributo for retido. |  |
| `E0429` | O ISSQN não pode ser objeto de redução de base de cálculo que resulte em carga tributária menor que a decorrente da aplicação da alíquota mínima de 2,0% do valor do serviço, exceto para os serviços a que se referem aos subitens 042201, 042301, 050901, 070201, 070202, 070501 , 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160101, 160102, 160103, 160104, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, da lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E0431` | O valor do desconto incondicionado informado na DPS deve ser menor que o valor do serviço e maior que zero. | `NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/vDescIncond` |
| `E0432` | O valor do desconto condicionado informado na DPS deve ser menor que o valor do serviço e maior que zero. | `NFSe/infNFSe/DPS/infDPS/valores/vDescCondIncond/vDescCond` |
| `E0433` | Para locações (subitem 99.03), o valor do serviço deve ser igual ao valor total da operação multiplicado pelo percentual de copropriedade. |  |
| `E0434` | Para locações (subitem 99.03), o valor do desconto incondicionado deve ser igual ao valor total do desconto incondicionado multiplicado pelo percentual de copropriedade. |  |
| `E0435` | Não é permitido o preenchimento dos campos do grupo de informações relativas à ajuste de BC do ISSQN quando ocorrer Imunidade, Exportação de serviço ou Não incidência, exceto quando houver qualquer ajuste de BC por documentos dos tipos: 101, 102, 103, 104, 105 ou 199. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC` |
| `E0436` | Não é permitido o preenchimento dos campos do grupo de informações relativas à Dedução/Redução do ISSQN quando o prestador de serviço é MEI. |  |
| `E0437` | "Não é permitido o preenchimento dos campos do grupo de informações relativas à ajuste de BC por documentos quando o código da situação tributária (CST) e o código de classificação tributária (cClasTrib) indicar que não há tributação do IBS/CBS (ind_IBSCBS = 0), conforme resultado da consulta à calculadora do IBS/CBS. Exceto quando: O emitente indicar uma operação tributável para o ISSQN (tirbISSQN = 1); e O prestador de serviço não possuir regime especial de tributação (regEspTrib = 0); e O prestador de serviço não for MEI (opSimpNac = 1 ou 3); e Não houver suspensão de exigibilidade do ISSQN (tpSusp = Null). | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos` |
| `E0443` | Para locações (subitem 99.03), o valor do desconto condicionado deve ser igual ao valor total do desconto condicionado multiplicado pelo percentual de copropriedade. |  |
| `E0444` | O valor percentual de ajuste da Base de Cálculo do ISSQN informado na DPS não pode reduzir o valor da BC de forma que resulte no valor do ISSQN a uma alíquota efetiva menor que 2%, exceto para os códigos relativos aos subitens 042201, 042301, 050901, 070201, 070202, 070501 , 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160101, 160102, 160103, 160104, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, da lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E0445` | Não é permitido o preenchimento dos campos do grupo de informações relativas à ajuste de base de cálculo quando o prestador de serviço tiver algum regime especial de tributação, exceto se tpAjusteBC = 101, 102, 103, 104, 105 ou 199. |  |
| `E0446` | Código de serviço informado na DPS não permite ajuste da Base de Cálculo do ISSQN por valor monetário. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/vAjusteBCISSQN` |
| `E0447` | O valor de ajuste da Base de Cálculo do ISSQN informado na DPS não pode reduzir o valor da BC de forma que resulte no valor do ISSQN a uma alíquota efetiva menor que 2%, exceto para os códigos relativos aos subitens 042201, 042301, 050901, 070201, 070202, 070501 , 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160101, 160102, 160103, 160104, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, da lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E0448` | Não é permitido o preenchimento dos campos do grupo de informações relativas à ajuste de base de cálculo quando o benefício municipal informado na DPS for do tipo "Isenção", exceto se tpAjusteBC = 101, 102, 103, 104, 105 ou 199. |  |
| `E0449` | O ajuste de base de cálculo informado na DPS não é permitido pelo município de incidência do ISSQN, conforme parametrizações do código de serviço do município de incidência, exceto se houver ajuste de BC por documentos para os tipos de ajuste de BC: tpAjusteBC = 101, 102, 103, 104, 105 ou 199. |  |
| `E0450` | O ajuste de base de cálculo informado na DPS não é permitido pelo município de incidência do ISSQN, conforme parametrizações do código de serviço do município de incidência, exceto se houver ajuste de BC por documentos para os tipos de ajuste de BC: tpAjusteBC = 101, 102, 103, 104, 105 ou 199. |  |
| `E0451` | Não é permitido o preenchimento de informações relativas à ajuste de base de cálculo para o prestador de serviço ME/EPP apurando pelo SN, exceto se houver parametrização permitindo para os códigos de tributação nacional do município de incidência: 042201, 042301, 050901, 060101, 060201, 070201, 070202, 070501 ,070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, ou se houver ajuste de BC por documentos para os tipos de ajuste de BC: tpAjusteBC = 101, 102, 103, 104, 105 ou 199. |  |
| `E0452` | Não é permitido o preenchimento de informações relativas à ajuste de base de cálculo para o prestador de serviço ME/EPP apurando pelo SN e município de incidência do ISSQN NÃO "Ativo" para seu convênio, exceto para os códigos de tributação nacional: 042201, 042301, 050901, 060101, 060201, 070201, 070202, 070501 ,070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301. |  |
| `E0453` | O valor percentual para ajuste da Base de Cálculo do ISSQN deve ser maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/pAjusteBCISSQN` |
| `E0454` | Código de serviço informado na DPS não permite ajuste da Base de Cálculo do ISSQN por percentual. |  |
| `E0455` | Não é permitido o preenchimento de informações relativas à ajuste de base de cálculo para o prestador de serviço ME/EPP apurando pelo SN e código de tributação nacional (cTribNac) diferentes dos seguintes subitens: 042201, 042301, 050901, 060101, 060201, 070201, 070202, 070501 ,070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, 151003, 151004, 151005, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, exceto se houver ajuste de BC por documentos para os tipos de ajuste de BC: tpAjusteBC = 101, 102, 103, 104, 105 ou 199. |  |
| `E0460` | Chave DF-e incorreta. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/dFeNacional/chaveDFe` |
| `E0462` | Não é possível informar o ajuste (dedução/redução) na base de cálculo do ISSQN por documentos quando já informado por percentual ou por valor. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/tpAjusteBC` |
| `E0463` | Se o código de tributação nacional (cTribNac) = 6.01 ou 6.02, então o tipo da ajuste (tpAjusteBC) informado deve ser "Profissional Parceiro" (tpAjusteBC = 9) ou "Outros reembolsos ou ressarcimentos recebidos por valores pagos relativos a operações por conta e ordem de terceiro"(tpAjusteBC = 199). |  |
| `E0464` | Não é permitido informar a descrição do ajuste de base de cálculo (xTpAjusteBC) quando o tipo de ajuste de base de cálculo for diferente dos códigos 99 ou 199 (tpAjusteBC != 99 ou 199). | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/xTpAjusteBC` |
| `E0465` | É obrigatório informar a descrição do ajuste de base de cálculo (xTpAjusteBC) quando o tipo de ajuste de base de cálculo for igual aos códigos 99 ou 199 (tpAjusteBC = 99 ou 199). |  |
| `E0466` | O código do município emissor do documento fiscal para fins de reembolso, repasse e ressarcimento que não está no repositório nacional está incorreto. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/docFiscalOutro/cMunDocFiscal` |
| `E0467` | O valor de ajuste informado na DPS não pode ser superior ao valor do serviço prestado. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/vAjusteAplic` |
| `E0469` | O valor de ajuste não pode ser superior ao valor do documento informado. |  |
| `E0470` | É obrigatório o preenchimento da descrição do documento fiscal eletrônico nacional, quando o tipo de Df-e for 99 - Outro Documento Fiscal Eletrônico Nacional. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/dFeNacional/xTipoChaveDFe` |
| `E0472` | Data de emissão do documento tem que ser igual ou posterior à data de competência (dtCompDoc) | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/dtEmiDoc` |
| `E0474` | Data de competência do documento tem que ser igual ou anterior à data de emissão (dtEmiDoc) | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/dtCompDoc` |
| `E0476` | Outros documentos ficais não podem ser informados quando a data de competência do documento for posterior a 31 de dezembro de 2025. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/docFiscalOutro` |
| `E0478` | CNPJ do fornecedor de reembolso, repasse e ressarcimento informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/CNPJ` |
| `E0479` | Para o tipo de ajuste informado, deve-se informar um documento fiscal. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/docOutro` |
| `E0482` | CNPJ do fornecedor de reembolso, repasse e ressarcimento informado não encontrado no cadastro CNPJ na data de competência. |  |
| `E0484` | CPF do fornecedor de reembolso, repasse e ressarcimento informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/CPF` |
| `E0488` | CPF do fornecedor de reembolso, repasse e ressarcimento informado não encontrado no cadastro CPF na data de competência. |  |
| `E0490` | Valor 0 para o motivo da não informação do NIF do fornecedor não é permitido na Sefin do Sistema Nacional NFS-e. |  |
| `E0492` | O grupo de informações de endereço nacional deve ser informado obrigatoriamente quando o fornecedor for identificado pelo CPF ou CNPJ. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/end/endNac` |
| `E0494` | O código do município informado na DPS para o endereço do fornecedor do serviço não existe conforme tabela de município do IBGE. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/end/endNac/cMun` |
| `E0496` | O CEP informado para o endereço nacional do fornecedor não existe ou não pertence ao município do endereço do fornecedor. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/end/endNac/CEP` |
| `E0498` | O grupo de informações de endereço no exterior deve ser informado obrigatoriamente quando o fornecedor for identificado pelo NIF. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/end/endExt` |
| `E0499` | O código de país informado para o endereço no exterior do fornecedor não existe ou é igual ao código do Brasil. Informe um código de país existente e diferente do código do Brasil (BR) para o endereço no exterior do fornecedor, conforme tabela de país ISO2. | `NFSe/infNFSe/DPS/infDPS/valores/vAjusteBC/documentos/docAjusteBC/fornec/end/endExt/cPais` |
| `E0529` | O sistema considera este cenário para a prestação de serviço informada na DPS uma operação tributável. Não é permitido ao emitente da DPS informar que a prestação de serviço se trata de uma exportação de serviço. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/tribISSQN` |
| `E0530` | O sistema considera este cenário para a prestação de serviço informada na DPS uma exportação de serviço. Não é permitido ao emitente da DPS informar que a prestação de serviço se trata de uma operação tributável. |  |
| `E0531` | Não é permitido informar imunidade ou exportação de serviço ou não incidência do ISSQN (tribISSQN = 2, 3 ou 4) quando o emitente da NFS-e for o tomador ou intermediário do serviço (tpEmit = 2 ou 3). |  |
| `E0532` | O campo que informa sobre a tributação do ISSQN deve ser "4 - Não Incidência", quando o serviço prestado for 99.XX.XX - Serviços sem a incidência de ISSQN e ICMS. |  |
| `E0533` | Não é permitido informar Benefício Municipal (BM deve ser nulo) quando o serviço prestado diferente de Tributável (tribISSQN = 1), ou seja, tribISSQN = 2, 3 ou 4. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM` |
| `E0534` | Não é permitido o preenchimento de informações relativas à benefício municipal para o prestador de serviço MEI. |  |
| `E0535` | Não é permitido informar benefício municipal quando o prestador de serviço tiver um regime especial de tributação, ou seja, o campo que indica o regime especial de tributação é diferente de 0, (regEspTrib = 1, 2, 3, 4, 5 ou 6). |  |
| `E0536` | Não é permitido o preenchimento de informações relativas à benefício municipal para o prestador de serviço ME/EPP, apurando pelo SN, conforme parametrização do código de serviço administrado pelo município de incidência do ISSQN. |  |
| `E0537` | Não é permitido informar benefício municipal (BM deve ser nulo) quando o município de incidência do ISSQN não está "Ativo" no Sistema Nacional NFS-e. |  |
| `E0539` | Não é permitido informar não incidência do ISSQN = 4 (Não Incidência) para qualquer subitem da lista nacional de serviço informado na DPS, se o subitem for incidente, conforme a parametrização do município de incidência do ISSQN. |  |
| `E0540` | Não há incidência do ISSQN (tribISSQN = 4) pois a parametrização do município de incidência do ISSQN indica que o código de serviço prestado, informado na DPS, não é incidente neste município. |  |
| `E0541` | Não existe o código de identificação do benefício municipal informado na DPS para o município de incidência do ISSQN. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM/nBM` |
| `E0544` | Período de vigência expirado para o código de identificação do Benefício Municipal no município de incidência do ISSQN para a data de competência informada na DPS. |  |
| `E0548` | O Benefício Municipal informado na DPS não permite benefício para prestadores de serviço que não estejam estabelecidos no município de incidência do ISSQN. |  |
| `E0550` | O código de identificação de Benefício Municipal, informada na DPS, não permite benefício para o código de tributação e/ou prestador (CPF ou CNPJ) informado na DPS, conforme parametrização do município de incidência do ISSQN. |  |
| `E0565` | Não é permitido informar um valor monetário de redução de base de cálculo do ISSQN por benefício municipal, se o código de identificação do Benefício Municipal não corresponder ao tipo de redução por valor monetário. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM/vRedBCBM` |
| `E0567` | É obrigatório informar vRedBCBM quando o código de identificação do Benefício Municipal (nBM) for um benefício do tipo Redução de Base de Cálculo por Valor Monetário. |  |
| `E0574` | O valor monetário do benefício municipal informado na DPS não pode ser superior ao valor do serviço. |  |
| `E0575` | O valor monetário do benefício municipal informado na DPS não pode reduzir o valor da BC de forma que resulte no valor do ISSQN a uma alíquota efetiva menor que 2%, exceto para os códigos relativos aos subitens 042201, 042301, 050901, 070201, 070202, 070501 , 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160101, 160102, 160103, 160104, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, da lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E0577` | Não é permitido informar um valor percentual de redução de base de cálculo do ISSQN por benefício municipal, se o código de identificação do Benefício Municipal não corresponder ao tipo de redução por valor percentual. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/BM/pRedBCBM` |
| `E0579` | É obrigatório informar pRedBCBM quando o código de identificação do Benefício Municipal (nBM) for um benefício do tipo Redução de Base de Cálculo por percentual. |  |
| `E0580` | Não é permitido haver retenção quando o campo referente à tributação do ISSQN indicar imunidade, exportação ou não incidência. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/tpRetISSQN` |
| `E0583` | Não é permitido retenção do ISSQN para o prestador do serviço que seja MEI na data de competência informada na DPS. |  |
| `E0585` | Somente é permitido informar suspensão de exigibilidade quando a opção da tributação do ISSQN for uma operação tributável (tribISSQN = 1). | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/exigSusp` |
| `E0586` | O valor percentual para redução da base de cálculo deve ser maior que 0 e menor ou igual ao percentual parametrizado pelo município de incidência do ISSQN. |  |
| `E0587` | O valor percentual do benefício municipal informado na DPS não pode reduzir o valor da BC de forma que resulte no valor do ISSQN a uma alíquota efetiva menor que 2%, exceto para os códigos relativos aos subitens 042201, 042301, 050901, 070201, 070202, 070501 , 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160101, 160102, 160103, 160104, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, da lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E0588` | Não é permitido retenção do ISSQN para o prestador do serviço que tenha algum regime especial de tributação na data de competência informada na DPS. |  |
| `E0590` | É obrigatório informar o código do país onde ocorreu o resultado do serviço prestado para os cenários 2, 30, 58, 62, 72, 76, conforme a planilha "EXPORTACAO_EMISSÃO_NFS-e". | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/cPaisResult` |
| `E0591` | Não é permitido informar o código do país onde ocorreu o resultado do serviço prestado para os cenários diferentes de 2, 30, 58, 62, 72, 76 conforme a planilha "EXPORTACAO_EMISSÃO_NFS-e". |  |
| `E0592` | O tipo de imunidade é obrigatório e deve ser informado somente quando o campo referente à tributação do ISSQN for igual a "2 - Imunidade". | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/tpImunidade` |
| `E0593` | Não permitido o valor "0 - Imunidade (tipo não informado na nota de origem)" na DPS quando utilizado os Emissores Públicos Nacionais para emissão de NFS-e. |  |
| `E0594` | Não é permitido retenção do ISSQN quando houver Benefício Municipal do tipo Isenção. |  |
| `E0595` | Não é permitido informar alíquota superior a 5%. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribMun/pAliq` |
| `E0600` | Não é permitido informar a alíquota para prestador de serviço optante do simples nacional do tipo MEI. |  |
| `E0602` | Não é permitido informar alíquota quando o campo referente à tributação do ISSQN indicar imunidade, exportação ou não incidência. |  |
| `E0604` | Não é permitido informar alíquota quando o prestador de serviço possui algum regime especial de tributação. |  |
| `E0612` | Não é permitido informar alíquota quando o benefício municipal informado na DPS for do tipo "Isenção" ou "Alíquota Diferenciada". |  |
| `E0617` | Não é permitido informar alíquota quando o prestador de serviço não é optante do simples nacional (opSimpNac = 1) na data de competência informada na DPS, com o município de incidência do ISSQN com situação "ATIVO" no Sistema Nacional NFS-e. |  |
| `E0619` | É obrigatório informar alíquota quando o prestador de serviço não é optante do simples nacional (opSimpNac = 1) na data de competência informada na DPS, o município de incidência do ISSQN não está com situação "ATIVO" no Sistema Nacional NFS-e e não haja algum regime especial de tributação para o prestador. |  |
| `E0621` | É obrigatório informar alíquota quando há indicação de retenção do ISSQN (tpRetISSQN = 2 ou 3) para o prestador de serviço ME/EPP (opSimpNac = 3) na data de competência informada na DPS, com apuração do ISSQN pelo simples nacional (regApTribISSQN = 1), sem benefício municipal ou, se houver, seja diferente de isenção ou alíquota diferenciada, cujo município de incidência esteja Ativo no Sistema Nacional NFS-e. Obs.: neste cenário, o percentual da alíquota mínima informada permitida é 1,8%. |  |
| `E0625` | Não é permitido informar alíquota quando não há indicação de retenção do ISSQN (tpRetISSQN = 1) para o prestador de serviço ME/EPP (opSimpNac = 3) na data de competência informada na DPS, com apuração do ISSQN pelo simples nacional (regApTribISSQN = 1), sem benefício municipal ou, se houver, seja diferente de isenção ou alíquota diferenciada, cujo município de incidência esteja Ativo no Sistema Nacional NFS-e. |  |
| `E0628` | É obrigatório informar alíquota quando o município de incidência do ISSQN não está Ativo no Sistema Nacional NFS-e, para o prestador de serviço ME/EPP (opSimpNac = 3) na data de competência informada na DPS, com apuração do ISSQN pelo simples nacional (regApTribISSQN = 1), com retenção do ISSQN (tpRetISSQN = 2 ou 3). Obs.: neste cenário, o percentual da alíquota mínima informada permitida é 1,8%. |  |
| `E0631` | Não é permitido informar alíquota quando o município de incidência do ISSQN não está Ativo no Sistema Nacional NFS-e, para o prestador de serviço ME/EPP (opSimpNac = 3) na data de competência informada na DPS, com apuração do ISSQN pelo simples nacional (regApTribISSQN = 1) sem retenção do ISSQN (tpRetISSQN = 1). |  |
| `E0635` | Não é permitido informar alíquota quando o convênio do município de incidência do ISSQN está ativo na data de competência informada na DPS, para o prestador de serviço ME/EPP (opSimpNac = 3) com a apuração do ISSQN fora do Simples Nacional, ou seja, pela alíquota do município para o serviço prestado (regApTribSN = 2 ou 3). |  |
| `E0640` | É obrigatório informar alíquota quando o prestador de serviço ME/EPP (opSimpNac = 3) na data de competência informada na DPS, com apuração do ISSQN fora do Simples Nacional (regApTribISSQN = 2 ou 3), ou seja, pela alíquota do município para o serviço prestado, cujo município de incidência não esteja "Ativo" no Sistema Nacional NFS-e. |  |
| `E0650` | Em caso de importação de serviço pelo tomador, o ISSQN deve ser retido pelo tomador. |  |
| `E0652` | Em caso de importação de serviço pelo intermediário, o ISSQN deve ser retido pelo intermediário. |  |
| `E0653` | Não é permitido retenção do ISSQN para o prestador ou tomador ou intermediário no serviço prestado, na data de competência, informados na DPS, conforme exceção parametrizada pelo município de incidência do ISSQN. |  |
| `E0655` | Não é permitido ocorrer retenção do ISSQN (tpRetISSQN = 2 ou 3), ou seja, o ISSQN deve ser obrigatoriamente "Não Retido (tpRetISSQN = 1), quando não houver regras para retenção do ISSQN parametrizadas no município de incidência. |  |
| `E0656` | Não é permitido ocorrer retenção do ISSQN (tpRetISSQN = 2 ou 3), ou seja, o ISSQN deve ser obrigatoriamente "Não Retido (tpRetISSQN = 1), quando houver regras para retenção do ISSQN parametrizadas no município de incidência, mas não houver correspondência entre as informações declaradas na DPS não e pelo menos uma regra parametrizada neste mesmo município. |  |
| `E0657` | A retenção do ISSQN é obrigatória para esta DPS (tpEmit = 2 ou 3), conforme regras vigentes de retenção aplicáveis ao tomador ou intermediário do serviço informado na DPS, exceto quando o prestador de serviço for não optante pelo simples nacional, estiver localizado no município de incidência do ISSQN, na data de competência da emissão da NFS-e. |  |
| `E0659` | A retenção do ISSQN é obrigatória para esta DPS (tpEmit = 2 ou 3), conforme regras vigentes de retenção aplicáveis ao tomador ou intermediário do serviço informado na DPS, exceto quando o prestador de serviço for optante pelo simples nacional, ME/EPP, estiver localizado no município de incidência do ISSQN, na data de competência da emissão da NFS-e. |  |
| `E0661` | A retenção do ISSQN é obrigatória para esta DPS (tpEmit = 2 ou 3), conforme regras vigentes de retenção aplicáveis ao tomador ou intermediário do serviço informado na DPS, exceto quando o tomador ou intermediário do serviço for optante pelo simples nacional, ME/EPP, estiver localizado no município de incidência do ISSQN, na data de competência da emissão da NFS-e. |  |
| `E0663` | A retenção do ISSQN é obrigatória para esta DPS (tpEmit = 2 ou 3), conforme regras vigentes de retenção aplicáveis ao tomador ou intermediário do serviço informado na DPS, exceto quando o tomador ou intermediário do serviço não optante ou optante pelo simples nacional, ME/EPP, estiverem localizados em município diferente do município de incidência do ISSQN, na data de competência da emissão da NFS-e. |  |
| `E0665` | A retenção do ISSQN é obrigatória para esta DPS (tpEmit = 2 ou 3), conforme regras vigentes de retenção aplicáveis ao tomador ou intermediário do serviço informado na DPS, exceto quando o valor do serviço informado na DPS for menor que R$ <valor do parâmetro da regra de retenção do município de incidência>, definido pelo município de incidência do ISSQN. |  |
| `E0675` | Não é permitido a prestação de informações relativas aos tributos federais quando o emitente da DPS for identificado por um pessoa física (CPF). | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed` |
| `E0676` | Não é permitido o preenchimento das informações relativas aos tributos federais quando o emitente for identificado como MEI na data de competência informada na DPS. |  |
| `E0677` | O valor da BC para Pis/Cofins deve ser menor ou igual ao valor do serviço informado na DPS. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/vBCPisCofins` |
| `E0686` | A alíquota do Pis deve ser igual ou maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/pAliqPis` |
| `E0692` | A alíquota do Cofins deve ser igual ou maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/pAliqCofins` |
| `E0694` | O valor do Pis informado não corresponde ao resultado da BC Pis/Cofins x Alíquota Pis, que foram informados na DPS. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/vPis` |
| `E0696` | O valor do Cofins informado não corresponde ao resultado da BC Pis/Cofins x Alíquota Cofins, que foram informados na DPS. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/piscofins/vCofins` |
| `E0699` | O valor do tributo CP deve ser maior que zero e menor que o valor do serviço informado na DPS. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/vRetCP` |
| `E0700` | O valor do tributo IRRF deve ser maior que zero e menor que o valor do serviço informado na DPS. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/vRetIRRF` |
| `E0701` | O valor do tributo CSLL deve ser maior que zero e menor que o valor do serviço informado na DPS. |  |
| `E0702` | Se o valor for informado, então deve ser igual ou maior que 0 e menor ou igual o valor do serviço. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/vTotTrib/vTotTribFed` |
| `E0703` | Se o valor for informado, então deve ser igual ou maior que 0 e menor ou igual o valor do serviço. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/vTotTrib/vTotTribEst` |
| `E0704` | Se o valor for informado, então deve ser igual ou maior que 0 e menor ou igual o valor do serviço. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/vTotTrib/vTotTribMun` |
| `E0706` | Se a alíquota for informada, então deve ser igual ou maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/pTotTrib/pTotTribFed` |
| `E0707` | Se a alíquota for informada, então deve ser igual ou maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/pTotTrib/pTotTribEst` |
| `E0708` | Se a alíquota for informada, então deve ser igual ou maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/pTotTrib/pTotTribMun` |
| `E0710` | Para MEI pTotTribSN nunca poderá ser informado. |  |
| `E0712` | Para ME/EPP indTotTrib nunca poderá ser informado. | `NFSe/infNFSe/DPS/infDPS/valores/trib/totTrib/indTotTrib` |
| `E0713` | Para Não Optante do SN os campos, indicador de informação de valor total de tributos e percentual aproximado do total dos tributos da alíquota do Simples Nacional (%), não podem ser informado. |  |
| `E0714` | Arquivo enviado com erro na assinatura. | `NFSe/infNFSe/DPS/InfDPS/Signature` |
| `E0715` | Certificado Digital da assinatura inválido. |  |
| `E0716` | Certificado Digital fora do padrão estabelecido. |  |
| `E0717` | A assinatura é obrigatória quando for enviado para o Web Service. |  |
| `E0718` | A assinatura deve ser feita com o certificado digital do emitente da DPS. |  |
| `E0720` | Se o tipo de retenção do PIS/COFINS for igual a "0 - PIS/COFINS/CSLL Não Retidos", então não é permitido informar o campo vRetCSLL. | `NFSe/infNFSe/DPS/infDPS/valores/trib/tribFed/vRetCSLL` |
| `E0724` | Se o tipo de retenção do PIS/COFINS for diferente de "0 - PIS/COFINS/CSLL Não Retidos" ou de "2 - PIS/COFINS Não Retido", então é obrigatório informar o campo vRetCSLL. |  |
| `E0850` | É permitido declarar informações de IBS/CBS somente a partir da data de competência 01/01/2026. | `NFSe/infNFSe/DPS/infDPS/IBSCBS` |
| `E0854` | Somente é permitido declarar informações de IBS/CBS a partir da versão 1,01 da DPS. |  |
| `E0855` | É obrigatório declarar informações de IBS/CBS quando a data de competência for igual ou posterior a 01/10/2026. |  |
| `E0859` | Não é permitido informar cIndOp quando não houver indicação de tributação IBS/CBS, conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/cIndOp` |
| `E0860` | É obrigatório informar cIndOp quando houver indicação de tributação IBS/CBS, conforme consulta à calculadora IBS/CBS. |  |
| `E0901` | cIndOp incorreto para operação de prestação de serviços. |  |
| `E0902` | O código indicador da operação deve ser qualquer 02XXXX quando o código de tributação nacional for 99.03. |  |
| `E0903` | Código do tipo de Operação (tpOper) deve ser informado quando se tratar de uma compra governamental ou um dos serviços da LC 116/2003 listados: 25.05; 15.09; 17.12; 10.05. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/tpOper` |
| `E0904` | Código do tipo de Operação (tpOper) não pode ser informado quando não se tratar de uma compra governamental ou um dos serviços da LC 116/2003 listados: 25.05; 15.09; 17.12; 10.05. |  |
| `E0905` | O grupo de documentos referenciados deve ser informado para o tipo de operação (tpOper). | `NFSe/infNFSe/DPS/infDPS/IBSCBS/gRefNFSe` |
| `E0906` | O grupo de documentos referenciados não pode ser informado para o tipo de operação (tpOper). |  |
| `E0907` | NFS-e referenciada é inválida. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/gRefNFSe/refNFSe` |
| `E0908` | Não é permitido identificar o destinatário quando o indicador do destinatário for igual a zero (indDest = 0). | `NFSe/infNFSe/DPS/infDPS/dest` |
| `E0910` | É obrigatório identificar o destinatário quando o indicador do destinatário for igual a um (indDest = 1). |  |
| `E0911` | CNPJ do destinatário informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/dest/CNPJ` |
| `E0912` | CNPJ do destinatário não encontrado no cadastro CNPJ na data de competência. |  |
| `E0913` | CPF do destinatário informado na DPS é inválido. | `NFSe/infNFSe/DPS/infDPS/dest/CPF` |
| `E0914` | CPF do destinatário não encontrado no cadastro CPF na data de competência. |  |
| `E0919` | O destinatário de serviço dever ser obrigatoriamente identificado e seu endereço nacional informado, se houver tributação o município de incidência do IBS/CBS ocorrer no município do endereço do destinatário de serviço e houver a informação de que o destinatário não é o próprio tomador/adquirente (indDest = 1). | `NFSe/infNFSe/DPS/infDPS/dest/end/endNac` |
| `E0920` | O código do município para o endereço do destinatário do serviço não existe conforme tabela de município do IBGE. | `NFSe/infNFSe/DPS/infDPS/dest/end/endNac/cMun` |
| `E0921` | O código do município informado na DPS para o endereço do destinatário do serviço, identificado pelo CNPJ, não corresponde ao município registrado em seus cadastros na data de competência informada na DPS. |  |
| `E0922` | O código do município informado na DPS para o endereço do destinatário do serviço, identificado pelo CPF, não corresponde ao município registrado em seus cadastros na data de competência informada na DPS. |  |
| `E0923` | O grupo de informações de endereço no exterior deve ser informado obrigatoriamente quando o destinatário for identificado pelo NIF ou cNaoNIF. | `NFSe/infNFSe/DPS/infDPS/dest/end/endExt` |
| `E0924` | O CEP informado para o endereço nacional do destinatário do serviço não existe ou não pertence ao município do endereço do destinatário. | `NFSe/infNFSe/DPS/infDPS/dest/end/endNac/CEP` |
| `E0928` | Não é permitido o grupo de informações relativo a imóvel quando o código de tributação nacional (cTribNac) não pertencer a algum dos subitens 07.02.01, 07.02.02, 07.04.01, 07.05,01, 07.05.02, 07.06.01, 07.06.02, 07.07.01, 07.08.01, 07.17.01 e 07.19.01 da lista de serviços e, o código indicador da operação (cIndOp) não for relativo a operações com imóveis (020101, 020201, 020202, 020301 ou 020401), conforme a tabela CÓDIGO_INDICADOR_OPERAÇÃO_IBS. |  |
| `E0929` | Código IBGE inválido para o município do(s) imóvel(is). | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/cMun` |
| `E0930` | E-mail inválido. | `NFSe/infNFSe/DPS/infDPS/dest/email` |
| `E0931` | Não é permitido o grupo de informações relativo a imóvel quando o código de tributação nacional (cTribNac) não pertencer a algum dos subitens 07.02.01, 07.02.02, 07.04.01, 07.05,01, 07.05.02, 07.06.01, 07.06.02, 07.07.01, 07.08.01, 07.17.01 e 07.19.01, for infomado na DPS. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel` |
| `E0932` | É obrigatório o grupo de informações relativo ao imóvel na DPS quando o código indicador da operação informado for relacionado à imóvel conforme a tabela CÓDIGO_INDICADOR_OPERAÇÃO_IBS. |  |
| `E0933` | Código CIB inválido. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gUnidImob/cCIB` |
| `E0936` | Grupo gLocacao não deve ser informado. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gLocacao` |
| `E0937` | Grupo gLocacao deve ser informado. |  |
| `E0938` | Grupo de unidade imobiliária obrigatório quando código indicador da operação (cIndOp) for igual a 020101, 020201 ou 020301 | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gUnidImob` |
| `E0939` | Não é permitido informar o grupo de ajuste da base de cálculo do IBS/CBS para imóveis quando o código de tributação nacional (cTribNac) for diferente de 99.03. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gUnidImob/gAjusteBCLocImoveis` |
| `E0940` | O percentual de co-propriedade deve ser obrigatoriamente igual ou maior que 0 e menor ou igual a 100%. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gLocacao/pCopropriedade` |
| `E0944` | O Redutor Social (tpAjusteBCLocImoveis = 04) só pode ser dedutível da Base de Cálculo de IBS/CBS se a operação for de locação de um imóvel residencial (cNBS = 1.1002.10.00). | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gUnidImob/gAjusteBCLocImoveis/tpAjusteBCLocImoveis` |
| `E0949` | A descrição do tipo de ajuste (dedução/redução) da Base de Cálculo do IBS/CBS deve ser informada quando o tipo de ajuste (tpAjusteBCLocImoveis) for igual a 99. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gUnidImob/gAjusteBCLocImoveis/xTpAjusteBCLocImoveis` |
| `E0954` | (sem mensagem no catálogo oficial) |  |
| `E0958` | cClassTrib para IBS/CBS incorreto para operação de prestação de serviços. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/cClassTrib` |
| `E0959` | cClassTrib não pertence ao grupo CST indicado. |  |
| `E0960` | É obrigatório as informações relacionadas à tributação IBS/CBS quando não houver indicação de tributação IBS/CBS, conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS` |
| `E0961` | Não é permitido as informações relacionadas à tributação IBS/CBS quando não houver indicação de tributação IBS/CBS, conforme consulta à calculadora IBS/CBS. |  |
| `E0962` | cCredPres para IBS/CBS não possível para código de classificação tributária. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/cCredPres` |
| `E0963` | O grupo bensMoveis deve ser informado quando o código de serviço (cTribNac) for "99.04.01". |  |
| `E0964` | Grupo de tributação regular não deve ser informado. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/gTribRegular` |
| `E0965` | Grupo de tributação regular deve ser informado. |  |
| `E0966` | O valor do ajuste (dedução/redução) da Base de Cálculo do IBS/CBS deve ser menor ou igual ao valor total da operação com bem imóvel. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/imovel/gUnidImob/gAjusteBCLocImoveis/vAjusteBCLocImoveis` |
| `E0967` | O grupo bensMoveis não deve ser informado para o código de serviço indicado. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/bensMoveis` |
| `E0969` | cClassTribReg para IBS/CBS incorreto para operação de prestação de serviços. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/gTribRegular/cClassTribReg` |
| `E0970` | cClassTribReg não pertence ao grupo CST indicado em CSTReg. |  |
| `E0971` | Grupo de diferimento para IBS/CBS não deve ser informado. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/valores/trib/gIBSCBS/gDif` |
| `E0972` | Grupo de diferimento para IBS/CBS deve ser informado. |  |
| `E0973` | Código NCM do Bem Móvel é inexistente. | `NFSe/infNFSe/DPS/infDPS/IBSCBS/bensMoveis/cNCMBemMovel` |
| `E0974` | A quantidade de bens móveis deve ser superior a 0 (zero). | `NFSe/infNFSe/DPS/infDPS/IBSCBS/bensMoveis/qtdNCMBemMovel` |
| `E1200` | Certificado de Transmissão Inválido |  |
| `E1203` | Certificado de Transmissão expirado |  |
| `E1205` | Certificado de Transmissão - Erro Cadeira de Certificação |  |
| `E1206` | Certificado de Transmissão - Erro de acesso a LCR |  |
| `E1207` | Certificado de Transmissão revogado |  |
| `E1208` | Certificado de Transmissão difere da ICP - Brasil |  |
| `E1209` | Certificado de Transmissão sem CNPJ ou CPF. |  |
| `E1225` | Falha na decodificação da base 64 da área de dados |  |
| `E1226` | Estrutura descompactada mal formada. |  |
| `E1228` | Uso de prefixo de namespace não permitido na área de dados descompactada. |  |
| `E1229` | XML não está utilizando codificação UTF8. |  |
| `E1235` | Falha no esquema XML do DF-e. |  |
| `E1242` | Tipo DF-e não tratado pelo Sistema Nacional NFS-e. |  |
| `E1260` | O prazo de aceitação da versão do leiaute da NFS-e expirou. | `NFSe/versao` |
| `E1263` | Conteúdo informado no identificador da NFS-e difere da concatenação dos campos correspondentes que formam o identificador. | `NFSe/infNFSe/id` |
| `E1268` | Chave de acesso informada para a NFS-e já foi compartilhada com o ADN. |  |
| `E1269` | Não é possível existir duas NFS-e com os mesmos valores para os campos: [CodigoMunicipioEmissor], [TipoInscricaoEmitente], [InscricaoEmitente], [NumeroNFSe]. | `NFSe/infNFSe/nNFSe` |
| `E1270` | A data de competência deve ser igual ou posterior à data de ativação do convênio do município emissor informado na DPS. |  |
| `E1272` | O código do município informado não existe ou não está ativo no convênio municipal na data de processamento de compartilhamento com o ADN. |  |
| `E1274` | O ambiente gerador da NFS-e não está de acordo com a definição 1 (Sistema Próprio do Município) ou 2 (Sefin Nacional). | `NFSe/infNFSe/ambGer` |
| `E1276` | A informação do processo de emissão de NFS-e é exclusiva para notas emitidas pela Sefin Nacional NFS-e. O município não deve informar este campo nas NFS-e compartilhadas com o ADN NFS-e. | `NFSe/infNFSe/procEmi` |
| `E1278` | A data e hora do processamento (geração) da NFS-e deve ser anterior ou igual à data da recepção pelo Sistema Nacional NFS-e. | `NFSe/infNFSe/dhProc` |
| `E1280` | CNPJ informado para o emitente da NFS-e é inválido (verificar DV). | `NFSe/infNFSe/emit/CNPJ` |
| `E1282` | O CNPJ do emitente não corresponde ao CNPJ do informado conforme o tipo de emitente informado na DPS. |  |
| `E1284` | CPF informado para o emitente da NFS-e é inválido (verificar DV). | `NFSe/infNFSe/emit/CPF` |
| `E1285` | O CPF do emitente não corresponde ao CPF do informado conforme o tipo de emitente informado na DPS. |  |
| `E1286` | O código do município do emitente da NFS-e difere do código do município emissor informado na NFS-e. | `NFSe/infNFSe/emit/enderNac/cMun` |
| `E1287` | O valor calculado de ajuste (dedução/redução) não corresponde aos valores de (valor do serviço x percentual de ajuste (dedução/redução)), quando pAjusteBCISSQN é informado na DPS e/ou ao somatório dos valores do campo vAjusteBC, quando um ou mais documentos são informados para ajuste (dedução/redução) da base de cálculo do ISSQN. | `NFSe/infNFSe/valores/vCalcAjusteBCISSQN` |
| `E1288` | O valor calculado do percentual de redução da base de cálculo por Benefício Municipal não corresponde aos valores de (valor do serviço x percentual de benefício municipal), quando pRedBCBM é informado na DPS. | `NFSe/infNFSe/valores/vCalcBM` |
| `E1289` | O produto do valor da base de cálculo pela alíquota aplicada, ambos informados na NFS-e compartilhada, não está de acordo com o resultado calculado pelo sistema (vBC x pAliAplic). | `NFSe/infNFSe/valores/vISSQN` |
| `E1290` | O tipo de benefício municipal deve existir obrigatoriamente, correspondendo ao tipo de benefício parametrizado, quando o número do benefício municipal (nBM) for informado na DPS. | `NFSe/infNFSe/valores/tpBM` |
| `E1294` | Prazo para entrega da DF-e excedido. |  |
| `E1295` | Valor da Base de cálculo para ISSQN incorreto. | `NFSe/infNFSe/valores/vBC` |
| `E1297` | O valor BC calculado não pode estar reduzida de forma que resulte para valor do ISSQN a uma alíquota efetiva menor que 2%, exceto para os códigos relativos aos subitens 042201, 042301, 050901, 070201, 070202, 070501 , 070502, 090201, 090202, 100101, 100102, 100103, 100104, 100105, 100201, 100202, 100301, 100401, 100402, 100403, 100501, 100502, 100601, 100701, 100801, 100901, 101001, 150101, 150102, 150103, 150104, 150105, 151001, 151002, 151003, 151004, 151005, 160101, 160102, 160103, 160104, 160201, 170501, 170601, 171001, 171002, 171101, 171102, 171201, 210101, 250301, da lista de serviços nacional do Sistema Nacional NFS-e. |  |
| `E1300` | Não é permitido informar alíquota aplicada superior a 5%. | `NFSe/infNFSe/valores/pAliqAplic` |
| `E1301` | Não é permitido informar o código do local de incidência quando o campo referente à tributação do ISSQN indicar imunidade, exportação ou não incidência. | `NFSe/infNFSe/cLocIncid` |
| `E1302` | Exceto para o campo vLiq, não é permitido informar os demais campos do grupo valores para prestador de serviço optante do simples nacional do tipo MEI. | `NFSe/infNFSe/valores` |
| `E1303` | Exceto para o campo vLiq, não é permitido informar os demais campos do grupo valores quando o campo referente à tributação do ISSQN indicar imunidade, exportação ou não incidência. |  |
| `E1304` | O código do município emissor da NFS-e não existe conforme tabela do IBGE ou difere do código do município que está compartilhando o documento com o ADN do Sistema Nacional NFS-e. |  |
| `E1305` | É obrigatório informar o código do local de incidência quando o campo referente à tributação do ISSQN indicar Operação Tributável. |  |
| `E1307` | Exceto para o campo vLiq, não é permitido informar os demais campos do grupo valores quando o prestador de serviço possui algum regime especial de tributação. |  |
| `E1308` | NFS-e a ser substituída não possui um evento de Cancelamento por substituição compartilhado com o ADN e por isso não pode ser substituída. |  |
| `E1309` | O código do local de incidência do ISSQN não existe conforme a tabela de municípios IBGE ou tabela de concessões de rodovia ou tabela de localidade geral no ANEXO_A-MUNICIPIO_IBGE-PAISES_ISO2-SNNFSe. |  |
| `E1310` | O identificador desta NFS-e substituta não está referenciado no evento de Cancelamento por substituição da NFS-e substituída. |  |
| `E1311` | Exceto para o campo vLiq, não é permitido informar os demais campos do grupo valores quando a exigibilidade da tributação do ISSQN estiver suspensa por decisão judicial ou administrativa. |  |
| `E1313` | A localidade de incidência para o ISSQN deve corresponder ao município do estabelecimento/domicílio do prestador do serviço, quando não for informado o código de tributação nacional (cTribNac) 200101, da lista nacional de serviços do Sistema Nacional NFS-e, e a localidade de prestação do serviço corresponder a "Águas Marítimas" (0000000). |  |
| `E1317` | O local de incidência do ISSQN deve ser igual ao município da prestação do serviço (NFSe/infNFSe/DPS/infDPS/serv/locPrest/cLocPrestacao) do serviço informado na NFS-e compartilhada pelo município, quando informado qualquer código de tributação nacional cuja regra de incidência indique o local da prestação, conforme a tabela MUN.INCID_INFO.SERV. do ANEXO_I-SEFIN_ADN-DPS_NFSe-SNNFSe.. |  |
| `E1321` | O local de incidência do ISSQN deve ser igual ao município do endereço do tomador/adquirente do serviço informado na NFS-e compartilhada pelo município (NFSe/infNFSe/DPS/infDPS/toma/end/endNac/cMun). Exceto quando o tomador e o destinatário forem identificados por: a) CNPJ, e o CNPJ de ambos possuir a mesma raiz; ou b) pelo mesmo CPF; Em ambos os cenários o código do local de incidência do ISSQN deve ser igual ao código do município do endereço do destinatário do serviço (NFSe/infNFSe/DPS/infDPS/dest/end/endNac/cMun). |  |
| `E1325` | O local de incidência do ISSQN deve ser igual ao município do endereço do prestador (NFSe/infNFSe/DPS/infDPS/prest/end/endNac/cMun) do serviço informado na NFS-e compartilhada pelo município, quando informado qualquer código de tributação nacional cuja regra de incidência indique o município do estabelecimento do prestador, conforme a tabela MUN.INCID_INFO.SERV. do ANEXO_I-SEFIN_ADN-DPS_NFSe-SNNFSe. |  |
| `E1327` | É obrigatório informar a descrição do local de incidência quando o código do local de incidência (cLocIncid) for informado. | `NFSe/infNFSe/xLocIncid` |
| `E1329` | Não é permitido informar a descrição do local de incidência quando o código do local de incidência (cLocIncid) não for informado. |  |
| `E1388` | O endereço nacional do intermediário do serviço deve ser informado na DPS quando o intermediário for identificado pelo CNPJ. | `NFSe/infNFSe/DPS/infDPS/interm/end/endNac` |
| `E1402` | Quando é informado o subitem 200101 para o código de tributação nacional (cTribNac), não é permitido informar 0000000, que representa "Águas Marítimas", para o local de prestação do serviço (cLocPrestacao). |  |
| `E1506` | Valor total de tributos retidos da NFS-e incorreto. | `NFSe/infNFSe/valores/vTotalRet` |
| `E1508` | Valor líquido da NFS-e incorreto. | `NFSe/infNFSe/valores/vLiq` |
| `E1515` | É obrigatório informar o grupo de informações de IBS/CBS da NFS-e quando o grupo de informações de IBS/CBS da DPS for informado. | `NFSe/infNFSe/IBSCBS` |
| `E1517` | Não é permitido informar o grupo de informações de IBS/CBS da NFS-e quando o grupo de informações de IBS/CBS da DPS não for informado. |  |
| `E1518` | Não é permitido informar a localidade de incidência quando não houver indicação de tributação IBS/CBS, conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/IBSCBS/cLocalidadeIncid` |
| `E1519` | Código da localidade de incidência diverge do que deveria ser informado de acordo com a tabela de indicador da operação. |  |
| `E1521` | Código da localidade de incidência não foi informado ou diverge do que deveria ser informado de acordo com a tabela de indicador da operação. |  |
| `E1522` | O percentual redutor para compras governamentais (IBS/CBS) não deve ser informado. | `NFSe/infNFSe/IBSCBS/pRedutor` |
| `E1523` | O percentual redutor para compras governamentais (IBS/CBS) deve ser informado. |  |
| `E1524` | Não é permitido informar os campos do grupo Valores para IBS/CBS quando não houver indicação de tributação IBS/CBS conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/IBSCBS/valores` |
| `E1525` | É obrigatório informar os campos do grupo Valores para IBS/CBS, conforme ocorrência dos campos pelo leieute, quando houver indicação de tributação IBS/CBS conforme consulta à calculadora IBS/CBS. |  |
| `E1526` | Não é permitido informar o valor da BC quando não houver indicação de tributação IBS/CBS, conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/IBSCBS/valores/vBC` |
| `E1529` | Não é permitido informar o valor objeto de reembolso, repasse ou ressarcimento, já tributados que não integram da base de cálculo do ISSQN, do IBS e da CBS (vCalcAjusteBCIBSCBS), quando o valor ou percentual de ajuste de base de cálculo for informado na DPS. | `NFSe/infNFSe/IBSCBS/valores/vCalcAjusteBCIBSCBS` |
| `E1530` | Valor da Base de cálculo para IBS/CBS incorreto. |  |
| `E1531` | Não é permitido informar o valor objeto de reembolso, repasse ou ressarcimento já tributados que não integram da base de cálculo do ISSQN, do IBS e da CBS (vCalcAjusteBCIBSCBS), se o grupo de documentos referenciados, que irão compor o valor, não foi informado na DPS ou se foram informados e os tipos de ajuste (tpAjusteBC) for igual a: 2, 5, 6, 7, 8, 9 ou 99. |  |
| `E1533` | O valor objeto de reembolso, repasse ou ressarcimento já tributados que não integram da base de cálculo do ISSQN, do IBS e da CBS (vCalcAjusteBCIBSCBS) deve ser informado, obrigatoriamente, se o grupo de documentos referenciados que irão compor o valor foi informado na DPS. Exceto se o CST/cClasTrib indicar que não há tributação do IBS/CBS (ind_IBSCBS = 0), conforme resultado da consulta à calculadora do IBS/CBS. |  |
| `E1534` | O valor objeto de reembolso, repasse ou ressarcimento já tributados que não integram da base de cálculo do ISSQN, do IBS e da CBS (vCalcAjusteBCIBSCBS) deve ser menor que o valor do serviço prestado. |  |
| `E1535` | O valor objeto de reembolso, repasse ou ressarcimento já tributados que não integram da base de cálculo do ISSQN, do IBS e da CBS (vCalcAjusteBCIBSCBS) deve ser igual à soma dos valores de documentos referenciados informados na DPS e que possuem tpAjusteBC = 101, 102, 103, 104, 105 ou 199. Exceto se o CST/cClasTrib indicar que não há tributação do IBS/CBS (ind_IBSCBS = 0), conforme resultado da consulta à calculadora do IBS/CBS. |  |
| `E1537` | O valor calculado de dedução/redução do IBS e da CBS (vCalcAjusteBCLocImoveis) não deve ser informado. | `NFSe/infNFSe/IBSCBS/valores/vCalcAjusteBCLocImoveis` |
| `E1538` | O NIF ou cNaoNIF do fornecedor deve ser informado quando o grupo de informações de endereço no exterior do fornecedor de serviços for informado. |  |
| `E1539` | Alíquota da UF para IBS incorreta. | `NFSe/infNFSe/IBSCBS/valores/uf/pIBSUF` |
| `E1540` | O percentual redutor de alíquota para o IBS estadual não deve ser informado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. | `NFSe/infNFSe/IBSCBS/valores/uf/pRedAliqUF` |
| `E1541` | O percentual redutor de alíquota para o IBS estadual deve ser informado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. |  |
| `E1543` | O percentual redutor de alíquota para o IBS estadual informado difere do indicado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. |  |
| `E1545` | O percentual redutor de alíquota para o IBS municipal não deve ser informado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. | `NFSe/infNFSe/IBSCBS/valores/mun/pRedAliqMun` |
| `E1546` | O percentual redutor de alíquota para o IBS municipal deve ser informado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. |  |
| `E1547` | O percentual redutor de alíquota para o IBS municipal informado difere do indicado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. |  |
| `E1548` | Percentual de redução de alíquota municipal incorreto. |  |
| `E1549` | Alíquota efetiva do Município para IBS incorreta. | `NFSe/infNFSe/IBSCBS/valores/mun/pAliqEfetMun` |
| `E1550` | O percentual redutor de alíquota para a CBS não deve ser informado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. | `NFSe/infNFSe/IBSCBS/valores/fed/pRedAliqCBS` |
| `E1551` | O percentual redutor de alíquota para a CBS deve ser informado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. |  |
| `E1552` | O percentual redutor de alíquota para a CBS informado difere do indicado para o código da classificação tributária - cClassTribIBSCBS informado na DPS. |  |
| `E1553` | Percentual redutor de alíquota para a CBS incorreto. |  |
| `E1554` | Alíquota efetiva da União para CBS incorreta. | `NFSe/infNFSe/IBSCBS/valores/fed/pAliqEfetCBS` |
| `E1555` | Valor total da NFS-e está incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/vTotNF` |
| `E1556` | Valor total do IBS incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS/vIBSTot` |
| `E1557` | Percentual redutor de alíquota para o IBS estadual incorreto. |  |
| `E1558` | Alíquota da União para CBS incorreta. | `NFSe/infNFSe/IBSCBS/valores/fed/pCBS` |
| `E1559` | O valor calculado de dedução/redução do IBS e da CBS (vCalcAjusteBCLocImoveis) deve ser informado. |  |
| `E1560` | Grupo crédito presumido para IBS não deve ser informado. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSCredPres` |
| `E1561` | Grupo crédito presumido para IBS deve ser informado. |  |
| `E1562` | Não é permitido informar os campos do grupo valores referentes ao IBS quando não houver indicação de tributação IBS/CBS conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS` |
| `E1563` | É obrigatório informar os campos do grupo valores referente ao IBS, conforme ocorrência dos campos pelo leieute, quando houver indicação de tributação IBS/CBS conforme consulta à calculadora IBS/CBS. |  |
| `E1564` | O valor calculado de dedução/redução do IBS e da CBS (vCalcAjusteBCLocImoveis) deve ser menor que o valor do serviço prestado. |  |
| `E1565` | Valor do diferimento para o IBS estadual não deve ser informado. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSUFTot/vDifUF` |
| `E1566` | Valor do diferimento para o IBS estadual deve ser informado. |  |
| `E1567` | Valor do diferimento para o IBS estadual incorreto. |  |
| `E1568` | Valor total do IBS estadual incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSUFTot/vIBSUF` |
| `E1569` | Valor do diferimento para o IBS municipal não deve ser informado. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSMunTot/vDifMun` |
| `E1570` | Valor do diferimento para a CBS não deve ser informado. | `NFSe/infNFSe/IBSCBS/totCIBS/gCBS/vDifCBS` |
| `E1571` | Valor do diferimento para o IBS municipal incorreto. |  |
| `E1572` | Valor total do IBS municipal incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gIBS/gIBSMunTot/vIBSMun` |
| `E1573` | Não é permitido informar os campos do grupo de valores referentes à CBS quando não houver indicação de tributação IBS/CBS conforme consulta à calculadora IBS/CBS. | `NFSe/infNFSe/IBSCBS/totCIBS/gCBS` |
| `E1574` | É obrigatório informar os campos do grupo de valores referentes à CBS, conforme ocorrência dos campos pelo leieute, quando houver indicação de tributação IBS/CBS conforme consulta à calculadora IBS/CBS. |  |
| `E1575` | Grupo crédito presumido para CBS não deve ser informado. | `NFSe/infNFSe/IBSCBS/totCIBS/gCBS/gCBSCredPres` |
| `E1576` | Grupo crédito presumido para CBS deve ser informado. |  |
| `E1577` | Alíquota efetiva da UF para IBS incorreta. | `NFSe/infNFSe/IBSCBS/valores/uf/pAliqEfetUF` |
| `E1578` | Alíquota do Município para IBS incorreta. | `NFSe/infNFSe/IBSCBS/valores/mun/pIBSMun` |
| `E1579` | O valor calculado de dedução/redução do IBS e da CBS (vCalcAjusteBCLocImoveis) está incorreto. |  |
| `E1580` | Valor do diferimento para a CBS deve ser informado. |  |
| `E1581` | Valor do diferimento para a CBS incorreto. |  |
| `E1582` | Valor total da CBS da União incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gCBS/vCBS` |
| `E1583` | Grupo de tributação regular não deve ser informado para o cClassTribIBSCBS indicado. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular` |
| `E1584` | Grupo de tributação regular deve ser informado para o cClassTribIBSCBS indicado. |  |
| `E1585` | Alíquota efetiva de tributação regular do IBS estadual incorreta. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular/pAliqEfeRegIBSUF` |
| `E1586` | Valor da tributação regular do IBS estadual incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular/vTribRegIBSUF` |
| `E1587` | Alíquota efetiva de tributação regular do IBS municipal incorreta. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular/pAliqEfeRegIBSMun` |
| `E1588` | Valor da tributação regular do IBS municipal incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular/vTribRegIBSMun` |
| `E1589` | Alíquota efetiva de tributação regular da CBS incorreta. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular/pAliqEfeRegCBS` |
| `E1590` | Valor da tributação regular da CBS incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribRegular/vTribRegCBS` |
| `E1591` | Valor do diferimento para o IBS municipal deve ser informado. |  |
| `E1600` | Grupo de compras governamentais não deve ser informando quando o tpEnteGov não foi informado na DPS. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGov` |
| `E1601` | Grupo de compras governamentais deve ser informando quando o tpEnteGov não foi informado na DPS. |  |
| `E1602` | Alíquota do IBS de competência do Estado incorreta. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGovpIBSUF` |
| `E1603` | Valor do Tributo do IBS da UF incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGovvIBSUF` |
| `E1604` | Alíquota do IBS de competência do Município incorreta. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGovpIBSMun` |
| `E1605` | Valor do Tributo do IBS do Município incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGovvIBSMun` |
| `E1606` | Alíquota da CBS incorreta. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGovpCBS` |
| `E1607` | Valor do Tributo da CBS incorreto. | `NFSe/infNFSe/IBSCBS/totCIBS/gTribCompraGovvCBS` |
| `E1630` | Arquivo enviado com erro na assinatura. | `NFSe/Signature` |
| `E1632` | Certificado Digital da assinatura inválido. |  |
| `E1634` | Certificado Digital fora do padrão estabelecido. |  |
| `E1636` | A assinatura é obrigatória quando for enviado para a API. |  |
| `E1638` | A assinatura deve ser feita com o certificado digital do município emissor da NFS-e. |  |
| `E9996` | Nesta versão da aplicação, não é permitida a emissão de NFS-e pelo tomador ou intermediário. | `NFSe/infNFSe/DPS/infDPS/tpEmit` |
