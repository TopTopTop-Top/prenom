import {
  clearContextPanel,
  showDepartmentGeoContext,
  showRegionGeoContext,
  showTimelineChart,
} from "./context-visual.js";

const dataUrl = "./data/game-data.json";

const state = {
  players: [],
  currentPlayerIndex: 0,
  currentRound: 0,
  targetScore: 15,
  difficulty: "normal",
  data: null,
  currentChallenge: null,
  nationalTotalBirths: 1,
  comboStreaks: {},
  questionStats: {},
  currentQuestionType: null,
};

const playersInput = document.getElementById("players");
const targetScoreInput = document.getElementById("targetScore");
const difficultyInput = document.getElementById("difficulty");
const startBtn = document.getElementById("startBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const gameSection = document.getElementById("gameSection");
const roundTitle = document.getElementById("roundTitle");
const roundDescription = document.getElementById("roundDescription");
const answerArea = document.getElementById("answerArea");
const feedback = document.getElementById("feedback");
const scoreBoard = document.getElementById("scoreBoard");
const progressBar = document.getElementById("progressBar");
const turnPill = document.getElementById("turnPill");

let audioContext = null;

function initAudio() {
  if (!audioContext) {
    audioContext = new window.AudioContext();
  }
}

function playTone({
  frequency = 440,
  duration = 0.12,
  type = "sine",
  volume = 0.03,
}) {
  if (!audioContext) return;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(audioContext.destination);
  const now = audioContext.currentTime;
  osc.start(now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.stop(now + duration);
}

function playGoodSound() {
  playTone({ frequency: 620, duration: 0.1, type: "triangle", volume: 0.03 });
  setTimeout(
    () =>
      playTone({
        frequency: 920,
        duration: 0.12,
        type: "triangle",
        volume: 0.03,
      }),
    100
  );
}

function playBadSound() {
  playTone({ frequency: 280, duration: 0.12, type: "sawtooth", volume: 0.03 });
}

function playClickSound() {
  playTone({ frequency: 420, duration: 0.05, type: "square", volume: 0.015 });
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function pickRandom(array) {
  return array[randomInt(array.length)];
}

function pickTwoDistinct(array) {
  const a = pickRandom(array);
  let b = pickRandom(array);
  while (b.prenom === a.prenom) {
    b = pickRandom(array);
  }
  return [a, b];
}

function resolveDifficulty() {
  if (state.difficulty === "mixed") {
    return pickRandom(["easy", "normal", "hard"]);
  }
  return state.difficulty;
}

/** Fenêtres pour le duel : plus courtes en difficile, plus longues en facile. */
function yearWindow(resolvedDifficulty) {
  const d = resolvedDifficulty ?? resolveDifficulty();
  const wide = [
    [1900, 1950],
    [1951, 1980],
    [1981, 2000],
    [2011, 2024],
  ];
  const narrow = [
    [2018, 2024],
    [2015, 2019],
    [2010, 2014],
    [2005, 2009],
    [2000, 2004],
    [1995, 1999],
  ];
  const all = [
    [1900, 1950],
    [1951, 1980],
    [1981, 2000],
    [2001, 2010],
    [2011, 2024],
  ];
  if (d === "easy") {
    return pickRandom(wide);
  }
  if (d === "hard") {
    return pickRandom(narrow);
  }
  return pickRandom(all);
}

/**
 * 4 années dont le pic — écart des propositions selon le niveau.
 */
function pickPeakYearChoices(peakYear, resolvedDifficulty) {
  const d = resolvedDifficulty ?? resolveDifficulty();
  const choices = new Set([peakYear]);
  const minGapOther = d === "easy" ? 20 : d === "hard" ? 0 : 10;
  let safety = 0;
  while (choices.size < 4 && safety < 600) {
    safety += 1;
    let y;
    if (d === "easy") {
      const sign = randomInt(2) ? 1 : -1;
      y = peakYear + sign * (20 + randomInt(75));
    } else if (d === "hard") {
      y = peakYear + randomInt(11) - 5;
    } else {
      y = peakYear + randomInt(35) - 17;
    }
    if (y < 1900 || y > 2024 || y === peakYear) {
      continue;
    }
    if (minGapOther > 0 && Math.abs(y - peakYear) < minGapOther) {
      continue;
    }
    choices.add(y);
  }
  while (choices.size < 4) {
    const y = 1900 + randomInt(125);
    if (y !== peakYear) {
      choices.add(y);
    }
  }
  return [...choices].sort(() => Math.random() - 0.5);
}

function sumRange(yearly, start, end) {
  let sum = 0;
  for (let y = start; y <= end; y += 1) {
    sum += yearly[String(y)] || 0;
  }
  return sum;
}

function getGenderTagFromSexTotals(sexTotals) {
  const m = sexTotals?.["1"] || 0;
  const f = sexTotals?.["2"] || 0;
  if (m > 0 && f > 0) return "♂️♀️";
  if (m > 0) return "♂️";
  if (f > 0) return "♀️";
  return "❓";
}

function displayName(name, sexTotals) {
  return `${name} ${getGenderTagFromSexTotals(sexTotals)}`;
}

/** Effectifs INSEE (déjà arrondis au multiple de 5 dans la source). */
function formatCount(n) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

function formatNameStats(options, scopeLabel = "") {
  return [...options]
    .sort((a, b) => b.value - a.value)
    .map(
      (o) =>
        `${displayName(o.name, o.sexTotals)}: ${formatCount(o.value)}${
          scopeLabel ? ` (${scopeLabel})` : ""
        }`
    )
    .join(" | ");
}

function getNationalTotalBirths() {
  return state.data?.names?.reduce((sum, n) => sum + (n.total || 0), 0) || 1;
}

/**
 * Score de spécificité locale d'un prénom :
 * (part du prénom dans le territoire) / (part du prénom en France),
 * modulé par sqrt(volume local) pour éviter le bruit des petits effectifs.
 */
function buildTerritorySpecificityRanking(territory, minLocalValue = 80) {
  const nationalTotal = state.nationalTotalBirths || getNationalTotalBirths();
  const epsilon = 1e-12;
  const ranked = territory.topNames
    .filter((x) => (x.value || 0) >= minLocalValue)
    .map((x) => {
      const nationalNameTotal = findNameEntry(x.name)?.total || 0;
      const localShare = territory.total > 0 ? x.value / territory.total : 0;
      const nationalShare =
        nationalTotal > 0 ? nationalNameTotal / nationalTotal : 0;
      const lift = (localShare + epsilon) / (nationalShare + epsilon);
      const score = Math.log2(lift) * Math.sqrt(x.value);
      return {
        ...x,
        lift,
        score,
      };
    })
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score);
  return ranked;
}

function buildTerritoryQuestionOptions(territory, minLocalValue = 80) {
  const ranked = buildTerritorySpecificityRanking(territory, minLocalValue);
  const answer = territory.topNames[0] || ranked[0];
  if (!answer) return { answer: null, options: [] };

  const distractorBase = ranked
    .filter((x) => x.name !== answer.name)
    .sort(
      (a, b) =>
        Math.abs(a.score - answer.score) - Math.abs(b.score - answer.score)
    );

  const options = [answer];
  for (const candidate of distractorBase) {
    if (options.length >= 4) break;
    if (!options.some((o) => o.name === candidate.name)) {
      options.push(candidate);
    }
  }

  const fallback = territory.topNames
    .filter((x) => x.name !== answer.name)
    .sort((a, b) => b.value - a.value);
  for (const candidate of fallback) {
    if (options.length >= 4) break;
    if (!options.some((o) => o.name === candidate.name)) {
      options.push(candidate);
    }
  }

  options.sort(() => Math.random() - 0.5);
  return { answer, options };
}

function hasTerritoryYearlyData(territory) {
  return (territory?.topNames || []).some(
    (x) => x.yearly && Object.keys(x.yearly).length > 0
  );
}

function territoryNameValueForRange(nameEntry, start, end) {
  if (nameEntry?.yearly && Object.keys(nameEntry.yearly).length > 0) {
    return sumRange(nameEntry.yearly, start, end);
  }
  return 0;
}

function pickYearOrPeriod() {
  const isSingleYear = randomInt(2) === 0;
  if (isSingleYear) {
    const year = 1950 + randomInt(2024 - 1950 + 1);
    return { start: year, end: year };
  }
  const periods = [
    [1900, 1949],
    [1950, 1979],
    [1980, 1999],
    [1990, 2000],
    [2000, 2014],
    [2015, 2024],
  ];
  const [start, end] = pickRandom(periods);
  return { start, end };
}

/** Phrase de date en fin d’énoncé : « en 1985 » ou « sur la période de 1990 à 2000 ». */
function territoryDatePhraseAtEnd(start, end) {
  if (start === end) return `en ${start}`;
  return `sur la période de ${start} à ${end}`;
}

/** Feedback après point : « En 1985 » / « Sur la période de … ». */
function territoryTimeClauseFeedback(start, end) {
  if (start === end) return `En ${start}`;
  return `Sur la période de ${start} à ${end}`;
}

function formatTerritoryRangeStats(options, start, end) {
  return [...options]
    .sort((a, b) => b.rangeValue - a.rangeValue)
    .map(
      (o) =>
        `${displayName(o.name, o.sexTotals)}: ${formatCount(o.rangeValue)} (${
          start === end ? `année ${start}` : `${start}-${end}`
        })`
    )
    .join(" | ");
}

function buildTerritoryRangeQuestionOptions(
  territory,
  start,
  end,
  minRangeValue
) {
  const candidates = (territory.topNames || [])
    .map((x) => ({
      ...x,
      rangeValue: territoryNameValueForRange(x, start, end),
    }))
    .filter((x) => x.rangeValue >= minRangeValue)
    .sort((a, b) => b.rangeValue - a.rangeValue);

  if (candidates.length < 4) return { answer: null, options: [] };
  const answer = candidates[0];
  const options = [answer];
  const pool = candidates.slice(1, 14);
  while (options.length < 4 && pool.length > 0) {
    const candidate = pickRandom(pool);
    if (!options.some((o) => o.name === candidate.name)) {
      options.push(candidate);
    }
  }
  if (options.length < 4) return { answer: null, options: [] };
  options.sort(() => Math.random() - 0.5);
  return { answer, options };
}

function buildTerritoryRankingOptions(territory, start, end, minRangeValue) {
  const candidates = (territory.topNames || [])
    .map((x) => ({
      ...x,
      rangeValue: territoryNameValueForRange(x, start, end),
    }))
    .filter((x) => x.rangeValue >= minRangeValue)
    .sort((a, b) => b.rangeValue - a.rangeValue);

  if (candidates.length < 8) return null;
  const pool = candidates.slice(0, 14);
  let selected = [];
  let safety = 0;
  while (safety < 40) {
    safety += 1;
    selected = [];
    while (selected.length < 4) {
      const candidate = pickRandom(pool);
      if (!selected.some((x) => x.name === candidate.name)) {
        selected.push(candidate);
      }
    }
    const uniqueValues = new Set(selected.map((x) => x.rangeValue));
    if (uniqueValues.size === 4) {
      return {
        options: selected.sort(() => Math.random() - 0.5),
        correctOrder: [...selected].sort((a, b) => b.rangeValue - a.rangeValue),
      };
    }
  }
  return null;
}

function pickTopNameOfYear(year) {
  let best = null;
  for (const n of state.data.names) {
    const value = n.yearly?.[String(year)] || 0;
    if (!best || value > best.value) {
      best = { name: n.prenom, value, sexTotals: n.sexTotals };
    }
  }
  return best;
}

function findNameEntry(prenom) {
  return state.data?.names?.find((x) => x.prenom === prenom) ?? null;
}

function timelineSeriesFromPrenoms(prenoms, labels) {
  const colors = ["#7f8cff", "#39d8ff", "#20d18f", "#ffe27b"];
  return prenoms.map((p, i) => {
    const entry = findNameEntry(p);
    return {
      label: labels[i] || p,
      color: colors[i % colors.length],
      yearly: entry?.yearly || {},
    };
  });
}

function scoreFor(playerName, delta) {
  const p = state.players.find((x) => x.name === playerName);
  p.score += delta;
}

function registerQuestionType(typeKey) {
  state.currentQuestionType = typeKey;
  if (!state.questionStats[typeKey]) {
    state.questionStats[typeKey] = { attempts: 0, correct: 0 };
  }
}

function recordQuestionResult(typeKey, isCorrect) {
  if (!typeKey) return;
  registerQuestionType(typeKey);
  state.questionStats[typeKey].attempts += 1;
  if (isCorrect) state.questionStats[typeKey].correct += 1;
}

function addPointsWithCombo(playerName, basePoints) {
  scoreFor(playerName, basePoints);
  const previousStreak = state.comboStreaks[playerName] || 0;
  const newStreak = previousStreak + 1;
  state.comboStreaks[playerName] = newStreak;
  if (newStreak >= 3) {
    scoreFor(playerName, 1);
    return { streak: newStreak, comboBonus: 1 };
  }
  return { streak: newStreak, comboBonus: 0 };
}

function breakCombo(playerName) {
  state.comboStreaks[playerName] = 0;
}

function comboText(comboBonus, streak) {
  if (!comboBonus) return "";
  return ` Bonus combo +${comboBonus} (série ${streak}).`;
}

function questionStatsSummaryText() {
  const labels = {
    duel_pop: "Duel popularite",
    peak_year: "Annee de pic",
    vote_collectif: "Vote collectif",
    region_total: "Region (cumul)",
    department_total: "Departement (cumul)",
    region_period: "Region (periode)",
    department_period: "Departement (periode)",
    top_name_year: "Top prenom par annee",
    ranking_4: "Classement 4 prenoms",
  };
  const entries = Object.entries(state.questionStats);
  if (entries.length === 0) return "Pas de stats detaillees.";
  return entries
    .sort(([a], [b]) => (labels[a] || a).localeCompare(labels[b] || b, "fr"))
    .map(([key, stat]) => {
      const attempts = stat.attempts || 0;
      const correct = stat.correct || 0;
      const pct = attempts > 0 ? Math.round((correct / attempts) * 100) : 0;
      return `${labels[key] || key}: ${correct}/${attempts} (${pct}%)`;
    })
    .join(" | ");
}

function renderScores() {
  scoreBoard.innerHTML = "";
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  sorted.forEach((p, index) => {
    const rank = index + 1;
    const medal =
      rank === 1 ? "👑" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "•";
    const li = document.createElement("li");
    li.innerHTML = `<span>${medal} ${p.name}</span><strong>${p.score} pts</strong>`;
    scoreBoard.appendChild(li);
  });
}

function updateProgress() {
  const best = Math.max(...state.players.map((p) => p.score), 0);
  const pct = Math.min(100, Math.round((best / state.targetScore) * 100));
  progressBar.style.width = `${pct}%`;
}

function checkWinner() {
  const winner = state.players.find((p) => p.score >= state.targetScore);
  if (!winner) return null;
  return winner;
}

/** Si un joueur atteint l’objectif : fin de partie et retour à l’écran paramètres. */
function endGameIfWinner() {
  const winner = checkWinner();
  if (!winner) return false;
  playGoodSound();
  const statsSummary = questionStatsSummaryText();
  alert(
    `${winner.name} gagne la partie avec ${winner.score} points (objectif ${state.targetScore}).\nStats par type: ${statsSummary}`
  );
  state.currentChallenge = null;
  clearChallengeUi();
  nextRoundBtn.disabled = true;
  gameSection.classList.add("hidden");
  return true;
}

function clearChallengeUi() {
  clearContextPanel();
  answerArea.innerHTML = "";
  feedback.textContent = "";
  feedback.className = "feedback";
  answerArea.className = "answer-grid";
}

function setFeedback(text, kind = "ok") {
  feedback.textContent = text;
  feedback.className = `feedback ${kind}`;
}

function createAnswerButton(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "answer-btn";
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

function lockAnswers() {
  const buttons = answerArea.querySelectorAll("button");
  buttons.forEach((b) => {
    b.disabled = true;
  });
}

/**
 * Après une réponse : graphique optionnel puis libère la manche (toujours, même si le graphique plante).
 */
function endChallengeRound(chartFn, afterRelease) {
  if (endGameIfWinner()) return;
  try {
    if (chartFn) chartFn();
  } catch (err) {
    console.error(err);
  } finally {
    state.currentChallenge = null;
    if (afterRelease) afterRelease();
  }
}

function askDuelPopularity(player) {
  registerQuestionType("duel_pop");
  const [a, b] = pickTwoDistinct(state.data.names);
  const duelDiff = resolveDifficulty();
  const [start, end] = yearWindow(duelDiff);
  const duelLabel =
    duelDiff === "easy"
      ? "facile"
      : duelDiff === "hard"
      ? "difficile"
      : "normal";
  const sumA = sumRange(a.yearly, start, end);
  const sumB = sumRange(b.yearly, start, end);

  if (sumA === sumB) {
    return askDuelPopularity(player);
  }

  const winner = sumA > sumB ? a.prenom : b.prenom;
  const winEntry = sumA > sumB ? a : b;
  roundDescription.textContent = `${player.name}, lequel a été le plus donné entre ${start} et ${end} ? (manche ${duelLabel})`;

  [
    { label: displayName(a.prenom, a.sexTotals), value: a.prenom },
    { label: displayName(b.prenom, b.sexTotals), value: b.prenom },
  ].forEach((opt) => {
    const btn = createAnswerButton(opt.label, () => {
      lockAnswers();
      if (opt.value === winner) {
        const combo = addPointsWithCombo(player.name, 2);
        recordQuestionResult("duel_pop", true);
        btn.classList.add("correct");
        playGoodSound();
        setFeedback(
          `Bien joue ! +2 pts. ${displayName(
            a.prenom,
            a.sexTotals
          )} ${formatCount(sumA)} — ${displayName(
            b.prenom,
            b.sexTotals
          )} ${formatCount(sumB)} (${start}-${end}, France).${comboText(
            combo.comboBonus,
            combo.streak
          )}`,
          "ok"
        );
      } else {
        breakCombo(player.name);
        recordQuestionResult("duel_pop", false);
        btn.classList.add("wrong");
        playBadSound();
        setFeedback(
          `Rate. Gagnant : ${displayName(
            winEntry.prenom,
            winEntry.sexTotals
          )}. ${displayName(a.prenom, a.sexTotals)} ${formatCount(
            sumA
          )} — ${displayName(b.prenom, b.sexTotals)} ${formatCount(
            sumB
          )} (${start}-${end}).`,
          "bad"
        );
        answerArea.querySelectorAll("button").forEach((b) => {
          if (b.textContent.startsWith(`${winner} `))
            b.classList.add("correct");
        });
      }
      renderScores();
      updateProgress();
      endChallengeRound(() =>
        showTimelineChart({
          series: [
            {
              label: displayName(a.prenom, a.sexTotals),
              color: "#7f8cff",
              yearly: a.yearly,
            },
            {
              label: displayName(b.prenom, b.sexTotals),
              color: "#39d8ff",
              yearly: b.yearly,
            },
          ],
          highlights: [
            {
              from: start,
              to: end,
              fill: "rgba(255, 226, 123, 0.22)",
              label: `Période de la question (${start}–${end})`,
            },
          ],
          caption: `Naissances par an en France (1900–2024) — surbrillance : la période du duel`,
        })
      );
    });
    answerArea.appendChild(btn);
  });
}

function askPeakYear(player) {
  registerQuestionType("peak_year");
  const n = pickRandom(state.data.names);
  const roundDiff = resolveDifficulty();
  const choices = pickPeakYearChoices(n.peak.year, roundDiff);
  const choiceStats = choices
    .map((y) => ({ year: y, value: n.yearly[String(y)] || 0 }))
    .sort((a, b) => b.value - a.value);
  const statsText = choiceStats
    .map((s) => `${s.year}: ${formatCount(s.value)}`)
    .join(" | ");
  const diffLabel =
    roundDiff === "easy"
      ? "facile"
      : roundDiff === "hard"
      ? "difficile"
      : "normal";
  roundDescription.textContent = `${player.name}, en quelle année ${displayName(
    n.prenom,
    n.sexTotals
  )} a atteint son pic ? (manche ${diffLabel})`;

  const choiceMin = Math.min(...choices);
  const choiceMax = Math.max(...choices);

  choices.forEach((year) => {
    const btn = createAnswerButton(String(year), () => {
      lockAnswers();
      if (year === n.peak.year) {
        const combo = addPointsWithCombo(player.name, 3);
        recordQuestionResult("peak_year", true);
        btn.classList.add("correct");
        playGoodSound();
        setFeedback(
          `Exact ! +3 pts. Pic en ${n.peak.year} : ${formatCount(
            n.peak.value
          )} naissances cette année-là (France). Comparatif des propositions : ${statsText}.${comboText(
            combo.comboBonus,
            combo.streak
          )}`,
          "ok"
        );
      } else if (Math.abs(year - n.peak.year) <= 1) {
        const combo = addPointsWithCombo(player.name, 1);
        recordQuestionResult("peak_year", true);
        btn.classList.add("correct");
        playTone({
          frequency: 680,
          duration: 0.08,
          type: "triangle",
          volume: 0.02,
        });
        setFeedback(
          `Presque (+1). Pic en ${n.peak.year} : ${formatCount(
            n.peak.value
          )} naissances. Comparatif des propositions : ${statsText}.${comboText(
            combo.comboBonus,
            combo.streak
          )}`,
          "ok"
        );
      } else {
        breakCombo(player.name);
        recordQuestionResult("peak_year", false);
        btn.classList.add("wrong");
        playBadSound();
        setFeedback(
          `Pic en ${n.peak.year} : ${formatCount(
            n.peak.value
          )} naissances cette année-là. Comparatif des propositions : ${statsText}.`,
          "bad"
        );
        answerArea.querySelectorAll("button").forEach((b) => {
          if (Number.parseInt(b.textContent, 10) === n.peak.year)
            b.classList.add("correct");
        });
      }
      renderScores();
      updateProgress();
      endChallengeRound(() =>
        showTimelineChart({
          series: [
            {
              label: displayName(n.prenom, n.sexTotals),
              color: "#7f8cff",
              yearly: n.yearly,
            },
          ],
          highlights: [
            {
              from: choiceMin,
              to: choiceMax,
              fill: "rgba(127, 140, 255, 0.2)",
              label: `Années proposées (${choiceMin}–${choiceMax})`,
            },
          ],
          markYears: choices.map((y) => ({
            year: y,
            color: "rgba(255, 226, 123, 0.9)",
            width: 2,
          })),
          caption: `Historique national du prénom — bande et traits : années proposées ; pic réel en ${n.peak.year}`,
        })
      );
    });
    answerArea.appendChild(btn);
  });
}

function askYoungAdultOldVote() {
  registerQuestionType("vote_collectif");
  const n = pickRandom(state.data.names);
  roundDescription.textContent = `Vote collectif sur ${displayName(
    n.prenom,
    n.sexTotals
  )} : coche enfant, adulte et/ou personne âgée (1 à 3 cases). +1 pt seulement si au moins 2 joueurs ont exactement la même combinaison.`;

  const categories = ["Enfant", "Adulte", "Personne âgée"];
  /** @type {Map<string, Set<string>>} */
  const votes = new Map();
  state.players.forEach((p) => votes.set(p.name, new Set()));
  let pendingPlayerIndex = state.currentPlayerIndex;
  let votesSubmitted = 0;
  answerArea.className = "answer-grid vote-mode";

  function renderVotingForCurrentPlayer() {
    answerArea.innerHTML = "";
    const current = state.players[pendingPlayerIndex];
    roundTitle.textContent = `Manche ${state.currentRound} - Tour de ${current.name}`;
    setFeedback(`Tour de ${current.name} — coche au moins une case`, "ok");

    const selected = new Set(votes.get(current.name));

    categories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "answer-btn vote-toggle";
      btn.textContent = cat;
      if (selected.has(cat)) {
        btn.classList.add("selected");
      }
      btn.onclick = () => {
        playClickSound();
        if (selected.has(cat)) {
          selected.delete(cat);
          btn.classList.remove("selected");
        } else {
          selected.add(cat);
          btn.classList.add("selected");
        }
      };
      answerArea.appendChild(btn);
    });

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "answer-btn vote-confirm";
    confirmBtn.textContent = "Valider mon vote";
    confirmBtn.onclick = () => {
      if (selected.size === 0) {
        alert("Coche au moins une proposition.");
        return;
      }
      playClickSound();
      votes.set(current.name, new Set(selected));
      votesSubmitted += 1;
      pendingPlayerIndex = (pendingPlayerIndex + 1) % state.players.length;
      if (votesSubmitted < state.players.length) {
        renderVotingForCurrentPlayer();
        return;
      }

      function voteKey(set) {
        return [...set].sort().join("||");
      }

      const comboCounts = new Map();
      for (const p of state.players) {
        const k = voteKey(votes.get(p.name));
        comboCounts.set(k, (comboCounts.get(k) || 0) + 1);
      }

      const winners = state.players.filter(
        (p) => comboCounts.get(voteKey(votes.get(p.name))) >= 2
      );
      winners.forEach((p) => addPointsWithCombo(p.name, 1));
      state.players
        .filter((p) => !winners.some((w) => w.name === p.name))
        .forEach((p) => breakCombo(p.name));
      registerQuestionType("vote_collectif");
      state.questionStats.vote_collectif.attempts += state.players.length;
      state.questionStats.vote_collectif.correct += winners.length;

      const details = state.players
        .map((p) => {
          const arr = [...votes.get(p.name)].sort();
          return `${p.name}: ${arr.join(" + ") || "—"}`;
        })
        .join(" | ");

      const groupsText = [...comboCounts.entries()]
        .filter(([, c]) => c >= 2)
        .map(([key, c]) => {
          const label = key.split("||").join(" + ") || "—";
          return `"${label}" ×${c}`;
        })
        .join(" ; ");

      const categoryCounts = {};
      categories.forEach((c) => {
        categoryCounts[c] = 0;
      });
      for (const set of votes.values()) {
        for (const cat of set) {
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
      }
      const voteStats = categories
        .map((cat) => `${cat}: ${categoryCounts[cat] ?? 0}`)
        .join(" | ");

      if (winners.length > 0) {
        playGoodSound();
      } else {
        playClickSound();
      }
      const recent = n.recent2015_2024 ?? 0;
      const old = n.old1900_1980 ?? 0;
      const total = n.total ?? 0;
      const pointsMsg =
        winners.length > 0
          ? `+1 pt pour : ${winners
              .map((w) => w.name)
              .join(", ")} (même combinaison à au moins 2).`
          : "Aucun point : personne n'a la même combinaison qu'un autre.";
      const groupsMsg =
        groupsText ||
        "Aucune combinaison en double (au moins 2 joueurs identiques requis).";
      const voteSummary = `${pointsMsg} Groupes identiques : ${groupsMsg} — ${details} — Contexte INSEE : ${formatCount(
        recent
      )} naissances en 2015-2024, ${formatCount(
        old
      )} en 1900-1980, ${formatCount(
        total
      )} au total (France). Cases cochées (tous joueurs) : ${voteStats}.`;
      setFeedback(
        `${voteSummary} — Tous les joueurs ont voté. Passez à la manche suivante.`,
        "ok"
      );
      renderScores();
      updateProgress();
      endChallengeRound(
        () =>
          showTimelineChart({
            series: [
              {
                label: displayName(n.prenom, n.sexTotals),
                color: "#7f8cff",
                yearly: n.yearly,
              },
            ],
            highlights: [
              {
                from: 1900,
                to: 1980,
                fill: "rgba(255, 180, 120, 0.22)",
                label: "Repère « personne âgée » (1900–1980, INSEE)",
              },
              {
                from: 1981,
                to: 2014,
                fill: "rgba(120, 200, 255, 0.16)",
                label: "Repère « adulte » (1981–2014, approximatif)",
              },
              {
                from: 2015,
                to: 2024,
                fill: "rgba(32, 209, 143, 0.2)",
                label: "Repère « enfant » (2015–2024, INSEE)",
              },
            ],
            caption:
              "Évolution du prénom en France — bandes = repères du vote (l’adulte est une plage intermédiaire indicative)",
          }),
        () => {
          answerArea.innerHTML = "";
          answerArea.className = "answer-grid";
          roundTitle.textContent = `Manche ${state.currentRound} - Vote collectif`;
        }
      );
    };
    answerArea.appendChild(confirmBtn);
  }

  renderVotingForCurrentPlayer();
}

function askRegionChallenge(player) {
  registerQuestionType("region_total");
  const region = pickRandom(state.data.regions);
  const { answer, options } = buildTerritoryQuestionOptions(region, 120);
  if (!answer || options.length < 2) {
    return askDuelPopularity(player);
  }
  const optionsStats = formatNameStats(
    options,
    `${region.name}, cumul 1900-2024`
  );

  roundDescription.textContent = `${player.name}, quel prénom est le plus donné dans la région ${region.name} ?`;

  showRegionGeoContext(region);

  options.forEach((option) => {
    const btn = createAnswerButton(
      displayName(option.name, option.sexTotals),
      () => {
        lockAnswers();
        if (option.name === answer.name) {
          const combo = addPointsWithCombo(player.name, 2);
          recordQuestionResult("region_total", true);
          btn.classList.add("correct");
          playGoodSound();
          setFeedback(
            `Correct ! +2 pts. ${displayName(
              answer.name,
              answer.sexTotals
            )} : ${formatCount(answer.value)} naissances cumulées (${
              region.name
            }). Toutes les propositions : ${optionsStats}.${comboText(
              combo.comboBonus,
              combo.streak
            )}`,
            "ok"
          );
        } else {
          breakCombo(player.name);
          recordQuestionResult("region_total", false);
          btn.classList.add("wrong");
          playBadSound();
          setFeedback(
            `Non. C'était ${displayName(
              answer.name,
              answer.sexTotals
            )} (${formatCount(answer.value)}). Tu avais choisi ${displayName(
              option.name,
              option.sexTotals
            )} (${formatCount(
              option.value
            )}). Toutes les propositions : ${optionsStats}.`,
            "bad"
          );
          answerArea.querySelectorAll("button").forEach((b) => {
            if (b.textContent.startsWith(`${answer.name} `))
              b.classList.add("correct");
          });
        }
        renderScores();
        updateProgress();
        endChallengeRound();
      }
    );
    answerArea.appendChild(btn);
  });
}

function askDepartmentChallenge(player) {
  registerQuestionType("department_total");
  const dpt = pickRandom(state.data.departments);
  const { answer, options } = buildTerritoryQuestionOptions(dpt, 40);
  if (!answer || options.length < 2) {
    return askDuelPopularity(player);
  }
  const optionsStats = formatNameStats(options, `${dpt.name}, cumul 1900-2024`);

  roundDescription.textContent = `${player.name}, quel prénom domine dans le département ${dpt.name} (${dpt.code}) ?`;

  void showDepartmentGeoContext(dpt);

  options.forEach((option) => {
    const btn = createAnswerButton(
      displayName(option.name, option.sexTotals),
      () => {
        lockAnswers();
        if (option.name === answer.name) {
          const combo = addPointsWithCombo(player.name, 2);
          recordQuestionResult("department_total", true);
          btn.classList.add("correct");
          playGoodSound();
          setFeedback(
            `Correct ! +2 pts. ${displayName(
              answer.name,
              answer.sexTotals
            )} : ${formatCount(answer.value)} naissances cumulées (${
              dpt.name
            }). Toutes les propositions : ${optionsStats}.${comboText(
              combo.comboBonus,
              combo.streak
            )}`,
            "ok"
          );
        } else {
          breakCombo(player.name);
          recordQuestionResult("department_total", false);
          btn.classList.add("wrong");
          playBadSound();
          setFeedback(
            `Rate. C'était ${displayName(
              answer.name,
              answer.sexTotals
            )} (${formatCount(answer.value)}). Choix : ${displayName(
              option.name,
              option.sexTotals
            )} (${formatCount(
              option.value
            )}). Toutes les propositions : ${optionsStats}.`,
            "bad"
          );
          answerArea.querySelectorAll("button").forEach((b) => {
            if (b.textContent.startsWith(`${answer.name} `))
              b.classList.add("correct");
          });
        }
        renderScores();
        updateProgress();
        endChallengeRound();
      }
    );
    answerArea.appendChild(btn);
  });
}

function askRegionDateChallenge(player) {
  registerQuestionType("region_period");
  const region = pickRandom(state.data.regions);
  if (!hasTerritoryYearlyData(region)) {
    return askRegionChallenge(player);
  }

  const { start, end } = pickYearOrPeriod();
  const datePhrase = territoryDatePhraseAtEnd(start, end);
  const timeFb = territoryTimeClauseFeedback(start, end);
  const { answer, options } = buildTerritoryRangeQuestionOptions(
    region,
    start,
    end,
    start === end ? 10 : 40
  );
  if (!answer) return askRegionChallenge(player);
  const optionsStats = formatTerritoryRangeStats(options, start, end);

  roundDescription.textContent = `${player.name}, quel prénom domine dans la région ${region.name} ${datePhrase} ?`;
  showRegionGeoContext(region);

  options.forEach((option) => {
    const btn = createAnswerButton(
      displayName(option.name, option.sexTotals),
      () => {
        lockAnswers();
        if (option.name === answer.name) {
          const combo = addPointsWithCombo(player.name, 2);
          recordQuestionResult("region_period", true);
          btn.classList.add("correct");
          playGoodSound();
          setFeedback(
            `Correct ! +2 pts. ${timeFb}, ${displayName(
              answer.name,
              answer.sexTotals
            )} est devant avec ${formatCount(
              answer.rangeValue
            )}. Toutes les propositions : ${optionsStats}.${comboText(
              combo.comboBonus,
              combo.streak
            )}`,
            "ok"
          );
        } else {
          breakCombo(player.name);
          recordQuestionResult("region_period", false);
          btn.classList.add("wrong");
          playBadSound();
          setFeedback(
            `Non. ${timeFb}, c'était ${displayName(
              answer.name,
              answer.sexTotals
            )} (${formatCount(
              answer.rangeValue
            )}). Toutes les propositions : ${optionsStats}.`,
            "bad"
          );
          answerArea.querySelectorAll("button").forEach((b) => {
            if (b.textContent.startsWith(`${answer.name} `))
              b.classList.add("correct");
          });
        }
        renderScores();
        updateProgress();
        endChallengeRound();
      }
    );
    answerArea.appendChild(btn);
  });
}

function askDepartmentDateChallenge(player) {
  registerQuestionType("department_period");
  const dpt = pickRandom(state.data.departments);
  if (!hasTerritoryYearlyData(dpt)) {
    return askDepartmentChallenge(player);
  }

  const { start, end } = pickYearOrPeriod();
  const datePhrase = territoryDatePhraseAtEnd(start, end);
  const timeFb = territoryTimeClauseFeedback(start, end);
  const { answer, options } = buildTerritoryRangeQuestionOptions(
    dpt,
    start,
    end,
    start === end ? 5 : 20
  );
  if (!answer) return askDepartmentChallenge(player);
  const optionsStats = formatTerritoryRangeStats(options, start, end);

  roundDescription.textContent = `${player.name}, quel prénom domine dans le département ${dpt.name} (${dpt.code}) ${datePhrase} ?`;
  void showDepartmentGeoContext(dpt);

  options.forEach((option) => {
    const btn = createAnswerButton(
      displayName(option.name, option.sexTotals),
      () => {
        lockAnswers();
        if (option.name === answer.name) {
          const combo = addPointsWithCombo(player.name, 2);
          recordQuestionResult("department_period", true);
          btn.classList.add("correct");
          playGoodSound();
          setFeedback(
            `Correct ! +2 pts. ${timeFb}, ${displayName(
              answer.name,
              answer.sexTotals
            )} est devant avec ${formatCount(
              answer.rangeValue
            )}. Toutes les propositions : ${optionsStats}.${comboText(
              combo.comboBonus,
              combo.streak
            )}`,
            "ok"
          );
        } else {
          breakCombo(player.name);
          recordQuestionResult("department_period", false);
          btn.classList.add("wrong");
          playBadSound();
          setFeedback(
            `Non. ${timeFb}, c'était ${displayName(
              answer.name,
              answer.sexTotals
            )} (${formatCount(
              answer.rangeValue
            )}). Toutes les propositions : ${optionsStats}.`,
            "bad"
          );
          answerArea.querySelectorAll("button").forEach((b) => {
            if (b.textContent.startsWith(`${answer.name} `))
              b.classList.add("correct");
          });
        }
        renderScores();
        updateProgress();
        endChallengeRound();
      }
    );
    answerArea.appendChild(btn);
  });
}

function askTopNameByYear(player) {
  registerQuestionType("top_name_year");
  const year = 1950 + randomInt(2024 - 1950 + 1);
  const best = pickTopNameOfYear(year);
  if (!best || best.value <= 0) {
    return askPeakYear(player);
  }

  const candidatesRaw = state.data.names
    .map((n) => ({
      name: n.prenom,
      value: n.yearly?.[String(year)] || 0,
      sexTotals: n.sexTotals,
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const candidates = [];
  const seenNames = new Set();
  for (const c of candidatesRaw) {
    if (seenNames.has(c.name)) continue;
    seenNames.add(c.name);
    candidates.push(c);
    if (candidates.length >= 16) break;
  }

  const answer = candidates[0];
  const options = [answer];
  while (options.length < 4) {
    const candidate = pickRandom(candidates);
    if (!options.some((o) => o.name === candidate.name)) {
      options.push(candidate);
    }
  }
  options.sort(() => Math.random() - 0.5);
  const optionsStats = formatNameStats(options, `France, annee ${year}`);

  roundDescription.textContent = `${player.name}, en ${year}, quel prénom a été le plus donné en France ?`;

  options.forEach((option) => {
    const btn = createAnswerButton(
      displayName(option.name, option.sexTotals),
      () => {
        lockAnswers();
        if (option.name === answer.name) {
          const combo = addPointsWithCombo(player.name, 2);
          recordQuestionResult("top_name_year", true);
          btn.classList.add("correct");
          playGoodSound();
          setFeedback(
            `Exact ! +2 pts. En ${year}, ${displayName(
              answer.name,
              answer.sexTotals
            )} est #1 avec ${formatCount(
              answer.value
            )} naissances en France. Toutes les propositions : ${optionsStats}.${comboText(
              combo.comboBonus,
              combo.streak
            )}`,
            "ok"
          );
        } else {
          breakCombo(player.name);
          recordQuestionResult("top_name_year", false);
          btn.classList.add("wrong");
          playBadSound();
          setFeedback(
            `Non. En ${year}, le #1 est ${displayName(
              answer.name,
              answer.sexTotals
            )} (${formatCount(
              answer.value
            )}). Toutes les propositions : ${optionsStats}.`,
            "bad"
          );
          answerArea.querySelectorAll("button").forEach((b) => {
            if (b.textContent.startsWith(`${answer.name} `)) {
              b.classList.add("correct");
            }
          });
        }
        renderScores();
        updateProgress();
        endChallengeRound(() =>
          showTimelineChart({
            series: [
              {
                label: displayName(answer.name, answer.sexTotals),
                color: "#7f8cff",
                yearly: findNameEntry(answer.name)?.yearly || {},
              },
            ],
            markYears: [{ year, color: "rgba(255, 226, 123, 0.9)", width: 2 }],
            caption: `Prénom #1 en ${year} : évolution nationale du prénom gagnant`,
          })
        );
      }
    );
    answerArea.appendChild(btn);
  });
}

function askRankingFourChallenge(player) {
  registerQuestionType("ranking_4");
  const useDepartment = randomInt(2) === 0;
  const territory = useDepartment
    ? pickRandom(state.data.departments)
    : pickRandom(state.data.regions);
  if (!hasTerritoryYearlyData(territory)) {
    return useDepartment
      ? askDepartmentChallenge(player)
      : askRegionChallenge(player);
  }

  const { start, end } = pickYearOrPeriod();
  const rankingData = buildTerritoryRankingOptions(
    territory,
    start,
    end,
    useDepartment ? 5 : 12
  );
  if (!rankingData) {
    return useDepartment
      ? askDepartmentDateChallenge(player)
      : askRegionDateChallenge(player);
  }

  const contextLabel = useDepartment
    ? `departement ${territory.name} (${territory.code})`
    : `region ${territory.name}`;
  const periodLabel = start === end ? `en ${start}` : `sur ${start}-${end}`;
  roundDescription.textContent = `${player.name}, classe ces 4 prénoms du plus donné au moins donné dans ${contextLabel} ${periodLabel}.`;
  setFeedback(
    "Clique les 4 propositions dans l'ordre (1 = plus donne), puis valide.",
    "ok"
  );
  if (useDepartment) {
    void showDepartmentGeoContext(territory);
  } else {
    showRegionGeoContext(territory);
  }

  const labelsByName = Object.fromEntries(
    rankingData.options.map((o) => [o.name, displayName(o.name, o.sexTotals)])
  );
  const selectedOrder = [];
  const buttonsByName = new Map();

  function updateLiveFeedback() {
    if (selectedOrder.length === 0) return;
    const text = selectedOrder
      .map((name, idx) => `${idx + 1}. ${labelsByName[name]}`)
      .join(" > ");
    setFeedback(`Ordre en cours: ${text}`, "ok");
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "answer-btn vote-confirm";
  confirmBtn.textContent = "Valider le classement";
  confirmBtn.disabled = true;

  rankingData.options.forEach((option) => {
    const baseLabel = labelsByName[option.name];
    const btn = createAnswerButton(baseLabel, () => {
      if (selectedOrder.includes(option.name) || selectedOrder.length >= 4) {
        return;
      }
      playClickSound();
      selectedOrder.push(option.name);
      btn.classList.add("selected");
      btn.textContent = `${selectedOrder.length}. ${baseLabel}`;
      updateLiveFeedback();
      if (selectedOrder.length === 4) {
        confirmBtn.disabled = false;
      }
    });
    buttonsByName.set(option.name, btn);
    answerArea.appendChild(btn);
  });

  confirmBtn.onclick = () => {
    if (selectedOrder.length !== 4) return;
    lockAnswers();

    const expected = rankingData.correctOrder.map((x) => x.name);
    const exactPositions = expected.filter(
      (name, idx) => selectedOrder[idx] === name
    ).length;
    const isPerfect = exactPositions === 4;
    const selectedText = selectedOrder
      .map((name, idx) => `${idx + 1}. ${labelsByName[name]}`)
      .join(" > ");
    const expectedText = rankingData.correctOrder
      .map(
        (x, idx) =>
          `${idx + 1}. ${displayName(x.name, x.sexTotals)} (${formatCount(
            x.rangeValue
          )})`
      )
      .join(" > ");

    if (isPerfect) {
      const combo = addPointsWithCombo(player.name, 3);
      recordQuestionResult("ranking_4", true);
      playGoodSound();
      setFeedback(
        `Parfait ! +3 pts. Classement exact (${periodLabel}, ${contextLabel}). ${expectedText}.${comboText(
          combo.comboBonus,
          combo.streak
        )}`,
        "ok"
      );
    } else if (exactPositions >= 2) {
      const combo = addPointsWithCombo(player.name, 1);
      recordQuestionResult("ranking_4", true);
      playTone({
        frequency: 680,
        duration: 0.08,
        type: "triangle",
        volume: 0.02,
      });
      setFeedback(
        `Bien tente (+1). ${exactPositions}/4 positions exactes. Ton ordre: ${selectedText}. Bon ordre: ${expectedText}.${comboText(
          combo.comboBonus,
          combo.streak
        )}`,
        "ok"
      );
    } else {
      breakCombo(player.name);
      recordQuestionResult("ranking_4", false);
      playBadSound();
      setFeedback(
        `Rate. ${exactPositions}/4 positions exactes. Ton ordre: ${selectedText}. Bon ordre: ${expectedText}.`,
        "bad"
      );
    }

    for (const [name, btn] of buttonsByName.entries()) {
      const rank = expected.indexOf(name);
      if (rank === -1) continue;
      btn.textContent = `${rank + 1}. ${labelsByName[name]}`;
      if (selectedOrder[rank] === name) {
        btn.classList.add("correct");
      } else {
        btn.classList.add("wrong");
      }
    }

    renderScores();
    updateProgress();
    endChallengeRound(() =>
      showTimelineChart({
        series: rankingData.correctOrder.map((x, i) => ({
          label: `${i + 1}. ${displayName(x.name, x.sexTotals)}`,
          color: ["#7f8cff", "#39d8ff", "#20d18f", "#ffe27b"][i % 4],
          yearly: findNameEntry(x.name)?.yearly || {},
        })),
        highlights: [
          {
            from: start,
            to: end,
            fill: "rgba(255, 226, 123, 0.22)",
            label: start === end ? `Année ${start}` : `Période ${start}-${end}`,
          },
        ],
        caption: `Comparatif des 4 prénoms (${contextLabel}) — classement sur ${start}-${end}`,
      })
    );
  };
  answerArea.appendChild(confirmBtn);
}

function nextRound() {
  if (state.currentChallenge) {
    setFeedback(
      "Termine d’abord la manche en cours (réponse ou tous les votes au vote collectif), puis réessaie.",
      "bad"
    );
    return;
  }
  if (endGameIfWinner()) {
    return;
  }
  clearChallengeUi();
  state.currentRound += 1;
  const player = state.players[state.currentPlayerIndex];
  roundTitle.textContent = `Manche ${state.currentRound} - Tour de ${player.name}`;
  turnPill.textContent = `Objectif ${state.targetScore} pts`;
  playClickSound();

  const challengeFns = [
    () => askDuelPopularity(player),
    () => askPeakYear(player),
    () => askYoungAdultOldVote(),
    () => askRankingFourChallenge(player),
    () => askRegionChallenge(player),
    () => askDepartmentChallenge(player),
    () => askRegionDateChallenge(player),
    () => askRegionDateChallenge(player),
    () => askDepartmentDateChallenge(player),
    () => askDepartmentDateChallenge(player),
    () => askTopNameByYear(player),
    () => askTopNameByYear(player),
  ];

  state.currentChallenge = pickRandom(challengeFns);
  state.currentChallenge();

  state.currentPlayerIndex =
    (state.currentPlayerIndex + 1) % state.players.length;
}

async function loadData() {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(
      "Impossible de charger data/game-data.json. Lance d'abord npm run build:data"
    );
  }
  return response.json();
}

startBtn.onclick = async () => {
  initAudio();
  const names = playersInput.value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (names.length < 2) {
    alert("Il faut au moins 2 joueurs.");
    return;
  }

  state.targetScore = Number.parseInt(targetScoreInput.value, 10) || 15;
  state.difficulty = difficultyInput?.value || "normal";
  state.players = names.map((name) => ({ name, score: 0 }));
  state.comboStreaks = Object.fromEntries(names.map((name) => [name, 0]));
  state.questionStats = {};
  state.currentQuestionType = null;
  state.currentPlayerIndex = 0;
  state.currentRound = 0;
  nextRoundBtn.disabled = false;

  try {
    state.data = await loadData();
    state.nationalTotalBirths = getNationalTotalBirths();
  } catch (error) {
    alert(error.message);
    return;
  }

  renderScores();
  updateProgress();
  gameSection.classList.remove("hidden");
  nextRound();
};

nextRoundBtn.onclick = () => {
  nextRound();
};
