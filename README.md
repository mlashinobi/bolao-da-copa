# Bolão da Copa — Firebase V3 Diagnóstico

Esta versão mostra “V3 Diagnóstico” no menu lateral. Se isso não aparecer no site publicado, o problema é deploy/cache: o GitHub Pages está carregando arquivos antigos.

Use `debug.html` para testar Firebase.

# Bolão da Copa — Versão Firebase Real

Esta versão não usa mais `localStorage` para os dados principais. Ela usa:

- Firebase Authentication para cadastro/login real
- Cloud Firestore para usuários, jogos e apostas
- Firestore realtime listeners para atualizar ranking, jogos e tempo real em todos os dispositivos
- GitHub Pages para hospedagem estática

## Arquivos principais

- `index.html`: estrutura do site
- `styles.css`: visual do site
- `app.js`: lógica do bolão com Firebase
- `firebase-config.js`: onde você cola a configuração do seu Firebase
- `firebase-service.js`: inicialização do Firebase
- `firestore.rules`: regras de segurança para colar no Firebase
- `TUTORIAL_FIREBASE.md`: passo a passo completo

## Coleções usadas no Firestore

### users/{uid}

Campos:

- `name`
- `email`
- `role`: `player` ou `admin`
- `createdAt`
- `updatedAt`

### matches/{matchId}

Campos:

- `teamA`, `teamB`
- `flagA`, `flagB`
- `kickoff`
- `stage`
- `status`: `upcoming`, `live`, `finished`
- `minute`
- `scoreA`, `scoreB`
- `scorers`
- `penalty`
- `redCard`
- `events`

### bets/{uid_matchId}

Campos:

- `userId`
- `matchId`
- `scoreA`, `scoreB`
- `scorer`
- `penalty`
- `redCard`
- `totalGoals`
- `createdAt`
- `updatedAt`

## Atenção

O Firebase config do app Web não é uma senha secreta. Ele pode ficar no front-end. A proteção real fica nas regras do Firestore.

Para o primeiro administrador, crie uma conta normalmente no site e depois altere o campo `role` do seu documento em `users/{seuUID}` para `admin` no console do Firebase.
