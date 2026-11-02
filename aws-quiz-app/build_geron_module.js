#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const FIRST_CHAPTER = 1;
const LAST_CHAPTER = 9;
const SOURCE_DIR = path.resolve(__dirname, '../../learn-app/content');
const OUTPUT_PATH = path.resolve(__dirname, 'data/geron_hands_on_ml_ch01_ch09.json');
const THEME_COLORS = ['indigo-500', 'emerald-500', 'purple-500', 'teal-500', 'amber-500'];
const SUPPORTED_QUIZ_TYPES = new Set(['multiple_choice', 'true_false']);

function chapterFilename(chapterNumber) {
    return `ch${String(chapterNumber).padStart(2, '0')}.json`;
}

function asMarkdownCode(code) {
    if (!code || !code.source) return null;
    const language = code.language || 'text';
    return `\`\`\`${language}\n${code.source}\n\`\`\``;
}

function convertBlock(block) {
    const blocks = [{ type: 'text', content: block.body_md || '' }];
    const codeContent = asMarkdownCode(block.code);

    if (codeContent) {
        blocks.push({
            type: 'card',
            title: `${block.code.language || 'Code'} example`,
            content: codeContent,
            variant: 'example'
        });
    }

    if (block.exercise && block.exercise.prompt) {
        blocks.push({
            type: 'callout',
            title: 'Book exercise',
            items: [block.exercise.prompt]
        });
    }

    return {
        term: block.title,
        blocks
    };
}

function convertChapterItems(chapter) {
    const items = chapter.blocks.map(convertBlock);
    const bookExercises = Array.isArray(chapter.book_exercises) ? chapter.book_exercises : [];

    if (bookExercises.length > 0) {
        items.push({
            term: 'End-of-chapter exercises',
            blocks: [{
                type: 'callout',
                title: `${bookExercises.length} book exercises`,
                items: bookExercises.map(exercise => `Exercise ${exercise.number}: ${exercise.prompt}`)
            }]
        });
    }

    return items;
}

function explanationForOption(question, optionIndex, correctIndex) {
    if (optionIndex === correctIndex) return question.explanation;
    return `Review the chapter explanation: ${question.explanation}`;
}

function convertQuizQuestion(question, chapterNumber) {
    let options;

    if (question.type === 'multiple_choice') {
        options = question.options;
    } else if (question.type === 'true_false') {
        options = ['True', 'False'];
    } else {
        return null;
    }

    const correctIndex = options.indexOf(question.correct);
    if (correctIndex < 0) {
        throw new Error(`Question ${question.id} has a correct answer that is not in its options.`);
    }

    return {
        question: question.prompt,
        options,
        correct: correctIndex,
        explanations: options.map((_, index) => explanationForOption(question, index, correctIndex)),
        source: {
            chapter: chapterNumber,
            block: question.block_ref,
            question: question.id
        }
    };
}

async function loadChapters() {
    const chapters = [];

    for (let chapterNumber = FIRST_CHAPTER; chapterNumber <= LAST_CHAPTER; chapterNumber++) {
        const filename = chapterFilename(chapterNumber);
        const sourcePath = path.join(SOURCE_DIR, filename);
        const chapter = JSON.parse(await fs.readFile(sourcePath, 'utf8'));

        if (chapter.status !== 'populated') {
            throw new Error(`${filename} is not populated; refusing to generate placeholder content.`);
        }
        if (chapter.chapter !== chapterNumber) {
            throw new Error(`${filename} declares chapter ${chapter.chapter}; expected ${chapterNumber}.`);
        }

        chapters.push(chapter);
    }

    return chapters;
}

function buildModule(chapters) {
    const skippedByType = {};
    const quizData = [];

    for (const chapter of chapters) {
        for (const question of chapter.quiz) {
            if (!SUPPORTED_QUIZ_TYPES.has(question.type)) {
                skippedByType[question.type] = (skippedByType[question.type] || 0) + 1;
                continue;
            }
            quizData.push(convertQuizQuestion(question, chapter.chapter));
        }
    }

    return {
        tutorialData: {
            title: 'Hands-On Machine Learning — Chapters 1–9',
            lead: 'Book-grounded study material and objective checks from the populated Géron learning pack.',
            sections: chapters.map((chapter, index) => ({
                title: `Chapter ${chapter.chapter}: ${chapter.title}`,
                note: `${chapter.blocks.length} theory blocks · pages ${chapter.page_range_total}`,
                themeColor: THEME_COLORS[index % THEME_COLORS.length],
                items: convertChapterItems(chapter)
            }))
        },
        quizData,
        generation: {
            source: '../learn-app/content/ch01.json through ch09.json',
            chapters: chapters.map(chapter => chapter.chapter),
            theoryBlocks: chapters.reduce((total, chapter) => total + chapter.blocks.length, 0),
            bookExercises: chapters.reduce((total, chapter) => total + (chapter.book_exercises || []).length, 0),
            objectiveQuestions: quizData.length,
            skippedFreeResponseQuestions: skippedByType,
            deterministic: true
        }
    };
}

function validateModule(moduleData) {
    if (!moduleData.tutorialData || !Array.isArray(moduleData.tutorialData.sections)) {
        throw new Error('Generated module is missing tutorialData.sections.');
    }
    if (!Array.isArray(moduleData.quizData) || moduleData.quizData.length === 0) {
        throw new Error('Generated module has no quizData.');
    }

    for (const question of moduleData.quizData) {
        if (!Array.isArray(question.options) || question.options.length < 2) {
            throw new Error(`Question ${question.source.question} has fewer than two options.`);
        }
        if (!Number.isInteger(question.correct) || !question.options[question.correct]) {
            throw new Error(`Question ${question.source.question} has an invalid correct index.`);
        }
        if (!Array.isArray(question.explanations) || question.explanations.length !== question.options.length) {
            throw new Error(`Question ${question.source.question} has mismatched explanations.`);
        }
    }
}

async function main() {
    // The shipped module is no longer this script's output alone: it also holds
    // chapters 10-19 from the importer, the 470 top-up questions and the book's
    // figures and equations. Rebuilding from ch01-ch09.json would erase all of it.
    if (!process.argv.includes('--force')) {
        try {
            await fs.access(OUTPUT_PATH);
            throw new Error(`${OUTPUT_PATH} already exists and carries content this script cannot rebuild ` +
                '(imported chapters, top-up questions, book assets). Refusing to overwrite it; pass --force only ' +
                'if you really mean to replace it with chapters 1-9 alone.');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    const chapters = await loadChapters();
    const moduleData = buildModule(chapters);
    validateModule(moduleData);
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(moduleData, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${moduleData.generation.theoryBlocks} theory blocks and ${moduleData.quizData.length} objective questions to ${OUTPUT_PATH}`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
