-- Remove as quatro tabelas da família de artefato v3.
--
-- `conversation_goals`, `agent_tasks` e `decision_proposals` eram WRITE-ONLY:
-- verificado por grep antes de apagar, nenhum SELECT em lugar nenhum do
-- repositório. `createDecision` sequer chegou a ser chamado uma vez.
--
-- `conversation_artifacts` era a família paralela de artefatos, usada só por
-- `analyze_series` para publicar a evolução de vários períodos. Ela existia
-- porque o vocabulário de painéis não tinha forma para série e porque o recibo
-- do analista só cabia um id. As duas limitações foram removidas — `ViewSchema`
-- ganhou `series`, o recibo virou plural — e a série passou a viajar pela via
-- única, entrando no mesmo guard de reconciliação do qual era a única exceção.
--
-- O v3 nunca rodou em produção, só em desenvolvimento. Ao aplicar, as tabelas
-- continham 2, 2, 2 e 0 linhas de teste.

DROP TABLE "agent_tasks" CASCADE;--> statement-breakpoint
DROP TABLE "conversation_artifacts" CASCADE;--> statement-breakpoint
DROP TABLE "conversation_goals" CASCADE;--> statement-breakpoint
DROP TABLE "decision_proposals" CASCADE;