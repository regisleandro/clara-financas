/**
 * A mensagem de erro que a PESSOA lê.
 *
 * O que chega em `agent.error.message` é do eve e é escrito para depurar — em
 * inglês, citando sessão, token e transporte. Ia direto para a tela, e o
 * resultado era um bloco âmbar em outro idioma falando de coisas que quem usa
 * não tem como agir sobre.
 *
 * Aqui não se traduz palavra a palavra: reconhece-se a CAUSA e diz-se o que ela
 * significa para a conversa. O texto original vira o caso `default`, porque uma
 * mensagem estranha em inglês ainda é melhor que uma mensagem inventada em
 * português — errar dizendo "a conexão caiu" quando o problema era outro manda
 * a pessoa procurar no lugar errado.
 */
const CAUSAS: ReadonlyArray<{ padrao: RegExp; texto: string }> = [
  {
    padrao: /session (does not belong|not found)|no active session|unauthor/i,
    texto:
      "Esta conversa expirou no servidor. Seus dados estão salvos — o que se perde é o fio desta conversa.",
  },
  {
    padrao: /network|fetch failed|ECONNREFUSED|timed? ?out|aborted/i,
    texto: "Não consegui falar com a Clara agora. Pode ser a conexão.",
  },
  {
    padrao: /rate ?limit|too many requests|429/i,
    texto: "Muitas perguntas em pouco tempo. Espere alguns instantes e tente de novo.",
  },
  {
    padrao: /context|token limit|too long|maximum context/i,
    texto: "Esta conversa ficou longa demais para continuar. Começar uma nova resolve.",
  },
  {
    padrao: /turn (is )?already in flight|already running/i,
    texto: "A Clara ainda está terminando a resposta anterior.",
  },
];

export function mensagemDeErro(original: string): string {
  const texto = original.trim();
  if (texto === "") return "Algo deu errado e a Clara não conseguiu responder.";
  return CAUSAS.find(({ padrao }) => padrao.test(texto))?.texto ?? texto;
}
