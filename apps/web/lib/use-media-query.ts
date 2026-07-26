"use client";

import { useEffect, useState } from "react";

/**
 * Reage a uma media query no cliente.
 *
 * Serve para escolher a moldura do artefato: coluna fixa no desktop, modal no
 * celular. É o único jeito honesto de decidir isso — Tailwind esconde por CSS,
 * mas o Radix Dialog trava a rolagem de fundo mesmo quando o conteúdo está
 * escondido, então a modal precisa nem MONTAR como aberta acima de `lg`.
 *
 * Começa em `false` no servidor e no primeiro paint (não há `window`), e
 * corrige no efeito. O padrão do produto é desktop-first, então `false` até
 * saber evita um flash da modal em telas grandes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
