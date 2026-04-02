'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BANK_PATH = path.join(ROOT, 'question_bank.json');
const SET_PATH = path.join(ROOT, 'questions_set.json');

const DEFAULT_SELECTION_SIZE = 65;

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function weightForQuestion(q) {
  const t = Number.isFinite(q.times_selected) ? q.times_selected : 0;
  // Lower times_selected => higher chance, while still keeping randomness.
  return 1 / (t + 1);
}

function weightedPickIndex(items) {
  const weights = items.map(weightForQuestion);
  const total = weights.reduce((sum, w) => sum + w, 0);

  if (total <= 0) {
    return Math.floor(Math.random() * items.length);
  }

  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }

  return items.length - 1;
}

function pickQuestionsWeighted(allQuestions, selectionSize) {
  const pool = [...allQuestions];
  const picked = [];
  const count = Math.min(selectionSize, pool.length);

  for (let i = 0; i < count; i++) {
    const idx = weightedPickIndex(pool);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return picked;
}

function normalizeQuestion(question, index) {
  const normalized = {
    id: index + 1,
    source_id: question.source_id,
    bank_id: question.bank_id,
    type: question.type,
    domain: question.domain,
    text: question.text,
    options: Array.isArray(question.options) ? question.options : [],
    answer: Array.isArray(question.answer) ? question.answer : [],
    explanation: question.explanation || '',
    times_selected: Number.isFinite(question.times_selected) ? question.times_selected : 0,
  };

  if (Array.isArray(question.correct_option_labels)) {
    normalized.correct_option_labels = question.correct_option_labels;
  }

  if (Array.isArray(question.correct_option_texts)) {
    normalized.correct_option_texts = question.correct_option_texts;
  }

  return normalized;
}

function refreshQuestionSet(bankData, bankSourceName) {
  const bank = bankData || readJson(BANK_PATH);
  if (!Array.isArray(bank.questions)) {
    throw new Error('Invalid question bank: missing questions[]');
  }

  for (const q of bank.questions) {
    if (!Number.isFinite(q.times_selected)) q.times_selected = 0;
  }

  const selectionSize = Number.isFinite(bank?.exam_metadata?.selection_size)
    ? bank.exam_metadata.selection_size
    : DEFAULT_SELECTION_SIZE;

  const selected = pickQuestionsWeighted(bank.questions, selectionSize);

  for (const q of selected) {
    q.times_selected = (Number.isFinite(q.times_selected) ? q.times_selected : 0) + 1;
  }

  const setData = {
    exam_metadata: {
      exam_code: bank?.exam_metadata?.exam_code || 'SAA-C03',
      passing_score: bank?.exam_metadata?.passing_score || 720,
      source: 'question_bank.json',
      bank_source_name: bankSourceName || bank?.exam_metadata?.source || 'question_bank.json',
      selection: `${Math.min(selectionSize, bank.questions.length)} weighted-random questions (lower times_selected is prioritized)`,
      counter_field: 'times_selected',
      generated_at: new Date().toISOString(),
    },
    questions: selected.map((q, idx) => normalizeQuestion(q, idx)),
  };

  // Only write the updated counters back if using the default on-disk bank.
  if (!bankData) {
    writeJson(BANK_PATH, bank);
  }
  writeJson(SET_PATH, setData);

  return {
    selected_count: setData.questions.length,
    generated_at: setData.exam_metadata.generated_at,
  };
}

if (require.main === module) {
  try {
    const result = refreshQuestionSet();
    console.log(`questions_set.json refreshed with ${result.selected_count} questions at ${result.generated_at}`);
  } catch (err) {
    console.error('Failed to refresh question set:', err.message);
    process.exit(1);
  }
}

module.exports = {
  refreshQuestionSet,
};
