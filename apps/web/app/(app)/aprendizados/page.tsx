import { redirect } from "next/navigation";

import { loadLearnings, loadReclassifications } from "@/lib/ledger";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  CategorizationRule: "REGRA APRENDIDA",
  Merchant: "COMERCIANTE",
  Commitment: "COMPROMISSO",
  IssuerPattern: "PADRÃO DE EMISSOR",
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
    <>
      <section>
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          MEMÓRIA TRANSPARENTE
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Aprendizados.</h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          O que a Clara sabe sobre você — legível, versionado e reversível.
        </p>
      </section>

      <section className="mt-12">
        {learnings.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <h2 className="text-xl font-semibold tracking-tight">
              A Clara ainda não aprendeu nada sobre você.
            </h2>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-muted-foreground">
              Quando você corrigir uma categoria na conversa, ela vai propor guardar a regra. Só
              entra aqui o que você aprovar.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {learnings.map((concept) => (
              <li key={concept.conceptId} className="rounded-2xl border p-6">
                <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
                  {TYPE_LABEL[concept.type] ?? concept.type.toUpperCase()}
                </p>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{concept.title}</h3>
                {concept.description !== null ? (
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {concept.description}
                  </p>
                ) : null}

                {/* Proveniência do aprendizado: quem aprovou e quantas versões
                    existem. É o que torna "reversível" uma afirmação
                    verificável, e não uma promessa. */}
                <p className="mt-4 text-xs text-muted-foreground">
                  Aprovado por {concept.verifiedBy ?? "—"} ·{" "}
                  {dateFormat.format(concept.updatedAt)} ·{" "}
                  {concept.revisionCount === 1
                    ? "1 versão"
                    : `${concept.revisionCount} versões`}
                </p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  learnings/{concept.conceptId}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          HISTÓRICO VERSIONADO
        </p>
        <h2 className="mt-3 text-xl font-semibold tracking-tight">Trilha de auditoria.</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
          Toda mudança de leitura fica registrada: quem alterou, quando e de quê para quê. Os
          fatos — valor, data e origem — nunca mudam; correção deles vira uma linha de ajuste.
        </p>

        {history.length === 0 ? (
          <p className="mt-6 text-muted-foreground">Nenhuma alteração registrada ainda.</p>
        ) : (
          <ul className="mt-6 divide-y">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-3 text-sm">
                <span className="tabular-nums text-muted-foreground">
                  {dateFormat.format(entry.createdAt)}
                </span>
                <span className="max-w-xs truncate">{entry.description}</span>
                <span className="text-muted-foreground">
                  {entry.previousValue ?? "sem categoria"} → {entry.newValue ?? "sem categoria"}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {entry.author}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
