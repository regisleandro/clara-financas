---
name: Clara Finanças
description: Clareza financeira calma, direta e rastreável.
colors:
  ink: "#1d1d1f"
  fog: "#f5f5f7"
  surface: "#ffffff"
  action-blue: "#0071e3"
  link-blue: "#0066cc"
  slate: "#86868b"
  border-ash: "#e8e8ed"
  success-green: "#1d7f45"
  warning-amber: "#8b5d00"
typography:
  display:
    fontFamily: "SF Pro Display, Inter Tight, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: "-0.015em"
  body:
    fontFamily: "SF Pro Text, Inter, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.019em"
  label:
    fontFamily: "SF Pro Text, Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: "0.06em"
rounded:
  tile: "12px"
  card: "28px"
  pill: "980px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "11px 22px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "28px"
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

O registro é de produto. Densidade é permitida nos artefatos, enquanto o chat
preserva leitura curta e ritmo generoso. Apple Settings, Linear e Stripe
Dashboard são referências de previsibilidade, hierarquia e confiança.

**Key Characteristics:**

- Claro e restrito.
- Dados densos apenas onde ajudam a decidir.
- Estado e consequência antes de decoração.
- Progresso descrito como tarefa humana.

## Colors

A paleta é neutra e fria, com azul reservado a ação, seleção e foco.

### Primary

- **Azul de Ação:** usado em ações primárias e foco, nunca como decoração.

### Neutral

- **Tinta:** texto principal e superfícies escuras.
- **Névoa:** fundo do produto e estados discretos.
- **Superfície:** cards, painéis e campos.
- **Cinza Ardósia:** metadados e texto secundário.
- **Cinza de Borda:** separação estrutural.

### Named Rules

**The One Action Rule.** Azul identifica a ação principal ou o estado atual.
Se tudo está azul, nada está priorizado.

## Typography

**Display Font:** SF Pro Display, com Inter Tight e system-ui.
**Body Font:** SF Pro Text, com Inter e system-ui.

**Character:** uma única família de sistema em papéis distintos mantém o
produto familiar, rápido e legível.

### Hierarchy

- **Display:** peso 600, usado apenas em títulos e métricas.
- **Title:** 1.1875rem, peso 600, usado em decisões e seções.
- **Body:** 1.0625rem, line-height 1.47, para conversa e explicações.
- **Label:** 0.75rem, tracking positivo, para metadados curtos.

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

- **Shape:** pílula completa.
- **Primary:** azul de ação sobre texto claro.
- **Hover / Focus:** alteração curta de opacidade e anel azul visível.
- **Secondary:** contorno de tinta ou ação textual específica.

### Chips

- **Style:** superfície de névoa, texto curto e raio completo.
- **State:** sugestões iniciam uma ação; não funcionam como decoração.

### Cards / Containers

- **Corner Style:** arredondamento generoso de 28px.
- **Background:** superfície clara sobre névoa.
- **Shadow Strategy:** nenhuma sombra em repouso.
- **Internal Padding:** 24px a 28px nas decisões principais.

### Inputs / Fields

- **Style:** superfície clara, borda cinza e raio de 12px.
- **Focus:** anel azul consistente.
- **Error / Disabled:** mensagem específica e redução de ênfase sem esconder o
  rótulo.

### Navigation

Controles familiares, rótulos diretos e ação atual evidente. No celular,
artefatos ocupam uma superfície modal completa; no desktop ficam ao lado da
conversa.

### Decision Card

Toda escrita durável mostra objeto, alcance e consequência. Botões nomeiam a
ação real, nunca “Sim”, “OK” ou “Aprovar” isoladamente.

## Do's and Don'ts

### Do:

- **Do** manter o chat curto e mover números detalhados para o artefato.
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
