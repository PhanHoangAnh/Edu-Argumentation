#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

function parseArgs(argv) {
    const options = {
        input: null,
        output: null,
        title: null,
        questions: 10,
        maxChars: 60000,
        requestTimeoutMs: 120000,
        retries: 3
    };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--input' || arg === '-i') options.input = argv[++index];
        else if (arg === '--output' || arg === '-o') options.output = argv[++index];
        else if (arg === '--title' || arg === '-t') options.title = argv[++index];
        else if (arg === '--questions' || arg === '-q') options.questions = Number(argv[++index]);
        else if (arg === '--max-chars') options.maxChars = Number(argv[++index]);
        else if (arg === '--request-timeout-ms') options.requestTimeoutMs = Number(argv[++index]);
        else if (arg === '--retries') options.retries = Number(argv[++index]);
    }

    return options;
}

function stripCodeFences(text) {
    if (typeof text !== 'string') return text;
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/```\s*$/, '').trim();
    } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/```\s*$/, '').trim();
    }
    return cleaned;
}

function splitTextIntoChunks(text, maxChars) {
    const paragraphs = text
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);

    const chunks = [];
    let currentChunk = '';

    const pushCurrentChunk = () => {
        const chunk = currentChunk.trim();
        if (chunk) chunks.push(chunk);
        currentChunk = '';
    };

    for (const paragraph of paragraphs) {
        if (paragraph.length > maxChars) {
            pushCurrentChunk();
            const lines = paragraph.split('\n').map(line => line.trim()).filter(Boolean);
            let lineChunk = '';

            for (const line of lines) {
                if ((lineChunk + '\n' + line).trim().length > maxChars && lineChunk.trim()) {
                    chunks.push(lineChunk.trim());
                    lineChunk = line;
                } else {
                    lineChunk = lineChunk ? `${lineChunk}\n${line}` : line;
                }
            }

            if (lineChunk.trim()) {
                chunks.push(lineChunk.trim());
            }
            continue;
        }

        const nextChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
        if (nextChunk.length > maxChars && currentChunk.trim()) {
            pushCurrentChunk();
            currentChunk = paragraph;
        } else {
            currentChunk = nextChunk;
        }
    }

    pushCurrentChunk();
    return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

function distributeQuestions(totalQuestions, chunkCount) {
    const safeChunkCount = Math.max(1, chunkCount);
    const base = Math.floor(totalQuestions / safeChunkCount);
    let remainder = totalQuestions % safeChunkCount;

    return Array.from({ length: safeChunkCount }, () => {
        const value = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        return Math.max(1, value);
    });
}

function buildPrompt(bookTitle, bookText, questionCount, chunkIndex, chunkCount) {
    return `SYSTEM ROLE

You are an expert instructional designer, subject matter expert, and question writer.
Your task is to read a book excerpt and convert it into a learning module that helps students study.

OBJECTIVE

Generate a single, valid JSON object containing exactly two root keys: tutorialData and quizData.
Use only the supplied book text. Do not introduce facts that are not grounded in the source.
This is chunk ${chunkIndex + 1} of ${chunkCount}. Focus only on the material present in this excerpt.

CONTENT RULES

1. Write the tutorial as a clear study guide with 3 to 4 sections.
2. Keep each section focused on a major concept, chapter, or theme from the excerpt.
3. Generate exactly ${questionCount} advanced, scenario-based questions for this chunk.
4. Each question must test understanding of the book, not simple memorization.
5. Every quiz question must have exactly 4 options and exactly 4 explanations.
6. Use Markdown and LaTeX where helpful.
7. Output valid JSON only. No markdown fences, no commentary, no code blocks.

JSON SHAPE

{
  "tutorialData": {
    "title": "String",
    "lead": "String",
    "sections": [
      {
        "title": "String",
        "themeColor": "indigo-500 | emerald-500 | purple-500 | teal-500 | amber-500",
        "items": [
          {
            "term": "String",
            "blocks": [
              { "type": "text", "content": "String" },
              { "type": "card", "title": "Optional", "content": "Optional", "bullets": ["String"] },
              { "type": "callout", "title": "String", "items": ["String"] }
            ]
          }
        ]
      }
    ]
  },
  "quizData": [
    {
      "question": "String",
      "options": ["String", "String", "String", "String"],
      "correct": 0,
      "explanations": ["String", "String", "String", "String"]
    }
  ]
}

BOOK TITLE
${bookTitle || 'Untitled Book'}

BOOK TEXT
${bookText}`;
}

function validateModule(moduleData) {
    if (!moduleData || typeof moduleData !== 'object') {
        throw new Error('Model output must be a JSON object.');
    }

    const tutorialData = moduleData.tutorialData;
    const quizData = moduleData.quizData;

    if (!tutorialData || typeof tutorialData !== 'object') {
        throw new Error('Missing tutorialData object in model output.');
    }

    if (!Array.isArray(tutorialData.sections)) {
        throw new Error('tutorialData.sections must be an array.');
    }

    if (!Array.isArray(quizData)) {
        throw new Error('quizData must be an array.');
    }

    const validQuizData = quizData.filter(question => {
        return question
            && typeof question.question === 'string'
            && Array.isArray(question.options)
            && question.options.length === 4
            && Number.isInteger(question.correct)
            && question.correct >= 0
            && question.correct < 4
            && Array.isArray(question.explanations)
            && question.explanations.length === 4;
    });

    return {
        tutorialData: {
            title: typeof tutorialData.title === 'string' ? tutorialData.title : 'Learning Module',
            lead: typeof tutorialData.lead === 'string' ? tutorialData.lead : '',
            sections: tutorialData.sections
        },
        quizData: validQuizData
    };
}

function mergeModules(modules, bookTitle) {
    const mergedSections = [];
    const seenSectionTitles = new Set();
    const mergedQuizData = [];
    const seenQuestions = new Set();

    for (const moduleData of modules) {
        const normalizedModule = validateModule(moduleData);

        for (const section of normalizedModule.tutorialData.sections) {
            const sectionKey = String(section.title || '').trim().toLowerCase();
            if (!sectionKey || seenSectionTitles.has(sectionKey)) continue;
            seenSectionTitles.add(sectionKey);
            mergedSections.push(section);
        }

        for (const question of normalizedModule.quizData) {
            const questionKey = String(question.question || '').trim().toLowerCase();
            if (!questionKey || seenQuestions.has(questionKey)) continue;
            seenQuestions.add(questionKey);
            mergedQuizData.push(question);
        }
    }

    return {
        tutorialData: {
            title: bookTitle,
            lead: `Study guide generated from ${modules.length} excerpt chunk${modules.length === 1 ? '' : 's'}.`,
            sections: mergedSections
        },
        quizData: mergedQuizData
    };
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateChunkModule({ apiKey, bookTitle, chunkText, questionCount, chunkIndex, chunkCount, requestTimeoutMs, retries }) {
    const promptText = buildPrompt(bookTitle, chunkText, questionCount, chunkIndex, chunkCount);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }],
                    generationConfig: {
                        temperature: 0.4,
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'OBJECT',
                            properties: {
                                tutorialData: {
                                    type: 'OBJECT',
                                    properties: {
                                        title: { type: 'STRING' },
                                        lead: { type: 'STRING' },
                                        sections: {
                                            type: 'ARRAY',
                                            items: {
                                                type: 'OBJECT',
                                                properties: {
                                                    title: { type: 'STRING' },
                                                    themeColor: { type: 'STRING' },
                                                    items: { type: 'ARRAY' }
                                                },
                                                required: ['title', 'themeColor', 'items']
                                            }
                                        }
                                    },
                                    required: ['title', 'lead', 'sections']
                                },
                                quizData: {
                                    type: 'ARRAY',
                                    items: {
                                        type: 'OBJECT',
                                        properties: {
                                            question: { type: 'STRING' },
                                            options: { type: 'ARRAY', items: { type: 'STRING' } },
                                            correct: { type: 'INTEGER' },
                                            explanations: { type: 'ARRAY', items: { type: 'STRING' } }
                                        },
                                        required: ['question', 'options', 'correct', 'explanations']
                                    }
                                }
                            },
                            required: ['tutorialData', 'quizData']
                        }
                    }
                })
            }, requestTimeoutMs);

            if (!response.ok) {
                throw new Error(`Gemini request failed with status ${response.status}`);
            }

            const payload = await response.json();
            if (!payload.candidates || payload.candidates.length === 0) {
                throw new Error('No model candidates returned.');
            }

            const rawOutput = payload.candidates[0].content.parts[0].text;
            const parsed = JSON.parse(stripCodeFences(rawOutput));
            return validateModule(parsed);
        } catch (error) {
            if (attempt === retries) {
                throw new Error(`Chunk ${chunkIndex + 1} failed after ${retries} attempts: ${error.message}`);
            }
            await sleep(1500 * attempt);
        }
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.input) {
        console.error('Usage: node book_to_questions.js --input <book.txt> [--output <module.json>] [--title <book title>] [--questions 10]');
        process.exit(1);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('Set GEMINI_API_KEY in your environment before running the generator.');
    }

    const inputPath = path.resolve(args.input);
    const rawText = await fs.readFile(inputPath, 'utf8');
    const bookTitle = args.title || path.basename(inputPath, path.extname(inputPath));
    const trimmedText = rawText.replace(/\r\n/g, '\n').trim();

    if (!trimmedText) {
        throw new Error('Input file is empty after trimming.');
    }

    if (typeof fetch !== 'function') {
        throw new Error('This script requires a Node.js runtime with global fetch support.');
    }

    const chunks = splitTextIntoChunks(trimmedText, Math.max(1000, args.maxChars));
    const questionDistribution = distributeQuestions(args.questions, chunks.length);
    const chunkModules = [];

    for (let index = 0; index < chunks.length; index++) {
        const moduleData = await generateChunkModule({
            apiKey,
            bookTitle,
            chunkText: chunks[index],
            questionCount: questionDistribution[index],
            chunkIndex: index,
            chunkCount: chunks.length,
            requestTimeoutMs: args.requestTimeoutMs,
            retries: Math.max(1, args.retries)
        });
        chunkModules.push(moduleData);
    }

    const mergedModule = mergeModules(chunkModules, bookTitle);
    mergedModule.quizData = mergedModule.quizData.slice(0, args.questions);
    const formatted = JSON.stringify(mergedModule, null, 2);

    if (args.output) {
        const outputPath = path.resolve(args.output);
        await fs.writeFile(outputPath, formatted, 'utf8');
        console.log(`Wrote learning module to ${outputPath}`);
    } else {
        process.stdout.write(`${formatted}\n`);
    }
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});