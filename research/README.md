# How the additions were chosen

Everything here is intermediate research for the corpus expansion, kept so
the selections can be reviewed. Files are numbered in pipeline order.

| File | Stage | What it is |
| --- | --- | --- |
| `00-inspection.md` | 1 | The project, schema, logic and 250-record assumptions as found |
| `baseline-250-fingerprints.json`, `baseline-vocabulary.json` | 1 | Snapshot of the original corpus (tests compare against it) |
| `candidates/*.json` | 3 | One file per curated source: every pick, exactly as extracted, in source order |
| `01-candidate-pool.json` | 3 | All picks merged into candidates; each keeps every list that named it |
| `02-dedupe-report.json` | 4 | Candidates checked against the existing 250 records |
| `03-selection.json` | 5 | The chosen additions and the reasoning per musical area |
| `enrichment/*.json` | 6 | MusicBrainz matches and labels, Wikipedia infoboxes, query overrides |
| `04-enriched-additions.json` | 6 | The 120 researched records (corpus schema) plus per-record evidence |
| `05-validation-report.md` | 8 | Final counts, rejections, manual-review list, new vocabulary |

## Stage 3 — building the candidate pool

**Rule:** every candidate comes from a curated list that was fetched and
parsed. Nothing was proposed from memory and then backed up with a source.
Picks the parser could not tie to one specific release are kept, flagged
`not a specific release`, and never selected.

### Sources used

1. **The Quietus — Baker's Dozen** (artist-curated favourite records; 26 lists, 337 picks).
   The full index of 624 Baker's Dozens was crawled (`tools/research/bd_index.py`).
   Lists were chosen by matching their URL slugs against the representative
   artists you named and artists adjacent to each area of your taste
   (`tools/research/bakers-dozen-keywords.txt`). From those matches, 26 lists
   were kept to cover the areas: Panda Bear, Dan Snaith (Caribou), Gold Panda,
   Michael Gira (Swans), Simon Raymonde (Cocteau Twins), Michael Rother,
   Irmin Schmidt (Can), Richard Pinhas, Nik Turner (Hawkwind), Robert
   Hampson (Loop), Jason Pierce, Paddy Shine (Gnod), Neil Halstead
   (Slowdive), Andy Bell (Ride), Ben Chasny, Bradford Cox, Angus Andrew
   (Liars), Andrew Falkous, David Pajo, Billy Woods, Laraaji, Mdou Moctar,
   Geordie Greep, Oneohtrix Point Never, Dylan Carlson and Laetitia Sadier.
   Baker's Dozens are numbered for presentation, not ranked, so `rank` is
   `null` and the number is kept as `position`.
2. **Bandcamp Daily — lists and scene guides** (64 lists, ~580 picks).
   The lists index (840 lists) was crawled. Multi-artist genre and scene
   guides covering your areas were kept; single-artist discography guides
   were skipped so no one act dominates. Bandcamp Daily lists are unranked.
3. **The Quietus — Albums of the Year 2012–2016** (ranked year-end lists;
   475 picks). The baseline already cites the 2017–2025 lists. The earlier
   years add ranked provenance.

### Sources considered and not used

| Source | Why not |
| --- | --- |
| Pitchfork | Its robots.txt blocks Anthropic's user-directed agent (`Claude-User`). A page fetched before that was noticed was discarded unused. |
| The Wire | Its robots.txt blocks `Claude-User`, `ClaudeBot` and `Claude-SearchBot`. The baseline's existing Wire citations are untouched. |
| Julian Cope, *Krautrocksampler* / *Japrocksampler* top 50s | Wikipedia does not reproduce the lists. Its pointer is a Discogs list, and Discogs refuses automated requests. |
| Discogs, AllMusic | Refuse automated requests (HTTP 403). |
| Internet Archive | Timed out from this environment. |

All fetches identify honestly as `Claude-User`; browser user agents were not
used to get past access controls.

## Stage 4 — deduplication

`tools/dedupe_candidates.py` compares every candidate with the original 250 in
three tiers: exact (normalised case, accents, punctuation, "The", "&"),
edition-insensitive (bracketed text and remaster/deluxe/OST/etc. removed) and
fuzzy (same artist, at least 0.85 title similarity, or one title containing
the other). It also catches alternate spellings within the pool. Different
records by artists already in the corpus stay eligible but are flagged.

## Stage 5 — selection

`tools/select_additions.py` holds every pick with its area and reason. It
never picks records by your representative artists. It prefers discoveries
and new artists over familiar canon, unless several lists cite a record, and
it spreads picks across eleven areas.

## Stage 6 — research and enrichment

* **Identity, year, type:** MusicBrainz release groups (`tools/research/mb_lookup.py`),
  at one request per second. Every automatic match was checked by eye. Wrong
  matches were re-queried (`enrichment/mb_overrides.json`) or resolved by
  browsing the artist's discography. Records with no verifiable release were
  rejected, never guessed.
* **Label:** the first-year release in the artist's own country
  (`tools/research/mb_labels.py`). Other first-year labels go in the notes.
* **Genre and style:** the curator's own text about the record, plus
  MusicBrainz genres and tags and Wikipedia's infobox
  (`tools/research/wiki_lookup.py`, which reads `/wiki/...?action=raw`; robots.txt disallows `/w/`).
* **Classification** (`tools/classify_additions.py`) uses only the existing 27
  traits and 26 genres. New style terms are listed in the validation report.
* **Scores** follow the existing corpus's calibration. For weirdness, 2 means
  song-based or conventional within this corpus (e.g. King Sunny Adé, Bad
  Brains), 3 strange but approachable, 4 far out, and 5 extreme (e.g. The
  Dead C, Cluster's debut). Accessibility runs from 1 (difficult entry) to 5
  (immediate).
* **Uncertainty** stays in `research_notes`. Anything a person should confirm
  carries a `Manual review:` note, which the site's existing
  `engine.manualReview` recognises.
* **Bandcamp release pages** were tried but not used. After a few requests
  Bandcamp served a bot challenge, which was respected. The links the
  curators gave are kept in `source_notes`.

## Stages 7 and 8 — merge and validation

`tools/merge_additions.py` appends the records only after verifying the
original 250 against their fingerprints. It writes the file in its existing
format, so the original records are byte-for-byte unchanged.
`tools/validate_corpus.py` regenerates `05-validation-report.md`. `npm test`
runs the corpus, engine and browser tests.
