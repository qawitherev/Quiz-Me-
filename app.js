'use strict';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  metadata:      {},
  allQuestions:  [],   // raw questions from JSON
  questions:     [],   // active set (may be shuffled)
  currentIndex:  0,
  userAnswers:   {},   // { [question.id]: number[] }
  userNotes:     {},   // { [question.id]: string }
  taggedQuestions: {}, // { [question.id]: true }
  reviewEnabled:   false,
  reviewTaggedOnly: false,
  isReviewMode:    false,
  viewingSession:  false,
  viewingSessionIndex: -1,
  sessionSaved:    false,
  correctingAnswer: false,
  correctionSelection: [],
  _correctionQuestionIdx: -1,
  quizMode: 'exam',
  studyAnswered: {},
  studyCorrect: 0,
  studyTotal: 0,
};

// ── DOM refs ───────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const DOM = {
  screens: {
    welcome: $('screen-welcome'),
    quiz:    $('screen-quiz'),
    results: $('screen-results'),
    history: $('screen-history'),
  },
  // Welcome
  statQuestions: $('stat-questions'),
  loadError:     $('load-error'),
  optShuffle:    $('opt-shuffle'),
  optReview:     $('opt-review'),
  optQuestionCount: $('opt-question-count'),
  btnRefreshSet: $('btn-refresh-set'),
  inpBankFile:   $('inp-bank-file'),
  refreshStatus: $('refresh-status'),
  modeDesc:      $('mode-desc'),
  btnContinue:   $('btn-continue'),
  btnStart:      $('btn-start'),
  // Quiz
  counter:       $('q-counter'),
  qTagPill:      $('q-tag-pill'),
  qJumpGrid:     $('q-jump-grid'),
  domain:        $('q-domain'),
  barFill:       $('bar-fill'),
  typeBadge:     $('q-type-badge'),
  qText:         $('q-text'),
  qHint:         $('q-hint'),
  qOptions:      $('q-options'),
  qExpl:         $('q-expl'),
  qExplText:     $('q-expl-text'),
  qNote:         $('q-note'),
  qNoteArea:     $('q-note-area'),
  qTagIndicator: $('q-tag-indicator'),
  qReviewIndicator: $('q-review-indicator'),
  qCorrect:        $('q-correct'),
  btnCorrectStart: $('btn-correct-start'),
  btnCorrectSave:  $('btn-correct-save'),
  btnCorrectCancel:$('btn-correct-cancel'),
  btnPrev:       $('btn-prev'),
  btnTag:        $('btn-tag'),
  btnNext:       $('btn-next'),
  btnSubmit:     $('btn-submit'),
  btnQuit:       $('btn-quit'),
  btnCheck:      $('btn-check'),
  liveScore:     $('q-live-score'),
  // Results
  verdict:       $('verdict'),
  scoreNum:      $('score-num'),
  scoreSub:      $('score-sub'),
  domainList:    $('domain-list'),
  taggedSummary: $('tagged-summary'),
  btnReview:     $('btn-review'),
  btnReviewTagged: $('btn-review-tagged'),
  btnRestart:    $('btn-restart'),
  // History
  btnHistoryOpen: $('btn-history-open'),
  btnHistoryBack: $('btn-history-back'),
  historyList:    $('history-list'),
  historyEmpty:   $('history-empty'),
};

// ── Utilities ──────────────────────────────────────────────────────────────────
function showScreen(name) {
  Object.values(DOM.screens).forEach(s => s.classList.remove('active'));
  DOM.screens[name].classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Fisher-Yates shuffle (returns a new array). */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Optionally shuffles the options of a question while keeping answer indices
 * pointing to the same content.
 */
function prepareQuestion(q, doShuffle) {
  const normalizedAnswer = Array.isArray(q.answer)
    ? q.answer
        .map(i => Number(i))
        .filter(i => Number.isInteger(i) && i >= 0)
    : [];

  if (!doShuffle) return { ...q, answer: normalizedAnswer };
  const answerSet = new Set(normalizedAnswer);
  const tagged  = q.options.map((text, i) => ({ text, isAns: answerSet.has(i) }));
  const shuffled = shuffle(tagged);
  return {
    ...q,
    options: shuffled.map(x => x.text),
    answer:  shuffled.map((x, newIdx) => x.isAns ? newIdx : -1).filter(i => i >= 0),
  };
}

/** Escape user-supplied strings inserted into innerHTML. */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setRefreshStatus(message, type = '') {
  DOM.refreshStatus.textContent = message;
  DOM.refreshStatus.className = `refresh-status ${type}`.trim();
  if (!message) DOM.refreshStatus.classList.add('hidden');
}

async function loadQuestionSet() {
  const res = await fetch(`./questions_set.json?ts=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  state.metadata = data.exam_metadata ?? {};
  state.allQuestions = data.questions ?? [];

  if (state.allQuestions.length === 0) throw new Error('No questions found.');

  DOM.statQuestions.textContent = state.allQuestions.length;
  DOM.btnStart.disabled = false;
}

// ── Scoring ────────────────────────────────────────────────────────────────────
function calcScore() {
  let correct = 0;
  for (const q of state.questions) {
    const user = answerKey(state.userAnswers[q.id] ?? []);
    const ans  = answerKey(q.answer);
    if (user === ans) correct++;
  }
  const total  = state.questions.length;
  const scaled = Math.round(100 + (correct / total) * 900);
  return { correct, total, scaled };
}

function isTagged(questionId) {
  return Boolean(state.taggedQuestions[questionId]);
}

function getActiveQuestions() {
  if (state.isReviewMode && state.reviewTaggedOnly) {
    return state.questions.filter(q => isTagged(q.id));
  }
  return state.questions;
}

function isMultipleResponseQuestion(question) {
  const normalizedType = String(question.type ?? '').toLowerCase().trim();
  if (normalizedType === 'multiple-response' || normalizedType === 'multiple-reponse') {
    return true;
  }

  // Fallback for malformed type values in source data.
  const ans = Array.isArray(question.answer) ? question.answer : [];
  return ans.length > 1;
}

function answerKey(indices) {
  return (Array.isArray(indices) ? indices : [])
    .map(i => Number(i))
    .filter(i => Number.isInteger(i) && i >= 0)
    .sort((a, b) => a - b)
    .join(',');
}

function isAnswered(question) {
  return (state.userAnswers[question.id] ?? []).length > 0;
}

function isCorrect(question) {
  const user = answerKey(state.userAnswers[question.id] ?? []);
  const ans  = answerKey(question.answer);
  return user === ans;
}

function renderJumpGrid(activeQuestions) {
  DOM.qJumpGrid.innerHTML = activeQuestions.map((question, idx) => {
    const classes = ['jump-item'];
    const tags = [];

    if (idx === state.currentIndex) {
      classes.push('current');
      tags.push('current');
    }
    if (isAnswered(question)) {
      classes.push('answered');
      tags.push('answered');
    }
    if (isTagged(question.id)) {
      classes.push('tagged');
      tags.push('tagged');
    }
    if (state.isReviewMode) {
      const correct = isCorrect(question);
      classes.push(correct ? 'review-correct' : 'review-incorrect');
      tags.push(correct ? 'correct' : 'incorrect');
    }

    const title = `Question ${idx + 1}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    return `<button type="button" class="${classes.join(' ')}" data-index="${idx}" title="${esc(title)}">${idx + 1}</button>`;
  }).join('');

  DOM.qJumpGrid.querySelectorAll('.jump-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentIndex = Number(btn.dataset.index);
      renderQuestion();
    });
  });
}

function updateReviewIndicator(question) {
  if (!state.isReviewMode) {
    DOM.qReviewIndicator.classList.add('hidden');
    DOM.qReviewIndicator.textContent = '';
    DOM.qReviewIndicator.classList.remove('pass', 'fail');
    return;
  }

  const correct = isCorrect(question);
  DOM.qReviewIndicator.textContent = correct ? 'Correct' : 'Incorrect';
  DOM.qReviewIndicator.classList.remove('hidden');
  DOM.qReviewIndicator.classList.toggle('pass', correct);
  DOM.qReviewIndicator.classList.toggle('fail', !correct);
}

function updateTagButton(question) {
  const tagged = isTagged(question.id);
  DOM.btnTag.textContent = tagged ? 'Tagged ✓' : 'Tag Question';
  DOM.btnTag.classList.toggle('is-active', tagged);
  DOM.btnTag.setAttribute('aria-pressed', tagged ? 'true' : 'false');
  DOM.qTagIndicator.classList.toggle('hidden', !tagged);
  DOM.qTagPill.classList.toggle('hidden', !tagged);
}

// ── Render: Question ───────────────────────────────────────────────────────────
let _lastRenderedIndex = -1;

function renderQuestion() {
  const activeQuestions = getActiveQuestions();
  if (activeQuestions.length === 0) {
    state.reviewTaggedOnly = false;
    showResults();
    return;
  }

  if (state.currentIndex > activeQuestions.length - 1) {
    state.currentIndex = activeQuestions.length - 1;
  }

  const idx     = state.currentIndex;
  const q       = activeQuestions[idx];
  const total   = activeQuestions.length;
  const ua      = state.userAnswers[q.id] ?? [];
  const isMulti = isMultipleResponseQuestion(q);

  // Reset correction mode if user navigated to a different question
  if (state.correctingAnswer && idx !== state._correctionQuestionIdx) {
    state.correctingAnswer = false;
    state.correctionSelection = [];
  }

  // Progress bar & counter
  if (state.isReviewMode && state.reviewTaggedOnly) {
    DOM.counter.textContent  = `Tagged ${idx + 1} of ${total}`;
  } else {
    DOM.counter.textContent  = `Question ${idx + 1} of ${total}`;
  }
  DOM.domain.textContent     = q.domain ?? '';
  DOM.barFill.style.width    = `${((idx + 1) / total) * 100}%`;

  // Live score (study mode)
  if (state.quizMode === 'study') {
    DOM.liveScore.textContent = `${state.studyCorrect} / ${state.studyTotal} correct`;
    DOM.liveScore.classList.remove('hidden');
  } else {
    DOM.liveScore.classList.add('hidden');
  }

  updateTagButton(q);
  updateReviewIndicator(q);
  renderJumpGrid(activeQuestions);

  // Subtle enter animation when switching questions
  const qCard = document.querySelector('.q-card');
  if (qCard && idx !== _lastRenderedIndex) {
    qCard.classList.add('q-enter');
    requestAnimationFrame(() => requestAnimationFrame(() => qCard.classList.remove('q-enter')));
  }
  _lastRenderedIndex = idx;

  // Correction button (review mode only, not during correction)
  DOM.btnCorrectStart.classList.toggle('hidden', !state.isReviewMode || state.correctingAnswer);

  // Type badge
  DOM.typeBadge.textContent  = isMulti ? 'Multiple Response' : 'Multiple Choice';

  // Question text
  DOM.qText.textContent = q.text;

  // Instruction (multiple response only, during quiz)
  if (isMulti && !state.isReviewMode) {
    const n = q.answer.length;
    DOM.qHint.textContent = `Select ${n} answer${n > 1 ? 's' : ''}.`;
    DOM.qHint.classList.remove('hidden');
  } else {
    DOM.qHint.classList.add('hidden');
  }

  // Build option buttons
  DOM.qOptions.innerHTML = '';
  q.options.forEach((text, idx2) => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn';
    btn.setAttribute('type', 'button');

    const letter = String.fromCharCode(65 + idx2); // A, B, C …
    btn.innerHTML =
      `<span class="opt-letter">${letter}</span>` +
      `<span class="opt-text">${esc(text)}</span>`;

    if (state.correctingAnswer) {
      if (state.correctionSelection.includes(idx2)) btn.classList.add('correction-selected');
      btn.addEventListener('click', () => toggleCorrectionOption(idx2, isMulti));
    } else if (state.isReviewMode || (state.quizMode === 'study' && state.studyAnswered[q.id])) {
      if (ua.includes(idx2)) btn.classList.add('selected');
      btn.disabled = true;
      if (q.answer.includes(idx2))          btn.classList.add('correct');
      else if (ua.includes(idx2))           btn.classList.add('incorrect');
    } else {
      if (ua.includes(idx2)) btn.classList.add('selected');
      btn.addEventListener('click', () => handleOption(q, idx2, isMulti));
    }

    DOM.qOptions.appendChild(btn);
  });

  // Correction bar
  DOM.qCorrect.classList.toggle('hidden', !state.correctingAnswer);

  // Explanation (review mode or study mode after checking)
  if ((state.isReviewMode || (state.quizMode === 'study' && state.studyAnswered[q.id])) && q.explanation && !state.correctingAnswer) {
    DOM.qExplText.textContent = q.explanation;
    DOM.qExpl.classList.remove('hidden');
  } else {
    DOM.qExpl.classList.add('hidden');
  }

  // User note
  DOM.qNoteArea.value = state.userNotes[q.id] ?? '';
  DOM.qNote.classList.remove('hidden');

  // Navigation buttons
  DOM.btnPrev.style.visibility = (idx === 0) ? 'hidden' : 'visible';
  DOM.btnQuit.classList.toggle('hidden', state.isReviewMode || state.viewingSession);

  const isLast = (idx === total - 1);
  if (state.isReviewMode) {
    DOM.btnSubmit.classList.add('hidden');
    DOM.btnCheck.classList.add('hidden');
    DOM.btnNext.classList.remove('hidden');
    DOM.btnNext.textContent = isLast ? 'Back to Results' : 'Next';
  } else if (state.quizMode === 'study') {
    DOM.btnSubmit.classList.add('hidden');
    const checked = state.studyAnswered[q.id];
    const hasSelection = ua.length > 0;
    DOM.btnCheck.classList.toggle('hidden', checked || !hasSelection);
    DOM.btnNext.classList.remove('hidden');
    DOM.btnNext.textContent = isLast ? 'Finish' : 'Next';
  } else {
    DOM.btnCheck.classList.add('hidden');
    DOM.btnNext.textContent = 'Next';
    DOM.btnNext.classList.toggle('hidden', isLast);
    DOM.btnSubmit.classList.toggle('hidden', !isLast);
  }
}

function handleOption(q, optIdx, isMulti) {
  if (state.quizMode === 'study' && state.studyAnswered[q.id]) return;

  let ua = [...(state.userAnswers[q.id] ?? [])];

  if (isMulti) {
    if (ua.includes(optIdx)) ua = ua.filter(i => i !== optIdx);
    else                     ua.push(optIdx);
  } else {
    ua = [optIdx];
  }

  state.userAnswers[q.id] = ua;

  // In study mode, auto-check single-choice questions immediately
  if (state.quizMode === 'study' && !isMulti) {
    state.studyAnswered[q.id] = true;
    state.studyTotal++;
    if (isCorrect(q)) state.studyCorrect++;
  }

  renderQuestion();
}

function toggleCorrectionOption(optIdx, isMulti) {
  if (isMulti) {
    if (state.correctionSelection.includes(optIdx)) {
      state.correctionSelection = state.correctionSelection.filter(i => i !== optIdx);
    } else {
      state.correctionSelection.push(optIdx);
    }
  } else {
    state.correctionSelection = [optIdx];
  }
  renderQuestion();
}

// ── Render: Results ────────────────────────────────────────────────────────────
function showResults() {
  const { correct, total, scaled } = calcScore();
  const passing = state.metadata.passing_score ?? 720;
  const passed  = scaled >= passing;

  // Auto-save once per new quiz completion (exam mode only)
  if (!state.isReviewMode && !state.viewingSession && !state.sessionSaved && state.quizMode !== 'study') {
    saveSession();
    clearSavedProgress();
    state.sessionSaved = true;
  }

  DOM.verdict.textContent  = passed ? 'Pass' : 'Fail';
  DOM.verdict.className    = `verdict ${passed ? 'pass' : 'fail'}`;
  DOM.scoreNum.textContent = scaled;
  DOM.scoreSub.textContent =
    `${correct} of ${total} correct  ·  passing score ${passing}`;

  const taggedCount = state.questions.filter(q => isTagged(q.id)).length;
  DOM.taggedSummary.textContent = taggedCount > 0
    ? `${taggedCount} question${taggedCount === 1 ? '' : 's'} tagged for later review.`
    : 'No tagged questions in this quiz.';

  // Per-domain breakdown
  const domains = {};
  for (const q of state.questions) {
    if (!domains[q.domain]) domains[q.domain] = { correct: 0, total: 0 };
    domains[q.domain].total++;
    const user = answerKey(state.userAnswers[q.id] ?? []);
    if (user === answerKey(q.answer)) domains[q.domain].correct++;
  }

  DOM.domainList.innerHTML = Object.entries(domains).map(([name, s]) => {
    const pct = Math.round((s.correct / s.total) * 100);
    return `
      <div class="domain-row">
        <div class="domain-row-top">
          <span class="domain-name">${esc(name)}</span>
          <span class="domain-score">${s.correct} / ${s.total} &nbsp; ${pct}%</span>
        </div>
        <div class="domain-bar-track">
          <div class="domain-bar-fill" data-w="${pct}"></div>
        </div>
      </div>`;
  }).join('');

  // Animate bars after a frame (CSS transition needs width to start at 0)
  requestAnimationFrame(() => {
    DOM.domainList.querySelectorAll('.domain-bar-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });

  const showReviewBtns = state.reviewEnabled && state.quizMode !== 'study';
  DOM.btnReview.classList.toggle('hidden', !showReviewBtns);
  DOM.btnReviewTagged.classList.toggle('hidden', !showReviewBtns || taggedCount === 0);
  DOM.btnRestart.textContent = state.viewingSession ? '← Back to History' : 'Restart';

  showScreen('results');
}

// ── Start Quiz ─────────────────────────────────────────────────────────────────
DOM.btnStart.addEventListener('click', () => {
  const hasProgress = getSavedProgress() !== null;
  if (hasProgress) {
    if (!confirm('Starting a new quiz will reset your saved progress. Continue?')) {
      return;
    }
    clearSavedProgress();
  }

  const doShuffle     = DOM.optShuffle.checked;
  state.reviewEnabled  = DOM.optReview.checked;
  state.quizMode       = document.querySelector('input[name="quiz-mode"]:checked').value;
  state.reviewTaggedOnly = false;
  state.isReviewMode   = false;
  state.viewingSession = false;
  state.sessionSaved   = false;
  state.userAnswers    = {};
  state.userNotes      = {};
  state.taggedQuestions = {};
  state.studyAnswered  = {};
  state.studyCorrect   = 0;
  state.studyTotal     = 0;
  state.currentIndex   = 0;

  const count = Number(DOM.optQuestionCount.value) || state.allQuestions.length;
  let pool = state.allQuestions;
  if (count < pool.length) {
    pool = shuffle(pool).slice(0, count);
  }
  let qs = pool.map(q => prepareQuestion(q, doShuffle));
  if (doShuffle) qs = shuffle(qs);
  state.questions = qs;

  renderQuestion();
  showScreen('quiz');
});

// ── Continue Quiz ──────────────────────────────────────────────────────────────
DOM.btnContinue.addEventListener('click', () => {
  const progress = getSavedProgress();
  if (!progress) return;

  state.metadata        = { ...progress.metadata };
  state.questions       = progress.questions.map(q => ({ ...q, options: [...q.options], answer: [...q.answer] }));
  state.userAnswers     = Object.fromEntries(
                            Object.entries(progress.userAnswers).map(([k, v]) => [k, [...v]])
                          );
  state.taggedQuestions = Object.fromEntries(
    (progress.taggedQuestionIds ?? []).map(id => [id, true])
  );
  state.userNotes       = { ...(progress.userNotes ?? {}) };
  state.currentIndex    = progress.currentIndex ?? 0;
  state.reviewEnabled   = progress.reviewEnabled ?? true;
  state.quizMode        = 'exam';
  state.reviewTaggedOnly = false;
  state.isReviewMode    = false;
  state.viewingSession  = false;
  state.sessionSaved    = false;
  state.studyAnswered   = {};
  state.studyCorrect    = 0;
  state.studyTotal      = 0;

  renderQuestion();
  showScreen('quiz');
});

// ── Quit Quiz ──────────────────────────────────────────────────────────────────
DOM.btnQuit.addEventListener('click', () => {
  const msg = state.quizMode === 'study'
    ? 'Quit the quiz?'
    : 'Quit the quiz? Your progress will be saved.';
  if (!confirm(msg)) return;
  if (state.quizMode !== 'study') saveProgress();
  updateWelcomeButtons();
  showScreen('welcome');
});

// ── Quiz Navigation ────────────────────────────────────────────────────────────
DOM.btnNext.addEventListener('click', () => {
  const total = getActiveQuestions().length;
  if (state.currentIndex < total - 1) {
    state.currentIndex++;
    renderQuestion();
  } else if (state.isReviewMode || state.quizMode === 'study') {
    showResults();
  }
});

DOM.btnPrev.addEventListener('click', () => {
  if (state.currentIndex > 0) {
    state.currentIndex--;
    renderQuestion();
  }
});

DOM.btnSubmit.addEventListener('click', () => {
  const unanswered = state.questions.filter(
    q => !state.userAnswers[q.id] || state.userAnswers[q.id].length === 0
  ).length;

  if (unanswered > 0) {
    const noun = unanswered === 1 ? 'question' : 'questions';
    if (!confirm(`${unanswered} ${noun} unanswered. Submit anyway? Unanswered questions count as incorrect.`)) {
      return;
    }
  }
  showResults();
});

DOM.btnCheck.addEventListener('click', () => {
  const activeQuestions = getActiveQuestions();
  const q = activeQuestions[state.currentIndex];
  if (!q || state.studyAnswered[q.id]) return;

  state.studyAnswered[q.id] = true;
  state.studyTotal++;
  if (isCorrect(q)) state.studyCorrect++;
  renderQuestion();
});

DOM.btnTag.addEventListener('click', () => {
  const activeQuestions = getActiveQuestions();
  const q = activeQuestions[state.currentIndex];
  if (!q) return;

  if (isTagged(q.id)) {
    delete state.taggedQuestions[q.id];
  } else {
    state.taggedQuestions[q.id] = true;
  }

  if (state.isReviewMode && state.reviewTaggedOnly) {
    const remaining = getActiveQuestions();
    if (remaining.length === 0) {
      state.reviewTaggedOnly = false;
      showResults();
      return;
    }
    if (state.currentIndex > remaining.length - 1) {
      state.currentIndex = remaining.length - 1;
    }
  }

  renderQuestion();
});

// ── Results Actions ────────────────────────────────────────────────────────────
DOM.btnReview.addEventListener('click', () => {
  state.reviewTaggedOnly = false;
  state.isReviewMode = true;
  state.currentIndex = 0;
  renderQuestion();
  showScreen('quiz');
});

DOM.btnReviewTagged.addEventListener('click', () => {
  const taggedCount = state.questions.filter(q => isTagged(q.id)).length;
  if (taggedCount === 0) return;

  state.reviewTaggedOnly = true;
  state.isReviewMode = true;
  state.currentIndex = 0;
  renderQuestion();
  showScreen('quiz');
});

DOM.btnRestart.addEventListener('click', () => {
  if (state.viewingSession) {
    state.viewingSession = false;
    renderHistory();
    showScreen('history');
  } else {
    clearSavedProgress();
    updateWelcomeButtons();
    showScreen('welcome');
  }
});

// ── History Persistence ────────────────────────────────────────────────────────
const HISTORY_KEY  = 'quizHistory';
const PROGRESS_KEY = 'quizProgress';

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); }
  catch { return []; }
}

function saveSession() {
  const { correct, total, scaled } = calcScore();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const y  = now.getFullYear(),  mo = pad(now.getMonth() + 1),
        d  = pad(now.getDate()), h  = pad(now.getHours()),
        mi = pad(now.getMinutes());

  const session = {
    timestamp:   `${y}/${mo}/${d} ${h}:${mi}`,
    fileName:    `QuizGoBackInTime_${y}-${mo}-${d}_${h}-${mi}.json`,
    score:       { correct, total, scaled },
    passed:      scaled >= (state.metadata.passing_score ?? 720),
    metadata:    { ...state.metadata },
    questions:   state.questions.map(q => ({ ...q, options: [...q.options], answer: [...q.answer] })),
    taggedQuestionIds: Object.keys(state.taggedQuestions)
      .filter(id => state.taggedQuestions[id])
      .map(id => Number(id)),
    userNotes: { ...state.userNotes },
    userAnswers: Object.fromEntries(
                   Object.entries(state.userAnswers).map(([k, v]) => [k, [...v]])
                 ),
  };

  // Persist to localStorage
  const history = getHistory();
  history.unshift(session);
  if (history.length > 50) history.splice(50);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
  catch (e) { console.warn('[Quiz Me] Could not save session history:', e); }

  // Trigger file download
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = session.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Progress Persistence ───────────────────────────────────────────────────────
function saveProgress() {
  const progress = {
    metadata:         { ...state.metadata },
    questions:        state.questions.map(q => ({ ...q, options: [...q.options], answer: [...q.answer] })),
    userAnswers:      Object.fromEntries(
                        Object.entries(state.userAnswers).map(([k, v]) => [k, [...v]])
                      ),
    taggedQuestionIds: Object.keys(state.taggedQuestions)
      .filter(id => state.taggedQuestions[id])
      .map(id => Number(id)),
    userNotes:        { ...state.userNotes },
    currentIndex:     state.currentIndex,
    reviewEnabled:    state.reviewEnabled,
  };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }
  catch (e) { console.warn('[Quiz Me] Could not save progress:', e); }
}

function getSavedProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)); }
  catch { return null; }
}

function clearSavedProgress() {
  localStorage.removeItem(PROGRESS_KEY);
}

function updateWelcomeButtons() {
  const hasProgress = getSavedProgress() !== null;
  DOM.btnContinue.classList.toggle('hidden', !hasProgress);
  DOM.btnRefreshSet.classList.toggle('hidden', hasProgress);
}

function renderHistory() {
  const history = getHistory();
  if (history.length === 0) {
    DOM.historyList.innerHTML = '';
    DOM.historyEmpty.classList.remove('hidden');
    return;
  }
  DOM.historyEmpty.classList.add('hidden');
  DOM.historyList.innerHTML = history.map((s, i) => {
    const label = s.label ? esc(s.label) : esc(s.timestamp);
    return `
    <div class="history-row" data-index="${i}">
      <button class="history-item" data-index="${i}" type="button">
        <div class="history-item-top">
          <span class="history-item-ts">${label}</span>
          <span class="history-item-badge ${s.passed ? 'pass' : 'fail'}">${s.passed ? 'Pass' : 'Fail'}</span>
        </div>
        <div class="history-item-meta">
          <span>${esc(s.metadata?.exam_code ?? 'Quiz')} &nbsp;·&nbsp; ${esc(s.timestamp)}</span>
          <span class="history-item-score">${s.score.scaled} / 1000 &nbsp;·&nbsp; ${s.score.correct}/${s.score.total} correct</span>
        </div>
      </button>
      <div class="history-item-actions">
        <button class="btn-history-action rename" data-index="${i}" title="Rename" aria-label="Rename quiz">✏️</button>
        <button class="btn-history-action delete" data-index="${i}" title="Delete" aria-label="Delete quiz">🗑️</button>
      </div>
    </div>`;
  }).join('');

  DOM.historyList.querySelectorAll('.history-item').forEach(btn => {
    btn.addEventListener('click', () => loadPastSession(history[+btn.dataset.index], +btn.dataset.index));
  });

  DOM.historyList.querySelectorAll('.btn-history-action.rename').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.index;
      const current = history[idx].label || history[idx].timestamp;
      const newLabel = prompt('Rename this quiz:', current);
      if (newLabel === null) return;           // cancelled
      const trimmed = newLabel.trim();
      if (!trimmed) return;
      const all = getHistory();
      all[idx].label = trimmed;
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(all)); } catch (e) { console.warn(e); }
      renderHistory();
    });
  });

  DOM.historyList.querySelectorAll('.btn-history-action.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.index;
      const label = history[idx].label || history[idx].timestamp;
      if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
      const all = getHistory();
      all.splice(idx, 1);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(all)); } catch (e) { console.warn(e); }
      renderHistory();
    });
  });
}

function loadPastSession(session, historyIndex = -1) {
  state.metadata       = { ...session.metadata };
  state.questions      = session.questions.map(q => ({ ...q, options: [...q.options], answer: [...q.answer] }));
  state.userAnswers    = Object.fromEntries(
                           Object.entries(session.userAnswers).map(([k, v]) => [k, [...v]])
                         );
  state.taggedQuestions = Object.fromEntries(
    (session.taggedQuestionIds ?? []).map(id => [id, true])
  );
  state.userNotes         = { ...(session.userNotes ?? {}) };
  state.reviewEnabled     = true;
  state.quizMode          = 'exam';
  state.reviewTaggedOnly  = false;
  state.isReviewMode      = false;
  state.viewingSession    = true;
  state.viewingSessionIndex = historyIndex;
  state.sessionSaved      = true; // prevent re-saving a historical session
  showResults();
}

// ── History Actions ────────────────────────────────────────────────────────────
DOM.btnHistoryOpen.addEventListener('click', () => {
  renderHistory();
  showScreen('history');
});

DOM.btnHistoryBack.addEventListener('click', () => {
  showScreen('welcome');
});

DOM.btnRefreshSet.addEventListener('click', () => {
  DOM.inpBankFile.value = '';
  DOM.inpBankFile.click();
});

DOM.inpBankFile.addEventListener('change', async () => {
  const file = DOM.inpBankFile.files[0];
  if (!file) return;

  DOM.btnRefreshSet.disabled = true;
  DOM.btnStart.disabled = true;
  DOM.loadError.classList.add('hidden');
  setRefreshStatus(`Reading "${file.name}"…`, 'info');

  try {
    const text = await file.text();
    let bankData;
    try {
      bankData = JSON.parse(text);
    } catch {
      throw new Error('The selected file is not valid JSON.');
    }
    if (!Array.isArray(bankData.questions) || bankData.questions.length === 0) {
      throw new Error('Invalid question bank: missing or empty questions[].');
    }

    setRefreshStatus(`Uploading "${file.name}" and generating question set…`, 'info');

    const res = await fetch('/api/upload-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bank-Filename': file.name },
      body: text,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Upload failed with HTTP ${res.status}`);
    }

    await loadQuestionSet();
    const generatedAt = state.metadata.generated_at || new Date().toISOString();
    setRefreshStatus(`Question set generated from "${file.name}" at ${generatedAt}.`, 'success');
  } catch (err) {
    console.error('[Quiz Me] Failed to upload question bank:', err);
    setRefreshStatus(err.message, 'error');
  } finally {
    DOM.btnRefreshSet.disabled = false;
    DOM.btnStart.disabled = state.allQuestions.length === 0;
  }
});

// ── Init: Load Questions ───────────────────────────────────────────────────────
// ── Note input handler ──────────────────────────────────────────────────────
DOM.qNoteArea.addEventListener('input', () => {
  const activeQuestions = getActiveQuestions();
  const q = activeQuestions[state.currentIndex];
  if (!q) return;
  const val = DOM.qNoteArea.value;
  if (val) {
    state.userNotes[q.id] = val;
  } else {
    delete state.userNotes[q.id];
  }

  // Persist notes back to the history entry when reviewing a past session
  if (state.viewingSession && state.viewingSessionIndex >= 0) {
    const history = getHistory();
    if (history[state.viewingSessionIndex]) {
      history[state.viewingSessionIndex].userNotes = { ...state.userNotes };
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
      catch (e) { console.warn('[Quiz Me] Could not save note to history:', e); }
    }
  }
});

// ── Answer Correction ──────────────────────────────────────────────────────────
DOM.btnCorrectStart.addEventListener('click', () => {
  const activeQuestions = getActiveQuestions();
  const q = activeQuestions[state.currentIndex];
  if (!q) return;
  state.correctingAnswer = true;
  state.correctionSelection = [...q.answer];
  state._correctionQuestionIdx = state.currentIndex;
  renderQuestion();
});

DOM.btnCorrectCancel.addEventListener('click', () => {
  state.correctingAnswer = false;
  state.correctionSelection = [];
  renderQuestion();
});

DOM.btnCorrectSave.addEventListener('click', async () => {
  const activeQuestions = getActiveQuestions();
  const q = activeQuestions[state.currentIndex];
  if (!q || state.correctionSelection.length === 0) {
    alert('Please select at least one correct answer.');
    return;
  }

  const correctTexts = state.correctionSelection.map(idx => q.options[idx]);

  try {
    DOM.btnCorrectSave.disabled = true;
    DOM.btnCorrectSave.textContent = 'Saving\u2026';

    const res = await fetch('/api/correct-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bank_id: q.bank_id,
        correct_option_texts: correctTexts,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      alert(data.message || 'Failed to save correction.');
      return;
    }

    // Update the current (possibly shuffled) question's answer
    const newShuffledAnswer = [];
    for (const text of data.correct_option_texts) {
      const idx = q.options.indexOf(text);
      if (idx >= 0) newShuffledAnswer.push(idx);
    }
    q.answer = newShuffledAnswer;

    // Update allQuestions (original order, by bank_id)
    const allQ = state.allQuestions.find(aq => aq.bank_id === q.bank_id);
    if (allQ) {
      allQ.answer = data.bank_answer;
      if (data.correct_option_labels) allQ.correct_option_labels = data.correct_option_labels;
      if (data.correct_option_texts)  allQ.correct_option_texts  = data.correct_option_texts;
    }

    // Update history entry if viewing a past session
    if (state.viewingSession && state.viewingSessionIndex >= 0) {
      const history = getHistory();
      const session = history[state.viewingSessionIndex];
      if (session) {
        const histQ = session.questions.find(hq => hq.bank_id === q.bank_id);
        if (histQ) histQ.answer = newShuffledAnswer;
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
        catch (e) { console.warn(e); }
      }
    }

    state.correctingAnswer = false;
    state.correctionSelection = [];
    renderQuestion();
  } catch (err) {
    alert('Failed to save correction: ' + err.message);
  } finally {
    DOM.btnCorrectSave.disabled = false;
    DOM.btnCorrectSave.textContent = 'Save Correction';
  }
});

(async function init() {
  try {
    await loadQuestionSet();
    setRefreshStatus('', '');
  } catch (err) {
    console.error('[Quiz Me] Failed to load questions:', err);
    DOM.loadError.classList.remove('hidden');
    DOM.btnStart.disabled = true;
    DOM.btnStart.textContent = 'Questions unavailable';
    setRefreshStatus('Could not load questions set.', 'error');
  }
  updateWelcomeButtons();
})();

// ── Mode Description Toggle ────────────────────────────────────────────────────
document.querySelectorAll('input[name="quiz-mode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    DOM.modeDesc.textContent = radio.value === 'study'
      ? 'Get instant feedback after each answer. No history saved.'
      : 'Answer all questions, then see your score and review.';
  });
});
