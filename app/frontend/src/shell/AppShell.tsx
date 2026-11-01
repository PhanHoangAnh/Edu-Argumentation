// Seam 9 (shell), part 3 — THE COMPOSITION ROOT AND THE SCREEN SWITCH.
//
// ⚑ SLICE A2 MOUNTED IT. `App.tsx` is now <AppProviders><AppShell/></AppProviders>; the
// Phase-02 health page is gone. Nothing is deployed by this slice, so :8792 keeps serving
// the previous bundle until someone runs deploy/deploy-study.sh — at which point the
// health PAGE disappears while GET /api/health, which the R- gates actually use, does not.
//
// PORTED FROM (by symbol, app.js): setAppState, showLandingDashboard, showTutorial,
// showQuizScreen, showResults' screen-switching preamble, showSettings, setReaderMode,
// showResultsViewOnly.
//
// ⛔ ALL SEVEN SCREENS ARE MOUNTED AT ONCE and hidden with `.hidden-view` — see
//    shell/Screen.tsx for why this is a hard rule and not a preference.
//    The seven: loading · welcome · tutorial · settings · quiz · result · quiz-setup.
//
// ⛔ `body.reader-mode` is load-bearing (B3): it drives the 100dvh / min-h-0 chain that
//    makes the reading pane — not the window — the scroll container. Toggling it from a
//    component is a side effect on <body>, so it belongs in ONE effect here, not
//    scattered across the screens that want it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModules } from '../data/queries';
import { AccountScreen } from '../account/AccountScreen';
import { useBookContext } from '../state/BookProvider';
import {
  bookPath,
  cursorForRoute,
  fileForSlug,
  legacyHashCursor,
  lessonPath,
  parseRoute,
  sameRoute,
  unitWordFor,
} from '../routing/paths';
import type { Route } from '../routing/paths';
import type { TheoryCursor } from '../data/types';
import { BookProvider } from '../state/BookProvider';
import { LibraryProvider } from '../state/LibraryProvider';
import { ProgressProvider } from '../state/ProgressProvider';
import { QuizProvider, useQuiz } from '../state/QuizProvider';
import { ReaderCursorProvider, useReaderCursor } from '../state/ReaderCursorProvider';
import { Header, isWideMenu } from './Header';
import { Screen } from './Screen';
import { LoadingPanel } from './LoadingPanel';
import { ADDON_LIST, addonById, isAddonId } from './screens.meta';
import type { AddonId } from './screens.meta';
import type { ComponentType } from 'react';
import { ADDON_SCREENS, ADDON_SCREEN_CLASS } from './screens';
import { HomeKpis, LibrarySection, WelcomeCard } from '../library/LibraryScreen';
import { ReaderScreen } from '../reader/ReaderScreen';
import { QuizScreen } from '../quiz/QuizScreen';
import { ResultScreen } from '../quiz/ResultScreen';
import { QuizSetupScreen } from '../quiz/QuizSetupScreen';
import { ReviewReminder } from '../quiz/ReviewReminder';
import { SettingsScreen } from '../settings/SettingsScreen';
import { AskPanel } from '../ask/AskPanel';
import { useStudyActions } from './useStudyActions';
import type { SetupMode } from '../quiz/QuizSetupScreen';

export type NavTab = 'home' | 'learn' | 'quiz' | 'generated' | 'settings' | 'account' | AddonId;

export type ScreenName =
  | 'loading'
  | 'welcome'
  | 'tutorial'
  | 'settings'
  | 'quiz'
  | 'result'
  | 'quiz-setup'
  | 'account'
  | AddonId;

export function AppShell() {
  const { enterReader, select, cursor, ready } = useReaderCursor();
  const { state } = useQuiz();
  const { activeBookFile, openBook, data, chapters, blocksOf } = useBookContext();
  /*
    ⚑ PHASE 06a — THE ADDRESS BAR (ruling R25). The first screen comes from the PATH, not a fixed
      'welcome': /<book>/<unit>-<n>/<m>-<slug> opens the reader on that lesson, /account and
      /settings open their pages, and an old `#chapter=&block=` link opens the reader too (the
      writer below then rewrites it to the path). routing/paths.ts has the grammar.
  */
  const [initialRoute] = useState<Route>(() => parseRoute());
  const [screen, setScreen] = useState<ScreenName>(() => {
    if (initialRoute.kind === 'addon') return initialRoute.id;
    if (initialRoute.kind === 'lesson') return 'tutorial';
    if (initialRoute.kind === 'account') return 'account';
    if (initialRoute.kind === 'settings') return 'settings';
    if (initialRoute.kind === 'library' && legacyHashCursor()) return 'tutorial';
    // 22-10-26: a practice run restored from the last page load (QuizProvider) opens where it stopped.
    const resumed = state.active.length > 0 && state.currentQuestionIndex < state.active.length && state.scope !== 'exam';
    return resumed && (initialRoute.kind === 'library' || initialRoute.kind === 'book') ? 'quiz' : 'welcome';
  });
  /** Home is `/` (the library) unless the reader arrived at, or stays on, one book's `/<book>/`. */
  const [homeIsBook, setHomeIsBook] = useState(initialRoute.kind === 'book');
  /** `/quiz` on a lesson path: start that lesson's assessment once the book and cursor are ready. */
  const pendingQuiz = useRef(initialRoute.kind === 'lesson' && initialRoute.quiz);
  /** The FIRST address-bar write of a page load is a canonicalisation, never a new history entry. */
  const firstWrite = useRef(true);
  const modules = useModules();
  const knownFiles = useMemo(() => (modules.data ?? []).map((b) => b.file), [modules.data]);
  // A slug outside the fixed map can only be resolved once /api/modules answers.
  const [slugResolved, setSlugResolved] = useState(
    () => !(initialRoute.kind === 'book' || initialRoute.kind === 'lesson') || Boolean(fileForSlug(initialRoute.slug)),
  );
  /*
    ⛔⛔ D-8 — THE NAV TRAP. `#quiz-setup-screen` is `fixed inset-0 z-[60]` (the legacy's own
        class string, index.html:534) and the header is `z-50`, so while the picker is open it
        covers the nav — in the legacy TOO. That is correct modal behaviour and is NOT the
        defect. The defect was that there was then NO WORKING WAY OUT:
          · `#setup-backdrop` carried no class, so it had a ZERO-SIZED box and clicking
            outside the dialog hit nothing (the legacy gives it `fixed inset-0 bg-black/70`);
          · `#setup-cancel-btn` carried no class either, so it rendered as the bare word
            "Cancel" run together with "Select allSelect noneResumeStart";
          · and Cancel sent the app to 'tutorial' UNCONDITIONALLY, so opening PRACTICE from
            HOME and cancelling dumped the learner in the READER, not back where they were.
        MEASURED before this fix on the deployed :8792: clicks on GENERATE QUIZ, SETTINGS and
        HOME all timed out with the picker open, and nothing dismissed it.
    ⚑ `returnTo` is the legacy's `closeQuizSetup` behaviour — the picker "opens OVER whatever
      was underneath" and closing returns you there (this file's own A2 comment declared that
      as an UNVERIFIED deviation; it is now closed). Escape closes it too, which is the
      keyboard obligation for any `aria-modal` dialog.
  */
  const [returnTo, setReturnTo] = useState<ScreenName>('welcome');
  // setupMode (app.js:3091) — PRACTICE and GENERATE QUIZ open the same picker in two modes.
  const [setupMode, setSetupMode] = useState<SetupMode>('practice');
  const openQuizSetup = (mode?: SetupMode) => {
    if (mode) setSetupMode(mode);
    setScreen((current) => {
      if (current !== 'quiz-setup') setReturnTo(current);
      return 'quiz-setup';
    });
  };
  const closeQuizSetup = () => setScreen(returnTo);
  const [activeTab, setActiveTab] = useState<NavTab>(() =>
    isAddonId(screen) ? screen : screen === 'quiz' ? (state.scope === 'ai' ? 'generated' : 'quiz') : screen === 'tutorial' ? 'learn' : screen === 'account' ? 'account' : screen === 'settings' ? 'settings' : 'home',
  );
  const [menuOpen, setMenuOpen] = useState(false);

  /*
    ⛔⛔ D-10 — THE SCREEN SWITCH showResults() DID AND THIS SHELL DID NOT.

    showResults (app.js:694) opens with EXACTLY this: hide the landing container, show the
    content container, leave reader-mode, hide tutorial/settings/quiz, close the picker,
    show #result-screen. Every one of those follows from `setScreen('result')` here — the
    two containers and the five screens are all derived from this one value — so the port
    of that preamble IS this callback. Before it existed, `#result-screen` rendered its
    content correctly and stayed `display:none` forever, and the run walked off the end of
    the question list instead of finishing.

    ⛔ IT LIVES HERE, NOT IN QuizScreen. A screen does not show its siblings — that rule is
       why showResults had to be split four ways in the first place (see quiz/ResultScreen's
       header). QuizScreen detects the finish; the shell performs the switch.
    ⛔ useCallback IS LOAD-BEARING, NOT A MICRO-OPTIMISATION. QuizScreen's finish effect
       lists `onFinish` in its dependency array; an inline arrow is a NEW function every
       render, so the effect would re-run on every render for as long as the finish
       condition held. Same rule, and the same reason, as `onSyncMenu={setMenuOpen}` below.
  */
  /*
    ⚑ PHASE 04 — THE GENUINE FINISH RECORDS. recordQuizResult() runs here and ONLY here
      (app.js:1313: "The one genuine finish. showResults() is also reached by re-opening an old
      result, which must not re-record anything."). It reads the quiz through a ref, so this
      callback keeps a stable identity — see shell/useStudyActions.ts.
  */
  const recordRef = useRef<() => Promise<void>>(async () => {});
  const finishQuiz = useCallback(() => {
    void recordRef.current();
    setScreen('result');
  }, []);

  /* startQuiz() -> showQuizScreen() (app.js:683/643). Restart and retry-wrong both end there,
     so the result screen's two replay buttons need it. Stable identity for the same reason
     finishQuiz has one. */
  const resumeQuiz = useCallback(() => setScreen('quiz'), []);

  /*
    returnToReader(selection) — app.js:856-867. Select the block FIRST, then show the
    reader. `null` means "wherever the cursor already is", which is what #result-back-btn
    passes when the run cannot be attributed to a single block.
    ⚠ The legacy's extra `tutorialArticle.scrollTop = 0` line is NOT re-implemented here:
      B7 already owns the reset as a visibility-keyed useLayoutEffect in ReaderScreen
      (Decision 6), which is the same fix done once for all five entrances instead of at
      this call site. The legacy's own comment at that line is about ordering against
      `hidden-view`, a problem the visibility key does not have.
  */
  const backToReader = useCallback(
    (selection: TheoryCursor | null) => {
      if (selection) select(selection);
      setActiveTab('learn');
      setScreen('tutorial');
    },
    [select],
  );

  // ⚑ PHASE 04 — the write-side actions. Each ends in a screen switch this shell owns.
  const showQuizFor = useCallback((scope: 'ai' | 'other') => {
    // showQuizScreen -> updateNavUI(navTabForScope()) (app.js:643).
    setActiveTab(scope === 'ai' ? 'generated' : 'quiz');
    setScreen('quiz');
  }, []);
  const showLoading = useCallback(() => {
    setActiveTab('generated');
    setScreen('loading');
  }, []);
  const showHome = useCallback(() => {
    setActiveTab('home');
    setScreen('welcome');
  }, []);
  const actions = useStudyActions({
    showQuiz: showQuizFor,
    showLoading,
    showHome,
    showReaderAt: backToReader,
  });
  recordRef.current = actions.recordQuizResult;

  // ⚑ PHASE 06a — the words in a lesson URL: the book's own unit word and the lesson title.
  const names = useMemo(
    () => ({
      unitWord: unitWordFor(chapters[0]?.title),
      lessonTitle: (at: TheoryCursor) => String(blocksOf(at.chapterIndex)[at.blockIndex]?.term || ''),
    }),
    [chapters, blocksOf],
  );

  // An unmapped book slug: resolve it against the library once it is listed; unknown -> home.
  useEffect(() => {
    if (slugResolved || !modules.data) return;
    if (initialRoute.kind === 'book' || initialRoute.kind === 'lesson') {
      const file = fileForSlug(initialRoute.slug, knownFiles);
      if (file) {
        if (file !== activeBookFile) openBook(file);
      } else {
        pendingQuiz.current = false;
        setHomeIsBook(false);
        setActiveTab('home');
        setScreen('welcome');
      }
    }
    setSlugResolved(true);
  }, [slugResolved, modules.data, knownFiles, initialRoute, activeBookFile, openBook]);

  /*
    THE ADDRESS-BAR WRITER. The path is a function of (screen, book, cursor, quiz scope):
      reader -> the lesson path · a written-question assessment -> its lesson path + /quiz ·
      home -> / or /<book>/ · account / settings -> their paths · everything else -> leave it.
    pushState for a real move (so Back returns lesson by lesson); replaceState when only the
    cosmetic words differ (a stale or wrong slug, a chapter-only link, an old #hash link) and for
    the first write of a page load.
    ⛔ It waits for `ready` — see routing/usePathCursor: in the commit where a book arrives the
       cursor has not been taken from the URL yet, and writing then would push lesson 1 over a
       deep link.
  */
  useEffect(() => {
    let desired: string | null = null;
    if (screen === 'account') desired = '/account';
    else if (screen === 'settings') desired = '/settings';
    else if (isAddonId(screen)) desired = '/' + addonById(screen).segment;
    else if (!slugResolved || !activeBookFile || !data || !ready) return;
    else if (screen === 'tutorial') desired = lessonPath(activeBookFile, cursor, names);
    else if (screen === 'welcome') desired = homeIsBook ? bookPath(activeBookFile) : '/';
    else if ((screen === 'quiz' || screen === 'result') && state.scope === 'block' && state.scopeBlockId) {
      const m = /^ch(\d{2})-b(\d{2})$/.exec(state.scopeBlockId);
      if (m) desired = lessonPath(activeBookFile, { chapterIndex: Number(m[1]) - 1, blockIndex: Number(m[2]) - 1 }, names, true);
    }
    if (!desired) return;
    const here = window.location.pathname;
    const first = firstWrite.current;
    firstWrite.current = false;
    if (here === desired && !window.location.hash) return;
    const replace = first || Boolean(window.location.hash) || sameRoute(parseRoute(here), parseRoute(desired));
    window.history[replace ? 'replaceState' : 'pushState'](null, '', desired);
  }, [screen, activeBookFile, data, ready, cursor, names, homeIsBook, slugResolved, state.scope, state.scopeBlockId]);

  // Back / Forward: re-read the path and move the app to it (the writer then finds nothing to do).
  useEffect(() => {
    const onPop = () => {
      const route = parseRoute();
      if (route.kind === 'account' || route.kind === 'settings') {
        setActiveTab(route.kind);
        setScreen(route.kind);
        return;
      }
      if (route.kind === 'addon') {
        setActiveTab(route.id);
        setScreen(route.id);
        return;
      }
      const file = route.kind === 'book' || route.kind === 'lesson' ? fileForSlug(route.slug, knownFiles) : null;
      if (!file || route.kind === 'library' || route.kind === 'unknown' || route.kind === 'login') {
        setHomeIsBook(false);
        setActiveTab('home');
        setScreen('welcome');
        return;
      }
      if (route.kind === 'book') {
        setHomeIsBook(true);
        if (file !== activeBookFile) openBook(file);
        setActiveTab('home');
        setScreen('welcome');
        return;
      }
      const at = cursorForRoute(route);
      if (file !== activeBookFile) openBook(file);        // the cursor follows the path on load
      else if (at) select(at);
      pendingQuiz.current = route.quiz;
      setActiveTab('learn');
      setScreen('tutorial');
    };
    // A hand-typed old #chapter=&block= link on an open page: same rewrite as on load.
    const onHash = () => {
      const at = legacyHashCursor();
      if (!at) return;
      select(at);
      setActiveTab('learn');
      setScreen('tutorial');
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
    };
  }, [knownFiles, activeBookFile, openBook, select]);

  // `/quiz` on a lesson path (a link, a refresh, or Forward): start that lesson's assessment once
  // the book is in and the cursor stands on the lesson. One shot per request.
  const { beginBlockAssessment } = actions;
  useEffect(() => {
    if (!pendingQuiz.current || !slugResolved || !data || !ready) return;
    pendingQuiz.current = false;
    beginBlockAssessment();
  }, [slugResolved, data, ready, cursor, beginBlockAssessment]);

  // setReaderMode(on) — one owner for the <body> class. See the header.
  useEffect(() => {
    const on = screen === 'tutorial';
    document.body.classList.toggle('reader-mode', on);
    return () => document.body.classList.remove('reader-mode');
  }, [screen]);

  // D-8: Escape dismisses the picker. Registered only while it is open, so it cannot
  // swallow Escape anywhere else in the app.
  useEffect(() => {
    if (screen !== 'quiz-setup') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeQuizSetup();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, returnTo]);

  // showLandingDashboard() vs showTutorial()/showQuizScreen()/showResults()/showSettings():
  // the legacy toggles the two CONTAINERS, never #welcome-screen. See the ⛔⛔ block below.
  // ⚠ DEVIATION, declared and UNVERIFIED: the legacy opens #quiz-setup-screen as an overlay
  //   OVER whatever was underneath (closeQuizSetup returns you there). This shell has one
  //   `screen` value and no memory of what was beneath, so while the picker is open both
  //   containers are hidden and the overlay sits on an empty page. No gate in this phase
  //   reads it (b15probe only clicks LEARN); recorded rather than papered over.
  const onLanding = screen === 'welcome' || screen === 'loading';

  return (
    <>
      <Header
        activeTab={activeTab}
        onSelectTab={(tab) => actions.guardExamLeave(screen === 'quiz', () => {   // P3: leaving a running exam asks first
          if (tab !== 'quiz' && tab !== 'generated') setActiveTab(tab);
          // The tab -> screen map, ported from the four nav listeners (app.js:1232, 1360,
          // 3487, 3488) and updateNavUI (296-310).
          // ⚠ nav-quiz opens the PICKER, not a running quiz (openQuizTab). Sending it
          //   straight to #quiz-screen starts an assessment nobody chose the scope for.
          // ⚠ nav-learn does NOT jump to nextLesson — only #read-tutorial-btn does. The
          //   two entrances behave differently in the legacy app and that is preserved.
          if (tab === 'learn') setScreen('tutorial');
          // openQuizTab(mode) (app.js:1012): the picker, in the tab's own mode. ⚠ The nav
          //   underline moves at Start, not here — opening the picker is not navigating yet.
          if (tab === 'quiz') openQuizSetup('practice');
          if (tab === 'generated') openQuizSetup('generate');
          if (tab === 'settings') setScreen('settings');
          if (tab === 'account') setScreen('account');
          if (isAddonId(tab)) setScreen(tab);
          // ⛔ THE NARROW-VIEWPORT menu closes on a nav choice — `if (!isWideMenu())` is the
          //    legacy's own guard (app.js:3487-3490) and dropping it is D-8. See
          //    shell/Header.tsx:isWideMenu for the measurement.
          if (!isWideMenu()) setMenuOpen(false);
        })}
        onBrandHome={() => actions.guardExamLeave(screen === 'quiz', () => {
          setHomeIsBook(false);
          // showLandingDashboard -> updateNavUI('tutorial') (app.js:322): HOME is underlined.
          setActiveTab('home');
          setScreen('welcome');
        })}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        /* syncMenuToViewport (app.js:3491 + :3500). ⛔ `setMenuOpen` is passed DIRECTLY,
           not wrapped in an arrow: useState's setter has a stable identity, and Header's
           media-query effect lists this in its dependency array. An inline arrow would
           re-subscribe the matchMedia listener on every render of the shell. */
        onSyncMenu={setMenuOpen}
      />

      {/* ⛔ #app-container is a B3 ANCHOR, not a div for tidiness: src/styles/app.css
          carries `body.reader-mode #app-container { min-height: 0 }`, which is the middle
          link of the height chain. Delete the element and the rule matches nothing —
          silently, because a CSS rule that selects nothing does not error. */}
      <div id="app-container" className="flex-grow flex flex-col w-full relative">
      {/*
        ⛔⛔ THE TWO-CONTAINER SPLIT IS B15's OTHER HALF (A2-R4), AND IT IS NOT COSMETIC.
            Measured on the legacy app, and it is the ONLY screen written this way:

              aws-quiz-app/index.html:231
                <section id="welcome-screen" class="animate-fade-in ...">   <- NO hidden-view
              aws-quiz-app/js/app.js:277-280  setAppState()
                // "The panel itself never hides."
                dom.welcomeScreen.classList.remove('hidden-view');

            `showTutorial()` (app.js:624-627) hides `#landing-dashboard` and shows
            `#content-section`. It NEVER touches `#welcome-screen`. `landing-dashboard`
            does not end in `-screen`, so it is invisible to the probe's
            `[id$="-screen"]` enumeration — and THAT is why the pinned :8791 baseline is
              BEFORE: visibleScreens ["welcome-screen"]              hash #chapter=1&block=8
              AFTER : visibleScreens ["welcome-screen","tutorial-screen"]  hash #chapter=1&block=1
            i.e. BOTH after the LEARN click.
        ⛔ A single `screen` state that hides welcome when the reader opens is the obvious
           React shape and it produces ["tutorial-screen"] alone — a DIVERGENCE from the
           pinned baseline that would be reported as "the port broke B15". The container,
           not the screen, is what hides.
      */}
      <div id="landing-dashboard" className={onLanding ? 'flex flex-col w-full' : 'hidden-view flex flex-col w-full'}>
      {/*
        ⛔ THE PAGE GUTTER AND THE READING COLUMN, ported 22-09-26 (EVL fix 003) VERBATIM from
           aws-quiz-app/index.html:214-215. Two nested divs, and BOTH do a job:
             · the outer one paints the page (`bg-gray-900`) and supplies the horizontal
               gutter and vertical rhythm;
             · the inner one caps and centres the reading column (`max-w-7xl mx-auto`).
           Without them the home screen ran flush to x=0 across the full 1440px window —
           measured: #welcome-screen's bounding rect was x=0, w=1440.
        ⚠ `bg-gray-900` is here rather than on #landing-dashboard because that is where the
          legacy puts it, and because #content-section (the other container) carries its own.
        ⚠ NO `space-y` here — the legacy's own comment: the hidden loading section would still
          push the panel down.
      */}
      <div className="w-full bg-gray-900 px-4 pt-6 sm:pt-10 pb-20">
      <div className="max-w-7xl mx-auto">
        {/* Writing an AI quiz — index.html:220-228, class strings verbatim. */}
        <Screen
          id="loading-screen"
          visible={screen === 'loading'}
          className="flex flex-col items-center justify-center text-center py-24 animate-fade-in"
        >
          {/* ⚑ 30-09-26: the markup lives in shell/LoadingPanel.tsx (moved verbatim) so the Q&A
                add-on reuses the SAME panel (user: "not the same as the AI-Quiz"). DOM unchanged. */}
          <LoadingPanel
            idBase="loading"
            title={<>Writing a <span className="font-bold">fresh quiz</span></>}
            scope={actions.loading.scope || 'AI is reading random book sections · up to a minute'}
            model={actions.loading.model}
            onCancel={actions.cancelAiQuiz}
          />
        </Screen>

        {/*
          ⛔ `visible` is HARD-CODED TRUE. Not a bug, not a leftover — see the block above.
             #welcome-screen carries no hidden-view in ANY state of the legacy app.
          ⛔ enterReader() FIRST, then the screen switch — THAT ORDER IS B15
             (state/ReaderCursorProvider). #read-tutorial-btn moves the cursor to
             nextLesson() and stamps the hash before the reader is shown.
          ⚑ A2-R3 CLOSED THIS SLICE: ReaderScreen now consumes useReaderCursor() instead of
            calling useHashCursor() itself, so there is exactly ONE cursor and enterReader()'s
            jump is finally visible to the reader. Before that there were two instances and
            the jump went nowhere (writeCursorHash uses replaceState, which emits no
            `hashchange`, so the second instance never heard about it).
        */}
        {/*
          ⛔ `visible` is HARD-CODED TRUE — #welcome-screen carries no hidden-view in ANY state
             of the legacy app; the CONTAINER (#landing-dashboard) hides, never the screen (B15).
          ⚑ Phase 04 parity: #welcome-screen IS the card (index.html:231), and #home-kpis +
            #services-section are its SIBLINGS — not children, as slice A1 had them.
          ⛔ enterReader() FIRST, then the screen switch — THAT ORDER IS B15.
        */}
        {/*
          ⚑ 24-09-26 (user): while an AI-Quiz is being written (screen === 'loading') the home
            widgets under the spinner were still showing — welcome card, KPIs and library all
            rendered below "Writing a fresh quiz". They hide in THAT state only. Every other
            state keeps welcome visible exactly as before, so B15's pinned
            ["welcome-screen","tutorial-screen"] after LEARN is unchanged.
        */}
        <Screen
          id="welcome-screen"
          visible={screen !== 'loading'}
          className="animate-fade-in bg-gray-800 border border-gray-700 rounded-2xl p-6 sm:p-8"
        >
          <WelcomeCard
            onOpenReader={() => {
              enterReader();
              setActiveTab('learn');
              setScreen('tutorial');
            }}
            onPractice={() => openQuizSetup('practice')}
            onGenerate={() => openQuizSetup('generate')}
            aiReady={actions.aiReady}
            providerReady={actions.providerReady}
          />
        </Screen>
        <HomeKpis hidden={screen === 'loading'} />
        <LibrarySection hidden={screen === 'loading'} />
      </div>
      </div>
      </div>

      {/*
        ⛔ B3 — HALF OF THE READER-MODE HEIGHT CHAIN LIVES HERE. `min-h-0` on this element
           and `reader-mode` (which adds `padding:6px; min-height:0`, src/styles/app.css)
           are what stop the flex children inheriting `min-height:auto` and growing with
           their content. Measured on the legacy app: the article rendered 3367px tall
           inside an 824px parent and the PAGE scrolled instead of the pane. The other half
           is `body.reader-mode`'s 100dvh cap (the effect above) and ReaderScreen's own
           min-h-0 chain. All three are needed; any one alone looks correct and does nothing.
      */}
      <div
        id="content-section"
        className={[
          'w-full bg-gray-900 flex-grow flex flex-col min-h-0 px-4 py-6',
          screen === 'tutorial' ? 'reader-mode' : null,
          onLanding ? 'hidden-view' : null,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Screen
          id="tutorial-screen"
          visible={screen === 'tutorial'}
          className="w-full flex-1 min-h-0 flex flex-col lg:flex-row gap-2"
        >
          <ReaderScreen
            isVisible={screen === 'tutorial'}
            actions={actions}
            onShowReader={() => {
              enterReader();
              setActiveTab('learn');
              setScreen('tutorial');
            }}
          />
        </Screen>

        {/* ⚑ Phase 06a — the Account page (ruling R25). Same frame as Settings. */}
        <Screen id="account-screen" visible={screen === 'account'} className="w-full max-w-5xl mx-auto space-y-6">
          <AccountScreen open={screen === 'account'} onStartRun={() => showQuizFor('other')} />
        </Screen>

        <Screen id="settings-screen" visible={screen === 'settings'} className="w-full max-w-5xl mx-auto space-y-6">
          <SettingsScreen open={screen === 'settings'} />
        </Screen>

        {/* Add-on screens (study-rooms-qna P1). Registry: shell/screens.meta.ts + shell/screens.tsx. Empty in P1. */}
        {ADDON_LIST.map((m) => {
          const id = m.id as AddonId;
          const C = (ADDON_SCREENS as Readonly<Record<string, ComponentType<{ open: boolean }> | undefined>>)[m.id];
          if (!C) return null;
          return (
            <Screen key={id} id={m.domId} visible={screen === id} className={ADDON_SCREEN_CLASS}>
              <C open={screen === id} />
            </Screen>
          );
        })}

        {/*
          ⛔ B6 — `pb-32` IS ON #quiz-screen ITSELF, exactly as the legacy has it
             (index.html:446). It RESERVES the fixed action bar's height. On an inner
             wrapper it reserves space in a box the bar is not positioned against, which
             looks identical until the last option is the one being covered.
        */}
        <Screen id="quiz-screen" visible={screen === 'quiz'} className="mx-auto w-full max-w-2xl pb-40">
          {/*
            ⛔ `isVisible` is not decoration — the screen stays MOUNTED under .hidden-view,
               so without it QuizScreen's D-10 finish effect could fire from a hidden screen
               and pull the learner out of the reader. Same pattern as ReaderScreen's B7.
          */}
          <QuizScreen
            isVisible={screen === 'quiz'}
            onFinish={finishQuiz}
            onNewQuiz={() => openQuizSetup(state.scope === 'ai' ? 'generate' : 'practice')}
          />
        </Screen>

        <Screen
          id="result-screen"
          visible={screen === 'result'}
          className="w-full max-w-5xl mx-auto bg-gray-800 p-8 sm:p-10 md:p-16 border border-gray-700 text-center shadow-xl rounded-2xl"
        >
          <ResultScreen
            onBackToReader={backToReader}
            onNewQuiz={() => openQuizSetup(state.scope === 'ai' ? 'generate' : 'practice')}
            onGenerateAnother={actions.generateAnother}
            saveNote={actions.saveNote}
            /* startQuiz()'s showQuizScreen() — see ResultScreenProps.onResumeQuiz. */
            onResumeQuiz={resumeQuiz}
          />
        </Screen>
      </div>

      </div>

      {/* An overlay at z-[60], a sibling of both containers — index.html:534. */}
      <Screen id="quiz-setup-screen" visible={screen === 'quiz-setup'} className="fixed inset-0 z-[60] overflow-y-auto">
        <QuizSetupScreen
          mode={setupMode}
          open={screen === 'quiz-setup'}
          onStart={() => showQuizFor('other')}
          onCancel={closeQuizSetup}
          actions={actions}
        />
      </Screen>

      {/*
        ⛔ R-3 — THE FAB IS SCOPED TO THE READER. The legacy toggles `hidden-view` on it from
           a MutationObserver watching #tutorial-screen (app.js:3710-3717); this shell simply
           knows. Without the scope the FAB floated over the home page, the quiz and the
           settings screen, and sat ON TOP of the quiz-setup modal's backdrop — visible in
           screenshot 08-quiz-setup.png. The panel also force-closes on the way out, which is
           the second half of that legacy listener.
      */}
      <AskPanel reading={screen === 'tutorial'} />

      {/* 01-11-26: floating spaced-repetition reminder — hidden while a quiz, the picker or the AI spinner is up. */}
      <ReviewReminder
        visible={screen !== 'quiz' && screen !== 'quiz-setup' && screen !== 'loading'}
        onStart={() => showQuizFor('other')}
      />
    </>
  );
}

/**
 * The provider stack, in DEPENDENCY order — this nesting is not cosmetic:
 *   LibraryProvider   independent (holds libraryOrder, A2c)
 *     BookProvider      independent (book identity + the payload)
 *       ProgressProvider  reads BookProvider (moduleId, chapters, blocksOf)
 *         ReaderCursorProvider reads BOTH (chapter counts + isBlockComplete for resume)
 *           QuizProvider       independent (the 13-field atom)
 * Flattening this is a runtime "must be used inside <X>" throw, not a type error.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <LibraryProvider>
      <BookProvider>
        <ProgressProvider>
          <ReaderCursorProvider>
            <QuizProvider>{children}</QuizProvider>
          </ReaderCursorProvider>
        </ProgressProvider>
      </BookProvider>
    </LibraryProvider>
  );
}
