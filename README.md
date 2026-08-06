## Architecture & Mechanism Design

The **Edu-Argumentation / AWS Quiz App** is a lightweight, client-side web application designed to deliver interactive quizzes and educational modules using a modular vanilla JavaScript architecture.

The same JSON format can also be generated from longer source material such as book chapters. In that workflow, the AI reads the source text, extracts the important concepts, and produces a tutorial plus quiz set that students can use to study.

### Core Components

* **Static Data Layer (`/data/courseData.json` & `testModule.json`)**: Contains structured course modules, questions, options, and explanations.
* **Front-End Interface (`index.html` & `js/app.js`)**: Built utilizing pure JavaScript, HTML5, and CSS without heavy framework overhead (avoiding React, opting for clean DOM management).
* **AI Worker / Integration (`js/ai-worker.js` & `test_gemini.js`)**: Offloads background processing or handles dynamic generation of similar but different questions based on the context of the tutorial and static practice.
* **Book-to-Questions CLI (`book_to_questions.js`)**: Accepts a text book or chapter excerpt and generates the same `tutorialData` + `quizData` structure used by the web app.

### How It Works

1. **Initialization**: The main application (`app.js`) loads and parses the static JSON course data (`courseData.json`) upon startup.
2. **State Management**: It tracks user quiz progress, selected answers, scores, and active module states entirely within the browser's session/local state.
3. **Interactive Evaluation**: When a user selects an answer, the app immediately validates it against the schema, updates the UI score counters, and pulls contextual explanations.
4. **AI Assistance**: Background workers or test modules interface asynchronously to generate similar but different questions based on the context of the tutorial and static practice. A separate CLI can also turn book text into the same learning format.

### Book Input Workflow

If your assignment is to build an AI that reads books and generates learning questions, the cleanest path in this repository is:

1. Extract the book into plain text or markdown.
2. Pass the text into `book_to_questions.js`.
3. Let Gemini return strict JSON with `tutorialData` and `quizData`.
4. Load that JSON directly into the existing web app.

This keeps the whole system simple: the book becomes the source of truth, and the app only needs one stable data contract.

---

## How to Use This Code

### Prerequisites

* A modern web browser (Chrome, Firefox, Edge, Safari).
* A local development server (e.g., VS Code **Live Server** extension, Python `http.server`, or Node `http-server`) to prevent CORS issues when loading local JSON files.

### Running Locally

1. Clone or extract the repository folder.
2. Navigate into the application directory:
```bash
cd aws-quiz-app

```


3. Start a local server. For example, using Python:
```bash
python3 -m http.server 8000

```


4. Open your browser and navigate to `http://localhost:8000`.

---

## Improvements for Later Versions

* **State Persistence**: Implement `localStorage` or `IndexedDB` caching so users can resume quizzes where they left off if the browser accidentally closes.
* **Modular Web Components**: Refactor UI elements into native Web Components with Shadow DOM for cleaner encapsulation and modular styling.
* **Enhanced Error Handling & Validation**: Add schema validation (using JSON Schema) for incoming course data to gracefully handle malformed JSON inputs.
* **Dynamic AI Prompt Tuning**: Upgrade the `ai-worker.js` implementation to support customizable system instructions for generating tailored practice questions.
* **Book Ingestion Pipeline**: Add PDF/text extraction plus chapter chunking so longer books can be processed without manually copying excerpts.
