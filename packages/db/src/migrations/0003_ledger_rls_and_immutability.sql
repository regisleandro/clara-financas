-- RLS do razão + imutabilidade do que já foi confirmado.
--
-- Duas garantias distintas, e é importante não confundi-las:
--   RLS  -> um tenant não enxerga o dado do outro.
--   Trigger -> nem o próprio dono reescreve o que já confirmou.
-- A segunda é o que sustenta a hipótese H5: se transação confirmada pudesse
-- ser editada, nenhum número seria reproduzível, por mais correta que fosse
-- a aritmética.

-- ---------------------------------------------------------------------------
-- RLS por tenant (mesmo padrão das demais tabelas de tenant)
-- ---------------------------------------------------------------------------
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "documents_tenant_isolation" ON "documents"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "batches_tenant_isolation" ON "batches"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "transactions_tenant_isolation" ON "transactions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Imutabilidade do razão confirmado
--
-- Enquanto `proposed`, a linha é rascunho: editar é livre, e é o que permite o
-- botão "Corrigir" do cartão conviver com um gate de aprovação binário.
-- Depois de `confirmed` ou `adjustment`, a linha é registro contábil.
--
-- A única transição permitida em UPDATE é proposed -> confirmed/adjustment,
-- ou seja, a própria aprovação. Correção posterior insere uma linha de ajuste
-- com `adjusts_transaction_id`, nunca reescreve a original.
-- ---------------------------------------------------------------------------
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

  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION
      'transação % já foi confirmada e não pode ser alterada; registre um ajuste', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER clara_transactions_immutable_trigger
  BEFORE UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION clara_transactions_immutable();
--> statement-breakpoint

-- Mesma lógica para o lote: aprovado é aprovado.
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
--> statement-breakpoint
CREATE TRIGGER clara_batches_immutable_trigger
  BEFORE UPDATE OR DELETE ON "batches"
  FOR EACH ROW EXECUTE FUNCTION clara_batches_immutable();
