const DB_NAME = 'apfelbuch-db';
const DB_VERSION = 1;
const STORE = 'examples';
const MAX_FILES = 15;
let model = null;
let deferredInstallPrompt = null;
let trainItems = [];
let recognizeItems = [];

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

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('variety', 'variety', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addExample(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

async function getAllExamples() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

async function clearExamples() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
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
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Bild konnte nicht geladen werden'));
    };
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
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function typeLabel(value) {
  return (VIEW_TYPES.find(x => x[0] === value) || [null, 'Weitere'])[1];
}

function makeTypeSelect(selected, index) {
  const select = document.createElement('select');
  select.className = 'view-type-select';
  select.dataset.index = index;
  for (const [value, label] of VIEW_TYPES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === selected;
    select.appendChild(opt);
  }
  return select;
}

async function buildItems(files, withTypes, startIndex = 0, availableSlots = MAX_FILES) {
  const chosen = Array.from(files || []);
  if (availableSlots <= 0) {
    alert(`Der Fotosatz ist bereits voll. Maximal ${MAX_FILES} Fotos sind erlaubt.`);
    return [];
  }
  if (chosen.length > availableSlots) {
    alert(`In diesem Fotosatz sind noch ${availableSlots} Platz/Plätze frei. Es werden nur die ersten ${availableSlots} neuen Fotos übernommen.`);
  }
  const limited = chosen.slice(0, availableSlots);
  const items = [];
  for (let i = 0; i < limited.length; i++) {
    try {
      const img = await loadImageFromFile(limited[i]);
      const position = startIndex + i;
      items.push({
        file: limited[i],
        img,
        type: withTypes ? (DEFAULT_TYPES[position] || 'weitere') : 'weitere'
      });
    } catch (err) {
      console.error(err);
    }
  }
  return items;
}

function renderTrainGrid() {
  const grid = $('trainPreviewGrid');
  grid.innerHTML = '';
  $('trainCount').textContent = trainItems.length ? `${trainItems.length} von ${MAX_FILES} Fotos ausgewählt.` : 'Noch keine Fotos ausgewählt.';

  trainItems.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'photo-card';
    const img = item.img.cloneNode();
    img.className = 'multi-preview';
    img.alt = `Trainingsfoto ${index + 1}`;
    const number = document.createElement('div');
    number.className = 'photo-number';
    number.textContent = `Foto ${index + 1}`;
    const select = makeTypeSelect(item.type, index);
    select.addEventListener('change', () => { trainItems[index].type = select.value; });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-photo';
    remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => {
      trainItems.splice(index, 1);
      renderTrainGrid();
      refreshActionButtons();
    });
    card.append(img, number, select, remove);
    grid.appendChild(card);
  });
}

function renderRecognizeGrid() {
  const grid = $('recognizePreviewGrid');
  grid.innerHTML = '';
  $('recognizeCount').textContent = recognizeItems.length ? `${recognizeItems.length} von ${MAX_FILES} Fotos ausgewählt.` : 'Noch keine Fotos ausgewählt.';
  recognizeItems.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'photo-card simple';
    const img = item.img.cloneNode();
    img.className = 'multi-preview';
    img.alt = `Erkennungsfoto ${index + 1}`;
    const number = document.createElement('div');
    number.className = 'photo-number';
    number.textContent = `Foto ${index + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-photo';
    remove.textContent = 'Entfernen';
    remove.addEventListener('click', () => {
      recognizeItems.splice(index, 1);
      renderRecognizeGrid();
      refreshActionButtons();
    });
    card.append(img, number, remove);
    grid.appendChild(card);
  });
}

async function updateCollection() {
  const examples = await getAllExamples();
  const groups = {};
  for (const ex of examples) (groups[ex.variety] ||= []).push(ex);
  const entries = Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0], 'de'));
  const list = $('collectionList');
  if (!entries.length) {
    list.innerHTML = '<p class="hint">Noch keine Sorten angelernt.</p>';
    return;
  }
  list.innerHTML = '';
  for (const [name, items] of entries) {
    const card = document.createElement('div');
    card.className = 'collection-item';
    let thumb = '';
    if (items[0].image) {
      const url = URL.createObjectURL(items[0].image);
      thumb = `<img class="thumb" src="${url}" alt="${escapeHtml(name)}">`;
    }
    const counts = {};
    for (const item of items) counts[item.viewType || 'weitere'] = (counts[item.viewType || 'weitere'] || 0) + 1;
    const detail = VIEW_TYPES
      .filter(([key]) => counts[key])
      .map(([key, label]) => `${label}: ${counts[key]}`)
      .join(' · ');
    card.innerHTML = `${thumb}<strong>${escapeHtml(name)}</strong><br><span class="count">${items.length} Trainingsfoto${items.length === 1 ? '' : 's'}</span>${detail ? `<div class="view-summary">${escapeHtml(detail)}</div>` : ''}`;
    list.appendChild(card);
  }
}

async function initModel() {
  const status = $('modelStatus');
  try {
    model = await mobilenet.load({version: 2, alpha: 1.0});
    status.innerHTML = '<strong>KI-Modell:</strong> bereit ✅';
    refreshActionButtons();
  } catch (err) {
    status.innerHTML = '<strong>KI-Modell:</strong> konnte nicht geladen werden. Für den ersten Start ist Internet nötig.';
    console.error(err);
  }
}

function refreshActionButtons() {
  $('addTrainingBtn').disabled = !(model && trainItems.length);
  $('recognizeBtn').disabled = !(model && recognizeItems.length);
}

function missingRecommendedTypes() {
  const have = new Set(trainItems.map(x => x.type));
  return ['profil', 'stielgrube', 'kelchgrube', 'schnittbild'].filter(x => !have.has(x));
}

async function addTrainingExamples() {
  const name = normalizeName($('varietyName').value);
  if (!name) return alert('Bitte zuerst einen Sortennamen eingeben.');
  if (!trainItems.length) return alert('Bitte zuerst mindestens ein Foto auswählen.');

  const missing = missingRecommendedTypes();
  if (trainItems.length >= 4 && missing.length) {
    const labels = missing.map(typeLabel).join(', ');
    const ok = confirm(`Bei diesem Fotosatz fehlen noch empfohlene Ansichten: ${labels}.\n\nTrotzdem anlernen?`);
    if (!ok) return;
  }

  const btn = $('addTrainingBtn');
  btn.disabled = true;
  const setId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  let saved = 0;
  try {
    for (let i = 0; i < trainItems.length; i++) {
      btn.textContent = `Foto ${i + 1}/${trainItems.length} wird angelernt …`;
      const item = trainItems[i];
      const emb = await embeddingFromImage(item.img);
      const storedImage = await imageToStoredBlob(item.img, item.file);
      await addExample({
        variety: name,
        embedding: emb,
        image: storedImage,
        viewType: item.type,
        setId,
        createdAt: new Date().toISOString()
      });
      saved++;
    }
    const examples = await getAllExamples();
    const count = examples.filter(x => x.variety === name).length;
    await updateCollection();
    alert(`${name}: ${saved} Fotos gespeichert und angelernt. Insgesamt ${count} Trainingsfotos für diese Sorte.`);
    trainItems = [];
    $('trainImages').value = '';
    renderTrainGrid();
  } catch (err) {
    console.error(err);
    alert(`Es wurden ${saved} Fotos gespeichert. Danach ist beim Verarbeiten eines Fotos ein Fehler aufgetreten.`);
  } finally {
    btn.textContent = 'Ausgewählte Fotos anlernen';
    refreshActionButtons();
  }
}

async function recognize() {
  if (!recognizeItems.length) return alert('Bitte zuerst mindestens ein Foto auswählen.');
  const examples = await getAllExamples();
  if (!examples.length) return alert('Bitte zuerst mindestens eine Apfelsorte anlernen.');

  const groups = {};
  for (const ex of examples) (groups[ex.variety] ||= []).push(ex.embedding);

  const btn = $('recognizeBtn');
  btn.disabled = true;
  $('results').innerHTML = '';

  try {
    const queries = [];
    for (let i = 0; i < recognizeItems.length; i++) {
      btn.textContent = `Foto ${i + 1}/${recognizeItems.length} wird ausgewertet …`;
      queries.push(await embeddingFromImage(recognizeItems[i].img));
    }
    const query = averageEmbedding(queries);
    const scored = Object.entries(groups).map(([name, vectors]) => ({
      name,
      score: Math.max(0, cosineSimilarity(query, averageEmbedding(vectors)))
    })).sort((a,b) => b.score - a.score);

    const expsAll = scored.map(x => Math.exp((x.score - scored[0].score) * 12));
    const sum = expsAll.reduce((a,b) => a+b, 0) || 1;
    const top = scored.slice(0, 3).map((x, i) => ({...x, probability: expsAll[i] / sum}));

    $('results').innerHTML = `<h3>Wahrscheinlichste Sorten</h3><p class="hint">Auswertung aus ${recognizeItems.length} Foto${recognizeItems.length === 1 ? '' : 's'}. Diese Vergleichsfotos werden nicht gespeichert.</p>` + top.map(x => {
      const pct = Math.round(x.probability * 100);
      return `<div class="result-item"><strong>${escapeHtml(x.name)}</strong><span>${pct} %</span><div class="bar"><span style="width:${pct}%"></span></div></div>`;
    }).join('') + '<p class="hint">Die Prozentwerte sind relative Ähnlichkeiten innerhalb deiner Sammlung, keine botanische Garantie.</p>';
  } catch (err) {
    console.error(err);
    alert('Die Erkennung ist fehlgeschlagen.');
  } finally {
    btn.textContent = 'Mit allen Fotos erkennen';
    refreshActionButtons();
  }
}

async function exportData() {
  const examples = await getAllExamples();
  if (!examples.length) return alert('Es gibt noch keine Trainingsdaten zum Exportieren.');
  const portable = [];
  for (const ex of examples) {
    portable.push({
      variety: ex.variety,
      embedding: ex.embedding,
      createdAt: ex.createdAt,
      viewType: ex.viewType || 'weitere',
      setId: ex.setId || null,
      image: ex.image ? await blobToDataUrl(ex.image) : null
    });
  }
  const blob = new Blob([JSON.stringify({version:2, exportedAt:new Date().toISOString(), examples:portable})], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apfelbuch-training-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || ![1,2].includes(data.version) || !Array.isArray(data.examples)) throw new Error('Ungültiges Format');
  for (const ex of data.examples) {
    if (!ex.variety || !Array.isArray(ex.embedding)) continue;
    await addExample({
      variety: normalizeName(ex.variety),
      embedding: ex.embedding,
      createdAt: ex.createdAt || new Date().toISOString(),
      viewType: ex.viewType || 'weitere',
      setId: ex.setId || null,
      image: ex.image ? dataUrlToBlob(ex.image) : null
    });
  }
  await updateCollection();
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
  }));
}

async function shareApp() {
  const shareData = {
    title: 'Apfelbuch',
    text: 'Schau dir die Apfelbuch-App zur Sammlung und Erkennung von Apfelsorten an.',
    url: 'https://apfelfreunde.github.io/'
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(shareData.url);
      alert('Der Link zur Apfelbuch-App wurde kopiert. Du kannst ihn jetzt z. B. in WhatsApp oder E-Mail einfügen.');
      return;
    }
    window.prompt('Diesen Link kopieren und weitergeben:', shareData.url);
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.error(err);
      window.prompt('Diesen Link kopieren und weitergeben:', shareData.url);
    }
  }
}

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    $('installBtn').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('installBtn').classList.add('hidden');
  });
}

$('trainImages').addEventListener('change', async (e) => {
  const added = await buildItems(e.target.files, true, trainItems.length, MAX_FILES - trainItems.length);
  trainItems.push(...added);
  e.target.value = '';
  renderTrainGrid();
  refreshActionButtons();
});

$('recognizeImages').addEventListener('change', async (e) => {
  const added = await buildItems(e.target.files, false, recognizeItems.length, MAX_FILES - recognizeItems.length);
  recognizeItems.push(...added);
  e.target.value = '';
  renderRecognizeGrid();
  refreshActionButtons();
});

$('clearTrainSelectionBtn').addEventListener('click', () => {
  trainItems = [];
  $('trainImages').value = '';
  renderTrainGrid();
  refreshActionButtons();
});

$('clearRecognizeSelectionBtn').addEventListener('click', () => {
  recognizeItems = [];
  $('recognizeImages').value = '';
  $('results').innerHTML = '';
  renderRecognizeGrid();
  refreshActionButtons();
});

$('shareBtn').addEventListener('click', shareApp);
$('addTrainingBtn').addEventListener('click', addTrainingExamples);
$('recognizeBtn').addEventListener('click', recognize);
$('exportBtn').addEventListener('click', () => exportData().catch(err => { console.error(err); alert('Export fehlgeschlagen.'); }));
$('importFile').addEventListener('change', async (e) => {
  try {
    if (!e.target.files[0]) return;
    await importData(e.target.files[0]);
    alert('Trainingsdaten wurden importiert.');
  } catch (err) {
    console.error(err);
    alert('Import fehlgeschlagen oder Datei ungültig.');
  } finally { e.target.value = ''; }
});
$('clearBtn').addEventListener('click', async () => {
  if (confirm('Wirklich alle angelernten Sorten, Fotos und Trainingsdaten löschen?')) {
    await clearExamples();
    await updateCollection();
    $('results').innerHTML = '';
  }
});

setupTabs();
const initialTab = new URLSearchParams(location.search).get('bereich');
if (['learn', 'recognize', 'collection'].includes(initialTab)) {
  const target = document.querySelector(`.tab[data-tab="${initialTab}"]`);
  if (target) target.click();
}
setupInstall();
updateCollection().catch(console.error);
initModel();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.error));
}
