import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { Toaster } from "@clara-financas/ui/components/sonner";

import "./globals.css";

/**
 * Fallback das SF Pro.
 *
 * Em Apple as SF Pro já estão no sistema e vencem na cascata; fora dele, Inter
 * e Inter Tight assumem. Foram escolhidas por compartilharem a métrica
 * apertada das SF — trocar a fonte não deve reescrever o layout.
 *
 * `display: swap` evita texto invisível enquanto a fonte carrega: numa tela
 * cujo herói é tipografia de 96px, um flash de nada é pior que um flash de
 * fallback.
 */
const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-clara-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-clara-text",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clara — Assistente Financeiro",
  description:
    "Envie a fatura, confira o que a Clara extraiu, aprove. Cada número rastreável até a origem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${interTight.variable} ${inter.variable}`}>
      <body className="min-h-svh antialiased">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
