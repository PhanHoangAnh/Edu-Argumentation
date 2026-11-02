# Books

Each folder is one book package, laid out exactly like the app's library folder
(`EDU_LIBRARY_ROOT`, `/home/ubuntu/foxai-data/edu-argumentation/library` in production).
To install a book, copy its folder into the library. The importer builds `book-index.sqlite`
(the tutor's search index) itself, so it is not stored here.

| Folder (moduleId) | Title | Chapters | Licence |
|---|---|---|---|
| `t-clf-c02-cloud-practitioner` | AWS Certified Cloud Practitioner (CLF-C02) | 40 (20 lessons + 20 practice) | Own text; practice chapters use the CloudCertPrep community bank (MIT, https://github.com/nastaso/cloudcertprep), credited in the book |
| `openintro-statistics-2019-1045f2f5` | OpenIntro Statistics 2019 | 9 | OpenIntro textbook, Creative Commons licence (see openintro.org) |

## Also in the live library, not stored here

These two are imported from copyrighted books, and this repository is public. Ask for a copy
directly; do not commit them.

| moduleId | Title |
|---|---|
| `geron-homl3` | Hands-On Machine Learning — Chapters 1–19 (Géron, O'Reilly) |
| `python-for-data-analysis-pdf-78763858` | Python for Data Analysis (McKinney; online edition CC BY-NC-ND) |

## CLF-C02 book, version of 27-10-26

- 80 community questions moved to the practice chapter of the lesson that answers them
  (each move checked by a model quoting the lesson). Example: "What are the capabilities of AWS
  X-Ray?" moved from Practice 1 (Global infrastructure) to Practice 14 (Other services).
- 715 of 995 own questions rewritten to remove the longest-answer clue: the correct option is now the
  longest in 32% of questions (was 70%; 25% is chance). Chapters 14, 15, 16, 19 and part of 13 are
  not rewritten yet.
- Question ids in the practice chapters changed: saved progress on those questions does not carry over.
