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
  const count = proposal?.transactionCount;
  const total = proposal?.checksum.extractedTotal;
  const matched = proposal?.checksum.result === "match";

  return (
    <Confirmation
      approval={{ id: pending.requestId }}
      state="approval-requested"
      className="clara-card border-0 p-7"
    >
      <ConfirmationTitle className="clara-display-xs block text-foreground">
        {count === undefined
          ? "Registrar esta fatura no razão?"
          : `Registrar ${count} lançamentos no razão?`}
      </ConfirmationTitle>

      <p className="clara-small mt-1.5">
        {total === undefined
          ? "Depois de registrado, valor, data e origem não mudam mais."
          : `${formatCents(total)}${matched ? " · total confere com a fatura" : " · a soma não bateu com a fatura"}. ` +
            "Depois de registrado, valor, data e origem não mudam mais."}
      </p>

      <ConfirmationActions className="mt-5 justify-start self-start">
        <ConfirmationAction
          onClick={() => onAnswer("approve")}
          disabled={disabled}
          className="clara-pill clara-pill-primary h-10 px-5"
        >
          Registrar fatura
        </ConfirmationAction>
        <ConfirmationAction
          onClick={() => onAnswer("deny")}
          disabled={disabled}
          variant="ghost"
          className="clara-link h-10 px-2"
        >
          Rejeitar lote
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}
