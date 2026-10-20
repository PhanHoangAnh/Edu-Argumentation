#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const appUrl = new URL(process.env.EDU_ARGUMENTATION_URL || 'http://127.0.0.1:8000');
const modulePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, 'data', 'Deployment-MLOps.json');

function validateQuestions(questions) {
    if (!Array.isArray(questions) || questions.length !== 20) {
        throw new Error(`Expected 20 generated questions, received ${Array.isArray(questions) ? questions.length : 'invalid data'}.`);
    }

    questions.forEach((question, index) => {
        const prefix = `Question ${index + 1}`;
        if (!question || typeof question.question !== 'string' || !question.question.trim()) {
            throw new Error(`${prefix} has no question text.`);
        }
        if (!Array.isArray(question.options) || question.options.length !== 4
            || question.options.some(option => typeof option !== 'string' || !option.trim())) {
            throw new Error(`${prefix} must contain four non-empty options.`);
        }
        if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3) {
            throw new Error(`${prefix} has an invalid correct-answer index.`);
        }
        if (!Array.isArray(question.explanations) || question.explanations.length !== 4
            || question.explanations.some(explanation => typeof explanation !== 'string' || !explanation.trim())) {
            throw new Error(`${prefix} must contain four non-empty explanations.`);
        }
    });
}

async function main() {
    const moduleData = JSON.parse(await fs.readFile(modulePath, 'utf8'));
    if (!moduleData.tutorialData || !Array.isArray(moduleData.quizData)) {
        throw new Error('Input module must contain tutorialData and quizData.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 370_000);
    let response;
    try {
        response = await fetch(new URL('/api/ai-quiz', appUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                tutorialData: moduleData.tutorialData,
                quizData: moduleData.quizData
            })
        });
    } finally {
        clearTimeout(timeout);
    }

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || `AI server returned HTTP ${response.status}.`);
    }

    validateQuestions(payload);
    console.log(`Gemini smoke test passed: generated ${payload.length} valid questions using ${modulePath}.`);
}

main().catch(error => {
    console.error(`Gemini smoke test failed: ${error.message}`);
    process.exitCode = 1;
});
