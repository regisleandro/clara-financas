"""Schema inicial: as 19 tabelas, RLS por tenant, imutabilidade do razão, papéis.

Porta consolidada das 27 migrações Drizzle de `packages/db/src/migrations/`.
Não recria cada passo histórico — reproduz o ESTADO final que elas alcançam,
porque é dele que este serviço parte. Três blocos, na ordem que a segurança exige:

  1. Papel de aplicação `clara_app`, sem superusuário e sem BYPASSRLS — a RLS
     só protege se o papel conectado estiver sujeito a ela.
  2. As tabelas, via `Base.metadata` (SQLAlchemy é a fonte da verdade do shape).
  3. RLS (`FORCE ROW LEVEL SECURITY` + policy por `app.tenant_id`) em toda
     tabela de tenant, e os dois triggers de imutabilidade do razão.

Revision ID: 0001
Revises:
Create Date: 2026-08-23
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from clara.db.models import Base

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Toda tabela cuja primeira coluna de isolamento é `tenant_id` — RLS igual em
# todas: `tenant_id = current_setting('app.tenant_id', true)`. `current_setting`
# com o segundo argumento `true` devolve NULL quando a variável não existe, a
# comparação não casa com linha nenhuma, e o comportamento é falhar FECHADO.
TENANT_ISOLATED_TABLES = [
    "concepts",
    "concept_revisions",
    "agent_sessions",
    "documents",
    "batches",
    "transactions",
    "transaction_reclassifications",
    "commitments",
    "notifications",
    "agent_tool_events",
    "extraction_stagings",
    "financial_action_proposals",
    "agent_artifacts",
]

# Trilhas append-only: a garantia de auditoria some se a própria aplicação
# puder apagar ou reescrever uma linha.
APPEND_ONLY_TABLES = ["concept_revisions", "transaction_reclassifications", "agent_tool_events"]


def upgrade() -> None:
    bind = op.get_bind()

    # -- 1. Papel de aplicação --------------------------------------------
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clara_app') THEN
            CREATE ROLE clara_app LOGIN PASSWORD 'clara_app'
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
          END IF;
        END
        $$;
        """
    )
    op.execute("GRANT USAGE ON SCHEMA public TO clara_app")
    op.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clara_app")
    op.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO clara_app")

    # -- 2. As tabelas ------------------------------------------------------
    Base.metadata.create_all(bind=bind)
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO clara_app")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clara_app")

    # -- 3. RLS ---------------------------------------------------------
    for table in TENANT_ISOLATED_TABLES:
        op.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY')
        op.execute(
            f'CREATE POLICY "{table}_tenant_isolation" ON "{table}" '
            f"USING (tenant_id = current_setting('app.tenant_id', true)) "
            f"WITH CHECK (tenant_id = current_setting('app.tenant_id', true))"
        )

    for table in APPEND_ONLY_TABLES:
        op.execute(f'REVOKE UPDATE, DELETE ON "{table}" FROM clara_app')
    # exceção: agent_tool_events aceita INSERT/SELECT, nunca UPDATE/DELETE —
    # já coberto pelo REVOKE acima, que não reabre nada.

    # extraction_stagings É descartável por construção: a proposta que a
    # consome apaga a linha. DELETE faz parte do contrato; UPDATE não.
    op.execute('REVOKE UPDATE ON "extraction_stagings" FROM clara_app')

    # agent_artifacts: resultado temporário de subagente, nunca editado.
    op.execute('REVOKE ALL ON "agent_artifacts" FROM clara_app')
    op.execute('GRANT SELECT, INSERT, DELETE ON "agent_artifacts" TO clara_app')

    # financial_action_proposals nunca é apagada — só transita de estado.
    op.execute('REVOKE DELETE ON "financial_action_proposals" FROM clara_app')

    # -- 4. Imutabilidade do razão confirmado -------------------------------
    #
    # Duas garantias distintas: RLS impede um tenant de ver o dado de outro;
    # o trigger impede o PRÓPRIO tenant de reescrever o que já confirmou —
    # sem isso nenhum número seria reprodutível, por mais correta que fosse a
    # aritmética. A versão final (não a inicial ingênua) já distingue FATO de
    # LEITURA: enquanto `proposed`, tudo muda livremente; confirmada, só
    # categoria e comerciante podem mudar (por isso `recategorize_transactions`
    # é uma escrita legítima, e é dela que nasce `transaction_reclassifications`).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION clara_transactions_immutable()
        RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status <> 'proposed' THEN
              RAISE EXCEPTION
                'transação % já foi confirmada e não pode ser apagada; registre um ajuste', OLD.id
                USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
          END IF;

          IF OLD.status = 'proposed' THEN
            RETURN NEW;
          END IF;

          IF NEW.amount IS DISTINCT FROM OLD.amount
             OR NEW.date IS DISTINCT FROM OLD.date
             OR NEW.original_description IS DISTINCT FROM OLD.original_description
             OR NEW.kind IS DISTINCT FROM OLD.kind
             OR NEW.installment_current IS DISTINCT FROM OLD.installment_current
             OR NEW.installment_total IS DISTINCT FROM OLD.installment_total
             OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
             OR NEW.page IS DISTINCT FROM OLD.page
             OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
             OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
             OR NEW.adjusts_transaction_id IS DISTINCT FROM OLD.adjusts_transaction_id
          THEN
            RAISE EXCEPTION
              'transação % já foi confirmada: valor, data, descrição e origem não podem ser alterados; registre um ajuste. Categoria e comerciante podem ser reclassificados.',
              OLD.id
              USING ERRCODE = 'restrict_violation';
          END IF;

          IF NEW.status = 'proposed' THEN
            RAISE EXCEPTION 'transação % já foi confirmada; seu estado não retrocede', OLD.id
              USING ERRCODE = 'restrict_violation';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER clara_transactions_immutable_trigger
          BEFORE UPDATE OR DELETE ON "transactions"
          FOR EACH ROW EXECUTE FUNCTION clara_transactions_immutable();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION clara_batches_immutable()
        RETURNS TRIGGER AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            IF OLD.status = 'confirmed' THEN
              RAISE EXCEPTION 'lote % já foi confirmado e não pode ser apagado', OLD.id
                USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN OLD;
          END IF;

          IF OLD.status = 'confirmed' AND NEW.status <> 'confirmed' THEN
            RAISE EXCEPTION 'lote % já foi confirmado; seu estado não retrocede', OLD.id
              USING ERRCODE = 'restrict_violation';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER clara_batches_immutable_trigger
          BEFORE UPDATE OR DELETE ON "batches"
          FOR EACH ROW EXECUTE FUNCTION clara_batches_immutable();
        """
    )

    # -- 5. Índice parcial de compromissos (NULLs são distintos entre si) --
    op.execute('DROP INDEX IF EXISTS "commitments_tenant_kind_counterparty_idx"')
    op.execute(
        """
        CREATE UNIQUE INDEX "commitments_tenant_kind_counterparty_idx"
          ON "commitments" USING btree ("tenant_id", "kind", coalesce("counterparty", ''))
          WHERE "commitments"."kind" <> 'custom';
        """
    )


def downgrade() -> None:
    op.execute('DROP TRIGGER IF EXISTS clara_batches_immutable_trigger ON "batches"')
    op.execute("DROP FUNCTION IF EXISTS clara_batches_immutable()")
    op.execute('DROP TRIGGER IF EXISTS clara_transactions_immutable_trigger ON "transactions"')
    op.execute("DROP FUNCTION IF EXISTS clara_transactions_immutable()")
    Base.metadata.drop_all(bind=op.get_bind())
