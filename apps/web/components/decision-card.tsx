"use client";

import { formatCents } from "@clara-financas/ledger";
import type { PendingRequest } from "@clara-financas/views/hitl";

import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import type { BatchProposal } from "@/lib/artifact";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

type DecisionCopy = {
  title: string;
  consequence: string;
  approveLabel: string;
  denyLabel: string;
  details: string[];
};

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

function decisionCopy(pending: PendingRequest, proposal: BatchProposal | null): DecisionCopy {
  const input = asRecord(pending.toolInput);

  if (pending.toolName === "commit_batch") {
    const count = proposal?.transactionCount;
    const total = proposal?.checksum.extractedTotal;
    const matched = proposal?.checksum.result === "match";
    return {
      title:
        count === undefined
          ? "Registrar esta fatura no razão?"
          : `Registrar ${count} lançamentos no razão?`,
      consequence: "Depois do registro, valor, data e origem não mudam mais.",
      approveLabel: "Registrar fatura",
      denyLabel: "Manter como rascunho",
      details:
        total === undefined
          ? []
          : [
              formatCents(total),
              matched ? "O total confere com a fatura" : "A soma não confere com a fatura",
            ],
    };
  }

  if (pending.toolName === "recategorize_transactions") {
    const changes = Array.isArray(input?.changes) ? input.changes : [];
    const labels = [
      ...new Set(
        changes
          .map((change) => asString(asRecord(change)?.categoryLabel))
          .filter((label): label is string => label !== null),
      ),
    ];
    return {
      title: `Alterar a categoria de ${changes.length} ${
        changes.length === 1 ? "lançamento" : "lançamentos"
      }?`,
      consequence: "Os valores não mudam. A alteração fica registrada no histórico.",
      approveLabel: "Alterar categorias",
      denyLabel: "Manter categorias atuais",
      details: labels.length > 0 ? [`Nova categoria: ${labels.join(", ")}`] : [],
    };
  }

  if (pending.toolName === "save_concept") {
    const title = asString(input?.title) ?? "este aprendizado";
    const description = asString(input?.description);
    const body = asString(input?.body);
    const merchant = asString(input?.merchant);
    const aliases = Array.isArray(input?.aliases)
      ? input.aliases.filter((value): value is string => typeof value === "string")
      : [];
    return {
      title: `Guardar “${title}” para as próximas conversas?`,
      consequence: "A Clara poderá usar esse aprendizado em análises futuras.",
      approveLabel: "Guardar aprendizado",
      denyLabel: "Não guardar",
      details: [
        description,
        merchant === null ? null : `Comerciante: ${merchant}`,
        aliases.length === 0 ? null : `Grafias reconhecidas: ${aliases.join(", ")}`,
        body,
      ].filter((value): value is string => value !== null),
    };
  }

  if (pending.toolName === "save_commitment") {
    const title = asString(input?.title) ?? "este lembrete";
    const dueDate = asString(input?.dueDate);
    const amount = asNumber(input?.expectedAmount);
    const days = asNumber(input?.remindDaysBefore) ?? 3;
    return {
      title: `Criar o lembrete “${title}”?`,
      consequence: `A Clara avisará ${days} ${
        days === 1 ? "dia" : "dias"
      } antes do vencimento.`,
      approveLabel: "Criar lembrete",
      denyLabel: "Não criar",
      details: [
        dueDate === null ? null : `Vencimento: ${dateLabel(dueDate)}`,
        amount === null ? null : `Valor esperado: ${formatCents(amount)}`,
      ].filter((value): value is string => value !== null),
    };
  }

  /**
   * Sem um bloco próprio, uma escrita nova cai no genérico "Confirmar esta
   * alteração?" — que é pedir para a pessoa aprovar no escuro. Cada tool com
   * gate precisa dizer objeto, alcance e consequência aqui.
   */
  if (pending.toolName === "create_adjustment") {
    const amount = asNumber(input?.amountCents);
    const reason = asString(input?.reason);
    return {
      title:
        amount === null
          ? "Registrar um ajuste neste lançamento?"
          : `Registrar um ajuste de ${formatCents(amount)}?`,
      consequence:
        "O lançamento original continua no razão; o ajuste entra como uma linha própria e as duas aparecem na fatura.",
      approveLabel: "Registrar ajuste",
      denyLabel: "Não ajustar",
      details: reason === null ? [] : [reason],
    };
  }

  if (pending.toolName === "reject_batch") {
    const reason = asString(input?.reason);
    return {
      title: "Descartar esta fatura?",
      consequence:
        "Os lançamentos em rascunho são apagados e a fatura deixa de aparecer como pendente. Nada entra no razão.",
      approveLabel: "Descartar fatura",
      denyLabel: "Manter como rascunho",
      details: reason === null ? [] : [reason],
    };
  }

  if (pending.toolName === "apply_learned_rules") {
    const ids = Array.isArray(input?.expectedTransactionIds)
      ? input.expectedTransactionIds
      : [];
    return {
      title: `Aplicar as regras em ${ids.length} ${
        ids.length === 1 ? "lançamento" : "lançamentos"
      }?`,
      consequence:
        "As categorias serão atualizadas e cada mudança ficará registrada no histórico.",
      approveLabel: "Aplicar regras",
      denyLabel: "Não alterar",
      details: [],
    };
  }

  return {
    title: pending.prompt ?? "Confirmar esta alteração?",
    consequence: "A alteração só acontece depois da sua confirmação.",
    approveLabel: "Confirmar alteração",
    denyLabel: "Não alterar",
    details: [],
  };
}

/**
 * A decisão, dentro da conversa.
 *
 * Existia só no painel lateral, e isso escondia o momento mais importante do
 * fluxo. O botão de lá servia a dois propósitos com a mesma aparência: antes
 * do gate ele PEDIA o registro, depois ele APROVAVA — e nada na tela dizia que
 * o significado tinha mudado. Quem clicava via "processando", depois via o
 * mesmo botão azul, e concluía que não tinha acontecido nada.
 *
 * Aqui a pergunta aparece onde a pessoa está lendo, com o número que ela está
 * decidindo, e some quando respondida. O painel continua existindo para
 * conferir os totais; a decisão é daqui.
 */
export function DecisionCard({
  pending,
  proposal,
  disabled,
  onAnswer,
}: {
  pending: PendingRequest;
  proposal: BatchProposal | null;
  disabled: boolean;
  onAnswer: (optionId: string) => void;
}) {
  const copy = decisionCopy(pending, proposal);

  return (
    <Confirmation
      approval={{ id: pending.requestId }}
      state="approval-requested"
      className="clara-card border-0 p-7"
    >
      <ConfirmationTitle className="clara-display-xs block text-foreground">
        {copy.title}
      </ConfirmationTitle>

      {copy.details.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1 text-sm text-foreground">
          {copy.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <p className="clara-small mt-2">{copy.consequence}</p>

      <ConfirmationActions className="mt-5 justify-start self-start">
        <ConfirmationAction
          onClick={() => onAnswer("approve")}
          disabled={disabled}
          className="clara-pill clara-pill-primary h-10 px-5"
        >
          {copy.approveLabel}
        </ConfirmationAction>
        <ConfirmationAction
          onClick={() => onAnswer("deny")}
          disabled={disabled}
          variant="ghost"
          className="clara-link h-10 px-2"
        >
          {copy.denyLabel}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}
