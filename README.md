# Check-in Greco Cycle · América Greco

Site de check-in das aulas de spinning da Academia América Greco (Boa Vista/RR), com painel de gestão para a dona.

- `/` — a pessoa escolhe a aula, diz se é aluna da academia ou externa (diária), informa nome + CPF e garante a bike.
- `/admin` — painel da gestão (login por usuário/senha): cria aulas (dia, horário, vagas para alunos e externos, valor da diária, repetição semanal), lista ao vivo de quem fez check-in, presença, pagamento das diárias, relatório e QR Code.
- `/cartaz` — cartaz A4 com QR Code para imprimir.

Stack: HTML/CSS/JS estático (Vercel) · Supabase (Postgres + funções RPC com RLS fechado).

Banco: `supabase/schema.sql`.

Desenvolvido por Vendora Labs.
