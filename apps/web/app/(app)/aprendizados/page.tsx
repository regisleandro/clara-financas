import { redirect } from "next/navigation";

import { loadLearnings, loadReclassifications } from "@/lib/ledger";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  CategorizationRule: "Regra aprendida",
  Merchant: "Comerciante",
  Commitment: "Compromisso",
  IssuerPattern: "Padrão de emissor",
};

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

export default async function AprendizadosPage() {
  const context = await getTenantContext();
  if (!context) redirect("/entrar");

  const [learnings, history] = await Promise.all([
    loadLearnings(context.tenantId),
    loadReclassifications(context.tenantId),
  ]);

  return (
    <div className="clara-shell pb-40 pt-12">
      <header className="py-16 sm:py-24">
        <p className="clara-eyebrow mb-5">Memória transparente</p>
        <h1 className="clara-hero">Aprendizados.</h1>
        <p className="clara-lead mt-3 max-w-[40ch]">
          O que a Clara sabe sobre você — legível, versionado e reversível.
        </p>
      </header>

      {learnings.length === 0 ? (
        <div className="clara-card p-10 text-center">
          <h2 className="clara-display-md">A Clara ainda não aprendeu nada sobre você.</h2>
          <p className="mx-auto mt-3 max-w-md text-[var(--clara-graphite)]">
            Quando você corrigir uma categoria na conversa, ela vai propor guardar a regra. Só
            entra aqui o que você aprovar.
          </p>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2">
          {learnings.map((concept) => (
            <li key={concept.conceptId} className="clara-card flex flex-col p-7">
              <div className="flex items-start justify-between gap-4">
                <span className="clara-eyebrow">
                  {TYPE_LABEL[concept.type] ?? concept.type}
                </span>
                <span className="clara-chip">
                  {concept.revisionCount === 1
                    ? "1 versão"
                    : `${concept.revisionCount} versões`}
                </span>
              </div>

              <h3 className="clara-display-md mt-6">{concept.title}</h3>
              {concept.description !== null ? (
                <p className="mb-7 mt-3 text-[var(--clara-graphite)] text-pretty">
                  {concept.description}
                </p>
              ) : null}

              {/* Quem aprovou e quando: é o que torna "reversível" verificável,
                  em vez de uma promessa. */}
              <div className="mt-auto flex items-center justify-between gap-4 border-t border-[var(--clara-fog)] pt-5">
                <small className="clara-small">
                  {concept.verifiedBy ?? "—"} · {dateFormat.format(concept.updatedAt)}
                </small>
                <span className="clara-small font-mono">{concept.conceptId}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="max-w-[720px] pt-16 sm:pt-24">
        <h2 className="clara-display-lg text-pretty">Nada é aprendido sem você dizer sim.</h2>
        <p className="clara-lead mt-5">
          Cada regra guarda quem confirmou e quando. Os fatos — valor, data e origem — nunca
          mudam; o que muda é a leitura, e toda mudança fica registrada abaixo.
        </p>
      </section>

      <section className="pt-16">
        <p className="clara-eyebrow mb-4">Histórico versionado</p>
        {history.length === 0 ? (
          <p className="text-[var(--clara-slate)]">Nenhuma alteração registrada ainda.</p>
        ) : (
          <div className="clara-card px-7 py-3.5">
            <ul>
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 border-t border-[var(--clara-fog)] py-4 first:border-t-0 sm:grid-cols-[110px_1fr_auto]"
                >
                  <span className="clara-small hidden sm:block">
                    {dateFormat.format(entry.createdAt)}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate font-semibold">{entry.description}</strong>
                    <small className="clara-small mt-[3px] block">
                      {entry.previousValue ?? "sem categoria"} →{" "}
                      {entry.newValue ?? "sem categoria"}
                    </small>
                  </span>
                  <span className="clara-small font-mono">{entry.author}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
