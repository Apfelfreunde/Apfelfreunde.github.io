const DB_NAME = 'apfelbuch-db';
const DB_VERSION = 1;
const STORE = 'examples';
let model = null;
let deferredInstallPrompt = null;
let trainImageEl = null;
let recognizeImageEl = null;
let trainFile = null;

const $ = (id) => document.getElementById(id);

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

function fileToImage(file, preview) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Keine Datei ausgewählt'));
    const url = URL.createObjectURL(file);
    preview.onload = () => {
      URL.revokeObjectURL(url);
      preview.classList.remove('hidden');
      resolve(preview);
    };
    preview.onerror = reject;
    preview.src = url;
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
    card.innerHTML = `${thumb}<strong>${escapeHtml(name)}</strong><br><span class="count">${items.length} Trainingsfoto${items.length === 1 ? '' : 's'}</span>`;
    list.appendChild(card);
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

async function initModel() {
  const status = $('modelStatus');
  try {
    model = await mobilenet.load({version: 2, alpha: 1.0});
    status.innerHTML = '<strong>KI-Modell:</strong> bereit ✅';
    $('addTrainingBtn').disabled = false;
    $('recognizeBtn').disabled = false;
  } catch (err) {
    status.innerHTML = '<strong>KI-Modell:</strong> konnte nicht geladen werden. Für den ersten Start ist Internet nötig.';
    console.error(err);
  }
}

async function addTrainingExample() {
  const name = normalizeName($('varietyName').value);
  if (!name) return alert('Bitte zuerst einen Sortennamen eingeben.');
  if (!trainImageEl || !trainFile) return alert('Bitte zuerst ein Foto auswählen.');

  const btn = $('addTrainingBtn');
  btn.disabled = true;
  btn.textContent = 'Wird angelernt …';
  try {
    const emb = await embeddingFromImage(trainImageEl);
    await addExample({ variety: name, embedding: emb, image: trainFile, createdAt: new Date().toISOString() });
    const examples = await getAllExamples();
    const count = examples.filter(x => x.variety === name).length;
    await updateCollection();
    alert(`${name}: Trainingsfoto gespeichert. Insgesamt ${count}.`);
  } catch (err) {
    console.error(err);
    alert('Das Foto konnte nicht verarbeitet werden.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Foto als Beispiel speichern';
  }
}

async function recognize() {
  if (!recognizeImageEl) return alert('Bitte zuerst ein Foto auswählen.');
  const examples = await getAllExamples();
  if (!examples.length) return alert('Bitte zuerst mindestens eine Apfelsorte anlernen.');

  const groups = {};
  for (const ex of examples) (groups[ex.variety] ||= []).push(ex.embedding);

  const btn = $('recognizeBtn');
  btn.disabled = true;
  btn.textContent = 'Wird erkannt …';
  $('results').innerHTML = '';

  try {
    const query = await embeddingFromImage(recognizeImageEl);
    const scored = Object.entries(groups).map(([name, vectors]) => ({
      name,
      score: Math.max(0, cosineSimilarity(query, averageEmbedding(vectors)))
    })).sort((a,b) => b.score - a.score);

    const expsAll = scored.map(x => Math.exp((x.score - scored[0].score) * 12));
    const sum = expsAll.reduce((a,b) => a+b, 0) || 1;
    const top = scored.slice(0, 3).map((x, i) => ({...x, probability: expsAll[i] / sum}));

    $('results').innerHTML = '<h3>Wahrscheinlichste Sorten</h3>' + top.map(x => {
      const pct = Math.round(x.probability * 100);
      return `<div class="result-item"><strong>${escapeHtml(x.name)}</strong><span>${pct} %</span><div class="bar"><span style="width:${pct}%"></span></div></div>`;
    }).join('') + '<p class="hint">Die Prozentwerte sind relative Ähnlichkeiten innerhalb deiner Sammlung, keine botanische Garantie.</p>';
  } catch (err) {
    console.error(err);
    alert('Die Erkennung ist fehlgeschlagen.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Erkennen';
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
      image: ex.image ? await blobToDataUrl(ex.image) : null
    });
  }
  const blob = new Blob([JSON.stringify({version:1, exportedAt:new Date().toISOString(), examples:portable})], {type:'application/json'});
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
  if (!data || data.version !== 1 || !Array.isArray(data.examples)) throw new Error('Ungültiges Format');
  for (const ex of data.examples) {
    if (!ex.variety || !Array.isArray(ex.embedding)) continue;
    await addExample({
      variety: normalizeName(ex.variety),
      embedding: ex.embedding,
      createdAt: ex.createdAt || new Date().toISOString(),
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

$('trainImage').addEventListener('change', async (e) => {
  try {
    trainFile = e.target.files[0] || null;
    trainImageEl = await fileToImage(trainFile, $('trainPreview'));
  } catch (err) { console.error(err); }
});

$('recognizeImage').addEventListener('change', async (e) => {
  try { recognizeImageEl = await fileToImage(e.target.files[0], $('recognizePreview')); }
  catch (err) { console.error(err); }
});

$('addTrainingBtn').addEventListener('click', addTrainingExample);
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

// Öffnet bei PWA-/Android-Shortcuts direkt den gewünschten Bereich.
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
