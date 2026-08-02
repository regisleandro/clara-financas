"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_ISSUERS } from "@/lib/overview-model";

type Option = { value: string; label: string };

export function OverviewFilters({
  months,
  issuers,
  selectedMonth,
  selectedIssuer,
}: {
  months: Option[];
  issuers: Option[];
  selectedMonth: string | null;
  selectedIssuer: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function update(next: { month?: string; issuer?: string }) {
    const month = next.month ?? selectedMonth;
    const issuer = next.issuer ?? selectedIssuer;
    const params = new URLSearchParams();

    if (month !== null) params.set("mes", month);
    if (issuer !== ALL_ISSUERS) params.set("origem", issuer);

    startTransition(() => {
      const destination = pathname.startsWith("/comparacao") ? "/comparacao" : "/inicio";
      router.replace(`${destination}${params.size > 0 ? `?${params.toString()}` : ""}`, {
        scroll: false,
      });
    });
  }

  return (
    <section
      aria-label="Filtros dos gastos"
      className="mb-5 flex flex-col gap-4 rounded-[var(--clara-radius-card)] border border-[var(--clara-border)] bg-[var(--clara-white)] px-5 py-4 sm:flex-row sm:items-end"
    >
      <div className="min-w-0 flex-1">
        <label id="overview-month-label" className="clara-eyebrow mb-2 block">
          Período
        </label>
        <Select
          value={selectedMonth ?? undefined}
          onValueChange={(month) => update({ month })}
          disabled={pending || months.length === 0}
        >
          <SelectTrigger
            aria-labelledby="overview-month-label"
            className="h-11 w-full rounded-[var(--clara-radius-pill)] border-[var(--clara-ash)] bg-[var(--clara-cloud)] px-4 shadow-none"
          >
            <SelectValue placeholder="Sem períodos disponíveis" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              {months.map((month) => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 flex-1">
        <label id="overview-origin-label" className="clara-eyebrow mb-2 block">
          Origem dos gastos
        </label>
        <Select
          value={selectedIssuer}
          onValueChange={(issuer) => update({ issuer })}
          disabled={pending || issuers.length === 0}
        >
          <SelectTrigger
            aria-labelledby="overview-origin-label"
            className="h-11 w-full rounded-[var(--clara-radius-pill)] border-[var(--clara-ash)] bg-[var(--clara-cloud)] px-4 shadow-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              <SelectItem value={ALL_ISSUERS}>Todas as origens</SelectItem>
              {issuers.map((issuer) => (
                <SelectItem key={issuer.value} value={issuer.value}>
                  {issuer.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <p className="sr-only" aria-live="polite">
        {pending ? "Atualizando visão geral." : "Visão geral atualizada."}
      </p>
    </section>
  );
}
