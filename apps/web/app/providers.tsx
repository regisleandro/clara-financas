"use client";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

/**
 * Só o tema do Astryx por enquanto — sem `LinkProvider`, porque nada que já
 * existe usa os componentes do Astryx que navegam (Breadcrumbs, NavItem);
 * quando a reconstrução chegar lá, ele entra aqui.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <Theme theme={neutralTheme}>{children}</Theme>;
}
