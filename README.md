# Check-in Greco Cycle · América Greco

Site de check-in das aulas de spinning da Academia América Greco (Boa Vista/RR), com painel de gestão para a dona.

- `/` — aluno escolhe dia, horário, informa nome + CPF e garante a bike (vagas controladas por turma).
- `/admin` — painel protegido por senha: turmas do dia, presença/falta, cancelamentos, adicionar aluno, horários e nº de bikes, relatório com exportação CSV, troca de senha.

Stack: HTML/CSS/JS estático (Vercel) · Supabase (Postgres + funções RPC com RLS fechado).

Banco: `supabase/schema.sql`.

Desenvolvido por Vendora Labs.
