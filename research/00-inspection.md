# Stage 1 — Inspection of the existing project

Inspected before any change was made. The repository at first contained only
`Cyclopean Psychedelic Sound Machine.png`. The site files and corpus were
supplied separately and committed unchanged in this stage.

## Files

| File | Role |
| --- | --- |
| `index.html` | Static page shell. Masthead, discovery controls, filters, record grid, history/profile views, about copy, dialog, toast. Loads `style.css` and `app.mjs`. |
| `app.mjs` | DOM layer. `createApp({dataset, doc, storage, now, random})` renders everything. The bottom of the file fetches `./weird-music-machine-corpus.json`, runs an integrity check and boots the app. |
| `engine.mjs` | Pure logic. Listening log persistence, filtering, sorting, similarity, recommendations, Surprise Me, taste profile. No DOM access. |
| `weird-music-machine-corpus.json` | The corpus: a bare JSON array of 250 records. |
| `Cyclopean Psychedelic Sound Machine.png` | The artwork, 1254 × 1254. |
| `art-direction/images/psychedelic-machine.png` | **Byte-identical copy** of the artwork (same git blob `4b43191e…`) at the path `index.html` references. |

**Referenced but not supplied:** `style.css` and
`art-direction/fonts/Modak-Regular.woff`. The page works without them
(unstyled, fallback font). They were not recreated, because recreating the
visual design would be a redesign.

**Tests:** none were supplied. A test suite is added in stage 2.

## Corpus schema (all 250 records carry all 20 fields)

| Field | Type / convention |
| --- | --- |
| `id` | `wire-001`…`wire-130` (Wire list) and `wmm-0001`…`wmm-0120` (later additions). Both series are contiguous. |
| `artist`, `title`, `label` | strings (`label` is the source's label text; may be `(unveröff.)`) |
| `year` | integer, **or** the string `"(unveröff.)"` for 2 unreleased Wire entries |
| `list_number` | 1–130 for Wire records; `null` for `wmm-` records |
| `list_group` | `"original 100"`, `"runner-up"`, or `null` for `wmm-` records |
| `source_notes` | notes about what the curated source itself says |
| `genres`, `styles`, `traits` | string arrays: 26 genres, 201 styles, 27 traits (see `baseline-vocabulary.json`) |
| `weirdness`, `intensity`, `accessibility` | integer 1–5, or `null` (only `wire-121`, Derrick May's unreleased project) |
| `research_sources`, `research_notes` | URLs and notes from metadata research. A note containing `Manual review:` flags the record for review (`engine.manualReview`). |
| `curation_sources` | `[{publication, list_title, list_year, rank, url}]`. `rank` is `null` for unranked lists. |
| `release_type`, `release_type_sources`, `release_type_notes` | e.g. album, single, live album, compilation, unknown |

Curation in the baseline: The Wire (212 citations), The Quietus (56) and
Bandcamp Daily (9). No duplicate artist/title pairs, even after normalising
case, accents and punctuation.

## Recommendation logic (`engine.mjs`)

- `pairSimilarity`: Jaccard overlap weighted styles .45, traits .28,
  genres .15; score closeness weighted weirdness .06, intensity .04,
  accessibility .02.
- `recommend`: rating weights 1 → −3, 2 → −1.25, 3 → 0, 4 → +1.5, 5 → +3.
  Low ratings only penalise strong matches (similarity ≥ 0.35 with shared
  metadata). Modes are personalized / avoidance / discovery (a genre
  round-robin).
- Excludes heard records and `unresolved` records (`wire-121` or any
  non-integer score).
- `catalogOrder` is the tie-breaker: `list_number`, or `130 + <numeric part of id after 4 chars>` for `wmm-` records.

## Persistence

- `localStorage` key `weird-music-machine:v1`. Log shape
  `{version: 1, records: {id: {status, rating, heardAt, updatedAt}}, events, preference}`.
- `sanitizeLog` **drops any record or event whose id is not in the
  dataset**. Existing IDs must therefore never change, or users lose their
  ratings. New IDs simply start unheard.
- Export/import is plain JSON of the same log. A recovery backup is written
  to `weird-music-machine:v1:recovery` when a stored log fails to parse.
- Cross-tab sync via the `storage` event.

## Code that assumes exactly 250 records

| Location | Assumption | Effect if the corpus grows |
| --- | --- | --- |
| `app.mjs:290` | `dataset.length !== 250 \|\| new Set(ids).size !== 250` → throw | **Hard failure**: the site shows "The signal dropped." |
| `index.html:7` | meta description "250 releases…" | stale text |
| `index.html:14` | header `Archive <sup>250</sup>` | stale count |
| `index.html:15` | "250 RELEASES / MANY WAYS IN" | stale count |
| `index.html:20` | "250 releases outside the ordinary", index block `250` and its aria-label | stale count |
| `index.html:21` | `0 / 250 HEARD` (already overwritten by JS from `dataset.length`) | none |
| `index.html:41` | "250 releases. Keep looking." | stale count |
| `index.html:43` | tab `The archive <span>250</span>` | stale count |
| `index.html:90` | "The archive now holds 250 releases, with 120 additions … through The Wire, The Quietus and Bandcamp Daily." | stale counts and source list |
| `index.html:20` | intro note naming three publications | stale source list |
| `index.html:61` | "Curated by" filter: three hard-coded `<option>`s | new publications not filterable |
| `index.html:95` | footer "250 RELEASES" | stale count |

Not count-dependent (left unchanged):

- `catalogOrder`'s `130 + Number(id.slice(4))` is the fixed size of the Wire
  list, not the corpus size. It orders `wmm-0121` and above correctly after
  `wmm-0120`, provided new IDs keep the `wmm-NNNN` form.
- `catalogLabel` shows the id for records without `list_number`, which
  suits new records.
- `unresolved` hard-codes `wire-121`, a property of that one record.
