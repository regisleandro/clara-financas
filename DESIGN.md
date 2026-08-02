---
name: Clara Finanças
description: Clareza financeira calma, direta e rastreável.
colors:
  forest-ink: "#1a3300"
  cream-paper: "#fcfaf5"
  surface: "#fffefa"
  highlighter-yellow: "#ffe95c"
  pencil-gray: "#b6b6b6"
  teal: "#a8e5e5"
  mint: "#d5f5c2"
  blush: "#f6d0ff"
  terracotta: "#cb5521"
typography:
  display:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.5rem + 3vw, 4rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Roboto Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.08em"
rounded:
  tile: "12px"
  card: "12px"
  button: "6px"
  chip: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.forest-ink}"
    textColor: "{colors.cream-paper}"
    rounded: "{rounded.button}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "12px"
---

# Design System: Clara Finanças

## Overview

**Creative North Star: "Clareza de Mesa"**

A Clara deve parecer uma conversa tranquila diante de documentos organizados,
não uma central bancária nem um console de agente. O sistema usa familiaridade,
espaço e linguagem direta para reduzir ansiedade; a complexidade técnica
permanece atrás de resultados verificáveis e decisões explícitas.

O registro é de produto. Densidade é permitida em Detalhes, enquanto o chat
preserva leitura curta e ritmo generoso. O brief visual usa papel creme, tinta
verde-floresta e marcações de trabalho — uma mesa de análise, não uma central
bancária nem um console de agente.

**Key Characteristics:**

- Claro e restrito.
- Dados densos apenas onde ajudam a decidir.
- Estado e consequência antes de decoração.
- Progresso descrito como tarefa humana.
- Sem gradientes, glassmorphism ou excesso de cards e pílulas.

## Colors

A paleta é quente e editorial, com verde-floresta reservado a ação, seleção e
foco. Amarelo, mint, teal e blush marcam estados sem depender apenas de cor.

### Primary

- **Verde-floresta:** usado em ações primárias e foco, nunca como decoração.

### Neutral

- **Tinta:** texto principal e superfícies escuras.
- **Névoa:** fundo do produto e estados discretos.
- **Superfície:** cards, painéis e campos.
- **Cinza Ardósia:** metadados e texto secundário.
- **Cinza de Borda:** separação estrutural.

### Named Rules

**The One Action Rule.** Verde-floresta identifica a ação principal ou o estado
atual. Se tudo está forte, nada está priorizado.

## Typography

**Display Font:** Bricolage Grotesque 800, apenas em títulos grandes.
**Body Font:** Inter; **metadados:** Roboto Mono.

**Character:** uma única família de sistema em papéis distintos mantém o
produto familiar, rápido e legível.

### Hierarchy

- **Display:** peso 800, usado apenas em títulos grandes e métricas.
- **Title:** Inter 700, usado em decisões e seções.
- **Body:** 1rem–1.125rem, line-height 1.5, para conversa e explicações.
- **Label:** Roboto Mono 0.6875rem, tracking positivo, para metadados curtos.

### Named Rules

**The Numbers Align Rule.** Valores comparáveis usam algarismos tabulares.

## Elevation

O sistema é plano por padrão. Profundidade vem da diferença entre névoa e
superfície, não de sombras decorativas. Painéis móveis usam a elevação nativa
do diálogo; cards internos não criam novas camadas.

### Named Rules

**The Tonal Depth Rule.** Primeiro cor e espaço; sombra apenas quando uma
superfície realmente se sobrepõe a outra.

## Components

### Buttons

- **Shape:** raio de 6px; chips podem ser pílulas completas.
- **Primary:** verde-floresta sobre papel claro.
- **Hover / Focus:** alteração curta de tonalidade e anel verde visível.
- **Secondary:** contorno de tinta ou ação textual específica.

### Chips

- **Style:** superfície de névoa, texto curto e raio completo.
- **State:** sugestões iniciam uma ação; não funcionam como decoração.

### Cards / Containers

- **Corner Style:** 12px, com borda de 1px e sem sombra em repouso.
- **Background:** superfície clara sobre névoa.
- **Shadow Strategy:** nenhuma sombra em repouso.
- **Internal Padding:** 24px a 28px nas decisões principais.

### Inputs / Fields

- **Style:** superfície clara, borda cinza e raio de 12px.
- **Focus:** anel verde-floresta consistente.
- **Error / Disabled:** mensagem específica e redução de ênfase sem esconder o
  rótulo.

### Navigation

Controles familiares, rótulos diretos e ação atual evidente. No celular,
Detalhes ocupa uma superfície completa com “Voltar ao chat”; no desktop fica ao
lado da conversa.

### Decision Card

Toda escrita durável mostra objeto, alcance e consequência. Botões nomeiam a
ação real, nunca “Sim”, “OK” ou “Aprovar” isoladamente.

## Do's and Don'ts

### Do:

- **Do** manter o chat curto e mover números detalhados para Detalhes.
- **Do** mostrar consequência e alcance antes de pedir uma decisão.
- **Do** traduzir execução interna para tarefas como “Lendo o documento”.
- **Do** preservar foco visível, semântica e redução de movimento existentes.

### Don't:

- **Don't** criar aparência bancária corporativa, fria ou intimidadora.
- **Don't** gamificar decisões financeiras ou celebrar gastos.
- **Don't** expor linguagem técnica, identificadores, prompts, raciocínio ou
  JSON.
- **Don't** transformar agentes e ferramentas em espetáculo.
- **Don't** aninhar cards ou usar sombras para substituir hierarquia.
