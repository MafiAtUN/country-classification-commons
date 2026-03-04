const DATA_BASES = [
  '/country-classification-commons/data/',
  'data/',
  './data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/docs/data/'
];

const state = {
  countries: [],
  memberships: []
};

const els = {
  error: document.querySelector('#load-error'),
  search: document.querySelector('#search'),
  source: document.querySelector('#source-filter'),
  type: document.querySelector('#type-filter'),
  resultCount: document.querySelector('#result-count'),
  body: document.querySelector('#country-body'),
  snapshot: document.querySelector('#snapshot-meta')
};

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'text';
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const text = (xhr.responseText || '').trim();
          return resolve(JSON.parse(text));
        } catch (e) {
          return reject(new Error(`${url} -> invalid JSON`));
        }
      }
      reject(new Error(`${url} -> HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error(`${url} -> network error`));
    xhr.send();
  });
}

async function loadJson(file) {
  const tries = [];
  for (const base of DATA_BASES) {
    const url = `${base}${file}`;
    try {
      return await requestJson(url);
    } catch (err) {
      tries.push(err.message);
    }
  }
  throw new Error(`Failed to load ${file}. Tried: ${tries.join(' | ')}`);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function membershipsByIso3() {
  const map = new Map();
  for (const m of state.memberships) {
    if (!map.has(m.iso3)) map.set(m.iso3, []);
    map.get(m.iso3).push(m);
  }
  return map;
}

function fillSelect(select, values) {
  const current = select.value;
  select.innerHTML = '<option value="">All</option>';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  if (values.includes(current)) select.value = current;
}

function apply() {
  const q = els.search.value.trim().toLowerCase();
  const src = els.source.value;
  const type = els.type.value;
  const idx = membershipsByIso3();

  const filtered = state.countries.filter((c) => {
    const text = `${c.country_name_en || ''} ${c.iso3 || ''} ${c.iso2 || ''} ${c.m49 || ''}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    const groups = idx.get(c.iso3) || [];
    if (!src && !type) return true;
    return groups.some((g) => (!src || g.source === src) && (!type || g.group_type === type));
  });

  els.body.innerHTML = '';
  for (const c of filtered) {
    const count = (idx.get(c.iso3) || []).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.country_name_en || ''}</td>
      <td>${c.iso3 || ''}</td>
      <td>${c.m49 || ''}</td>
      <td>${c.region_name_en || ''}</td>
      <td>${c.wb_income_name || ''}</td>
      <td><span class="pill">${count}</span></td>
    `;
    els.body.appendChild(tr);
  }

  els.resultCount.textContent = `${filtered.length} shown`;
}

async function main() {
  try {
    const [countries, memberships, manifest] = await Promise.all([
      loadJson('countries_master.json'),
      loadJson('country_group_membership.json'),
      loadJson('run_manifest.json')
    ]);

    state.countries = Array.isArray(countries) ? countries : [];
    state.memberships = Array.isArray(memberships) ? memberships : [];

    fillSelect(els.source, unique(state.memberships.map((m) => m.source)));
    fillSelect(els.type, unique(state.memberships.map((m) => m.group_type)));

    els.search.addEventListener('input', apply);
    els.source.addEventListener('change', apply);
    els.type.addEventListener('change', apply);

    const snap = manifest?.snapshot_id || 'n/a';
    const ts = manifest?.generated_at_utc || 'n/a';
    els.snapshot.textContent = `Snapshot: ${snap} | Generated (UTC): ${ts}`;

    apply();
  } catch (err) {
    els.error.classList.remove('hidden');
    els.error.textContent = err.message;
    els.resultCount.textContent = 'Load failed';
    els.snapshot.textContent = 'Could not load data. Use Downloads page links.';
  }
}

main();
