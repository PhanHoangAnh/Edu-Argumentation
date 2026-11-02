// Seam 21 (quiz/OptionCard) — ⛔ **ONE** CARD, USED BY BOTH THE QUIZ AND THE EXERCISES.
//
// ⛔⛔ THE USER HAS OBJECTED TO BREAKING THIS **TWICE**. It is its own seam precisely so
//     it cannot drift into two look-alike components.
//     (user, 19-09-26: "import the animation and stuff from the actual quiz page so you
//      don't have to design new thing" … "when I select it would show the result with an
//      animation right away like the quiz page")
//
// In the legacy app this is the `tmpl-quiz-option` <template>, cloned by BOTH
// loadQuestion() and renderExercises(). Reusing it means the exercises inherit the quiz's
// hit area, hover, letter badge and the grid-template-rows explanation reveal — and there
// is ONE card design in this app instead of two that drift apart.
//
// Contract DOM this component owns:
//   .option-card · .option-letter · .option-text · .explanation-inner · .explanation-text
//   (and `#options-container .option-card …` for all four, when rendered by the quiz)
//
// ⛔⛔ D-11 — THE EXPLANATION IS NOT IN THE DOM UNTIL THE QUESTION IS ANSWERED.
//     FIXED 22-09-26 (EVL fix 005). This component used to render `{explanation}`
//     UNCONDITIONALLY. The closed card is 41px of padding with the content clipped, so the
//     FIRST LINE of every explanation showed through — and because the correct option's
//     explanation reads differently from the three distractors ("Mitchell's definition is…"
//     vs "Review the chapter explanation: …"), THE ANSWER WAS IDENTIFIABLE WITHOUT
//     ANSWERING. On a study app whose whole purpose is self-assessment that is an
//     assessment-integrity defect, not a cosmetic one.
//     ⛔ The fix is the LEGACY's: `tmpl-quiz-option` ships `.explanation-inner` **EMPTY**
//        (index.html:619) and handleAnswerSelect fills it (app.js:2942-2947). The element
//        still EXISTS closed — the frozen selector contract requires
//        `#options-container .option-card .explanation-inner` to resolve — it is just empty.
//     ⛔ DO NOT "fix" a leak of this shape by clipping, masking, colouring or shrinking.
//        Anything that leaves the text in the DOM leaves it readable by devtools, by text
//        selection, by a screen reader and by a screenshot. Absence is the only fix.
//     ⚠ It is invisible to R-B1, whose band (35 <= closed <= 45) is satisfied at 41px
//       whether the strip is empty or full — the padding is what measures, not the text.
//       Its gate is R-J5 (gate-r-journey.mjs), which reads the CLOSED card's text.
//
// ⛔⛔ D-12 — EVERY CARD RESOLVES ON ANSWER, NOT JUST THE ONES THE LEARNER TOUCHED.
//     FIXED 22-09-26 (EVL fix 005). The two call sites used to pass `reveal={null}` for the
//     unselected wrong options, so only 2 of 4 cards ever opened and NONE of them carried
//     the legacy's treatment. The legacy (app.js:2934-2983) loops ALL cards and gives each:
//       · `answered cursor-default`
//       · a title span — `Correct Answer` (text-emerald-400) or `Incorrect` (text-brand-400)
//       · the correct card: #10b981 border + rgba(16,185,129,.1) fill + an emerald badge
//       · the SELECTED wrong card: #ef4444 border + rgba(239,68,68,.1) fill + a red badge
//       · every OTHER card: `opacity-50`
//       · `expanded`, staggered `50ms * index`
//     ⚠ `reveal` is therefore 'correct' | 'incorrect' for EVERY card once answered, and null
//       ONLY while unanswered. `selected` is what separates the learner's wrong pick (red)
//       from the wrong options they did not choose (dimmed) — which is why both props exist.
//       Its gate is R-J6, and its expected card count is DERIVED from the question's own
//       options.length, never a literal `=== 4`.
//
// ⛔⛔ B1 — THE 0fr→1fr REVEAL. The CLOSED state of `.explanation-inner` is **41 px, NOT
//     0 px** (`px-6 pb-6 pt-4` = 16+24, plus a 1 px `border-t`). The gate is a BAND AND A
//     RATIO, never `=== 41`:
//         35 ≤ closed ≤ 45   AND   open > 100   AND   open > 2.5 × closed
//     ⛔ Do not "simplify" it to a literal: a legitimate padding change would turn a
//        correct build red — the same stale-literal class as F-1 and A-G17's `total===21`.
//     ⛔ The `≥ 35` FLOOR is not optional: `≤ 45` alone passes at 0 px, so dropping
//        .explanation-inner's padding entirely would read green.
//     ⚑ THE BAND SURVIVES D-11's FIX because the 41px is PADDING, not text: emptying the
//       inner removes content from a track that was already sized to 0fr.
//
// ⚠ B5b gates DOM IDENTITY, not class names: the quiz card and the exercise card must
//   emit the SAME CLASS SET and identical computed borderRadius, padding and
//   .option-letter geometry. Two components that merely LOOK alike pass a class-name
//   check and fail this one — which is the point. ⛔ Every change below is made in THIS ONE
//   component, so it lands on BOTH call sites by construction; that is the whole reason the
//   seam exists and the reason a "quick fix" must never be made at a call site instead.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface OptionCardProps {
  /** 0-based. Rendered as A, B, C… in `.option-letter`. */
  index: number;
  /** Already-rendered option text (goes through RichTextViewer at the call site). */
  children: ReactNode;
  selected: boolean;
  /**
   * Revealed state: null = NOT ANSWERED YET.
   * ⛔ Once the question is answered EVERY card carries a verdict — 'correct' for the one
   *    correct option and 'incorrect' for all the others (D-12). `null` after an answer
   *    means an unresolved card, which is the defect this prop's contract now forbids.
   */
  reveal: 'correct' | 'incorrect' | null;
  explanation?: string;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * ⛔⛔ THESE STRINGS ARE THE `tmpl-quiz-option` <template> (aws-quiz-app/index.html) AND
 *     handleAnswerSelect's own class strings (aws-quiz-app/js/app.js), COPIED
 *     CLASS-FOR-CLASS. They are CONSTANTS, and they are module-level, for one reason: B5b
 *     gates DOM IDENTITY between the quiz card and the exercise card, and the only way two
 *     call sites cannot drift is if there is exactly one string.
 *
 * ⛔ `EXPLANATION_INNER`'s `px-6 pb-6 pt-4` IS THE 41px. 16 + 24 = 40px of vertical
 *    padding, plus EXPLANATION_TEXT's 1px `border-t` => the CLOSED state measures 41px,
 *    not 0px. Deleting the padding "because the row is 0fr anyway" is precisely the change
 *    B1b's `>= 35` floor exists to catch: without the floor it reads GREEN at 0px.
 * ⛔ `border-transparent` is not decoration either — the legacy turns that border a colour
 *    on reveal, and a border that appears only when revealed would change the closed
 *    height and break the band.
 */
const OPTION_CARD =
  'option-card w-full text-left p-0 bg-gray-800 border-2 border-gray-700 rounded-xl text-gray-300 relative overflow-hidden outline-none hover:border-gray-500 transition-colors';
// ⚠ SPLIT, not rewritten: the legacy drops `text-gray-400` off the badge when it colours it
//   (app.js:2959/2973 `letterBadge.classList.remove('bg-gray-800','text-gray-400')`). The
//   CLOSED token set is unchanged — `OPTION_LETTER` below still resolves to exactly the same
//   sorted class set B5b froze — so this split is invisible to the identity check.
const OPTION_LETTER_BASE =
  'option-letter flex items-center justify-center w-7 h-7 text-xs rounded-full bg-gray-700 font-bold shrink-0 transition-colors';
const OPTION_LETTER = `${OPTION_LETTER_BASE} text-gray-400`;
const OPTION_TEXT = 'option-text min-w-0 flex-1 flex items-center min-h-[1.75rem] text-[15px]';
const EXPLANATION_TEXT = 'explanation-text bg-gray-900/50 text-sm border-t border-transparent';
// 23-10-26 compact redesign (user: all answers must fit without scrolling): CLOSED the strip is ~1px (no padding),
// OPEN it is one tight run-in paragraph ("INCORRECT  No, that describes…").
const EXPLANATION_INNER = 'explanation-inner px-3 [.expanded_&]:pb-2 [.expanded_&]:pt-1.5';
// app.js:2945 / 2948 — the two spans handleAnswerSelect builds inside .explanation-inner.
const EXPLANATION_TITLE = 'mr-2 font-bold tracking-wider text-xs uppercase';
const EXPLANATION_BODY = 'text-gray-400 leading-snug';

// app.js:2957-2975 — the inline colours. Kept as inline styles, exactly as the legacy sets
// them, because Tailwind cannot express `rgba(16,185,129,0.1)` from the frozen class set and
// a new utility class here would be a SECOND source of truth for the same colour.
const CORRECT_BORDER = '#10b981';
const CORRECT_FILL = 'rgba(16, 185, 129, 0.1)';
const WRONG_BORDER = '#ef4444';
const WRONG_FILL = 'rgba(239, 68, 68, 0.1)';
const BADGE_TEXT = '#ffffff';
// app.js:2981 — `setTimeout(() => explContainer.classList.add('expanded'), 50 * index)`.
const STAGGER_MS = 50;
// 21-10-26 (choose-N questions): an option the learner has TICKED but not yet checked. A
// single-answer click answers at once, so `selected && reveal === null` never occurs there and
// this changes nothing for existing books. Inline colours, like the verdicts above.
const TICKED_BORDER = '#6366f1';
const TICKED_FILL = 'rgba(99, 102, 241, 0.12)';

export function OptionCard(props: OptionCardProps) {
  const { index, children, selected, reveal, explanation, disabled, onSelect } = props;
  // The reveal is the grid-row switch, nothing else: .explanation-text goes 0fr -> 1fr.
  // ⚠ Keyed on `reveal !== null` (answered), NOT on `selected` — the legacy expands the
  //   explanation under EVERY option once the question is answered, which is why the Next
  //   button had to be pinned in the first place (B6's whole reason for existing).
  const revealed = reveal !== null;
  const isCorrect = reveal === 'correct';
  // The learner's OWN wrong pick gets the red treatment; the wrong options they did not
  // choose are merely dimmed (app.js:2969-2978). Both are `reveal === 'incorrect'`.
  const pickedWrong = reveal === 'incorrect' && selected;
  const dimmed = reveal === 'incorrect' && !selected;
  const ticked = selected && reveal === null;

  // ⛔ THE STAGGER IS THE LEGACY'S, and it is state rather than a class-toggle-on-a-ref
  //    because React owns this DOM. `50 * index` matches app.js:2981 exactly; at four
  //    options the last card opens 150ms after the click, which is why every gate that
  //    measures the open state waits well past that.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!revealed) {
      setExpanded(false);
      return undefined;
    }
    const timer = setTimeout(() => setExpanded(true), STAGGER_MS * index);
    return () => clearTimeout(timer);
  }, [revealed, index]);

  const cardClass = [
    OPTION_CARD,
    revealed ? 'answered cursor-default' : '',
    dimmed ? 'opacity-50' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cardStyle = isCorrect
    ? { borderColor: CORRECT_BORDER, backgroundColor: CORRECT_FILL }
    : pickedWrong
      ? { borderColor: WRONG_BORDER, backgroundColor: WRONG_FILL }
      : ticked
        ? { borderColor: TICKED_BORDER, backgroundColor: TICKED_FILL }
        : undefined;
  const badgeColoured = isCorrect || pickedWrong || ticked;
  const badgeStyle = badgeColoured
    ? { backgroundColor: isCorrect ? CORRECT_BORDER : ticked ? TICKED_BORDER : WRONG_BORDER, color: BADGE_TEXT }
    : undefined;

  return (
    <button
      type="button"
      className={cardClass}
      style={cardStyle}
      // Selected state must be ANNOUNCED, not only coloured.
      aria-pressed={selected ? 'true' : 'false'}
      data-reveal={reveal ?? undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      <div className="px-3 py-2 flex items-center gap-3">
        <span className={badgeColoured ? OPTION_LETTER_BASE : OPTION_LETTER} style={badgeStyle}>
          {String.fromCharCode(65 + index)}
        </span>
        <span className={OPTION_TEXT}>{children}</span>
      </div>
      {/*
        ⛔ B1 — THE 0fr -> 1fr REVEAL. The two-element nesting is the shape the gate
           measures and the `expanded` class is the whole mechanism (src/styles/app.css).
        ⚠ The legacy uses a <div> pair here and so does this; the outer element must be the
          grid container and the inner the overflow:hidden child. Collapsing them to one
          element animates nothing, because grid-template-rows needs a track to size.
        ⛔⛔ D-11 — `.explanation-inner` IS EMPTY UNTIL `revealed`. The element stays (the
            frozen contract resolves it), the CONTENT does not. See the header.
      */}
      <div className={expanded ? `${EXPLANATION_TEXT} expanded` : EXPLANATION_TEXT}>
        <div className={EXPLANATION_INNER}>
          {revealed && (
            <>
              <span
                className={`${EXPLANATION_TITLE} ${isCorrect ? 'text-emerald-400' : 'text-brand-400'}`}
              >
                {isCorrect ? 'Correct Answer' : 'Incorrect'}
              </span>
              <span className={EXPLANATION_BODY}>{explanation}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
