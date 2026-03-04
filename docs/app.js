const state = {
  countries: [],
  memberships: [],
  sources: [],
  manifest: null,
  chart: null,
};

const els = {
  search: document.querySelector('#search'),
  sourceFilter: document.querySelector('#source-filter'),
  typeFilter: document.querySelector('#type-filter'),
  groupFilter: document.querySelector('#group-filter'),
  countryBody: document.querySelector('#country-body'),
  resultCount: document.querySelector('#result-count'),
  quickStats: document.querySelector('#quick-stats'),
  sources: document.querySelector('#sources'),
  snapshotMeta: document.querySelector('#snapshot-meta'),
  chartCanvas: document.querySelector('#membership-chart'),
  selectedLabel: document.querySelector('#selected-country-label'),
  selectedMemberships: document.querySelector('#selected-memberships'),
};

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function setSelectOptions(selectEl, values) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">All</option>';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  }
  if (values.includes(current)) selectEl.value = current;
}

function buildMembershipIndex(memberships) {
  const byIso3 = new Map();
  for (const m of memberships) {
    if (!byIso3.has(m.iso3)) byIso3.set(m.iso3, []);
    byIso3.get(m.iso3).push(m);
  }
  return byIso3;
}

function getFilters() {
  return {
    q: els.search.value.trim().toLowerCase(),
    source: els.sourceFilter.value,
    type: els.typeFilter.value,
    group: els.groupFilter.value,
  };
}

function applyFilters() {
  const filters = getFilters();
  const byIso3 = buildMembershipIndex(state.memberships);

  const filtered = state.countries.filter((country) => {
    const haystack = [
      country.country_name_en,
      country.country_name_ar,
      country.country_name_zh,
      country.country_name_fr,
      country.country_name_ru,
      country.country_name_es,
      country.iso2,
      country.iso3,
      country.m49,
    ].join(' ').toLowerCase();

    if (filters.q && !haystack.includes(filters.q)) return false;

    const groups = byIso3.get(country.iso3) || [];
    if (!filters.source && !filters.type && !filters.group) return true;

    return groups.some((g) => {
      if (filters.source && g.source !== filters.source) return false;
      if (filters.type && g.group_type !== filters.type) return false;
      if (filters.group && g.group_name !== filters.group) return false;
      return true;
    });
  });

  renderTable(filtered, byIso3);
  renderChart(filtered, byIso3);
}

function renderTable(countries, byIso3) {
  els.countryBody.innerHTML = '';
  els.resultCount.textContent = `${countries.length} countries/areas shown`;

  for (const c of countries) {
    const memberships = byIso3.get(c.iso3) || [];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.country_name_en}</td>
      <td>${c.iso3}</td>
      <td>${c.iso2 || ''}</td>
      <td>${c.m49}</td>
      <td>${c.region_name_en || ''}</td>
      <td>${c.wb_income_name || ''}</td>
      <td>${String(c.wb_fcs_status).toLowerCase() === 'true' ? (c.wb_fcs_category || 'Yes') : ''}</td>
      <td>${String(c.oecd_dac_eligible).toLowerCase() === 'true' ? `Yes (${c.oecd_dac_reporting_year || ''})` : ''}</td>
      <td><span class="pill">${memberships.length} groups</span></td>
      <td><button class="pill view-btn" data-iso3="${c.iso3}" type="button">View</button></td>
    `;
    els.countryBody.appendChild(tr);
  }

  els.countryBody.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => renderCountryMemberships(btn.dataset.iso3));
  });
}

function renderQuickStats() {
  const byIso3 = buildMembershipIndex(state.memberships);
  const withLdc = state.countries.filter((c) => String(c.is_ldc).toLowerCase() === 'true').length;
  const withLldc = state.countries.filter((c) => String(c.is_lldc).toLowerCase() === 'true').length;
  const withSids = state.countries.filter((c) => String(c.is_sids).toLowerCase() === 'true').length;
  const withFcs = state.countries.filter((c) => String(c.wb_fcs_status).toLowerCase() === 'true').length;
  const withOecdDac = state.countries.filter((c) => String(c.oecd_dac_eligible).toLowerCase() === 'true').length;

  const totalMemberships = state.memberships.length;
  const meanMemberships = (totalMemberships / Math.max(1, state.countries.length)).toFixed(1);

  els.quickStats.innerHTML = `
    <li>Total countries/areas: <strong>${state.countries.length}</strong></li>
    <li>Total group memberships: <strong>${totalMemberships}</strong></li>
    <li>Mean groups per country: <strong>${meanMemberships}</strong></li>
    <li>LDC: <strong>${withLdc}</strong></li>
    <li>LLDC: <strong>${withLldc}</strong></li>
    <li>SIDS: <strong>${withSids}</strong></li>
    <li>WB FCS: <strong>${withFcs}</strong></li>
    <li>OECD DAC eligible: <strong>${withOecdDac}</strong></li>
  `;

  const generatedAt = state.manifest?.generated_at_utc || 'n/a';
  const snapshot = state.manifest?.snapshot_id || 'n/a';
  els.snapshotMeta.textContent = `Snapshot: ${snapshot} | Generated (UTC): ${generatedAt}`;
}

function renderChart(countries, byIso3) {
  const counts = new Map();
  for (const c of countries) {
    for (const m of (byIso3.get(c.iso3) || [])) {
      const key = `${m.source}:${m.group_type}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const labels = entries.map((e) => e[0]);
  const data = entries.map((e) => e[1]);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(els.chartCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Membership count',
        data,
        backgroundColor: '#0b6e4f',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });
}

function renderSources() {
  els.sources.innerHTML = '';
  for (const s of state.sources) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${s.organization}</strong>: <a href="${s.url}" target="_blank" rel="noreferrer">${s.title}</a> (${s.access_utc})`;
    els.sources.appendChild(li);
  }
}

function renderCountryMemberships(iso3) {
  const country = state.countries.find((c) => c.iso3 === iso3);
  const memberships = state.memberships
    .filter((m) => m.iso3 === iso3)
    .sort((a, b) => `${a.source}:${a.group_type}:${a.group_name}`.localeCompare(`${b.source}:${b.group_type}:${b.group_name}`));

  els.selectedLabel.textContent = `${country?.country_name_en || iso3} (${iso3}) - ${memberships.length} group memberships`;
  els.selectedMemberships.innerHTML = '';

  for (const m of memberships) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.source}</td>
      <td>${m.group_type}</td>
      <td>${m.group_code || ''}</td>
      <td>${m.group_name}</td>
    `;
    els.selectedMemberships.appendChild(tr);
  }
}

function wireEvents() {
  for (const el of [els.search, els.sourceFilter, els.typeFilter, els.groupFilter]) {
    el.addEventListener('input', applyFilters);
    el.addEventListener('change', applyFilters);
  }
}

async function main() {
  const [countries, memberships, sources, manifest] = await Promise.all([
    loadJson('./data/countries_master.json'),
    loadJson('./data/country_group_membership.json'),
    loadJson('./data/sources.json').catch(() => []),
    loadJson('./data/run_manifest.json').catch(() => null),
  ]);

  state.countries = countries;
  state.memberships = memberships;
  state.sources = Array.isArray(sources) ? sources : [];
  state.manifest = manifest;

  setSelectOptions(els.sourceFilter, uniqueSorted(memberships.map((m) => m.source)));
  setSelectOptions(els.typeFilter, uniqueSorted(memberships.map((m) => m.group_type)));
  setSelectOptions(els.groupFilter, uniqueSorted(memberships.map((m) => m.group_name)));

  renderQuickStats();
  renderSources();
  applyFilters();
  if (state.countries.length > 0) {
    renderCountryMemberships(state.countries[0].iso3);
  }
  wireEvents();
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<main class="card" style="margin:2rem;">Failed to load data: ${err.message}</main>`;
});
