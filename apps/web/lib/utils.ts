import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Utilitário padrão do shadcn — exigido pelos componentes do AI Elements. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
