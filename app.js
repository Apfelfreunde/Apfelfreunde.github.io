const DB_NAME = 'apfelbuch-db';
const DB_VERSION = 2;
const EXAMPLE_STORE = 'examples';
const VARIETY_STORE = 'varieties';
const MAX_FILES = 15;

let model = null;
let deferredInstallPrompt = null;
let trainItems = [];
let recognizeItems = [];
let trainLocation = null;
let recognizeLocation = null;

const $ = (id) => document.getElementById(id);
const VIEW_TYPES = [
  ['profil', 'Profil / Seite'],
  ['stielgrube', 'Stielgrube / oben'],
  ['kelchgrube', 'Kelchgrube / unten'],
  ['schnittbild', 'Schnittbild / innen'],
  ['baum', 'Baum (optional)'],
  ['weitere', 'Weitere Fruchtaufnahme']
];
const DEFAULT_TYPES = ['profil', 'stielgrube', 'kelchgrube', 'schnittbild', 'baum', 'weitere', 'weitere', 'weitere', 'weitere', 'weitere', 'weitere', 'weitere', 'weitere', 'weitere', 'weitere'];
const TASTES = [
  ['sweet', 'süß'],
  ['sweet_sour', 'süß-säuerlich'],
  ['sour', 'säuerlich'],
  ['aromatic', 'aromatisch'],
  ['spicy', 'würzig'],
  ['mild', 'mild'],
  ['juicy', 'saftig'],
  ['strong', 'kräftig']
];
const MONTHS = [
  [1,'Januar'], [2,'Februar'], [3,'März'], [4,'April'], [5,'Mai'], [6,'Juni'],
  [7,'Juli'], [8,'August'], [9,'September'], [10,'Oktober'], [11,'November'], [12,'Dezember']
];

const REFERENCE_VARIETIES = Array.isArray(window.SORTENWISSEN) ? window.SORTENWISSEN : [];

function normalizeLookup(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de')
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9äöüß' -]+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function referenceNames(ref) {
  const fromSynonyms = String(ref?.synonyms || '').split(';').map(x => x.trim()).filter(Boolean);
  return [ref?.name, ...(ref?.aliases || []), ...fromSynonyms].filter(Boolean);
}

function findReference(fruitType, name) {
  const needle = normalizeLookup(name);
  if (!needle) return null;
  return REFERENCE_VARIETIES.find(ref => (!fruitType || ref.fruitType === fruitType) && referenceNames(ref).some(n => normalizeLookup(n) === needle)) || null;
}

function findReferenceById(id) {
  return REFERENCE_VARIETIES.find(ref => ref.id === id) || null;
}

function combineSources(...lists) {
  const out = []; const seen = new Set();
  for (const list of lists) for (const src of (Array.isArray(list) ? list : [])) {
    if (!src?.url) continue;
    const key = String(src.url);
    if (seen.has(key)) continue;
    seen.add(key); out.push({ label: src.label || 'Quelle', url: key });
  }
  return out;
}

function referenceToMeta(ref) {
  return {
    key: makeVarietyKey(ref.fruitType, ref.name), fruitType: ref.fruitType, name: ref.name,
    synonyms: ref.synonyms || (ref.aliases || []).join('; '), origin: ref.origin || '',
    tastes: Array.isArray(ref.tastes) ? [...ref.tastes] : [],
    ripenessStart: ref.ripenessStart || null, ripenessEnd: ref.ripenessEnd || null,
    ripenessNote: ref.ripenessNote || '', usage: ref.usage || '', storage: ref.storage || '',
    description: ref.description || '', regions: Array.isArray(ref.regions) ? [...ref.regions] : [], categories: Array.isArray(ref.categories) ? [...ref.categories] : [], sources: combineSources(ref.sources),
    referenceId: ref.id, builtInKnowledge: true
  };
}

function enrichMeta(meta) {
  if (!meta) return meta;
  const ref = findReferenceById(meta.referenceId) || findReference(meta.fruitType, meta.name);
  if (!ref) return { ...meta, sources: combineSources(meta.sources) };
  const base = referenceToMeta(ref);
  return {
    ...base, ...meta,
    synonyms: meta.synonyms || base.synonyms,
    origin: meta.origin || base.origin,
    tastes: Array.isArray(meta.tastes) && meta.tastes.length ? meta.tastes : base.tastes,
    ripenessStart: meta.ripenessStart || base.ripenessStart,
    ripenessEnd: meta.ripenessEnd || base.ripenessEnd,
    ripenessNote: meta.ripenessNote || base.ripenessNote,
    usage: meta.usage || base.usage, storage: meta.storage || base.storage,
    description: meta.description || base.description,
    regions: Array.isArray(meta.regions) && meta.regions.length ? meta.regions : base.regions,
    categories: Array.isArray(meta.categories) && meta.categories.length ? meta.categories : base.categories,
    sources: combineSources(meta.sources, base.sources), referenceId: ref.id, builtInKnowledge: true
  };
}

function safeExternalUrl(url) {
  try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}

function normalizeName(name) { return name.trim().replace(/\s+/g, ' '); }
function fruitLabel(type) { return type === 'pear' ? 'Birne' : 'Apfel'; }
function makeVarietyKey(fruitType, name) { return `${fruitType || 'apple'}::${normalizeName(name).toLocaleLowerCase('de')}`; }
function escapeHtml(str) { return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function typeLabel(value) { return (VIEW_TYPES.find(x => x[0] === value) || [null, 'Weitere'])[1]; }
function tasteLabel(value) { return (TASTES.find(x => x[0] === value) || [null, value])[1]; }
function monthLabel(value) { return (MONTHS.find(x => x[0] === Number(value)) || [null, ''])[1]; }
function clamp(v, min=0, max=1) { return Math.min(max, Math.max(min, v)); }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EXAMPLE_STORE)) {
        const store = db.createObjectStore(EXAMPLE_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('variety', 'variety', { unique: false });
      }
      if (!db.objectStoreNames.contains(VARIETY_STORE)) {
        db.createObjectStore(VARIETY_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addExample(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXAMPLE_STORE, 'readwrite');
    tx.objectStore(EXAMPLE_STORE).add(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function getAllExamples() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXAMPLE_STORE, 'readonly');
    const req = tx.objectStore(EXAMPLE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function getAllVarieties() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VARIETY_STORE, 'readonly');
    const req = tx.objectStore(VARIETY_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function getVariety(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VARIETY_STORE, 'readonly');
    const req = tx.objectStore(VARIETY_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function putVariety(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VARIETY_STORE, 'readwrite');
    tx.objectStore(VARIETY_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function clearAllData() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([EXAMPLE_STORE, VARIETY_STORE], 'readwrite');
    tx.objectStore(EXAMPLE_STORE).clear();
    tx.objectStore(VARIETY_STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

function averageEmbedding(vectors) {
  if (!vectors.length) return [];
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i];
  for (let i = 0; i < out.length; i++) out[i] /= vectors.length;
  return out;
}

async function embeddingFromImage(img) {
  if (!model) throw new Error('Modell noch nicht geladen');
  const tensor = tf.tidy(() => model.infer(img, true).squeeze());
  const values = Array.from(await tensor.data());
  tensor.dispose();
  return values;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

function imageToStoredBlob(img, file) {
  return new Promise((resolve) => {
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    if (scale >= 0.999) return resolve(file);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.88);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const binary = atob(body); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function setupMonthSelect(id, includeEmpty=true) {
  const select = $(id); select.innerHTML = '';
  if (includeEmpty) {
    const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'Nicht angegeben'; select.appendChild(opt);
  }
  for (const [value, label] of MONTHS) {
    const opt = document.createElement('option'); opt.value = String(value); opt.textContent = label; select.appendChild(opt);
  }
}

function renderTasteChoices(containerId, prefix) {
  const box = $(containerId); box.innerHTML = '';
  for (const [value, label] of TASTES) {
    const wrap = document.createElement('label'); wrap.className = 'choice';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.id = `${prefix}-${value}`;
    const span = document.createElement('span'); span.textContent = label;
    wrap.append(input, span); box.appendChild(wrap);
  }
}

function selectedTastes(containerId) {
  return Array.from($(containerId).querySelectorAll('input[type="checkbox"]:checked')).map(x => x.value);
}

function setSelectedTastes(containerId, values=[]) {
  const set = new Set(values || []);
  $(containerId).querySelectorAll('input[type="checkbox"]').forEach(x => { x.checked = set.has(x.value); });
}

function setupKnownVarietiesDatalist() {
  const list = $('knownVarieties');
  if (!list) return;
  list.innerHTML = '';
  const values = [];
  for (const ref of REFERENCE_VARIETIES) {
    values.push([ref.name, fruitLabel(ref.fruitType)]);
    for (const alias of (ref.aliases || []).slice(0, 2)) values.push([alias, `${fruitLabel(ref.fruitType)} · Synonym`]);
  }
  const seen = new Set();
  for (const [value, label] of values.sort((a,b) => a[0].localeCompare(b[0], 'de'))) {
    const key = normalizeLookup(value); if (seen.has(key)) continue; seen.add(key);
    const opt = document.createElement('option'); opt.value = value; opt.label = label; list.appendChild(opt);
  }
}

function setupKnownVarietiesMenu() {
  const menu = $('knownVarietyMenu');
  if (!menu) return;
  const fruitType = $('trainFruitType')?.value || 'apple';
  const current = normalizeLookup($('varietyName')?.value || '');
  menu.innerHTML = '<option value="">– Sorte auswählen –</option>';
  const refs = REFERENCE_VARIETIES.filter(ref => ref.fruitType === fruitType).sort((a,b) => a.name.localeCompare(b.name, 'de'));
  for (const ref of refs) {
    const opt = document.createElement('option'); opt.value = ref.name; opt.textContent = ref.name;
    if (current && referenceNames(ref).some(n => normalizeLookup(n) === current)) opt.selected = true;
    menu.appendChild(opt);
  }
  const custom = document.createElement('option'); custom.value = '__custom__'; custom.textContent = 'Andere / neue Sorte …'; menu.appendChild(custom);
}

function syncKnownVarietyMenu() {
  const menu = $('knownVarietyMenu');
  if (!menu) return;
  const ref = currentReference();
  if (ref && ref.fruitType === $('trainFruitType').value) menu.value = ref.name;
  else if (normalizeName($('varietyName').value)) menu.value = '__custom__';
  else menu.value = '';
}

function currentReference() {
  const name = $('varietyName')?.value || '';
  const type = $('trainFruitType')?.value || null;
  return findReference(type, name) || findReference(null, name);
}

function renderKnowledgeSources(sources=[]) {
  const box = $('knowledgeSources');
  if (!box) return;
  const safe = combineSources(sources).map(src => ({...src, safeUrl: safeExternalUrl(src.url)})).filter(src => src.safeUrl);
  if (!safe.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<strong>Fachquellen:</strong> ${safe.map(src => `<a href="${escapeHtml(src.safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.label)}</a>`).join(' · ')}`;
}

function updateKnowledgeMatch(message='') {
  const box = $('knowledgeMatch'); const btn = $('applyKnowledgeBtn');
  const ref = currentReference();
  if (!box || !btn) return ref;
  if (!normalizeName($('varietyName').value)) {
    box.textContent = 'Tippe einen bekannten Sortennamen ein. Das eingebaute Fachwissen kann passende Angaben automatisch ergänzen.';
    btn.disabled = true; renderKnowledgeSources([]); return null;
  }
  if (!ref) {
    box.textContent = 'Für diesen Namen ist im eingebauten Grundbestand noch kein Fachwissen hinterlegt. Du kannst die Angaben trotzdem selbst speichern.';
    btn.disabled = true; renderKnowledgeSources([]); return null;
  }
  box.innerHTML = `<strong>Fachwissen gefunden:</strong> ${escapeHtml(ref.name)} (${escapeHtml(fruitLabel(ref.fruitType))})${message ? ` · ${escapeHtml(message)}` : ''}`;
  btn.disabled = false; renderKnowledgeSources(ref.sources || []); return ref;
}

function applyReferenceToForm(ref=currentReference(), force=false, quiet=false) {
  if (!ref) { updateKnowledgeMatch(); return false; }
  $('trainFruitType').value = ref.fruitType;
  $('varietyName').value = ref.name;
  const setText = (id, value) => { if (force || !$(id).value.trim()) $(id).value = value || ''; };
  setText('synonyms', ref.synonyms || (ref.aliases || []).join('; '));
  setText('origin', ref.origin || '');
  setText('usage', ref.usage || '');
  setText('storage', ref.storage || '');
  setText('ripenessNote', ref.ripenessNote || '');
  setText('description', ref.description || '');
  if (force || !selectedTastes('trainTasteOptions').length) setSelectedTastes('trainTasteOptions', ref.tastes || []);
  if (force || !$('ripenessStart').value) $('ripenessStart').value = ref.ripenessStart ? String(ref.ripenessStart) : '';
  if (force || !$('ripenessEnd').value) $('ripenessEnd').value = ref.ripenessEnd ? String(ref.ripenessEnd) : '';
  setupKnownVarietiesMenu();
  syncKnownVarietyMenu();
  updateKnowledgeMatch(quiet ? 'Angaben ergänzt' : 'Fachwissen übernommen');
  renderKnowledgeSources(ref.sources || []);
  return true;
}

function formatLocation(loc) {
  if (!loc) return 'Kein Standort angegeben.';
  const accuracy = Number.isFinite(loc.accuracy) ? ` · Genauigkeit ca. ${Math.round(loc.accuracy)} m` : '';
  return `📍 ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}${accuracy}`;
}

function renderLocation(kind) {
  const loc = kind === 'train' ? trainLocation : recognizeLocation;
  const status = $(`${kind}LocationStatus`);
  const clearId = kind === 'train' ? 'clearTrainLocationBtn' : 'clearRecognizeLocationBtn';
  if (status) status.textContent = formatLocation(loc);
  if ($(clearId)) $(clearId).classList.toggle('hidden', !loc);
}

function requestLocation(kind) {
  if (!navigator.geolocation) return alert('Dieses Gerät unterstützt die Standortabfrage im Browser nicht.');
  const btn = $(`${kind}LocationBtn`); const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Standort wird ermittelt …';
  navigator.geolocation.getCurrentPosition(pos => {
    const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: new Date().toISOString() };
    if (kind === 'train') trainLocation = loc; else recognizeLocation = loc;
    renderLocation(kind); btn.disabled = false; btn.textContent = original;
  }, err => {
    console.error(err); btn.disabled = false; btn.textContent = original;
    alert(err.code === 1 ? 'Standort wurde nicht freigegeben. Du kannst die App auch ohne Standort benutzen.' : 'Standort konnte nicht ermittelt werden.');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

function clearLocation(kind) {
  if (kind === 'train') trainLocation = null; else recognizeLocation = null;
  renderLocation(kind);
}

function makeTypeSelect(selected, index) {
  const select = document.createElement('select'); select.className = 'view-type-select'; select.dataset.index = index;
  for (const [value, label] of VIEW_TYPES) {
    const opt = document.createElement('option'); opt.value = value; opt.textContent = label; opt.selected = value === selected; select.appendChild(opt);
  }
  return select;
}

async function buildItems(files, withTypes, startIndex = 0, availableSlots = MAX_FILES) {
  const chosen = Array.from(files || []);
  if (availableSlots <= 0) { alert(`Der Fotosatz ist bereits voll. Maximal ${MAX_FILES} Fotos sind erlaubt.`); return []; }
  if (chosen.length > availableSlots) alert(`Es sind noch ${availableSlots} Plätze frei. Nur die ersten ${availableSlots} neuen Fotos werden übernommen.`);
  const limited = chosen.slice(0, availableSlots); const items = [];
  for (let i = 0; i < limited.length; i++) {
    try {
      const img = await loadImageFromFile(limited[i]); const position = startIndex + i;
      items.push({ file: limited[i], img, type: withTypes ? (DEFAULT_TYPES[position] || 'weitere') : 'weitere' });
    } catch (err) { console.error(err); }
  }
  return items;
}

function renderTrainGrid() {
  const grid = $('trainPreviewGrid'); grid.innerHTML = '';
  $('trainCount').textContent = trainItems.length ? `${trainItems.length} von ${MAX_FILES} Fotos ausgewählt.` : 'Noch keine Fotos ausgewählt.';
  trainItems.forEach((item, index) => {
    const card = document.createElement('div'); card.className = 'photo-card';
    const img = item.img.cloneNode(); img.className = 'multi-preview'; img.alt = `Trainingsfoto ${index + 1}`;
    const number = document.createElement('div'); number.className = 'photo-number'; number.textContent = `Foto ${index + 1}`;
    const select = makeTypeSelect(item.type, index); select.addEventListener('change', () => { trainItems[index].type = select.value; });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-photo'; remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => { trainItems.splice(index, 1); renderTrainGrid(); refreshActionButtons(); });
    card.append(img, number, select, remove); grid.appendChild(card);
  });
}

function renderRecognizeGrid() {
  const grid = $('recognizePreviewGrid'); grid.innerHTML = '';
  $('recognizeCount').textContent = recognizeItems.length ? `${recognizeItems.length} von ${MAX_FILES} Fotos ausgewählt.` : 'Noch keine Fotos ausgewählt.';
  recognizeItems.forEach((item, index) => {
    const card = document.createElement('div'); card.className = 'photo-card simple';
    const img = item.img.cloneNode(); img.className = 'multi-preview'; img.alt = `Vergleichsfoto ${index + 1}`;
    const number = document.createElement('div'); number.className = 'photo-number'; number.textContent = `Foto ${index + 1}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-photo'; remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => { recognizeItems.splice(index, 1); renderRecognizeGrid(); refreshActionButtons(); });
    card.append(img, number, remove); grid.appendChild(card);
  });
}

function readTrainMetadata() {
  const fruitType = $('trainFruitType').value;
  const name = normalizeName($('varietyName').value);
  const ref = findReference(fruitType, name) || findReference(null, name);
  return {
    key: name ? makeVarietyKey(fruitType, name) : '', fruitType, name,
    synonyms: $('synonyms').value.trim(), origin: $('origin').value.trim(),
    tastes: selectedTastes('trainTasteOptions'),
    ripenessStart: Number($('ripenessStart').value) || null,
    ripenessEnd: Number($('ripenessEnd').value) || null,
    ripenessNote: $('ripenessNote').value.trim(),
    usage: $('usage').value.trim(), storage: $('storage').value.trim(),
    description: $('description').value.trim(),
    referenceId: ref?.id || null,
    sources: combineSources(ref?.sources)
  };
}

async function saveVarietyMetadata(showMessage=true, preserveBlank=false) {
  const ref = currentReference();
  if (ref) applyReferenceToForm(ref, false, true);
  const input = readTrainMetadata();
  if (!input.name) { alert('Bitte zuerst einen Sortennamen eingeben.'); return null; }
  const existing = await getVariety(input.key);
  const now = new Date().toISOString();
  let record = { ...input, createdAt: existing?.createdAt || now, updatedAt: now };
  if (preserveBlank && existing) {
    record = {
      ...existing,
      ...record,
      synonyms: input.synonyms || existing.synonyms || '',
      origin: input.origin || existing.origin || '',
      tastes: input.tastes.length ? input.tastes : (existing.tastes || []),
      ripenessStart: input.ripenessStart || existing.ripenessStart || null,
      ripenessEnd: input.ripenessEnd || existing.ripenessEnd || null,
      ripenessNote: input.ripenessNote || existing.ripenessNote || '',
      usage: input.usage || existing.usage || '', storage: input.storage || existing.storage || '',
      description: input.description || existing.description || '',
      referenceId: input.referenceId || existing.referenceId || null,
      sources: combineSources(input.sources, existing.sources),
      updatedAt: now
    };
  } else if (existing) {
    record.sources = combineSources(input.sources, existing.sources);
    record.referenceId = input.referenceId || existing.referenceId || null;
  }
  await putVariety(record);
  if (showMessage) alert(`${fruitLabel(record.fruitType)} „${record.name}“: Sortendaten gespeichert.`);
  await updateCollection();
  return record;
}

function missingRecommendedTypes() {
  const have = new Set(trainItems.map(x => x.type));
  return ['profil', 'stielgrube', 'kelchgrube', 'schnittbild'].filter(x => !have.has(x));
}

async function addTrainingExamples() {
  const meta = readTrainMetadata();
  if (!meta.name) return alert('Bitte zuerst einen Sortennamen eingeben.');
  if (!trainItems.length) return alert('Bitte zuerst mindestens ein Foto auswählen.');
  const missing = missingRecommendedTypes();
  if (trainItems.length >= 4 && missing.length) {
    const labels = missing.map(typeLabel).join(', ');
    if (!confirm(`Bei diesem Fotosatz fehlen empfohlene Ansichten: ${labels}.\n\nTrotzdem anlernen?`)) return;
  }
  const savedMeta = await saveVarietyMetadata(false, true);
  const btn = $('addTrainingBtn'); btn.disabled = true;
  const setId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`); let saved = 0;
  try {
    for (let i = 0; i < trainItems.length; i++) {
      btn.textContent = `Foto ${i + 1}/${trainItems.length} wird angelernt …`;
      const item = trainItems[i]; const emb = await embeddingFromImage(item.img); const storedImage = await imageToStoredBlob(item.img, item.file);
      await addExample({
        variety: savedMeta.name, varietyKey: savedMeta.key, fruitType: savedMeta.fruitType,
        embedding: emb, image: storedImage, viewType: item.type, setId, location: trainLocation ? { ...trainLocation } : null, createdAt: new Date().toISOString()
      });
      saved++;
    }
    const examples = await getAllExamples();
    const count = examples.filter(x => (x.varietyKey || makeVarietyKey(x.fruitType || 'apple', x.variety)) === savedMeta.key).length;
    await updateCollection();
    alert(`${savedMeta.name}: ${saved} Fotos gespeichert und angelernt. Insgesamt ${count} Trainingsfotos für diese Sorte.`);
    trainItems = []; $('trainCamera').value = ''; $('trainGallery').value = ''; renderTrainGrid();
  } catch (err) {
    console.error(err); alert(`Es wurden ${saved} Fotos gespeichert. Danach ist beim Verarbeiten ein Fehler aufgetreten.`);
  } finally { btn.textContent = 'Ausgewählte Fotos anlernen'; refreshActionButtons(); }
}

function monthInRange(month, start, end) {
  if (!month || !start || !end) return null;
  month = Number(month); start = Number(start); end = Number(end);
  if (start <= end) return month >= start && month <= end;
  return month >= start || month <= end;
}

function monthDistanceToRange(month, start, end) {
  if (!month || !start || !end) return null;
  if (monthInRange(month, start, end)) return 0;
  const dist = (a,b) => Math.min(Math.abs(a-b), 12-Math.abs(a-b));
  return Math.min(dist(Number(month), Number(start)), dist(Number(month), Number(end)));
}

function tasteMatch(selected, varietyTastes) {
  if (!selected.length) return null;
  if (!Array.isArray(varietyTastes) || !varietyTastes.length) return 0.5;
  const set = new Set(varietyTastes); let hits = 0;
  for (const t of selected) if (set.has(t)) hits++;
  return hits / selected.length;
}

function ripenessMatch(month, meta) {
  if (!month) return null;
  if (!meta?.ripenessStart || !meta?.ripenessEnd) return 0.5;
  const distance = monthDistanceToRange(Number(month), meta.ripenessStart, meta.ripenessEnd);
  if (distance === 0) return 1;
  if (distance === 1) return 0.55;
  if (distance === 2) return 0.2;
  return 0;
}

function renderMetaHtml(meta) {
  if (!meta) return '<p class="empty">Noch keine Sortenbeschreibung hinterlegt.</p>';
  meta = enrichMeta(meta);
  const tastes = (meta.tastes || []).map(tasteLabel);
  const ripeness = meta.ripenessStart && meta.ripenessEnd ? `${monthLabel(meta.ripenessStart)} bis ${monthLabel(meta.ripenessEnd)}` : 'nicht angegeben';
  const sourceLinks = combineSources(meta.sources).map(src => ({...src, safeUrl: safeExternalUrl(src.url)})).filter(src => src.safeUrl);
  return `
    <div class="description-box">
      <p><strong>Fruchtart:</strong> ${escapeHtml(fruitLabel(meta.fruitType))}</p>
      ${meta.synonyms ? `<p><strong>Synonyme:</strong> ${escapeHtml(meta.synonyms)}</p>` : ''}
      ${meta.origin ? `<p><strong>Herkunft:</strong> ${escapeHtml(meta.origin)}</p>` : ''}
      ${(meta.regions || []).length ? `<p><strong>Region:</strong> ${escapeHtml((meta.regions || []).join(' · '))}</p>` : ''}
      ${(meta.categories || []).length ? `<p><strong>Einordnung:</strong> ${escapeHtml((meta.categories || []).join(' · '))}</p>` : ''}
      <p><strong>Geschmack:</strong> ${tastes.length ? tastes.map(x => `<span class="badge">${escapeHtml(x)}</span>`).join('') : 'nicht angegeben'}</p>
      <p><strong>Reifezeit:</strong> ${escapeHtml(ripeness)}${meta.ripenessNote ? `<br><span class="meta-note">${escapeHtml(meta.ripenessNote)}</span>` : ''}</p>
      ${meta.usage ? `<p><strong>Verwendung:</strong> ${escapeHtml(meta.usage)}</p>` : ''}
      ${meta.storage ? `<p><strong>Lagerfähigkeit:</strong> ${escapeHtml(meta.storage)}</p>` : ''}
      ${meta.description ? `<p><strong>Beschreibung:</strong> ${escapeHtml(meta.description)}</p>` : '<p class="empty">Noch keine ausführliche Beschreibung hinterlegt.</p>'}
      ${sourceLinks.length ? `<p class="source-line"><strong>Quellen:</strong> ${sourceLinks.map(src => `<a href="${escapeHtml(src.safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.label)}</a>`).join(' · ')}</p>` : ''}
    </div>`;
}

async function recognize() {
  if (!recognizeItems.length) return alert('Bitte zuerst mindestens ein Foto auswählen.');
  const examples = await getAllExamples();
  if (!examples.length) return alert('Bitte zuerst mindestens eine Sorte anlernen.');
  const varieties = await getAllVarieties();
  const metaMap = new Map(varieties.map(v => [v.key, enrichMeta(v)]));
  const fruitFilter = $('recognizeFruitType').value;
  const selectedTaste = selectedTastes('recognizeTasteOptions');
  const selectedMonth = Number($('recognizeMonth').value) || null;

  const groups = {};
  for (const ex of examples) {
    const fruitType = ex.fruitType || 'apple';
    const key = ex.varietyKey || makeVarietyKey(fruitType, ex.variety);
    if (fruitFilter !== 'unknown' && fruitType !== fruitFilter) continue;
    if (!groups[key]) groups[key] = { key, name: ex.variety, fruitType, vectors: [] };
    groups[key].vectors.push(ex.embedding);
  }
  const groupList = Object.values(groups);
  if (!groupList.length) return alert(`Für ${fruitFilter === 'pear' ? 'Birnen' : 'diese Fruchtart'} sind noch keine passenden Trainingsbilder vorhanden.`);

  const btn = $('recognizeBtn'); btn.disabled = true; $('results').innerHTML = '';
  try {
    const queries = [];
    for (let i = 0; i < recognizeItems.length; i++) {
      btn.textContent = `Foto ${i + 1}/${recognizeItems.length} wird ausgewertet …`;
      queries.push(await embeddingFromImage(recognizeItems[i].img));
    }
    const query = averageEmbedding(queries);
    const scored = groupList.map(group => {
      const rawImage = Math.max(0, cosineSimilarity(query, averageEmbedding(group.vectors)));
      const imageScore = clamp((rawImage - 0.45) / 0.55);
      const meta = metaMap.get(group.key) || enrichMeta({ key: group.key, name: group.name, fruitType: group.fruitType, tastes: [] });
      const tScore = tasteMatch(selectedTaste, meta.tastes || []);
      const rScore = ripenessMatch(selectedMonth, meta);
      let weighted = imageScore * 0.72; let weight = 0.72;
      if (tScore !== null) { weighted += tScore * 0.18; weight += 0.18; }
      if (rScore !== null) { weighted += rScore * 0.10; weight += 0.10; }
      return { ...group, meta, rawImage, imageScore, tasteScore: tScore, ripenessScore: rScore, combined: weighted / weight };
    }).sort((a,b) => b.combined - a.combined);

    const temperature = 9;
    const exps = scored.map(x => Math.exp((x.combined - scored[0].combined) * temperature));
    const sum = exps.reduce((a,b) => a+b, 0) || 1;
    const top = scored.slice(0, 3).map((x, i) => ({ ...x, probability: exps[i] / sum }));
    const uncertain = top[0] && (top[0].combined < 0.52 || top[0].imageScore < 0.40);

    let html = `<h3>Wahrscheinlichste Sorten</h3><p class="hint">Auswertung aus ${recognizeItems.length} Foto${recognizeItems.length === 1 ? '' : 's'}${selectedTaste.length ? ', Geschmack' : ''}${selectedMonth ? ' und Reifezeit' : ''}${recognizeLocation ? ', Standort als Zusatzinfo' : ''}. Vergleichsfotos und Vergleichs-Standort werden nicht gespeichert.</p>`;
    if (uncertain) html += '<div class="warning"><strong>Keine sichere Bestimmung.</strong> Die beste Übereinstimmung ist noch zu schwach. Weitere Ansichten oder mehr Trainingsbilder können helfen.</div>';
    if (recognizeLocation) html += `<div class="location-result"><strong>📍 Standort:</strong> ${escapeHtml(formatLocation(recognizeLocation).replace('📍 ', ''))}<br><span class="hint">Der Standort ist in dieser Testversion noch kein Bewertungsfaktor. Später können regionale Vorkommen einbezogen werden.</span></div>`;
    html += top.map(x => {
      const pct = Math.round(x.probability * 100);
      const imgPct = Math.round(x.imageScore * 100);
      const tasteText = x.tasteScore === null ? 'nicht bewertet' : `${Math.round(x.tasteScore * 100)} % passend`;
      const ripeText = x.ripenessScore === null ? 'nicht bewertet' : `${Math.round(x.ripenessScore * 100)} % passend`;
      return `<div class="result-card">
        <div class="result-head"><h3>${escapeHtml(x.meta.name || x.name)} <small>(${escapeHtml(fruitLabel(x.meta.fruitType || x.fruitType))})</small></h3><span class="probability">${pct} %</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <p class="score-details">Bild: ${imgPct} % · Geschmack: ${tasteText} · Reifezeit: ${ripeText}</p>
        ${renderMetaHtml(x.meta)}
      </div>`;
    }).join('');
    html += '<p class="hint">Die Prozentwerte sind geschätzte relative Wahrscheinlichkeiten innerhalb deiner angelernten Sammlung – keine botanische Garantie.</p>';
    $('results').innerHTML = html;
  } catch (err) {
    console.error(err); alert('Die Erkennung ist fehlgeschlagen.');
  } finally { btn.textContent = 'Mit Fotos + Merkmalen bestimmen'; refreshActionButtons(); }
}

async function getSearchableVarieties() {
  const local = await getAllVarieties();
  const merged = new Map();
  for (const ref of REFERENCE_VARIETIES) merged.set(`ref:${ref.id}`, referenceToMeta(ref));
  for (const item of local) {
    const ref = findReferenceById(item.referenceId) || findReference(item.fruitType, item.name);
    const meta = enrichMeta(item);
    if (ref) merged.set(`ref:${ref.id}`, meta);
    else merged.set(`local:${item.key}`, meta);
  }
  return Array.from(merged.values());
}

async function searchVarieties() {
  const varieties = await getSearchableVarieties();
  if (!varieties.length) { $('searchResults').innerHTML = '<p class="hint">Noch keine Sorteninformationen vorhanden.</p>'; return; }
  const text = normalizeLookup($('searchText').value);
  const fruit = $('searchFruitType').value;
  const month = Number($('searchMonth').value) || null;
  const tastes = selectedTastes('searchTasteOptions');
  const examples = await getAllExamples();
  const photoByKey = new Map();
  for (const ex of examples) {
    const key = ex.varietyKey || makeVarietyKey(ex.fruitType || 'apple', ex.variety);
    if (!photoByKey.has(key) && ex.image) photoByKey.set(key, ex.image);
  }

  let rows = varieties.filter(v => fruit === 'all' || v.fruitType === fruit).map(v => {
    const hay = normalizeLookup(`${v.name || ''} ${v.synonyms || ''} ${v.origin || ''} ${v.description || ''} ${v.usage || ''} ${v.storage || ''} ${v.ripenessNote || ''} ${(v.regions || []).join(' ')} ${(v.categories || []).join(' ')}`);
    const textMatches = !text || hay.includes(text);
    const textScore = text ? (textMatches ? (normalizeLookup(v.name).includes(text) ? 1 : 0.75) : 0) : null;
    const tScore = tasteMatch(tastes, v.tastes || []);
    const rScore = ripenessMatch(month, v);
    let total = 0, weight = 0;
    if (textScore !== null) { total += textScore * 0.45; weight += 0.45; }
    if (tScore !== null) { total += tScore * 0.35; weight += 0.35; }
    if (rScore !== null) { total += rScore * 0.20; weight += 0.20; }
    if (!weight) { total = 1; weight = 1; }
    return { v, score: total / weight, photo: photoByKey.get(v.key) || null };
  }).filter(x => {
    if (!text) return true;
    const hay = normalizeLookup(`${x.v.name || ''} ${x.v.synonyms || ''} ${x.v.origin || ''} ${x.v.description || ''} ${x.v.usage || ''} ${x.v.storage || ''} ${x.v.ripenessNote || ''} ${(x.v.regions || []).join(' ')} ${(x.v.categories || []).join(' ')}`);
    return hay.includes(text);
  }).sort((a,b) => b.score - a.score || String(a.v.name).localeCompare(String(b.v.name), 'de')).slice(0, 30);

  if (!rows.length) { $('searchResults').innerHTML = '<p class="hint">Keine passende Sorte gefunden.</p>'; return; }
  $('searchResults').innerHTML = `<h3>Passende Sorten</h3><p class="hint">Enthält deine eigenen Sortendaten und ${REFERENCE_VARIETIES.length} eingebaute Fachdatensätze.</p>` + rows.map(x => {
    const pct = Math.round(x.score * 100);
    const knowledgeBadge = x.v.builtInKnowledge ? '<span class="badge knowledge-badge">Fachwissen</span>' : '';
    return `<div class="result-card"><div class="result-head"><h3>${escapeHtml(x.v.name)} <small>(${escapeHtml(fruitLabel(x.v.fruitType))})</small> ${knowledgeBadge}</h3>${(text || tastes.length || month) ? `<span class="probability">${pct} % passend</span>` : ''}</div>${renderMetaHtml(x.v)}</div>`;
  }).join('');
}

async function updateCollection() {
  const examples = await getAllExamples();
  let varieties = (await getAllVarieties()).map(enrichMeta);
  const metaByKey = new Map(varieties.map(v => [v.key, v]));
  const groups = new Map();
  for (const ex of examples) {
    const fruitType = ex.fruitType || 'apple';
    const key = ex.varietyKey || makeVarietyKey(fruitType, ex.variety);
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(ex);
    if (!metaByKey.has(key)) {
      const synthetic = enrichMeta({ key, fruitType, name: ex.variety, synonyms:'', origin:'', tastes:[], ripenessStart:null, ripenessEnd:null, ripenessNote:'', usage:'', storage:'', description:'', sources:[] });
      metaByKey.set(key, synthetic); varieties.push(synthetic);
    }
  }
  const entries = varieties.sort((a,b) => (a.name || '').localeCompare(b.name || '', 'de'));
  const list = $('collectionList');
  if (!entries.length) { list.innerHTML = '<p class="hint">Noch keine Sorten gespeichert.</p>'; return; }
  list.innerHTML = '';
  for (const meta of entries) {
    const items = groups.get(meta.key) || [];
    const card = document.createElement('div'); card.className = 'collection-item';
    let thumb = '';
    if (items[0]?.image) { const url = URL.createObjectURL(items[0].image); thumb = `<img class="thumb" src="${url}" alt="${escapeHtml(meta.name)}">`; }
    const counts = {};
    for (const item of items) counts[item.viewType || 'weitere'] = (counts[item.viewType || 'weitere'] || 0) + 1;
    const detail = VIEW_TYPES.filter(([key]) => counts[key]).map(([key, label]) => `${label}: ${counts[key]}`).join(' · ');
    const tastes = (meta.tastes || []).map(tasteLabel).join(', ');
    const ripe = meta.ripenessStart && meta.ripenessEnd ? `${monthLabel(meta.ripenessStart)}–${monthLabel(meta.ripenessEnd)}` : 'nicht angegeben';
    const knowledge = meta.builtInKnowledge ? '<span class="badge knowledge-badge">Fachwissen ergänzt</span>' : '';
    card.innerHTML = `<div class="collection-top">${thumb}<div class="collection-main"><strong>${escapeHtml(meta.name)}</strong> <span class="badge">${escapeHtml(fruitLabel(meta.fruitType))}</span> ${knowledge}<br><span class="count">${items.length} Trainingsfoto${items.length === 1 ? '' : 's'}</span><div class="collection-meta">${tastes ? `<strong>Geschmack:</strong> ${escapeHtml(tastes)}<br>` : ''}<strong>Reifezeit:</strong> ${escapeHtml(ripe)}${meta.usage ? `<br><strong>Verwendung:</strong> ${escapeHtml(meta.usage)}` : ''}${meta.description ? `<br><strong>Beschreibung:</strong> ${escapeHtml(meta.description)}` : ''}${detail ? `<div class="view-summary">${escapeHtml(detail)}</div>` : ''}</div></div></div>`;
    list.appendChild(card);
  }
}

async function ensureVarietyRecordsFromExamples() {
  const examples = await getAllExamples();
  const varieties = await getAllVarieties();
  const known = new Set(varieties.map(v => v.key));
  for (const ex of examples) {
    const fruitType = ex.fruitType || 'apple';
    const key = ex.varietyKey || makeVarietyKey(fruitType, ex.variety);
    if (known.has(key)) continue;
    await putVariety({ key, fruitType, name: normalizeName(ex.variety), synonyms:'', origin:'', tastes:[], ripenessStart:null, ripenessEnd:null, ripenessNote:'', usage:'', storage:'', description:'', sources:[], referenceId:null, createdAt: ex.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString() });
    known.add(key);
  }
}

async function initModel() {
  const status = $('modelStatus');
  try { model = await mobilenet.load({version: 2, alpha: 1.0}); status.innerHTML = '<strong>KI-Modell:</strong> bereit ✅'; refreshActionButtons(); }
  catch (err) { status.innerHTML = '<strong>KI-Modell:</strong> konnte nicht geladen werden. Für den ersten Start ist Internet nötig.'; console.error(err); }
}

function refreshActionButtons() {
  $('addTrainingBtn').disabled = !(model && trainItems.length);
  $('recognizeBtn').disabled = !(model && recognizeItems.length);
}

async function exportData() {
  const examples = await getAllExamples(); const varieties = await getAllVarieties();
  if (!examples.length && !varieties.length) return alert('Es gibt noch keine Daten zum Exportieren.');
  const portableExamples = [];
  for (const ex of examples) portableExamples.push({
    variety: ex.variety, varietyKey: ex.varietyKey || null, fruitType: ex.fruitType || 'apple', embedding: ex.embedding,
    createdAt: ex.createdAt, viewType: ex.viewType || 'weitere', setId: ex.setId || null, location: ex.location || null, image: ex.image ? await blobToDataUrl(ex.image) : null
  });
  const blob = new Blob([JSON.stringify({version:4, exportedAt:new Date().toISOString(), knowledgeVersion: window.SORTENWISSEN_VERSION || null, varieties, examples:portableExamples})], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `apfelbuch-daten-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(file) {
  const text = await file.text(); const data = JSON.parse(text);
  if (!data || ![1,2,3,4].includes(data.version) || !Array.isArray(data.examples)) throw new Error('Ungültiges Format');
  if (Array.isArray(data.varieties)) {
    for (const v of data.varieties) {
      if (!v?.name) continue; const fruitType = v.fruitType || 'apple'; const key = v.key || makeVarietyKey(fruitType, v.name);
      await putVariety({ ...v, key, fruitType, name: normalizeName(v.name), tastes: Array.isArray(v.tastes) ? v.tastes : [], sources: combineSources(v.sources), ripenessNote: v.ripenessNote || '', usage: v.usage || '', storage: v.storage || '' });
    }
  }
  for (const ex of data.examples) {
    if (!ex.variety || !Array.isArray(ex.embedding)) continue;
    const fruitType = ex.fruitType || 'apple'; const key = ex.varietyKey || makeVarietyKey(fruitType, ex.variety);
    await addExample({ variety: normalizeName(ex.variety), varietyKey: key, fruitType, embedding: ex.embedding, createdAt: ex.createdAt || new Date().toISOString(), viewType: ex.viewType || 'weitere', setId: ex.setId || null, location: ex.location || null, image: ex.image ? dataUrlToBlob(ex.image) : null });
    if (!(await getVariety(key))) await putVariety({ key, fruitType, name: normalizeName(ex.variety), synonyms:'', origin:'', tastes:[], ripenessStart:null, ripenessEnd:null, ripenessNote:'', usage:'', storage:'', description:'', sources:[], referenceId:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
  }
  await updateCollection();
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    btn.classList.add('active'); $(btn.dataset.tab).classList.add('active');
  }));
}

async function shareApp() {
  const shareData = { title: 'Apfelbuch', text: 'Apfel- und Birnensorten sammeln und bestimmen.', url: 'https://apfelfreunde.github.io/' };
  try {
    if (navigator.share) return await navigator.share(shareData);
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(shareData.url); return alert('Der Link wurde kopiert.'); }
    window.prompt('Diesen Link kopieren und weitergeben:', shareData.url);
  } catch (err) { if (err?.name !== 'AbortError') window.prompt('Diesen Link kopieren und weitergeben:', shareData.url); }
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; $('installBtn').classList.remove('hidden'); });
  $('installBtn').addEventListener('click', async () => { if (!deferredInstallPrompt) return; deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; $('installBtn').classList.add('hidden'); });
}

$('varietyName').addEventListener('input', () => { const ref = updateKnowledgeMatch(); if (ref) applyReferenceToForm(ref, false, true); syncKnownVarietyMenu(); });
$('varietyName').addEventListener('blur', () => { const ref = currentReference(); if (ref) applyReferenceToForm(ref, false, true); syncKnownVarietyMenu(); });
$('trainFruitType').addEventListener('change', () => { setupKnownVarietiesMenu(); const ref = updateKnowledgeMatch(); if (ref) applyReferenceToForm(ref, false, true); });
$('knownVarietyMenu').addEventListener('change', () => {
  const value = $('knownVarietyMenu').value;
  if (!value) { $('varietyName').value = ''; updateKnowledgeMatch(); return; }
  if (value === '__custom__') { $('varietyName').focus(); return; }
  $('varietyName').value = value; const ref = currentReference(); if (ref) applyReferenceToForm(ref, true, false);
});
$('applyKnowledgeBtn').addEventListener('click', () => { const ref = currentReference(); if (ref) applyReferenceToForm(ref, true, false); syncKnownVarietyMenu(); });

async function addTrainFiles(e) {
  const added = await buildItems(e.target.files, true, trainItems.length, MAX_FILES - trainItems.length); trainItems.push(...added); e.target.value = ''; renderTrainGrid(); refreshActionButtons();
}
async function addRecognizeFiles(e) {
  const added = await buildItems(e.target.files, false, recognizeItems.length, MAX_FILES - recognizeItems.length); recognizeItems.push(...added); e.target.value = ''; renderRecognizeGrid(); refreshActionButtons();
}
$('trainCamera').addEventListener('change', addTrainFiles);
$('trainGallery').addEventListener('change', addTrainFiles);
$('recognizeCamera').addEventListener('change', addRecognizeFiles);
$('recognizeGallery').addEventListener('change', addRecognizeFiles);
$('clearTrainSelectionBtn').addEventListener('click', () => { trainItems = []; $('trainCamera').value = ''; $('trainGallery').value = ''; renderTrainGrid(); refreshActionButtons(); });
$('clearRecognizeSelectionBtn').addEventListener('click', () => { recognizeItems = []; $('recognizeCamera').value = ''; $('recognizeGallery').value = ''; $('results').innerHTML = ''; renderRecognizeGrid(); refreshActionButtons(); });
$('trainLocationBtn').addEventListener('click', () => requestLocation('train'));
$('recognizeLocationBtn').addEventListener('click', () => requestLocation('recognize'));
$('clearTrainLocationBtn').addEventListener('click', () => clearLocation('train'));
$('clearRecognizeLocationBtn').addEventListener('click', () => clearLocation('recognize'));
$('shareBtn').addEventListener('click', shareApp);
$('saveVarietyBtn').addEventListener('click', () => saveVarietyMetadata(true, false).catch(err => { console.error(err); alert('Sortendaten konnten nicht gespeichert werden.'); }));
$('addTrainingBtn').addEventListener('click', addTrainingExamples);
$('recognizeBtn').addEventListener('click', recognize);
$('searchBtn').addEventListener('click', searchVarieties);
$('exportBtn').addEventListener('click', () => exportData().catch(err => { console.error(err); alert('Export fehlgeschlagen.'); }));
$('importFile').addEventListener('change', async e => {
  try { if (!e.target.files[0]) return; await importData(e.target.files[0]); alert('Daten wurden importiert.'); }
  catch (err) { console.error(err); alert('Import fehlgeschlagen oder Datei ungültig.'); }
  finally { e.target.value = ''; }
});
$('clearBtn').addEventListener('click', async () => {
  if (confirm('Wirklich alle Sortenbeschreibungen, Trainingsfotos und KI-Trainingsdaten löschen?')) { await clearAllData(); await updateCollection(); $('results').innerHTML = ''; $('searchResults').innerHTML = ''; }
});

renderTasteChoices('trainTasteOptions', 'train');
renderTasteChoices('recognizeTasteOptions', 'recognize');
renderTasteChoices('searchTasteOptions', 'search');
setupMonthSelect('ripenessStart', true);
setupMonthSelect('ripenessEnd', true);
setupMonthSelect('recognizeMonth', true);
setupMonthSelect('searchMonth', true);
setupKnownVarietiesDatalist();
setupKnownVarietiesMenu();
renderLocation('train');
renderLocation('recognize');
updateKnowledgeMatch();
setupTabs();
const initialTab = new URLSearchParams(location.search).get('bereich');
if (['learn','recognize','search','collection'].includes(initialTab)) document.querySelector(`.tab[data-tab="${initialTab}"]`)?.click();
setupInstall();
ensureVarietyRecordsFromExamples().then(updateCollection).catch(console.error);
initModel();

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.error));
