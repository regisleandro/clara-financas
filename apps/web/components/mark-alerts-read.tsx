"use client";

import { useEffect, useRef } from "react";

import { markAlertsRead } from "@/app/(app)/agenda/actions";

/**
 * Ver é ler: montou a seção de avisos, os avisos exibidos são marcados.
 *
 * É um componente (e não uma escrita durante o render do server component)
 * porque escrever no banco enquanto se renderiza é efeito colateral de GET —
 * um prefetch do Next marcaria como lido um aviso que ninguém viu. Aqui a
 * marcação só dispara quando o componente montou num navegador de verdade.
 *
 * Não renderiza nada e não trata erro com alarde: falhar em marcar como lido
 * só significa que o aviso aparece de novo — o custo certo para esse risco.
 */
export function MarkAlertsRead({ ids }: { ids: string[] }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || ids.length === 0) return;
    sent.current = true;
    void markAlertsRead(ids);
  }, [ids]);

  return null;
}
