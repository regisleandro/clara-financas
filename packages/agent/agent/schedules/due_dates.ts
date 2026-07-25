import { defineSchedule } from "eve/schedules";

import { sweepDueDates } from "../lib/reminders";

/**
 * Varredura diária de vencimentos — a hipótese H6, o gatilho invertido.
 *
 * Três coisas que valem registrar sobre este arquivo:
 *
 * **Roda às 12h UTC, que é 9h em São Paulo.** O cron da Vercel é avaliado em
 * UTC, então um `0 0 * * *` acordaria às 21h do dia anterior para quem usa. A
 * conversão está aqui e o cálculo de "hoje" está no código, nunca deduzido do
 * horário em que o schedule disparou.
 *
 * **Não usa a forma markdown.** Um schedule markdown roda em task mode, com o
 * modelo decidindo o que fazer — e decidir a quem avisar é exatamente o tipo
 * de coisa que não deve depender de interpretação. Aqui a varredura é
 * determinística, e o modelo entra depois, quando a pessoa abre a conversa.
 *
 * **`eve dev` nunca dispara cron.** Para testar:
 *     curl -X POST http://localhost:2000/eve/v1/dev/schedules/due_dates
 */
export default defineSchedule({
  cron: "0 12 * * *",
  async run({ waitUntil }) {
    waitUntil(
      sweepDueDates().then((result) => {
        console.log(
          `[due_dates] ${result.today}: ${result.tenantsScanned} tenants varridos, ` +
            `${result.created.length} avisos criados`,
        );
      }),
    );
  },
});
