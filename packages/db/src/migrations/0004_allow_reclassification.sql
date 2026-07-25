-- Distingue FATO de LEITURA numa transação confirmada.
--
-- A versão anterior do trigger bloqueava qualquer UPDATE depois da
-- confirmação. Correto para dinheiro, e errado para categoria:
--
--   * valor, data, descrição original, página e documento de origem são FATO —
--     vieram do documento, e correção vira linha de ajuste;
--   * categoria e comerciante são LEITURA — interpretação de quem organiza, e
--     interpretação muda quando a pessoa ensina algo novo ao sistema. É a
--     hipótese H4 inteira.
--
-- Tratar as duas com o mesmo mecanismo forçaria um par de linhas `−X` e `+X`
-- só para reetiquetar: ruído de soma zero no razão, totais confusos e nenhum
-- ganho de auditoria. A mudança de leitura passa a ser permitida — mas nunca
-- silenciosa: `transaction_reclassifications` registra cada uma.

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

  -- Rascunho é rascunho: enquanto proposed, tudo pode mudar.
  IF OLD.status = 'proposed' THEN
    RETURN NEW;
  END IF;

  -- A partir daqui a linha é registro contábil. Só a leitura pode mudar,
  -- e a comparação é campo a campo para que um campo novo no schema não passe
  -- a ser editável por esquecimento.
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

  -- Confirmada não volta a ser rascunho.
  IF NEW.status = 'proposed' THEN
    RAISE EXCEPTION 'transação % já foi confirmada; seu estado não retrocede', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
