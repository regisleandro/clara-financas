"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { HStack, VStack } from "@astryxdesign/core/Stack";

import type { PendingApproval } from "@/hooks/use-ag-ui-chat";

/**
 * O cartão de decisão do gate financeiro (FR-010, FR-011, FR-025).
 *
 * O que vai ser registrado ou descartado já foi descrito em português pela
 * Clara na mensagem anterior — este cartão não repete números nem ids
 * internos (`proposal_id` nunca aparece aqui); ele só torna a decisão
 * CLICÁVEL. `tool_call_name` escolhe o texto, nunca aparece cru na tela.
 */
export function ApprovalCard({
  pending,
  disabled,
  onAnswer,
}: {
  pending: PendingApproval;
  disabled: boolean;
  onAnswer: (accepted: boolean) => void;
}) {
  const isCommit = pending.toolCallName === "commit_batch";

  return (
    <Card variant="blue" padding={5} elevation="low">
      <VStack gap={3} align="start">
        <Text type="body" weight="medium">
          {isCommit
            ? "Registrar esta fatura no razão?"
            : "Descartar esta fatura sem registrar nada?"}
        </Text>
        <Text type="supporting" color="secondary">
          {isCommit
            ? "Depois de registrada, os lançamentos passam a contar como gasto confirmado."
            : "Nada do que foi conferido entra no razão."}
        </Text>
        <HStack gap={2}>
          <Button
            label={isCommit ? "Registrar" : "Descartar"}
            variant="primary"
            size="sm"
            isDisabled={disabled}
            onClick={() => onAnswer(true)}
          />
          <Button
            label="Cancelar"
            variant="ghost"
            size="sm"
            isDisabled={disabled}
            onClick={() => onAnswer(false)}
          />
        </HStack>
      </VStack>
    </Card>
  );
}
