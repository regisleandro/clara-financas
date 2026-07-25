import type { ArtifactData, ArtifactRow } from "@/components/artifact-panel";

/**
 * Monta o cartão de conferência de um lote.
 *
 * Sobrou como única derivação no frontend depois que a Clara passou a escolher
 * os painéis por `present_view`. A razão de continuar aqui: este cartão carrega
 * os botões do gate, e eles dependem de estado do cliente — a Clara não teria
 * como mandar uma função de callback dentro de um payload.
 */

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export type BatchProposal = {
  batchId: string;
  transactionCount: number;
  issuer?: string | null;
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
  const { checksum } = proposal;

  const rows: ArtifactRow[] = [
    {
      label: "Total declarado na fatura",
      value: checksum.declaredTotal === null ? "não declarado" : brl(checksum.declaredTotal),
    },
    { label: "Total das transações lidas", value: brl(checksum.extractedTotal) },
  ];

  if (checksum.difference !== null && checksum.difference !== 0) {
    rows.push({
      label: "Diferença",
      note: checksum.likelyCause ? CAUSE_NOTE[checksum.likelyCause] : undefined,
      value: brl(checksum.difference),
      emphasis: true,
    });
  }

  // Onde a diferença está, quando o documento declara subtotais. É o que
  // separa "a conta não bate" de "a conta não bate no IOF".
  if (checksum.localizedIn !== undefined) {
    const { area, declared, extracted } = checksum.localizedIn;
    rows.push({
      label: area === "fees" ? "Encargos e IOF" : "Compras",
      note: `a fatura declara ${brl(declared)}; as linhas somam ${brl(extracted)}`,
      value: brl(extracted - declared),
      emphasis: true,
    });
  }

  for (const item of checksum.suspectItems.slice(0, 4)) {
    rows.push({
      label: item.reason,
      note: item.page === null ? undefined : `página ${item.page}`,
      value: brl(item.amount),
    });
  }

  const status =
    checksum.result === "match"
      ? "Total confere"
      : checksum.result === "mismatch"
        ? "Diferença encontrada"
        : "Sem total declarado";

  return {
    title: proposal.issuer ?? "Documento",
    metricLabel: checksum.result === "match" ? "Total conferido" : "Total lido",
    metric: brl(checksum.extractedTotal),
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
    secondaryAction: { label: "Rejeitar lote", onClick: actions.onReject },
    footnote: actions.pendingGate
      ? "A Clara está aguardando sua decisão."
      : "Ao registrar, a Clara pedirá sua confirmação antes de gravar no razão.",
  };
}
