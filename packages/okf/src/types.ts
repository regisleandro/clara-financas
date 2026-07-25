import { z } from "zod";

/**
 * Open Knowledge Format v0.2 — GoogleCloudPlatform/knowledge-catalog.
 *
 * Correções em relação ao rascunho inicial da spec do projeto, apuradas contra
 * o SPEC.md real:
 *  - a versão corrente é 0.2, não 0.1;
 *  - v0.2 trocou `timestamp` por `generated: { by, at }` e moveu a lista
 *    `# Citations` do corpo para o frontmatter `sources`;
 *  - `read-only` vs `write` NÃO é conceito OKF — o formato não tem modelo de
 *    acesso. Nossa distinção constitution/learnings é camada do projeto.
 */

export const OKF_VERSION = "0.2";

/** §3.1 — os dois únicos nomes de arquivo reservados. */
export const RESERVED_FILENAMES = ["index.md", "log.md"] as const;

/** §7 — convenção de ator. */
export const actor = {
  human: (id: string) => `human:${id}`,
  agent: (name: string, version: string) => `${name}/${version}`,
  process: (id: string) => `process:${id}`,
};

/** §10 — proveniência. */
export const GeneratedSchema = z.object({
  by: z.string().min(1),
  at: z.string().min(1),
});

export const VerifiedSchema = z.object({
  by: z.string().min(1),
  at: z.string().min(1),
});

/** §5 — fontes. `resource` é o único campo obrigatório por entrada. */
export const SourceSchema = z
  .object({
    resource: z.string().min(1),
    id: z.string().optional(),
    title: z.string().optional(),
    author: z.string().optional(),
    last_modified: z.string().optional(),
  })
  .loose();

/**
 * §4.1 — `type` é o ÚNICO campo sempre obrigatório, e é livre, não enum.
 * `.loose()` é deliberado: o §11 manda tolerar chaves desconhecidas.
 */
export const FrontmatterSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    resource: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["draft", "stable", "deprecated"]).optional(),
    stale_after: z.string().optional(),
    sources: z.array(SourceSchema).optional(),
    generated: GeneratedSchema.optional(),
    verified: z.array(VerifiedSchema).optional(),
  })
  .loose();

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

export type Concept = {
  /** ID OKF: caminho dentro do bundle, sem `.md`. */
  id: string;
  frontmatter: Frontmatter;
  body: string;
};

export type ValidationIssue = {
  conceptId: string;
  severity: "error" | "warning";
  message: string;
};
