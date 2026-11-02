# Edu-Argumentation

Edu-Argumentation is a Géron tutorial and quiz interface. It bundles the populated study content from the adjacent Lakehouse learning app, keeps a local fresh-quiz mode, and can optionally generate new questions through a server-side OpenAI-compatible provider.

## Study navigation

The reader presents one theory block at a time. Its persistent table of contents opens a chapter and jumps directly to any block; the current location is shareable as a `#chapter=N&block=N` URL fragment. The browser never receives provider credentials.

## Optional AI quiz provider

`aws-quiz-app/edu_server.py` serves the static files and a same-origin `POST /api/quiz` gateway. It accepts an OpenAI-compatible Chat Completions endpoint, so it can be configured for OpenAI or a compatible hosted/local provider. The production systemd unit reads `/etc/foxai/edu-argumentation.env`, not a file in this repository.

1. Copy `aws-quiz-app/edu-argumentation.env.example` to `/etc/foxai/edu-argumentation.env` on `nn`.
2. Set the API URL, API key, model, and a long `EDU_QUIZ_ACCESS_TOKEN`; set the real file to `root:root` and mode `600`.
3. Install `aws-quiz-app/foxai-edu-argumentation.service`, reload systemd, and restart the service.
4. Enter only the short generation access token in the browser when generating a quiz. It is not the provider key and is not persisted.

The current service is plain HTTP on a private LAN. Do not expose this endpoint publicly or reuse the generation token outside a trusted network; deploy TLS and an authenticated application boundary first.

## Included learning material

- Chapters 1–9 from `../learn-app/content/ch01.json` through `ch09.json`
- 115 theory blocks rendered as nine tutorial sections
- 92 end-of-chapter exercise prompts
- 150 objective checks: 104 multiple-choice and 46 true/false questions
- Chapters 10–19 are excluded because their source files are stubs
- 88 short-answer and code-output checks remain in the source learning app and are not converted because this interface grades selectable options

The generated module lives at `aws-quiz-app/data/geron_hands_on_ml_ch01_ch09.json`. The browser loads it automatically. Uploading another JSON module through the header control still replaces the active module for that browser session.

## Rebuild the bundled module

Run the deterministic generator whenever the Géron source content changes:

```bash
node aws-quiz-app/build_geron_module.js
```

The script refuses to generate placeholder material if any chapter from 1 through 9 is not marked `populated`. It converts the existing theory text, code examples, book exercises, and objective checks without calling an external service.

## Run locally

Serve the repository through HTTP so the browser can fetch the bundled JSON and create the local quiz worker:

```bash
cd aws-quiz-app
python3 -m http.server 8000
```

Open `http://localhost:8000`. Use **Fresh Book Quiz** to sample up to 20 questions from the active module. Each request shuffles a copy of the question bank in a Web Worker; the bundled data remains unchanged.

## Data contract

The app accepts JSON with these root fields:

```json
{
  "tutorialData": {
    "title": "Module title",
    "lead": "Module description",
    "sections": []
  },
  "quizData": []
}
```

Each quiz entry contains `question`, `options`, a zero-based `correct` index, and one `explanations` entry per option.

This remains a client-side learning app. Correct answers are withheld by the interface until a choice is submitted, but they are present in the downloaded JSON and can be inspected with browser developer tools.
