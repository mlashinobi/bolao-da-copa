# Tutorial — Conectar o site ao Firebase

## 1. Criar o projeto no Firebase

1. Acesse https://console.firebase.google.com/
2. Clique em **Add project** ou **Adicionar projeto**.
3. Dê um nome, por exemplo: `bolao-copa`.
4. Pode desativar Google Analytics se quiser simplificar.
5. Conclua a criação.

## 2. Criar um app Web

1. Dentro do projeto, clique no ícone de Web: `</>`.
2. Dê um nome para o app, por exemplo: `bolao-web`.
3. Não precisa marcar Firebase Hosting se você for usar GitHub Pages.
4. Clique em **Register app**.
5. O Firebase vai mostrar um bloco `firebaseConfig`.
6. Copie somente o objeto de configuração.

Exemplo do formato que o Firebase mostra:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Agora abra o arquivo `firebase-config.js` do site e substitua os valores `COLE_AQUI` pelos valores do seu projeto.

## 3. Ativar login por email e senha

1. No menu lateral do Firebase, vá em **Build > Authentication**.
2. Clique em **Get started**.
3. Vá na aba **Sign-in method**.
4. Ative **Email/Password**.
5. Salve.

Sem isso, cadastro e login não funcionam.

## 4. Criar o banco Firestore

1. No menu lateral, vá em **Build > Firestore Database**.
2. Clique em **Create database**.
3. Escolha **Start in production mode**.
4. Escolha uma região. Pode usar uma região próxima ou a padrão sugerida.
5. Conclua.

## 5. Colar as regras de segurança

1. Dentro de **Firestore Database**, vá na aba **Rules**.
2. Apague as regras existentes.
3. Cole o conteúdo do arquivo `firestore.rules`.
4. Clique em **Publish**.

Essas regras fazem o seguinte:

- Usuário logado pode ler usuários, jogos e apostas.
- Cada usuário só pode criar/editar a própria aposta.
- Usuário comum não pode alterar placar, jogos ou resultado.
- Apenas admin pode criar, editar ou excluir jogos.
- Aposta não pode ser criada ou editada se o jogo estiver encerrado.

## 6. Subir o site no GitHub Pages

1. Crie um repositório no GitHub.
2. Envie todos os arquivos da pasta para a raiz do repositório.
3. Vá em **Settings > Pages**.
4. Em **Branch**, selecione `main` e `/root`.
5. Salve.
6. Aguarde o GitHub gerar o link.

## 7. Autorizar o domínio no Firebase

Depois que o GitHub Pages gerar o link:

1. Volte no Firebase.
2. Vá em **Authentication > Settings**.
3. Abra **Authorized domains**.
4. Adicione o domínio do GitHub Pages, por exemplo:

```txt
seuusuario.github.io
```

Sem isso, o login pode falhar no site publicado.

## 8. Criar sua conta admin

1. Abra o site publicado.
2. Crie uma conta normal com seu email.
3. Volte ao Firebase.
4. Vá em **Firestore Database > Data**.
5. Abra a coleção `users`.
6. Clique no documento do seu usuário.
7. Altere o campo:

```txt
role: "player"
```

para:

```txt
role: "admin"
```

8. Atualize a página do site.
9. O menu **Admin** vai aparecer.

## 9. Criar jogos

Com sua conta admin:

1. Entre no site.
2. Vá em **Admin**.
3. Clique em **Criar jogos demo** ou cadastre jogos manualmente.
4. Coloque status `Aberto`, `Ao vivo` ou `Encerrado`.
5. Salve.

## 10. Como o tempo real funciona

O site usa listeners do Firestore. Quando o admin muda placar, minuto, evento ou status de jogo, todos os usuários logados recebem a atualização automaticamente.

A simulação de tempo real é apenas para teste. Para resultados reais da Copa automaticamente, o certo é criar um backend ou Cloud Function que consulte uma API de futebol e atualize a coleção `matches`.

## 11. Problemas comuns

### O site mostra “Configuração necessária”

O arquivo `firebase-config.js` ainda tem valores `COLE_AQUI`.

### Cadastro não funciona

Ative **Authentication > Sign-in method > Email/Password**.

### Aparece “permission denied”

Confira se você publicou as regras do arquivo `firestore.rules`. Se estiver tentando usar o Admin, confira se seu documento em `users` tem `role: "admin"`.

### O login funciona localmente, mas não no GitHub Pages

Adicione `seuusuario.github.io` em **Authentication > Settings > Authorized domains**.

### Abri o arquivo direto no PC e deu erro de módulo

Teste pelo GitHub Pages ou usando uma extensão como Live Server no VS Code. Navegadores podem bloquear importações de módulo quando o arquivo é aberto direto por `file://`.

## 12. Diagnóstico rápido

Nesta versão existe um arquivo chamado `debug.html`.

Depois de subir no GitHub Pages, abra:

```txt
https://seuusuario.github.io/seurepositorio/debug.html
```

Clique em **Rodar diagnóstico**.

Ele testa:

- se o `firebase-config.js` foi preenchido;
- se o Firebase inicializou;
- se o Auth está acessível;
- se o Firestore responde;
- se as regras estão bloqueando alguma leitura.

## 13. Sistema de apostas implementado

O formulário de aposta segue o sistema combinado:

- placar exato;
- vencedor/empate calculado automaticamente pelo placar;
- jogador para fazer gol;
- pênalti sim/não;
- cartão vermelho sim/não;
- total de gols separado do placar.

A pontuação usada pelo site é:

- placar exato: 5 pontos;
- vencedor + diferença de gols: 3 pontos;
- apenas vencedor ou empate: 2 pontos;
- acertou gols de um dos times: 1 ponto;
- jogador fez gol: 2 pontos;
- pênalti: 2 pontos;
- cartão vermelho: 2 pontos;
- total de gols exato: 3 pontos;
- total de gols com erro de 1: 2 pontos;
- total de gols com erro de 2: 1 ponto.

Importante: o total de gols é uma categoria separada. O site não usa automaticamente o total do placar como aposta de total de gols.
