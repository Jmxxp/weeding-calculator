# Weeding Calculator

Um quadro simples para montar e salvar orçamentos de casamento. HTML, CSS e JavaScript puro, com um servidor Node.js para servir o site e conectar Gemini ou DeepSeek.

[Abrir aplicativo](https://jmxxp.github.io/weeding-calculator/) · [Código no GitHub](https://github.com/Jmxxp/weeding-calculator)

## Abrir

Requer Node.js 22 ou mais recente.

## Supabase e acesso da família

O aplicativo exige **usuário e senha** antes de abrir o planejamento. O usuário configurado é **jmxxp**. A senha é validada pelo **Supabase Auth**, que guarda seu hash no banco. A tela não pede e-mail; o endereço técnico da conta compartilhada fica apenas na configuração interna. Não há cadastro na interface.

Para conectar, é necessário um projeto Supabase, sua **Project URL** e a chave **publishable** (ou a chave legada `anon`). A senha do Postgres e chaves `secret`/`service_role` nunca entram no navegador.

1. Copie `.env.example` para `.env` e preencha `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`, disponíveis em **Project Settings → API Keys**.
2. Apenas na configuração administrativa do Supabase, em **Authentication → Users → Add user**, crie a conta técnica `familia@weeding-calculator.local`, com a senha de acesso escolhida e confirmação automática do e-mail. No app, a família entra com o usuário **jmxxp** e a senha, sem informar esse e-mail.
3. Execute [supabase/setup.sql](supabase/setup.sql) no SQL Editor do projeto. Ele cria `family_plans` com RLS e autoriza a conta do passo anterior em **App Metadata**. Não use User Metadata para essa permissão. Para um e-mail técnico diferente, ajuste o e-mail no SQL e em `SUPABASE_FAMILY_EMAIL`.
4. Como alternativa ao passo 2, preencha `SUPABASE_SECRET_KEY` e `FAMILY_ACCESS_PASSWORD` apenas no `.env` local e execute `npm run setup:supabase`. O script cria a conta confirmada e com a permissão necessária; não altera senhas de contas existentes.
5. Execute `npm run dev` ou gere a publicação com `npm run build:pages`.

Se o projeto for exclusivo deste app, desative novos cadastros em **Authentication → Sign In / Providers**. Mesmo em um projeto compartilhado, contas externas não acessam os dados da família: as regras exigem tanto a identidade correta quanto a permissão em App Metadata.

Os comandos de build incluem somente a URL, a chave pública, o nome de usuário e o e-mail técnico. `SUPABASE_FAMILY_USERNAME` permite alterar o usuário de acesso. O `.env` é ignorado pelo Git; a senha e a chave administrativa não são copiadas para `dist/`. Sem configuração, a entrada permanece fechada. Para testar as permissões no SQL Editor, execute [supabase/tests/family_plans_security.sql](supabase/tests/family_plans_security.sql), que verifica os acessos em uma transação com rollback.

Na primeira entrada, se o banco ainda estiver vazio, o planejamento já salvo no navegador é importado. Um erro de conexão não substitui dados do banco por um planejamento vazio. A sincronização consulta atualizações a cada 10 segundos e ao salvar; alterações independentes são combinadas, e edições simultâneas no mesmo campo usam o último salvamento concluído. Alterações ainda não enviadas são guardadas por projeto e conta e recuperadas após recarregar, quando o armazenamento do navegador está disponível. A barra superior informa alterações pendentes ou falhas e permite tentar novamente. **Sair** salva alterações pendentes antes de encerrar a sessão e limpar os dados privados deste app no navegador.

Referências: [autenticação por senha](https://supabase.com/docs/guides/auth/passwords) e [proteção com RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

```sh
npm install
npm run dev
```

Acesse **http://localhost:5173**.

## Usar

1. Use **+** para adicionar categorias e fornecedores. O lápis no título edita a categoria.
   Em cada coluna, **Adicionar fornecedor** permanece no topo, mesmo com cartões cadastrados. O seletor abaixo ordena apenas aquela categoria por **Mais barato**, **Mais caro**, **Melhores notas** ou **Ordem de cadastro**. Os controles continuam visíveis ao rolar os cartões; a ordenação vale durante a sessão e preserva as escolhas do orçamento.
2. Clique no cartão para editar nome, preço, telefone, descrição e nota. O marcador no canto marca o favorito.
3. Segure qualquer parte do cartão e arraste para a faixa de orçamento abaixo do kanban. No celular, um deslize rápido permite rolar; segurar inicia o arraste. Também é possível usar o pequeno **+** no cartão. Cada categoria tem uma escolha por orçamento; outra escolha a substitui.
4. Cada categoria tem seu espaço colorido em **Meu orçamento**, mesmo quando está vazia. **Falta escolher** mostra as escolhas pendentes: arraste um cartão da mesma categoria ou use a lista do espaço. Se não houver opções, **Adicionar fornecedor** cadastra e preenche o espaço. O **×** remove a escolha e mantém o espaço vazio visível. A lixeira na barra lateral limpa o orçamento em edição, preservando fornecedores e versões salvas.
5. Clique em **Salvar orçamento** e dê um nome à versão. O marcador na barra lateral abre as versões salvas para editar, duplicar ou excluir.

O símbolo **$** da barra lateral abre **Mais barato**, **Custo-benefício** e **Favoritos**. O marcador no canto de cada cartão marca favoritos. O custo-benefício pondera avaliação (65%) e preço relativo da categoria (35%).

O ícone de pessoas abre a lista de **Convidados**, com busca, filtros, confirmação de presença e quantidade de pessoas. O calendário abre os dados do casamento. A estimativa de convidados do casamento é independente das confirmações da lista.

Os preços são totais do serviço. Categorias sem escolha deixam o valor parcial. Os orçamentos salvos acompanham os preços atuais dos fornecedores.

A roda do mouse rola o kanban e a faixa de orçamento na horizontal, sem precisar de Shift. Nas colunas com muitos cartões, ela rola primeiro os cartões na vertical. No celular, a faixa tem o total acima das escolhas para manter os cartões legíveis.

## Dados e IA

O planejamento, os fornecedores, os convidados, os orçamentos salvos e o briefing são compartilhados pelo Supabase. O orçamento em edição e o histórico da IA ficam neste navegador. As chaves dos provedores de IA continuam apenas na sessão de cada aparelho.

Quando ainda não existem dados locais ou compartilhados, o planejamento começa com as categorias padrão. A abertura não apaga dados existentes.

Na aba **IA**, primeiro descreva o casamento que busca e informe a cidade ou região. Você pode indicar prioridades e um raio de busca. Depois configure sua chave, busque os modelos disponíveis e escolha um:

- **Gemini:** a pesquisa usa Google Search com a própria chave do [Gemini](https://aistudio.google.com/apikey), em modelos compatíveis com essa ferramenta.
- **DeepSeek:** o chat usa a chave do [DeepSeek](https://platform.deepseek.com/api_keys). Para pesquisar fornecedores, informe também uma chave [Tavily](https://app.tavily.com).

A pesquisa web pode ser desligada para conversar somente sobre o planejamento existente. Os resultados pesquisados exibem fontes e permitem revisar um fornecedor antes de adicioná-lo ao kanban. Quando não houver preço publicado, aparece **Cotação a consultar**; você informa o valor confirmado antes de salvar o cartão.

A IA também sugere combinações com base nas prioridades e no orçamento. Cada proposta aparece dentro do chat, em cartões coloridos por categoria, com escolhas editáveis, total recalculado e botão **Salvar orçamento**. Você pode editar e salvar versões diferentes de propostas anteriores.

O seletor **Histórico de conversas** permite reabrir conversas guardadas neste navegador. **Nova conversa** começa outro assunto. As edições dos orçamentos no chat também ficam no histórico. São mantidas até oito conversas recentes, com até 60 mensagens cada e limite total de 1 MB.

Quando solicitados, links de fontes e contatos confirmados aparecem clicáveis. Os atalhos de Google e de busca de perfis Instagram são identificados como buscas; não representam um perfil de fornecedor confirmado. Telefones de opções pesquisadas só aparecem quando constam da fonte.

As chaves ficam somente na sessão do navegador. O servidor não as grava em arquivos ou logs. Ao conversar, o contexto enviado inclui o briefing, as categorias, os preços e os orçamentos; nomes do casal, telefones dos fornecedores e lista de convidados não entram nesse contexto.

No GitHub Pages, as chamadas de IA e pesquisa saem diretamente do navegador para Gemini, DeepSeek e Tavily, usando as chaves informadas por cada pessoa. O site publicado não depende do servidor local. No modo local, as chamadas passam pelo servidor Node.js.

Chamadas reais dependem das chaves, das cotas e da disponibilidade dos provedores. Os testes de integração usam respostas simuladas.

## Verificar e distribuir

```sh
npm run check
npm test
npm run build
npm start
```

O build copia HTML, CSS e JavaScript para `dist/`. O servidor escuta em `127.0.0.1:5173`.

Para gerar a versão estática do GitHub Pages:

```sh
npm run build:pages
```

O conteúdo de `dist/` é publicado na raiz da branch `gh-pages`, configurada como origem do GitHub Pages. Esse build usa caminhos relativos e inclui `.nojekyll` para funcionar também em `/weeding-calculator/`.
