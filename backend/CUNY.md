# CUNY Global Search

## Course identifiers

CUNY Global Search first selects an institution and term. Its next form provides the available subject and career choices for that institution and term. Result groups supply the displayed subject, catalog number, and title. The rows under each group supply the separate class number, section label, and meeting details. A class number identifies a scheduled section in context, while a course code such as `ENGL 1010` identifies the course students look up. See [CUNY Global Search](https://globalsearch.cuny.edu/CFGlobalSearchTool/search.jsp) and [CUNY's Schedule Builder search guide](https://www.cuny.edu/wp-content/uploads/sites/4/page-assets/about/administration/offices/registrar/resources/schedulebuilder/SB-student-guide_01.22.2021.pdf).

Brooklyn College publishes `ENGL 1010` for English Composition I. The Spring 2027 Global Search result displays it as `ENGL. 1010`. City Tech lists `ENG 1101` for its English Composition I, and LaGuardia lists `ENG 101` for Composition I. The Spring 2027 Global Search results for Queensborough displayed `ENGL 101` for English Composition I. The School of Journalism displayed `MM 1` under its `MESG` subject filter. The importer stores the subject filter code and label separately from the display subject and catalog number. It keeps leading zeros, punctuation, and letter suffixes as strings. Course-code search matches inputs such as `ENGL1010`, `ENGL 1010`, and `ENGL. 1010`. [Brooklyn College](https://www.brooklyn.edu/advisement/pathways/pathways-for-academic-year-2026-27/), [City Tech catalog](https://citytech.catalog.cuny.edu/courses/0387441), [LaGuardia catalog](https://laguardia.catalog.cuny.edu/courses/0754911).

This uses the upstream values for every institution exposed in Global Search. It imports scheduled offerings for the selected term. The full academic catalog can also include courses with no scheduled section that term.

## Backend setup

1. Run `npm ci` from the repository root and set `DATABASE_URL` in `backend/.env` to a PostgreSQL database. The app role needs permission to create the cache table on first use and read and write it thereafter.
2. Install Chromium with `npx playwright install chromium`. On a Linux VPS that also needs the browser's system libraries, use `npx playwright install --with-deps chromium`. Install the browser for the OS account that runs Express.
3. Run `npm run dev -w backend`. For a built backend, run `npm run build -w backend` and then `npm run start -w backend`.

## API

- `GET /api/cuny/selections` returns live CUNY term and college IDs and labels, cached in PostgreSQL for 24 hours.
- `GET /api/cuny/subjects?term=1272&college=BKL01` returns the subjects available for the selected catalog without importing course sections.
- `GET /api/cuny/courses?term=1272&college=BKL01&q=ENGL1010` matches the exact course code and returns its sections. On a cache miss, the API imports only the English subject across the careers CUNY exposes. Global Search provides a subject filter, so the API filters the returned courses locally. If the displayed prefix differs from the upstream subject ID, pass the upstream ID explicitly, for example `q=MM1&subject=MESG`.
- An empty `q` browses courses. Free-text queries can match titles, subjects, instructors, and section class numbers. Pass `subject` to scope a browse or text query to one subject and `openOnly=true` to keep only open sections. Without a subject or exact code, a cache miss starts a full import. Results support `limit` (1–100, default 50) and `offset` (default 0).
- A cache miss returns HTTP `202`. Poll the same URL after the `Retry-After` interval. A full import for a large college may take several minutes. A separate import requested while one is running returns `503` with `Retry-After`. A failed upstream import returns `502` on subsequent polls during a one-minute retry cooldown.
- The planner checks a section's instructor on demand via `GET /api/professors/search?q=Erica+Tupone&college=BKL01`. It displays a rating when the college and normalized name identify a single Rate My Professors profile. The existing `schoolId` search still supports fuzzy results and pagination.

The API caches complete college/term schedules and targeted subject snapshots separately in PostgreSQL, including searches with zero returned courses. An incomplete scrape leaves the cache unchanged. Saved snapshots survive API restarts and are reused indefinitely. Treat seat status as a snapshot as of `fetchedAt`. The concurrent import limit is per Express process, so run one API process for this single-VPS setup.

## Tests

Run `npm test -w backend` with Chromium installed. Set `CUNY_TEST_DATABASE_URL` to run the API integration test against a disposable PostgreSQL database. That test creates and drops an isolated test schema.

Run `npm test -w frontend` to exercise the planner in Chromium with controlled API responses.
