/**
 * Identidade do comerciante, separada do texto que o documento imprimiu.
 *
 * O extrator é isolado do razão por construção — ele não vê o que já foi
 * registrado, então normaliza cada documento do zero. Em duas faturas reais do
 * mesmo cartão isso produziu:
 *
 *     maio:  "•••• 4851 Claude.Ai Subscription BRL 110.00 = USD 22.24 …"
 *     junho: "Anthropic* Claude Sub"
 *     maio:  "Google Mubi Curated C"       junho: "Dl*Google Mubi C"
 *
 * Nenhuma análise que agrupe pelo texto cru sobrevive a isso: a assinatura
 * some, a recorrência não fecha, e a regra aprendida numa fatura não pega na
 * seguinte.
 *
 * Este módulo resolve a parte MECÂNICA do problema — o ruído que o emissor
 * acrescenta e que não tem nada a ver com quem recebeu o dinheiro: máscara do
 * cartão, número de parcela, texto de conversão de moeda, invólucro do IOF,
 * prefixo do meio de pagamento. É determinístico e testável.
 *
 * O que ele deliberadamente NÃO faz é adivinhar que "Anthropic" e "Claude.Ai
 * Subscription" são a mesma empresa. Isso é conhecimento sobre o mundo, não
 * sobre a string, e o lugar dele é o ciclo de aprendizado — um conceito
 * `MerchantAlias` aprovado pela pessoa. Chutar aqui produziria fusões erradas
 * silenciosas, que é o pior defeito possível numa análise financeira: some
 * dinheiro de um lugar e aparece em outro sem ninguém ver.
 */

/** Máscara do cartão no início da linha: "•••• 4851 ", "**** 1234 ". */
const CARD_MASK = /^[•*·.\s]{2,}\s*\d{4}\s*/u;

/** "- Parcela 3/12", "Parcela 3/12", "3/12" ao fim da descrição. */
const INSTALLMENT = /\s*[-–—]?\s*(parcela\s*)?\d{1,2}\s*\/\s*\d{1,2}\s*$/iu;

/**
 * Cauda de conversão de moeda estrangeira. O emissor cola o câmbio do dia na
 * própria descrição, então o MESMO comerciante gera uma string diferente a
 * cada cobrança — é o que separa "Cursor, Ai Powered Ide USD 10.00 Conversão:
 * USD 1 = R$ 5,26" de "Cursor, Ai Powered Ide".
 */
const FX_TAIL = /\s+(usd|eur|gbp|brl)\s*[\d.,]+.*$/iu;
const FX_CONVERSION = /\s*convers[ãa]o\s*:.*$/iu;

/** Invólucro do IOF: `IOF de "Claude.Ai Subscription"`. */
const IOF_WRAPPER = /^iof\s+(de|sobre)\s*["“”']?\s*(?<inner>.+?)\s*["“”']?\s*$/iu;

/**
 * Prefixo do intermediário de pagamento, não do comerciante.
 *
 * A convenção do adquirente é `<intermediário>*<estabelecimento>`: "Dl*Google
 * Medium" é a Medium cobrando via Google, "Mp *Melimais" é o Mercado Pago.
 * Manter o prefixo faz a MESMA loja virar duas conforme o meio usado.
 *
 * Era uma lista fechada de intermediários conhecidos, e uma fatura nova mostrou
 * por que isso não se sustenta: `Mp *Melimais` e `Ec *Melimais` são a mesma
 * loja cobrada por dois adquirentes, e só o primeiro estava na lista. O mesmo
 * com `Ppro *Microsoft` contra `Microsoft*Microsoft`. A lista sempre estará
 * atrás da realidade, porque quem inventa código de adquirente é o mercado.
 *
 * Então a regra passa a ser POSICIONAL: o que vem antes do primeiro `*`, no
 * começo da linha, é sempre roteamento. Exige que sobre algo depois — uma
 * descrição que é só o prefixo não tem comerciante a extrair — e limita o
 * tamanho do token para não comer uma frase que por acaso contenha asterisco.
 */
const GATEWAY_PREFIX = /^[a-z0-9]{1,15}\s*\*+\s*(?=\S)/iu;

/** Sufixo de estabelecimento que o emissor às vezes acrescenta. */
const TRAILING_NOISE = /\s*[-–—*]+\s*(nupay|nubank|pix|debito|credito)\s*$/iu;

/**
 * Chave canônica do comerciante, ou `null` quando não há identidade a extrair.
 *
 * Recebe a transação inteira, e não só `merchant`, porque o campo `merchant`
 * do extrator já vem sujo (ele copia o trecho da descrição) e porque o
 * invólucro do IOF só existe na descrição original.
 */
export function merchantKey(input: {
  originalDescription: string;
  merchant?: string | null;
}): string | null {
  const source = input.merchant?.trim() ? input.merchant : input.originalDescription;
  if (typeof source !== "string" || source.trim() === "") return null;

  let text = source.trim();

  // O IOF vem primeiro: o que interessa é o comerciante DENTRO das aspas, e
  // ele ainda passa por toda a limpeza abaixo.
  const iof = IOF_WRAPPER.exec(text);
  if (iof?.groups?.inner !== undefined) text = iof.groups.inner;

  text = text.replace(CARD_MASK, "");
  text = text.replace(GATEWAY_PREFIX, "");
  text = text.replace(FX_CONVERSION, "");
  text = text.replace(FX_TAIL, "");
  text = text.replace(INSTALLMENT, "");
  text = text.replace(TRAILING_NOISE, "");

  const key = text
    .normalize("NFD")
    // Diacríticos fora: o mesmo comerciante aparece com e sem acento entre
    // faturas, e a diferença nunca é de identidade.
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");

  return key === "" ? null : key;
}

/**
 * Duas chaves são o mesmo comerciante quando uma é a versão TRUNCADA da outra.
 *
 * A fatura corta a descrição numa largura fixa, e a largura muda entre o corpo
 * e o resumo — daí "google mubi c" e "google mubi curated c" saírem do mesmo
 * lançamento. O critério é conservador de propósito: exige que os tokens
 * anteriores batam exatamente e que o último token da chave curta seja PREFIXO
 * do token correspondente da longa. "google youtube" e "google medium" diferem
 * no segundo token e continuam sendo dois comerciantes.
 */
export function isTruncationOf(shorter: string, longer: string): boolean {
  if (shorter === "" || longer === "") return false;
  if (shorter === longer) return true;

  const short = shorter.split(" ");
  const long = longer.split(" ");
  if (short.length > long.length) return false;

  for (let index = 0; index < short.length - 1; index += 1) {
    if (short[index] !== long[index]) return false;
  }

  const last = short[short.length - 1]!;
  const counterpart = long[short.length - 1]!;

  // Um último token de uma letra só ("c") é ruído de corte, não evidência.
  // Exigir 2+ evita fundir "posto a" com "posto amarelo" por acaso.
  if (last.length < 2) return short.length > 2 && counterpart.startsWith(last);

  return counterpart.startsWith(last);
}

/**
 * Agrupa chaves equivalentes num representante comum.
 *
 * A equivalência por truncamento é resolvida AQUI, na análise, e não gravada
 * na linha. Duas razões, e as duas são estruturais:
 *
 *  1. **A linha confirmada é imutável.** Escolher o canônico na hora de gravar
 *     significaria voltar e reescrever linhas antigas quando uma forma mais
 *     longa aparecesse numa fatura futura — exatamente o que o trigger do
 *     banco existe para impedir.
 *  2. **O resultado não pode depender da ordem de chegada.** Gravado, o
 *     canônico de "google mubi c" seria um se ela viesse primeiro e outro se
 *     viesse depois. Agrupado na leitura, o mesmo conjunto de transações
 *     sempre produz o mesmo agrupamento.
 *
 * O representante é a forma mais CURTA do grupo: é o maior denominador comum
 * entre os cortes que o emissor imprimiu, e é estável quando um corte novo
 * aparece. Ele é chave interna — o que a pessoa lê continua sendo `merchant`.
 */
export function clusterMerchantKeys(
  keys: Iterable<string>,
  /**
   * Apelidos APROVADOS pela pessoa: grupos de chaves que são a mesma empresa
   * ainda que nenhuma regra de string consiga saber disso — "anthropic claude
   * sub" e "claude ai subscription". É o que o ciclo de aprendizado grava, e
   * consumi-lo aqui é o que impede o conceito de virar anotação sem efeito.
   */
  aliases: Iterable<Iterable<string>> = [],
): Map<string, string> {
  // Da mais curta para a mais longa: assim cada chave encontra o representante
  // já estabelecido em vez de fundar um grupo que outra teria de absorver.
  const ordered = [...new Set(keys)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  const representatives: string[] = [];
  const clustered = new Map<string, string>();

  for (const key of ordered) {
    const found = representatives.find((candidate) => isTruncationOf(candidate, key));
    if (found === undefined) {
      representatives.push(key);
      clustered.set(key, key);
    } else {
      clustered.set(key, found);
    }
  }

  // Os apelidos vêm DEPOIS do truncamento e fundem grupos inteiros, não
  // chaves soltas: se "claude ai subscription" já reunia três grafias, o
  // apelido tem de levar as três junto.
  for (const group of aliases) {
    const members = [...group].filter((member) => clustered.has(member));
    if (members.length < 2) continue;

    // Representante estável: o menor em ordem alfabética entre os grupos
    // atingidos. Não depende da ordem em que o apelido foi escrito.
    const target = members
      .map((member) => clustered.get(member)!)
      .sort((a, b) => a.localeCompare(b))[0]!;
    const absorbed = new Set(members.map((member) => clustered.get(member)!));

    for (const [key, representative] of clustered) {
      if (absorbed.has(representative)) clustered.set(key, target);
    }
  }

  return clustered;
}
