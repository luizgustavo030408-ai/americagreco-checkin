# Check-in Greco Cycle · América Greco

Site de check-in das aulas de spinning da Academia América Greco (Boa Vista/RR), com painel de gestão para a dona.

- `/` — a pessoa escolhe a aula, diz se é aluna da academia ou externa (diária), informa nome + CPF e garante a bike.
- `/admin` — painel da gestora (usuário/senha): cadastra aulas (dia, horário, vagas para alunos e para externos), no máximo 12 bikes por aula (alunos + externos, travado também no banco), vê e remove inscritos, edita e apaga aulas. Atualiza sozinho.
- `/cartaz` — cartaz A4 com QR Code para imprimir.

Stack: HTML/CSS/JS estático (Vercel) · Supabase (Postgres + funções RPC com RLS fechado).

Banco: `supabase/schema.sql`.

Desenvolvido por Vendora Labs.
