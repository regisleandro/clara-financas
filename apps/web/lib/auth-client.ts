"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Mesma origem: o control plane serve a UI e o /api/auth. Sem `baseURL` o
 * cliente resolve pela origem atual — e é preciso ser assim: uma baseURL
 * relativa quebra na renderização no servidor, porque `new URL("/api/auth")`
 * exige origem absoluta.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
