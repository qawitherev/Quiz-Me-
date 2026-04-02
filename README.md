# Quiz Me -- AWS SAA-C03

A self-hosted, browser-based quiz application for practicing the **AWS Certified Solutions Architect -- Associate (SAA-C03)** exam. It randomly selects questions from a local question bank using weighted sampling (questions seen less often are picked more frequently) and presents them in an interactive single-page UI with scoring, review, and history tracking.

## Features

- Single and multiple-response question types
- Weighted random selection so less-practiced questions appear more often
- Shuffle questions and answer options
- Configurable number of questions per session (10, 30, or 65)
- Inline explanations and personal notes per question
- Tag questions for later review
- Score breakdown by exam domain
- Quiz history persisted in the browser (localStorage)
- Upload a custom question bank JSON file through the UI

## Prerequisites

- [Node.js](https://nodejs.org/) (no additional packages required -- the server uses only built-in modules)

## Getting Started

1. Clone the repository:

   ```
   git clone <repo-url>
   cd "Quiz Me!"
   ```

2. Start the server:

   ```
   node server.js
   ```

3. Open your browser and navigate to:

   ```
   http://localhost:8000
   ```

The server serves static files and exposes two API endpoints used by the UI:

- `POST /api/refresh-questions` -- picks a new weighted random set of 65 questions from the bank and writes it to `questions_set.json`.
- `POST /api/upload-bank` -- accepts a JSON question bank upload, replaces `question_bank.json`, and regenerates the question set.

## Project Structure

| File | Purpose |
|------|---------|
| `server.js` | HTTP server (Node.js, no dependencies) |
| `app.js` | Client-side quiz logic and UI state management |
| `index.html` | Single-page application markup |
| `styles.css` | Styles |
| `question_bank.json` | Full question bank |
| `questions_set.json` | Active subset of questions loaded by the UI |
| `refresh_questions_set.js` | Weighted sampling logic used by the server |
| `question_bank_gemini.json` | Alternate question bank |
| `AWS SAA-03 Solution.txt` | Answer key reference |

## Usage

1. On the welcome screen, configure your preferences (shuffle, show explanations, question count).
2. Click **Start Quiz** to begin a session.
3. Select answers, add notes, and tag questions you want to revisit.
4. After submitting, review your score and domain breakdown on the results screen.
5. Use **Review** to walk through all questions with explanations, or **Review Tagged** to focus on flagged items.
6. Past sessions are available from the **History** button on the welcome screen.

To refresh the question set with a new random selection, click **Upload Question Bank** on the welcome screen or call the refresh API directly.

## Configuration

The server listens on port `8000` by default. Override it with the `PORT` environment variable:

```
PORT=3000 node server.js
```

## License

This project does not include a license file. Add one if you plan to distribute it.
