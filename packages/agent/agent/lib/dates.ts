/**
 * Datas no fuso de quem usa.
 *
 * O cron da Vercel é avaliado em **UTC**. Um schedule que roda à meia-noite
 * UTC acorda às 21h do dia anterior em São Paulo — então "hoje", para decidir
 * se um vencimento está a três dias, precisa ser calculado aqui, no código, e
 * nunca deduzido do horário em que o schedule disparou.
 */
export const TIMEZONE = "America/Sao_Paulo";

/** Data de hoje em São Paulo, YYYY-MM-DD. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Dias de `from` até `to`. Negativo quando `to` já passou. */
export function daysUntil(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Próxima ocorrência de um dia do mês, a partir de uma data.
 *
 * Meses curtos são tratados por ancoragem no último dia: um compromisso de dia
 * 31 cai em 28 ou 29 de fevereiro, e não transborda para março — transbordar
 * atrasaria o aviso justamente no mês em que ele é mais fácil de esquecer.
 */
export function nextOccurrence(after: string, dayOfMonth: number): string {
  const [year, month] = after.split("-").map(Number) as [number, number, number];
  const currentDay = Number(after.slice(8, 10));

  let targetYear = year;
  let targetMonth = month;
  if (currentDay >= dayOfMonth) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const day = Math.min(dayOfMonth, lastDay);

  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
