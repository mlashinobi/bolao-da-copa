import { isFirebaseConfigured, auth, db } from "./firebase-service.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const THEME_KEY = "bolaoCopaFirebase.theme";

const DEFAULT_MATCHES = [
  {
    teamA: "Brasil", teamB: "Argentina", flagA: "🇧🇷", flagB: "🇦🇷",
    kickoff: "2026-06-15T19:00", stage: "Fase de grupos", status: "live", minute: 37,
    scoreA: 1, scoreB: 1, scorers: ["Vini Jr.", "Lautaro Martínez"], penalty: false, redCard: false,
    events: [
      { minute: 12, text: "Gol do Brasil — Vini Jr." },
      { minute: 31, text: "Gol da Argentina — Lautaro Martínez" }
    ]
  },
  {
    teamA: "França", teamB: "Alemanha", flagA: "🇫🇷", flagB: "🇩🇪",
    kickoff: "2026-06-16T16:00", stage: "Fase de grupos", status: "upcoming", minute: 0,
    scoreA: null, scoreB: null, scorers: [], penalty: false, redCard: false, events: []
  },
  {
    teamA: "Espanha", teamB: "Portugal", flagA: "🇪🇸", flagB: "🇵🇹",
    kickoff: "2026-06-16T21:00", stage: "Fase de grupos", status: "upcoming", minute: 0,
    scoreA: null, scoreB: null, scorers: [], penalty: false, redCard: false, events: []
  },
  {
    teamA: "Inglaterra", teamB: "Itália", flagA: "🏴", flagB: "🇮🇹",
    kickoff: "2026-06-14T18:00", stage: "Fase de grupos", status: "finished", minute: 90,
    scoreA: 2, scoreB: 0, scorers: ["Bellingham", "Kane"], penalty: true, redCard: false,
    events: [
      { minute: 22, text: "Gol da Inglaterra — Bellingham" },
      { minute: 69, text: "Pênalti convertido — Kane" },
      { minute: 90, text: "Fim de jogo" }
    ]
  }
];

let state = {
  user: null,
  profile: null,
  users: [],
  matches: [],
  bets: [],
  loading: true,
  lastError: null
};
let currentView = "dashboard";
let unsubscribers = [];
let liveTimer = null;
let liveMode = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const uid = (prefix = "id") => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

function normalize(value = "") {
  return value.toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

function escapeAttr(value = "") { return escapeHtml(value).replace(/`/g, "&#096;"); }

function formatDate(value) {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function boolOptions(value) {
  return `
    <option value="true" ${value === true ? "selected" : ""}>Sim</option>
    <option value="false" ${value === false ? "selected" : ""}>Não</option>
  `;
}

function outcome(a, b) {
  if (a === b) return "draw";
  return a > b ? "A" : "B";
}

function statusLabel(status) {
  return { upcoming: "Aberto", live: "Ao vivo", finished: "Encerrado" }[status] || status;
}

function statusClass(status) {
  return { upcoming: "open", live: "live", finished: "done" }[status] || "locked";
}

function isAdmin() { return state.profile?.role === "admin"; }
function getUser(id) { return state.users.find(user => user.id === id); }
function getMatch(id) { return state.matches.find(match => match.id === id); }
function getUserBet(userId, matchId) { return state.bets.find(bet => bet.userId === userId && bet.matchId === matchId); }

function toast(message) {
  console.warn("Bolão Firebase:", message);
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(box.timeout);
  box.timeout = setTimeout(() => box.classList.remove("show"), 2800);
}

function setLastError(error, fallback = "Erro no Firebase.") {
  const message = typeof error === "string" ? error : firebaseErrorMessage(error) || fallback;
  state.lastError = message;
  console.error("Firebase diagnostic:", error);
  toast(message);
  renderCurrentView();
}

function renderErrorCard() {
  if (!state.lastError) return "";
  return `
    <div class="card" style="margin-bottom:18px; border-color: rgba(255,92,124,.45)">
      <span class="badge" style="color:#ffb5c3;border-color:rgba(255,92,124,.35);background:rgba(255,92,124,.12)">Erro detectado</span>
      <h3 style="margin-top:12px">O Firebase respondeu com erro</h3>
      <p><strong>${escapeHtml(state.lastError)}</strong></p>
      <p>Correções comuns: conferir se o arquivo firebase-config.js foi preenchido, ativar Email/Password, criar o Firestore, publicar as regras do arquivo firestore.rules e adicionar o domínio do GitHub Pages em Authorized domains.</p>
    </div>
  `;
}

function firebaseErrorMessage(error) {
  const code = error?.code || "";
  const map = {
    "auth/email-already-in-use": "Este email já está cadastrado.",
    "auth/invalid-email": "Email inválido.",
    "auth/weak-password": "Senha fraca. Use pelo menos 6 caracteres.",
    "auth/user-not-found": "Conta não encontrada.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "Email ou senha incorretos.",
    "auth/operation-not-allowed": "Ative Email/Password em Authentication > Sign-in method no Firebase.",
    "auth/unauthorized-domain": "Domínio não autorizado. Adicione seu domínio em Authentication > Settings > Authorized domains.",
    "auth/configuration-not-found": "Configuração do Authentication não encontrada. Confira o firebase-config.js e se o Authentication foi ativado.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "API key inválida. Confira o arquivo firebase-config.js.",
    "permission-denied": "Permissão negada. Confira as regras do Firestore e se sua conta é admin."
  };
  return map[code] || map[error?.message] || error?.message || "Erro inesperado.";
}

function calculatePoints(bet, match) {
  const breakdown = [];
  let points = 0;
  let exactScore = false;
  let winnerHit = false;
  let scorerHit = false;

  if (!match || match.status !== "finished") {
    return { points: 0, breakdown: [{ label: "Jogo ainda não encerrado", points: 0 }], exactScore, winnerHit, scorerHit };
  }

  const actualA = Number(match.scoreA);
  const actualB = Number(match.scoreB);
  const predA = Number(bet.scoreA);
  const predB = Number(bet.scoreB);
  const actualOutcome = outcome(actualA, actualB);
  const predOutcome = outcome(predA, predB);

  if (predA === actualA && predB === actualB) {
    points += 5;
    exactScore = true;
    winnerHit = true;
    breakdown.push({ label: "Placar exato", points: 5 });
  } else if (predOutcome === actualOutcome) {
    winnerHit = true;
    const actualDiff = Math.abs(actualA - actualB);
    const predDiff = Math.abs(predA - predB);
    if (actualOutcome !== "draw" && actualDiff === predDiff) {
      points += 3;
      breakdown.push({ label: "Vencedor + diferença", points: 3 });
    } else {
      points += 2;
      breakdown.push({ label: "Vencedor ou empate", points: 2 });
    }
  } else if (predA === actualA || predB === actualB) {
    points += 1;
    breakdown.push({ label: "Gols de um dos times", points: 1 });
  } else {
    breakdown.push({ label: "Placar", points: 0 });
  }

  if (bet.scorer) {
    const scorerFound = (match.scorers || []).some(scorer => normalize(scorer) === normalize(bet.scorer));
    if (scorerFound) {
      points += 2;
      scorerHit = true;
      breakdown.push({ label: "Jogador fez gol", points: 2 });
    } else breakdown.push({ label: "Jogador fez gol", points: 0 });
  }

  if (typeof bet.penalty === "boolean") {
    if (bet.penalty === Boolean(match.penalty)) { points += 2; breakdown.push({ label: "Pênalti", points: 2 }); }
    else breakdown.push({ label: "Pênalti", points: 0 });
  }

  if (typeof bet.redCard === "boolean") {
    if (bet.redCard === Boolean(match.redCard)) { points += 2; breakdown.push({ label: "Cartão vermelho", points: 2 }); }
    else breakdown.push({ label: "Cartão vermelho", points: 0 });
  }

  if (bet.totalGoals !== "" && bet.totalGoals !== null && bet.totalGoals !== undefined) {
    const totalActual = actualA + actualB;
    const diff = Math.abs(Number(bet.totalGoals) - totalActual);
    if (diff === 0) { points += 3; breakdown.push({ label: "Total de gols exato", points: 3 }); }
    else if (diff === 1) { points += 2; breakdown.push({ label: "Total por aproximação", points: 2 }); }
    else if (diff === 2) { points += 1; breakdown.push({ label: "Total por aproximação", points: 1 }); }
    else breakdown.push({ label: "Total de gols", points: 0 });
  }

  return { points, breakdown, exactScore, winnerHit, scorerHit };
}

function buildRanking() {
  return state.users
    .filter(user => user.role !== "admin")
    .map(user => {
      const userBets = state.bets.filter(bet => bet.userId === user.id);
      let points = 0;
      let exactScores = 0;
      let winners = 0;
      let scorers = 0;
      let played = 0;
      userBets.forEach(bet => {
        const match = getMatch(bet.matchId);
        if (match?.status === "finished") {
          played += 1;
          const result = calculatePoints(bet, match);
          points += result.points;
          if (result.exactScore) exactScores += 1;
          if (result.winnerHit) winners += 1;
          if (result.scorerHit) scorers += 1;
        }
      });
      return { ...user, points, exactScores, winners, scorers, played };
    })
    .sort((a, b) => b.points - a.points || b.exactScores - a.exactScores || b.winners - a.winners || b.scorers - a.scorers || a.name.localeCompare(b.name));
}

function showAppState() {
  const setupGate = $("#setupGate");
  const authGate = $("#authGate");
  const appContent = $("#appContent");
  const openAuthBtn = $("#openAuthBtn");
  const logoutBtn = $("#logoutBtn");

  if (!isFirebaseConfigured) {
    setupGate.classList.remove("hidden");
    authGate.classList.add("hidden");
    appContent.classList.add("hidden");
    openAuthBtn.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    return;
  }

  setupGate.classList.add("hidden");
  openAuthBtn.classList.remove("hidden");

  if (state.user) {
    authGate.classList.add("hidden");
    appContent.classList.remove("hidden");
    openAuthBtn.textContent = state.profile?.name || state.user.email;
    openAuthBtn.classList.add("ghost-btn");
    openAuthBtn.classList.remove("primary-btn");
    logoutBtn.classList.remove("hidden");
  } else {
    authGate.classList.remove("hidden");
    appContent.classList.add("hidden");
    openAuthBtn.textContent = "Entrar";
    openAuthBtn.classList.add("primary-btn");
    openAuthBtn.classList.remove("ghost-btn");
    logoutBtn.classList.add("hidden");
  }

  $$(".admin-only").forEach(item => item.classList.toggle("hidden", !isAdmin()));
}

function setView(view) {
  if (!state.user) return openAuthModal();
  if (view === "admin" && !isAdmin()) return toast("Apenas administradores podem acessar esta área.");
  currentView = view;
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach(item => item.classList.add("hidden"));
  $(`#view-${view}`).classList.remove("hidden");

  const titles = {
    dashboard: ["Início", "Resumo do bolão conectado ao Firebase."],
    betting: ["Apostar", "Apostas salvas no banco online."],
    live: ["Tempo real", "Atualizações em tempo real via Firestore."],
    finished: ["Encerrados", "Resultados finais e pontuação."],
    ranking: ["Ranking", "Classificação geral calculada com dados online."],
    rules: ["Regras", "Sistema de pontos usado pelo site."],
    admin: ["Painel admin", "Crie jogos, atualize placares e controle o tempo real."]
  };
  $("#pageTitle").textContent = titles[view][0];
  $("#pageSubtitle").textContent = titles[view][1];
  renderCurrentView();
  $("#sidebar").classList.remove("open");
}

function renderCurrentView() {
  showAppState();
  if (!state.user) return;
  if (state.loading) return renderLoading();
  if (currentView === "dashboard") renderDashboard();
  if (currentView === "betting") renderBetting();
  if (currentView === "live") renderLive();
  if (currentView === "finished") renderFinished();
  if (currentView === "ranking") renderRanking();
  if (currentView === "rules") renderRules();
  if (currentView === "admin") renderAdmin();
}

function renderLoading() {
  $("#view-dashboard").innerHTML = `<div class="card"><h3>Carregando dados do Firebase...</h3><p>Se demorar, confira as regras do Firestore e a configuração do projeto.</p></div>`;
}

function renderDashboard() {
  const view = $("#view-dashboard");
  const ranking = buildRanking();
  const upcoming = state.matches.filter(m => m.status === "upcoming").length;
  const live = state.matches.filter(m => m.status === "live").length;
  const finished = state.matches.filter(m => m.status === "finished").length;
  const myBets = state.bets.filter(b => b.userId === state.user.uid).length;
  const nextMatches = state.matches.filter(m => m.status !== "finished").slice(0, 3).map(renderMiniMatch).join("");

  view.innerHTML = `
    ${renderErrorCard()}
    <div class="grid grid-4">
      <div class="card stat"><span>Jogos abertos</span><strong>${upcoming}</strong><small>Disponíveis para aposta</small></div>
      <div class="card stat"><span>Ao vivo</span><strong>${live}</strong><small>Atualização pelo Firestore</small></div>
      <div class="card stat"><span>Encerrados</span><strong>${finished}</strong><small>Valendo ranking</small></div>
      <div class="card stat"><span>Minhas apostas</span><strong>${myBets}</strong><small>Salvas online</small></div>
    </div>

    <div class="grid grid-2" style="margin-top:18px">
      <div class="card">
        <div class="match-head">
          <h3>Jogos disponíveis</h3>
          <button class="secondary-btn" onclick="window.setView('betting')">Apostar</button>
        </div>
        <div class="grid">${nextMatches || `<p>Nenhum jogo aberto. O admin precisa cadastrar partidas.</p>`}</div>
      </div>
      <div class="card">
        <div class="match-head">
          <h3>Top ranking</h3>
          <button class="secondary-btn" onclick="window.setView('ranking')">Ver completo</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Jogador</th><th>Pontos</th><th>Exatos</th><th>Venc.</th></tr></thead>
            <tbody>${ranking.slice(0, 5).map((item, index) => `
              <tr>
                <td><div class="rank-pos ${index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : ""}">${index + 1}</div></td>
                <td><strong>${escapeHtml(item.name)}</strong><div class="meta">${item.played} jogos pontuados</div></td>
                <td><strong>${item.points}</strong> pts</td><td>${item.exactScores}</td><td>${item.winners}</td>
              </tr>`).join("") || `<tr><td colspan="5">Sem participantes ainda.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <span class="badge">Firebase ativo</span>
      <h3 style="margin-top:12px">Dados online e atualizados para todos</h3>
      <p>Quando o admin altera um jogo, todos os usuários logados recebem a atualização automaticamente pelo Firestore. O ranking é recalculado no navegador usando as apostas e os resultados oficiais cadastrados.</p>
    </div>
  `;
}

function renderMiniMatch(match) {
  const userBet = getUserBet(state.user.uid, match.id);
  return `
    <div class="card tight match-card">
      <div class="match-head">
        <div class="match-title">
          <div class="flag">${match.flagA || "🏳️"}</div>
          <div>
            <div class="teams">${escapeHtml(match.teamA)} x ${escapeHtml(match.teamB)}</div>
            <div class="meta">${escapeHtml(match.stage || "") } • ${formatDate(match.kickoff)}</div>
          </div>
        </div>
        <span class="status ${statusClass(match.status)}">${statusLabel(match.status)}</span>
      </div>
      <div class="score"><span>${match.scoreA ?? "-"}</span><small>x</small><span>${match.scoreB ?? "-"}</span></div>
      <div class="meta">${userBet ? `Sua aposta: ${userBet.scoreA} x ${userBet.scoreB}` : "Você ainda não apostou."}</div>
    </div>
  `;
}

function renderBetting() {
  const view = $("#view-betting");
  const openMatches = state.matches.filter(match => match.status !== "finished");
  view.innerHTML = `
    ${renderErrorCard()}
    <div class="grid grid-2">
      ${openMatches.map(renderBettingCard).join("") || `<div class="card"><h3>Nenhum jogo disponível</h3><p>O admin precisa cadastrar jogos ou mudar o status para aberto.</p></div>`}
    </div>
  `;
  $$(".bet-form").forEach(form => form.addEventListener("submit", handleBetSubmit));
}

function renderBettingCard(match) {
  const bet = getUserBet(state.user.uid, match.id);
  return `
    <div class="card match-card">
      <div class="match-head">
        <div class="match-title"><div class="flag">${match.flagA || "🏳️"}</div><div><div class="teams">${escapeHtml(match.teamA)} x ${escapeHtml(match.teamB)}</div><div class="meta">${escapeHtml(match.stage || "")} • ${formatDate(match.kickoff)}</div></div></div>
        <span class="status ${statusClass(match.status)}">${statusLabel(match.status)}</span>
      </div>
      <div class="score"><span>${match.scoreA ?? "-"}</span><small>x</small><span>${match.scoreB ?? "-"}</span></div>
      <div class="rule-item">
        <strong>Sistema de pontuação deste jogo</strong>
        <span>Placar exato: 5 pts • Vencedor + diferença: 3 pts • Só vencedor/empate: 2 pts • Gols de um time: 1 pt • Jogador fez gol: 2 pts • Pênalti: 2 pts • Vermelho: 2 pts • Total de gols: 3/2/1 por aproximação.</span>
      </div>
      <form class="bet-form" data-match-id="${match.id}">
        <div class="form-row"><div><label>Gols ${escapeHtml(match.teamA)}</label><input type="number" min="0" max="20" name="scoreA" value="${bet?.scoreA ?? ""}" required></div><div><label>Gols ${escapeHtml(match.teamB)}</label><input type="number" min="0" max="20" name="scoreB" value="${bet?.scoreB ?? ""}" required></div></div>
        <div class="form-row"><div><label>Jogador para fazer gol</label><input name="scorer" placeholder="Ex: Vini Jr." value="${escapeAttr(bet?.scorer ?? "")}"></div><div><label>Total de gols</label><input type="number" min="0" max="40" name="totalGoals" value="${bet?.totalGoals ?? ""}" required></div></div>
        <div class="form-row"><div><label>Vai ter pênalti?</label><select name="penalty">${boolOptions(bet?.penalty)}</select></div><div><label>Vai ter vermelho?</label><select name="redCard">${boolOptions(bet?.redCard)}</select></div></div>
        <button class="primary-btn full" type="submit">${bet ? "Atualizar aposta" : "Salvar aposta"}</button>
        ${bet ? `<div class="meta">Aposta salva online. Enquanto o jogo não for encerrado, você pode alterar.</div>` : ""}
      </form>
    </div>
  `;
}

async function handleBetSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const matchId = form.dataset.matchId;
  const match = getMatch(matchId);
  if (!match || match.status === "finished") return toast("Este jogo já está encerrado.");

  const data = new FormData(form);
  const betId = `${state.user.uid}_${matchId}`;
  const payload = {
    userId: state.user.uid,
    matchId,
    scoreA: Number(data.get("scoreA")),
    scoreB: Number(data.get("scoreB")),
    scorer: data.get("scorer").trim(),
    penalty: data.get("penalty") === "true",
    redCard: data.get("redCard") === "true",
    totalGoals: Number(data.get("totalGoals")),
    updatedAt: serverTimestamp()
  };

  try {
    const current = getUserBet(state.user.uid, matchId);
    if (!current) payload.createdAt = serverTimestamp();
    await setDoc(doc(db, "bets", betId), payload, { merge: true });
    toast("Aposta salva no Firebase.");
  } catch (error) {
    setLastError(error);
  }
}

function renderLive() {
  const view = $("#view-live");
  const liveMatches = state.matches.filter(match => match.status === "live");
  const upcoming = state.matches.filter(match => match.status === "upcoming");
  view.innerHTML = `
    ${renderErrorCard()}
    <div class="card" style="margin-bottom:18px">
      <div class="match-head">
        <div><span class="badge">Tempo real</span><h3 style="margin-top:12px">Firestore Realtime</h3><p>Quando o admin salva placar, minuto ou eventos, a mudança aparece em todos os dispositivos conectados.</p></div>
        ${isAdmin() ? `<button class="${liveMode ? "danger-btn" : "primary-btn"}" id="liveToggleBtn">${liveMode ? "Parar simulação admin" : "Simular tempo real"}</button>` : ""}
      </div>
    </div>
    <div class="grid grid-2">${liveMatches.map(renderLiveMatch).join("") || `<div class="card"><h3>Nenhum jogo ao vivo</h3><p>O admin precisa mudar um jogo para “Ao vivo”.</p></div>`}</div>
    <div class="card" style="margin-top:18px"><h3>Próximos jogos</h3><div class="grid grid-2">${upcoming.map(renderMiniMatch).join("") || `<p>Nenhum próximo jogo cadastrado.</p>`}</div></div>
  `;
  $("#liveToggleBtn")?.addEventListener("click", toggleLiveMode);
}

function renderLiveMatch(match) {
  const events = (match.events || []).slice().reverse().map(event => `<div class="event-line"><div class="event-dot"></div><div><strong>${event.minute}'</strong><span>${escapeHtml(event.text)}</span></div></div>`).join("") || `<p>Nenhum evento registrado ainda.</p>`;
  return `
    <div class="card match-card">
      <div class="match-head"><div class="match-title"><div class="flag">${match.flagA || "🏳️"}</div><div><div class="teams">${escapeHtml(match.teamA)} x ${escapeHtml(match.teamB)}</div><div class="meta">${escapeHtml(match.stage || "")} • ${match.minute || 0}' de jogo</div></div></div><span class="status live">Ao vivo</span></div>
      <div class="score"><span>${match.scoreA ?? 0}</span><small>x</small><span>${match.scoreB ?? 0}</span></div>
      <div class="timeline">${events}</div>
    </div>
  `;
}

async function toggleLiveMode() {
  if (!isAdmin()) return toast("Apenas admin pode simular tempo real.");
  liveMode = !liveMode;
  if (liveMode) {
    liveTimer = setInterval(simulateLiveTick, 5000);
    toast("Simulação admin ativada.");
  } else {
    clearInterval(liveTimer);
    toast("Simulação parada.");
  }
  renderLive();
}

async function simulateLiveTick() {
  const liveMatches = state.matches.filter(match => match.status === "live");
  if (!liveMatches.length) return toggleLiveMode();
  for (const match of liveMatches) {
    const next = { ...match };
    next.minute = Math.min(90, Number(next.minute || 0) + Math.floor(Math.random() * 6) + 2);
    if (next.scoreA === null || next.scoreA === undefined) next.scoreA = 0;
    if (next.scoreB === null || next.scoreB === undefined) next.scoreB = 0;
    const chance = Math.random();
    if (chance > 0.74 && next.minute < 90) {
      const teamA = Math.random() > 0.5;
      const scorer = teamA ? "Camisa 10" : "Centroavante";
      if (teamA) next.scoreA += 1; else next.scoreB += 1;
      next.scorers = [...(next.scorers || []), scorer];
      next.events = [...(next.events || []), { minute: next.minute, text: `Gol de ${teamA ? next.teamA : next.teamB} — ${scorer}` }];
    }
    if (next.minute >= 90) {
      next.minute = 90;
      next.status = "finished";
      next.events = [...(next.events || []), { minute: 90, text: "Fim de jogo" }];
    }
    await updateDoc(doc(db, "matches", match.id), sanitizeMatch(next));
  }
}

function renderFinished() {
  const view = $("#view-finished");
  const finished = state.matches.filter(match => match.status === "finished");
  view.innerHTML = `${renderErrorCard()}<div class="grid">${finished.map(renderFinishedMatch).join("") || `<div class="card"><h3>Ainda não há jogos encerrados</h3></div>`}</div>`;
}

function renderFinishedMatch(match) {
  const bets = state.bets.filter(bet => bet.matchId === match.id);
  return `
    <div class="card">
      <div class="match-head"><div class="match-title"><div class="flag">${match.flagA || "🏳️"}</div><div><div class="teams">${escapeHtml(match.teamA)} x ${escapeHtml(match.teamB)}</div><div class="meta">${escapeHtml(match.stage || "")} • ${formatDate(match.kickoff)}</div></div></div><span class="status done">Encerrado</span></div>
      <div class="score"><span>${match.scoreA}</span><small>x</small><span>${match.scoreB}</span></div>
      <p><strong>Gols:</strong> ${(match.scorers || []).length ? match.scorers.map(escapeHtml).join(", ") : "Sem gols registrados"}</p>
      <div class="table-wrap"><table><thead><tr><th>Jogador</th><th>Placar</th><th>Goleador</th><th>Pênalti</th><th>Vermelho</th><th>Pontos</th></tr></thead><tbody>
      ${bets.map(bet => {
        const user = getUser(bet.userId);
        const result = calculatePoints(bet, match);
        return `<tr><td><strong>${escapeHtml(user?.name || "Usuário")}</strong></td><td>${bet.scoreA} x ${bet.scoreB}</td><td>${escapeHtml(bet.scorer || "-")}</td><td>${bet.penalty ? "Sim" : "Não"}</td><td>${bet.redCard ? "Sim" : "Não"}</td><td><strong>${result.points} pts</strong><div class="meta">${result.breakdown.map(item => `${item.label}: ${item.points}`).join(" • ")}</div></td></tr>`;
      }).join("") || `<tr><td colspan="6">Ninguém apostou neste jogo.</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

function renderRanking() {
  const ranking = buildRanking();
  $("#view-ranking").innerHTML = `
    ${renderErrorCard()}
    <div class="card">
      <div class="match-head"><div><span class="badge">Classificação</span><h3 style="margin-top:12px">Ranking geral</h3></div><button class="secondary-btn" id="exportRankingBtn">Exportar ranking</button></div>
      <div class="table-wrap"><table><thead><tr><th>Posição</th><th>Participante</th><th>Pontos</th><th>Placares exatos</th><th>Vencedores</th><th>Goleadores</th><th>Jogos</th></tr></thead><tbody>
      ${ranking.map((item, index) => `<tr><td><div class="rank-pos ${index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : ""}">${index + 1}</div></td><td><strong>${escapeHtml(item.name)}</strong><div class="meta">${escapeHtml(item.email || "")}</div></td><td><strong>${item.points}</strong> pts</td><td>${item.exactScores}</td><td>${item.winners}</td><td>${item.scorers}</td><td>${item.played}</td></tr>`).join("") || `<tr><td colspan="7">Sem ranking ainda.</td></tr>`}
      </tbody></table></div>
    </div>
  `;
  $("#exportRankingBtn")?.addEventListener("click", exportRanking);
}

function renderRules() {
  $("#view-rules").innerHTML = `
    <div class="grid grid-2">
      <div class="card"><span class="badge">Placar</span><h3 style="margin-top:12px">Pontuação principal</h3><div class="rule-list"><div class="rule-item"><strong>5 pontos</strong><span>Placar exato.</span></div><div class="rule-item"><strong>3 pontos</strong><span>Vencedor e diferença de gols.</span></div><div class="rule-item"><strong>2 pontos</strong><span>Apenas vencedor ou empate.</span></div><div class="rule-item"><strong>1 ponto</strong><span>Gols de um dos times.</span></div><div class="rule-item"><strong>0 pontos</strong><span>Errou tudo.</span></div></div></div>
      <div class="card"><span class="badge">Extras</span><h3 style="margin-top:12px">Apostas extras</h3><div class="rule-list"><div class="rule-item"><strong>Jogador fez gol: 2 pontos</strong><span>Compara com os goleadores cadastrados pelo admin.</span></div><div class="rule-item"><strong>Pênalti: 2 pontos</strong><span>Acertou se teve ou não.</span></div><div class="rule-item"><strong>Vermelho: 2 pontos</strong><span>Acertou se teve ou não.</span></div><div class="rule-item"><strong>Total de gols: até 3 pontos</strong><span>Exato = 3, erro por 1 = 2, erro por 2 = 1.</span></div></div></div>
    </div>
  `;
}

function renderAdmin() {
  const view = $("#view-admin");
  if (!isAdmin()) return view.innerHTML = `<div class="card"><h3>Acesso negado</h3></div>`;
  view.innerHTML = `
    <div class="admin-grid">
      <div class="card">
        <div class="match-head"><div><span class="badge">Admin</span><h3 style="margin-top:12px">Editar jogos</h3></div><div class="admin-actions"><button class="secondary-btn" id="seedBtn">Criar jogos demo</button><button class="secondary-btn" id="exportBtn">Exportar dados</button></div></div>
        <div>${state.matches.map(renderAdminMatch).join("") || `<p>Nenhum jogo cadastrado. Use o formulário ao lado ou crie jogos demo.</p>`}</div>
      </div>
      <div class="card">
        <span class="badge">Novo jogo</span><h3 style="margin-top:12px">Cadastrar partida</h3>
        <form id="addMatchForm" class="bet-form">
          <div class="form-row"><div><label>Time A</label><input name="teamA" required></div><div><label>Time B</label><input name="teamB" required></div></div>
          <div class="form-row"><div><label>Bandeira A</label><input name="flagA" placeholder="🇧🇷"></div><div><label>Bandeira B</label><input name="flagB" placeholder="🇦🇷"></div></div>
          <div><label>Data e hora</label><input type="datetime-local" name="kickoff" required></div>
          <div><label>Fase</label><input name="stage" value="Fase de grupos"></div>
          <button class="primary-btn full" type="submit">Adicionar jogo</button>
        </form>
        <div class="rule-item" style="margin-top:18px"><strong>Para virar admin</strong><span>Crie sua conta, depois vá no Firestore e altere o documento em users/seuUID: role = admin.</span></div>
      </div>
    </div>
  `;
  $$(".admin-match-form").forEach(form => form.addEventListener("submit", handleAdminMatchUpdate));
  $$(".delete-match").forEach(btn => btn.addEventListener("click", handleDeleteMatch));
  $("#addMatchForm")?.addEventListener("submit", handleAddMatch);
  $("#seedBtn")?.addEventListener("click", seedDemoMatches);
  $("#exportBtn")?.addEventListener("click", exportData);
}

function renderAdminMatch(match) {
  return `
    <form class="admin-match admin-match-form" data-match-id="${match.id}">
      <div class="match-head"><strong>${match.flagA || "🏳️"} ${escapeHtml(match.teamA)} x ${escapeHtml(match.teamB)} ${match.flagB || "🏳️"}</strong><span class="status ${statusClass(match.status)}">${statusLabel(match.status)}</span></div>
      <div class="form-row three"><div><label>Status</label><select name="status"><option value="upcoming" ${match.status === "upcoming" ? "selected" : ""}>Aberto</option><option value="live" ${match.status === "live" ? "selected" : ""}>Ao vivo</option><option value="finished" ${match.status === "finished" ? "selected" : ""}>Encerrado</option></select></div><div><label>Gols ${escapeHtml(match.teamA)}</label><input type="number" min="0" name="scoreA" value="${match.scoreA ?? 0}"></div><div><label>Gols ${escapeHtml(match.teamB)}</label><input type="number" min="0" name="scoreB" value="${match.scoreB ?? 0}"></div></div>
      <div class="form-row"><div><label>Minuto</label><input type="number" min="0" max="130" name="minute" value="${match.minute ?? 0}"></div><div><label>Data</label><input type="datetime-local" name="kickoff" value="${match.kickoff || ""}"></div></div>
      <div><label>Goleadores, separados por vírgula</label><input name="scorers" value="${escapeAttr((match.scorers || []).join(", "))}"></div>
      <div class="form-row"><div><label>Teve pênalti?</label><select name="penalty">${boolOptions(Boolean(match.penalty))}</select></div><div><label>Teve vermelho?</label><select name="redCard">${boolOptions(Boolean(match.redCard))}</select></div></div>
      <div><label>Evento novo</label><input name="eventText" placeholder="Ex: Gol de Vini Jr."></div>
      <div class="admin-actions"><button class="primary-btn" type="submit">Salvar</button><button class="danger-btn delete-match" type="button" data-match-id="${match.id}">Excluir</button></div>
    </form>
  `;
}

function sanitizeMatch(match) {
  return {
    teamA: match.teamA,
    teamB: match.teamB,
    flagA: match.flagA || "🏳️",
    flagB: match.flagB || "🏳️",
    kickoff: match.kickoff || "",
    stage: match.stage || "Fase de grupos",
    status: match.status || "upcoming",
    minute: Number(match.minute || 0),
    scoreA: match.status === "upcoming" ? null : Number(match.scoreA || 0),
    scoreB: match.status === "upcoming" ? null : Number(match.scoreB || 0),
    scorers: Array.isArray(match.scorers) ? match.scorers : [],
    penalty: Boolean(match.penalty),
    redCard: Boolean(match.redCard),
    events: Array.isArray(match.events) ? match.events : [],
    updatedAt: serverTimestamp()
  };
}

async function handleAdminMatchUpdate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const match = getMatch(form.dataset.matchId);
  const data = new FormData(form);
  const updated = {
    ...match,
    status: data.get("status"),
    scoreA: Number(data.get("scoreA")),
    scoreB: Number(data.get("scoreB")),
    minute: Number(data.get("minute")),
    kickoff: data.get("kickoff"),
    scorers: data.get("scorers").split(",").map(item => item.trim()).filter(Boolean),
    penalty: data.get("penalty") === "true",
    redCard: data.get("redCard") === "true"
  };
  const eventText = data.get("eventText").trim();
  if (eventText) updated.events = [...(updated.events || []), { minute: updated.minute || 0, text: eventText }];

  try {
    await updateDoc(doc(db, "matches", match.id), sanitizeMatch(updated));
    toast("Jogo salvo no Firestore.");
  } catch (error) { setLastError(error); }
}

async function handleAddMatch(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const id = uid("match");
  const match = {
    teamA: data.get("teamA").trim(),
    teamB: data.get("teamB").trim(),
    flagA: data.get("flagA").trim() || "🏳️",
    flagB: data.get("flagB").trim() || "🏳️",
    kickoff: data.get("kickoff"),
    stage: data.get("stage").trim() || "Fase de grupos",
    status: "upcoming",
    minute: 0, scoreA: null, scoreB: null, scorers: [], penalty: false, redCard: false, events: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, "matches", id), match);
    toast("Jogo cadastrado no Firestore.");
    event.currentTarget.reset();
  } catch (error) { setLastError(error); }
}

async function handleDeleteMatch(event) {
  const matchId = event.currentTarget.dataset.matchId;
  if (!confirm("Excluir este jogo? As apostas ficam no banco, mas não pontuam sem o jogo.")) return;
  try {
    await deleteDoc(doc(db, "matches", matchId));
    toast("Jogo excluído.");
  } catch (error) { setLastError(error); }
}

async function seedDemoMatches() {
  if (!isAdmin()) return;
  if (!confirm("Criar jogos demo no seu Firestore?")) return;
  try {
    const batch = writeBatch(db);
    DEFAULT_MATCHES.forEach((match, index) => {
      const ref = doc(db, "matches", `demo-${index + 1}`);
      batch.set(ref, { ...match, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    });
    await batch.commit();
    toast("Jogos demo criados.");
  } catch (error) { setLastError(error); }
}

async function handleLogin(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    await signInWithEmailAndPassword(auth, data.get("email"), data.get("password"));
    closeAuthModal();
    toast("Login realizado.");
  } catch (error) { setLastError(error); }
}

async function handleRegister(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = data.get("name").trim();
  const email = data.get("email").trim();
  const password = data.get("password");
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await setDoc(doc(db, "users", credential.user.uid), {
      name,
      email,
      role: "player",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    closeAuthModal();
    toast("Conta criada com sucesso.");
  } catch (error) { setLastError(error); }
}

async function logout() {
  try { await signOut(auth); toast("Você saiu da conta."); }
  catch (error) { setLastError(error); }
}

function openAuthModal() {
  $("#authModal").classList.remove("hidden");
  $("#authModal").setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  $("#authModal").classList.add("hidden");
  $("#authModal").setAttribute("aria-hidden", "true");
}

function clearSubscriptions() {
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];
}

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || user.email?.split("@")[0] || "Jogador",
      email: user.email || "",
      role: "player",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { id: user.uid, name: user.displayName || "Jogador", email: user.email || "", role: "player" };
  }
  return { id: snap.id, ...snap.data() };
}

function subscribeData() {
  clearSubscriptions();
  state.loading = true;
  renderCurrentView();

  unsubscribers.push(onSnapshot(collection(db, "users"), snapshot => {
    state.users = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    const own = state.users.find(user => user.id === state.user?.uid);
    if (own) state.profile = own;
    state.loading = false;
    renderCurrentView();
  }, error => setLastError(error)));

  unsubscribers.push(onSnapshot(collection(db, "matches"), snapshot => {
    state.matches = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => String(a.kickoff || "").localeCompare(String(b.kickoff || "")));
    state.loading = false;
    renderCurrentView();
  }, error => setLastError(error)));

  unsubscribers.push(onSnapshot(collection(db, "bets"), snapshot => {
    state.bets = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    state.loading = false;
    renderCurrentView();
  }, error => setLastError(error)));
}

function exportData() {
  downloadFile("dados-bolao-copa-firebase.json", JSON.stringify({ users: state.users, matches: state.matches, bets: state.bets }, null, 2));
}

function exportRanking() {
  const ranking = buildRanking().map((item, index) => ({ posicao: index + 1, nome: item.name, pontos: item.points, placaresExatos: item.exactScores, vencedores: item.winners, goleadores: item.scorers, jogos: item.played }));
  downloadFile("ranking-bolao-copa.json", JSON.stringify(ranking, null, 2));
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function initTheme() {
  const theme = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.dataset.theme = theme;
  $("#themeBtn").textContent = theme === "dark" ? "🌙" : "☀️";
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  $("#themeBtn").textContent = next === "dark" ? "🌙" : "☀️";
}

function bindEvents() {
  $$(".nav-item").forEach(item => item.addEventListener("click", () => setView(item.dataset.view)));
  $("#openAuthBtn").addEventListener("click", openAuthModal);
  $("#heroAuthBtn").addEventListener("click", openAuthModal);
  $("#logoutBtn").addEventListener("click", logout);
  $("#menuBtn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#themeBtn").addEventListener("click", toggleTheme);
  $$("[data-close='auth']").forEach(item => item.addEventListener("click", closeAuthModal));
  $("#loginForm").addEventListener("submit", handleLogin);
  $("#registerForm").addEventListener("submit", handleRegister);
  $$("[data-auth-tab]").forEach(tab => tab.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach(item => item.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.authTab;
    $("#loginForm").classList.toggle("hidden", mode !== "login");
    $("#registerForm").classList.toggle("hidden", mode !== "register");
  }));
}

async function initAuth() {
  if (!isFirebaseConfigured) {
    showAppState();
    return;
  }
  onAuthStateChanged(auth, async user => {
    clearSubscriptions();
    state.user = user;
    state.profile = null;
    state.users = [];
    state.matches = [];
    state.bets = [];
    if (!user) {
      state.loading = false;
      showAppState();
      return;
    }
    try {
      state.profile = await ensureProfile(user);
      subscribeData();
      setView(currentView);
    } catch (error) {
      setLastError(error);
      state.loading = false;
      renderCurrentView();
    }
  });
}

window.addEventListener("error", event => {
  if (event?.message) setLastError(event.message);
});
window.addEventListener("unhandledrejection", event => {
  setLastError(event.reason || "Erro inesperado no Firebase.");
});

window.setView = setView;
initTheme();
bindEvents();
showAppState();
initAuth();
