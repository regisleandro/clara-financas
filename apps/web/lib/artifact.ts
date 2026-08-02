import type { ArtifactData, ArtifactRow } from "@/components/artifact-panel";
import { formatCents, type StatementBalanceReport } from "@clara-financas/ledger";

/**
 * Monta o cartão de conferência de um lote.
 *
 * Sobrou como única derivação no frontend depois que a Clara passou a escolher
 * os painéis por `present_view`. A razão de continuar aqui: este cartão carrega
 * os botões do gate, e eles dependem de estado do cliente — a Clara não teria
 * como mandar uma função de callback dentro de um payload.
 */

export type BatchProposal = {
  batchId: string;
  documentKind?: "unknown" | "credit_card_invoice" | "bank_statement" | "invoice_nfe";
  transactionCount: number;
  issuer?: string | null;
  invoiceLabel?: string;
  periodEnd?: string | null;
  dueDate?: string | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  statementBalance?: StatementBalanceReport;
  checksum: {
    result: "match" | "mismatch" | "no_declared_total";
    likelyCause?: "rounding" | "item" | "unknown";
    localizedIn?: { area: "fees" | "purchases"; declared: number; extracted: number };
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
};

const CAUSE_NOTE: Record<string, string> = {
  rounding:
    "Compatível com arredondamento: o emissor calcula sobre o total e arredonda uma vez, nós somamos parcelas já arredondadas. Não há item culpado.",
  item: "Um lançamento tem exatamente o valor da diferença — provável leitura duplicada ou faltante.",
  unknown: "Vale conferir os itens antes de aprovar.",
};

/**
 * A conferência de uma fatura JÁ DECIDIDA, sem botões.
 *
 * Mesmo conteúdo, sem ação: registrar de novo o que já entrou, ou descartar o
 * que já foi descartado, são ofertas falsas. O que fica é o registro do que a
 * pessoa conferiu e do que ela decidiu — que é exatamente o que ela procura ao
 * rolar a conversa para cima.
 */
export function batchHistoryArtifact(
  proposal: BatchProposal,
  outcome: "confirmed" | "rejected",
): ArtifactData {
  const base = batchArtifact(proposal, {
    onApprove: () => {},
    onReject: () => {},
    disabled: true,
    pendingGate: false,
  });

  return {
    ...base,
    primaryAction: undefined,
    secondaryAction: undefined,
    footnote:
      outcome === "confirmed"
        ? "Esta fatura já está registrada no razão."
        : "Esta fatura foi descartada; nada dela entrou no razão.",
  };
}

/** Artefato da conferência de um lote. */
export function batchArtifact(
  proposal: BatchProposal,
  actions: {
    onApprove: () => void;
    onReject: () => void;
    disabled: boolean;
    /** Há aprovação pendente? Muda o que o clique significa, e o rodapé. */
    pendingGate: boolean;
  },
): ArtifactData {
  if (proposal.documentKind === "bank_statement" && proposal.statementBalance !== undefined) {
    return statementArtifact(proposal, actions);
  }

  const { checksum } = proposal;

  const rows: ArtifactRow[] = [
    {
      label: "Total declarado na fatura",
      value:
        checksum.declaredTotal === null
          ? "não declarado"
          : formatCents(checksum.declaredTotal),
    },
    {
      label: "Total das transações lidas",
      value: formatCents(checksum.extractedTotal),
    },
  ];

  if (checksum.difference !== null && checksum.difference !== 0) {
    rows.push({
      label: "Diferença",
      note: checksum.likelyCause ? CAUSE_NOTE[checksum.likelyCause] : undefined,
      value: formatCents(checksum.difference),
      emphasis: true,
    });
  }

  // Onde a diferença está, quando o documento declara subtotais. É o que
  // separa "a conta não bate" de "a conta não bate no IOF".
  if (checksum.localizedIn !== undefined) {
    const { area, declared, extracted } = checksum.localizedIn;
    rows.push({
      label: area === "fees" ? "Encargos e IOF" : "Compras",
      note: `a fatura declara ${formatCents(declared)}; as linhas somam ${formatCents(extracted)}`,
      value: formatCents(extracted - declared),
      emphasis: true,
    });
  }

  for (const item of checksum.suspectItems.slice(0, 4)) {
    rows.push({
      label: item.reason,
      note: item.page === null ? undefined : `página ${item.page}`,
      value: formatCents(item.amount),
    });
  }

  const status =
    checksum.result === "match"
      ? "Total confere"
      : checksum.result === "mismatch"
        ? "Diferença encontrada"
        : "Sem total declarado";

  return {
    title: proposal.invoiceLabel ?? proposal.issuer ?? "Fatura",
    metricLabel: checksum.result === "match" ? "Total conferido" : "Total lido",
    metric: formatCents(checksum.extractedTotal),
    note: `${proposal.transactionCount} transações lidas · ${status.toLowerCase()}`,
    listTitle: "Conferência",
    rows,
    primaryAction: {
      // O rótulo muda com o significado. O mesmo botão pedia o registro antes
      // do gate e aprovava depois, com a mesma aparência — quem clicava não
      // tinha como saber que precisava clicar de novo, e o fluxo travava ali.
      label: actions.pendingGate ? "Confirmar registro" : "Registrar fatura",
      onClick: actions.onApprove,
      disabled: actions.disabled,
    },
    secondaryAction: {
      label: actions.pendingGate ? "Manter como rascunho" : "Rejeitar lote",
      onClick: actions.onReject,
      disabled: actions.disabled,
    },
    footnote: actions.pendingGate
      ? "A Clara está aguardando sua decisão."
      : "Ao registrar, a Clara pedirá sua confirmação antes de gravar no razão.",
  };
}

function statementArtifact(
  proposal: BatchProposal,
  actions: {
    onApprove: () => void;
    onReject: () => void;
    disabled: boolean;
    pendingGate: boolean;
  },
): ArtifactData {
  const report = proposal.statementBalance!;
  const rows: ArtifactRow[] = [
    {
      label: "Saldo inicial",
      value: report.openingBalance === null ? "não informado" : formatCents(report.openingBalance),
    },
    { label: "Movimentação líquida", value: formatCents(report.netMovement) },
    {
      label: "Saldo final no extrato",
      value: report.closingBalance === null ? "não informado" : formatCents(report.closingBalance),
    },
    {
      label: "Saldo final calculado",
      value:
        report.expectedClosingBalance === null
          ? "não calculado"
          : formatCents(report.expectedClosingBalance),
    },
  ];
  if (report.difference !== null && report.difference !== 0) {
    rows.push({
      label: "Diferença",
      value: formatCents(report.difference),
      emphasis: true,
      note: "Saldo esperado menos saldo informado no extrato.",
    });
  }

  const status =
    report.result === "match"
      ? "Saldo confere"
      : report.result === "mismatch"
        ? "Diferença encontrada"
        : "Saldos insuficientes";
  const title = proposal.invoiceLabel ?? (proposal.issuer ? `${proposal.issuer} · Extrato` : "Extrato bancário");
  return {
    title,
    metricLabel: report.result === "match" ? "Saldo final conferido" : "Saldo final",
    metric:
      report.closingBalance === null
        ? "não informado"
        : formatCents(report.closingBalance),
    note: `${proposal.transactionCount} movimentações lidas · ${status.toLowerCase()}`,
    listTitle: "Conferência do extrato",
    rows,
    primaryAction: {
      label: actions.pendingGate ? "Confirmar registro" : "Registrar extrato",
      onClick: actions.onApprove,
      disabled: actions.disabled,
    },
    secondaryAction: {
      label: actions.pendingGate ? "Manter como rascunho" : "Rejeitar lote",
      onClick: actions.onReject,
      disabled: actions.disabled,
    },
    footnote: actions.pendingGate
      ? "A Clara está aguardando sua decisão."
      : "Ao registrar, a Clara pedirá sua confirmação antes de gravar no razão.",
  };
}
