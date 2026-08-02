import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[680px] flex-col justify-center px-4 py-8 sm:px-8 sm:py-16">
      <div className="clara-card w-full p-6 sm:p-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg text-base font-bold tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--clara-ink)]"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--clara-yellow)] text-[var(--clara-ink)]">
            <span aria-hidden="true" className="text-lg leading-none">c.</span>
          </span>
          clara
        </Link>
        <div className="mt-10 max-w-[34rem]">{children}</div>
      </div>
    </main>
  );
}
