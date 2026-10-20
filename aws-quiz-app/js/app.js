let currentQuestionIndex = 0;
let score = 0;
let isAnswered = false;
let activeQuizData = [];
let quizData = [];
let tutorialData = {};
let cachedAiData = null;
let courseLoadRequest = 0;
let currentCoursePath = null;
let answers = [];
let persistenceError = '';
let progressWarning = '';
let activeAiWorker = null;

const PROGRESS_STORAGE_KEY = 'edu-argumentation-progress-v1';

const dom = {
    appContainer: document.getElementById('app-container'),
    landingDashboard: document.getElementById('landing-dashboard'),
    contentSection: document.getElementById('content-section'),
    servicesSection: document.getElementById('services-section'),
    
    emptyState: document.getElementById('empty-state'),
    welcomeScreen: document.getElementById('welcome-screen'),
    loadingScreen: document.getElementById('loading-screen'),
    
    tutorialScreen: document.getElementById('tutorial-screen'),
    quizScreen: document.getElementById('quiz-screen'),
    resultScreen: document.getElementById('result-screen'),
    
    appSubTitle: document.getElementById('app-sub-title'),
    welcomeTitle: document.getElementById('welcome-title'),
    
    startBtn: document.getElementById('start-btn'),
    readTutorialBtn: document.getElementById('read-tutorial-btn'),
    tutorialToQuizBtn: document.getElementById('tutorial-to-quiz-btn'),
    navTutorial: document.getElementById('nav-tutorial'),
    navQuiz: document.getElementById('nav-quiz'),
    navAiQuiz: document.getElementById('nav-ai-quiz'),
    startAiBtn: document.getElementById('start-ai-btn'),
    customDataUpload: document.getElementById('custom-data-upload'),
    bundledCourseSelect: document.getElementById('bundled-course-select'),
    courseLoadStatus: document.getElementById('course-load-status'),
    
    tutorialContent: document.getElementById('tutorial-content'),
    tutorialTitle: document.getElementById('tutorial-main-title'),
    tutorialLead: document.getElementById('tutorial-lead'),
    
    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),
    questionNumberBadge: document.getElementById('question-number-badge'),
    scoreTracker: document.getElementById('score-tracker'),
    
    actionContainer: document.getElementById('action-container'),
    nextBtn: document.getElementById('next-btn'),
    nextBtnText: document.getElementById('next-btn-text'),
    retakeBtnHeader: document.getElementById('retake-btn-header'),
    
    finalScore: document.getElementById('final-score'),
    finalFraction: document.getElementById('final-fraction'),
    resultMessage: document.getElementById('result-message'),
    restartBtn: document.getElementById('restart-btn'),
    generateNewAiBtn: document.getElementById('generate-new-ai-btn'),
    
    progressContainer: document.getElementById('progress-container'),
    progressBar: document.getElementById('progress-bar')
};

const templates = {
    tutorialSection: document.getElementById('tmpl-tutorial-section'),
    tutorialListItem: document.getElementById('tmpl-tutorial-list-item'),
    quizOption: document.getElementById('tmpl-quiz-option')
};

function setAppState(isReady, moduleName = null) {
    if (dom.appSubTitle && dom.welcomeTitle) {
        if (moduleName) {
            dom.appSubTitle.textContent = "Active Module: " + moduleName;
            dom.welcomeTitle.textContent = moduleName;
        } else {
            dom.appSubTitle.textContent = "Education is the movement from darkness to light";
        }
    }
    
    if (!isReady) {
        dom.emptyState.classList.remove('hidden-view');
        dom.welcomeScreen.classList.add('hidden-view');
    } else {
        dom.emptyState.classList.add('hidden-view');
        dom.welcomeScreen.classList.remove('hidden-view');
    }
    
    const controls = [dom.readTutorialBtn, dom.startBtn, dom.startAiBtn];
    controls.forEach(btn => {
        if (!btn) return;
        btn.disabled = !isReady;
    });
}

function validateCourseModule(data) {
    const requireObject = (value, path) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${path} must be an object.`);
        }
    };
    const requireText = (value, path) => {
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`${path} must be a non-empty string.`);
        }
    };
    const validateTextArray = (value, path) => {
        if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
            throw new Error(`${path} must be an array of non-empty strings.`);
        }
    };

    requireObject(data, 'Course data');
    requireObject(data.tutorialData, 'tutorialData');
    requireText(data.tutorialData.title, 'tutorialData.title');
    if (data.tutorialData.lead !== undefined && typeof data.tutorialData.lead !== 'string') {
        throw new Error('tutorialData.lead must be a string.');
    }
    if (!Array.isArray(data.tutorialData.sections) || data.tutorialData.sections.length === 0) {
        throw new Error('tutorialData.sections must be a non-empty array.');
    }

    data.tutorialData.sections.forEach((section, sectionIndex) => {
        const sectionPath = `tutorialData.sections[${sectionIndex}]`;
        requireObject(section, sectionPath);
        requireText(section.title, `${sectionPath}.title`);
        if (section.note !== undefined && typeof section.note !== 'string') {
            throw new Error(`${sectionPath}.note must be a string.`);
        }
        if (!Array.isArray(section.items) || section.items.length === 0) {
            throw new Error(`${sectionPath}.items must be a non-empty array.`);
        }

        section.items.forEach((item, itemIndex) => {
            const itemPath = `${sectionPath}.items[${itemIndex}]`;
            if (typeof item === 'string') {
                requireText(item, itemPath);
                return;
            }

            requireObject(item, itemPath);
            if (item.term !== undefined) requireText(item.term, `${itemPath}.term`);
            if (!Array.isArray(item.blocks)) {
                throw new Error(`${itemPath}.blocks must be an array.`);
            }

            item.blocks.forEach((block, blockIndex) => {
                const blockPath = `${itemPath}.blocks[${blockIndex}]`;
                requireObject(block, blockPath);
                if (block.type === 'text') {
                    requireText(block.content, `${blockPath}.content`);
                } else if (block.type === 'media') {
                    if (block.mediaType !== 'image') {
                        throw new Error(`${blockPath}.mediaType must be "image".`);
                    }
                    requireText(block.src, `${blockPath}.src`);
                    if (block.alt !== undefined && typeof block.alt !== 'string') {
                        throw new Error(`${blockPath}.alt must be a string.`);
                    }
                } else if (block.type === 'card') {
                    for (const field of ['title', 'intro', 'content']) {
                        if (block[field] !== undefined) requireText(block[field], `${blockPath}.${field}`);
                    }
                    if (block.bullets !== undefined) {
                        validateTextArray(block.bullets, `${blockPath}.bullets`);
                    }
                } else if (block.type === 'callout') {
                    if (block.title !== undefined) requireText(block.title, `${blockPath}.title`);
                    validateTextArray(block.items, `${blockPath}.items`);
                } else {
                    throw new Error(`${blockPath}.type must be text, media, card, or callout.`);
                }
            });

            if (!item.term && item.blocks.length === 0) {
                throw new Error(`${itemPath} must contain a term or at least one block.`);
            }
        });
    });

    if (!Array.isArray(data.quizData)) {
        throw new Error('quizData must be an array.');
    }
    data.quizData.forEach((question, questionIndex) => {
        const questionPath = `quizData[${questionIndex}]`;
        requireObject(question, questionPath);
        requireText(question.question, `${questionPath}.question`);
        validateTextArray(question.options, `${questionPath}.options`);
        if (question.options.length !== 4) {
            throw new Error(`${questionPath}.options must contain exactly 4 answers.`);
        }
        if (!Number.isInteger(question.correct) || question.correct < 0 || question.correct >= 4) {
            throw new Error(`${questionPath}.correct must be an integer from 0 to 3.`);
        }
        validateTextArray(question.explanations, `${questionPath}.explanations`);
        if (question.explanations.length !== 4) {
            throw new Error(`${questionPath}.explanations must contain exactly 4 explanations.`);
        }
    });

    return data;
}

function saveProgress() {
    try {
        localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify({
            version: 1,
            coursePath: currentCoursePath,
            courseData: { tutorialData, quizData },
            quizType: activeQuizData === quizData ? 'static' : 'ai',
            aiQuizData: activeQuizData === quizData ? null : activeQuizData,
            currentQuestionIndex,
            answers
        }));
        persistenceError = '';
    } catch (error) {
        console.error('Progress save error:', error);
        persistenceError = `Progress could not be saved: ${error.message}`;
        dom.courseLoadStatus.textContent = persistenceError;
    }
}

function restoreSavedProgress() {
    let serialized;
    try {
        serialized = localStorage.getItem(PROGRESS_STORAGE_KEY);
    } catch (error) {
        console.error('Progress read error:', error);
        progressWarning = `Saved progress could not be read: ${error.message}`;
        dom.courseLoadStatus.textContent = progressWarning;
        return false;
    }
    if (!serialized) return false;

    try {
        const saved = JSON.parse(serialized);
        if (!saved || saved.version !== 1) {
            throw new Error('Unsupported saved progress format.');
        }
        validateCourseModule(saved.courseData);
        if (saved.coursePath !== null && typeof saved.coursePath !== 'string') {
            throw new Error('Saved course path is invalid.');
        }
        if (saved.quizType !== 'static' && saved.quizType !== 'ai') {
            throw new Error('Saved quiz type is invalid.');
        }

        const restoredQuizData = saved.quizType === 'ai'
            ? validateCourseModule({ tutorialData: saved.courseData.tutorialData, quizData: saved.aiQuizData }).quizData
            : saved.courseData.quizData;
        if (!Number.isInteger(saved.currentQuestionIndex)
            || saved.currentQuestionIndex < 0
            || saved.currentQuestionIndex > restoredQuizData.length) {
            throw new Error('Saved question position is invalid.');
        }
        if (!Array.isArray(saved.answers)
            || saved.answers.length !== restoredQuizData.length
            || saved.answers.some(answer => answer !== null
                && (!Number.isInteger(answer) || answer < 0 || answer > 3))) {
            throw new Error('Saved answers are invalid.');
        }
        if (saved.currentQuestionIndex === restoredQuizData.length
            && saved.answers.some(answer => answer === null)) {
            throw new Error('Saved completed quiz contains unanswered questions.');
        }

        applyCourseData(saved.courseData, saved.coursePath, false);
        if (saved.quizType === 'ai') {
            cachedAiData = restoredQuizData;
            activeQuizData = cachedAiData;
        }
        answers = saved.answers;
        currentQuestionIndex = saved.currentQuestionIndex;
        score = answers.reduce((total, answer, index) => (
            total + (answer !== null && answer === activeQuizData[index].correct ? 1 : 0)
        ), 0);
        isAnswered = currentQuestionIndex < activeQuizData.length
            && answers[currentQuestionIndex] !== null;

        const bundledOption = Array.from(dom.bundledCourseSelect.options)
            .some(option => option.value === saved.coursePath);
        dom.bundledCourseSelect.value = bundledOption ? saved.coursePath : '';

        if (currentQuestionIndex >= activeQuizData.length) {
            showResults();
        } else if (answers.some(answer => answer !== null)) {
            startQuiz();
        }
        dom.courseLoadStatus.textContent = 'Saved progress restored.';
        return true;
    } catch (error) {
        console.error('Progress restore error:', error);
        progressWarning = `Saved progress could not be restored: ${error.message}`;
        dom.courseLoadStatus.textContent = progressWarning;
        return false;
    }
}

function applyCourseData(parsedData, coursePath = null, persist = true) {
    validateCourseModule(parsedData);

    tutorialData = parsedData.tutorialData;
    quizData = parsedData.quizData;
    activeQuizData = quizData;
    cachedAiData = null;
    currentCoursePath = coursePath;

    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
    answers = Array(quizData.length).fill(null);

    renderTutorial();
    setAppState(true, tutorialData.title || "Custom Course Module");
    showLandingDashboard();
    if (persist) saveProgress();
}

async function loadBundledCourse(coursePath) {
    const requestId = ++courseLoadRequest;
    if (!coursePath) return;

    stopAIQuizWorker();
    dom.courseLoadStatus.textContent = 'Loading course...';
    try {
        const response = await fetch(coursePath);
        if (!response.ok) {
            throw new Error(`Course request failed with status ${response.status}.`);
        }

        const parsedData = await response.json();
        if (requestId !== courseLoadRequest) return;
        applyCourseData(parsedData, coursePath);
        dom.courseLoadStatus.textContent = persistenceError || progressWarning;
    } catch (error) {
        if (requestId !== courseLoadRequest) return;
        console.error('Course loading error:', error);
        dom.courseLoadStatus.textContent = `Unable to load course: ${error.message}`;
    }
}

function updateNavUI(activeTab) {
    [dom.navTutorial, dom.navQuiz, dom.navAiQuiz].forEach(el => {
        el.className = 'pb-1 border-b-2 border-transparent text-gray-400 transition-colors hover:text-white';
    });

    const activeEl = activeTab === 'tutorial' ? dom.navTutorial : 
                     activeTab === 'ai-quiz' ? dom.navAiQuiz : dom.navQuiz;
    
    activeEl.classList.remove('border-transparent', 'text-gray-400');
    activeEl.classList.add('border-brand-500', 'text-white');
}

function showLandingDashboard() {
    stopAIQuizWorker();
    dom.contentSection.classList.add('hidden-view');
    dom.landingDashboard.classList.remove('hidden-view');
    dom.servicesSection.classList.remove('hidden-view');
    dom.loadingScreen.classList.add('hidden-view');
    
    if(tutorialData.title) {
        dom.emptyState.classList.add('hidden-view');
        dom.welcomeScreen.classList.remove('hidden-view');
    } else {
        dom.emptyState.classList.remove('hidden-view');
        dom.welcomeScreen.classList.add('hidden-view');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('tutorial');
}

function showTutorial() {
    if (!tutorialData.title) return;
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    
    dom.tutorialScreen.classList.remove('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('tutorial');
}

function startQuiz() {
    if (!tutorialData.title) return;
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    
    dom.tutorialScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    dom.quizScreen.classList.remove('hidden-view');
    
    dom.progressContainer.classList.remove('hidden-view');
    dom.scoreTracker.textContent = score;
    updateNavUI(activeQuizData === quizData ? 'quiz' : 'ai-quiz');
    
    if (currentQuestionIndex < activeQuizData.length) {
        loadQuestion();
    } else {
        showResults();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showResults() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    
    dom.tutorialScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.remove('hidden-view');
    dom.progressContainer.classList.add('hidden-view');

    const totalQuestions = activeQuizData.length;
    const percent = totalQuestions === 0 ? 0 : Math.round((score / totalQuestions) * 100);
    
    dom.finalFraction.textContent = `${score} / ${totalQuestions}`;
    
    dom.resultMessage.innerHTML = '';
    if (activeQuizData !== quizData) {
        dom.generateNewAiBtn.classList.remove('hidden-view');
    } else {
        dom.generateNewAiBtn.classList.add('hidden-view');
    }
    
    const spanMsg = document.createElement('span');
    spanMsg.className = 'font-light block mb-4 text-3xl text-white';
    
    if (totalQuestions === 0) {
        spanMsg.textContent = 'No Assessment Available.';
        spanMsg.classList.add('text-gray-400');
        dom.resultMessage.appendChild(spanMsg);
    } else if (percent >= 80) {
        spanMsg.textContent = 'Outstanding Performance!';
        spanMsg.classList.add('text-emerald-400');
        dom.resultMessage.appendChild(spanMsg);
        dom.resultMessage.appendChild(document.createTextNode(' You have demonstrated expert-level mastery of the material.'));
    } else if (percent >= 60) {
        spanMsg.textContent = 'Solid Effort.';
        spanMsg.classList.add('text-brand-400');
        dom.resultMessage.appendChild(spanMsg);
        dom.resultMessage.appendChild(document.createTextNode(' You understand the fundamentals well, but reviewing key concepts will push you further.'));
    } else {
        spanMsg.textContent = 'Keep Reviewing.';
        spanMsg.classList.add('text-brand-500');
        dom.resultMessage.appendChild(spanMsg);
        dom.resultMessage.appendChild(document.createTextNode(' Review the tutorial material deeply before retaking the assessment.'));
    }

    if (percent === 0) {
        dom.finalScore.textContent = `0%`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    let currentPercent = 0;
    const animationDuration = 1000;
    const intervalTime = animationDuration / percent;
    
    const interval = setInterval(() => {
        currentPercent++;
        dom.finalScore.textContent = `${currentPercent}%`;
        if (currentPercent >= percent) {
            clearInterval(interval);
            dom.finalScore.textContent = `${percent}%`;
        }
    }, intervalTime);
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showResultsViewOnly() {
    showResults();
    updateNavUI(activeQuizData === quizData ? 'quiz' : 'ai-quiz');
}

function selectStaticQuiz() {
    if (activeQuizData !== quizData || currentQuestionIndex >= quizData.length) {
        activeQuizData = quizData;
        currentQuestionIndex = 0;
        score = 0;
        isAnswered = false;
        answers = Array(quizData.length).fill(null);
    }
    saveProgress();
    startQuiz();
}

function restartQuiz() {
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
    answers = Array(activeQuizData.length).fill(null);
    saveProgress();
    startQuiz();
}

dom.navTutorial.addEventListener('click', showLandingDashboard); 

dom.startBtn.addEventListener('click', selectStaticQuiz);
dom.readTutorialBtn.addEventListener('click', showTutorial);
dom.tutorialToQuizBtn.addEventListener('click', selectStaticQuiz);

dom.nextBtn.addEventListener('click', () => {
    currentQuestionIndex++;
    saveProgress();
    if (currentQuestionIndex < activeQuizData.length) {
        loadQuestion();
    } else {
        showResults();
    }
});

dom.retakeBtnHeader.addEventListener('click', restartQuiz);
dom.restartBtn.addEventListener('click', restartQuiz);

dom.startAiBtn.addEventListener('click', startAIQuizGenerator);
dom.generateNewAiBtn.addEventListener('click', startAIQuizGenerator);

dom.navAiQuiz.addEventListener('click', () => {
    if (!tutorialData.title) return;
    if (activeQuizData === cachedAiData && cachedAiData !== null) {
        if (currentQuestionIndex >= activeQuizData.length) showResultsViewOnly();
        else startQuiz();
    } else if (cachedAiData !== null) {
        activeQuizData = cachedAiData;
        restartQuiz();
    } else {
        startAIQuizGenerator();
    }
});

dom.navQuiz.addEventListener('click', () => {
    if (!tutorialData.title) return;
    const wasOnAI = (activeQuizData !== quizData);
    if (wasOnAI) {
        activeQuizData = quizData;
        currentQuestionIndex = 0;
        score = 0;
        isAnswered = false;
        answers = Array(quizData.length).fill(null);
        saveProgress();
    }
    
    if (currentQuestionIndex >= activeQuizData.length) {
        showResultsViewOnly();
    } else {
        startQuiz();
    }
});

dom.customDataUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    stopAIQuizWorker();
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            courseLoadRequest++;
            applyCourseData(parsedData);
            dom.bundledCourseSelect.value = '';
            dom.courseLoadStatus.textContent = persistenceError || 'Custom course loaded.';
        } catch (error) {
            console.error("JSON error:", error);
            alert("Failed to load data: " + error.message);
        }
        dom.customDataUpload.value = '';
    };
    reader.readAsText(file);
});

dom.bundledCourseSelect.addEventListener('change', event => {
    loadBundledCourse(event.target.value);
});

// Helper Function that injects the WebComponent
function formatText(text) {
    if (!text) return '';
    const viewer = document.createElement('rich-text-viewer');
    viewer.setAttribute('content', encodeURIComponent(text));
    return viewer.outerHTML;
}

function renderTutorial() {
    if (!tutorialData || !tutorialData.sections) return;
    dom.tutorialTitle.textContent = tutorialData.title || 'Tutorial Module';
    dom.tutorialLead.textContent = tutorialData.lead || '';
    dom.tutorialContent.innerHTML = ''; 

    tutorialData.sections.forEach(section => {
        const sectionClone = templates.tutorialSection.content.cloneNode(true);
        const titleEl = sectionClone.querySelector('.section-title');
        const noteEl = sectionClone.querySelector('.section-note');
        const listContainer = sectionClone.querySelector('.section-list');

        const theme = section.themeColor || 'indigo-500';

        titleEl.textContent = section.title;
        titleEl.className = `section-title text-2xl font-bold mb-4 border-b-2 pb-2 text-${theme} border-${theme}`;

        if (section.note) {
            noteEl.textContent = section.note;
        } else {
            noteEl.remove();
        }

        section.items.forEach(itemData => {
            const liClone = templates.tutorialListItem.content.cloneNode(true);
            const spanEl = liClone.querySelector('span');
            
            if (typeof itemData === 'string') {
                const parts = itemData.split(':');
                if (parts.length > 1) {
                    const strong = document.createElement('strong');
                    strong.className = `font-semibold text-${theme}`;
                    strong.textContent = parts[0] + ':';
                    spanEl.appendChild(strong);
                    
                    const textWrapper = document.createElement('span');
                    textWrapper.innerHTML = formatText(parts.slice(1).join(':'));
                    spanEl.appendChild(textWrapper);
                } else {
                    spanEl.innerHTML = formatText(itemData);
                }
            } 
            else if (typeof itemData === 'object' && itemData !== null) {
                if (itemData.term) {
                    const strong = document.createElement('strong');
                    strong.className = `font-semibold text-${theme} block mb-4 mt-2 text-lg md:text-xl tracking-wide`;
                    strong.textContent = itemData.term;
                    spanEl.appendChild(strong);
                }

                if (itemData.blocks && Array.isArray(itemData.blocks)) {
                    itemData.blocks.forEach(block => {
                        if (block.type === 'text') {
                            const p = document.createElement('p');
                            p.className = 'mb-6 text-gray-200 leading-relaxed';
                            p.innerHTML = formatText(block.content);
                            spanEl.appendChild(p);
                        } else if (block.type === 'media' && block.mediaType === 'image') {
                            const img = document.createElement('img');
                            img.src = `data/${block.src}`;
                            img.alt = block.alt || '';
                            img.className = 'my-6 max-w-full rounded-xl shadow-lg';
                            spanEl.appendChild(img);
                        } else if (block.type === 'card') {
                            const cardDiv = document.createElement('div');
                            
                            if (block.variant === 'example') {
                                cardDiv.className = `my-6 p-7 rounded-2xl bg-slate-900 border-l-8 border-${theme} shadow-xl relative overflow-hidden`;
                            } else {
                                cardDiv.className = `my-6 p-6 rounded-xl bg-gray-800/40 border-l-4 border-${theme} shadow-md`;
                            }
                            
                            if (block.title) {
                                const cardTitle = document.createElement('h4');
                                const titleFont = block.variant === 'example' ? 'font-extrabold text-2xl tracking-tight' : 'font-bold text-lg';
                                cardTitle.className = `text-white mb-4 ${titleFont}`;
                                cardTitle.textContent = block.title;
                                cardDiv.appendChild(cardTitle);
                            }
                            if (block.intro || block.content) {
                                const p = document.createElement('p');
                                const textBrightness = block.variant === 'example' ? 'text-gray-100' : 'text-gray-300';
                                p.className = `${textBrightness} mb-4 leading-relaxed text-lg`;
                                p.innerHTML = formatText(block.intro || block.content);
                                cardDiv.appendChild(p);
                            }
                            if (block.bullets && Array.isArray(block.bullets)) {
                                const ul = document.createElement('ul');
                                ul.className = 'list-disc list-outside text-gray-300 ml-6 space-y-3 leading-relaxed text-lg';
                                block.bullets.forEach(bullet => {
                                    const li = document.createElement('li');
                                    li.innerHTML = formatText(bullet);
                                    ul.appendChild(li);
                                });
                                cardDiv.appendChild(ul);
                            }
                            spanEl.appendChild(cardDiv);
                        } else if (block.type === 'callout') {
                            const calloutDiv = document.createElement('div');
                            calloutDiv.className = 'my-6 p-6 rounded-xl bg-amber-900/20 border border-amber-500/30 shadow-md';
                            
                            if (block.title) {
                                const calloutTitle = document.createElement('h4');
                                calloutTitle.className = 'font-bold text-amber-500 mb-4 flex items-center gap-2 text-lg';
                                calloutTitle.innerHTML = `<span>⚠️</span> ${block.title}`;
                                calloutDiv.appendChild(calloutTitle);
                            }
                            if (block.items && Array.isArray(block.items)) {
                                const ul = document.createElement('ul');
                                ul.className = 'space-y-4 text-gray-200 leading-relaxed';
                                block.items.forEach(item => {
                                    const li = document.createElement('li');
                                    li.innerHTML = formatText(item);
                                    ul.appendChild(li);
                                });
                                calloutDiv.appendChild(ul);
                            }
                            spanEl.appendChild(calloutDiv);
                        }
                    });
                }
            }
            
            listContainer.appendChild(liClone);
        });

        dom.tutorialContent.appendChild(sectionClone);
    });
}

function loadQuestion() {
    const savedAnswer = answers[currentQuestionIndex];
    isAnswered = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const currentQ = activeQuizData[currentQuestionIndex];
    
    dom.questionNumberBadge.textContent = currentQuestionIndex + 1;
    dom.questionText.innerHTML = formatText(currentQ.question);
    
    if (currentQuestionIndex === activeQuizData.length - 1) {
        dom.nextBtnText.textContent = "Finish Assessment";
    } else {
        dom.nextBtnText.textContent = "Next Question";
    }
    
    const progressPercent = ((currentQuestionIndex) / activeQuizData.length) * 100;
    dom.progressBar.style.width = `${progressPercent}%`;

    dom.actionContainer.classList.add('hidden-view');
    dom.optionsContainer.innerHTML = '';

    currentQ.options.forEach((optionText, index) => {
        const optionClone = templates.quizOption.content.cloneNode(true);
        const btn = optionClone.querySelector('.option-card');
        const letterSpan = optionClone.querySelector('.option-letter');
        const textSpan = optionClone.querySelector('.option-text');
        
        const letter = String.fromCharCode(65 + index);
        letterSpan.textContent = letter;
        textSpan.innerHTML = formatText(optionText);
        
        btn.addEventListener('click', () => handleAnswerSelect(index));
        dom.optionsContainer.appendChild(optionClone);
    });

    if (savedAnswer !== null && savedAnswer !== undefined) {
        handleAnswerSelect(savedAnswer, true);
    }
}

function handleAnswerSelect(selectedIndex, restoring = false) {
    if (isAnswered) return;
    isAnswered = true;

    const currentQ = activeQuizData[currentQuestionIndex];
    const isCorrect = selectedIndex === currentQ.correct;
    if (!restoring) answers[currentQuestionIndex] = selectedIndex;

    if (isCorrect && !restoring) {
        score++;
    }
    dom.scoreTracker.textContent = score;
    if (!restoring) saveProgress();

    const allCards = dom.optionsContainer.querySelectorAll('.option-card');
    
    allCards.forEach((card, index) => {
        card.classList.add('answered', 'cursor-default');
        const letterBadge = card.querySelector('.option-letter');
        const explContainer = card.querySelector('.explanation-text');
        const explInner = card.querySelector('.explanation-inner');
        
        const isOptionCorrect = index === currentQ.correct;
        
        explInner.innerHTML = '';
        const titleSpan = document.createElement('span');
        titleSpan.className = 'block mb-1 font-bold tracking-wider text-xs uppercase';
        const explSpan = document.createElement('span');
        explSpan.className = 'text-gray-400 leading-relaxed';
        explSpan.innerHTML = formatText(currentQ.explanations[index]);
        
        if (isOptionCorrect) {
            titleSpan.textContent = 'Correct Answer';
            titleSpan.classList.add('text-emerald-400');
            explInner.appendChild(titleSpan);
            explInner.appendChild(explSpan);
            
            card.classList.remove('border-transparent');
            card.style.borderColor = '#10b981'; 
            card.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
            letterBadge.classList.remove('bg-gray-800', 'text-gray-400');
            letterBadge.style.backgroundColor = '#10b981';
            letterBadge.style.color = '#ffffff';
            
        } else {
            titleSpan.textContent = 'Incorrect';
            titleSpan.classList.add('text-brand-400'); 
            explInner.appendChild(titleSpan);
            explInner.appendChild(explSpan);
            
            if (index === selectedIndex) {
                card.classList.remove('border-transparent');
                card.style.borderColor = '#ef4444'; 
                card.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; 
                letterBadge.classList.remove('bg-gray-800', 'text-gray-400');
                letterBadge.style.backgroundColor = '#ef4444';
                letterBadge.style.color = '#ffffff';
            } else {
                card.classList.add('opacity-50');
            }
        }
        
        setTimeout(() => {
            explContainer.classList.add('expanded');
        }, 50 * index); 
    });

    dom.actionContainer.classList.remove('hidden-view');
    setTimeout(() => {
        dom.actionContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 400);
}

function stopAIQuizWorker() {
    if (!activeAiWorker) return;
    activeAiWorker.terminate();
    activeAiWorker = null;
}

async function startAIQuizGenerator() {
    if (!tutorialData.title) return;
    
    stopAIQuizWorker();
    dom.contentSection.classList.add('hidden-view');
    dom.landingDashboard.classList.remove('hidden-view');
    dom.emptyState.classList.add('hidden-view');
    dom.welcomeScreen.classList.add('hidden-view');
    dom.servicesSection.classList.add('hidden-view'); 
    dom.loadingScreen.classList.remove('hidden-view');
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('ai-quiz');

    try {
        const aiWorker = new Worker('js/ai-worker.js');
        activeAiWorker = aiWorker;

        aiWorker.onmessage = function(e) {
            if (e.data.type === 'progress') {
                dom.loadingScreen.querySelector('p').textContent = e.data.message;
            } else if (e.data.type === 'success') {
                if (activeAiWorker !== aiWorker) return;
                stopAIQuizWorker();
                try {
                    cachedAiData = validateCourseModule({
                        tutorialData,
                        quizData: e.data.data
                    }).quizData;
                    activeQuizData = cachedAiData;
                    restartQuiz();
                } catch (error) {
                    console.error('Generated quiz validation error:', error);
                    alert(`Generated quiz is invalid: ${error.message}`);
                    showLandingDashboard();
                }
            } else if (e.data.type === 'error') {
                if (activeAiWorker !== aiWorker) return;
                stopAIQuizWorker();
                alert("Error: " + e.data.message);
                showLandingDashboard();
            }
        };
        aiWorker.onerror = event => {
            if (activeAiWorker !== aiWorker) return;
            stopAIQuizWorker();
            console.error('AI worker error:', event.message);
            alert(`AI quiz generation failed: ${event.message}`);
            showLandingDashboard();
        };
        aiWorker.postMessage({ tutorialData, quizData });
    } catch (error) {
        stopAIQuizWorker();
        console.error('AI worker initialization error:', error);
        alert(`Failed to initialize AI worker: ${error.message}`);
        showLandingDashboard();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setAppState(false);
    if (!restoreSavedProgress()) {
        dom.bundledCourseSelect.value = 'data/Deployment-MLOps.json';
        loadBundledCourse(dom.bundledCourseSelect.value);
    }
});
