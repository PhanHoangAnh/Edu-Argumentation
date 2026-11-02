// Q&A examiner — the grade card (study-rooms-qna P2, 29-09-26).
//
// Four labelled sections, each with an SVG icon AND its word (never colour or icon alone; no
// emoji): Right · Almost · Missing · Wrong. Empty sections are not shown.
// Focus moves here when a grade arrives (tabIndex -1), so a keyboard / screen-reader user lands
// on the result. The score prints UNROUNDED (String(score)) so it can never disagree with pass.
// ⛔ Class strings are complete literals (Tailwind purge).
import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import type { QnaGrade } from './useQnaSession';

function Icon({ kind }: { kind: 'right' | 'almost' | 'missing' | 'wrong' }) {
  const paths: Record<typeof kind, ReactNode> = {
    right: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />,
    almost: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 9c2.7-2 5.3 2 8 0s5.3-2 8 0M4 15c2.7-2 5.3 2 8 0s5.3-2 8 0" />,
    missing: <circle cx="12" cy="12" r="7" strokeWidth="2" />,
    wrong: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />,
  };
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {paths[kind]}
    </svg>
  );
}

const SECTIONS: ReadonlyArray<{ key: 'right' | 'almost' | 'missing' | 'wrong'; label: string; tone: string }> = [
  { key: 'right', label: 'Right', tone: 'flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-green-400' },
  { key: 'almost', label: 'Almost', tone: 'flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-amber-300' },
  { key: 'missing', label: 'Missing', tone: 'flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-300' },
  { key: 'wrong', label: 'Wrong', tone: 'flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-brand-400' },
];

export const GradeCard = forwardRef<HTMLElement, { grade: QnaGrade }>(function GradeCard({ grade }, ref) {
  return (
    <section
      id="qna-grade"
      ref={ref}
      tabIndex={-1}
      aria-labelledby="qna-grade-title"
      className="rounded-xl border border-gray-700 bg-gray-900/60 p-5 sm:p-6 space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 id="qna-grade-title" className="text-2xl text-white font-light">
          <span id="qna-score" className="tabular-nums">{String(grade.score)}</span>
          <span className="text-gray-400"> / 10</span>
        </h3>
        <span className={grade.pass ? 'text-sm font-semibold uppercase tracking-wider text-green-400' : 'text-sm font-semibold uppercase tracking-wider text-brand-400'}>
          {grade.pass ? 'Passed' : 'Not passed'}
        </span>
      </div>
      {grade.feedback ? <p className="text-gray-200">{grade.feedback}</p> : null}
      {SECTIONS.filter((s) => grade[s.key].length > 0).map((s) => (
        <div key={s.key} data-grade-section={s.key}>
          <h4 className={s.tone}>
            <Icon kind={s.key} />
            {s.label}
          </h4>
          <ul className="mt-2 space-y-1 pl-7 list-disc text-sm text-gray-300">
            {grade[s.key].map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
});
