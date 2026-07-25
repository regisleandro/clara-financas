"use client";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import type { Activity } from "@/lib/activity";

/**
 * "Execução desta resposta" — o trace do design, sobre o `Task` do AI Elements.
 *
 * Mostra o que a Clara fez para chegar à resposta: quais ferramentas chamou e
 * a qual especialista delegou. É o que sustenta a promessa de número
 * verificável; sem isso, "cálculo verificado" é só uma frase.
 *
 * Renderiza TAMBÉM quando ainda não há passo nenhum — no começo do turno o
 * modelo só está pensando, e ficar sem indicador dá a impressão de que nada
 * está acontecendo.
 *
 * Limite: as ferramentas internas de um subagente rodam na sessão filha; elas
 * chegam por uma assinatura separada, não por este stream.
 */
export function ExecutionTrace({ activity, busy }: { activity: Activity; busy: boolean }) {
  const running = busy && activity.current !== null;
  if (activity.steps.length === 0 && !running) return null;

  const failed = activity.steps.some((step) => step.status === "failed");

  // Enquanto roda, o título é o que está acontecendo agora — o próprio estado
  // vira o rótulo, em vez de um "carregando" genérico.
  const title = running
    ? (activity.current?.label ?? "Trabalhando")
    : failed
      ? "Execução desta resposta · com falha"
      : "Execução desta resposta";

  return (
    <Task defaultOpen={false} className="w-full">
      <TaskTrigger title="">
        <div className="flex w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <StatusDot running={running} failed={failed} />
          {running ? (
            <Shimmer className="text-sm">{title}</Shimmer>
          ) : (
            <span>{title}</span>
          )}
          {activity.steps.length > 0 ? (
            <span className="clara-small ml-auto">
              {activity.steps.length} {activity.steps.length === 1 ? "passo" : "passos"}
            </span>
          ) : null}
        </div>
      </TaskTrigger>

      <TaskContent className="mt-3 space-y-2 border-l pl-4">
        {activity.steps.map((step) => (
          <TaskItem key={step.id}>
            <span className={step.status === "failed" ? "text-destructive" : undefined}>
              {step.status === "done" ? "✓" : step.status === "failed" ? "✕" : "•"} {step.label}
            </span>
            {step.detail !== undefined ? (
              <span className="clara-small block pl-4">{step.detail}</span>
            ) : null}
          </TaskItem>
        ))}
      </TaskContent>
    </Task>
  );
}

/** Ponto de estado: pulsa enquanto roda, cor fixa quando termina. */
function StatusDot({ running, failed }: { running: boolean; failed: boolean }) {
  const color = failed
    ? "var(--destructive)"
    : running
      ? "var(--clara-blue)"
      : "var(--clara-green)";

  return (
    <span aria-hidden="true" className="relative grid size-4 shrink-0 place-items-center">
      {running ? (
        <span
          className="absolute inset-0 rounded-full opacity-40"
          style={{ background: color, animation: "clara-dots 1.2s ease-in-out infinite" }}
        />
      ) : null}
      <span className="size-2 rounded-full" style={{ background: color }} />
    </span>
  );
}
