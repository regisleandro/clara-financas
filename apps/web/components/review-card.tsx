"use client";

import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";

/**
 * Cartão de Conferência — o artefato do design, sobre o `Artifact` e o
 * `Confirmation` do AI Elements.
 *
 * O `Confirmation` é o par natural do `approval` do eve: ele já modela os
 * estados de pedido/resposta e some sozinho quando não há aprovação pendente.
 * Traduzimos o `inputRequest` do eve para a forma que ele espera —
 * `{ id }` mais um `state` — em vez de reimplementar a máquina de estados.
 *
 * O conteúdo é de domínio: totais, selo de conferência e onde olhar primeiro.
 * A pergunta que este cartão responde é "posso confiar nisto?", e quem
 * responde é o checksum, não a confiança no modelo.
 */

export type ChecksumReport = {
  result: "match" | "mismatch" | "no_declared_total";
  likelyCause?: "rounding" | "item" | "unknown";
  extractedTotal: number;
  declaredTotal: number | null;
  difference: number | null;
  suspectItems: Array<{
    transactionId: string;
    reason: string;
    confidence: "alta" | "media" | "baixa";
    amount: number;
    page: number | null;
  }>;
};

export type ReviewCardData = {
  batchId: string;
  transactionCount: number;
  issuer?: string | null;
  checksum: ChecksumReport;
};

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

const CAUSE_NOTE: Record<string, string> = {
  rounding:
    "Diferença compatível com arredondamento — o emissor calcula sobre o total e arredonda uma vez; nós somamos parcelas já arredondadas. Não há um item culpado.",
  item: "Um lançamento tem exatamente o valor da diferença: provável leitura duplicada ou faltante.",
  unknown: "Vale conferir os itens abaixo antes de aprovar.",
};

export function ReviewCard({
  data,
  disabled,
  answered,
  onApprove,
  onReject,
}: {
  data: ReviewCardData;
  disabled: boolean;
  answered: boolean | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { checksum } = data;

  return (
    <Artifact className="w-full">
      <ArtifactHeader>
        <div>
          <ArtifactTitle>
            {data.transactionCount} transações propostas
          </ArtifactTitle>
          <ArtifactDescription>
            {data.issuer ?? "Documento"} · nada entra no razão sem sua aprovação
          </ArtifactDescription>
        </div>
        <ArtifactActions>
          <ArtifactAction
            label={
              checksum.result === "match"
                ? "Total confere"
                : checksum.result === "mismatch"
                  ? "Divergência"
                  : "Sem total declarado"
            }
            tooltip="Resultado da conferência automática"
          />
        </ArtifactActions>
      </ArtifactHeader>

      <ArtifactContent className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="clara-small">Total da fatura</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">
              {checksum.declaredTotal === null ? "não declarado" : brl(checksum.declaredTotal)}
            </dd>
          </div>
          <div>
            <dt className="clara-small">Total extraído</dt>
            <dd className="mt-1 text-lg font-medium tabular-nums">
              {brl(checksum.extractedTotal)}
            </dd>
          </div>
        </dl>

        {checksum.result === "mismatch" && checksum.difference !== null ? (
          <div className="rounded-xl bg-[var(--clara-amber-bg)] px-4 py-3 text-sm text-[var(--clara-amber)]">
            <p>
              Diferença de{" "}
              <strong className="tabular-nums">{brl(Math.abs(checksum.difference))}</strong>{" "}
              {checksum.difference > 0 ? "a mais" : "a menos"} do que a fatura declara.
            </p>
            {checksum.likelyCause !== undefined ? (
              <p className="mt-1.5">{CAUSE_NOTE[checksum.likelyCause]}</p>
            ) : null}
          </div>
        ) : null}

        {checksum.result === "no_declared_total" ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            Este documento não declara um total, então não há como conferir a soma
            automaticamente. Vale olhar os itens antes de aprovar.
          </p>
        ) : null}

        {checksum.suspectItems.length > 0 ? (
          <div>
            <p className="clara-eyebrow mb-3">Onde olhar primeiro</p>
            <ul className="space-y-2">
              {checksum.suspectItems.slice(0, 5).map((item) => (
                <li
                  key={item.transactionId}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 text-sm last:border-0"
                >
                  <span className="text-muted-foreground">
                    {item.reason}
                    {item.page !== null ? ` · página ${item.page}` : ""}
                  </span>
                  <span className="tabular-nums">{brl(item.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* O gate. `Confirmation` some sozinho quando não há pedido pendente. */}
        <Confirmation
          approval={
            answered === null ? { id: data.batchId } : { id: data.batchId, approved: answered }
          }
          state={answered === null ? "approval-requested" : "approval-responded"}
        >
          <ConfirmationTitle>Registrar estas transações no razão?</ConfirmationTitle>
          <ConfirmationRequest>
            Depois de registradas, valor, data e origem não mudam mais — correção vira linha de
            ajuste.
          </ConfirmationRequest>
          <ConfirmationActions>
            <ConfirmationAction disabled={disabled} onClick={onApprove}>
              Aprovar e registrar
            </ConfirmationAction>
            <ConfirmationAction variant="outline" disabled={disabled} onClick={onReject}>
              Rejeitar lote
            </ConfirmationAction>
          </ConfirmationActions>
        </Confirmation>

        <p className="clara-small">
          Para corrigir um item, diga o que está errado na conversa — a Clara ajusta e reconfere
          antes de registrar.
        </p>
      </ArtifactContent>
    </Artifact>
  );
}
