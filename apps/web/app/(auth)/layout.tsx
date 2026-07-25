import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Clara
      </Link>
      <div className="mt-10">{children}</div>
    </main>
  );
}
