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
  blocked?: boolean;
};

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

function decisionCopy(
  pending: PendingRequest,
  proposal: BatchProposal | null,
  actionProposal: UnknownRecord | null,
): DecisionCopy {
  const input = asRecord(pending.toolInput);

  if (pending.toolName === "commit_batch") {
    const isStatement =
      proposal?.documentKind === "bank_statement" ||
      asString(actionProposal?.documentKind) === "bank_statement";
    const count = proposal?.transactionCount ?? asNumber(actionProposal?.transactionCount);
    const total = isStatement
      ? (proposal?.statementBalance?.closingBalance ?? asNumber(actionProposal?.closingBalanceCents))
      : (proposal?.checksum.extractedTotal ?? asNumber(actionProposal?.extractedTotalCents));
    const checksumResult =
      proposal?.checksum.result ?? asString(actionProposal?.checksumResult);
    const statementResult = asString(asRecord(actionProposal?.statementBalance)?.result);
    const matched = isStatement
      ? proposal?.statementBalance?.result === "match" || statementResult === "match"
      : checksumResult === "match";
    const invoiceLabel = proposal?.invoiceLabel ?? asString(actionProposal?.invoiceLabel);
    return {
      title:
        count == null
          ? `Registrar este ${isStatement ? "extrato" : "documento"} no razão?`
          : `Registrar ${count} lançamentos no razão?`,
      consequence: "Depois do registro, valor, data e origem não mudam mais.",
      approveLabel: isStatement ? "Registrar extrato" : "Registrar fatura",
      denyLabel: "Manter como rascunho",
      details: [
        invoiceLabel === null || invoiceLabel === undefined
          ? null
          : `${isStatement ? "Extrato" : "Fatura"}: ${invoiceLabel}`,
        ...(total == null
          ? []
          : [
              formatCents(total),
              matched
                ? `O ${isStatement ? "saldo" : "total"} confere com o documento`
                : `A conferência não fecha com o documento`,
            ]),
      ].filter((value): value is string => value !== null),
      blocked: proposal === null && actionProposal === null,
    };
  }

  if (pending.toolName === "recategorize_transactions") {
    const changes = Array.isArray(input?.changes) ? input.changes : [];
    const proposalIds = Array.isArray(input?.proposalIds) ? input.proposalIds : [];
    const count = changes.length > 0 ? changes.length : proposalIds.length;
    const labels = [
      ...new Set(
        changes
          .map((change) => asString(asRecord(change)?.categoryLabel))
          .filter((label): label is string => label !== null),
      ),
    ];
    return {
      title:
        changes.length > 0
          ? `Alterar a categoria de ${count} ${count === 1 ? "lançamento" : "lançamentos"}?`
          : `Aplicar ${count} ${count === 1 ? "proposta de categoria" : "propostas de categoria"}?`,
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

  if (pending.toolName === "set_proactivity") {
    const enabled = input?.enabled === true;
    return {
      title: enabled ? "Religar os avisos automáticos?" : "Desligar os avisos automáticos?",
      consequence: enabled
        ? "A Clara volta a avisar sobre vencimentos por conta própria."
        : "A Clara para de avisar qualquer coisa por conta própria. Os compromissos continuam guardados e visíveis na agenda.",
      approveLabel: enabled ? "Religar avisos" : "Desligar avisos",
      denyLabel: "Deixar como está",
      details: [],
    };
  }

  if (pending.toolName === "mark_reviewed") {
    const ids = Array.isArray(input?.transactionIds) ? input.transactionIds : [];
    return {
      title: `Marcar ${ids.length} lançamentos como revisados?`,
      consequence:
        "Eles saem da fila de revisão de uma vez. Só confirme se você olhou mesmo — a fila existe para o que ninguém conferiu.",
      approveLabel: "Marcar como revisados",
      denyLabel: "Manter na fila",
      details: [],
    };
  }

  if (pending.toolName === "deactivate_commitment") {
    const title = asString(input?.title) ?? "este lembrete";
    return {
      title: `Desativar o lembrete “${title}”?`,
      consequence:
        "A Clara para de avisar sobre este vencimento. O histórico fica guardado, e dá para reativar depois.",
      approveLabel: "Desativar lembrete",
      denyLabel: "Continuar avisando",
      details: [],
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

  if (pending.toolName === "apply_invoice_resolution") {
    const adjustment = asNumber(actionProposal?.adjustmentCents);
    const difference = asNumber(actionProposal?.differenceBeforeCents);
    const invoiceLabel = asString(actionProposal?.invoiceLabel);
    const target = asString(actionProposal?.targetDescription);
    const reason = asString(actionProposal?.reason);
    return {
      title:
        adjustment === null
          ? "Aplicar o ajuste calculado nesta fatura?"
          : `Registrar um ajuste de ${formatCents(adjustment)}?`,
      consequence:
        "A diferença será recalculada no momento do registro. Se a fatura mudou, nada será aplicado.",
      approveLabel: "Aplicar ajuste e reconferir",
      denyLabel: "Manter divergência aberta",
      details: [
        invoiceLabel === null ? null : `Fatura: ${invoiceLabel}`,
        difference === null ? null : `Diferença atual: ${formatCents(difference)}`,
        target === null ? "Escopo: ajuste da fatura" : `Relacionado a: ${target}`,
        reason,
        "Resultado esperado: diferença zerada",
      ].filter((value): value is string => value !== null),
      blocked: actionProposal === null,
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
    title: "Esta ação precisa de uma apresentação própria",
    consequence:
      "A Clara não mostrou objeto, alcance e consequência suficientes para uma decisão segura.",
    approveLabel: "Ação indisponível",
    denyLabel: "Não alterar",
    details: [],
    blocked: true,
  };
}

/**
 * A decisão, dentro da conversa.
 *
 * Existia só no painel lateral, e isso escondia o momento mais importante do
 * fluxo. O botão de lá servia a dois propósitos com a mesma aparência: antes
 * do gate ele PEDIA o registro, depois ele APROVAVA — e nada na tela dizia que
 * o significado tinha mudado. Quem clicava via "processando", depois via o
 * mesmo botão, e concluía que não tinha acontecido nada.
 *
 * Aqui a pergunta aparece onde a pessoa está lendo, com o número que ela está
 * decidindo, e some quando respondida. O painel continua existindo para
 * conferir os totais; a decisão é daqui.
 */
export function DecisionCard({
  pending,
  proposal,
  actionProposal,
  disabled,
  onAnswer,
}: {
  pending: PendingRequest;
  proposal: BatchProposal | null;
  actionProposal: UnknownRecord | null;
  disabled: boolean;
  onAnswer: (optionId: string) => void;
}) {
  const copy = decisionCopy(pending, proposal, actionProposal);

  return (
    <Confirmation
      approval={{ id: pending.requestId }}
      state="approval-requested"
      className="clara-card min-w-0 border-0 p-5 sm:p-7"
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

      <ConfirmationActions className="mt-5 w-full flex-col items-stretch justify-start self-start sm:w-auto sm:flex-row sm:items-center">
        <ConfirmationAction
          onClick={() => onAnswer("approve")}
          disabled={disabled || copy.blocked === true}
          className="clara-pill clara-pill-primary h-10 w-full justify-center px-5 sm:w-auto"
        >
          {copy.approveLabel}
        </ConfirmationAction>
        <ConfirmationAction
          onClick={() => onAnswer("deny")}
          disabled={disabled}
          variant="ghost"
          className="clara-link h-10 w-full justify-center px-2 sm:w-auto"
        >
          {copy.denyLabel}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}
