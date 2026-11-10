# Changelog

## 0.1.1

Correção do leitor de evento. **Nenhuma chamada real à Sefin foi feita** (vale o que a 0.1.0 diz).

### Corrigido

- **`lerEvento` aceita o `xs:choice` inteiro de `TCInfPedReg`**: os 16 grupos dos dois XSD v1.01 (`v1.01-20260209` e `PRODREST-v1.01-20261020`, iguais nesse ponto). A 0.1.0 só aceitava 5 (101101, 105102, 305101, 305102, 305103) e recusava com "tipo de evento … fora do XSD" os outros 11, entre eles o **105104** (cancelamento deferido por análise fiscal) e o **105105** (indeferido). Quem usava o leitor para fechar a nota deixava a nota cancelada pela análise fiscal como autorizada.
- O leitor só devolve o tipo; quais tipos extinguem a nota continua sendo decisão do chamador.
- Cerca: `test/leitores.test.ts` lê o `xs:choice` dos dois XSD (16 de 16 aceitos) e valida no XSD um pedido 105104 e um 105105 antes de lê-los.

## 0.1.0

Primeira versão. **Nenhuma chamada real à Sefin foi feita**: o que depende da resposta do servidor é hipótese marcada no código e fica para a T6.1 (produção restrita).

### O que faz

- **Id** da DPS (45 caracteres) e do pedido de evento (59), com validação de série (1 a 49999), `nDPS` e tipo de inscrição (CNPJ = 2, CPF = 1).
- **DPS v1.01** (`montarDps`), um perfil por ambiente: `producao` valida no XSD `v1.01-20260209` e `producao-restrita` no `PRODREST-v1.01-20261020`. CNPJ com letra só no perfil da restrita.
- **Pedido de cancelamento** `e101101` (`montarPedidoCancelamento`), válido nos dois XSD.
- **Assinatura** XMLDSig enveloped, constante única `ALGORITMO_ASSINATURA`: RSA-SHA1 + C14N 1.0.
- **Transporte** (`criarTransporte`) com `undici`: HTTP/1.1, TLS 1.2 no mínimo, certificado do servidor verificado, tempo de 30 000 ms; nunca lança (falha de rede, TLS ou tempo volta com `status: 0` e o motivo).
- **Leitores** do XML autorizado (`lerNfse`), do evento (`lerEvento`) e do certificado (`lerCertificado`).
- **Oráculo diferencial** de teste: a DPS do pacote comparada com a da `open-nfse@0.11.1` (devDependency de teste, nenhum byte dela em produção), em 9 fixtures sintéticas, no perfil de produção. As três diferenças encontradas são aceitas com fonte oficial (formato do decimal, deslocamento de `dhEmi`); ver `test/oraculo.test.ts`.

### O que não faz

- Não fala com a Sefin real. Nenhum envio, consulta ou cancelamento foi exercitado fora de servidor simulado.
- Não monta o grupo `IBSCBS` (fora do tipo nos dois perfis), nem `piscofins`, nem `pDR`, nem endereço no exterior, nem tomador ou intermediário no exterior; elemento fora da lista do AquaPrime não entra.
- Não lê variável de ambiente nem conhece banco: certificado, chave e ambiente entram por parâmetro.

### A confirmar na T6.1 (produção restrita)

- **URL base** de cada ambiente (`BASE` em `src/transporte.ts`): produção `https://sefin.nfse.gov.br/SefinNacional`; restrita `https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional`.
- **`CAMPO_DPS`** (`dpsXmlGZipB64`), o campo do evento (`pedidoRegistroEventoXmlGZipB64`) e os campos e raízes XML das respostas de sucesso (`nfseXmlGZipB64`, `chaveAcesso`, `eventoXmlGZipB64`; raiz `NFSe`, `evento` ou `procEvento*`) vêm da open-nfse; se a real for outra, o `emitir` devolve `transiente` (seguro, mas inútil).
- **Formato das respostas de erro**: `erros`/`erro`, lista ou objeto, é hipótese tolerante; código válido só `E` + 4 dígitos.
- **Códigos transientes `E1217` e `E1206`**: vêm da open-nfse, sem citação oficial na T0.1.
- **Algoritmo de assinatura RSA-SHA1 + C14N 1.0**: escolha do G0 Q3 (a). A open-nfse assina com RSA-SHA256 + exc-c14n; só a resposta real da restrita decide. Troca é a constante `ALGORITMO_ASSINATURA`.
- O caminho de TLS **sem `ca`** (lista padrão do Node) só foi exercitado com `ca` de outra AC; falta o servidor real.
- Defeito no XSD oficial de produção: o padrão de `TSSerieDPS` traz `^` e `$` literais, que o libxml2 trata como caracteres e recusa qualquer série. Os testes ajustam o padrão **só em memória** (`test/xsd.ts`); se a Sefin validar ao pé da letra, toda DPS de produção seria recusada.
- `tpAmb`: produção = 1, restrita = 2 (o pacote impõe); confirmar que a restrita exige 2.

### Limitações conhecidas

- **`verificarAssinatura` aceita ataque de wrapping** (elemento `infNFSe` forjado, `Signature` fora do pai, `Id` duplicado, referência a subelemento). **Não use como prova de autenticidade.** Os leitores do pacote não o chamam.
- **Padrões de chave alfanumérica da produção restrita são incoerentes entre si**: `TSIdNFSe` põe a letra nos índices 9 a 22, `TSChaveNFSe` nos 6 a 19 e `TSIdPedRegEvt` nos 8 a 22. Uma NFS-e da restrita com CNPJ alfanumérico não passa por todos os padrões ao mesmo tempo: `lerNfse` aceita, `lerEvento` e o cancelamento recusam (nota presa em `autorizada`). Só a restrita, só CNPJ com letra; confirmar com a Sefin.
- A ordem de `cServ` difere entre os dois XSD (produção `…xDescServ, cNBS`; restrita `…cNBS, cIntContrib, xDescServ`): o pacote segue cada um; não consta nos quatro pontos do item 8 da T0.1 (ver `xsd/COMPARACAO.md`).
