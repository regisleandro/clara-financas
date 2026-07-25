"use client";

import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import type { Activity } from "@/lib/activity";

/**
 * "Execução desta resposta" — o trace do design, sobre o `Task` do AI Elements.
 *
 * Mostra o que a Clara fez para chegar à resposta: quais ferramentas chamou e
 * a qual especialista delegou. É o que sustenta a promessa de que os números
 * são verificáveis — sem isso, "cálculo verificado" é só uma frase.
 *
 * Limite honesto: as ferramentas internas de um subagente rodam na sessão
 * filha e NÃO chegam a este stream. Dá para dizer "o analista trabalhou", não
 * o que ele chamou por dentro. A UI diz isso em vez de fingir.
 */
export function ExecutionTrace({ activity }: { activity: Activity }) {
  if (activity.steps.length === 0) return null;

  const running = activity.current?.status === "running";
  const failed = activity.steps.some((step) => step.status === "failed");

  const title = running
    ? (activity.current?.label ?? "Trabalhando")
    : failed
      ? "Execução desta resposta · com falha"
      : "Execução desta resposta";

  return (
    <Task defaultOpen={running} className="w-full">
      <TaskTrigger title={title} />
      <TaskContent>
        {activity.steps.map((step) => (
          <TaskItem key={step.id}>
            <span className={step.status === "failed" ? "text-destructive" : undefined}>
              {step.status === "done" ? "✓ " : step.status === "failed" ? "✕ " : "· "}
              {step.label}
            </span>
            {step.detail !== undefined ? (
              <span className="clara-small block pl-4">{step.detail}</span>
            ) : null}
          </TaskItem>
        ))}
        {activity.steps.some((step) => step.kind === "subagent") ? (
          <TaskItem>
            <span className="clara-small">
              As ferramentas internas do especialista rodam em sessão própria e não aparecem
              aqui.
            </span>
          </TaskItem>
        ) : null}
      </TaskContent>
    </Task>
  );
}
