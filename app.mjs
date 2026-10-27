import {STORAGE_KEY, BANDS, BAND_LABELS, entryFor, loadLog, saveLog, sanitizeLog, updateRecord, filterRecords, sortRecords, recommend, explanation, surprise, tasteProfile, unresolved, PATHWAYS, PATHWAY_GROUPS, PATHWAY_MIN, pathwayMatches, isOriginal, SURVEY_MOODS, SURVEY_ENERGY, sanitizeSurvey, activeSurvey} from './engine.mjs';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const labelCase = text => text ? text[0].toUpperCase() + text.slice(1) : '';
const catalogLabel = record => record.list_number !== null ? 'WIRE / ' + String(record.list_number).padStart(3, '0') : record.id.toUpperCase();
const provenanceLabel = record => record.list_group ? record.list_group.toUpperCase() : [...new Set((record.curation_sources || []).map(s => s.publication))].join(' / ').toUpperCase();
const sourceCount = record => (record.curation_sources || []).length;
const publicationCount = record => new Set((record.curation_sources || []).map(s => s.publication)).size;
// One-line "why it's here" for cards: the first curated source, its rank if it has one, and how many more.
function sourceLine(record) {
  const sources = record.curation_sources || [];
  if (!sources.length) return '';
  const first = sources[0], more = sources.length - 1;
  return 'Via ' + first.publication + ' — ' + first.list_title + (first.rank !== null ? ' · No. ' + first.rank : '') + (more ? ' · +' + more + ' more source' + (more === 1 ? '' : 's') : '');
}
const editionLabel = record => isOriginal(record) ? 'Original collection · ' + (record.list_group === 'runner-up' ? 'Wire runner-up' : 'Wire original 100') : 'Added in this edition';
const releaseTypeLabel = record => record.release_type && record.release_type !== 'unknown' ? labelCase(record.release_type) : 'Release type unresolved';
const statusOptions = ['unheard', 'want to hear', 'heard'];
const rangeText = ([min, max]) => min === max ? String(min) : min + '–' + max;
// Plain-language recipe for a pathway, built from its rules so the tile shows exactly what it uses.
export function pathwayRecipe(pathway) {
  return pathway.rules.map(rule => {
    const parts = [];
    if (rule.any) { const terms = Object.values(rule.any).flat(); parts.push((rule.min > 1 ? 'at least ' + rule.min + ' of ' : '') + terms.join(' / ')); }
    for (const group of rule.all || []) parts.push(Object.values(group).flat().join(' / '));
    for (const [field, range] of Object.entries(rule.ranges || {})) parts.push(field + ' ' + rangeText(range));
    return parts.join(' + ');
  }).join(' — or — ');
}
const dateLabel = (value, time = false) => value ? new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', ...(time ? {hour:'numeric',minute:'2-digit'} : {})}).format(new Date(value)) : 'Date not recorded';

// Visible corpus counts come from the loaded dataset; the numbers in index.html are only no-script fallbacks.
export function renderCorpusCounts(doc, dataset, publications) {
  const additions = dataset.filter(r => !r.list_group);
  const years = additions.map(r => r.year).filter(Number.isInteger);
  const values = {records: String(dataset.length), original: String(dataset.length - additions.length), additions: String(additions.length), 'addition-years': years.length ? Math.min(...years) + '–' + Math.max(...years) : ''};
  for (const node of doc.querySelectorAll('[data-count]')) if (Object.hasOwn(values, node.dataset.count)) node.textContent = values[node.dataset.count];
  for (const node of doc.querySelectorAll('[data-count-label]')) node.setAttribute('aria-label', dataset.length + ' ' + node.dataset.countLabel);
  const named = publications.length > 4 ? [...publications.slice(0,3), (publications.length - 3) + ' other publications'] : publications;
  const list = typeof Intl.ListFormat === 'function' ? new Intl.ListFormat('en', {style:'long', type:'conjunction'}).format(named) : named.join(', ');
  for (const node of doc.querySelectorAll('[data-publications]')) node.textContent = list.replace(', and ', ' and ');
  const meta = doc.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', meta.getAttribute('content').replace(/^\d+ releases/, dataset.length + ' releases'));
}

export function createApp({dataset, doc, storage, now = () => new Date().toISOString(), random = Math.random}) {
  const win = doc.defaultView;
  const $ = selector => doc.querySelector(selector);
  const lookup = new Map(dataset.map(r => [r.id, r]));
  const loaded = loadLog(storage, dataset);
  let log = loaded.log, undoSnapshot = null, timer = null, view = 'collection', historyMode = 'heard', limit = 24, activityLimit = 30, modalId = null, modalKicker = 'RECORD NOTES', lastOpener = null;
  let needsRecoveryBackup = !!loaded.error;
  let filters = {}, order = 'list', currentResults = [];
  let featureId = null, featureMode = null, featurePoolKey = '', genresExpanded = false, threadTab = 'moods';
  if (['collection', 'recommendations', 'history', 'profile'].includes(win.location.hash.slice(1))) view = win.location.hash.slice(1);

  function warning(message) { $('#storage-warning').textContent = message; $('#storage-warning').hidden = !message; }
  if (loaded.error) warning(loaded.error);

  function persist() {
    if (needsRecoveryBackup) {
      try { const raw = storage.getItem(STORAGE_KEY); if (raw) storage.setItem(STORAGE_KEY + ':recovery', raw); needsRecoveryBackup = false; }
      catch { warning('Browser storage is unavailable. Your changes work in this session; export your log to keep them.'); $('#save-status').textContent = 'NOT SAVED · EXPORT YOUR LOG'; return false; }
    }
    const ok = saveLog(storage, log);
    $('#save-status').textContent = ok ? 'SAVED ON THIS BROWSER' : 'NOT SAVED · EXPORT YOUR LOG';
    warning(ok ? '' : 'Browser storage is unavailable or full. Your changes work in this session; export your log to keep them.');
    return ok;
  }
  function toast(message, previous = null) {
    if (timer) win.clearTimeout(timer);
    undoSnapshot = previous; $('#toast-message').textContent = message; $('#undo').hidden = !previous; $('#toast').hidden = false;
    timer = win.setTimeout(() => { $('#toast').hidden = true; undoSnapshot = null; }, 9500);
  }
  function options(values, first) { return '<option value="">' + first + '</option>' + values.map(value => '<option value="' + escapeHTML(value) + '">' + escapeHTML(labelCase(value)) + '</option>').join(''); }
  for (const [key, field] of [['genre','genres'],['style','styles'],['trait','traits']]) $('#filter-' + key).innerHTML = options([...new Set(dataset.flatMap(r => r[field]))].sort((a,b) => a.localeCompare(b)), 'Any ' + key);
  if ($('#filter-release_type')) $('#filter-release_type').innerHTML = options([...new Set(dataset.map(r => r.release_type).filter(Boolean))].sort(), 'All release types');
  const decades = [...new Set(dataset.filter(r => Number.isInteger(r.year)).map(r => Math.floor(r.year / 10) * 10))].sort((a,b) => a-b);
  $('#filter-decade').innerHTML = '<option value="">Every decade</option>' + decades.map(d => '<option value="' + d + '">' + d + 's</option>').join('') + '<option value="unknown">Unpublished / unknown</option>';
  const publicationCounts = new Map();
  for (const record of dataset) for (const publication of new Set((record.curation_sources || []).map(s => s.publication))) publicationCounts.set(publication, (publicationCounts.get(publication) || 0) + 1);
  const publications = [...publicationCounts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([publication]) => publication);
  if ($('#filter-publication')) $('#filter-publication').innerHTML = '<option value="">All publications</option>' + publications.map(p => '<option value="' + escapeHTML(p) + '">' + escapeHTML(p) + '</option>').join('');
  renderCorpusCounts(doc, dataset, publications);
  const originalCount = dataset.filter(isOriginal).length;
  if ($('#filter-edition')) $('#filter-edition').innerHTML = '<option value="">All editions</option><option value="original">Original collection (' + originalCount + ')</option><option value="added">Added in this edition (' + (dataset.length - originalCount) + ')</option>';

  const genreCounts = new Map();
  for (const record of dataset) for (const genre of new Set(record.genres)) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
  const genreThreads = [...genreCounts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
  const pathwayCounts = new Map(PATHWAYS.map(p => [p.id, dataset.filter(r => pathwayMatches(r, p)).length]));
  function renderThreads() {
    const root = $('#thread-panel');
    if (!root) return;
    for (const tab of doc.querySelectorAll('[data-thread-tab]')) { const active = tab.dataset.threadTab === threadTab; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
    root.setAttribute('aria-labelledby', 'thread-tab-' + threadTab);
    if (threadTab === 'genres') {
      root.innerHTML = (genresExpanded ? genreThreads : genreThreads.slice(0,6)).map(([genre,count],index) => '<button type="button" data-genre-thread="' + escapeHTML(genre) + '"><span class="thread-label">GENRE / ' + String(index+1).padStart(2,'0') + '</span><strong>' + escapeHTML(genre.toUpperCase()) + '</strong><span class="thread-count">' + count + ' RELEASE' + (count===1 ? '' : 'S') + '</span><span class="thread-arrow" aria-hidden="true">↗</span></button>').join('');
      $('#toggle-genres').setAttribute('aria-expanded',String(genresExpanded));
      $('#toggle-genres').textContent = genresExpanded ? 'SHOW FEWER GENRES −' : 'VIEW ALL ' + genreThreads.length + ' GENRES +';
      $('#toggle-genres').hidden = genreThreads.length <= 6;
      return;
    }
    $('#toggle-genres').hidden = true;
    const group = PATHWAY_GROUPS.find(([key]) => key === threadTab)[1];
    root.innerHTML = PATHWAYS.filter(p => p.group === threadTab).map(p => { const count = pathwayCounts.get(p.id); return '<button type="button" class="pathway-tile" data-pathway="' + p.id + '"><span class="thread-label">PATHWAY / ' + escapeHTML(group.toUpperCase()) + '</span><strong>' + escapeHTML(p.label.toUpperCase()) + '</strong><span class="thread-count">' + count + ' RELEASE' + (count===1 ? '' : 'S') + (count < PATHWAY_MIN ? ' · THIN' : '') + '</span><span class="thread-recipe">' + escapeHTML(pathwayRecipe(p)) + '</span><span class="thread-arrow" aria-hidden="true">↗</span></button>'; }).join('');
  }
  renderThreads();
  function renderPathwayBanner() {
    const banner = $('#pathway-banner'), pathway = PATHWAYS.find(p => p.id === filters.pathway);
    banner.hidden = !pathway;
    if (!pathway) { banner.innerHTML = ''; return; }
    banner.innerHTML = '<div><span class="eyebrow">PATHWAY</span><strong>' + escapeHTML(pathway.label) + '</strong><p>Built from: ' + escapeHTML(pathwayRecipe(pathway)) + '.' + (pathway.note ? ' ' + escapeHTML(pathway.note) : '') + '</p></div><button type="button" id="clear-pathway">Clear pathway ×</button>';
  }

  // --- preference survey: optional, local, and only a starting point for recommendations
  const vocabCounts = field => { const m = new Map(); for (const r of dataset) for (const v of new Set(r[field])) m.set(v, (m.get(v) || 0) + 1); return [...m].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])); };
  const surveyTerms = {traits: vocabCounts('traits').map(([t]) => t), genres: vocabCounts('genres').filter(([,n]) => n >= 5).map(([t]) => t), styles: vocabCounts('styles').filter(([,n]) => n >= 5).map(([t]) => t)};
  const surveySummary = survey => [survey.looking.map(m => SURVEY_MOODS[m].label).join(', ') || 'Open to anything', BAND_LABELS[survey.strangeness].split(' · ')[0], SURVEY_ENERGY[survey.energy].label.toLowerCase(), survey.more.length ? 'more ' + survey.more.slice(0,3).join(', ') + (survey.more.length > 3 ? '…' : '') : '', survey.less.length ? 'less ' + survey.less.slice(0,3).join(', ') + (survey.less.length > 3 ? '…' : '') : ''].filter(Boolean).join(' · ');
  function renderSurveyStrip() {
    const strip = $('#survey-strip'), survey = activeSurvey(log);
    if (!strip) return;
    if (survey) strip.innerHTML = '<p><span class="eyebrow">TUNED TO</span> ' + escapeHTML(surveySummary(survey)) + '</p><div><button type="button" class="text-button" data-survey="open">Change my preferences</button><button type="button" class="text-button" data-survey="reset">Reset preferences</button></div>';
    else if (!log.survey) strip.innerHTML = '<p><strong>New here?</strong> Five quick questions give the machine somewhere to start before you’ve rated anything.</p><div><button type="button" class="survey-open" data-survey="open">Tune the machine ↗</button><button type="button" class="text-button" data-survey="skip">No thanks</button></div>';
    else strip.innerHTML = '<p>No preferences saved. The machine learns from your ratings.</p><div><button type="button" class="text-button" data-survey="open">Set preferences</button></div>';
    strip.hidden = false;
  }
  const chip = (name, value, label, checked, type = 'checkbox') => '<label class="chip"><input type="' + type + '" name="' + name + '" value="' + escapeHTML(value) + '"' + (checked ? ' checked' : '') + '><span>' + escapeHTML(label) + '</span></label>';
  function termChips(name, chosen) {
    const block = (field, label) => '<fieldset class="chip-group"><legend>' + label + '</legend>' + surveyTerms[field].map(t => chip(name, t, t, chosen.includes(t))).join('') + '</fieldset>';
    const extra = chosen.some(t => !surveyTerms.traits.includes(t));
    return block('traits', 'Traits') + '<details class="more-terms"' + (extra ? ' open' : '') + '><summary>More sounds: genres &amp; styles +</summary>' + block('genres', 'Genres') + block('styles', 'Styles') + '</details>';
  }
  function openSurvey() {
    const s = log.survey?.status === 'saved' ? log.survey : {looking: [], strangeness: log.preference, energy: 'any', more: [], less: []};
    $('#survey-form').innerHTML = '<h2 id="survey-heading">What should the machine listen for?</h2><p class="small-note">Optional. Answers stay in this browser, only shape local recommendations, and fade as your ratings build up. Change or reset them any time.</p>'
      + '<fieldset class="survey-q"><legend><span>01</span> What are you looking for right now? <em>Pick any</em></legend><div class="chip-row">' + Object.entries(SURVEY_MOODS).map(([k, m]) => chip('looking', k, m.label, s.looking.includes(k))).join('') + '</div></fieldset>'
      + '<fieldset class="survey-q"><legend><span>02</span> How strange do you want to go?</legend><div class="chip-row">' + [['familiar','Familiar'],['strange','Strange'],['farout','Far Out'],['unhinged','Completely Unhinged'],['any','Anything']].map(([k, l]) => chip('strangeness', k, l, s.strangeness === k, 'radio')).join('') + '</div></fieldset>'
      + '<fieldset class="survey-q"><legend><span>03</span> What kind of energy?</legend><div class="chip-row">' + Object.entries(SURVEY_ENERGY).map(([k, e]) => chip('energy', k, e.label, s.energy === k, 'radio')).join('') + '</div></fieldset>'
      + '<fieldset class="survey-q"><legend><span>04</span> What sounds do you want more of? <em>Optional</em></legend>' + termChips('more', s.more) + '</fieldset>'
      + '<fieldset class="survey-q"><legend><span>05</span> Anything you want less of? <em>Optional</em></legend>' + termChips('less', s.less) + '</fieldset>'
      + '<div class="survey-actions"><button type="submit" class="survey-save">Save preferences</button>' + (log.survey ? '' : '<button type="button" class="text-button" data-survey="skip">Skip for now</button>') + (activeSurvey(log) ? '<button type="button" class="text-button" data-survey="reset">Reset preferences</button>' : '') + '</div>';
    const dialog = $('#survey-dialog');
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open',''); }
    $('#survey-form').querySelector('input')?.focus();
  }
  function closeSurvey() { const dialog = $('#survey-dialog'); if (dialog.open) { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); } $('#survey-strip button')?.focus(); }
  function setSurvey(next, message) {
    const previous = log;
    log = {...log, survey: next};
    if (next?.status === 'saved') log.preference = next.strangeness;
    const saved = persist(); limit = 24; render(); toast(message + (saved ? '' : ' Export your log to keep it.'), previous);
  }
  function saveSurvey(event) {
    event.preventDefault();
    const form = new FormData($('#survey-form'));
    const more = form.getAll('more'), less = form.getAll('less').filter(t => !more.includes(t));
    const survey = sanitizeSurvey({status: 'saved', looking: form.getAll('looking'), strangeness: form.get('strangeness') || 'any', energy: form.get('energy') || 'any', more, less, savedAt: now()}, dataset);
    closeSurvey(); setSurvey(survey, 'Preferences saved. Ratings will take over as you add them.');
  }

  function stars(record) {
    const state = entryFor(log, record.id), title = escapeHTML(record.title);
    return '<div class="stars" role="group" aria-label="Your rating for ' + title + '">' + [1,2,3,4,5].map(value => '<button type="button" class="star' + (state.rating >= value ? ' selected' : '') + '" data-rate="' + record.id + '" data-value="' + value + '" aria-label="Rate ' + title + ' ' + value + ' of 5 stars" aria-pressed="' + (state.rating === value) + '">' + (state.rating >= value ? '★' : '☆') + '</button>').join('') + (state.rating ? '<button type="button" class="clear-rating" data-rate="' + record.id + '" data-value="0" aria-label="Clear rating for ' + title + '">Clear</button>' : '<span class="rating-hint">' + (state.status === 'heard' ? 'YOUR RATING' : 'RATE TO MARK HEARD') + '</span>') + '</div>';
  }
  function statusSelect(record) {
    const state = entryFor(log, record.id);
    return '<label class="status-label"><span class="sr-only">Listening status for ' + escapeHTML(record.artist + ' — ' + record.title) + '</span><select class="status-select" data-status="' + record.id + '">' + statusOptions.map(status => '<option value="' + status + '"' + (state.status === status ? ' selected' : '') + '>' + labelCase(status) + '</option>').join('') + '</select></label>';
  }
  function tags(values, type = '') { return values.map(value => '<span class="tag ' + type + '">' + escapeHTML(value) + '</span>').join(''); }
  function badge(record) { return unresolved(record) ? '<span class="metadata-badge unresolved">UNRESOLVED METADATA</span>' : ''; }
  function scoreLine(record) { return '<div class="score-line" aria-label="Musical scores out of 5">' + ['weirdness','intensity','accessibility'].map(key => '<span class="score-item"><span class="score-label">' + labelCase(key) + '</span><b>' + (record[key] === null ? 'Unresolved' : record[key] + '<span aria-hidden="true"> / 5</span><span class="sr-only"> out of 5</span>') + '</b></span>').join('') + '</div>'; }
  function card(record, recommendation = null, mode = null) {
    const reason = recommendation ? '<div class="recommendation-reason"><h4>' + (mode === 'personalized' ? 'WHY THIS RECORD?' : mode === 'guided' ? 'FROM YOUR PREFERENCES' : 'AN OPEN DOOR') + '</h4>' + explanation(recommendation, mode).map(line => '<p>' + escapeHTML(line) + '</p>').join('') + '</div>' : '';
    return '<article class="record-card" data-record="' + record.id + '"><div class="card-top"><span class="catalog-no">' + escapeHTML(catalogLabel(record)) + '</span><span class="card-group">' + (sourceCount(record) > 1 ? '<span class="multi-source">' + sourceCount(record) + ' SOURCES</span> ' : '') + escapeHTML(provenanceLabel(record)) + '</span></div><div class="card-main"><p class="card-artist">' + escapeHTML(record.artist) + '</p><h3 class="card-title"><button type="button" class="record-title-button" data-details="' + record.id + '">' + escapeHTML(record.title) + '</button></h3><p class="release-meta">' + escapeHTML(record.year ?? 'Year not stated') + ' / ' + escapeHTML(record.label ?? 'Label not stated') + ' · ' + escapeHTML(releaseTypeLabel(record)) + '</p>' + badge(record) + '<div class="tag-list">' + tags(record.genres, 'genre') + tags(record.styles.slice(0,2)) + '</div>' + (record.traits.length ? '<p class="trait-line">' + record.traits.slice(0,4).map(escapeHTML).join(' · ') + '</p>' : '<p class="trait-line">Classification unresolved. Explore the research notes.</p>') + '<p class="card-source">' + escapeHTML(sourceLine(record)) + '</p></div>' + scoreLine(record) + '<div class="card-actions"><div class="status-row">' + statusSelect(record) + '<button type="button" class="notes-button" data-details="' + record.id + '" aria-label="Record notes for ' + escapeHTML(record.title) + '">NOTES ↗</button></div>' + stars(record) + '</div>' + reason + '</article>';
  }
  function empty(title, message, action = 'reset') { return '<div class="empty-state"><h3>' + escapeHTML(title) + '</h3><p>' + escapeHTML(message) + '</p>' + (action ? '<button type="button" data-empty-action="' + action + '">' + (action === 'collection' ? 'EXPLORE THE COLLECTION ↗' : 'CLEAR FILTERS & OPEN ALL FREQUENCIES') + '</button>' : '') + '</div>'; }
  function renderBand() {
    for (const button of doc.querySelectorAll('[data-band]')) { const active = button.dataset.band === log.preference; button.setAttribute('aria-checked', String(active)); button.tabIndex = active ? 0 : -1; }
    $('#band-caption').textContent = 'Selected: ' + (log.preference === 'any' ? 'Any weirdness · 1–5' : BAND_LABELS[log.preference]);
  }
  function renderCatalog() {
    const personal = view === 'recommendations';
    renderPathwayBanner();
    $('.sort-label').hidden = personal;
    $('#view-heading').textContent = personal ? 'Follow your own strange path.' : 'A good place to get lost.';
    $('#view-kicker').textContent = personal ? '02 / THE MACHINE SAYS' : '02 / THE RECORDS';
    $('#view-stamp').innerHTML = personal ? 'LISTEN<br>CLOSER' : 'START<br>ANYWHERE';
    let recommendationResult;
    if (personal) {
      recommendationResult = recommend(dataset, log, filters);
      currentResults = recommendationResult.items;
      const intros = {
        personalized: 'Musical connections to the records you rate highly, adjusted by the ones you don’t. Each pick shows the actual shared metadata.',
        discovery: 'The machine is warming up. Rate heard records 4 or 5 stars to start personal connections. These are varied discovery picks, not personalized matches.',
        avoidance: 'You have low ratings to steer away from. These discovery picks avoid the strongest matches; add some 4- or 5-star ratings to find sounds you love.',
        guided: 'Starting from your saved preferences. Rate records 4 or 5 stars and your ratings will take over.'
      };
      $('#view-description').textContent = intros[recommendationResult.mode];
      $('#results-context').textContent = BAND_LABELS[log.preference].toUpperCase();
    } else {
      currentResults = sortRecords(filterRecords(dataset, log, filters), log, order);
      $('#view-description').textContent = 'Across eras and traditions. Pick a name. Pull a thread.';
      $('#results-context').textContent = 'YOUR NEXT OBSESSION COULD BE HERE.';
    }
    $('#results-count').textContent = currentResults.length + (personal ? ' eligible ' + (recommendationResult.mode === 'personalized' ? 'recommendation' : recommendationResult.mode === 'guided' ? 'preference match' : 'discovery pick') : ' record') + (currentResults.length === 1 ? '' : 's') + (personal ? '' : ' / ' + dataset.length);
    $('#record-grid').innerHTML = currentResults.length ? currentResults.slice(0,limit).map(item => personal ? card(item.record, item, recommendationResult.mode) : card(item)).join('') : empty(personal ? 'No signal at this setting.' : 'Nothing on this frequency.', personal ? 'No unheard, classified records with supported matches meet these settings. Try a different weirdness band or clear your filters.' : 'Try a different search or loosen one of the filters.');
    $('#more-area').innerHTML = currentResults.length > limit ? '<button type="button" class="load-more" id="load-more">MORE RECORDS ↓ <span>(' + (currentResults.length-limit) + ' remaining)</span></button>' : '';
  }
  function renderHistory() {
    const heard = dataset.filter(r => entryFor(log,r.id).status === 'heard');
    const queued = dataset.filter(r => entryFor(log,r.id).status === 'want to hear');
    const rated = heard.filter(r => entryFor(log,r.id).rating);
    let content = '<p class="section-no">03 / YOUR LISTENING LOG</p><div class="alternate-header"><h2 id="history-heading">Leave a little evidence.</h2><div class="log-summary">' + heard.length + ' heard / ' + rated.length + ' rated / ' + queued.length + ' want to hear</div></div><p class="view-description">Your current records and a dated trail of status and rating changes. Everything stays on this browser.</p><div class="log-switch" role="group" aria-label="Listening log view">' + [['heard','Heard'],['queue','Want to hear'],['activity','Activity history']].map(([key,label]) => '<button type="button" data-history="' + key + '" aria-pressed="' + (historyMode === key) + '">' + label + '</button>').join('') + '</div>';
    if (historyMode === 'activity') {
      const events = [...log.events].reverse();
      content += events.length ? '<ol class="activity-list">' + events.slice(0,activityLimit).map(event => {
        const record = lookup.get(event.id);
        const action = event.kind === 'rating' ? event.rating ? 'Rated ' + event.rating + ' / 5 stars' : 'Cleared rating' : 'Marked ' + event.status;
        return '<li><span><strong>' + action + '</strong><br><button type="button" data-details="' + record.id + '">' + escapeHTML(record.artist + ' — ' + record.title) + '</button></span><time datetime="' + escapeHTML(event.at) + '">' + dateLabel(event.at,true) + '</time></li>';
      }).join('') + '</ol>' + (events.length > activityLimit ? '<button type="button" class="load-more" id="more-activity">MORE HISTORY ↓</button>' : '') : empty('A blank page. For now.', 'Your listening activity will appear here as you mark and rate records.', 'collection');
    } else {
      const records = historyMode === 'heard' ? sortRecords(heard,log,'recent') : [...queued].sort((a,b) => (Date.parse(entryFor(log,b.id).updatedAt)||0)-(Date.parse(entryFor(log,a.id).updatedAt)||0) || a.list_number-b.list_number);
      content += records.length ? '<div class="history-list">' + records.map(record => '<article class="history-row" data-record="' + record.id + '"><span class="history-number">#' + catalogLabel(record) + '</span><div><p class="card-artist">' + escapeHTML(record.artist) + '</p><h3><button type="button" class="record-title-button" data-details="' + record.id + '">' + escapeHTML(record.title) + '</button></h3></div>' + statusSelect(record) + stars(record) + '<time class="history-date" datetime="' + escapeHTML(entryFor(log,record.id).heardAt || entryFor(log,record.id).updatedAt || '') + '">' + dateLabel(historyMode === 'heard' ? entryFor(log,record.id).heardAt : entryFor(log,record.id).updatedAt) + '</time></article>').join('') + '</div>' : empty(historyMode === 'heard' ? 'Your ears have room to roam.' : 'Keep a record in mind.', historyMode === 'heard' ? 'Mark a record as heard or give it a star rating to start your listening log.' : 'Choose “Want to hear” on any record to save it here.', 'collection');
    }
    $('#history-view').innerHTML = content;
  }
  function renderProfile() {
    const profile = tasteProfile(dataset,log);
    let content = '<p class="section-no">04 / YOUR TASTE PROFILE</p><h2 id="profile-heading">What’s coming through?</h2><p class="profile-lede">Patterns in the music you rate. A picture of your listening, one record at a time.</p>';
    if (!profile.ready) content += empty('Give the machine a little more to go on.', 'You have rated ' + profile.ratedCount + ' of the 5 records needed for a first taste profile. Rate honestly: 3 is neutral, and low ratings help too.', 'collection');
    else {
      content += '<p class="small-note">Based on ' + profile.ratedCount + ' rated records, including ' + profile.likedCount + ' rated 4 or 5 stars. Small samples are labeled; these patterns describe your ratings only.</p><div class="profile-columns">' + [['genres','Favorite genres'],['styles','Favorite styles'],['traits','Favorite traits']].map(([key,label]) => '<section class="profile-column"><h3>' + label + '</h3>' + (profile[key].length ? profile[key].map(term => '<div class="profile-term"><div class="profile-term-head"><span>' + escapeHTML(labelCase(term.term)) + '</span><strong>' + term.average.toFixed(1) + ' ★</strong></div><div class="profile-meter" aria-hidden="true"><span style="width:' + term.average/5*100 + '%"></span></div><small>' + term.count + ' rated record' + (term.count === 1 ? '' : 's') + ' / ' + term.high + ' rated highly</small></div>').join('') : '<p class="small-note">No clear favorite in your ratings yet. Mixed and low ratings stay part of the picture.</p>') + '</section>').join('') + '</div><div class="range-panels">' + [['weirdness','Preferred weirdness'],['intensity','Preferred intensity']].map(([key,label]) => '<section class="range-panel"><h3>' + label.toUpperCase() + '</h3><strong>' + (profile[key] ? profile[key][0] === profile[key][1] ? profile[key][0] + ' / 5' : profile[key][0] + '–' + profile[key][1] + ' / 5' : '—') + '</strong><p>' + (profile[key] ? 'The middle range of scores among records you rated 4 or 5 stars. Five-star records carry twice the weight of four-star records.' : 'Rate a classified record 4 or 5 stars to establish a range.') + '</p></section>').join('') + '</div>';
    }
    $('#profile-view').innerHTML = content;
  }
  function safeSource(url) { try { const parsed = new URL(url); return ['http:','https:'].includes(parsed.protocol) ? parsed : null; } catch { return null; } }
  function provenanceBlock(record) {
    const sources = record.curation_sources || [], n = sources.length, pubs = publicationCount(record);
    const overlap = n > 1 ? '<p class="overlap-note"><strong>' + n + ' curated sources' + (pubs > 1 ? ' across ' + pubs + ' publications' : '') + '.</strong> Records that more than one list chose independently are worth noticing.</p>' : '';
    const rows = sources.map(source => { const link = safeSource(source.url) ? '<a href="' + escapeHTML(source.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(source.list_title) + ' ↗</a>' : escapeHTML(source.list_title); return '<li><span class="source-pub">' + escapeHTML(source.publication) + '</span><span class="source-title">' + link + '</span><span class="source-meta">' + [source.list_year, source.rank !== null ? 'No. ' + source.rank : 'Unranked list'].filter(Boolean).map(escapeHTML).join(' · ') + '</span></li>'; }).join('');
    return '<section class="detail-block provenance"><h3>WHY IT’S HERE</h3><p class="edition-tag">' + escapeHTML(editionLabel(record)) + '</p>' + overlap + '<ol class="provenance-list">' + (rows || '<li>No curated source is recorded.</li>') + '</ol></section>';
  }
  function renderDialog() {
    if (!modalId) return;
    const record = lookup.get(modalId);
    if (!record) return;
    $('#dialog-kicker').textContent = modalKicker;
    $('#dialog-body').innerHTML = '<p class="section-no">' + escapeHTML(catalogLabel(record)) + ' / ' + escapeHTML(provenanceLabel(record)) + '</p><p class="detail-artist">' + escapeHTML(record.artist) + '</p><h2 id="dialog-heading" class="detail-title">' + escapeHTML(record.title) + '</h2><p class="release-meta">' + escapeHTML(record.year ?? 'Year not stated') + ' / ' + escapeHTML(record.label ?? 'Label not stated') + ' · ' + escapeHTML(releaseTypeLabel(record)) + ' · As listed in the source</p>' + badge(record) + '<div class="tag-list">' + tags(record.genres,'genre') + tags(record.styles) + '</div><p class="trait-line">' + record.traits.map(escapeHTML).join(' · ') + '</p><div class="score-detail">' + ['weirdness','intensity','accessibility'].map(k => '<div><span>' + k.toUpperCase() + '</span><b>' + (record[k] === null ? 'Unresolved' : record[k] + ' / 5') + '</b></div>').join('') + '</div><p class="small-note">Musical scores are interpretive recommendation guides. Your stars below are your own rating.</p>' + provenanceBlock(record) + '<div class="detail-actions">' + statusSelect(record) + stars(record) + '<p class="small-note">A star rating marks this record as heard. Changing to an unheard status clears its current rating; activity history is kept.</p></div>' + (record.source_notes.length ? '<section class="detail-block"><h3>SOURCE NOTES</h3>' + record.source_notes.map(n => '<p>' + escapeHTML(n) + '</p>').join('') + '</section>' : '') + (record.research_notes.length ? '<section class="detail-block"><h3>RESEARCH NOTES</h3>' + record.research_notes.map(n => '<p>' + escapeHTML(n) + '</p>').join('') + '</section>' : '') + '<section class="detail-block"><h3>RELEASE TYPE</h3><p>' + escapeHTML(releaseTypeLabel(record)) + '</p>' + (record.release_type_notes || []).map(n => '<p>' + escapeHTML(n) + '</p>').join('') + '<ul class="source-list">' + (record.release_type_sources || []).map(url => safeSource(url) ? '<li><a href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(new URL(url).hostname) + ' ↗</a></li>' : '').join('') + '</ul></section><section class="detail-block"><h3>RESEARCH SOURCES</h3><ul class="source-list">' + record.research_sources.map(url => { const parsed = safeSource(url); return parsed ? '<li><a href="' + escapeHTML(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(parsed.hostname.replace(/^www\./,'')) + ' ↗</a></li>' : ''; }).join('') + '</ul><p class="small-note">Edition uncertainties stay in these notes. They are not used to invent recommendation connections.</p></section>';
  }
  function openRecord(id, kicker = 'RECORD NOTES') {
    if (!lookup.has(id)) return;
    lastOpener = id; modalId = id; modalKicker = kicker; renderDialog();
    const dialog = $('#record-dialog');
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open',''); }
    $('#close-dialog').focus();
  }
  function closeRecord() {
    const dialog = $('#record-dialog'); if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    modalId = null; if (lastOpener) doc.querySelector('[data-details="' + lastOpener + '"]')?.focus();
  }
  function renderHomeFeature(advance = false) {
    const root = $('#home-feature');
    if (!root) return;
    const result = recommend(dataset, log, filters);
    const personalized = result.mode === 'personalized' || result.mode === 'guided';
    let item = null, hasAnother = false;
    if (personalized) {
      const key = JSON.stringify(result.items.map(i => [i.record.id,i.score]));
      const previousIndex = result.items.findIndex(i => i.record.id === featureId);
      const unchanged = featureMode === 'personalized' && key === featurePoolKey && previousIndex >= 0;
      const index = unchanged ? (advance ? (previousIndex + 1) % result.items.length : previousIndex) : 0;
      item = result.items[index] || null;
      featurePoolKey = key; hasAnother = result.items.length > 1;
    } else {
      const current = lookup.get(featureId);
      const keep = !advance && featureMode === 'discovery' && current && surprise([current],log,filters,log.preference,()=>0);
      const pool = dataset.filter(r => r.id !== featureId);
      const record = keep || surprise(pool,log,filters,log.preference,random) || surprise(dataset,log,filters,log.preference,random);
      if (record) {
        item = {record, evidence:[]};
        hasAnother = !!surprise(dataset.filter(r => r.id !== record.id),log,filters,log.preference,()=>0);
      }
      featurePoolKey = '';
    }
    featureMode = personalized ? 'personalized' : 'discovery';
    featureId = item?.record.id || null;
    if ($('#home-feature-label')) $('#home-feature-label').textContent = personalized ? 'FOLLOW A CONNECTION' : 'AN OPEN DOOR';
    if (!item) {
      root.innerHTML = '<div class="feature-kicker"><span>THE MACHINE SAYS:</span></div><h2 id="feature-title">NO SIGNAL<br>AT THIS SETTING.</h2><p class="teaser-note">' + (personalized ? 'No supported recommendation matches these settings.' : 'No unheard release matches these settings.') + ' Try another weirdness band or loosen your archive filters.</p><button type="button" data-empty-action="reset">OPEN ALL FREQUENCIES ↗</button>';
      return;
    }
    const r = item.record;
    const shared = [...new Set(item.evidence.slice(0,2).flatMap(e => [...e.shared.styles, ...e.shared.traits]))];
    const reasons = personalized ? explanation(item, result.mode) : ['A random unheard discovery matching your filters and weirdness setting. Rate records 4 or 5 stars to start personalized connections.'];
    root.innerHTML = '<div class="feature-kicker"><span>THE MACHINE SAYS:</span><span>' + (result.mode === 'guided' ? 'FROM YOUR PREFERENCES' : personalized ? 'A CONNECTION FROM YOUR RATINGS' : 'RANDOM UNHEARD DISCOVERY') + '</span></div><h2 id="feature-title"><button type="button" data-details="' + r.id + '">' + escapeHTML(r.title.toUpperCase()) + '</button></h2><div class="feature-teaser-bottom"><p>' + escapeHTML(r.artist) + ', ' + escapeHTML(r.year ?? 'Year not stated') + '</p><button type="button" class="feature-arrow" data-details="' + r.id + '" aria-label="Open ' + escapeHTML(r.title) + '">↗</button></div><div class="feature-explanation">' + reasons.map(line => '<p>' + escapeHTML(line) + '</p>').join('') + '</div>' + (shared.length ? '<p class="feature-shared">SHARED / ' + shared.map(escapeHTML).join(' · ') + '</p>' : '<p class="feature-shared">' + r.styles.map(escapeHTML).join(' / ') + '</p>') + '<div class="feature-meta"><span>' + escapeHTML(catalogLabel(r)) + ' / ' + escapeHTML(releaseTypeLabel(r)) + '</span>' + scoreLine(r) + '</div><div class="feature-actions"><button type="button" id="another-discovery"' + (!hasAnother ? ' disabled' : '') + '>ANOTHER ONE <span aria-hidden="true">↗</span></button><span>' + (hasAnother ? (personalized ? 'FOLLOW THE NEXT CONNECTION' : 'TAKE ANOTHER CHANCE') : 'THE ONLY MATCH AT THIS SETTING') + '</span></div>';
    if (advance && $('#feature-announcement')) $('#feature-announcement').textContent = (personalized ? 'Next recommendation: ' : 'New discovery: ') + r.artist + ' — ' + r.title;
  }
  function render() {
    const heard = dataset.filter(r => entryFor(log,r.id).status === 'heard').length;
    $('#progress').textContent = heard + ' / ' + dataset.length + ' HEARD';
    $('#log-count').textContent = String(heard);
    $('#catalog-layout').hidden = !['collection','recommendations'].includes(view);
    $('#history-view').hidden = view !== 'history';
    $('#profile-view').hidden = view !== 'profile';
    for (const button of doc.querySelectorAll('[data-tab]')) { if (button.dataset.tab === view) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); }
    renderBand(); renderSurveyStrip(); renderHomeFeature();
    if (view === 'collection' || view === 'recommendations') renderCatalog();
    else if (view === 'history') renderHistory();
    else renderProfile();
    if (modalId) renderDialog();
  }
  function setView(next) { if (!['collection','recommendations','history','profile'].includes(next)) return; view = next; limit = 24; win.history.replaceState(null,'','#' + next); render(); }
  function reset(openFrequencies = false) {
    filters = {}; $('#search').value = '';
    for (const select of doc.querySelectorAll('[data-filter]')) select.value = '';
    if (openFrequencies) { log = {...log, preference:'any'}; persist(); }
    limit = 24; render();
  }
  function changeRecord(id, patch) {
    if (!lookup.has(id)) return;
    const previous = log; log = updateRecord(log,id,patch,now()); if (previous === log) return;
    const saved = persist(); render();
    const state = entryFor(log,id);
    const message = Object.hasOwn(patch,'rating') ? state.rating ? 'Rated ' + state.rating + ' / 5. Marked heard.' : 'Rating cleared.' : 'Marked ' + state.status + (state.status !== 'heard' && entryFor(previous,id).rating ? '. Current rating cleared; activity kept.' : '.');
    toast(message + (saved ? '' : ' Export your log to keep it.'), previous);
  }
  function click(event) {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'another-discovery') { renderHomeFeature(true); $('#another-discovery')?.focus({preventScroll:true}); return; }
    if (button.id === 'toggle-genres') { genresExpanded = !genresExpanded; renderThreads(); return; }
    if (button.dataset.threadTab) { threadTab = button.dataset.threadTab; renderThreads(); return; }
    if (button.dataset.pathway) { reset(); filters.pathway = button.dataset.pathway; setView('collection'); $('#main').scrollIntoView?.({behavior:'instant'}); $('#pathway-banner')?.focus?.(); return; }
    if (button.dataset.editionBrowse) { reset(); filters.edition = button.dataset.editionBrowse; $('#filter-edition').value = filters.edition; setView('collection'); $('#main').scrollIntoView?.({behavior:'instant'}); return; }
    if (button.id === 'clear-pathway') { delete filters.pathway; limit = 24; render(); $('#search').focus(); return; }
    if (button.dataset.survey === 'open') return openSurvey();
    if (button.dataset.survey === 'skip') { closeSurvey(); setSurvey({status: 'skipped', looking: [], strangeness: 'any', energy: 'any', more: [], less: [], savedAt: now()}, 'No problem. The machine will learn from your ratings.'); return; }
    if (button.dataset.survey === 'reset') { closeSurvey(); setSurvey({status: 'skipped', looking: [], strangeness: 'any', energy: 'any', more: [], less: [], savedAt: now()}, 'Preferences reset. Your ratings and listening log are unchanged.'); return; }
    if (button.id === 'close-survey') return closeSurvey();
    if (button.dataset.genreThread) { reset(); filters.genre = button.dataset.genreThread; $('#filter-genre').value = button.dataset.genreThread; setView('collection'); $('#main').scrollIntoView?.({behavior:'instant'}); return; }
    if (button.dataset.tab) { setView(button.dataset.tab); if (button.closest('.site-header, .entry-aside')) $('#main').scrollIntoView?.({behavior:'instant'}); return; }
    if (button.dataset.band) { log = {...log,preference:button.dataset.band}; persist(); limit = 24; render(); return; }
    if (button.dataset.rate) {
      const id = button.dataset.rate, value = Number(button.dataset.value);
      changeRecord(id,{rating:value || null});
      const root = modalId ? $('#dialog-body') : doc;
      root.querySelector('[data-rate="' + id + '"][data-value="' + value + '"]')?.focus(); return;
    }
    if (button.dataset.details) return openRecord(button.dataset.details);
    if (button.dataset.history) { historyMode = button.dataset.history; activityLimit = 30; renderHistory(); return; }
    if (button.dataset.emptyAction) return button.dataset.emptyAction === 'collection' ? setView('collection') : reset(true);
    if (button.id === 'reset-filters') return reset();
    if (button.id === 'surprise') { const selected = surprise(dataset,log,filters,log.preference,random); if (selected) openRecord(selected.id,'THE MACHINE PICKED / TAKE A CHANCE'); else toast('No unheard records match your filters and weirdness setting. Try another frequency.'); return; }
    if (button.id === 'close-dialog') return closeRecord();
    if (button.id === 'load-more') { limit += 24; renderCatalog(); return; }
    if (button.id === 'more-activity') { activityLimit += 30; renderHistory(); return; }
    if (button.id === 'dismiss-toast') { $('#toast').hidden = true; return; }
    if (button.id === 'undo' && undoSnapshot) { log = undoSnapshot; undoSnapshot = null; persist(); render(); toast('Last change undone.'); return; }
    if (button.id === 'export-log') {
      const blob = new win.Blob([JSON.stringify(log,null,2)],{type:'application/json'});
      if (!win.URL.createObjectURL) return toast('This browser cannot create a download. Your log remains saved locally.');
      const url = win.URL.createObjectURL(blob), link = doc.createElement('a'); link.href = url; link.download = 'weird-music-machine-listening-log.json'; doc.body.append(link); link.click(); link.remove(); win.setTimeout(() => win.URL.revokeObjectURL(url),1000); toast('Listening log exported. Keep it as a backup.'); return;
    }
    if (button.id === 'import-log') $('#import-file').click();
  }
  function change(event) {
    const target = event.target;
    if (target.closest?.('#survey-form') && ['more','less'].includes(target.name) && target.checked) { const other = target.name === 'more' ? 'less' : 'more'; const twin = $('#survey-form').querySelector('input[name="' + other + '"][value="' + CSS.escape(target.value) + '"]'); if (twin) twin.checked = false; return; }
    if (target.closest?.('#survey-form')) return;
    if (target.dataset.status) { const id = target.dataset.status; changeRecord(id,{status:target.value}); (modalId ? $('#dialog-body') : doc).querySelector('[data-status="' + id + '"]')?.focus(); }
    else if (target.dataset.filter) { filters[target.dataset.filter] = target.value; limit = 24; render(); }
    else if (target.id === 'sort') { order = target.value; limit = 24; render(); }
  }
  function input(event) { if (event.target.id === 'search') { filters.query = event.target.value; limit = 24; renderCatalog(); renderHomeFeature(); } }
  function keydown(event) {
    if (event.target.matches('[data-band]') && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
      event.preventDefault(); const buttons = [...doc.querySelectorAll('[data-band]')], current = buttons.indexOf(event.target); let index;
      const last = buttons.length - 1;
      if (event.key === 'Home') index = 0; else if (event.key === 'End') index = last; else index = (current + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].click(); buttons[index].focus();
    }
    if (event.target.matches('[data-thread-tab]') && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault(); const tabs = [...doc.querySelectorAll('[data-thread-tab]')], current = tabs.indexOf(event.target);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[index].click(); tabs[index].focus();
    }
    if (event.key === 'Escape' && modalId) closeRecord();
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Choose a listening-log JSON file smaller than 2 MB.');
      const incoming = sanitizeLog(JSON.parse(await file.text()),dataset);
      const previous = log;
      const merged = [...log.events,...incoming.events];
      const uniqueEvents = new Map(merged.map(e => [JSON.stringify(e),e]));
      const records = {...log.records};
      for (const [id, entry] of Object.entries(incoming.records)) records[id] = {...records[id], ...entry};  // keeps a local note when the file has none
      log = {...log, records, preference:incoming.preference, ...(incoming.survey ? {survey: incoming.survey} : {}), events:[...uniqueEvents.values()].sort((a,b) => Date.parse(a.at)-Date.parse(b.at)).slice(-2000)};
      persist(); render(); toast('Log imported. Existing entries kept unless included in the file.',previous);
    } catch (error) { toast(error.message || 'Could not read that listening log. Your existing log is unchanged.'); }
    finally { event.target.value = ''; }
  }
  function sync(event) { if (event.key === STORAGE_KEY) { const incoming = loadLog(storage,dataset); if (!incoming.error) { log = incoming.log; render(); } } }
  doc.addEventListener('click',click); doc.addEventListener('change',change); doc.addEventListener('input',input); doc.addEventListener('keydown',keydown);
  $('#import-file').addEventListener('change',importFile); win.addEventListener('storage',sync);
  $('#record-dialog').addEventListener('click',event => { if (event.target === $('#record-dialog')) closeRecord(); });
  $('#survey-form').addEventListener('submit', saveSurvey);
  $('#survey-dialog').addEventListener('click', event => { if (event.target === $('#survey-dialog')) closeSurvey(); });
  render();
  return {getLog:() => log, getView:() => view, getFilters:() => ({...filters}), setView, openRecord, getVisibleRecords:() => currentResults.map(item => item.record || item), destroy:() => { if (timer) win.clearTimeout(timer); doc.removeEventListener('click',click);doc.removeEventListener('change',change);doc.removeEventListener('input',input);doc.removeEventListener('keydown',keydown);win.removeEventListener('storage',sync); }};
}

if (typeof document !== 'undefined' && document.querySelector('#main')) {
  try {
    const response = await fetch('./weird-music-machine-corpus.json');
    if (!response.ok) throw new Error('The record collection could not be loaded.');
    const dataset = await response.json();
    if (!Array.isArray(dataset) || !dataset.length || !dataset.every(r => r && typeof r.id === 'string' && r.id) || new Set(dataset.map(r=>r.id)).size !== dataset.length) throw new Error('The collection failed its integrity check.');
    let storage;
    try { storage = window.localStorage; } catch { storage = {getItem(){throw new Error('Storage unavailable');},setItem(){throw new Error('Storage unavailable');}}; }
    createApp({dataset,doc:document,storage});
  } catch {
    document.querySelector('#record-grid').innerHTML = '<div class="empty-state"><h3>The signal dropped.</h3><p>The collection could not load. Reload this page to try again. Your saved listening log has not been changed.</p><button type="button" onclick="location.reload()">RELOAD THE MACHINE</button></div>';
    document.querySelector('#results-count').textContent = 'Collection unavailable';
  }
}
