# Discovery pathways, preferences and notes

How the discovery features work. The pathway rules live in `engine.mjs` (`PATHWAYS`), and the counts below were generated from the 370-record corpus.

## Discovery pathways

A record joins a pathway when it satisfies any one of the pathway's rules. Terms come only from the corpus's existing genres, styles and traits, and ranges use its 1–5 scores. A record with an unresolved score never passes a range. A pathway with fewer than 12 matches (`PATHWAY_MIN`) would be labelled thin rather than padded; none currently are. A pathway works as an archive filter, so it also applies to Surprise Me and The Machine Says.

| Pathway | Group | Recipe | Records | Original / added |
| --- | --- | --- | --- | --- |
| Psychedelic Journey | Moods | psychedelic / psychedelic rock / psychedelic folk / psychedelic pop / neo-psychedelia / space rock + weirdness 3–5 | 59 | 11 / 48 |
| Hazy & Beautiful | Moods | dream pop / shoegaze / slowcore / noise pop + intensity 1–3 — or — atmospheric + melodic + intensity 1–3 | 28 | 5 / 23 |
| Something Hypnotic | Moods | at least 2 of hypnotic / repetitive / minimalism / drone / krautrock | 61 | 10 / 51 |
| Calm Weirdness | Moods | weirdness 4–5 + intensity 1–2 | 47 | 11 / 36 |
| Pretty but Strange | Moods | melodic + weirdness 3–5 + intensity 1–3 + accessibility 3–5 | 53 | 14 / 39 |
| Ambient & Spacious | Textures | ambient / drone / environmental music / tribal ambient / fourth world / field recording composition + intensity 1–2 | 33 | 4 / 29 |
| Shoegaze & Textural | Textures | shoegaze / dream pop / noise pop / post-rock | 17 | 3 / 14 |
| Noisy & Angular | Textures | noise rock / post-punk / math rock / no wave / art punk / post-hardcore + abrasive / dissonant / noisy / raw / chaotic | 33 | 13 / 20 |
| Make It Noisy | Textures | noisy / abrasive / noise + intensity 4–5 | 59 | 18 / 41 |
| Electronic & Beat-Driven | Scenes | electronic + danceable / rhythmic / percussive | 65 | 15 / 50 |
| Weird Hip-Hop | Scenes | hip hop + weirdness 3–5 | 19 | 1 / 18 |
| Post-Punk / Post-Hardcore | Scenes | post-punk / post-hardcore / art punk / no wave | 21 | 9 / 12 |
| Motorik Forever | Scenes | krautrock + repetitive / rhythmic / hypnotic | 15 | 0 / 15 | The corpus has no "motorik" tag; this uses krautrock records that are also repetitive, rhythmic or hypnotic.

**Weakest support.** Motorik Forever (15), Shoegaze & Textural (17) and Weird Hip-Hop (19) are the smallest pathways. Almost all of their records are recent additions, because the original Wire collection has little shoegaze, hip-hop or krautrock-with-pulse. Motorik isn't a tag in the corpus, so that pathway uses a documented stand-in. Hazy & Beautiful matched only 9 records on dreamy styles alone; a second rule (atmospheric + melodic at low intensity) brings it to 28 without inventing metadata.

## Preferences for Surprise Me

Preferences are an optional way to tune random picks, and nothing else.

* **Set them at the top of the page.** Under the intro, **Set preferences** opens four quick questions. Once saved, the answers show there, labelled, with **Edit** and **Reset**, plus a line saying whether random picks are using them.
* **Choose per random pick.** The homepage's random "open door" pick and **Surprise Me** each have a **Pick from** choice: **Anything** (the default) or **My preferences**. They share one setting, so changing either changes both. Choosing My preferences before any are saved opens the questions; Cancel leaves it on Anything. Saving preferences switches random picks to them. Switching back to Anything keeps the answers for later. Reset clears them and returns to Anything.
* Once you have 4- or 5-star ratings, the homepage shows a connection from your ratings instead of a random pick, so its Pick from choice is hidden. Surprise Me keeps its choice.

The Machine Says (the rating-based recommendations) and the archive never use preferences. The weirdness level comes from the selector above, so the survey doesn't ask for it again.

The answers and the setting are stored in the existing listening log (`localStorage` key `weird-music-machine:v1`, fields `survey` and `surpriseMode`), so export, import and cross-tab sync carry them. Each answer is checked against the corpus vocabulary when it loads.

| Answer | What it does |
| --- | --- |
| What are you looking for? | Each mood maps to existing terms (`SURVEY_MOODS`). "Guitar-heavy" uses guitar-led styles as a stand-in, since guitar isn't tagged. "Surprise me" adds no terms. |
| What kind of energy? | Calm = intensity 1–2, middle = 2–4, intense = 4–5. Records outside the range are left out. |
| More of | Adds terms (any trait; genres and styles with at least 5 records). |
| Less of | Records with any of these terms are left out. |

A record fits (`tunedMatch` in `engine.mjs`) when it has at least one wanted term, or any record if you chose no moods or sounds. It must also be within the energy range and carry none of the terms you want less of. If nothing fits at the current setting, Surprise Me says so and suggests another level or Anything.

## Added in this edition

A record belongs to the original collection when it has a `list_group` (The Wire's original 100 and its 30 runners-up, IDs `wire-001` to `wire-130`). Every other record (`wmm-0001` onward) counts as added. The Edition filter computes this from the data.

## Personal notes

A note is stored on its record's log entry (`note`, `noteUpdatedAt`), up to 500 characters. Adding, editing or deleting a note never changes status, rating or activity history, and status changes keep the note. Notes are included in the exported log. Import merges entry by entry, so a local note survives an imported file that lacks one. Logs saved before notes existed load unchanged.
