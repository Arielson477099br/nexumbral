# NEXUMBRAL — A arte de decifrar

Plataforma com contas de usuário, histórico persistente em SQLite, IA com visão e ferramentas de verificação.

## Executar (Node 20.6 ou superior)
1. `npm install`
2. `cp .env.example .env` e preencha `SECRET` (32+ caracteres) e `ANTHROPIC_API_KEY` (console.anthropic.com).
3. `npm start` e abra http://localhost:3000 (a primeira tela é o login).
4. `npm test` roda os testes automatizados.

## O que existe
- Cadastro, login e logout (bcrypt, cookie httpOnly assinado, limite de tentativas); todas as rotas de dados exigem sessão.
- Investigações salvas por usuário no banco, com busca, renomear, excluir e status.
- IA em `/api/ai`: texto, imagens (PNG, JPG, WEBP até 5 MB) e duas ferramentas executadas no servidor, `calcular` e `resolver_restricoes` (busca exaustiva que informa se a solução é única, múltipla ou inexistente).
- Controle de custo: limite por minuto e `DAILY_LIMIT` consultas por usuário por dia. A chave de API fica só no servidor.
- Forja de enigmas, Bússola de pistas e indicadores de progresso (pontos e níveis calculados dos seus dados).
- `/api/image`: geração de imagens por qualquer API compatível com `/v1/images/generations` (`IMAGE_API_URL`, `IMAGE_API_KEY`, `IMAGE_MODEL`). Ainda não há tela para ela.

## Ainda não implementado
Tela do Ateliê Visual e galeria; Perfil, Conquistas, Configurações e Central de ajuda; SymPy, Z3 e OR-Tools (a verificação atual é só a busca exaustiva); OCR separado; testes de interface e multimodais, que exigem chave de API.

## Publicar
Em Render, Railway, Fly.io ou VPS: defina as variáveis do `.env` no painel, `NODE_ENV=production`, HTTPS obrigatório e um disco persistente para `nexumbral.db`. Atrás de proxy, adicione `app.set("trust proxy",1)`.
