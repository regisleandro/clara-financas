import Link from "next/link";

/**
 * Landing pública.
 *
 * A copy não foi inventada: cada mensagem vem das *leads* do protótipo
 * Clara-Agente-Financeiro.html, para que landing e app falem a mesma língua.
 * Página estática — nenhuma chamada ao agente, nenhum toque em banco de tenant.
 */

const CTA_PRIMARY =
  "inline-flex h-12 items-center justify-center rounded-full bg-primary px-7 text-[15px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const CTA_SECONDARY =
  "inline-flex h-12 items-center justify-center rounded-full px-7 text-[15px] font-medium text-primary transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const STEPS = [
  {
    n: "01",
    title: "Envie a fatura em PDF",
    body: "Fatura de cartão, extrato ou nota fiscal. A Clara pede a senha se o documento for protegido.",
  },
  {
    n: "02",
    title: "Confira o que ela extraiu",
    body: "Cada transação vem categorizada, com o grau de confiança à vista e os itens duvidosos destacados.",
  },
  {
    n: "03",
    title: "Aprove",
    body: "Nada entra no seu razão sem você dizer sim. Corrija o que estiver errado — e a Clara aprende a regra.",
  },
];

const PROOFS = [
  {
    eyebrow: "CONFERÊNCIA",
    title: "Total confere.",
    body: "A fatura declara o próprio total. A Clara soma o que extraiu e mostra a conta batendo — ou destaca exatamente onde divergiu.",
  },
  {
    eyebrow: "PROVENIÊNCIA",
    title: "Cada número pode ser rastreado até a origem.",
    body: "Clicou num valor, vê as transações que o compõem. Clicou de novo, vê a página do documento de onde saiu.",
  },
  {
    eyebrow: "MEMÓRIA TRANSPARENTE",
    title: "O que a Clara sabe sobre você — legível, versionado e reversível.",
    body: "Cada coisa aprendida é um registro que você pode ler, revisar e desfazer. Sem caixa-preta.",
  },
  {
    eyebrow: "PROATIVIDADE",
    title: "A Clara cuida dos prazos antes que eles virem preocupação.",
    body: "Vencimento chegando, assinatura que subiu de preço, cobrança repetida. Ela fala primeiro.",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold tracking-tight">Clara</span>
        <Link href="/entrar" className="text-sm text-muted-foreground hover:text-foreground">
          Entrar
        </Link>
      </header>

      <section className="py-20 sm:py-28">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
          ASSISTENTE FINANCEIRO
        </p>
        <h1 className="mt-4 max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Seu dinheiro, explicado com clareza.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Envie suas faturas. A Clara organiza, categoriza e explica — e nada é registrado sem a sua
          aprovação.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/cadastro" className={CTA_PRIMARY}>
            Entrar com Google
          </Link>
          <Link href="/entrar" className={CTA_SECONDARY}>
            Já tenho conta
          </Link>
        </div>
      </section>

      <section className="border-t py-20">
        <h2 className="text-sm font-medium tracking-[0.14em] text-muted-foreground">
          COMO FUNCIONA
        </h2>
        <div className="mt-10 grid gap-10 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="text-sm font-medium text-muted-foreground">{step.n}</span>
              <h3 className="mt-3 text-xl font-semibold tracking-tight">{step.title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {PROOFS.map((proof) => (
        <section key={proof.eyebrow} className="border-t py-20">
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">
            {proof.eyebrow}
          </p>
          <h2 className="mt-4 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {proof.title}
          </h2>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {proof.body}
          </p>
        </section>
      ))}

      <section className="border-t py-20">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground">PRIVACIDADE</p>
        <h2 className="mt-4 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Seu espaço é uma instância e um banco só seus.
        </h2>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Seus dados financeiros não dividem servidor nem banco com os de mais ninguém. É separação
          de verdade, não uma coluna a mais numa tabela compartilhada.
        </p>
      </section>

      <section className="border-t py-24">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Comece enviando uma fatura.
        </h2>
        <div className="mt-8">
          <Link href="/cadastro" className={CTA_PRIMARY}>
            Entrar com Google
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t py-10 text-sm text-muted-foreground">
        <span>Clara</span>
        <span>
          A Clara organiza e analisa seus próprios dados. Ela não recomenda investimentos nem
          produtos financeiros.
        </span>
      </footer>
    </main>
  );
}
