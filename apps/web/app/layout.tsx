import type { Metadata, Viewport } from "next";
import { Toaster } from "@clara-financas/ui/components/sonner";

import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Clara — Assistente Financeiro",
  description:
    "Envie a fatura, confira o que a Clara extraiu, aprove. Cada número rastreável até a origem.",
};

/**
 * `viewport-fit: cover` é o que faz `env(safe-area-inset-*)` valer alguma
 * coisa: sem ele os insets são sempre zero, e o `padding-bottom` do composer
 * não protege nada. Não havia nenhum `export const viewport` no projeto, e por
 * isso o campo de escrever ficava dentro da área do home indicator no iPhone.
 *
 * `interactive-widget` declara o que o teclado virtual deve empurrar. O padrão
 * do Chrome Android (`resizes-visual`) NÃO reduz o viewport de layout — com o
 * composer `fixed` isso o deixava atrás do teclado. Ele agora está em fluxo, e
 * `resizes-content` faz o shell encolher junto, mantendo o campo visível.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
