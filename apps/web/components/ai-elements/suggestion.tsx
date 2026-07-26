"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { useCallback } from "react";

/**
 * Faixa de pílulas — follow-ups e opções de pergunta.
 *
 * As pílulas QUEBRAM em linhas; não rolam na horizontal. O componente original
 * do AI Elements é uma faixa `w-max` dentro de um ScrollArea, e na coluna de
 * leitura (720px) dois ou três follow-ups em português já passam da largura: a
 * faixa era simplesmente CORTADA, sem rolagem visível. O ScrollArea do shadcn
 * renderiza os filhos dentro do viewport, então a barra horizontal que o AI
 * Elements passava como filho ia para DENTRO do conteúdo — o `overflow-x` do
 * viewport continuava escondido e não havia o que arrastar.
 *
 * Quebrar em linhas cabe na tela em qualquer largura, e a altura extra rola
 * junto com a conversa, que já é uma área com rolagem.
 */
export type SuggestionsProps = ComponentProps<"div">;

export const Suggestions = ({ className, children, ...props }: SuggestionsProps) => (
  <div className={cn("flex w-full flex-wrap items-center gap-2", className)} {...props}>
    {children}
  </div>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}: SuggestionProps) => {
  const handleClick = useCallback(() => {
    onClick?.(suggestion);
  }, [onClick, suggestion]);

  return (
    <Button
      // `max-w-full` + texto que quebra: um rótulo longo demais (opção vinda do
      // modelo) cresce em altura dentro da pílula em vez de vazar da coluna.
      className={cn(
        "h-auto min-h-8 max-w-full cursor-pointer whitespace-normal rounded-full px-4 py-1.5 text-left",
        className,
      )}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  );
};
