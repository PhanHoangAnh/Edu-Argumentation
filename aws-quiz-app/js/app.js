let currentQuestionIndex = 0;
let score = 0;
let isAnswered = false;
let selectedAnswer = null;      // the option picked on the current question, so a resumed quiz shows it
let activeQuizData = [];
// The full set the run started with. activeQuizData NARROWS to the wrong ones on a
// "Retry the wrong ones", so without this "Retry Quiz" would restart the narrowed
// set instead of the whole assessment.
let fullQuizData = [];
// Positions in activeQuizData answered wrongly during THIS run.
let wrongIndices = [];
// A retry run only shows the wrong ones, but a block still ticks at 100% of the
// ORIGINAL assessment. These carry the questions already passed, so the score
// posted to the server stays 20/20 and never becomes 3/3.
let carriedCorrect = 0;
let carriedTotal = 0;
let quizData = [];
let tutorialData = {};
let generatedQuizData = null;
// Which slice of the bank activeQuizData currently holds. Identity checks
// (activeQuizData === quizData) cannot tell a block slice from the whole bank,
// because a slice is a new array, so the nav would light up "AI quiz".
// 'module' = the whole bank | 'block' = the block you are reading | 'ai' = model-written
let quizScope = 'module';
let quizScopeLabel = '';
// Which block a block-scoped quiz belongs to, captured when the quiz starts.
// Read at the finish, so navigating the reader afterwards cannot credit the
// wrong block.
let quizScopeBlockId = null;
// Server-held study progress: { completed: { 'ch01-b03': {at, score, total, source} } }
// Kept on the server, not in localStorage, so it survives a cache clear and
// follows the reader to another device.
let progress = { completed: {} };
// Progress belongs to a MODULE. Block ids are positional, so every book has a
// ch01-b03; without this, a second book's first lesson would show Géron's tick.
// Explicit id first, never the title: the Géron title changes when chapters are
// merged in, and a title-derived key would orphan every completion.
let moduleId = '';

function moduleIdFor(parsedData, bookFile = null) {
    const explicit = String(parsedData.moduleId || (parsedData.tutorialData || {}).moduleId || '').trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(explicit)) return explicit;
    // A library book without its own id is keyed by its file: two books with the same
    // title (the two SageMaker Clarify files) must not share progress.
    const stem = String(bookFile || '').replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
    if (stem.length >= 2) return `f-${stem}`;
    const slug = String((parsedData.tutorialData || {}).title || 'module').toLowerCase()
        .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56);
    return /^[a-z0-9]/.test(slug) && slug.length >= 2 ? `t-${slug}` : 'module';
}

const DEFAULT_BOOK = 'geron-homl3';   // the packaged book (library/<moduleId>/)
let activeBookFile = null;        // the library file being studied; null for an uploaded module
// Where THIS book's images live. Empty for legacy books, whose "src" values are
// relative to the site root (assets/<moduleId>/x.png). A packaged book sets it to
// book/<moduleId>/, so its "src" is relative to the BOOK (assets/x.png) and the
// same folder works unzipped anywhere.
let assetBase = '';
// Where a book lives, and what its images are relative to. A PACKAGED book is a
// folder (library/<moduleId>/); a legacy one is a file in data/. Identified by
// SHAPE, not by the library listing -- at startup the default book is opened
// before /api/modules has answered, and looking it up there made the first load
// 404 and leave the home dashboard empty.
function bookUrlFor(file) {
    const packaged = /^[A-Za-z0-9._-]+$/.test(file) && !file.endsWith('.json');
    return packaged
        ? { url: `book/${encodeURIComponent(file)}/module.json`, base: `book/${file}/` }
        : { url: `data/${encodeURIComponent(file)}`, base: '' };
}

function assetUrl(src) {
    if (!src || /^(https?:|data:|\/)/.test(src)) return src;
    return assetBase ? assetBase + src : src;
}
let libraryBooks = [];
// Snapshot of the card order, taken when library data loads. renderLibrary()
// used to re-sort on every call, so progress ticking mid-session could also
// reshuffle the grid. Books added later APPEND; nothing already on screen moves.
let libraryOrder = [];
let GENERATED_QUIZ_SIZE = 20;   // overridden by server general settings
let aiQuestionCount = 5;        // overridden by server general settings
const MAX_FRESH_QUIZ_SIZE = 30; // server enforces the same cap
// Declared up here, not beside the AI section: setAppState reads providerReady,
// and a `let` read above its declaration is a boot-killing TDZ error.
let providerReady = false;
let providerStatusUnknown = false;
let providerTokenRequired = true;
let providerModel = '';

const dom = {
    appContainer: document.getElementById('app-container'),
    landingDashboard: document.getElementById('landing-dashboard'),
    contentSection: document.getElementById('content-section'),
    servicesSection: document.getElementById('services-section'),
    
    emptyState: document.getElementById('empty-state'),
    welcomeScreen: document.getElementById('welcome-screen'),
    loadingScreen: document.getElementById('loading-screen'),
    loadingModel: document.getElementById('loading-model'),
    loadingScope: document.getElementById('loading-scope'),
    
    tutorialScreen: document.getElementById('tutorial-screen'),
    quizScreen: document.getElementById('quiz-screen'),
    quizSetupScreen: document.getElementById('quiz-setup-screen'),
    setupTitle: document.getElementById('setup-title'),
    setupTree: document.getElementById('setup-tree'),
    setupAllBtn: document.getElementById('setup-all-btn'),
    setupNoneBtn: document.getElementById('setup-none-btn'),
    setupCount: document.getElementById('setup-count'),
    setupStartBtn: document.getElementById('setup-start-btn'),
    setupResumeBtn: document.getElementById('setup-resume-btn'),
    setupCancelBtn: document.getElementById('setup-cancel-btn'),
    setupBackdrop: document.getElementById('setup-backdrop'),
    welcomeEmpty: document.getElementById('welcome-empty'),
    welcomeBody: document.getElementById('welcome-body'),
    resultScreen: document.getElementById('result-screen'),
    
    welcomeTitle: document.getElementById('welcome-title'),
    currentMeta: document.getElementById('current-meta'),
    currentProgressLabel: document.getElementById('current-progress-label'),
    currentProgressPercent: document.getElementById('current-progress-percent'),
    currentProgressTrack: document.getElementById('current-progress-track'),
    currentProgressBar: document.getElementById('current-progress-bar'),
    currentNext: document.getElementById('current-next'),
    libraryGrid: document.getElementById('library-grid'),
    importBookLink: document.getElementById('import-book-link'),
    
    startBtn: document.getElementById('start-btn'),
    readTutorialBtn: document.getElementById('read-tutorial-btn'),
    tutorialToQuizBtn: document.getElementById('tutorial-to-quiz-btn'),
    navTutorial: document.getElementById('nav-tutorial'),
    brandHome: document.getElementById('brand-home'),
    navQuiz: document.getElementById('nav-quiz'),
    navGeneratedQuiz: document.getElementById('nav-generated-quiz'),
    navLearn: document.getElementById('nav-learn'),
    navSettings: document.getElementById('nav-settings'),
    primaryNav: document.getElementById('primary-nav'),
    menuBtn: document.getElementById('menu-btn'),
    settingsScreen: document.getElementById('settings-screen'),
    settingsForm: document.getElementById('settings-form'),
    adminToken: document.getElementById('admin-token'),
    settingsUnlockBtn: document.getElementById('settings-unlock-btn'),
    settingsLockStatus: document.getElementById('settings-lock-status'),
    settingsLockCard: document.getElementById('settings-lock-card'),
    settingsSaveBtn: document.getElementById('settings-save-btn'),
    settingsStatus: document.getElementById('settings-status'),
    setApiUrl: document.getElementById('set-api-url'),
    setApiKey: document.getElementById('set-api-key'),
    setModel: document.getElementById('set-model'),
    setJsonMode: document.getElementById('set-json-mode'),
    setAccessToken: document.getElementById('set-access-token'),
    setRequireToken: document.getElementById('set-require-token'),
    setAiCount: document.getElementById('set-ai-count'),
    setFreshSize: document.getElementById('set-fresh-size'),
    apiKeyState: document.getElementById('api-key-state'),
    accessTokenState: document.getElementById('access-token-state'),
    startGeneratedBtn: document.getElementById('start-generated-btn'),
    customDataUpload: document.getElementById('custom-data-upload'),
    
    tutorialContent: document.getElementById('tutorial-content'),
    tutorialTitle: document.getElementById('tutorial-main-title'),
    tutorialArticle: document.getElementById('tutorial-article'),
    tocNav: document.getElementById('toc-nav'),
    tocPanel: document.getElementById('toc-panel'),
    tocBackdrop: document.getElementById('toc-backdrop'),
    tocToggleBtn: document.getElementById('toc-toggle-btn'),
    tocCloseBtn: document.getElementById('toc-close-btn'),
    tocSummary: document.getElementById('toc-summary'),
    theoryChapterLabel: document.getElementById('theory-chapter-label'),
    theoryBlockPosition: document.getElementById('theory-block-position'),
    prevBlockBtn: document.getElementById('prev-block-btn'),
    nextBlockBtn: document.getElementById('next-block-btn'),
    blockAiQuizBtn: document.getElementById('block-ai-quiz-btn'),
    aiBlockStatus: document.getElementById('ai-block-status'),
    tutorialToQuizLabel: document.getElementById('tutorial-to-quiz-label'),
    quizScopeLabel: document.getElementById('quiz-scope-label'),
    
    questionText: document.getElementById('question-text'),
    questionAsset: document.getElementById('question-asset'),
    optionsContainer: document.getElementById('options-container'),
    questionNumberBadge: document.getElementById('question-number-badge'),
    scoreTracker: document.getElementById('score-tracker'),
    
    actionContainer: document.getElementById('action-container'),
    nextBtn: document.getElementById('next-btn'),
    nextBtnText: document.getElementById('next-btn-text'),
    nextHint: document.getElementById('next-hint'),
    retakeBtnHeader: document.getElementById('retake-btn-header'),
    quizNewBtn: document.getElementById('quiz-new-btn'),
    resultNewBtn: document.getElementById('result-new-btn'),
    
    finalScore: document.getElementById('final-score'),
    finalFraction: document.getElementById('final-fraction'),
    resultMessage: document.getElementById('result-message'),
    restartBtn: document.getElementById('restart-btn'),
    resultRetryWrongBtn: document.getElementById('result-retry-wrong-btn'),
    resultRetryWrongLabel: document.getElementById('result-retry-wrong-label'),
    generateNewBtn: document.getElementById('generate-new-btn'),
    resultBackBtn: document.getElementById('result-back-btn'),
    resultBackLabel: document.getElementById('result-back-label'),
    resultNextBtn: document.getElementById('result-next-btn'),
    resultNextLabel: document.getElementById('result-next-label'),
    
    progressContainer: document.getElementById('progress-container'),
    progressBar: document.getElementById('progress-bar')
};

const templates = {
    tutorialSection: document.getElementById('tmpl-tutorial-section'),
    tutorialListItem: document.getElementById('tmpl-tutorial-list-item'),
    quizOption: document.getElementById('tmpl-quiz-option')
};

// --- Header menu ----------------------------------------------------------
// Below md the nav is a dropdown; at md+ it is an inline row and always shown.
const MENU_WIDE = '(min-width: 768px)';
let menuOpen = false;

function isWideMenu() { return window.matchMedia(MENU_WIDE).matches; }

function setMenuOpen(open) {
    menuOpen = open;
    dom.primaryNav.classList.toggle('hidden-view', !open);
    if (dom.menuBtn) dom.menuBtn.setAttribute('aria-expanded', String(open));
}

function syncMenuToViewport() { setMenuOpen(isWideMenu()); }

// The full-height reader is the only screen that takes the viewport as its box.
// It has to be set on <body>, not on the section: body is min-h-screen, so without
// a hard height every flex child keeps min-height:auto and grows with its content.
function setReaderMode(on) {
    document.body.classList.toggle('reader-mode', on);
    dom.contentSection.classList.toggle('reader-mode', on);
}

function showSettings() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    setReaderMode(false);
    dom.tutorialScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    closeQuizSetup();
    dom.progressContainer.classList.add('hidden-view');
    dom.settingsScreen.classList.remove('hidden-view');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('settings');
    loadSettings();
}

// --- Contents panel -------------------------------------------------------
// Below lg the panel is a fixed overlay drawer, so it never pushes the theory
// down the page; at lg+ it is a static column the reader can collapse to give
// the text the full width.
const WIDE_VIEWPORT = '(min-width: 1024px)';
let tocOpen = false;

function isWideViewport() {
    return window.matchMedia(WIDE_VIEWPORT).matches;
}

function setTocOpen(open) {
    tocOpen = open;
    dom.tocPanel.classList.toggle('hidden-view', !open);
    // The backdrop carries lg:hidden, so it stays out of the desktop layout.
    dom.tocBackdrop.classList.toggle('hidden-view', !open);
    if (dom.tocToggleBtn) dom.tocToggleBtn.setAttribute('aria-expanded', String(open));
}

function syncTocToViewport() {
    // Open by default where there is room for it, closed where there is not.
    setTocOpen(isWideViewport());
}


function setAppState(isReady) {
    // The panel itself never hides. Closing a book empties it instead, so the
    // home page keeps its shape and nothing below it jumps (user, 21-09-26).
    dom.welcomeScreen.classList.remove('hidden-view');
    if (dom.welcomeBody) dom.welcomeBody.classList.toggle('hidden-view', !isReady);
    if (dom.welcomeEmpty) dom.welcomeEmpty.classList.toggle('hidden-view', isReady);
    
    const controls = [dom.readTutorialBtn, dom.startBtn];
    controls.forEach(btn => {
        if (!btn) return;
        btn.disabled = !isReady;
    });
    // A fresh quiz is written by the connected model, so it also needs a provider.
    if (dom.startGeneratedBtn) dom.startGeneratedBtn.disabled = !isReady || !aiReady();
}

// Nav items are a dropdown below md and a row at md+, so the base class string
// carries both layouts. Rewriting className here would otherwise wipe the
// responsive classes and leave the mobile menu unstyled.
const NAV_BASE_CLASS = 'min-h-[44px] px-3 md:px-0 text-left md:text-center rounded-lg md:rounded-none pb-0 md:pb-1 border-b-2 border-transparent text-gray-400 transition-colors hover:text-white';

function updateNavUI(activeTab) {
    const tabs = {
        tutorial: dom.navTutorial,
        learn: dom.navLearn,
        quiz: dom.navQuiz,
        'generated-quiz': dom.navGeneratedQuiz,
        settings: dom.navSettings,
    };
    Object.values(tabs).forEach(el => { if (el) el.className = NAV_BASE_CLASS; });
    const activeEl = tabs[activeTab] || dom.navQuiz;
    activeEl.classList.remove('border-transparent', 'text-gray-400');
    activeEl.classList.add('border-brand-500', 'text-white');
}

function showLandingDashboard() {
    dom.contentSection.classList.add('hidden-view');
    setReaderMode(false);
    dom.landingDashboard.classList.remove('hidden-view');
    dom.servicesSection.classList.remove('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.loadingScreen.classList.add('hidden-view');
    setAppState(Boolean(tutorialData.title));
    renderHome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('tutorial');
}

// --- Home -----------------------------------------------------------------------
// The current book with its progress and the way back in, then the library to pick
// another (user, 17-09-26: the home page named one book like a hero banner, and
// "Read Tutorial" did not say what it does).
const AI_ONLY_ON_LIBRARY_BOOKS = 'AI quizzes need a library book';

function aiReady() {
    return providerReady && Boolean(activeBookFile);
}

function plural(count, word) {
    return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

// The first lesson not yet completed, in book order; the last lesson once all are done.
function nextLesson() {
    const chapters = theoryChapters();
    for (let ci = 0; ci < chapters.length; ci += 1) {
        const blocks = theoryBlocks(ci);
        for (let bi = 0; bi < blocks.length; bi += 1) {
            if (!isBlockComplete(ci, bi)) return { chapterIndex: ci, blockIndex: bi, done: false };
        }
    }
    const last = chapters.length - 1;
    return last >= 0 ? { chapterIndex: last, blockIndex: Math.max(0, theoryBlocks(last).length - 1), done: true } : null;
}

function renderHome() {
    // The library is drawn whether or not a book is open -- it is how you pick one.
    if (!tutorialData.title) { renderLibrary(); return; }
    const chapters = theoryChapters().length;
    const lessons = theoryChapters().reduce((sum, _chapter, index) => sum + theoryBlocks(index).length, 0);
    const overall = overallProgress();
    dom.welcomeTitle.textContent = tutorialData.title;
    dom.currentMeta.textContent = [plural(chapters, 'chapter'), plural(lessons, 'lesson'), plural(quizData.length, 'question')].join(' · ');
    dom.currentProgressLabel.textContent = `${overall.done} / ${overall.total} lessons done`;
    dom.currentProgressPercent.textContent = `${overall.percent}%`;
    dom.currentProgressBar.style.width = `${overall.percent}%`;
    dom.currentProgressTrack.setAttribute('aria-valuenow', String(overall.percent));
    const next = nextLesson();
    if (next) {
        const block = theoryBlocks(next.chapterIndex)[next.blockIndex];
        const name = (block && block.term) || `Lesson ${next.blockIndex + 1}`;
        dom.currentNext.textContent = next.done ? 'All lessons done' : `Next: ${next.chapterIndex + 1}.${next.blockIndex + 1} ${name}`;
    }
    dom.readTutorialBtn.textContent = overall.done ? 'Continue reading' : 'Start reading';
    dom.startGeneratedBtn.disabled = !aiReady();
    dom.startGeneratedBtn.title = aiReady() ? '' : (providerReady ? AI_ONLY_ON_LIBRARY_BOOKS : 'Connect a model in Settings first');
    syncAiQuizButton();
    renderLibrary();
}

async function loadLibrary() {
    try {
        const response = await fetch('api/modules', { cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json();
        libraryBooks = Array.isArray(data.books) ? data.books : [];
    } catch (error) {
        libraryBooks = [];
    }
    snapshotLibraryOrder();
    // Progress of the books that are not open, so every card shows where the learner is.
    await Promise.all(libraryBooks.map(async book => {
        try {
            const id = book.moduleId && !/^t-/.test(book.moduleId) ? book.moduleId : moduleIdFor({}, book.file);
            book.progressId = id;
            const response = await fetch(`api/progress?module=${encodeURIComponent(id)}`);
            const data = response.ok ? await response.json() : {};
            book.done = data && data.completed ? Object.keys(data.completed).length : 0;
        } catch (error) {
            book.done = 0;
        }
    }));
    renderLibrary();
}

// Totals across every book, for the home page when nothing is open yet. Counts
// come from the library listing (each entry carries its own lessons/chapters/
// questions and how many blocks are complete), so this needs no extra request.
function renderHomeKpis() {
    const panel = document.getElementById('home-kpis');
    if (!panel) return;
    // Shown whenever there is a library to summarise. It was first gated on "no book
    // open", but the default book auto-opens, so that state is rare and the panel
    // would never have appeared. It does not duplicate the current-book panel: that
    // one is THIS book, this one is every book.
    const books = libraryBooks || [];
    if (!books.length) { panel.classList.add('hidden-view'); return; }

    const sum = (key) => books.reduce((total, book) => total + (Number(book[key]) || 0), 0);
    const lessons = sum('lessons');
    const done = books.reduce((total, book) => total + Math.min(Number(book.done) || 0, Number(book.lessons) || 0), 0);
    const percent = lessons ? Math.round((done / lessons) * 100) : 0;
    const started = books.filter(book => (Number(book.done) || 0) > 0).length;

    const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    set('kpi-lessons', `${done}`);
    set('kpi-lessons-sub', `of ${lessons} · ${percent}%`);
    const bar = document.getElementById('kpi-lessons-bar');
    if (bar) bar.style.width = `${percent}%`;
    set('kpi-books', `${books.length}`);
    set('kpi-books-sub', started ? `${started} started` : 'none started yet');
    set('kpi-chapters', `${sum('chapters')}`);
    set('kpi-questions', `${sum('questions').toLocaleString()}`);

    const furthest = [...books].sort((a, b) => (Number(b.done) || 0) - (Number(a.done) || 0))[0];
    set('kpi-furthest', furthest && (Number(furthest.done) || 0) > 0
        ? `Furthest along: ${furthest.title} — ${furthest.done} of ${furthest.lessons} lessons.`
        : 'Pick a book below to start.');
    panel.classList.remove('hidden-view');
}

// Most recent first: last worked on, else when it was imported, else title.
// Alphabetical put a book you have never opened above the one you read this
// morning (user, 21-09-26). localeCompare is the final tiebreak, which makes the
// sort total -- so a reload of unchanged data reproduces the same order.
function librarySortKey(a, b) {
    const recency = book => Math.max(Number(book.lastReadAt) || 0, 0) || Math.max(Number(book.addedAt) || 0, 0);
    return (Number(b.lastReadAt) || 0) - (Number(a.lastReadAt) || 0)
        || (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0)
        || recency(b) - recency(a)
        || a.title.localeCompare(b.title);
}

function snapshotLibraryOrder() {
    const known = new Set(libraryOrder);
    const fresh = libraryBooks.filter(book => !known.has(book.file)).sort(librarySortKey).map(book => book.file);
    const present = new Set(libraryBooks.map(book => book.file));
    libraryOrder = libraryOrder.filter(file => present.has(file)).concat(fresh);
}

function orderedLibraryBooks() {
    const byFile = new Map(libraryBooks.map(book => [book.file, book]));
    const ordered = libraryOrder.map(file => byFile.get(file)).filter(Boolean);
    // Safety net: anything that never reached the snapshot still renders, last.
    const seen = new Set(libraryOrder);
    return ordered.concat(libraryBooks.filter(book => !seen.has(book.file)));
}

function renderLibrary() {
    if (!dom.libraryGrid) return;
    dom.libraryGrid.innerHTML = '';
    dom.emptyState.classList.toggle('hidden-view', libraryBooks.length > 0 || Boolean(tutorialData.title));
    // Render in the order snapshotted at load time -- see libraryOrderOf().
    // The grid must NOT reshuffle under the cursor when a book is opened, so
    // position is no longer the marker; the "Current" chip + aria-current are
    // (user, 21-09-26).
    const ordered = orderedLibraryBooks();
    ordered.forEach(book => {
        const current = book.file === activeBookFile;
        const done = current ? overallProgress().done : Math.min(book.done || 0, book.lessons);
        const percent = book.lessons ? Math.round((done / book.lessons) * 100) : 0;
        // A div, not a button: the title turns into a text input on double-click
        // and an <input> inside a <button> is invalid and unfocusable in browsers.
        // role + tabindex + the keydown below keep it operable from the keyboard.
        const card = document.createElement('div');
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.dataset.book = book.file;
        card.setAttribute('aria-current', current ? 'true' : 'false');
        card.className = `flex flex-col gap-3 text-left rounded-xl border p-5 min-h-[44px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${current ? 'border-brand-600 bg-gray-800' : 'border-gray-700 bg-gray-800/60 hover:border-gray-500 hover:bg-gray-800'}`;
        const head = document.createElement('div');
        head.className = 'flex items-start justify-between gap-3';
        const title = document.createElement('h3');
        title.className = 'text-white font-semibold leading-snug line-clamp-2';
        title.textContent = book.title;
        title.title = 'Double-click to rename';
        title.dataset.rename = book.file;
        head.appendChild(title);
        if (current) {
            const chip = document.createElement('span');
            chip.className = 'shrink-0 rounded-full bg-brand-600/15 px-2.5 py-1 text-xs font-semibold text-brand-400';
            chip.textContent = 'Current';
            chip.title = 'Click the card to close this book';
            head.appendChild(chip);
        }
        const meta = document.createElement('p');
        meta.className = 'text-xs text-gray-400';
        meta.textContent = plural(book.chapters, 'chapter');
        const track = document.createElement('div');
        track.className = 'h-1.5 rounded-full bg-gray-700 overflow-hidden';
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', `${book.title}: lessons done`);
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(percent));
        const bar = document.createElement('div');
        bar.className = 'h-full rounded-full bg-brand-600';
        bar.style.width = `${percent}%`;
        track.appendChild(bar);
        const status = document.createElement('p');
        status.className = 'text-xs text-gray-400 tabular-nums';
        status.textContent = `${done}/${book.lessons} lessons · ${percent}%`;
        card.append(head, meta, track, status);
        dom.libraryGrid.appendChild(card);
    });
    renderHomeKpis();
}

// Closing is deliberately NOT a separate control: the card that opened the book
// closes it, and the home panel stays where it is, empty (user, 21-09-26).
function closeBook() {
    activeBookFile = null;
    assetBase = '';
    tutorialData = {};
    quizData = [];
    generatedQuizData = null;
    activeQuizData = [];
    fullQuizData = [];
    moduleId = '';
    quizSessions.practice = null;
    quizSessions.generate = null;
    progress = { completed: {} };
    try { localStorage.removeItem('eduActiveBook'); } catch (error) { /* per-viewer convenience */ }
    closeQuizSetup();
    setAppState(false);
    showLandingDashboard();
}

// The title a reader gives a book overrides the one baked into module.json, so a
// rename never rewrites a 5 MB import artifact. The server owns the override, or
// it would not survive a different browser.
async function renameBook(file, title) {
    const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const book = libraryBooks.find(entry => entry.file === file);
    if (!book || !clean || clean === book.title) return;
    const previous = book.title;
    book.title = clean;                       // optimistic: the card redraws at once
    if (file === activeBookFile) tutorialData.title = clean;
    renderHome();
    try {
        const response = await fetch('api/book/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file, title: clean })
        });
        if (!response.ok) throw new Error(`Rename failed (${response.status}).`);
    } catch (error) {
        book.title = previous;                // put it back rather than lie about it
        if (file === activeBookFile) tutorialData.title = previous;
        renderHome();
        alert(`Could not rename the book: ${error.message}`);
    }
}

// Swaps the card title for an input in place. Enter commits, Escape and blur
// cancel; clicks inside it must not reach the card, which would open the book.
function beginRename(titleEl) {
    const file = titleEl.dataset.rename;
    if (!file || titleEl.dataset.editing === 'true') return;
    titleEl.dataset.editing = 'true';
    const original = titleEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.maxLength = 160;
    input.className = 'w-full min-w-0 rounded-md border border-brand-600 bg-gray-900 px-2 py-1 text-white text-sm focus:outline-none';
    ['click', 'dblclick', 'keydown', 'mousedown'].forEach(type =>
        input.addEventListener(type, event => event.stopPropagation()));
    let settled = false;
    const finish = commit => {
        if (settled) return;
        settled = true;
        const next = input.value;
        titleEl.dataset.editing = 'false';
        titleEl.textContent = original;
        input.replaceWith(titleEl);
        if (commit) renameBook(file, next);
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
        else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false));
    titleEl.replaceWith(input);
    input.focus();
    input.select();
}

async function openBook(file) {
    if (file === activeBookFile) {
        closeBook();
        return;
    }
    try {
        // A packaged book is addressed by folder, not by file: book/<id>/module.json,
        // with its assets beside it. Legacy books keep the data/<file>.json path.
        const { url, base } = bookUrlFor(file);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Book request failed (${response.status}).`);
        assetBase = base;
        loadModuleData(await response.json(), 'Book', file);
        try { localStorage.setItem('eduActiveBook', file); } catch (error) { /* per-viewer convenience */ }
    } catch (error) {
        alert(`Could not open the book: ${error.message}`);
    }
}

function showTutorial() {
    if (!tutorialData.title) return;
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    setReaderMode(true);
    
    dom.tutorialScreen.classList.remove('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    closeQuizSetup();

    window.scrollTo({ top: 0, behavior: 'smooth' });
    // 'learn', not 'tutorial': the 'tutorial' key belongs to nav-tutorial, which
    // is the HOME button since the nav was relabelled. Passing it here left the
    // underline stuck on HOME while the reader was open.
    updateNavUI('learn');
}

function showQuizScreen() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    setReaderMode(false);
    
    dom.tutorialScreen.classList.add('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.resultScreen.classList.add('hidden-view');
    closeQuizSetup();
    dom.quizScreen.classList.remove('hidden-view');
    
    dom.progressContainer.classList.remove('hidden-view');
    dom.scoreTracker.textContent = tallyScore();
    updateNavUI(navTabForScope());
    renderQuizScope();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Run tally ----------------------------------------------------------------
// A plain run scores itself. A "Retry the wrong ones" run scores only the questions
// it shows, so the carried pair below puts the already-passed ones back before
// anything is displayed or posted. Every score/total the reader or the server sees
// goes through these two.
function tallyScore() { return score + carriedCorrect; }
function tallyTotal() { return carriedTotal || activeQuizData.length; }

// One place starts a run, so nothing can begin with a stale wrong-list or a stale
// carry from the previous assessment.
function resetRunState(questions) {
    activeQuizData = questions;
    fullQuizData = questions;
    wrongIndices = [];
    carriedCorrect = 0;
    carriedTotal = 0;
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
    selectedAnswer = null;
}

function startQuiz() {
    if (!tutorialData.title) return;
    showQuizScreen();
    if (!isAnswered && activeQuizData.length > 0) {
        loadQuestion();
    } else if (activeQuizData.length === 0) {
        showResults();
    }
    saveQuizSession();
}

function showResults() {
    dom.landingDashboard.classList.add('hidden-view');
    dom.contentSection.classList.remove('hidden-view');
    setReaderMode(false);
    
    dom.tutorialScreen.classList.add('hidden-view');
    dom.settingsScreen.classList.add('hidden-view');
    dom.quizScreen.classList.add('hidden-view');
    closeQuizSetup();
    dom.resultScreen.classList.remove('hidden-view');
    dom.progressContainer.classList.add('hidden-view');

    // The carried tally, not this run's raw count: a retry that fixes the last 3 of
    // 20 must read 20/20, or the reader is told they failed an assessment they passed.
    const scored = tallyScore();
    const totalQuestions = tallyTotal();
    const percent = totalQuestions === 0 ? 0 : Math.round((scored / totalQuestions) * 100);

    dom.finalFraction.textContent = `${scored} / ${totalQuestions}`;

    dom.resultMessage.innerHTML = '';
    if (quizScope === 'ai') {
        dom.generateNewBtn.classList.remove('hidden-view');
    } else {
        dom.generateNewBtn.classList.add('hidden-view');
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

    if (progressSaveFailed) {
        const warn = document.createElement('span');
        warn.className = 'block mt-6 text-sm text-amber-300';
        warn.textContent = 'Your score could not be saved \u2014 the connection dropped. It is queued and will be saved next time this page loads.';
        dom.resultMessage.appendChild(warn);
        progressSaveFailed = false;
    }

    if (owningBlockId() && totalQuestions > 0 && scored < totalQuestions && !progress.completed[owningBlockId()]) {
        const rule = document.createElement('span');
        rule.className = 'block mt-6 text-sm text-gray-400';
        rule.textContent = wrongIndices.length
            ? `Not complete yet \u2014 a block needs 100% (you got ${scored}/${totalQuestions}). Retry just the ${wrongIndices.length} you missed to finish it.`
            : `Not complete yet \u2014 a block needs 100% (you got ${scored}/${totalQuestions}). Retake to finish it.`;
        dom.resultMessage.appendChild(rule);
    }

    // Before the 0% early return below -- a zero score is exactly when the reader
    // most needs a way back to the block.
    renderResultNav(scored, totalQuestions);

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

// --- Result screen navigation ----------------------------------------------
const RESULT_BTN_BASE = 'min-h-[44px] max-w-full font-bold uppercase tracking-wider py-4 px-8 transition-colors rounded-lg border-2';
const RESULT_BTN_PRIMARY = 'bg-brand-600 hover:bg-brand-900 border-brand-600 text-white';
const RESULT_BTN_SECONDARY = 'bg-transparent border-gray-500 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-gray-400';

function blockFromId(blockId) {
    const match = /^ch(\d{2})-b(\d{2})$/.exec(blockId || '');
    if (!match) return null;
    return clampTheory({ chapterIndex: Number(match[1]) - 1, blockIndex: Number(match[2]) - 1 });
}

function styleResultButton(button, primary, order) {
    if (!button) return;
    const hidden = button.classList.contains('hidden-view');
    button.className = `${RESULT_BTN_BASE} ${primary ? RESULT_BTN_PRIMARY : RESULT_BTN_SECONDARY}`;
    if (hidden) button.classList.add('hidden-view');
    // Visual order only; on a phone the column stacks, so the lead action is on top.
    button.style.order = String(order);
}

// Pass a block and the way forward leads. Miss it and the way back leads --
// but Next stays available, because moving on is the reader's call, not ours.
function renderResultNav(scored, totalQuestions) {
    const origin = blockFromId(quizScopeBlockId);
    const passed = totalQuestions > 0 && scored === totalQuestions;
    const next = origin ? nextTheory(origin) : null;

    if (dom.resultBackLabel) dom.resultBackLabel.textContent = origin ? 'Back to block' : 'Back to reading';

    if (dom.resultNextBtn) {
        dom.resultNextBtn.classList.toggle('hidden-view', !next);
        if (next && dom.resultNextLabel) {
            const block = theoryBlocks(next.chapterIndex)[next.blockIndex];
            const sameChapter = next.chapterIndex === origin.chapterIndex;
            const name = (block && block.term) || `Block ${next.blockIndex + 1}`;
            dom.resultNextLabel.textContent = sameChapter
                ? `Next: ${name} \u2192`
                : `Next chapter: ${name} \u2192`;
            dom.resultNextBtn.title = name;
        }
    }

    // An AI quiz launched from a block regenerates for THAT block, not the book.
    if (dom.generateNewBtn) {
        dom.generateNewBtn.textContent = origin ? 'Another AI quiz on this block' : 'Generate Another Quiz';
    }

    // Miss some and redoing only those is the action worth leading with, so it
    // takes the primary slot off "Back to block".
    const missed = wrongIndices.length;
    if (dom.resultRetryWrongBtn) {
        dom.resultRetryWrongBtn.classList.toggle('hidden-view', missed === 0);
        if (dom.resultRetryWrongLabel) {
            dom.resultRetryWrongLabel.textContent = missed === 1
                ? 'Retry the 1 you missed'
                : `Retry the ${missed} you missed`;
        }
    }

    const forward = Boolean(origin && passed && next);
    styleResultButton(dom.resultNextBtn, forward, forward ? 0 : 4);
    styleResultButton(dom.resultRetryWrongBtn, missed > 0, forward ? 2 : 0);
    styleResultButton(dom.resultBackBtn, !forward && !missed && Boolean(origin), forward ? 1 : 1);
    styleResultButton(dom.restartBtn, false, 3);
    styleResultButton(dom.resultNewBtn, false, 5);
    styleResultButton(dom.generateNewBtn, !origin && quizScope === 'ai' && !missed, 3);
}

function returnToReader(selection) {
    if (selection) selectTheory(selection);
    showTutorial();
    // selectTheory already resets the pane's scrollTop -- but from HERE that write is
    // a no-op: #tutorial-screen still carries .hidden-view (display:none !important)
    // while the result screen is up, so #tutorial-article has no layout box and the
    // browser drops the assignment, restoring the old offset once it becomes visible.
    // showTutorial() is what removes .hidden-view, so the reset has to land AFTER it.
    // Same tick is enough: the class removal is synchronous, so layout exists by now --
    // a timer here would be a race, not a fix.
    if (dom.tutorialArticle) dom.tutorialArticle.scrollTop = 0;
}

function showResultsViewOnly() {
    showResults();
    updateNavUI(navTabForScope());
    renderQuizScope();
    // A resumed session reaches the result screen WITHOUT passing through the
    // genuine-finish path, so a perfect score shown here may never have been
    // recorded -- which is how a reader can stare at 5/5 and watch the block stay
    // unticked. Claiming it now is safe: the server re-checks the score itself and
    // the write is idempotent, so a repeat changes nothing.
    const blockId = owningBlockId();
    if (blockId && tallyTotal() && tallyScore() === tallyTotal() && !progress.completed[blockId]) {
        recordQuizResult();
    }
}

// The whole assessment again, from the set it originally held -- not from whatever
// a retry narrowed it to.
function restartQuiz() {
    resetRunState(fullQuizData.length ? fullQuizData : activeQuizData);
    startQuiz();
    saveQuizSession();
}

// Only the questions missed. The ones already right disappear from the run (user,
// 20-09-26) and are carried instead, so the assessment still has to be 100% before
// the block ticks -- it just stops charging 19 answers to fix one.
function retryWrongOnly() {
    const wrong = wrongIndices.map(index => activeQuizData[index]).filter(Boolean);
    if (!wrong.length) return;
    const originalTotal = tallyTotal();
    const keepFull = fullQuizData.length ? fullQuizData : activeQuizData;
    activeQuizData = wrong;
    fullQuizData = keepFull;
    carriedCorrect = originalTotal - wrong.length;
    carriedTotal = originalTotal;
    wrongIndices = [];
    currentQuestionIndex = 0;
    score = 0;
    isAnswered = false;
    selectedAnswer = null;
    startQuiz();
    saveQuizSession();
}

// --- Quiz sessions ------------------------------------------------------------
// PRACTICE and GENERATE QUIZ each keep their own quiz -- questions, position, score,
// the answer just picked -- until a new one is started (user, 17-09-26: "whenever I
// move to other screen and back they reset ... they should stay until I press new").
// Quizzes launched from the reader are 'reader' quizzes and never overwrite a tab's.
const quizSessions = { practice: null, generate: null };
let quizOrigin = 'tab';

function sessionKey() {
    return quizScope === 'ai' ? 'generate' : 'practice';
}

function sessionStoreKey() {
    return `eduQuizSessions.${moduleId || 'module'}`;
}

function saveQuizSession() {
    if (quizOrigin !== 'tab' || !activeQuizData.length) return;
    quizSessions[sessionKey()] = {
        questions: activeQuizData, quizScope, quizScopeBlockId, quizScopeLabel,
        currentQuestionIndex, score, isAnswered, selectedAnswer,
        aiFromSetup, lastGenerateSelection,
        // Without these a reload mid-assessment loses the wrong-list (the retry button
        // silently disappears) and loses the carry (a finished retry posts 3/3).
        fullQuestions: fullQuizData, wrongIndices, carriedCorrect, carriedTotal,
    };
    try {
        const out = {};
        Object.entries(quizSessions).forEach(([key, session]) => {
            if (!session) return;
            // The written bank is already loaded, so a practice quiz is stored as question ids.
            const asIds = list => (Array.isArray(list) ? list : []).map(q => q && q.source && q.source.question);
            out[key] = key === 'practice'
                ? { ...session, questions: asIds(session.questions), fullQuestions: asIds(session.fullQuestions) }
                : session;
        });
        localStorage.setItem(sessionStoreKey(), JSON.stringify(out));
    } catch (error) { /* per-viewer convenience; the in-page session still holds */ }
}

function loadQuizSessions() {
    quizSessions.practice = null;
    quizSessions.generate = null;
    try {
        const saved = JSON.parse(localStorage.getItem(sessionStoreKey()) || '{}');
        const byId = new Map(quizData.map(q => [q && q.source && q.source.question, q]));
        ['practice', 'generate'].forEach(key => {
            const session = saved[key];
            if (!session || !Array.isArray(session.questions) || !session.questions.length) return;
            const questions = key === 'practice' ? session.questions.map(id => byId.get(id)) : session.questions;
            // The bank changed under a stored quiz: drop it rather than show broken questions.
            if (questions.some(q => !q || !Array.isArray(q.options))) return;
            const storedFull = Array.isArray(session.fullQuestions) ? session.fullQuestions : [];
            let fullQuestions = key === 'practice' ? storedFull.map(id => byId.get(id)) : storedFull;
            // A stale full set only costs "Retry Quiz" its wider scope; the run itself
            // is still sound, so fall back to the run rather than dropping the session.
            if (!fullQuestions.length || fullQuestions.some(q => !q || !Array.isArray(q.options))) fullQuestions = questions;
            quizSessions[key] = { ...session, questions, fullQuestions };
        });
    } catch (error) { /* nothing stored, or storage blocked */ }
}

function sessionFinished(session) {
    return session.currentQuestionIndex >= session.questions.length;
}

function resumeQuizSession(key) {
    const session = quizSessions[key];
    if (!session || !tutorialData.title) return false;
    activeQuizData = session.questions;
    fullQuizData = Array.isArray(session.fullQuestions) && session.fullQuestions.length
        ? session.fullQuestions : session.questions;
    wrongIndices = Array.isArray(session.wrongIndices) ? session.wrongIndices.filter(Number.isInteger) : [];
    carriedCorrect = Number.isInteger(session.carriedCorrect) ? session.carriedCorrect : 0;
    carriedTotal = Number.isInteger(session.carriedTotal) ? session.carriedTotal : 0;
    quizScope = session.quizScope;
    quizScopeBlockId = session.quizScopeBlockId;
    quizScopeLabel = session.quizScopeLabel;
    currentQuestionIndex = session.currentQuestionIndex;
    score = session.score;
    aiFromSetup = Boolean(session.aiFromSetup);
    lastGenerateSelection = session.lastGenerateSelection || [];
    quizOrigin = 'tab';
    if (quizScope === 'ai') generatedQuizData = activeQuizData;
    if (sessionFinished(session)) {
        isAnswered = false;
        showResultsViewOnly();
        return true;
    }
    showQuizScreen();
    loadQuestion();
    if (session.isAnswered && Number.isInteger(session.selectedAnswer)) {
        const cards = dom.optionsContainer.querySelectorAll('.option-card');
        if (cards[session.selectedAnswer]) handleAnswerSelect(session.selectedAnswer, cards[session.selectedAnswer], true);
    }
    return true;
}

// A tab goes back to its own quiz; only with none does it open the picker.
function openQuizTab(mode) {
    if (!tutorialData.title) return;
    if (!resumeQuizSession(mode)) openQuizSetup(mode);
}

// --- Quiz scope -------------------------------------------------------------
// One place decides what activeQuizData holds and what the header calls it, so
// the nav highlight and the scope caption can never disagree with the data.
function setModuleQuiz() {
    resetRunState(quizData);
    quizScope = 'module';
    quizScopeBlockId = null;
    quizScopeLabel = tutorialData.title || 'Whole module';
}

function setBlockQuiz(questions, chapterIndex = currentTheory.chapterIndex, blockIndex = currentTheory.blockIndex) {
    resetRunState(questions);
    quizScope = 'block';
    quizScopeBlockId = theoryBlockId(chapterIndex, blockIndex);
    const chapter = theoryChapters()[chapterIndex];
    const blocks = theoryBlocks(chapterIndex);
    const block = blocks[blockIndex];
    const chapterName = (chapter && chapter.title) || `Chapter ${chapterIndex + 1}`;
    const blockName = (block && block.term) || `Block ${blockIndex + 1}`;
    quizScopeLabel = `${chapterName} — ${blockName}`;
}

// Any mix of blocks from the written bank. No single block owns it, so no block is
// marked complete by it.
function setSelectionQuiz(questions, label) {
    resetRunState(questions);
    quizScope = 'selection';
    quizScopeBlockId = null;
    quizScopeLabel = label;
}

function setAiQuiz(questions, blockId = null) {
    resetRunState(questions);
    generatedQuizData = questions;
    quizScope = 'ai';
    quizScopeBlockId = blockId;
}

// --- Study progress ---------------------------------------------------------
// A block is complete when an assessment SCOPED TO IT is answered perfectly.
// Chapter percentage is completed blocks / blocks in that chapter, which is what
// the reader asked for: 1 of 10 reads 10%.

async function refreshProgress() {
    try {
        const response = await fetch(`api/progress?module=${encodeURIComponent(moduleId)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data.completed === 'object' && data.completed) progress = data;
    } catch (error) {
        // Offline or the endpoint is missing: the reader still reads, the
        // percentages just stay at zero. Never block the page on progress.
    }
    renderTheoryToc();
    renderTheoryBlock();
    if (!dom.landingDashboard.classList.contains('hidden-view')) renderHome();
}

function isBlockComplete(chapterIndex, blockIndex) {
    return Boolean(progress.completed[theoryBlockId(chapterIndex, blockIndex)]);
}

function chapterProgress(chapterIndex) {
    const total = theoryBlocks(chapterIndex).length;
    if (!total) return { done: 0, total: 0, percent: 0 };
    let done = 0;
    for (let i = 0; i < total; i += 1) if (isBlockComplete(chapterIndex, i)) done += 1;
    return { done, total, percent: Math.round((done / total) * 100) };
}

function overallProgress() {
    let done = 0, total = 0;
    theoryChapters().forEach((_chapter, index) => {
        const p = chapterProgress(index);
        done += p.done;
        total += p.total;
    });
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

function announceCompletion(blockId) {
    const match = /^ch(\d{2})-b(\d{2})$/.exec(blockId);
    if (!match || !dom.resultMessage) return;
    const chapterIndex = Number(match[1]) - 1;
    const chapter = theoryChapters()[chapterIndex];
    const p = chapterProgress(chapterIndex);
    const note = document.createElement('span');
    note.className = 'block mt-6 text-base font-semibold text-green-400';
    const name = (chapter && chapter.title) || `Chapter ${chapterIndex + 1}`;
    note.textContent = `✓ Block complete — ${name} is now ${p.percent}% (${p.done} of ${p.total}).`;
    dom.resultMessage.appendChild(note);
}

// Called ONLY when a quiz is actually finished, never when results are re-opened
// for viewing -- otherwise re-reading an old result would re-post it.
// Which block a finished quiz actually belongs to.
//
// quizScopeBlockId is set when the quiz was launched from the reader, from a
// one-block picker selection, or from a one-block AI generation. It is null for a
// multi-block 'selection'. But a selection whose questions ALL come from one block
// is that block's assessment in everything but name, so fall back to asking the
// questions themselves. Answering a block's five questions perfectly should tick
// the block however the reader happened to start it.
//
// Asked of the FULL set the run started with, never the narrowed retry set. A
// module-wide quiz whose only three misses happen to sit in one block would
// otherwise tick that block off a 20-question carried tally drawn from the whole
// book -- claiming a block the reader never assessed on its own.
function owningBlockId() {
    if (quizScopeBlockId) return quizScopeBlockId;
    const asked = Array.isArray(fullQuizData) && fullQuizData.length ? fullQuizData : activeQuizData;
    if (!Array.isArray(asked) || !asked.length) return null;
    const blocks = new Set();
    for (const question of asked) {
        const block = question && question.source && question.source.block;
        if (!block) return null;                 // unattributed question: cannot claim a block
        blocks.add(block);
    }
    return blocks.size === 1 ? [...blocks][0] : null;
}

const PROGRESS_PENDING_KEY = 'eduPendingProgress';

function queuePendingProgress(body) {
    try {
        const queued = JSON.parse(localStorage.getItem(PROGRESS_PENDING_KEY) || '[]');
        localStorage.setItem(PROGRESS_PENDING_KEY, JSON.stringify([...queued.slice(-9), body]));
    } catch (error) { /* storage blocked: the retry below was the only chance */ }
}

// One POST with retries. The network to this box spikes, and a dropped write used
// to be swallowed silently -- the reader saw their score and the block was never
// ticked, with nothing on screen or in the server log to say why.
async function postProgress(body, attempts = 3) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = await fetch('api/progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (response.ok) return await response.json();
            if (response.status >= 400 && response.status < 500) return null;   // our fault, retrying will not help
        } catch (error) { /* network: fall through to the retry */ }
        if (attempt < attempts) await new Promise(done => setTimeout(done, 400 * attempt));
    }
    return undefined;                            // undefined = never reached the server
}

// Re-sends anything a previous session could not save.
async function flushPendingProgress() {
    let queued = [];
    try { queued = JSON.parse(localStorage.getItem(PROGRESS_PENDING_KEY) || '[]'); } catch (error) { return; }
    if (!Array.isArray(queued) || !queued.length) return;
    const left = [];
    for (const body of queued) {
        const data = await postProgress(body, 2);
        if (data === undefined) left.push(body);
        else if (data && data.completed) progress = { completed: data.completed };
    }
    try {
        if (left.length) localStorage.setItem(PROGRESS_PENDING_KEY, JSON.stringify(left));
        else localStorage.removeItem(PROGRESS_PENDING_KEY);
    } catch (error) { /* storage blocked */ }
    if (left.length !== queued.length) renderTheoryToc();
}

async function recordQuizResult() {
    const blockId = owningBlockId();
    // The carried pair, not this run's length: a retry run holds only the questions
    // that were missed, and posting 3/3 would tick a block on three of twenty.
    const total = tallyTotal();
    const scored = tallyScore();
    // No single block owns this quiz (a genuine multi-block selection), so there is
    // nothing to tick. owningBlockId() already falls back to the questions' own
    // source blocks, so a one-block quiz never lands here.
    if (!blockId || total === 0) return;
    const body = { module: moduleId, block: blockId, score: scored, total, source: quizScope === 'ai' ? 'ai' : 'written' };
    const data = await postProgress(body);
    if (data === undefined) {
        // Never reached the server. Keep it so the next page load saves it, and say
        // so on screen rather than leaving the reader to wonder.
        queuePendingProgress(body);
        progressSaveFailed = true;
    } else if (data) {
        if (data.completed) progress = { completed: data.completed };
        if (data.marked) announceCompletion(blockId);
    }
    renderTheoryToc();
}

// The nav tab a given scope belongs under. A block slice is still the written
// bank, so it lights up "Quiz", not "AI quiz".
function navTabForScope() {
    return quizScope === 'ai' ? 'generated-quiz' : 'quiz';
}

function renderQuizScope() {
    if (!dom.quizScopeLabel) return;
    // A retry run says so plainly, or the caption reads "3 questions" on an
    // assessment the reader knows has twenty.
    if (carriedTotal) {
        dom.quizScopeLabel.textContent =
            `${quizScopeLabel || tutorialData.title || 'Assessment'} · retrying ${activeQuizData.length} of ${carriedTotal} · ${carriedCorrect} already correct`;
        return;
    }
    if (quizScope === 'module') {
        dom.quizScopeLabel.textContent = `Whole module · ${activeQuizData.length} questions`;
    } else if (quizScope === 'block' || quizScope === 'selection') {
        dom.quizScopeLabel.textContent = `${quizScopeLabel} · ${activeQuizData.length} question${activeQuizData.length === 1 ? '' : 's'}`;
    } else {
        dom.quizScopeLabel.textContent = `AI-written · ${activeQuizData.length} questions`;
    }
}

dom.navTutorial.addEventListener('click', showLandingDashboard); 
dom.brandHome.addEventListener('click', () => { showLandingDashboard(); if (!isWideMenu()) setMenuOpen(false); });

// Landing card and PRACTICE tab: pick a chapter and block first (user, 17-09-26).
// The in-reader Begin Assessment button stays the one-click scoped quiz.
dom.startBtn.addEventListener('click', () => openQuizTab('practice'));
dom.readTutorialBtn.addEventListener('click', () => {
    const next = nextLesson();
    if (next) selectTheory({ chapterIndex: next.chapterIndex, blockIndex: next.blockIndex });
    showTutorial();
});
// ⚠ A click on the TITLE is deferred, because the first click of a double-click
// would otherwise open or close the book -- and closing re-renders the grid, so the
// card is gone before the second click lands and renaming was impossible. Anywhere
// else on the card still opens or closes it immediately.
let titleClickTimer = null;
const TITLE_DBLCLICK_MS = 260;

dom.libraryGrid.addEventListener('click', event => {
    const card = event.target.closest('[data-book]');
    if (!card) return;
    const file = card.dataset.book;
    if (event.target.closest('[data-rename]')) {
        clearTimeout(titleClickTimer);
        titleClickTimer = setTimeout(() => { titleClickTimer = null; openBook(file); }, TITLE_DBLCLICK_MS);
        return;
    }
    openBook(file);
});
dom.libraryGrid.addEventListener('dblclick', event => {
    const titleEl = event.target.closest('[data-rename]');
    if (!titleEl) return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(titleClickTimer);          // cancel the deferred open
    titleClickTimer = null;
    beginRename(titleEl);
});
// role="button" carries no built-in key handling; these two put it back.
dom.libraryGrid.addEventListener('keydown', event => {
    const card = event.target.closest('[data-book]');
    if (!card || event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBook(card.dataset.book); }
});
dom.prevBlockBtn.addEventListener('click', () => { const target = previousTheory(); if (target) selectTheory(target); });
dom.nextBlockBtn.addEventListener('click', () => { const target = nextTheory(); if (target) selectTheory(target); });
dom.blockAiQuizBtn.addEventListener('click', startBlockAiQuiz);
dom.tocToggleBtn.addEventListener('click', () => setTocOpen(!tocOpen));
dom.tocCloseBtn.addEventListener('click', () => setTocOpen(false));
dom.tocBackdrop.addEventListener('click', () => setTocOpen(false));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && tocOpen && !isWideViewport()) setTocOpen(false);
});
window.matchMedia(WIDE_VIEWPORT).addEventListener('change', syncTocToViewport);
document.addEventListener('DOMContentLoaded', syncTocToViewport);
window.addEventListener('hashchange', () => {
    if (!theoryChapters().length) return;
    selectTheory(theoryFromHash());
});
// THE FIX: assess the block you are actually reading, not all 9 chapters.
// Blocks with no pre-written question fall through to the AI generator rather
// than dead-ending on a disabled button.
dom.tutorialToQuizBtn.addEventListener('click', () => {
    const scoped = currentBlockQuiz();
    if (!scoped.length) {
        if (aiReady()) { startBlockAiQuiz(); }
        else { setAiBlockStatus('No written questions for this block, and no model is connected to write any. Connect one in Settings.'); }
        return;
    }
    setBlockQuiz(scoped);
    quizOrigin = 'reader';
    startQuiz();
});

dom.nextBtn.addEventListener('click', () => {
    currentQuestionIndex++;
    if (currentQuestionIndex < activeQuizData.length) {
        loadQuestion();
    } else {
        // The one genuine finish. showResults() is also reached by re-opening an
        // old result, which must not re-record anything.
        recordQuizResult();
        showResults();
    }
    saveQuizSession();
});

dom.retakeBtnHeader.addEventListener('click', restartQuiz);
// New opens the picker; the current quiz stays saved until the picker's Start replaces it.
dom.quizNewBtn.addEventListener('click', () => openQuizSetup(sessionKey()));
dom.resultNewBtn.addEventListener('click', () => openQuizSetup(sessionKey()));
dom.restartBtn.addEventListener('click', restartQuiz);
if (dom.resultRetryWrongBtn) dom.resultRetryWrongBtn.addEventListener('click', retryWrongOnly);

dom.startGeneratedBtn.addEventListener('click', () => openQuizTab('generate'));
dom.generateNewBtn.addEventListener('click', () => {
    // A quiz picked on the setup screen regenerates the SAME pick, block or not.
    if (aiFromSetup) {
        startGeneratedQuiz(lastGenerateSelection);
        return;
    }
    const origin = blockFromId(quizScopeBlockId);
    if (origin && quizScope === 'ai') {
        // Return to the assessed block first, for two reasons: startBlockAiQuiz
        // reads currentTheory, so it must be THIS block; and generation takes
        // 25-35 s with its status line in the reader -- left on the result
        // screen, the click would show nothing for half a minute.
        returnToReader(origin);
        startBlockAiQuiz();
        return;
    }
    startGeneratedQuiz();
});
dom.resultBackBtn.addEventListener('click', () => returnToReader(blockFromId(quizScopeBlockId)));
dom.resultNextBtn.addEventListener('click', () => {
    const origin = blockFromId(quizScopeBlockId);
    const next = origin ? nextTheory(origin) : null;
    if (next) returnToReader(next);
});

// The tab says GENERATE QUIZ, so it generates. It used to reopen the last
// generated quiz whenever one existed, which meant the tab only ever generated
// once per session and silently showed a stale quiz after that.
dom.navGeneratedQuiz.addEventListener('click', () => openQuizTab('generate'));

// The written bank. Coming back from an AI quiz resets to the whole module; a
// block slice is left alone, because that IS the written bank, just scoped.
// The written bank. Opens the picker; an unfinished written quiz is offered as Resume there.
dom.navQuiz.addEventListener('click', () => openQuizTab('practice'));

function loadModuleData(parsedData, fallbackTitle, bookFile = null) {
    if (!parsedData.tutorialData || !parsedData.quizData || !Array.isArray(parsedData.quizData)) {
        throw new Error("Invalid JSON schema. Must contain 'tutorialData' object and 'quizData' array.");
    }

    tutorialData = parsedData.tutorialData;
    quizData = parsedData.quizData;
    generatedQuizData = null;
    setModuleQuiz();
    // A different module starts from its own progress, never the last one's.
    activeBookFile = bookFile;
    moduleId = moduleIdFor(parsedData, bookFile);
    loadQuizSessions();
    progress = { completed: {} };
    refreshProgress();

    renderTutorial();
    if (!tutorialData.title) tutorialData.title = fallbackTitle;
    setAppState(true);
    showLandingDashboard();
}

dom.customDataUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
            loadModuleData(parsedData, 'Uploaded module', null);
            
        } catch (error) {
            console.error("JSON error:", error);
            alert("Failed to load data: " + error.message);
        }
        dom.customDataUpload.value = '';
    };
    reader.readAsText(file);
});

// Helper Function that injects the WebComponent
function formatText(text) {
    if (!text) return '';
    const viewer = document.createElement('rich-text-viewer');
    viewer.setAttribute('content', encodeURIComponent(text));
    return viewer.outerHTML;
}

// --- Theory reader: one block at a time, with a chapter/block table of
// contents on the left. Replaces the original renderTutorial(), which
// concatenated every chapter of every section into one scrolling page.
let currentTheory = { chapterIndex: 0, blockIndex: 0 };

function theoryChapters() {
    return Array.isArray(tutorialData.sections) ? tutorialData.sections : [];
}

// The bank already carries the link back to the block that produced each
// question: quizData[i].source = {chapter, block: 'ch01-b07', question}.
// Verified against the shipped module: all 109 block ids derive exactly from
// (chapter ordinal, item ordinal), zero mismatches -- so this is a lookup, not
// a guess. 15 of the 124 blocks have no pre-written question; those fall back
// to the AI generator.
function theoryBlockId(chapterIndex, blockIndex) {
    const pad = n => String(n + 1).padStart(2, '0');
    return `ch${pad(chapterIndex)}-b${pad(blockIndex)}`;
}

function quizForBlock(chapterIndex, blockIndex) {
    if (!Array.isArray(quizData)) return [];
    const wanted = theoryBlockId(chapterIndex, blockIndex);
    return quizData.filter(q => q && q.source && q.source.block === wanted);
}

function currentBlockQuiz() {
    return quizForBlock(currentTheory.chapterIndex, currentTheory.blockIndex);
}

function theoryBlocks(chapterIndex) {
    const chapter = theoryChapters()[chapterIndex];
    if (!chapter || !Array.isArray(chapter.items)) return [];
    // A populated module stores objects ({term, blocks}); older hand-written
    // modules stored plain strings. Wrap the legacy shape so both render.
    return chapter.items.map((item, index) =>
        typeof item === 'string'
            ? { term: `Point ${index + 1}`, blocks: [{ type: 'text', content: item }] }
            : item
    );
}

function clampTheory(selection) {
    const chapterIndex = Math.min(Math.max(selection.chapterIndex, 0), Math.max(theoryChapters().length - 1, 0));
    const blocks = theoryBlocks(chapterIndex);
    return { chapterIndex, blockIndex: Math.min(Math.max(selection.blockIndex, 0), Math.max(blocks.length - 1, 0)) };
}

function theoryFromHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    const chapter = Number(params.get('chapter'));
    const block = Number(params.get('block'));
    return { chapterIndex: (chapter > 0 ? chapter : 1) - 1, blockIndex: (block > 0 ? block : 1) - 1 };
}

function writeTheoryHash() {
    // Deep linking: the URL reflects the block on screen so it can be shared.
    history.replaceState(null, '', `#chapter=${currentTheory.chapterIndex + 1}&block=${currentTheory.blockIndex + 1}`);
}

function previousTheory() {
    if (currentTheory.blockIndex > 0) return { chapterIndex: currentTheory.chapterIndex, blockIndex: currentTheory.blockIndex - 1 };
    for (let c = currentTheory.chapterIndex - 1; c >= 0; c -= 1) {
        const blocks = theoryBlocks(c);
        if (blocks.length) return { chapterIndex: c, blockIndex: blocks.length - 1 };
    }
    return null;
}

function nextTheory(from = currentTheory) {
    if (from.blockIndex + 1 < theoryBlocks(from.chapterIndex).length) {
        return { chapterIndex: from.chapterIndex, blockIndex: from.blockIndex + 1 };
    }
    for (let c = from.chapterIndex + 1; c < theoryChapters().length; c += 1) {
        if (theoryBlocks(c).length) return { chapterIndex: c, blockIndex: 0 };
    }
    return null;
}

// Inline SVG is injected as markup, so strip the two things that make markup
// dangerous. The module we ship is ours, but a custom module can be uploaded
// from disk, and "it is our own data" is not a security model.
// NOTE: formatText() -> marked.parse() -> innerHTML has the same exposure and
// predates this; it is flagged, not fixed here.
function sanitizeSvg(markup) {
    const holder = document.createElement('div');
    holder.innerHTML = String(markup || '');
    holder.querySelectorAll('script, foreignObject, iframe, object, embed').forEach(el => el.remove());
    holder.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) el.removeAttribute(attr.name);
            if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        });
    });
    return holder.innerHTML;
}

// --- Book assets: the book's own figures and equations -----------------------
// Written by the importer at import time; served from /assets/<moduleId>/.
function bookImage(src, alt) {
    const frame = document.createElement('div');
    // Book figures are printed on white; a white card keeps them legible on the
    // dark page instead of floating as a bright rectangle.
    frame.className = 'rounded-lg bg-white p-3 flex justify-center';
    const img = document.createElement('img');
    img.src = assetUrl(src);
    img.alt = alt || '';
    img.loading = 'lazy';
    img.className = 'max-w-full h-auto';
    frame.appendChild(img);
    return frame;
}

function renderEquationInto(holder, block) {
    // LaTeX is rendered directly with KaTeX -- never through Markdown, which eats
    // "\\" line breaks and reads "^*" as emphasis. Anything that fails to parse
    // falls back to the book's own picture: a wrong formula is worse than a picture.
    if (block.latex && typeof katex !== 'undefined') {
        try {
            const math = document.createElement('div');
            math.className = 'overflow-x-auto text-white text-[1.15em] py-2';
            katex.render(block.latex, math, { displayMode: true, throwOnError: true });
            holder.appendChild(math);
            return true;
        } catch (error) {
            // fall through to the picture
        }
    }
    if (block.src) holder.appendChild(bookImage(block.src, block.title));
    return false;
}

function assetPanel(block, compact) {
    const panel = document.createElement('figure');
    panel.className = compact
        ? 'mb-6 rounded-xl border border-gray-700 bg-gray-900/60 p-4'
        : 'my-8 rounded-xl border border-gray-700 bg-gray-900/60 p-5';
    if (block.title) {
        const title = document.createElement('h3');
        title.className = 'text-sm font-semibold uppercase tracking-widest text-gray-400 mb-3';
        title.textContent = block.title;
        panel.appendChild(title);
    }
    if (block.type === 'equation') {
        const holder = document.createElement('div');
        const renderedAsLatex = renderEquationInto(holder, block);
        panel.appendChild(holder);
        if (renderedAsLatex && block.src) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'mt-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white';
            toggle.textContent = "Show the book's version";
            let original = null;
            toggle.addEventListener('click', () => {
                if (!original) { original = bookImage(block.src, block.title); original.classList.add('mt-2'); panel.insertBefore(original, toggle.nextSibling); }
                else { original.classList.toggle('hidden-view'); }
                toggle.textContent = original.classList.contains('hidden-view') ? "Show the book's version" : "Hide the book's version";
            });
            panel.appendChild(toggle);
        }
    } else if (block.src) {
        panel.appendChild(bookImage(block.src, block.alt || block.title));
    }
    if (block.caption) {
        const caption = document.createElement('figcaption');
        caption.className = 'mt-3 text-sm text-gray-400 italic text-center mx-auto';
        caption.textContent = block.caption;
        panel.appendChild(caption);
    }
    // Every symbol explained right under the formula, not in a legend elsewhere
    // (user, 17-09-26: going back and forth to decode a formula is distracting).
    if (block.type === 'equation' && block.explain) {
        const explain = document.createElement('div');
        explain.className = 'mt-4 pt-4 border-t border-gray-700 text-left text-sm leading-relaxed text-gray-300 mx-auto overflow-x-auto';
        explain.innerHTML = formatText(block.explain);
        panel.appendChild(explain);
    }
    return panel;
}

// ⛔⛔ THE TAILWIND PURGE LANDMINE — edu-replatform Phase 03 slice C (ruling R8).
//
// This used to be built from BOOK DATA at line ~1664:
//     `text-lg font-semibold text-${theme} mb-3`        theme = chapter.themeColor
//
// The Tailwind CDN generated CSS at RUNTIME by watching the DOM, so an assembled class name
// worked. A REAL BUILD PURGES BY SCANNING SOURCE: it keeps only classes whose COMPLETE NAME
// appears literally in a scanned file. No literal "text-indigo-500" existed anywhere, so the
// build emitted none of them and EVERY themed chapter-panel title rendered colourless. The
// CDN hid this for the app's whole life.
//
// ⛔ DO NOT "FIX" THIS WITH A tailwind.config.js `safelist`. A safelist makes the build green
//    while LEAVING THE CONSTRUCTION IN PLACE, so the next themeColor a book introduces loses
//    its colour silently all over again. The whole point of the lookup is that an unknown
//    value is VISIBLE.
//
// ⛔ EVERY VALUE HERE IS A COMPLETE CLASS STRING. Never build one by concatenation, never
//    interpolate into one — the moment you do, the purge stops seeing it.
//
// The 9 keys are MEASURED, not guessed (21-09-26, both production books):
//   geron-homl3  indigo-500 x3, emerald-500 x3, purple-500 x2, teal-500 x3,
//                amber-500 x3, sky-500 x2, rose-500 x2, violet-500 x1
//   openintro    indigo-500 x2, emerald-500 x2, sky-500 x1, amber-500 x1,
//                rose-500 x1, violet-500 x1, teal-500 x1
//   plus brand-600, which is the `chapter.themeColor || 'brand-600'` default (app.js ~2182).
const THEME_TITLE_CLASS = {
    'indigo-500':  'text-lg font-semibold text-indigo-500 mb-3',
    'emerald-500': 'text-lg font-semibold text-emerald-500 mb-3',
    'purple-500':  'text-lg font-semibold text-purple-500 mb-3',
    'teal-500':    'text-lg font-semibold text-teal-500 mb-3',
    'amber-500':   'text-lg font-semibold text-amber-500 mb-3',
    'sky-500':     'text-lg font-semibold text-sky-500 mb-3',
    'rose-500':    'text-lg font-semibold text-rose-500 mb-3',
    'violet-500':  'text-lg font-semibold text-violet-500 mb-3',
    // blue-500 is carried ONLY by the legacy data/Deployment-MLOps.json book, which IS deployed
    // (deploy.sh excludes only data/geron_hands_on_ml_ch01_ch09.json) and IS live on nn. It is a
    // real Tailwind colour, so it rendered blue under the CDN and a build WOULD have purged it.
    // Measured 21-09-26 by browsing all six books, not by reading the two packaged ones.
    'blue-500':    'text-lg font-semibold text-blue-500 mb-3',
    'brand-600':   'text-lg font-semibold text-brand-600 mb-3',
};
// ⛔ `aws-indigo` (data/Deployment-MLOps.json, one chapter) is DELIBERATELY ABSENT.
// It is not a Tailwind colour and was never in the brand palette, so `text-aws-indigo` produced
// NO RULE under the CDN either — that title has been colourless for the app's whole life.
// Inventing a hex for it would be guessing at a designer's intent. It therefore takes the
// brand-600 fallback and STAMPS data-theme-fallback="aws-indigo", which turns a silent
// pre-existing data defect into a visible one. That is the improvement, not a regression.
// An unknown themeColor renders in the brand colour AND stamps data-theme-fallback="<value>"
// on the element, so a gate can find it by selector instead of a person noticing a wrong
// shade. Exit gate: a full browse of BOTH books yields ZERO [data-theme-fallback] elements.
const THEME_TITLE_CLASS_FALLBACK = THEME_TITLE_CLASS['brand-600'];

function appendTheoryContent(parent, block, theme) {
    if (!block || typeof block !== 'object') return;
    if (block.type === 'code_cells') {
        parent.appendChild(renderCodeCells(block));
        return;
    }
    if (block.type === 'deeper') {
        parent.appendChild(renderDeeper(block));
        return;
    }
    if (block.type === 'equation' || (block.type === 'figure' && block.src && !block.svg)) {
        parent.appendChild(assetPanel(block, false));
        return;
    }
    if (block.type === 'text') {
        const wrapper = document.createElement('div');
        // The measure cap is GONE (user, 21-09-26: "the text have to fill the
        // remaining space"). Do not reintroduce a max-width here in any unit.
        // Leading is set inline instead of via `leading-relaxed`: the prose
        // renders inside <rich-text-viewer>'s shadow DOM, whose :host inherits
        // line-height -- so the value has to be on THIS element. The Tailwind
        // class was winning at 1.625 and --reading-leading (1.8) never arrived.
        // overflow-wrap is inherited into the viewer's shadow DOM: a long inline
        // `code` span (e.g. KNeighborsRegressor(n_neighbors=3)) otherwise pushed
        // phones 20 px sideways on ch01-b08, measured 17-09-26.
        wrapper.className = 'mb-6 [overflow-wrap:anywhere]';
        wrapper.style.lineHeight = 'var(--reading-leading)';
        wrapper.innerHTML = formatText(block.content);
        parent.appendChild(wrapper);
        return;
    }
    // Visual block. `svg` is inline markup (preferred: no asset files, scales,
    // themeable); `src` is an image path. Either may carry a caption.
    if (block.type === 'figure' || block.type === 'diagram') {
        const figure = document.createElement('figure');
        figure.className = 'my-8 rounded-xl border border-gray-700 bg-gray-900/60 p-5 overflow-x-auto';
        if (block.title) {
            const title = document.createElement('h3');
            title.className = 'text-sm font-semibold uppercase tracking-widest text-gray-400 mb-4';
            title.textContent = block.title;
            figure.appendChild(title);
        }
        if (block.svg) {
            const holder = document.createElement('div');
            holder.className = 'w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto';
            holder.innerHTML = sanitizeSvg(block.svg);
            figure.appendChild(holder);
        } else if (block.src) {
            const img = document.createElement('img');
            img.src = assetUrl(block.src);
            img.alt = block.alt || block.caption || '';
            img.loading = 'lazy';
            img.className = 'mx-auto max-w-full h-auto rounded-lg';
            figure.appendChild(img);
        }
        if (block.caption) {
            const caption = document.createElement('figcaption');
            caption.className = 'mt-4 text-sm text-gray-400 italic text-center mx-auto';
            caption.innerHTML = formatText(block.caption);
            figure.appendChild(caption);
        }
        parent.appendChild(figure);
        return;
    }
    const panel = document.createElement('section');
    panel.className = block.type === 'callout'
        ? 'my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5'
        : 'my-6 rounded-xl border border-gray-700 bg-gray-900/60 p-5';
    if (block.title) {
        const title = document.createElement('h3');
        if (block.type === 'callout') {
            title.className = 'text-lg font-semibold text-brand-400 mb-3';
        } else {
            // Lookup, never interpolation — see THEME_TITLE_CLASS above.
            title.className = THEME_TITLE_CLASS[theme] || THEME_TITLE_CLASS_FALLBACK;
            if (!THEME_TITLE_CLASS[theme]) title.dataset.themeFallback = String(theme);
        }
        title.textContent = block.title;
        panel.appendChild(title);
    }
    if (block.content || block.intro) {
        const intro = document.createElement('div');
        intro.className = 'leading-relaxed';
        intro.innerHTML = formatText(block.content || block.intro);
        panel.appendChild(intro);
    }
    const bullets = Array.isArray(block.items) ? block.items : (Array.isArray(block.bullets) ? block.bullets : null);
    if (bullets) {
        const list = document.createElement('ul');
        list.className = 'mt-3 space-y-3';
        bullets.forEach(entry => {
            const liClone = templates.tutorialListItem.content.cloneNode(true);
            liClone.querySelector('span').innerHTML = formatText(entry);
            list.appendChild(liClone);
        });
        panel.appendChild(list);
    }
    parent.appendChild(panel);
}

// --- Code cells: static listings with a Copy button (ruling R24, 23-09-26) -----
// The in-app code runner (Edit / Reset / Run, a kernel per lesson on .68:8790) was
// REMOVED by user ruling R24: in-app cells are snippets that do not run standalone,
// and practice moved to a local terminal fed by each lesson's "Full script" block.
// Rulings R7 (every block runnable) and R13 (runner weight limit) are superseded.
// The `code_cells` DATA in module.json is untouched -- including `runnable` and
// `runnableReason`, which this renderer now deliberately ignores. Only rendering
// changed: each cell is read-only code with a Copy button, in reading order.
function lessonCodeCells(lesson) {
    // Scans the WHOLE CHAPTER, not just the page on screen, so "Cell N" numbers
    // run on across a walkthrough split into several lessons that share the
    // PARENT `lesson` id (e.g. ch01-b08c -> ch01-b08d).
    return theoryBlocks(currentTheory.chapterIndex)
        .flatMap(item => (item && Array.isArray(item.blocks) ? item.blocks : []))
        .filter(b => b && b.type === 'code_cells' && b.lesson === lesson && Array.isArray(b.cells))
        .flatMap(b => b.cells)
        .filter(cell => cell && typeof cell.id === 'string' && typeof cell.source === 'string');
}

function renderCodeCells(block) {
    const lesson = block.lesson;
    const wrapper = document.createElement('div');
    wrapper.className = 'not-prose my-6 space-y-4';
    const all = lessonCodeCells(lesson);
    (Array.isArray(block.cells) ? block.cells : []).forEach(cell => {
        if (!cell || typeof cell.id !== 'string' || typeof cell.source !== 'string') return;
        const number = all.findIndex(c => c.id === cell.id) + 1;
        const card = document.createElement('section');
        card.className = 'overflow-hidden rounded-xl border border-gray-700 bg-gray-900/60';
        card.setAttribute('aria-label', `Code cell ${number}`);
        card.dataset.cell = cell.id;

        const header = document.createElement('div');
        header.className = 'flex flex-wrap items-center justify-between gap-2 border-b border-gray-700 px-3 py-1';
        const label = document.createElement('div');
        label.className = 'flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400';
        label.textContent = `Cell ${number}`;
        // Every class below already exists in the built CSS (they are the old
        // secondary cell-button classes), so no Tailwind rebuild is needed.
        const copy = document.createElement('button');
        copy.className = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 text-gray-300 hover:bg-gray-700 hover:text-white';
        copy.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span data-copy-label>Copy</span>';
        eduWireCopyButton(copy, () => cell.source);
        copy.setAttribute('aria-label', `Copy cell ${number}`);
        header.append(label, copy);

        const code = document.createElement('code');
        code.textContent = cell.source;
        const pre = document.createElement('pre');
        pre.className = 'm-0 overflow-x-auto whitespace-pre bg-transparent p-4 font-mono text-sm leading-6 text-gray-100';
        pre.appendChild(code);

        card.append(header, pre);
        wrapper.appendChild(card);
    });
    return wrapper;
}

function renderDeeper(block) {
    const details = document.createElement('details');
    details.className = 'not-prose group my-6 rounded-xl border border-gray-700 bg-gray-900/60';
    const summary = document.createElement('summary');
    summary.className = 'flex min-h-[44px] cursor-pointer select-none items-center gap-2 rounded-xl px-4 text-sm font-semibold text-gray-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 [&::-webkit-details-marker]:hidden';
    // Rule 15: a `deeper` panel is either reasoning or API notes, and the label has
    // to say which. Every panel in the book used to be a Python glossary under a
    // bare "Go deeper", so the one affordance for "explain more" always returned
    // syntax. Untagged blocks are syntax, which is what they historically were.
    const deeperKind = block.kind === 'concept' ? 'concept' : 'syntax';
    const deeperLabel = deeperKind === 'concept' ? 'Go deeper · why it works' : 'Go deeper · Python notes';
    details.dataset.deeper = deeperKind;
    summary.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg><span></span>';
    summary.querySelector('span').textContent = deeperLabel;
    details.appendChild(summary);
    const list = document.createElement('ul');
    list.className = 'm-0 space-y-3 px-4 pb-4 pt-1 text-gray-300 [overflow-wrap:anywhere]';
    (Array.isArray(block.items) ? block.items : []).forEach(entry => {
        if (!entry || !entry.text) return;
        const liClone = templates.tutorialListItem.content.cloneNode(true);
        liClone.querySelector('span').innerHTML = formatText(`**${entry.term || ''}** — ${entry.text}`);
        list.appendChild(liClone);
    });
    details.appendChild(list);
    return details;
}

// "20 theory blocks · pages 70-155" -> "pages 70-155". The note is written by the
// importer, so a book without one simply contributes nothing.
function chapterPages(chapter) {
    const match = /pages?\s+[0-9]+\s*[-\u2013\u2014]\s*[0-9]+|pages?\s+[0-9]+/i.exec(String((chapter && chapter.note) || ''));
    return match ? match[0].toLowerCase() : '';
}

function renderTheoryToc() {
    if (!dom.tocNav) return;
    dom.tocNav.innerHTML = '';
    const chapters = theoryChapters();
    const totalBlocks = chapters.reduce((sum, _chapter, index) => sum + theoryBlocks(index).length, 0);
    const overall = overallProgress();
    if (dom.tocSummary) {
        dom.tocSummary.textContent =
            `${chapters.length} chapters · ${totalBlocks} blocks · ${overall.done}/${overall.total} done (${overall.percent}%)`;
    }

    chapters.forEach((chapter, chapterIndex) => {
        const blocks = theoryBlocks(chapterIndex);
        const group = document.createElement('details');
        group.className = 'rounded-lg';
        group.open = chapterIndex === currentTheory.chapterIndex;

        const done = chapterProgress(chapterIndex);
        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer select-none rounded-lg px-3 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-700 transition-colors';

        const summaryTop = document.createElement('div');
        summaryTop.className = 'flex items-baseline justify-between gap-2';
        const summaryName = document.createElement('span');
        summaryName.className = 'min-w-0';
        summaryName.textContent = chapter.title;
        const summaryPct = document.createElement('span');
        summaryPct.className = 'shrink-0 text-xs font-bold tabular-nums ' + (done.percent === 100 ? 'text-green-400' : done.percent > 0 ? 'text-brand-400' : 'text-gray-500');
        summaryPct.textContent = `${done.percent}%`;
        summaryTop.appendChild(summaryName);
        summaryTop.appendChild(summaryPct);
        summary.appendChild(summaryTop);

        const meter = document.createElement('div');
        meter.className = 'mt-2 h-1 w-full rounded-full bg-gray-700 overflow-hidden';
        meter.setAttribute('role', 'progressbar');
        meter.setAttribute('aria-valuenow', String(done.percent));
        meter.setAttribute('aria-valuemin', '0');
        meter.setAttribute('aria-valuemax', '100');
        meter.setAttribute('aria-label', `${chapter.title} progress`);
        const fill = document.createElement('div');
        fill.className = 'h-full rounded-full transition-all ' + (done.percent === 100 ? 'bg-green-500' : 'bg-brand-600');
        fill.style.width = `${done.percent}%`;
        meter.appendChild(fill);
        summary.appendChild(meter);

        const count = document.createElement('div');
        count.className = 'mt-1 text-[0.7rem] font-normal text-gray-500 tabular-nums';
        // The reader used to carry "N theory blocks · pages X-Y" above every lesson,
        // which repeated a count the sidebar already showed. Only the page range was
        // new, so it lands here beside the count (user, 21-09-26).
        count.textContent = `${done.done} of ${done.total} blocks${chapterPages(chapter) ? ` · ${chapterPages(chapter)}` : ''}`;
        summary.appendChild(count);
        group.appendChild(summary);

        const list = document.createElement('ol');
        list.className = 'mb-2 px-2 space-y-1';
        blocks.forEach((block, blockIndex) => {
            const isCurrent = chapterIndex === currentTheory.chapterIndex && blockIndex === currentTheory.blockIndex;
            const item = document.createElement('li');
            const button = document.createElement('button');
            // Active State: the block on screen is visually marked in the list.
            button.className = 'w-full text-left rounded-md px-3 py-2 text-sm leading-5 min-h-[44px] transition-colors ' + (isCurrent
                ? 'bg-brand-600/15 text-white font-semibold border-l-2 border-brand-600'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white border-l-2 border-transparent');
            const complete = isBlockComplete(chapterIndex, blockIndex);
            button.textContent = `${complete ? '✓ ' : ''}${blockIndex + 1}. ${block.term || 'Theory block'}`;
            if (complete) {
                button.classList.add('text-green-400');
                button.classList.remove('text-gray-400');
                button.title = 'Completed — 100% on this block’s assessment';
            }
            if (isCurrent) button.setAttribute('aria-current', 'true');
            button.addEventListener('click', () => {
                selectTheory({ chapterIndex, blockIndex });
                if (!isWideViewport()) setTocOpen(false);
            });
            item.appendChild(button);
            list.appendChild(item);
        });
        group.appendChild(list);
        dom.tocNav.appendChild(group);
    });
}

function renderTheoryBlock() {
    syncAiQuizButton();
    const chapter = theoryChapters()[currentTheory.chapterIndex];
    const blocks = theoryBlocks(currentTheory.chapterIndex);
    const block = blocks[currentTheory.blockIndex];
    if (!chapter || !block) return;
    const theme = chapter.themeColor || 'brand-600';

    if (dom.theoryChapterLabel) dom.theoryChapterLabel.textContent = chapter.title;
    const blockDone = isBlockComplete(currentTheory.chapterIndex, currentTheory.blockIndex);
    if (dom.theoryBlockPosition) {
        dom.theoryBlockPosition.textContent =
            `Block ${currentTheory.blockIndex + 1} of ${blocks.length}${blockDone ? ' · ✓ completed' : ''}`;
        dom.theoryBlockPosition.className = blockDone ? 'text-green-400' : '';
    }
    dom.tutorialTitle.textContent = block.term || `Theory block ${currentTheory.blockIndex + 1}`;

    dom.tutorialContent.innerHTML = '';
    // The exercise lesson renders as a form, not as a bulleted list: the book's
    // own exercises ARE this block's assessment (19-09-26). Anything else in the
    // lesson still renders above it.
    const exercises = exerciseSpec(block);
    if (exercises) {
        exercises.intro.forEach(content => appendTheoryContent(dom.tutorialContent, content, theme));
        renderExercises(dom.tutorialContent, exercises);
    } else {
        (Array.isArray(block.blocks) ? block.blocks : []).forEach(content => appendTheoryContent(dom.tutorialContent, content, theme));
    }

    const previous = previousTheory();
    const next = nextTheory();
    if (dom.prevBlockBtn) dom.prevBlockBtn.disabled = !previous;
    if (dom.nextBlockBtn) dom.nextBlockBtn.disabled = !next;
    if (dom.aiBlockStatus) dom.aiBlockStatus.textContent = '';
    renderBlockQuizButton();
}

// The button says how many questions this block actually has, so you never
// start an assessment without knowing its size -- and the 15 blocks with no
// written questions say so instead of silently opening the AI generator.
function renderBlockQuizButton() {
    if (!dom.tutorialToQuizLabel) return;
    const count = currentBlockQuiz().length;
    const done = isBlockComplete(currentTheory.chapterIndex, currentTheory.blockIndex);
    const verb = done ? 'Retake' : 'Begin Assessment';
    // On the exercise lesson the exercises on the page are the assessment. Its
    // five written questions repeat five of those exercises, so offering them as
    // a second gate is asking the same thing twice (user, 19-09-26).
    if (currentExerciseSpec()) {
        dom.tutorialToQuizLabel.textContent = done ? '✓ Exercises complete' : 'Answer the exercises above';
        dom.tutorialToQuizBtn.title = done
            ? 'Already completed. You can still redo the exercises above.'
            : 'This block is completed by answering the exercises on this page, not by a separate quiz.';
        dom.tutorialToQuizBtn.disabled = true;
        dom.tutorialToQuizBtn.classList.add('opacity-50', 'cursor-not-allowed');
        return;
    }
    dom.tutorialToQuizBtn.disabled = false;
    dom.tutorialToQuizBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    if (count > 0) {
        dom.tutorialToQuizLabel.textContent = `${verb} · ${count} question${count === 1 ? '' : 's'}`;
        dom.tutorialToQuizBtn.title = done
            ? 'Already completed. Retaking cannot un-complete it.'
            : 'Assess only the block you are reading — 100% marks it complete';
    } else {
        dom.tutorialToQuizLabel.textContent = `${verb} · AI-written`;
        dom.tutorialToQuizBtn.title = 'This block has no written questions; the connected model writes them';
    }
}

// --- End-of-chapter exercises (19-09-26) --------------------------------------
// Every chapter's last block is the book's own exercises. They used to render as
// a bulleted list with nowhere to answer, while the block still asked for five
// multiple-choice questions -- five of which simply repeat exercises already on
// the page. Now the block IS the assessment, in one of two modes:
//
//   write  - answer in your own words, marked on MEANING by the model. This is
//            the point of the exercise (user, 19-09-26: "I will answer what I'm
//            understanding, not exact text-by-text").
//   choose - the same exercises as multiple choice, marked in the browser.
//            Costs NO model call, so an exhausted free-tier quota can never lock
//            a reader out of finishing a chapter (user, 19-09-26).
//
// 'choose' needs options written into the module at import time. Where a module
// predates that, the toggle says so and write mode stays available.

const EXERCISE_TERM = /exercise/i;
const EXERCISE_STORE_PREFIX = 'eduExercises';
const EXERCISE_VERDICT_STYLE = {
    correct: ['✓ Correct', 'border-green-500/50 bg-green-500/10 text-green-300'],
    partial: ['~ Partly right', 'border-amber-500/50 bg-amber-500/10 text-amber-300'],
    incorrect: ['✗ Not right', 'border-red-500/50 bg-red-500/10 text-red-300'],
    unmarked: ['? Not marked', 'border-gray-600 bg-gray-800 text-gray-300']
};

let exerciseBusy = false;

// A lesson is the exercise lesson when its term says so AND it carries a list to
// answer. Both halves matter: a lesson merely mentioning "exercise" in prose must
// not turn into a form.
function exerciseSpec(item) {
    if (!item || !EXERCISE_TERM.test(item.term || '')) return null;
    const blocks = Array.isArray(item.blocks) ? item.blocks : [];
    const authored = blocks.find(b => b && Array.isArray(b.exercises) && b.exercises.length);
    if (authored) {
        const list = authored.exercises
            .map((entry, index) => ({
                n: Number(entry.n) || index + 1,
                prompt: String(entry.prompt || entry.question || ''),
                options: Array.isArray(entry.options) ? entry.options : null,
                correct: Number.isInteger(entry.correct) ? entry.correct : null,
                explanations: Array.isArray(entry.explanations) ? entry.explanations : null
            }))
            .filter(entry => entry.prompt);
        if (list.length) return { list, intro: blocks.filter(b => b !== authored), title: authored.title };
    }
    // Legacy shape: the callout of plain strings the importer has always written.
    const callout = blocks.find(b => b && b.type === 'callout' && Array.isArray(b.items) && b.items.length);
    if (!callout) return null;
    return {
        list: callout.items.map((text, index) => ({ n: index + 1, prompt: String(text), options: null, correct: null })),
        intro: blocks.filter(b => b !== callout),
        title: callout.title
    };
}

function currentExerciseSpec() {
    return exerciseSpec(theoryBlocks(currentTheory.chapterIndex)[currentTheory.blockIndex]);
}

function exerciseStoreKey() {
    return `${EXERCISE_STORE_PREFIX}.${moduleId || 'module'}.${theoryBlockId(currentTheory.chapterIndex, currentTheory.blockIndex)}`;
}

// Drafts live in this browser only. Nineteen typed answers are too much work to
// lose to a reload, and they are not worth a server round trip per keystroke.
function readExerciseState() {
    const empty = { mode: 'write', answers: {}, picks: {}, verdicts: {}, retryOnly: false };
    try {
        const stored = JSON.parse(localStorage.getItem(exerciseStoreKey()) || 'null');
        if (!stored || typeof stored !== 'object') return empty;
        return {
            mode: stored.mode === 'choose' ? 'choose' : 'write',
            answers: stored.answers && typeof stored.answers === 'object' ? stored.answers : {},
            picks: stored.picks && typeof stored.picks === 'object' ? stored.picks : {},
            verdicts: stored.verdicts && typeof stored.verdicts === 'object' ? stored.verdicts : {},
            // Narrowed to the exercises still to get right. Stored, so a reload does
            // not silently put the nineteen answered ones back on the page.
            retryOnly: stored.retryOnly === true
        };
    } catch (error) {
        return empty;                       // private mode or corrupt entry
    }
}

function writeExerciseState(state) {
    try { localStorage.setItem(exerciseStoreKey(), JSON.stringify(state)); }
    catch (error) { /* storage blocked: the answers still work for this session */ }
}

// --- Option card states, borrowed from the quiz -------------------------------
// The quiz reveals by setting inline colours on the card and its letter badge and
// then expanding .explanation-text. These helpers do the same so both screens
// animate identically; the only difference is that an exercise can be re-answered,
// so every state is reversible here.
const EX_BRAND = '#ef5b5b';
const EX_RIGHT = '#10b981';
const EX_WRONG = '#ef4444';

function clearExerciseOption(card) {
    const badge = card.querySelector('.option-letter');
    card.classList.remove('answered', 'cursor-default', 'opacity-50');
    card.style.borderColor = '';
    card.style.backgroundColor = '';
    badge.style.backgroundColor = '';
    badge.style.color = '';
    badge.classList.add('bg-gray-700', 'text-gray-400');
    const reveal = card.querySelector('.explanation-text');
    reveal.classList.remove('expanded');
    card.querySelector('.explanation-inner').replaceChildren();
}

// Chosen, but not yet checked.
function selectExerciseOption(card, selected) {
    clearExerciseOption(card);
    card.setAttribute('aria-pressed', String(selected));
    if (!selected) return;
    const badge = card.querySelector('.option-letter');
    card.style.borderColor = EX_BRAND;
    card.style.backgroundColor = 'rgba(239, 91, 91, 0.12)';
    badge.classList.remove('bg-gray-700', 'text-gray-400');
    badge.style.backgroundColor = EX_BRAND;
    badge.style.color = '#ffffff';
}

// Checked: green on the right answer, red on a wrong pick, the rest dimmed, and
// every card's explanation slid open on the quiz's 50 ms-per-card stagger.
function revealExerciseOption(card, index, { isCorrect, isPicked, explanation }) {
    clearExerciseOption(card);
    card.classList.add('answered');
    const badge = card.querySelector('.option-letter');
    const inner = card.querySelector('.explanation-inner');
    const title = document.createElement('span');
    title.className = 'block mb-1 font-bold tracking-wider text-xs uppercase';
    const body = document.createElement('span');
    body.className = 'text-gray-400 leading-relaxed';
    body.innerHTML = formatText(explanation || '');

    if (isCorrect) {
        title.textContent = 'Correct Answer';
        title.classList.add('text-emerald-400');
        card.style.borderColor = EX_RIGHT;
        card.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        badge.classList.remove('bg-gray-700', 'text-gray-400');
        badge.style.backgroundColor = EX_RIGHT;
        badge.style.color = '#ffffff';
    } else {
        title.textContent = isPicked ? 'Your answer' : 'Incorrect';
        title.classList.add('text-brand-400');
        if (isPicked) {
            card.style.borderColor = EX_WRONG;
            card.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            badge.classList.remove('bg-gray-700', 'text-gray-400');
            badge.style.backgroundColor = EX_WRONG;
            badge.style.color = '#ffffff';
        } else {
            card.classList.add('opacity-50');
        }
    }
    inner.append(title, body);
    setTimeout(() => card.querySelector('.explanation-text').classList.add('expanded'), 50 * index);
}

function exerciseVerdictNote(verdict, feedback) {
    const [label, classes] = EXERCISE_VERDICT_STYLE[verdict] || EXERCISE_VERDICT_STYLE.unmarked;
    const note = document.createElement('div');
    note.className = `mt-3 rounded-lg border px-3 py-2 text-sm ${classes}`;
    const tag = document.createElement('span');
    tag.className = 'font-semibold';
    tag.textContent = label;
    note.appendChild(tag);
    if (feedback) {
        const body = document.createElement('div');
        body.className = 'mt-1 leading-relaxed text-gray-200';
        body.innerHTML = formatText(feedback);
        note.appendChild(body);
    }
    return note;
}

// Submit was 18px/px-6 next to a 14px/px-4 Clear, so the pair read as a big button
// and an afterthought in both write and choose mode (user, 21-09-26). One geometry,
// two colours: emphasis comes from fill, not from size.
const EXERCISE_ACTION_BASE = 'min-h-[44px] rounded-lg border-2 px-6 py-2 text-sm font-semibold uppercase tracking-wider transition-colors';
const EXERCISE_ACTION_PRIMARY = `${EXERCISE_ACTION_BASE} border-brand-600 bg-brand-600 text-white hover:bg-brand-900`;
const EXERCISE_ACTION_SECONDARY = `${EXERCISE_ACTION_BASE} border-gray-500 text-gray-300 hover:border-gray-400 hover:bg-gray-700 hover:text-white`;

function renderExercises(parent, spec) {
    const state = readExerciseState();
    const hasChoices = spec.list.every(e => Array.isArray(e.options) && e.options.length > 1 && Number.isInteger(e.correct));
    if (state.mode === 'choose' && !hasChoices) state.mode = 'write';

    // "Retry the wrong ones" narrows the panel to what is left. The ones already
    // right DISAPPEAR rather than sit there locked (user, 20-09-26) -- twenty
    // exercises re-answered to fix one is busywork. They are not forgotten: the
    // hidden tally carries them, so the block still ticks only at 100% of the FULL
    // exercise list, and a write-mode submit gets cheaper instead of re-marking
    // answers the model already passed.
    const fullList = spec.list;
    const isRight = n => Boolean(state.verdicts[n]) && state.verdicts[n].verdict === 'correct';
    const retryOnly = state.retryOnly && fullList.some(entry => isRight(entry.n)) && fullList.some(entry => !isRight(entry.n));
    const list = retryOnly ? fullList.filter(entry => !isRight(entry.n)) : fullList;
    const carry = { hidden: fullList.length - list.length, total: fullList.length };

    const panel = document.createElement('section');
    panel.className = 'my-6 rounded-xl border border-brand-600/40 bg-brand-600/5 p-5';
    // A stable hook. The class above is shared with the plain callout block, so a
    // gate keyed on it silently matches the wrong element.
    panel.dataset.exercisePanel = 'true';

    const head = document.createElement('div');
    head.className = 'flex flex-wrap items-center justify-between gap-3 mb-4';
    const title = document.createElement('h3');
    title.className = 'text-lg font-semibold text-brand-400';
    title.textContent = spec.title || `${spec.list.length} book exercises`;
    head.appendChild(title);

    const toggle = document.createElement('div');
    toggle.className = 'inline-flex rounded-lg border border-gray-600 overflow-hidden';
    [['write', 'Write answers'], ['choose', 'Multiple choice']].forEach(([mode, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        const active = state.mode === mode;
        button.className = `min-h-[44px] px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
            active ? 'bg-brand-600 text-white' : 'bg-transparent text-gray-300 hover:bg-gray-700 hover:text-white'}`;
        button.textContent = label;
        if (mode === 'choose' && !hasChoices) {
            button.disabled = true;
            button.className += ' opacity-40 cursor-not-allowed';
            button.title = 'This module has no multiple-choice options for its exercises yet.';
        }
        button.addEventListener('click', () => {
            if (button.disabled || state.mode === mode) return;
            const next = readExerciseState();
            next.mode = mode;
            writeExerciseState(next);
            renderTheoryBlock();
        });
        toggle.appendChild(button);
    });
    head.appendChild(toggle);
    panel.appendChild(head);

    const hint = document.createElement('p');
    hint.className = 'mb-5 text-sm text-gray-400 leading-relaxed';
    hint.textContent = state.mode === 'write'
        ? 'Answer in your own words — you are marked on the meaning, not on matching the book\'s wording. Answer all of them, then submit once.'
        : 'Pick an answer and it is marked straight away. Nothing is sent anywhere, so this works even with the AI quota spent.';
    panel.appendChild(hint);

    if (retryOnly) {
        const note = document.createElement('p');
        note.className = 'mb-4 text-sm font-semibold text-brand-400';
        note.textContent = `Retrying ${list.length} of ${carry.total} — ${carry.hidden} already correct and hidden. `
            + `${state.mode === 'write' ? 'Clear' : 'Start over'} brings them all back.`;
        panel.appendChild(note);
    }

    const status = document.createElement('p');
    status.className = 'mb-4 text-sm min-h-[1.25rem]';
    panel.appendChild(status);

    const rows = [];
    list.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'mb-6 border-t border-gray-700/60 pt-5 first:border-t-0 first:pt-0';
        row.dataset.exerciseRow = String(entry.n);
        const prompt = document.createElement('div');
        prompt.className = 'font-medium leading-relaxed [overflow-wrap:anywhere]';
        prompt.innerHTML = formatText(entry.prompt);
        row.appendChild(prompt);

        const slot = document.createElement('div');
        let field = null;
        const optionButtons = [];

        if (state.mode === 'write') {
            field = document.createElement('textarea');
            field.className = 'mt-3 w-full rounded-lg border border-gray-600 bg-gray-900/70 p-3 text-sm leading-relaxed text-white placeholder-gray-500 focus:border-brand-600 focus:outline-none';
            field.rows = 3;
            field.placeholder = 'Your answer…';
            field.maxLength = 1500;
            field.value = state.answers[entry.n] || '';
            field.addEventListener('input', () => {
                const next = readExerciseState();
                next.answers[entry.n] = field.value;
                writeExerciseState(next);
            });
            row.appendChild(field);
        } else {
            // The real quiz's option card, template and all (user, 19-09-26:
            // "import the animation and stuff from the actual quiz page so you
            // don't have to design new thing"). Reusing tmpl-quiz-option means the
            // exercises inherit its hit area, hover, letter badge and the
            // grid-template-rows explanation reveal -- and there is one card
            // design in this app instead of two that drift apart.
            const list = document.createElement('div');
            list.className = 'mt-4 space-y-3';
            entry.options.forEach((text, index) => {
                const clone = templates.quizOption.content.cloneNode(true);
                const card = clone.querySelector('.option-card');
                clone.querySelector('.option-letter').textContent = String.fromCharCode(65 + index);
                clone.querySelector('.option-text').innerHTML = formatText(text);
                card.type = 'button';
                // Selected state must be announced, not only coloured.
                card.setAttribute('aria-pressed', String(state.picks[entry.n] === index));
                // Answer on the click itself, exactly like the quiz: no separate
                // Check step (user, 19-09-26: "when I select it would show the
                // result with an animation right away like the quiz page").
                card.addEventListener('click', () => {
                    const next = readExerciseState();
                    if (next.verdicts[entry.n]) return;        // already answered; the quiz locks too
                    next.picks[entry.n] = index;
                    next.verdicts[entry.n] = { verdict: index === entry.correct ? 'correct' : 'incorrect', feedback: '' };
                    writeExerciseState(next);
                    revealExerciseRow(entry, optionButtons, index);
                    syncChooseProgress(rows, status, retry, carry);
                });
                optionButtons.push(card);
                list.appendChild(clone);
            });
            const answered = state.verdicts[entry.n];
            if (answered) revealExerciseRow(entry, optionButtons, state.picks[entry.n]);
            else optionButtons.forEach((card, index) => selectExerciseOption(card, state.picks[entry.n] === index));
            row.appendChild(list);
        }

        row.appendChild(slot);
        // Written answers keep their marked note; a chosen answer is already
        // restored as a revealed card above.
        const saved = state.verdicts[entry.n];
        if (saved && state.mode === 'write') slot.appendChild(exerciseVerdictNote(saved.verdict, saved.feedback));
        panel.appendChild(row);
        rows.push({ entry, field, slot, optionButtons });
    });

    const actions = document.createElement('div');
    actions.className = 'flex flex-wrap items-center gap-3 border-t border-gray-700/60 pt-5';

    // Written answers go to the model in ONE call, so they need a submit. Chosen
    // answers are marked the instant they are clicked, so there is nothing to
    // submit -- only a way back for the ones you got wrong.
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = EXERCISE_ACTION_PRIMARY;
    submit.textContent = 'Submit for marking';
    submit.addEventListener('click', () => submitWrittenExercises(spec, rows, submit, status, carry, retry));
    if (state.mode === 'write') actions.appendChild(submit);

    // Both modes. Write mode had no way back at all: the only other button wipes
    // every answer, so one wrong mark out of nineteen meant re-reading the lot.
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = `${EXERCISE_ACTION_PRIMARY} hidden-view`;
    retry.textContent = 'Retry the wrong ones';
    retry.addEventListener('click', () => {
        const next = readExerciseState();
        // Clears ONLY what was wrong, and hides what was right. A written answer is
        // KEPT so it can be edited rather than retyped -- improving a wrong answer is
        // the whole exercise; a chosen option must go, or the card stays locked.
        for (const [n, verdict] of Object.entries(next.verdicts)) {
            if (verdict && verdict.verdict !== 'correct') { delete next.verdicts[n]; delete next.picks[n]; }
        }
        next.retryOnly = true;
        writeExerciseState(next);
        renderTheoryBlock();
    });
    actions.appendChild(retry);

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = EXERCISE_ACTION_SECONDARY;
    clear.textContent = state.mode === 'write' ? 'Clear' : 'Start over';
    clear.addEventListener('click', () => {
        const next = readExerciseState();
        if (state.mode === 'write') next.answers = {}; else next.picks = {};
        next.verdicts = {};
        // Starting over means the whole list again, hidden ones included.
        next.retryOnly = false;
        writeExerciseState(next);
        renderTheoryBlock();
    });
    actions.appendChild(clear);
    panel.appendChild(actions);

    parent.appendChild(panel);
    if (state.mode === 'choose') syncChooseProgress(rows, status, retry, carry, { silent: true });
    else refreshWriteRetry(rows, retry);
}

// Write mode marks in one round trip, so there is no running tally to keep -- only
// the way back, which appears the moment the model marks something wrong.
function refreshWriteRetry(rows, retry) {
    const state = readExerciseState();
    const wrong = rows.filter(row => {
        const verdict = state.verdicts[row.entry.n];
        return Boolean(verdict) && verdict.verdict !== 'correct';
    }).length;
    retry.classList.toggle('hidden-view', wrong === 0);
}

// Runs after every chosen answer: the running tally, the retry button, and the
// completion write once every exercise has been answered correctly.
function syncChooseProgress(rows, status, retry, carry, { silent = false } = {}) {
    const state = readExerciseState();
    const marked = rows.filter(r => state.verdicts[r.entry.n]);
    const correct = marked.filter(r => state.verdicts[r.entry.n].verdict === 'correct').length;
    const wrong = marked.length - correct;
    retry.classList.toggle('hidden-view', wrong === 0);
    // Everything the reader is shown is against the FULL exercise list. On a retry
    // run `rows` is only what is left, so the hidden passes are added back here --
    // otherwise finishing a 3-of-20 retry would read "3 of 3" and tick the block.
    const tally = correct + carry.hidden;

    if (marked.length < rows.length) {
        status.className = 'mb-4 text-sm text-gray-400';
        status.textContent = `${marked.length} of ${rows.length} answered · ${tally} of ${carry.total} correct`;
        return;
    }
    if (silent && tally === carry.total) {
        // Restoring a finished set on reload: say so, but do not re-post it. The
        // completion was already recorded when the last answer was clicked.
        status.className = 'mb-4 text-sm text-green-400 font-semibold';
        status.textContent = `${tally} of ${carry.total} — all correct.`;
        return;
    }
    finishExercises(tally, carry.total, status, 'exercise-mcq');
}

function revealExerciseRow(entry, cards, picked) {
    cards.forEach((card, index) => revealExerciseOption(card, index, {
        isCorrect: index === entry.correct,
        isPicked: index === picked,
        explanation: (entry.explanations && entry.explanations[index]) || ''
    }));
}

async function submitWrittenExercises(spec, rows, submit, status, carry, retry) {
    if (exerciseBusy) return;
    const state = readExerciseState();
    const blank = rows.filter(r => !(state.answers[r.entry.n] || '').trim());
    if (blank.length === rows.length) {
        status.className = 'mb-4 text-sm text-amber-400';
        status.textContent = 'Write an answer first.';
        return;
    }
    const token = typeof generationToken === 'function' ? generationToken() : '';
    if (token === null) return;

    exerciseBusy = true;
    submit.disabled = true;
    submit.classList.add('opacity-60');
    status.className = 'mb-4 text-sm text-gray-400';
    status.textContent = blank.length
        ? `Marking ${rows.length} answers (${blank.length} left blank)…`
        : `Marking ${rows.length} answers…`;

    try {
        const send = () => fetch('api/exercise/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Quiz-Token': token || '' },
            body: JSON.stringify({
                module: activeBookFile,
                chapter: currentTheory.chapterIndex + 1,
                block: currentTheory.blockIndex + 1,
                answers: rows.map(r => ({
                    n: r.entry.n,
                    question: r.entry.prompt,
                    answer: state.answers[r.entry.n] || ''
                }))
            })
        });
        // Same spiky link as the tutor: one dropped connection used to end the
        // whole submit, losing nothing typed but reporting nothing either.
        let response;
        try {
            response = await send();
        } catch (first) {
            status.textContent = 'Connection dropped, retrying…';
            await new Promise(done => setTimeout(done, 1500));
            response = await send();
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);

        const byNumber = new Map((data.results || []).map(r => [r.n, r]));
        const fresh = readExerciseState();
        let correct = 0;
        rows.forEach(({ entry, slot }) => {
            const result = byNumber.get(entry.n) || { verdict: 'unmarked', feedback: '' };
            if (result.verdict === 'correct') correct += 1;
            fresh.verdicts[entry.n] = { verdict: result.verdict, feedback: result.feedback };
            slot.replaceChildren(exerciseVerdictNote(result.verdict, result.feedback));
        });
        writeExerciseState(fresh);
        refreshWriteRetry(rows, retry);
        // Against the full list, not just the ones this submit marked -- a retry
        // submit carries the passes it did not re-send.
        finishExercises(correct + carry.hidden, carry.total, status, 'exercise');
    } catch (error) {
        status.className = 'mb-4 text-sm text-red-400';
        status.textContent = `${error.message || 'Marking failed.'} Your answers are saved — try again, or switch to multiple choice.`;
    } finally {
        exerciseBusy = false;
        submit.disabled = false;
        submit.classList.remove('opacity-60');
    }
}

// One rule for both modes: everything right ticks the block, exactly like a
// perfect assessment. The server re-checks score === total, so the page cannot
// claim a block it did not pass.
function finishExercises(correct, total, status, source) {
    if (correct === total) {
        status.className = 'mb-4 text-sm text-green-400 font-semibold';
        status.textContent = `${correct} of ${total} — all correct.`;
        recordExerciseResult(correct, total, source, status);
        return;
    }
    status.className = 'mb-4 text-sm text-amber-400';
    status.textContent = source === 'exercise-mcq'
        ? `${correct} of ${total} correct. Retry the wrong ones — the block ticks at ${total} of ${total}.`
        : `${correct} of ${total} correct. Fix the ones marked below and submit again — the block ticks at ${total} of ${total}.`;
}

async function recordExerciseResult(correct, total, source, status) {
    const blockId = theoryBlockId(currentTheory.chapterIndex, currentTheory.blockIndex);
    const body = { module: moduleId, block: blockId, score: correct, total, source };
    const data = await postProgress(body);
    if (data === undefined) {
        queuePendingProgress(body);
        status.textContent += ' Could not save just now — it will be saved on the next page load.';
        return;
    }
    if (data && data.completed) progress = { completed: data.completed };
    if (data && data.marked) {
        const chapter = theoryChapters()[currentTheory.chapterIndex];
        const p = chapterProgress(currentTheory.chapterIndex);
        status.textContent += ` ✓ Block complete — ${(chapter && chapter.title) || 'this chapter'} is now ${p.percent}% (${p.done} of ${p.total}).`;
    }
    renderTheoryToc();
}

function selectTheory(selection) {
    currentTheory = clampTheory(selection);
    writeTheoryHash();
    renderTheoryToc();
    renderTheoryBlock();
    // The reading pane scrolls, not the window: without this, Next lands you
    // halfway down the next lesson.
    if (dom.tutorialArticle) dom.tutorialArticle.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Entry point kept under the original name so loadModuleData() is untouched.
function renderTutorial() {
    if (!tutorialData || !tutorialData.sections) return;
    currentTheory = clampTheory(theoryFromHash());
    renderTheoryToc();
    renderTheoryBlock();
}

function loadQuestion() {
    isAnswered = false;
    selectedAnswer = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const currentQ = activeQuizData[currentQuestionIndex];
    
    dom.questionNumberBadge.textContent = currentQuestionIndex + 1;
    dom.questionText.innerHTML = formatText(currentQ.question);
    // A question about a figure or equation shows it above the question.
    if (dom.questionAsset) {
        dom.questionAsset.replaceChildren();
        if (currentQ.asset && typeof currentQ.asset === 'object') {
            dom.questionAsset.appendChild(assetPanel(currentQ.asset, true));
        }
    }
    
    if (currentQuestionIndex === activeQuizData.length - 1) {
        dom.nextBtnText.textContent = "Finish Assessment";
    } else {
        dom.nextBtnText.textContent = "Next Question";
    }

    // The pinned bar carries the position, because the header that used to show it
    // scrolls out of view the moment the explanations expand.
    if (dom.nextHint) {
        dom.nextHint.textContent = carriedTotal
            ? `${currentQuestionIndex + 1} of ${activeQuizData.length} left to redo`
            : `Question ${currentQuestionIndex + 1} of ${activeQuizData.length}`;
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
        
        btn.addEventListener('click', () => handleAnswerSelect(index, btn));
        dom.optionsContainer.appendChild(optionClone);
    });
}

function handleAnswerSelect(selectedIndex, selectedBtn, replay = false) {
    if (isAnswered && !replay) return;
    isAnswered = true;
    selectedAnswer = selectedIndex;

    const currentQ = activeQuizData[currentQuestionIndex];
    const isCorrect = selectedIndex === currentQ.correct;

    // A replay redraws an answer given before the learner left the screen; it was scored then.
    if (!replay) {
        if (isCorrect) score++;
        // Recorded by POSITION, so it survives a reload the same way the questions
        // do, and so a retry run's own misses index into the narrowed set.
        else if (!wrongIndices.includes(currentQuestionIndex)) wrongIndices.push(currentQuestionIndex);
    }
    dom.scoreTracker.textContent = tallyScore();

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
    if (replay) return;
    saveQuizSession();
    // The scrollIntoView that used to run here is GONE. It existed only to chase a
    // button that had been pushed below the fold by the expanding explanations, and
    // it fought the reader: it yanked the page down mid-read to reveal a control
    // that is now already on screen. Pinning the bar removed the reason for it.
}

// Ask once for the learner token when the server enforces one. Returns null when
// the learner cancels, so the caller can stop without a request.
function generationToken() {
    if (!providerTokenRequired) return '';
    return window.prompt('Generation access token') || null;
}

async function startGeneratedQuiz(selection = []) {
    if (!tutorialData.title || !aiReady()) return;
    const token = generationToken();
    if (token === null) return;

    dom.contentSection.classList.add('hidden-view');
    dom.landingDashboard.classList.remove('hidden-view');
    dom.emptyState.classList.add('hidden-view');
    dom.welcomeScreen.classList.add('hidden-view');
    dom.servicesSection.classList.add('hidden-view');
    dom.loadingScreen.classList.remove('hidden-view');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavUI('generated-quiz');

    if (dom.loadingModel) dom.loadingModel.textContent = providerModel ? `Model: ${providerModel}` : '';
    if (dom.loadingScope) dom.loadingScope.textContent = generateScopeText(selection);

    const picked = selection.map(blockFromId).filter(Boolean);
    const oneBlock = picked.length === 1 ? picked[0] : null;
    const request = oneBlock
        ? { url: 'api/quiz', body: { module: activeBookFile, chapter: oneBlock.chapterIndex + 1, block: oneBlock.blockIndex + 1, count: aiQuestionCount } }
        : { url: 'api/quiz/fresh', body: { module: activeBookFile, count: generatedCountFor(picked.length),
                                           ...(picked.length ? { blocks: picked.map(b => [b.chapterIndex + 1, b.blockIndex + 1]) } : {}) } };
    try {
        const response = await fetch(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Quiz-Token': token },
            body: JSON.stringify(request.body)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        // One block owns a one-block quiz, so a perfect score completes it as in the reader.
        setAiQuiz(data.questions, oneBlock ? theoryBlockId(oneBlock.chapterIndex, oneBlock.blockIndex) : null);
        aiFromSetup = true;
        lastGenerateSelection = selection;
        quizOrigin = 'tab';
        startQuiz();
    } catch (error) {
        alert(`Could not generate a quiz: ${error.message}`);
        showLandingDashboard();
    }
}

// The server writes up to 5 questions per book section, so a small pick cannot fill a big quiz.
function generatedCountFor(blockCount) {
    const cap = Math.min(GENERATED_QUIZ_SIZE, MAX_FRESH_QUIZ_SIZE);
    return blockCount ? Math.max(5, Math.min(cap, blockCount * 5)) : cap;
}

function generateScopeText(selection) {
    const picked = selection.map(blockFromId).filter(Boolean);
    if (!picked.length) return 'AI is reading random book sections · up to a minute';
    if (picked.length > 1) return `AI is reading ${picked.length} blocks · up to a minute`;
    const item = theoryBlocks(picked[0].chapterIndex)[picked[0].blockIndex];
    return `AI is reading ${(item && item.term) || 'one block'} · under a minute`;
}

// --- Quiz setup ---------------------------------------------------------------
// PRACTICE and GENERATE QUIZ open this first. The learner ticks any mix of chapters
// and blocks, and unticks them again (user, 17-09-26: "I want to select multiple and
// deselect"). The selection is a set of block ids like "ch01-b06".
let setupMode = 'practice';
let aiFromSetup = false;
let lastGenerateSelection = [];
const setupSelected = new Set();
const CHECKBOX_CLASS = 'h-5 w-5 shrink-0 cursor-pointer rounded accent-brand-600';

function readSetupChoice(mode) {
    try { const saved = JSON.parse(localStorage.getItem(`eduQuizSetup.${moduleId}.${mode}`) || '[]'); return Array.isArray(saved) ? saved : []; }
    catch (error) { return []; }
}

function saveSetupChoice(mode, ids) {
    try { localStorage.setItem(`eduQuizSetup.${moduleId}.${mode}`, JSON.stringify(ids)); } catch (error) { /* per-viewer convenience only */ }
}

// Every block id in reading order, so a selection always runs in book order.
function allBlockIds() {
    return theoryChapters().flatMap((_chapter, ci) => theoryBlocks(ci).map((_block, bi) => theoryBlockId(ci, bi)));
}

function selectedBlockIds() {
    return allBlockIds().filter(id => setupSelected.has(id));
}

function chapterName(chapterIndex) {
    const chapter = theoryChapters()[chapterIndex];
    // Titles already read "Chapter 3: Classification"; numbering them again gave "3. Chapter 3: ...".
    return String((chapter && chapter.title) || '').replace(/^chapter\s+\d+\s*[:.\-–—]\s*/i, '') || `Chapter ${chapterIndex + 1}`;
}

function practiceQuestionsFor(ids) {
    const wanted = new Set(ids);
    return quizData.filter(q => q && q.source && wanted.has(q.source.block));
}

function renderSetupTree() {
    dom.setupTree.innerHTML = '';
    theoryChapters().forEach((_chapter, ci) => {
        const blocks = theoryBlocks(ci);
        const group = document.createElement('div');
        group.dataset.chapterGroup = String(ci);

        const head = document.createElement('div');
        // Sticky, so a long chapter's blocks never scroll away from the chapter they belong to.
        head.className = 'sticky top-0 z-10 flex items-center gap-1 pr-3 bg-gray-900';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.dataset.toggle = String(ci);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', `setup-blocks-${ci}`);
        toggle.setAttribute('aria-label', `Blocks of chapter ${ci + 1}`);
        toggle.className = 'min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600';
        toggle.innerHTML = '<svg class="w-4 h-4 transition-transform" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
        const label = document.createElement('label');
        label.className = 'flex flex-1 min-w-0 items-center gap-3 min-h-[44px] cursor-pointer';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = CHECKBOX_CLASS;
        box.dataset.chapter = String(ci);
        const name = document.createElement('span');
        name.className = 'truncate text-white';
        name.textContent = `${ci + 1}. ${chapterName(ci)}`;
        const tally = document.createElement('span');
        tally.className = 'ml-auto shrink-0 pl-2 text-xs text-gray-400 tabular-nums';
        tally.dataset.tally = String(ci);
        label.append(box, name, tally);
        head.append(toggle, label);

        const list = document.createElement('ul');
        list.id = `setup-blocks-${ci}`;
        list.className = 'hidden-view pb-2';
        blocks.forEach((item, bi) => {
            const row = document.createElement('li');
            const rowLabel = document.createElement('label');
            rowLabel.className = 'flex items-center gap-3 min-h-[44px] pl-14 pr-3 cursor-pointer hover:bg-gray-800/60';
            const blockBox = document.createElement('input');
            blockBox.type = 'checkbox';
            blockBox.className = CHECKBOX_CLASS;
            blockBox.dataset.block = theoryBlockId(ci, bi);
            const term = document.createElement('span');
            term.className = 'min-w-0 text-sm text-gray-300';
            term.textContent = `${bi + 1}. ${(item && item.term) || `Block ${bi + 1}`}`;
            rowLabel.append(blockBox, term);
            row.appendChild(rowLabel);
            list.appendChild(row);
        });
        group.append(head, list);
        dom.setupTree.appendChild(group);
    });
}

function setChapterOpen(chapterIndex, open) {
    const toggle = dom.setupTree.querySelector(`[data-toggle="${chapterIndex}"]`);
    const list = document.getElementById(`setup-blocks-${chapterIndex}`);
    if (!toggle || !list) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.firstElementChild.classList.toggle('rotate-90', open);
    list.classList.toggle('hidden-view', !open);
}

// Checkbox state is derived from the set, never the other way round.
function syncSetupTree() {
    theoryChapters().forEach((_chapter, ci) => {
        const ids = theoryBlocks(ci).map((_block, bi) => theoryBlockId(ci, bi));
        const picked = ids.filter(id => setupSelected.has(id)).length;
        const box = dom.setupTree.querySelector(`[data-chapter="${ci}"]`);
        if (box) {
            box.checked = picked > 0 && picked === ids.length;
            box.indeterminate = picked > 0 && picked < ids.length;
        }
        const tally = dom.setupTree.querySelector(`[data-tally="${ci}"]`);
        if (tally) tally.textContent = picked ? `${picked}/${ids.length}` : `${ids.length}`;
    });
    dom.setupTree.querySelectorAll('[data-block]').forEach(box => { box.checked = setupSelected.has(box.dataset.block); });
    renderSetupCount();
}

function renderSetupCount() {
    const ids = selectedBlockIds();
    const blocks = `${ids.length} block${ids.length === 1 ? '' : 's'}`;
    let text;
    let ready = ids.length > 0;
    if (!ids.length) {
        text = 'Nothing selected';
    } else if (setupMode === 'practice') {
        const count = practiceQuestionsFor(ids).length;
        text = `${blocks} · ${count} question${count === 1 ? '' : 's'}`;
        ready = count > 0;
    } else if (!aiReady()) {
        text = providerReady ? AI_ONLY_ON_LIBRARY_BOOKS : 'No model connected';
        ready = false;
    } else {
        const count = ids.length === 1 ? aiQuestionCount : generatedCountFor(ids.length);
        text = `${blocks} · ${count} AI questions`;
    }
    dom.setupCount.textContent = text;
    dom.setupStartBtn.disabled = !ready;
}

function openQuizSetup(mode) {
    if (!tutorialData.title) return;
    setupMode = mode;
    dom.setupTitle.textContent = mode === 'practice' ? 'Practice' : 'Generate quiz';

    renderSetupTree();
    const valid = new Set(allBlockIds());
    setupSelected.clear();
    readSetupChoice(mode).forEach(id => { if (valid.has(id)) setupSelected.add(id); });
    syncSetupTree();
    // Open the chapters that hold a selection, so a saved pick is visible, not hidden.
    theoryChapters().forEach((_chapter, ci) => {
        const any = theoryBlocks(ci).some((_block, bi) => setupSelected.has(theoryBlockId(ci, bi)));
        setChapterOpen(ci, any);
    });

    const saved = quizSessions[mode];
    dom.setupResumeBtn.classList.toggle('hidden-view', !saved);
    if (saved) {
        dom.setupResumeBtn.textContent = sessionFinished(saved)
            ? 'Back to results' : `Resume ${saved.currentQuestionIndex + 1}/${saved.questions.length}`;
    }

    // Nothing is hidden. The dialog opens over whatever is on screen -- a quiz in
    // progress included -- so Cancel is a real way back and "New" stopped being a
    // one-way door (user, 21-09-26). The nav underline moves at Start, not here,
    // because opening the picker is not yet navigating anywhere.
    dom.quizSetupScreen.classList.remove('hidden-view');
    document.body.classList.add('overflow-hidden');
    if (dom.setupStartBtn) dom.setupStartBtn.focus();
}

function closeQuizSetup() {
    if (!dom.quizSetupScreen) return;
    dom.quizSetupScreen.classList.add('hidden-view');
    document.body.classList.remove('overflow-hidden');
}

dom.setupTree.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.block) {
        if (target.checked) setupSelected.add(target.dataset.block); else setupSelected.delete(target.dataset.block);
    } else if (target.dataset.chapter) {
        const ci = Number(target.dataset.chapter);
        theoryBlocks(ci).forEach((_block, bi) => {
            const id = theoryBlockId(ci, bi);
            if (target.checked) setupSelected.add(id); else setupSelected.delete(id);
        });
    }
    syncSetupTree();
});
dom.setupTree.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle]');
    if (!toggle) return;
    setChapterOpen(Number(toggle.dataset.toggle), toggle.getAttribute('aria-expanded') !== 'true');
});
dom.setupAllBtn.addEventListener('click', () => { allBlockIds().forEach(id => setupSelected.add(id)); syncSetupTree(); });
dom.setupNoneBtn.addEventListener('click', () => { setupSelected.clear(); syncSetupTree(); });
dom.setupCancelBtn.addEventListener('click', closeQuizSetup);
dom.setupBackdrop.addEventListener('click', closeQuizSetup);
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !dom.quizSetupScreen.classList.contains('hidden-view')) closeQuizSetup();
});
dom.setupResumeBtn.addEventListener('click', () => resumeQuizSession(setupMode));
dom.setupStartBtn.addEventListener('click', () => {
    const ids = selectedBlockIds();
    if (!ids.length) return;
    saveSetupChoice(setupMode, ids);
    if (setupMode === 'generate') {
        // Everything ticked is the same as no restriction: draw from the whole book.
        startGeneratedQuiz(ids.length === allBlockIds().length ? [] : ids);
        return;
    }
    const questions = practiceQuestionsFor(ids);
    const every = allBlockIds();
    if (ids.length === every.length) {
        setModuleQuiz();
    } else if (ids.length === 1) {
        const only = blockFromId(ids[0]);
        setBlockQuiz(questions, only.chapterIndex, only.blockIndex);
    } else {
        const chapters = [...new Set(ids.map(id => blockFromId(id).chapterIndex))];
        const wholeChapter = chapters.length === 1 && ids.length === theoryBlocks(chapters[0]).length;
        setSelectionQuiz(questions, wholeChapter
            ? (theoryChapters()[chapters[0]].title || `Chapter ${chapters[0] + 1}`)
            : `${ids.length} blocks from ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}`);
    }
    quizOrigin = 'tab';
    startQuiz();
});

// Opens the book this viewer last chose, or the default book.
async function loadBundledModule() {
    setAppState(false);
    if (dom.importBookLink) dom.importBookLink.href = `${location.protocol}//${location.hostname}:8769/`;
    let saved = null;
    try { saved = localStorage.getItem('eduActiveBook'); } catch (error) { /* storage blocked */ }
    for (const file of [...new Set([saved, DEFAULT_BOOK].filter(Boolean))]) {
        try {
            const { url, base } = bookUrlFor(file);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Book request failed with status ${response.status}.`);
            assetBase = base;
            loadModuleData(await response.json(), 'Book', file);
            break;
        } catch (error) {
            console.error(`Failed to open ${file}:`, error);
        }
    }
    await loadLibrary();
    if (!tutorialData.title) setAppState(false);
}

document.addEventListener('DOMContentLoaded', loadBundledModule);


// --- AI quiz for the block on screen ----------------------------------------
// The key lives only in the server's environment; the browser sends the block
// coordinates and an access token, never a provider credential.
function setAiBlockStatus(message) {
    if (dom.aiBlockStatus) dom.aiBlockStatus.textContent = message || '';
}

// ⚠ aiReady() needs BOTH a provider and an open book. This used to be evaluated
// once, inside refreshProviderStatus() on DOMContentLoaded -- before the book had
// loaded -- and never again, so the button sat disabled for the whole session with
// a healthy provider behind it (user, 21-09-26: "the AI quiz button is currently
// greyed out"). It is recomputed from whatever is true NOW, at every point either
// half can change.
function syncAiQuizButton() {
    if (!dom.blockAiQuizBtn) return;
    const ready = aiReady();
    dom.blockAiQuizBtn.disabled = !ready;
    dom.blockAiQuizBtn.title = providerStatusUnknown
        ? 'Provider status unavailable; the book quizzes still work'
        : ready
            ? `Generate questions with ${providerModel || 'the connected model'}`
            : (providerReady ? AI_ONLY_ON_LIBRARY_BOOKS : 'Unavailable until an operator configures a provider on the server');
}

async function refreshProviderStatus() {
    try {
        const response = await fetch('api/provider', { cache: 'no-store' });
        const data = await response.json();
        providerReady = Boolean(data.ready);
        providerTokenRequired = Boolean(data.token_required);
        providerModel = data.model || '';
        providerStatusUnknown = false;
    } catch (error) {
        providerReady = false;
        providerStatusUnknown = true;
    }
    syncAiQuizButton();
    if (tutorialData.title) renderHome();
}

async function startBlockAiQuiz() {
    if (!aiReady()) return;
    const token = generationToken();
    if (token === null) return;
    setAiBlockStatus('Generating questions from this block...');
    dom.blockAiQuizBtn.disabled = true;
    try {
        const response = await fetch('api/quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Quiz-Token': token },
            body: JSON.stringify({
                module: activeBookFile,
                chapter: currentTheory.chapterIndex + 1,
                block: currentTheory.blockIndex + 1,
                count: aiQuestionCount
            })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        // An AI quiz launched from the reader assesses THIS block, so a perfect
        // score on it completes the block exactly as a written one does.
        setAiQuiz(data.questions, theoryBlockId(currentTheory.chapterIndex, currentTheory.blockIndex));
        aiFromSetup = false;
        quizOrigin = 'reader';
        setAiBlockStatus('');
        startQuiz();
    } catch (error) {
        setAiBlockStatus(error.message);
    } finally {
        syncAiQuizButton();
    }
}

document.addEventListener('DOMContentLoaded', refreshProviderStatus);


// --- Settings ---------------------------------------------------------------
// The admin token lives in sessionStorage only: it dies with the tab and is
// never written to disk. The provider API key is never sent to the browser at
// all -- the server reports only whether one is set.
function adminToken() {
    try { return sessionStorage.getItem('eduAdminToken') || ''; } catch (error) { return ''; }
}

function rememberAdminToken(token) {
    try { sessionStorage.setItem('eduAdminToken', token); } catch (error) { /* private mode */ }
}

function fillSettingsForm(data) {
    dom.setApiUrl.value = data.api_url || '';
    dom.setModel.value = data.model || '';
    dom.setJsonMode.checked = data.json_mode !== false;
    dom.setApiKey.value = '';
    dom.setAccessToken.value = '';
    dom.apiKeyState.textContent = data.api_key_set
        ? 'A key is stored on the server. Leave blank to keep it; type a new one to replace it.'
        : 'No key stored yet. Quiz generation stays off until one is saved.';
    dom.accessTokenState.textContent = data.access_token_set
        ? 'A token is stored. Leave blank to keep it.'
        : 'No token stored.';
    dom.setRequireToken.checked = Boolean(data.general.require_access_token);
    dom.setAiCount.value = data.general.ai_question_count;
    dom.setFreshSize.value = data.general.fresh_quiz_size;
    dom.settingsForm.classList.remove('hidden-view');
    dom.settingsLockCard.classList.toggle('hidden-view', !data.admin_required);
    dom.settingsLockStatus.textContent = data.ready
        ? `Connected to ${data.model}. AI quiz generation is on.`
        : 'Not connected yet. Fill in the endpoint, key and model below, then Save.';
}

async function loadSettings() {
    try {
        const response = await fetch('api/settings', { headers: { 'X-Edu-Admin-Token': adminToken() }, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        fillSettingsForm(data);
    } catch (error) {
        dom.settingsForm.classList.add('hidden-view');
        dom.settingsLockCard.classList.remove('hidden-view');
        dom.settingsLockStatus.textContent = error.message;
    }
}

async function saveSettings() {
    const payload = {
        api_url: dom.setApiUrl.value.trim(),
        model: dom.setModel.value.trim(),
        json_mode: dom.setJsonMode.checked,
        require_access_token: dom.setRequireToken.checked,
        ai_question_count: Number(dom.setAiCount.value),
        fresh_quiz_size: Number(dom.setFreshSize.value),
    };
    // Only send secrets the operator actually typed, so saving an unrelated
    // preference cannot silently blank a stored credential.
    if (dom.setApiKey.value.trim()) payload.api_key = dom.setApiKey.value.trim();
    if (dom.setAccessToken.value.trim()) payload.access_token = dom.setAccessToken.value.trim();

    dom.settingsSaveBtn.disabled = true;
    dom.settingsStatus.textContent = 'Saving...';
    try {
        const response = await fetch('api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Admin-Token': adminToken() },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        fillSettingsForm(data);
        dom.settingsStatus.textContent = data.ready
            ? 'Saved. Quiz generation is live now, no restart needed.'
            : 'Saved, but the provider is still incomplete (endpoint, key and model are all required).';
        await Promise.all([refreshProviderStatus(), loadGeneralSettings()]);
    } catch (error) {
        dom.settingsStatus.textContent = error.message;
    } finally {
        dom.settingsSaveBtn.disabled = false;
    }
}

async function loadGeneralSettings() {
    try {
        const response = await fetch('api/general', { cache: 'no-store' });
        const data = await response.json();
        if (Number(data.fresh_quiz_size) > 0) GENERATED_QUIZ_SIZE = Number(data.fresh_quiz_size);
        if (Number(data.ai_question_count) > 0) aiQuestionCount = Number(data.ai_question_count);
    } catch (error) { /* defaults already set */ }
}

dom.menuBtn.addEventListener('click', () => setMenuOpen(!menuOpen));
dom.navLearn.addEventListener('click', () => { showTutorial(); if (!isWideMenu()) setMenuOpen(false); });
dom.navSettings.addEventListener('click', () => { showSettings(); if (!isWideMenu()) setMenuOpen(false); });
[dom.navTutorial, dom.navQuiz, dom.navGeneratedQuiz].forEach(el =>
    el.addEventListener('click', () => { if (!isWideMenu()) setMenuOpen(false); }));
window.matchMedia(MENU_WIDE).addEventListener('change', syncMenuToViewport);
dom.settingsUnlockBtn.addEventListener('click', () => {
    const token = dom.adminToken.value.trim();
    if (!token) { dom.settingsLockStatus.textContent = 'Enter the admin token first.'; return; }
    rememberAdminToken(token);
    dom.adminToken.value = '';
    loadSettings();
});
dom.settingsSaveBtn.addEventListener('click', saveSettings);
document.addEventListener('DOMContentLoaded', syncMenuToViewport);
document.addEventListener('DOMContentLoaded', loadGeneralSettings);

// --- Ask about this lesson ---------------------------------------------------
// The learner studies here instead of beside the paper book, so "I don't get
// this" has to be answerable without leaving the page. The server grounds the
// reply in the open lesson first, then the book, then the model's own knowledge,
// and labels which of those it used -- a quoted fact and a recalled one must not
// look the same to someone who cannot yet tell them apart.
const askDom = {
    fab: document.getElementById('ask-fab'),
    panel: document.getElementById('ask-panel'),
    close: document.getElementById('ask-close'),
    log: document.getElementById('ask-log'),
    form: document.getElementById('ask-form'),
    input: document.getElementById('ask-input'),
    send: document.getElementById('ask-send'),
    context: document.getElementById('ask-context'),
    fresh: document.getElementById('ask-new')
};
const askHistory = [];          // {role, content} -- what the model is sent as context
let askKey = '';
let askBusy = false;

// The conversation survives closing the panel AND reloading the page, and is
// thrown away only when the reader presses New. It lives in localStorage
// because it is a per-viewer convenience: it never needs to reach the server,
// another device, or another reader.
let progressSaveFailed = false;   // set when a completion could not reach the server

const ASK_STORE_KEY = 'eduAskConversation';
const ASK_MAX_TURNS = 40;       // enough to scroll back through; bounded so storage cannot grow forever
const askTurns = [];            // {role, text, html, source, page} -- what is on screen, and what is saved

const ASK_BADGE = {
    lesson: ['This lesson', 'bg-green-500/15 text-green-300 border-green-500/30'],
    book: ['From the book', 'bg-blue-500/15 text-blue-300 border-blue-500/30'],
    general: ['Outside the book', 'bg-amber-500/15 text-amber-300 border-amber-500/30']
};

function askLessonLabel() {
    const chapters = typeof theoryChapters === 'function' ? theoryChapters() : [];
    const chapter = chapters[currentTheory.chapterIndex];
    if (!chapter) return '';
    const block = (theoryBlocks(currentTheory.chapterIndex) || [])[currentTheory.blockIndex];
    const term = block && (block.term || '');
    return [chapter.title, term].filter(Boolean).join(' · ');
}

function askSyncLesson() {
    const key = `${currentTheory.chapterIndex}:${currentTheory.blockIndex}`;
    if (key === askKey) return;
    askKey = key;
    // Moving to another lesson only re-labels the header. It does NOT clear the
    // conversation any more -- that happens on New and nowhere else. Each answer
    // is still grounded in whichever lesson was open when it was asked.
    if (askDom.context) askDom.context.textContent = askLessonLabel();
}

function askSave() {
    try {
        localStorage.setItem(ASK_STORE_KEY, JSON.stringify({ turns: askTurns.slice(-ASK_MAX_TURNS) }));
    } catch (error) {
        // Private window, blocked or full storage. The panel still works for this
        // session; the conversation simply will not survive a reload.
    }
}

function askRecord(turn) {
    askTurns.push(turn);
    if (askTurns.length > ASK_MAX_TURNS) askTurns.splice(0, askTurns.length - ASK_MAX_TURNS);
    askSave();
}

// Re-draws a saved conversation on load, and rebuilds the model's context with it
// so a follow-up question after a reload still knows what was already discussed.
function askRestore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ASK_STORE_KEY) || 'null'); } catch (error) { saved = null; }
    const turns = (saved && Array.isArray(saved.turns)) ? saved.turns : [];
    if (!turns.length || !askDom.log) return;
    askDom.log.innerHTML = '';
    for (const turn of turns) {
        if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
        askTurns.push(turn);
        const badge = turn.source ? { source: turn.source, page: turn.page } : null;
        askBubble(turn.role, turn.html || turn.text || '', badge, Boolean(turn.html));
        askHistory.push({ role: turn.role, content: String(turn.text || '') });
    }
}

function askNewConversation() {
    askTurns.length = 0;
    askHistory.length = 0;
    if (askDom.log) askDom.log.innerHTML = '';
    try { localStorage.removeItem(ASK_STORE_KEY); } catch (error) { /* nothing to clear */ }
    if (askDom.input) { askDom.input.value = ''; askDom.input.focus(); }
}

function askBubble(role, text, badge, asHtml) {
    const wrap = document.createElement('div');
    wrap.className = role === 'user' ? 'flex justify-end' : '';
    const bubble = document.createElement('div');
    bubble.className = role === 'user'
        ? 'max-w-[85%] rounded-xl bg-brand-600 text-white px-3 py-2'
        : 'rounded-xl bg-gray-900/60 border border-gray-700 px-3 py-2 text-gray-200';
    if (badge) {
        const [label, classes] = ASK_BADGE[badge.source] || ASK_BADGE.general;
        const tag = document.createElement('span');
        tag.className = `inline-block mb-2 rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${classes}`;
        tag.textContent = badge.page ? `${label} · p.${badge.page}` : label;
        bubble.appendChild(tag);
    }
    const body = document.createElement('div');
    // textContent by default: the question is learner input and must never be
    // parsed as markup. innerHTML only for trusted, model-rendered markdown.
    if (asHtml) body.innerHTML = text; else body.textContent = text;
    bubble.appendChild(body);
    wrap.appendChild(bubble);
    askDom.log.appendChild(wrap);
    askDom.log.scrollTop = askDom.log.scrollHeight;
    return bubble;
}

function askSetOpen(open) {
    if (!askDom.panel) return;
    askDom.panel.classList.toggle('hidden-view', !open);
    askDom.fab.setAttribute('aria-expanded', String(open));
    if (open) { askSyncLesson(); askDom.input.focus(); }
}

async function askSubmit(event) {
    event.preventDefault();
    if (askBusy) return;
    const question = (askDom.input.value || '').trim();
    if (!question) return;
    const token = typeof generationToken === 'function' ? generationToken() : '';
    if (token === null) return;
    askBusy = true;
    askDom.send.disabled = true;
    askDom.input.value = '';
    askBubble('user', question);
    askRecord({ role: 'user', text: question });
    const pending = askBubble('assistant', 'Reading the lesson…');
    pending.firstChild.className = 'text-gray-500';
    try {
        const send = () => fetch('api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Edu-Quiz-Token': token || '' },
            body: JSON.stringify({
                module: activeBookFile,
                chapter: currentTheory.chapterIndex + 1,
                block: currentTheory.blockIndex + 1,
                question,
                history: askHistory.slice(-6)
            })
        });
        // The link to this box spikes (measured: 2 ms normally, 768 ms peaks). A
        // single dropped connection used to end the question outright, so try once
        // more before reporting a failure.
        let response;
        try {
            response = await send();
        } catch (first) {
            pending.firstChild.textContent = 'Connection dropped, retrying…';
            await new Promise(done => setTimeout(done, 1500));
            response = await send();
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
        pending.innerHTML = '';
        const [label, classes] = ASK_BADGE[data.source] || ASK_BADGE.general;
        const tag = document.createElement('span');
        tag.className = `inline-block mb-2 rounded border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${classes}`;
        tag.textContent = data.page ? `${label} · p.${data.page}` : label;
        const body = document.createElement('div');
        if (typeof formatText === 'function') body.innerHTML = formatText(data.answer);
        else body.textContent = data.answer;
        pending.append(tag, body);
        askHistory.push({ role: 'user', content: question }, { role: 'assistant', content: data.answer });
        askRecord({ role: 'assistant', text: data.answer, html: body.innerHTML, source: data.source, page: data.page });
    } catch (error) {
        pending.innerHTML = '';
        const failed = document.createElement('span');
        failed.className = 'text-red-300';
        failed.textContent = `Could not reach the tutor — ${error.name || 'Error'}: ${error.message || 'unknown'}`
                           + ` (online=${navigator.onLine}, from ${location.origin})`;
        pending.appendChild(failed);
    } finally {
        askBusy = false;
        askDom.send.disabled = false;
        askDom.log.scrollTop = askDom.log.scrollHeight;
    }
}

function askInit() {
    if (!askDom.fab || !askDom.panel) return;
    askDom.fab.addEventListener('click', () => askSetOpen(askDom.panel.classList.contains('hidden-view')));
    askDom.close.addEventListener('click', () => askSetOpen(false));
    if (askDom.fresh) askDom.fresh.addEventListener('click', askNewConversation);
    askDom.form.addEventListener('submit', askSubmit);
    askDom.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askDom.form.requestSubmit(); }
    });
    askDom.input.addEventListener('input', () => {
        askDom.input.style.height = 'auto';
        askDom.input.style.height = `${Math.min(askDom.input.scrollHeight, 128)}px`;
    });
    // Track the tutorial screen by observing it, rather than patching the five
    // places that show or hide it -- one of those would eventually be missed.
    const screen = document.getElementById('tutorial-screen');
    if (screen) {
        const sync = () => {
            const reading = !screen.classList.contains('hidden-view');
            askDom.fab.classList.toggle('hidden-view', !reading);
            if (!reading) askSetOpen(false); else askSyncLesson();
        };
        new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ['class'] });
        sync();
    }
    // After sync(), because askSyncLesson() sets the header label and must not
    // run between restoring the log and the reader seeing it.
    askRestore();
}

document.addEventListener('DOMContentLoaded', askInit);
document.addEventListener('DOMContentLoaded', () => { flushPendingProgress(); });
