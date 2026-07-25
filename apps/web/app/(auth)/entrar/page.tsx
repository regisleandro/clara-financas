import Link from "next/link";

import { GoogleSignIn } from "@/components/google-sign-in";

export default function SignInPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Bem-vindo de volta.</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        Entre para ver seus gastos, suas regras e seus próximos vencimentos.
      </p>

      <div className="mt-8">
        <GoogleSignIn label="Entrar com Google" />
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Ainda não tem conta?{" "}
        <Link href="/cadastro" className="text-primary hover:underline">
          Criar conta
        </Link>
      </p>
    </>
  );
}
