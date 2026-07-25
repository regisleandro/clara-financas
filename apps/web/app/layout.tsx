import type { Metadata } from "next";
import { Toaster } from "@clara-financas/ui/components/sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Clara — Assistente Financeiro",
  description:
    "Envie a fatura, confira o que a Clara extraiu, aprove. Cada número rastreável até a origem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-svh antialiased">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
