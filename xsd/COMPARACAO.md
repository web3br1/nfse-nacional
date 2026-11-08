# Comparação dos dois XSD (conferência 14 e Step 1b da T1.2)

Método: carga dos dois conjuntos, árvore de `TCDPS` expandida (elemento, tipo, `minOccurs`, ordem, padrões e enumerações) e `diff` das duas árvores; a documentação embutida só para os nomes dos códigos. Fonte: `xsd/v1.01-20260209` (produção) e `xsd/PRODREST-v1.01-20261020` (restrita), baixados em 2026-11-08 com `sha256` iguais aos da T0.1 (ver `FONTE.md` de cada pasta). "Linha" é a do `.xsd` citado.

## 1. Os quatro elementos que a lista do item 8 omitiu

| elemento | produção `v1.01-20260209` | restrita `PRODREST-v1.01-20261020` | efeito no pacote | fonte |
| --- | --- | --- | --- | --- |
| `opSimpNac` | `TSOpSimpNac`, enumeração **1, 2, 3** (1 não optante · 2 MEI · 3 ME/EPP) | idem, **1, 2, 3** | o tipo aceita 1 a 3; o **4 não existe nos dois**: volta em `motivos` nomeando `prest.regTrib.opSimpNac` | `tiposSimples_v1.01.xsd:996` × `:1003`; `tiposComplexos_v1.01.xsd:955` × `:968` |
| `regApIBSCBSSN` | **não existe** (0 ocorrências nos 10 `.xsd`) | **não existe** (0 ocorrências) | fora do tipo; se chegar em `regTrib`, volta em `motivos` nomeando o elemento, nos dois perfis | busca textual nos dois conjuntos |
| `cAtvSN` | **não existe** (0 ocorrências) | **não existe** (0 ocorrências) | idem | idem |
| grupo `IBSCBS` do Simples | `infDPS/IBSCBS` existe, `minOccurs = 0`, com `finNFSe` e `cIndOp` obrigatórios dentro | existe, `minOccurs = 0`, `finNFSe` saiu para `infDPS`, `cIndOp` opcional | **não entra** na `EntradaDps` (G0-A2 (a)): a DPS sai sem `IBSCBS` nos dois perfis; o XSD da restrita **não** o exige do Simples, então a suposição da onda 0 se sustenta e a regra de parada 4 não dispara | `tiposComplexos_v1.01.xsd:838` (produção), `:851` (restrita) |

A P1 (`pesquisa-1-leiaute-nfse.md:37`: os três primeiros "não existem no leiaute de Produção") **se confirma**; a comparação acrescenta que também não existem na restrita. Nada contradiz a P1, então a regra de parada 3 não dispara.

## 2. (i) `finNFSe` e o valor da emissão regular

- Produção: `finNFSe` só existe **dentro de** `IBSCBS` (`tiposComplexos_v1.01.xsd:2209`). Sem `IBSCBS`, não há `finNFSe`.
- Restrita: `finNFSe` é **obrigatório em `infDPS`**, logo após `cMotivoEmisTI` (`tiposComplexos_v1.01.xsd:797`).
- Enumeração nos dois: `TSRTCFinNFSe` = **`0`** só, documentada "0 - NFS-e regular" (`tiposSimples_v1.01.xsd:1668` na produção; `:1682` na restrita).
- Valor que o perfil `producao-restrita` grava: **`0`**. O nome "NFS-e regular" vem da anotação do próprio XSD da restrita. **O Anexo I da restrita (F5, `.xlsx`) não foi reaberto nesta sessão**: não estava entre os arquivos autorizados para baixar. Com uma enumeração de um valor só, o Anexo não pode divergir; a conferência do `.xlsx` fica para quem o abrir.

## 3. (ii) `tpDedRed` (produção) × `tpAjusteBC` (restrita)

| | produção | restrita |
| --- | --- | --- |
| grupo | `valores/vDedRed` (`vDR` ou `pDR`, ou `documentos/docDedRed`) | `valores/vAjusteBC` (`vAjusteBCISSQN` ou `pAjusteBCISSQN`, mais `documentos/docAjusteBC`), tudo opcional |
| tipos | `TSIdeDedRed`: 1 alimentação · 2 materiais · 3 produção externa · 4 reembolso · 5 repasse consorciado · 6 repasse plano de saúde · 7 serviços · 8 subempreitada · 9 profissional parceiro · 99 outras deduções | `TSRTCTpAjusteBC`: 2, 5, 6, 7, 8, 9, 99 ("outras deduções **exclusivas do ISSQN**") e 101 a 105 e 199 |
| documentação do valor | `vDR`: "dedução/redução do valor do serviço" (`tiposComplexos_v1.01.xsd:1702`) | `vAjusteBCISSQN`: "ajuste dos valores de base de cálculo do ISSQN"; o grupo de documentos serve a "ISSQN e/ou IBS/CBS" (`tiposComplexos_v1.01.xsd:1841`, `:1852`) |

Os códigos 2, 5, 6, 7, 8, 9 e 99 têm o mesmo número e nome parecido nos dois, mas **nenhum dos dois XSD, nem a T0.1, escreve que um corresponde ao outro**: o conceito mudou de "dedução/redução do valor do serviço" para "ajuste da base de cálculo (ISSQN e/ou IBS/CBS)", o 99 mudou de nome, 1, 3 e 4 saem e 101 a 105 e 199 entram sem origem. **Decisão aplicada (a tradução não se inventa):** o perfil `producao-restrita` recusa entrada com `valores.vDedRed`, nomeando `valores.vDedRed` em `motivos`. O roteiro da T6.1 usa OS sem dedução. O perfil `producao` leva `vDedRed/vDR` (a única forma que o documento do AquaPrime produz: um valor em reais).

## 4. Os quatro pontos do item 8, conferidos de novo

| ponto | produção | restrita | no pacote |
| --- | --- | --- | --- |
| `finNFSe` | só dentro de `IBSCBS` | obrigatório em `infDPS` | restrita emite `<finNFSe>0</finNFSe>` após `tpEmit` |
| `CST`/`cClassTrib` | dentro de `gIBSCBS` | direto em `trib` | **sem efeito**: o grupo `IBSCBS` não entra na entrada |
| `vDedRed` × `vAjusteBC` | existe `vDedRed` | existe `vAjusteBC` | ver seção 3 |
| `toma/xNome` | obrigatório (`TCInfoPessoa`, linha `xNome [1..1]`) | `minOccurs = 0` | produção exige (`motivos`); restrita aceita ausente |
| `TSCNPJ` | `[0-9]{14}` | `[0-9A-Z]{14}` | G0 Q4 (a): letra só na restrita, também no Id (`DPS[0-9]{7}(1[0-9]{14}\|2[0-9A-Z]{14})[0-9]{20}`) |

## 5. Achados que a T0.1 não tinha (fora do item 8)

1. **Ordem de `serv/cServ` difere.** Produção: `cTribNac, cTribMun, xDescServ, cNBS, cIntContrib`. Restrita: `cTribNac, cTribMun, cNBS, cIntContrib, xDescServ`. Fonte: `tiposComplexos_v1.01.xsd:1344-1349` (produção) × `:1483-1495` (restrita). O item 8 da T0.1 declarou "sem diferença estrutural" em `serviço (cTribNac, cNBS)`: comparou elemento, tipo e `minOccurs`, não a ordem. Seria um quinto ponto de divergência entre perfis. O pacote segue a ordem de cada XSD (cerca: `test/dps.test.ts`, "ordem de cServ").
2. **Defeito do XSD de produção em `TSSerieDPS`**: padrão `^0{0,4}\d{1,5}$` (`tiposSimples_v1.01.xsd:161`). Em XSD `^` e `$` são caracteres literais, então um validador estrito (libxml2, o usado aqui) recusa **qualquer** série. A restrita usa `[0-9]{1,4}|[0-8][0-9]{4}`, sem âncoras, e aceita até 89999. Aplicação: `test/xsd.ts` tira as âncoras **em memória**, só para a produção, e só se o padrão aparecer exatamente uma vez; o `.xsd` em disco é byte a byte o do zip. Um teste prova a recusa ao pé da letra. Não se sabe se a Sefin tem o mesmo comportamento: o motor dela é desconhecido (T6.1 mede).
3. **Descrições só de espaços** são recusadas só na restrita (`[\s\S]*[^\s][\s\S]*` em `xDescServ`, `xNome` de atividade, `docRef`, `xInfComp`). O pacote recusa descrição em branco nos dois perfis.
4. **Chave da NFS-e** (`chSubstda`): produção `[0-9]{50}`; restrita `[0-9]{6}[0-9A-Z]{14}[0-9]{30}`. Aplicado por perfil.
5. **Série**: a DPS sai com a série sem zeros (`1`); passa nos dois padrões.
6. `dhEmi` (`TSDateTimeUTC`) exige deslocamento `±hh:00` e **recusa `Z`**; o pacote exige o mesmo.

## 6. O que ficou de fora

`comExt`, `atvEvento`, `infoCompl`, `interm`, `CAEPF`, `NIF`, endereço no exterior, `vDescCondIncond`, `exigSusp`, `BM`, `piscofins`, `cIntContrib`, `fone`, `email`, `xNome`/`end` do prestador (proibidos com `tpEmit = 1`) e o grupo `IBSCBS`: o AquaPrime não os produz (item 8 da T0.1) ou a decisão do dono os exclui. Entram quando um app passar a produzi-los.
