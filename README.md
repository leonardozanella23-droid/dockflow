# DockFlow — Gestão de filas em docas

App web em português, responsivo, sem instalação para motoristas. Código preparado para GitHub Pages + Supabase (Postgres + Auth). O QR Code aponta para o check-in; operadores usam `/index.html?admin=1`.

## Funcionalidades
- Motorista: preenche nome, sobrenome e placa brasileira; vê número, posição e doca indicada, com atualização a cada 8 s.
- Placa não pode ter dois atendimentos simultâneos.
- Operador: login protegido, fila cronológica, chamada do próximo motorista para uma doca livre, conclusão e cancelamento, histórico do dia e QR Code para impressão. Atualização automática a cada 5 s.
- Banco de dados e permissões no Supabase; páginas estáticas no GitHub Pages. A senha de acompanhamento é um link secreto/token UUID, salvo no navegador do motorista.

## Passo 1 — Criar o banco de dados
1. Acesse https://supabase.com, crie um projeto e anote a URL e a **publishable key** (ou a antiga `anon key`) de **Project Settings > API**.
2. Vá a **SQL Editor > New query**, cole todo o arquivo `schema.sql` e execute. Isso cria as tabelas `docks`, `tickets` e `admins`, as funções seguras de acesso e três docas iniciais.
3. Em **Authentication > Users**, crie um usuário para a logística (e-mail e senha forte). Copie o `User UID` (UUID). **Não permita cadastro público de operadores**: em Authentication > Providers > Email, desative "Allow new users to sign up", se disponível; mantenha login por senha habilitado.
4. No SQL Editor, rode o comando abaixo substituindo o UUID:

   ```sql
   insert into public.admins (user_id)
   values ('COLE_AQUI_O_UUID_DO_USUARIO');
   ```

   Para adicionar outros operadores, crie cada usuário no painel Auth e insira o UUID em `admins`.

5. Se precisar de mais docas, rode no SQL Editor: `insert into public.docks(name) values ('Doca 04');`.

**IMPORTANTE:** `schema.sql` contém permissões explícitas. Não crie políticas públicas de leitura da tabela `tickets`, porque ela contém nomes e placas de motoristas. O driver vê apenas seu próprio registro com o link secreto; operadores autorizados veem o painel.

## Passo 2 — Configurar o app
Abra `config.js` e substitua:

```javascript
window.DOCKFLOW_CONFIG = {
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseAnonKey: "SUA_CHAVE_PUBLICAVEL_OU_ANON"
};
```

A **publishable key/anon key** pode estar no frontend. **NUNCA use a `service_role`/secret key**, pois todos os arquivos publicados no GitHub Pages são públicos. Não coloque senhas de operadores no repositório.

## Passo 3 — Publicar no GitHub, sem servidor local
1. Crie um repositório público no GitHub, por exemplo `dockflow`.
2. Envie `index.html`, `styles.css`, `app.js` e `config.js` à raiz do repositório. `schema.sql` e `README.md` podem permanecer como documentação.
3. Vá em **Settings > Pages**. Em **Build and deployment**, selecione **Deploy from a branch**, `main`, pasta `/ (root)` e salve.
4. Aguarde o GitHub informar a URL, geralmente `https://SEU-USUARIO.github.io/dockflow/`.
5. Abra a URL no celular: é o check-in. Abra `https://SEU-USUARIO.github.io/dockflow/?admin=1` no computador: é o painel da logística.
6. Faça login no painel, imprima o QR Code e fixe-o na portaria. O QR Code utiliza o endereço da página atualmente aberta, então **acesse primeiro a URL real publicada**, não um arquivo local. Ao usar domínio próprio, abra o painel no domínio definitivo antes de imprimir.

Os scripts Supabase JS e QRCode são carregados de CDNs via internet. Para operar sem depender de CDNs, hospede cópias dessas bibliotecas localmente.

## Passo 4 — Teste completo
1. Acesse o endereço público no celular e informe um nome e uma placa de TESTE no formato `ABC1D23`.
2. Confirme que apareceu uma senha e uma posição na fila.
3. Em outro dispositivo, entre em `?admin=1`, faça login e confira a fila.
4. Clique em **Chamar próximo** na Doca 01; o celular deve mostrar **Chamado** e **Doca 01** em até 8 segundos.
5. Clique em **Concluir atendimento**; o motorista deve ver **Concluído**. O mesmo veículo poderá fazer um novo check-in, quando necessário.
6. Teste também o bloqueio de placa duplicada, cancelamento e operação com várias docas.

## Links de acompanhamento e privacidade
- A senha do motorista é protegida por token aleatório no link `?ticket=...`, não pelo número sequencial da senha. Quem receber esse link poderá consultar o status, então ele não deve ser divulgado publicamente.
- O armazenamento local do navegador ajuda a retomar o acompanhamento no mesmo celular.
- Nomes e placas são dados pessoais: estabeleça aviso de privacidade, prazo de retenção e política de acesso conforme a LGPD antes de usar em produção. Este MVP **não inclui** exclusão automática de dados históricos, CAPTCHA, alertas por WhatsApp/SMS, contingência offline ou métricas avançadas.
- O sistema usa consultas periódicas, não notificações push. O motorista deve manter ou reabrir a página para ver a chamada. O horário exibido usa o fuso de São Paulo.
- Em operação intensa, adicione rate limiting e proteção antirrobô (como CAPTCHA validado em backend/Edge Function). A função de check-in tem validações e impede placa duplicada, mas isso não substitui proteção contra abuso.
- Números de senha são sequenciais globais: não reiniciam automaticamente a cada dia.

## Estrutura de arquivos
```
dockflow/
├── index.html   # Check-in, acompanhamento, login e painel
├── styles.css   # Visual responsivo
├── app.js       # Fluxos de motoristas e operadores
├── config.js    # URL e chave pública do Supabase (preencher)
├── schema.sql   # Banco de dados e permissões
└── README.md    # Este guia
```

## Solução de problemas
- **Tela de configuração pendente**: preencha `config.js` e confira se a biblioteca do Supabase carregou.
- **Permissão negada no painel**: confirme o UUID do operador em `public.admins` e use a mesma conta criada em Authentication.
- **Check-in não funciona**: execute o SQL por completo, confira URL/chave e verifique os erros no navegador.
- **QR aponta para lugar errado**: abra o painel na URL pública correta e imprima novamente.
- **Aparecem dados de demonstração?** Não. O app só funciona quando conectado ao banco configurado; sem configuração, não são registrados motoristas.

## Licença
Código disponibilizado para personalização e uso no seu projeto. Dependências de terceiros seguem suas respectivas licenças.
