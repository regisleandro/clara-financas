"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Reage a uma media query no cliente.
 *
 * Serve para escolher a moldura do artefato: coluna fixa no desktop, modal no
 * celular. É o único jeito honesto de decidir isso — Tailwind esconde por CSS,
 * mas o Radix Dialog trava a rolagem de fundo mesmo quando o conteúdo está
 * escondido, então a modal precisa nem MONTAR como aberta acima de `lg`.
 *
 * A versão anterior era `useState(false)` + `useEffect`: o primeiro render
 * dizia "celular" para todo mundo e a correção só chegava DEPOIS do paint,
 * porque é quando `useEffect` roda. No desktop isso significava um frame com a
 * coluna de Detalhes fechada seguido de outro com ela aberta — o salto que
 * aparecia em toda conversa retomada que já tinha painel.
 *
 * `useSyncExternalStore` lê `matches` de forma síncrona no próprio render, então
 * o valor certo já está no primeiro frame. `getServerSnapshot` devolve `false`
 * porque no servidor não há viewport para consultar, e o padrão do produto é
 * desktop-first: melhor a modal nascer fechada e abrir do que o contrário.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
