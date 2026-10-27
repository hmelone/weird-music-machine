"""Stage 5: record which eligible candidates were selected, why, and under which musical area.

The choices below are editorial: they were made by reading every eligible
candidate in research/02-dedupe-report.json against the owner's stated taste.
Selection rules:
  * never pick a record by one of the owner's representative artists (Swans,
    Cocteau Twins, Talk Talk, Unwound, Caribou/Daphni... appeared in the pool and were skipped);
  * prefer discoveries over very familiar canon, unless several lists cite a record;
  * prefer artists not already in the corpus;
  * spread picks across areas, eras and regions.
`also` merges citations from pool entries that name the same release under a
different artist string (for example a Bandcamp label account).

Writes research/03-selection.json.
usage: python3 tools/select_additions.py
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

AREAS = {
    'psych': 'Psychedelic and neo-psychedelic rock',
    'kraut': 'Krautrock, kosmische, space rock and motorik',
    'noise': 'Noise rock, post-punk, art rock and post-hardcore',
    'gaze': 'Shoegaze, dream pop, slowcore and textural guitar',
    'emo': 'Midwest emo and emo',
    'ambient': 'Ambient and experimental electronic',
    'beat': 'Beat-oriented electronic',
    'hiphop': 'Left-field and experimental hip-hop',
    'folk': 'Indie folk and unusual acoustic music',
    'modal': 'Modal, hypnotic, repetitive, drone and trance',
    'global': 'Global psychedelic and experimental traditions',
}

# candidate_id: (area, reason, also-merge candidate ids)
PICKS = {
    # Psychedelic and neo-psychedelic rock
    'cand-1308': ('psych', 'Japanese feedback-psych touchstone picked by Gnod\'s Paddy Shine; fills the noisy end of psych.', []),
    'cand-0377': ('psych', '1980 neo-psych guitar-pop landmark from Bandcamp Daily\'s \'80s neo-psych guide.', []),
    'cand-0426': ('psych', 'Swedish communal drone-psych from the "Nuggets" guide; a global, hypnotic take on psych rock.', []),
    'cand-0423': ('psych', 'Overdriven Japanese psych-noise power trio; sits between Kikagaku Moyo and Ty Segall\'s heavier side.', []),
    'cand-0465': ('psych', 'Philadelphia\'s heavy drone-psych institution, chosen from Bandcamp Daily\'s Philly psych history.', []),
    'cand-0463': ('psych', 'Philadelphia psych-folk ensemble; textural, modal and dreamy.', []),
    'cand-0362': ('psych', 'Motorik-leaning, repetitive modern psych from the psych concept-album guide.', []),
    'cand-0360': ('psych', 'Finnish "new wave of Finnish heavy metal"/kraut-psych band; repetitive and strange.', []),
    'cand-0648': ('psych', 'Swedish global-psych collective, ranked in The Quietus\' 2012 list.', []),
    'cand-0453': ('psych', 'Seattle space-rock/drone band from Bandcamp Daily\'s Cascadian psych history.', []),
    'cand-0643': ('psych', 'Japanese psych-noise band, ranked in The Quietus\' 2012 list.', []),
    'cand-1118': ('psych', 'Greek psych-prog double album chosen by Caribou\'s Dan Snaith.', []),
    'cand-1161': ('psych', 'Boredoms\' tribal psych-trance high point, chosen by black midi\'s Geordie Greep.', []),
    'cand-0654': ('psych', 'Psychedelic art-pop that topped The Quietus\' 2013 list.', []),
    # Krautrock, kosmische, space rock and motorik
    'cand-1274': ('kraut', 'Kosmische classic chosen by Michael Rother; the corpus has Cluster\'s debut but not this one.', []),
    'cand-1275': ('kraut', 'Kraftwerk\'s pre-Autobahn record, chosen by former Kraftwerk member Michael Rother.', []),
    'cand-1192': ('kraut', 'Can\'s shelved first album, chosen by Spiritualized\'s Jason Pierce; Can are not yet in the corpus.', []),
    'cand-1062': ('kraut', 'One-take sequencer-and-guitar improvisation bridging kosmische and techno; chosen by Ride\'s Andy Bell.', []),
    'cand-0316': ('kraut', 'Obscure kosmische record from Bandcamp Daily\'s krautrock rarities guide.', []),
    'cand-0128': ('kraut', 'Tim Gane\'s post-Stereolab motorik project, from the krautrock-legacy feature.', []),
    'cand-1279': ('kraut', 'Motorik electronic noise chosen by Michael Rother.', []),
    'cand-0657': ('kraut', 'Hypnotic, motorik post-punk electronics, ranked in The Quietus\' 2013 list.', []),
    'cand-0873': ('kraut', 'Gnod\'s long-form kraut/drone record, ranked in The Quietus\' 2015 list.', []),
    'cand-0954': ('kraut', 'Polish kraut-jazz-psych ensemble, ranked third in The Quietus\' 2016 list.', []),
    'cand-1107': ('kraut', 'Stereolab\'s motorik/space-age pop peak, chosen by Deerhunter\'s Bradford Cox.', []),
    'cand-1053': ('kraut', 'Drone-led space rock chosen by Ride\'s Andy Bell.', []),
    'cand-0618': ('kraut', 'Single-pulse, motorik long-form guitar piece, ranked in The Quietus\' 2012 list.', []),
    # Noise rock, post-punk, art rock and post-hardcore
    'cand-0109': ('noise', 'St. Louis noise-rock record from Bandcamp Daily\'s math-rock guide.', []),
    'cand-0107': ('noise', 'Richmond noise-rock/math-rock touchstone from the same guide.', []),
    'cand-1230': ('noise', 'Absurdist Midwest noise/post-hardcore oddity chosen by Liars\' Angus Andrew.', []),
    'cand-1109': ('noise', 'Ian Williams\' (Don Caballero, Battles) free-form art-rock, chosen by Bradford Cox.', []),
    'cand-1080': ('noise', 'No-wave guitar noise chosen by Ben Chasny.', []),
    'cand-1313': ('noise', 'Post-punk/art-rock landmark chosen by Gnod\'s Paddy Shine.', []),
    'cand-1112': ('noise', 'The Fall\'s hypnotic two-drummer post-punk, chosen by Bradford Cox.', []),
    'cand-0067': ('noise', 'Melbourne garage/post-punk from Bandcamp Daily\'s Australian post-punk guide.', []),
    'cand-0879': ('noise', 'UK heavy noise/psych rock, ranked in The Quietus\' 2015 list.', []),
    'cand-0974': ('noise', 'Noise-psych supergroup, ranked in The Quietus\' 2016 list.', []),
    'cand-0952': ('noise', 'Norwegian noise/art rock that topped The Quietus\' 2016 list.', []),
    'cand-0529': ('noise', 'Slow, heavy noise-rock from Bandcamp Daily\'s slowcore timeline.', []),
    # Shoegaze, dream pop, slowcore and textural guitar
    'cand-1367': ('gaze', 'Proto-shoegaze dub-noise chosen by Slowdive\'s Neil Halstead.', []),
    'cand-1358': ('gaze', '4AD ambient post-punk chosen by Cocteau Twins\' Simon Raymonde.', []),
    'cand-0095': ('gaze', 'Bristol "rural psychedelia" shoegaze from Bandcamp Daily\'s Bristol feature.', []),
    'cand-0094': ('gaze', 'Bristol slowcore/dream band from the same feature.', []),
    'cand-0512': ('gaze', 'New Zealand noise-pop/shoegaze from Bandcamp Daily\'s rare-shoegaze guide.', []),
    'cand-0511': ('gaze', 'Lo-fi bedroom shoegaze from the rare-shoegaze guide.', []),
    'cand-0503': ('gaze', 'Montreal noise-pop/shoegaze from the rare-shoegaze guide.', []),
    'cand-0500': ('gaze', 'Ambient-shoegaze guitar loops from the rare-shoegaze guide.', []),
    'cand-0518': ('gaze', 'Texan slowcore close to The American Analog Set, from the slowcore timeline.', []),
    'cand-0560': ('gaze', 'Yorkshire post-rock/folk-drift from Bandcamp Daily\'s UK post-rock history.', []),
    'cand-0565': ('gaze', 'Birmingham art-pop/post-rock from the same history.', []),
    # Midwest emo and emo
    'cand-0207': ('emo', 'Tim Kinsella\'s experimental Chicago emo, from "Emo\'s Greatest Second Acts".', []),
    'cand-0246': ('emo', 'The Midwest emo reference point, from "Football and Emo".', []),
    'cand-0212': ('emo', 'Jawbreaker/Texas Is the Reason members\' second act, from the same guide.', []),
    'cand-0247': ('emo', 'Chinese math-emo from "Football and Emo"; a global take on Midwest emo.', []),
    'cand-0231': ('emo', 'Fifth-wave emo with folk and noise, from Bandcamp Daily\'s new-emo guide.', []),
    'cand-0226': ('emo', 'Detroit post-hardcore-leaning emo from the same guide.', []),
    'cand-0227': ('emo', 'Genre-hopping, strange emo from the same guide.', []),
    # Ambient and experimental electronic
    'cand-1218': ('ambient', 'Ambient record chosen by Laraaji and also featured in Bandcamp Daily\'s \'90s ambient guide.', ['cand-0001']),
    'cand-1217': ('ambient', 'Tribal-ambient touchstone chosen by Laraaji.', []),
    'cand-1294': ('ambient', 'Soviet electronic composer chosen by Oneohtrix Point Never.', []),
    'cand-1346': ('ambient', 'Electroacoustic desert soundscapes chosen by Loop\'s Robert Hampson.', []),
    'cand-1344': ('ambient', 'Field-recording landmark chosen by Robert Hampson.', []),
    'cand-0297': ('ambient', 'Japanese environmental music from Bandcamp Daily\'s kankyō ongaku guide.', []),
    'cand-0195': ('ambient', 'Long-string drone instrument from the drone-composition guide.', []),
    'cand-0194': ('ambient', 'Pioneering algorithmic electronic music from the drone-composition guide.', []),
    'cand-0173': ('ambient', 'Organ-and-electronics ambient from the contemporary-ambient survey.', []),
    'cand-1323': ('ambient', 'Dub-techno-ambient chosen by Panda Bear.', []),
    'cand-0959': ('ambient', 'Tape-decay choral ambient, ranked in The Quietus\' 2016 list.', []),
    'cand-0980': ('ambient', 'Ambient/dub-techno, ranked in The Quietus\' 2016 list.', []),
    'cand-0668': ('ambient', 'Synthetic "folk music of imaginary species", ranked in The Quietus\' 2013 list.', []),
    'cand-0892': ('ambient', 'Hypnotic sax, synth and electronics duo, ranked in The Quietus\' 2015 list.', []),
    # Beat-oriented electronic
    'cand-1055': ('beat', 'Deep house foundation chosen by Andy Bell.', []),
    'cand-1061': ('beat', 'Detroit deep house chosen by Andy Bell.', []),
    'cand-0663': ('beat', 'Footwork originator, ranked tenth in The Quietus\' 2013 list.', []),
    'cand-0252': ('beat', 'Dark, experimental footwork from Bandcamp Daily\'s footwork guide.', []),
    'cand-0606': ('beat', 'Slowed, murky techno, ranked in The Quietus\' 2012 list.', []),
    'cand-0784': ('beat', 'Pointillist trance deconstruction, ranked in The Quietus\' 2014 list.', []),
    'cand-0471': ('beat', 'Glasgow post-punk dance band, from Bandcamp Daily\'s post-punk dance list.', []),
    'cand-1320': ('beat', 'Noise-electronic collage close to Animal Collective, chosen by Panda Bear.', []),
    'cand-0325': ('beat', 'Glitch/microhouse built from jazz samples, from the microhouse guide.', []),
    'cand-0858': ('beat', 'Cairo electro-shaabi keyboard trance, ranked in The Quietus\' 2015 list.', []),
    # Left-field and experimental hip-hop
    'cand-0536': ('hiphop', 'Noise-rap landmark from Bandcamp Daily\'s noise-rap list.', []),
    'cand-0540': ('hiphop', 'Avant-garde rap/noise outlier from the same list.', []),
    'cand-1240': ('hiphop', 'Kool Keith\'s sci-fi rap, chosen by Liars\' Angus Andrew.', []),
    'cand-1072': ('hiphop', 'Psychedelic rock-rap, chosen by Andrew Falkous.', []),
    'cand-1101': ('hiphop', 'Underground rap chosen by Billy Woods.', []),
    'cand-0046': ('hiphop', 'Abstract rap from Bandcamp Daily\'s art-rap guide.', []),
    'cand-0825': ('hiphop', 'Philosophical, lo-fi rap, ranked in The Quietus\' 2014 list.', []),
    'cand-0277': ('hiphop', 'Sci-fi concept rap from the hip-hop concept-album list.', []),
    # Indie folk and unusual acoustic music
    'cand-1079': ('folk', 'Abstract solo guitar chosen by Ben Chasny.', []),
    'cand-0039': ('folk', 'American primitive guitar from Bandcamp Daily\'s guide.', []),
    'cand-0398': ('folk', 'Welsh fingerstyle guitar from the British solo acoustic guitar primer.', []),
    'cand-0178': ('folk', 'Drone-folk guitar from "The New Psychedelia".', []),
    'cand-1142': ('folk', 'Unaccompanied British folk chosen by Earth\'s Dylan Carlson.', []),
    'cand-0383': ('folk', 'Japanese chamber folk from Bandcamp Daily\'s chamber-folk guide.', []),
    'cand-0956': ('folk', 'English folk comeback, ranked fifth in The Quietus\' 2016 list.', []),
    'cand-0291': ('folk', 'Japanese experimental folk from the Japanese acid-folk guide.', []),
    'cand-0292': ('folk', 'Japanese psych-folk duo from the same guide.', []),
    'cand-0295': ('folk', 'Japanese acid folk from the same guide.', []),
    'cand-0189': ('folk', 'Bristol hypnotic chamber folk from "The New Psychedelia".', []),
    'cand-0871': ('folk', 'Medieval-inflected drone fiddle and recorder, ranked in The Quietus\' 2015 list.', []),
    'cand-1207': ('folk', 'Looped, hypnotic Argentine folktronica chosen by Laetitia Sadier.', []),
    'cand-0888': ('folk', 'Polish folk-ambient cited by two sources (Paddy Shine and The Quietus\' 2015 list).', []),
    # Modal, hypnotic, repetitive, drone and trance
    'cand-1301': ('modal', 'Terry Riley\'s modal keyboard loops, chosen by Oneohtrix Point Never.', []),
    'cand-1332': ('modal', 'Tape-loop drone duet chosen by Richard Pinhas.', []),
    'cand-1124': ('modal', 'Ethiopian nun\'s solo piano, chosen by Dan Snaith (Jason Pierce chose a different release by her).', []),
    'cand-1120': ('modal', 'Modal spiritual jazz chosen by Dan Snaith.', []),
    'cand-0333': ('modal', 'Just-intonation drone piano from the minimalism guide.', []),
    'cand-0335': ('modal', 'Proto-minimalist piano work from the minimalism guide.', []),
    'cand-1083': ('modal', 'Free-modal shruti box and drums duo chosen by Ben Chasny.', []),
    'cand-0649': ('modal', 'Ecstatic drum-led psych-drone, ranked in The Quietus\' 2012 list.', []),
    # Global psychedelic and experimental traditions
    'cand-1306': ('global', 'Moroccan Amazigh lotar music chosen by Paddy Shine.', []),
    'cand-1244': ('global', 'Malian singer chosen by Mdou Moctar.', []),
    'cand-0703': ('global', 'Tuareg desert rock, ranked in The Quietus\' 2013 list.', []),
    'cand-0819': ('global', 'Mauritanian griot psych, ranked in The Quietus\' 2014 list.', []),
    'cand-1337': ('global', 'Senegalese sabar drumming meets Berlin dub-techno; chosen by Richard Pinhas.', []),
    'cand-0854': ('global', 'Kinshasa street-psych band, ranked third in The Quietus\' 2015 list.', []),
    'cand-0042': ('global', 'Turkish psych from Bandcamp Daily\'s Anatolian rock guide.', []),
    'cand-0145': ('global', 'Peruvian chicha psych from the chicha guide.', []),
    'cand-0987': ('global', 'Korean gugak post-rock, ranked in The Quietus\' 2016 list.', []),
    'cand-0342': ('global', 'Japanese minyō-meets-cumbia band from the minyō guide.', []),
    'cand-1063': ('global', 'Psychedelic African dub, chosen by Andy Bell.', []),
    'cand-1208': ('global', 'Belgian art-pop/collage chosen by Laetitia Sadier.', []),
}

pool = {c['candidate_id']: c for c in json.loads((ROOT / 'research/01-candidate-pool.json').read_text())['candidates']}
dedupe = {r['candidate_id']: r for r in json.loads((ROOT / 'research/02-dedupe-report.json').read_text())['results']}

selection = []
for cid, (area, reason, also) in PICKS.items():
    assert dedupe[cid]['status'] == 'eligible', cid
    c = pool[cid]
    citations = list(c['citations'])
    for other in also:
        for cit in pool[other]['citations']:
            if not any(x['url'] == cit['url'] for x in citations): citations.append({**cit, 'merged_from': other})
    selection.append({'candidate_id': cid, 'artist_in_source': c['artist'], 'title_in_source': c['title'], 'area': area, 'area_label': AREAS[area], 'reason': reason, 'merged_candidates': also, 'artist_in_corpus': dedupe[cid]['tier'] == 'artist_in_corpus', 'citations': citations, 'source_hints': c['source_hints']})

counts = {AREAS[a]: sum(s['area'] == a for s in selection) for a in AREAS}
(ROOT / 'research/03-selection.json').write_text(json.dumps({'summary': {'selected': len(selection), 'by_area': counts}, 'rules': __doc__.strip().splitlines()[5:12], 'selection': selection}, indent=1, ensure_ascii=False) + '\n')
print(len(selection)); print(json.dumps(counts, indent=1))
