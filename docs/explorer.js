// Data base URLs tried in order. The first that returns valid JSON wins.
const DATA_BASES = [
  '/country-classification-commons/data/',
  'data/',
  './data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/docs/data/',
];

const CHART_COLORS = [
  '#0b6e4f','#1a9e73','#3cc498','#6fd3b7','#a8e8d8',
  '#f4a261','#e76f51','#264653','#2a9d8f','#e9c46a','#457b9d','#a8dadc',
];

const state = {
  countries: [],
  memberships: [],
  charts: {},
};

const els = {
  error: document.querySelector('#load-error'),
  search: document.querySelector('#search'),
  source: document.querySelector('#source-filter'),
  type: document.querySelector('#type-filter'),
  income: document.querySelector('#income-filter'),
  region: document.querySelector('#region-filter'),
  resultCount: document.querySelector('#result-count'),
  body: document.querySelector('#country-body'),
  snapshot: document.querySelector('#snapshot-meta'),
  detailPanel: document.querySelector('#detail-panel'),
  detailLabel: document.querySelector('#detail-label'),
  detailBody: document.querySelector('#detail-body'),
};

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadJson(file) {
  const tried = [];
  for (const base of DATA_BASES) {
    const url = `${base}${file}`;
    try {
      const res = await fetch(url);
      if (!res.ok) { tried.push(`${url} → HTTP ${res.status}`); continue; }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        tried.push(`${url} → invalid JSON`);
        continue;
      }
    } catch (err) {
      tried.push(`${url} → ${err.message}`);
    }
  }
  throw new Error(`Failed to load ${file}. Tried: ${tried.join(' | ')}`);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function unique(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(sel, values) {
  const current = sel.value;
  const first = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(first);
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  if (values.includes(current)) sel.value = current;
}

function flag(val) {
  return String(val).toLowerCase() === 'true';
}

function membershipsByIso3() {
  const map = new Map();
  for (const m of state.memberships) {
    if (!map.has(m.iso3)) map.set(m.iso3, []);
    map.get(m.iso3).push(m);
  }
  return map;
}

// ── Charts ────────────────────────────────────────────────────────────────────

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function buildIncomeChart(countries) {
  destroyChart('income');
  const counts = {};
  for (const c of countries) {
    const k = c.wb_income_name || 'Not classified';
    counts[k] = (counts[k] || 0) + 1;
  }
  const order = ['Low income','Lower middle income','Upper middle income','High income','Not classified','Aggregates'];
  const labels = order.filter(k => counts[k]);
  const data = labels.map(k => counts[k]);
  state.charts.income = new Chart(document.querySelector('#chart-income'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: CHART_COLORS.slice(0, labels.length), borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${ctx.parsed.y} countries`
      }}},
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
}

function buildRegionChart(countries) {
  destroyChart('region');
  const counts = {};
  for (const c of countries) {
    const k = c.region_name_en || 'Unclassified';
    counts[k] = (counts[k] || 0) + 1;
  }
  const labels = Object.keys(counts).sort((a,b) => counts[b]-counts[a]);
  const data = labels.map(k => counts[k]);
  state.charts.region = new Chart(document.querySelector('#chart-region'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: CHART_COLORS.slice(0, labels.length), borderWidth: 0 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${ctx.parsed.x} countries`
      }}},
      scales: { x: { beginAtZero: true } },
    },
  });
}

function buildSpecialChart(countries) {
  destroyChart('special');
  const n = countries.length;
  const ldc  = countries.filter(c => flag(c.is_ldc)).length;
  const lldc = countries.filter(c => flag(c.is_lldc)).length;
  const sids = countries.filter(c => flag(c.is_sids)).length;
  const fcs  = countries.filter(c => flag(c.wb_fcs_status)).length;
  const oda  = countries.filter(c => flag(c.oecd_dac_eligible)).length;
  const labels = ['LDC','LLDC','SIDS','FCS','ODA-eligible'];
  const data   = [ldc, lldc, sids, fcs, oda];
  state.charts.special = new Chart(document.querySelector('#chart-special'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: CHART_COLORS, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${ctx.parsed.y} of ${n} countries`
      }}},
      scales: { y: { beginAtZero: true, max: n } },
    },
  });
}

function buildHistChart(countries) {
  destroyChart('hist');
  const idx = membershipsByIso3();
  const buckets = {};
  for (const c of countries) {
    const cnt = (idx.get(c.iso3) || []).length;
    const bucket = Math.floor(cnt / 5) * 5;
    const label = `${bucket}–${bucket+4}`;
    buckets[label] = (buckets[label] || 0) + 1;
  }
  const labels = Object.keys(buckets).sort((a,b) => parseInt(a)-parseInt(b));
  const data = labels.map(k => buckets[k]);
  state.charts.hist = new Chart(document.querySelector('#chart-hist'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: '#0b6e4f', borderWidth: 0 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: ctx => ` ${ctx.parsed.y} countries`
      }}},
      scales: { x: { title: { display: true, text: 'Number of groups' } }, y: { beginAtZero: true } },
    },
  });
}

function renderCharts(countries) {
  buildIncomeChart(countries);
  buildRegionChart(countries);
  buildSpecialChart(countries);
  buildHistChart(countries);
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function renderStats(countries) {
  const idx = membershipsByIso3();
  document.querySelector('#stat-total').textContent = countries.length;
  document.querySelector('#stat-memberships').textContent = state.memberships.length.toLocaleString();
  document.querySelector('#stat-ldc').textContent = countries.filter(c => flag(c.is_ldc)).length;
  document.querySelector('#stat-fcs').textContent = countries.filter(c => flag(c.wb_fcs_status)).length;
  document.querySelector('#stat-oecd').textContent = countries.filter(c => flag(c.oecd_dac_eligible)).length;
  document.querySelector('#stat-sids').textContent = countries.filter(c => flag(c.is_sids)).length;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderTable(filtered) {
  const idx = membershipsByIso3();
  els.body.innerHTML = '';
  for (const c of filtered) {
    const count = (idx.get(c.iso3) || []).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.country_name_en || ''}</td>
      <td><code>${c.iso3 || ''}</code></td>
      <td>${c.iso2 || ''}</td>
      <td>${c.m49 || ''}</td>
      <td>${c.region_name_en || ''}</td>
      <td>${c.wb_income_name || ''}</td>
      <td>${flag(c.is_ldc) ? '<span class="pill pill-yes">LDC</span>' : ''}</td>
      <td>${flag(c.is_lldc) ? '<span class="pill pill-yes">LLDC</span>' : ''}</td>
      <td>${flag(c.is_sids) ? '<span class="pill pill-yes">SIDS</span>' : ''}</td>
      <td>${flag(c.wb_fcs_status) ? '<span class="pill pill-warn">' + (c.wb_fcs_category || 'FCS') + '</span>' : ''}</td>
      <td>${flag(c.oecd_dac_eligible) ? '<span class="pill pill-oda">ODA</span>' : ''}</td>
      <td><span class="pill">${count}</span></td>
      <td><button class="btn btn-sm view-btn" data-iso3="${c.iso3}" type="button">View</button></td>
    `;
    els.body.appendChild(tr);
  }
  els.body.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => showDetail(btn.dataset.iso3));
  });
  els.resultCount.textContent = `${filtered.length} shown`;
}

// ── Country detail ────────────────────────────────────────────────────────────

function showDetail(iso3) {
  const country = state.countries.find(c => c.iso3 === iso3);
  const memberships = state.memberships
    .filter(m => m.iso3 === iso3)
    .sort((a,b) => `${a.source}:${a.group_type}:${a.group_name}`.localeCompare(`${b.source}:${b.group_type}:${b.group_name}`));

  els.detailLabel.textContent = `${country?.country_name_en || iso3} (${iso3}) — ${memberships.length} group memberships`;
  els.detailBody.innerHTML = '';
  for (const m of memberships) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.source}</td><td>${m.group_type}</td><td>${m.group_code || ''}</td><td>${m.group_name}</td>`;
    els.detailBody.appendChild(tr);
  }
  els.detailPanel.style.display = '';
  els.detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Filter & apply ────────────────────────────────────────────────────────────

function apply() {
  const q      = els.search.value.trim().toLowerCase();
  const src    = els.source.value;
  const type   = els.type.value;
  const income = els.income.value;
  const region = els.region.value;
  const idx    = membershipsByIso3();

  const filtered = state.countries.filter(c => {
    // text search
    const text = `${c.country_name_en||''} ${c.country_name_ar||''} ${c.country_name_fr||''} ${c.iso3||''} ${c.iso2||''} ${c.m49||''}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    // dropdown filters
    if (income && c.wb_income_name !== income) return false;
    if (region && c.region_name_en !== region) return false;
    // membership source/type filters
    if (src || type) {
      const groups = idx.get(c.iso3) || [];
      return groups.some(g => (!src || g.source === src) && (!type || g.group_type === type));
    }
    return true;
  });

  renderTable(filtered);
  renderCharts(filtered);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  try {
    const [countries, memberships, manifest] = await Promise.all([
      loadJson('countries_master.json'),
      loadJson('country_group_membership.json'),
      loadJson('run_manifest.json').catch(() => null),
    ]);

    state.countries  = Array.isArray(countries)   ? countries   : [];
    state.memberships = Array.isArray(memberships) ? memberships : [];

    fillSelect(els.source, unique(state.memberships.map(m => m.source)));
    fillSelect(els.type,   unique(state.memberships.map(m => m.group_type)));
    fillSelect(els.income, unique(state.countries.map(c => c.wb_income_name)));
    fillSelect(els.region, unique(state.countries.map(c => c.region_name_en)));

    const snap = manifest?.snapshot_id || 'n/a';
    const ts   = manifest?.generated_at_utc ? new Date(manifest.generated_at_utc).toUTCString() : 'n/a';
    els.snapshot.innerHTML = `Snapshot <strong>${snap}</strong> &nbsp;|&nbsp; Generated (UTC): ${ts} &nbsp;|&nbsp; ${state.countries.length} countries &nbsp;·&nbsp; ${state.memberships.length.toLocaleString()} memberships`;

    renderStats(state.countries);

    for (const el of [els.search, els.source, els.type, els.income, els.region]) {
      el.addEventListener('input', apply);
      el.addEventListener('change', apply);
    }

    apply();
  } catch (err) {
    els.error.classList.remove('hidden');
    els.error.textContent = err.message;
    els.resultCount.textContent = 'Load failed';
    els.snapshot.textContent = 'Could not load data. Please try the Downloads page.';
  }
}

main();
