"use client";

import {
  BrainIcon,
  CalculatorIcon,
  CalendarClockIcon,
  CheckIcon,
  FileTextIcon,
  PenLineIcon,
  SaveIcon,
  ScrollTextIcon,
  SearchIcon,
  TagsIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import type { Activity, ActivityIcon } from "@/lib/activity";

/** Cada atividade tem seu desenho: o ícone conta antes do texto ser lido. */
const ICONS: Record<ActivityIcon, LucideIcon> = {
  brain: BrainIcon,
  pen: PenLineIcon,
  document: FileTextIcon,
  calculator: CalculatorIcon,
  search: SearchIcon,
  ledger: ScrollTextIcon,
  calendar: CalendarClockIcon,
  tags: TagsIcon,
  save: SaveIcon,
};

/**
 * Progresso orientado à tarefa, sobre o `Task` do AI Elements.
 *
 * Mostra o que a Clara fez em termos que a pessoa entende. Nomes de tools,
 * subagentes e payloads ficam fora da interface principal.
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
      ? "Não foi possível concluir uma etapa"
      : "Como cheguei a esta resposta";

  return (
    <Task defaultOpen={false} className="w-full">
      <TaskTrigger title="">
        <div className="flex w-full cursor-pointer items-center gap-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <CurrentIcon activity={activity} running={running} failed={failed} />
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

      <TaskContent className="mt-3 flex flex-col gap-2 border-l pl-4">
        {activity.steps.map((step) => {
          const Icon = ICONS[step.icon];
          return (
            <TaskItem key={step.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                {step.status === "done" ? (
                  <CheckIcon className="size-4 text-[var(--clara-green)]" />
                ) : step.status === "failed" ? (
                  <XIcon className="size-4 text-destructive" />
                ) : (
                  <Icon className="size-4 animate-pulse text-[var(--clara-blue)]" />
                )}
              </span>
              <span>
                <span className={step.status === "failed" ? "text-destructive" : undefined}>
                  {step.label}
                </span>
                {step.detail !== undefined ? (
                  <span className="clara-small block">{step.detail}</span>
                ) : null}
              </span>
            </TaskItem>
          );
        })}
      </TaskContent>
    </Task>
  );
}

/** Ícone do estado atual: o desenho muda conforme o que a Clara está fazendo. */
function CurrentIcon({
  activity,
  running,
  failed,
}: {
  activity: Activity;
  running: boolean;
  failed: boolean;
}) {
  if (failed) return <XIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />;
  if (!running) {
    return <CheckIcon className="size-4 shrink-0 text-[var(--clara-green)]" aria-hidden="true" />;
  }

  const Icon = ICONS[activity.current?.icon ?? "brain"];
  return (
    <Icon className="size-4 shrink-0 animate-pulse text-[var(--clara-blue)]" aria-hidden="true" />
  );
}
