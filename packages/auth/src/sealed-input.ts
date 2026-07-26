import { createHash } from "node:crypto";

import { CompactEncrypt, compactDecrypt } from "jose";
import { z } from "zod";

const SealedInputSchema = z.object({
  tenantId: z.string().min(1),
  requestId: z.string().min(1),
  purpose: z.literal("pdf_password"),
  value: z.string().min(1).max(512),
  expiresAt: z.number().int().positive(),
});

export type SealedInput = z.infer<typeof SealedInputSchema>;

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Criptografa um valor sensível que só uma tool do agente deve abrir. */
export async function sealInput(input: SealedInput, secret: string) {
  return new CompactEncrypt(new TextEncoder().encode(JSON.stringify(input)))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "clara-sealed-input+jwe" })
    .encrypt(encryptionKey(secret));
}

/** Abre e valida um envelope; tokens expirados ou adulterados são recusados. */
export async function openSealedInput(token: string, secret: string) {
  const { plaintext, protectedHeader } = await compactDecrypt(token, encryptionKey(secret));
  if (protectedHeader.typ !== "clara-sealed-input+jwe") {
    throw new Error("tipo de envelope inválido");
  }

  const input = SealedInputSchema.parse(
    JSON.parse(new TextDecoder().decode(plaintext)) as unknown,
  );
  if (input.expiresAt <= Date.now()) throw new Error("envelope expirado");
  return input;
}
