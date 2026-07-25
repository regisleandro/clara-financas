import Link from "next/link";

import { GoogleSignIn } from "@/components/google-sign-in";

export default function SignUpPage() {
  return (
    <>
      <h1 className="clara-display-lg">Comece pela primeira fatura.</h1>
      <p className="clara-lead mt-4">
        Criamos um espaço só seu. Nada é registrado sem a sua aprovação.
      </p>

      <div className="mt-8">
        <GoogleSignIn label="Criar conta com Google" />
      </div>

      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
        Pedimos apenas seu nome e e-mail — nada da sua caixa de entrada nem dos seus arquivos.
      </p>

      <p className="mt-8 text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href="/entrar" className="text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </>
  );
}
