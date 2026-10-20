## Architecture & Mechanism Design

The **Edu-Argumentation / AWS Quiz App** is a lightweight, client-side web application designed to deliver interactive quizzes and educational modules using a modular vanilla JavaScript architecture.

The same JSON format can also be generated from longer source material such as book chapters. In that workflow, the AI reads the source text, extracts the important concepts, and produces a tutorial plus quiz set that students can use to study.

### Core Components

* **Static Data Layer (`aws-quiz-app/data/`)**: Contains the bundled course modules, questions, options, and explanations as JSON.
* **Front-End Interface (`aws-quiz-app/index.html` & `aws-quiz-app/js/app.js`)**: Built utilizing pure JavaScript, HTML5, and CSS without heavy framework overhead (avoiding React, opting for clean DOM management).
* **AI Worker / Integration (`aws-quiz-app/js/ai-worker.js` & `aws-quiz-app/server.js`)**: The worker requests dynamic scenarios from the same-origin Node API; the Gemini API key remains in the server environment, not browser code.
* **Book-to-Questions CLI (`book_to_questions.js`)**: Accepts text-based PDF, Markdown, or plain-text sources and generates the same `tutorialData` + `quizData` structure used by the web app.

### How It Works

1. **Initialization**: The main application (`aws-quiz-app/js/app.js`) loads the bundled `Deployment-MLOps.json` course on startup. Use the course selector in the header to switch to another bundled module, or upload a custom module JSON file.
2. **State Management**: The app saves the selected course, generated AI quiz (when applicable), answers, score, and question position in browser `localStorage`. Uploaded course JSON is stored locally in the same browser to allow resuming after a refresh.
3. **Interactive Evaluation**: When a user selects an answer, the app immediately validates it against the schema, updates the UI score counters, and pulls contextual explanations.
4. **AI Assistance**: A background worker requests scenarios from the Node server, which calls Gemini using its server-side environment key. The separate CLI also uses an environment key to turn book text into the same learning format.

### Book Input Workflow

If your assignment is to build an AI that reads books and generates learning questions, the cleanest path in this repository is:

1. Provide a text-based PDF, plain-text, or Markdown file. Scanned/image-only PDFs need OCR before processing.
2. Run `GEMINI_API_KEY="your-key" npm run generate:module -- --input chapter.pdf --output module.json` from `aws-quiz-app`.
3. Let Gemini return strict JSON with `tutorialData` and `quizData`.
4. Load that JSON directly into the existing web app.

This keeps the whole system simple: the book becomes the source of truth, and the app only needs one stable data contract.

---

## How to Use This Code

### Prerequisites

* A modern web browser (Chrome, Firefox, Edge, Safari).
* Node.js 20 or later for the built-in server, native `fetch`, and PDF text extraction.

### Running Locally

1. Clone or extract the repository folder.
2. Navigate into the application directory:
```bash
cd aws-quiz-app
npm install
```


3. Start the app server, optionally providing a Gemini key to enable AI question generation:
```bash
GEMINI_API_KEY="your-gemini-api-key" npm start
```

4. Open `http://localhost:8000`. The server binds to `127.0.0.1` by default. Without `GEMINI_API_KEY`, course and quiz features still work, but AI generation returns a configuration error. Do not expose this unauthenticated server directly to the public internet; add authentication and deployment-specific abuse protections before public hosting.

Run local unit tests with `npm test`. To run the Gemini smoke test, start the server with `GEMINI_API_KEY` set, then run `npm run test:gemini` from `aws-quiz-app` in another terminal. This makes a real Gemini request and generates 20 questions.

---

## Improvements for Later Versions

* **Modular Web Components**: Refactor UI elements into native Web Components with Shadow DOM for cleaner encapsulation and modular styling.
* **Enhanced Error Handling & Validation**: Adopt a shared JSON Schema contract to complement the current runtime validation of course data.
* **Dynamic AI Prompt Tuning**: Add customizable system instructions on the Node server for generating tailored practice questions.
* **Book Ingestion Pipeline**: Add OCR and user-facing import flow; text extraction for PDF, Markdown, and plain text plus chapter chunking are already supported.
