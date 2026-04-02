'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { refreshQuestionSet } = require('./refresh_questions_set');

const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function safePathFromUrl(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relativePath = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.normalize(path.join(ROOT, relativePath));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        req.destroy();
        reject(new Error('Uploaded file exceeds the 20 MB limit.'));
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/refresh-questions') {
    try {
      const result = refreshQuestionSet();
      sendJson(res, 200, {
        ok: true,
        message: 'Question set refreshed successfully.',
        ...result,
      });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        message: err.message,
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/upload-bank') {
    try {
      const body = await readBody(req);
      let bankData;
      try {
        bankData = JSON.parse(body);
      } catch {
        return sendJson(res, 400, { ok: false, message: 'Request body is not valid JSON.' });
      }
      if (!Array.isArray(bankData.questions) || bankData.questions.length === 0) {
        return sendJson(res, 400, { ok: false, message: 'Invalid question bank: missing or empty questions[].' });
      }
      // Save uploaded bank to disk so corrections can target it later
      const bankPath = path.join(ROOT, 'question_bank.json');
      fs.writeFileSync(bankPath, JSON.stringify(bankData, null, 2) + '\n', 'utf8');
      const bankSourceName = req.headers['x-bank-filename'] || 'uploaded_bank.json';
      const result = refreshQuestionSet(null, bankSourceName);
      sendJson(res, 200, { ok: true, message: 'Question set generated from uploaded bank.', ...result });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/correct-answer') {
    try {
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body); } catch { return sendJson(res, 400, { ok: false, message: 'Invalid JSON.' }); }
      const { bank_id, correct_option_texts } = parsed;
      if (!bank_id || !Array.isArray(correct_option_texts) || correct_option_texts.length === 0) {
        return sendJson(res, 400, { ok: false, message: 'Missing bank_id or correct_option_texts.' });
      }

      // Read current question bank
      const bankPath = path.join(ROOT, 'question_bank.json');
      const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
      const bankQ = bank.questions.find(q => q.bank_id === bank_id);
      if (!bankQ) {
        const setPath = path.join(ROOT, 'questions_set.json');
        const setData = JSON.parse(fs.readFileSync(setPath, 'utf8'));
        const bankSource = setData.exam_metadata?.bank_source_name || 'unknown';
        return sendJson(res, 404, {
          ok: false,
          message: `Question "${bank_id}" not found in current question bank. It may be from a different bank ("${bankSource}"). Please re-upload that bank first.`,
        });
      }

      // Map option texts to indices in the bank's original option order
      const newAnswer = [];
      const newLabels = [];
      const newTexts = [];
      for (const text of correct_option_texts) {
        const idx = bankQ.options.indexOf(text);
        if (idx === -1) {
          return sendJson(res, 400, { ok: false, message: 'Option text not found in bank question.' });
        }
        newAnswer.push(idx);
        newLabels.push(String.fromCharCode(65 + idx));
        newTexts.push(text);
      }
      newAnswer.sort((a, b) => a - b);

      // Update bank question
      bankQ.answer = newAnswer;
      bankQ.correct_option_labels = newLabels;
      bankQ.correct_option_texts = newTexts;
      fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2) + '\n', 'utf8');

      // Update question set
      const setPath = path.join(ROOT, 'questions_set.json');
      const setData = JSON.parse(fs.readFileSync(setPath, 'utf8'));
      const setQ = (setData.questions || []).find(q => q.bank_id === bank_id);
      if (setQ) {
        setQ.answer = newAnswer;
        setQ.correct_option_labels = newLabels;
        setQ.correct_option_texts = newTexts;
        fs.writeFileSync(setPath, JSON.stringify(setData, null, 2) + '\n', 'utf8');
      }

      sendJson(res, 200, {
        ok: true,
        bank_answer: newAnswer,
        correct_option_labels: newLabels,
        correct_option_texts: newTexts,
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, message: err.message });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
    return;
  }

  const filePath = safePathFromUrl(req.url || '/');
  if (!filePath) {
    sendJson(res, 400, { ok: false, message: 'Bad request path.' });
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendJson(res, 404, { ok: false, message: 'Not found.' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.json' ? 'no-store' : 'no-cache',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Quiz app running at http://localhost:${PORT}`);
  console.log('Use the refresh button on the welcome screen to regenerate questions_set.json.');
});
