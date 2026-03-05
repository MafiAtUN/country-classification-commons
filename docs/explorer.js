// ── Constants ─────────────────────────────────────────────────────────────────

const DATA_BASES = [
  '/country-classification-commons/data/',
  'data/',
  './data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/docs/data/',
];

const INCOME_ORDER = [
  'Low income',
  'Lower middle income',
  'Upper middle income',
  'High income',
];

const INCOME_COLORS = {
  'Low income':           '#c0392b',
  'Lower middle income':  '#e67e22',
  'Upper middle income':  '#f1c40f',
  'High income':          '#27ae60',
};

const PALETTE = [
  '#0b6e4f','#1a9e73','#f4a261','#e76f51','#264653',
  '#2a9d8f','#e9c46a','#457b9d','#a8dadc','#6fd3b7','#cc3d3d','#8e44ad',
];

// ── State ─────────────────────────────────────────────────────────────────────

const S = {
  countries: [],       // countries_master.json array
  memberships: [],     // country_group_membership.json array
  byIso3: new Map(),   // iso3 → [membership, …]
  bySrc: {},           // source → [membership, …]
  sdgGroups: {},       // iso3 → [sdg group names]  — built once, used by cross-filter
  regionSubMap: {},    // un region → Set of sub-regions — for cascading dropdown
  activeTab: 'm49',
  charts: {},
  exportData: null,    // { filename, headers, rows } set by each render fn
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
      return JSON.parse(text);
    } catch (e) {
      tried.push(`${url} → ${e.message}`);
    }
  }
  throw new Error(`Failed to load ${file}. Tried:\n${tried.join('\n')}`);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function flag(val) { return String(val).toLowerCase() === 'true'; }
function clean(val) { return (val == null || val === 'null') ? '' : String(val).trim(); }
function unique(arr) { return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

function fillSelect(id, values, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${placeholder || 'All'}</option>`;
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  if (values.includes(cur)) sel.value = cur;
}

function buildByIso3() {
  S.byIso3.clear();
  for (const m of S.memberships) {
    if (!S.byIso3.has(m.iso3)) S.byIso3.set(m.iso3, []);
    S.byIso3.get(m.iso3).push(m);
  }
}

function buildBySrc() {
  S.bySrc = {};
  for (const m of S.memberships) {
    if (!S.bySrc[m.source]) S.bySrc[m.source] = [];
    S.bySrc[m.source].push(m);
  }
}

function buildSDGGroups() {
  S.sdgGroups = {};
  for (const m of (S.bySrc['un_sdg'] || [])) {
    if (!S.sdgGroups[m.iso3]) S.sdgGroups[m.iso3] = [];
    S.sdgGroups[m.iso3].push(m.group_name);
  }
}

function applyCrossFilters(arr) {
  const wb  = document.getElementById('cross-wb-income')?.value || '';
  const sdg = document.getElementById('cross-sdg-group')?.value  || '';
  if (!wb && !sdg) return arr;
  return arr.filter(c => {
    if (wb  && clean(c.wb_income_name) !== wb)                        return false;
    if (sdg && !(S.sdgGroups[c.iso3] || []).includes(sdg))            return false;
    return true;
  });
}

function updateSubregionFilter() {
  const region = document.getElementById('m49-region')?.value || '';
  const subs = (region && S.regionSubMap[region])
    ? [...S.regionSubMap[region]].sort((a, b) => a.localeCompare(b))
    : unique(S.countries.map(c => c.sub_region_name_en));
  fillSelect('m49-subregion', subs, 'All sub-regions');
}

function destroyChart(key) {
  if (S.charts[key]) { S.charts[key].destroy(); delete S.charts[key]; }
}

function barChart(canvasId, labels, data, colors, opts = {}) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  S.charts[canvasId] = new Chart(ctx, {
    type: opts.horizontal ? 'bar' : 'bar',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
    },
    options: {
      indexAxis: opts.horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${opts.horizontal ? ctx.parsed.x : ctx.parsed.y}` } },
      },
      scales: {
        [opts.horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

function viewBtn(iso3) {
  return `<button class="btn btn-sm view-btn" data-iso3="${iso3}" type="button">Detail</button>`;
}

function boolPill(val, label, cls) {
  return flag(val) ? `<span class="pill ${cls}">${label}</span>` : '';
}

// ── CSV export ─────────────────────────────────────────────────────────────────

function csvEscape(v) {
  const s = (v == null || v === 'null' || v === null) ? '' : String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCSV(filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function storeExport(noteId, data) {
  S.exportData = data;
  const note = document.getElementById(noteId);
  if (note) {
    const n = data.rows.length;
    note.textContent = `${n} row${n !== 1 ? 's' : ''} will be exported`;
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(tab) {
  S.activeTab = tab;
  document.querySelectorAll('.cls-tab').forEach(el => {
    const active = el.dataset.tab === tab;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('hidden', el.id !== `tab-${tab}`);
  });
  document.getElementById('detail-panel').style.display = 'none';
  renderActiveTab();
}

function renderActiveTab() {
  switch (S.activeTab) {
    case 'm49':  renderM49();       break;
    case 'wb':   renderWB();        break;
    case 'oecd': renderOECD();      break;
    case 'fcs':  renderFCS();       break;
    case 'sdg':  renderSDG();       break;
    case 'all':  renderAllGroups(); break;
  }
}

// ── Tab counts (header badges) ────────────────────────────────────────────────

function updateTabCounts() {
  const wbCountries  = S.countries.filter(c => clean(c.wb_income_name));
  const fcsCountries = S.countries.filter(c => flag(c.wb_fcs_status));
  const oecdCountries = S.countries.filter(c => flag(c.oecd_dac_eligible));
  document.getElementById('count-m49').textContent  = `${S.countries.length} countries`;
  document.getElementById('count-wb').textContent   = `${wbCountries.length} economies`;
  document.getElementById('count-oecd').textContent = `${oecdCountries.length} recipients`;
  document.getElementById('count-fcs').textContent  = fcsCountries.length ? `${fcsCountries.length} countries` : 'No data';
  document.getElementById('count-sdg').textContent  = `248 countries`;
  document.getElementById('count-all').textContent  = `${S.memberships.length.toLocaleString()} memberships`;
  const allTotalEl = document.getElementById('all-memberships-total');
  if (allTotalEl) allTotalEl.textContent = S.memberships.length.toLocaleString();
}

// ══════════════════════════ TAB 1: UN M49 ════════════════════════════════════

function renderM49() {
  const q        = (document.getElementById('m49-search')?.value || '').trim().toLowerCase();
  const region   = document.getElementById('m49-region')?.value || '';
  const subreg   = document.getElementById('m49-subregion')?.value || '';
  const special  = document.getElementById('m49-special')?.value || '';

  const _filtered = S.countries.filter(c => {
    if (region && clean(c.region_name_en) !== region) return false;
    if (subreg && clean(c.sub_region_name_en) !== subreg) return false;
    if (special === 'ldc'  && !flag(c.is_ldc))  return false;
    if (special === 'lldc' && !flag(c.is_lldc)) return false;
    if (special === 'sids' && !flag(c.is_sids)) return false;
    if (q) {
      const hay = `${c.country_name_en} ${c.country_name_ar} ${c.country_name_fr} ${c.iso3} ${c.iso2} ${c.m49}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const filtered = applyCrossFilters(_filtered);
  document.getElementById('m49-count').textContent = `${filtered.length} of ${S.countries.length}`;

  // Stats
  const all = S.countries;
  document.getElementById('m49-total').textContent = all.length;
  document.getElementById('m49-ldc').textContent   = all.filter(c => flag(c.is_ldc)).length;
  document.getElementById('m49-lldc').textContent  = all.filter(c => flag(c.is_lldc)).length;
  document.getElementById('m49-sids').textContent  = all.filter(c => flag(c.is_sids)).length;

  // Charts (always based on full dataset, not filtered)
  const regionCounts = {};
  for (const c of all) { const r = clean(c.region_name_en) || 'Other'; regionCounts[r] = (regionCounts[r] || 0) + 1; }
  const rLabels = Object.keys(regionCounts).sort();
  barChart('chart-m49-region', rLabels, rLabels.map(k => regionCounts[k]), PALETTE, { horizontal: true });

  const specialData = [
    all.filter(c => flag(c.is_ldc)).length,
    all.filter(c => flag(c.is_lldc)).length,
    all.filter(c => flag(c.is_sids)).length,
  ];
  barChart('chart-m49-special', ['LDC', 'LLDC', 'SIDS'], specialData, ['#c0392b','#e67e22','#2a9d8f']);

  // Table
  const tbody = document.getElementById('m49-body');
  tbody.innerHTML = '';
  for (const c of filtered) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${clean(c.country_name_en)}</td>
      <td><code>${clean(c.iso3)}</code></td>
      <td>${clean(c.iso2)}</td>
      <td>${clean(c.m49)}</td>
      <td>${clean(c.region_name_en)}</td>
      <td>${clean(c.sub_region_name_en)}</td>
      <td>${clean(c.intermediate_region_name_en)}</td>
      <td>${boolPill(c.is_ldc,  'LDC',  'pill-yes')}</td>
      <td>${boolPill(c.is_lldc, 'LLDC', 'pill-yes')}</td>
      <td>${boolPill(c.is_sids, 'SIDS', 'pill-sids')}</td>
      <td>${viewBtn(c.iso3)}</td>
    `;
    tbody.appendChild(tr);
  }
  wireViewBtns();

  storeExport('m49-export-note', {
    filename: `un-m49_filtered_${filtered.length}rows.csv`,
    headers: ['country_name_en','iso3','iso2','m49','region_name_en','sub_region_name_en','intermediate_region_name_en','is_ldc','is_lldc','is_sids'],
    rows: filtered.map(c => [
      clean(c.country_name_en), clean(c.iso3), clean(c.iso2), clean(c.m49),
      clean(c.region_name_en), clean(c.sub_region_name_en), clean(c.intermediate_region_name_en),
      flag(c.is_ldc), flag(c.is_lldc), flag(c.is_sids),
    ]),
  });
}

// ══════════════════════════ TAB 2: WORLD BANK ════════════════════════════════

function renderWB() {
  const q       = (document.getElementById('wb-search')?.value || '').trim().toLowerCase();
  const income  = document.getElementById('wb-income')?.value || '';
  const region  = document.getElementById('wb-region')?.value || '';
  const lending = document.getElementById('wb-lending')?.value || '';

  const wbAll = S.countries.filter(c => clean(c.wb_income_name));

  const filtered = applyCrossFilters(wbAll.filter(c => {
    if (income  && clean(c.wb_income_name) !== income)  return false;
    if (region  && clean(c.wb_region_name) !== region)  return false;
    if (lending && clean(c.wb_lending_name) !== lending) return false;
    if (q) {
      const hay = `${c.country_name_en} ${c.iso3} ${c.wb_country_name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }));

  document.getElementById('wb-count').textContent = `${filtered.length} of ${wbAll.length}`;

  // Stats
  document.getElementById('wb-total').textContent = wbAll.length;
  document.getElementById('wb-low').textContent   = wbAll.filter(c => c.wb_income_name === 'Low income').length;
  document.getElementById('wb-lm').textContent    = wbAll.filter(c => c.wb_income_name === 'Lower middle income').length;
  document.getElementById('wb-um').textContent    = wbAll.filter(c => c.wb_income_name === 'Upper middle income').length;
  document.getElementById('wb-high').textContent  = wbAll.filter(c => c.wb_income_name === 'High income').length;

  // Income chart
  const incomeLevels = INCOME_ORDER.filter(k => wbAll.some(c => c.wb_income_name === k));
  barChart('chart-wb-income', incomeLevels, incomeLevels.map(k => wbAll.filter(c => c.wb_income_name === k).length),
    incomeLevels.map(k => INCOME_COLORS[k] || PALETTE[0]));

  // Region chart
  const regCounts = {};
  for (const c of wbAll) { const r = clean(c.wb_region_name) || 'Other'; regCounts[r] = (regCounts[r] || 0) + 1; }
  const rLabels = Object.keys(regCounts).sort((a,b) => regCounts[b] - regCounts[a]);
  barChart('chart-wb-region', rLabels, rLabels.map(k => regCounts[k]), PALETTE, { horizontal: true });

  // Table
  const tbody = document.getElementById('wb-body');
  tbody.innerHTML = '';
  for (const c of filtered) {
    const incomeColor = INCOME_COLORS[c.wb_income_name] || '#888';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${clean(c.country_name_en)}</td>
      <td><code>${clean(c.iso3)}</code></td>
      <td>${clean(c.wb_region_name)}</td>
      <td><span class="income-pill" style="background:${incomeColor}20;color:${incomeColor};border:1px solid ${incomeColor}40">${clean(c.wb_income_name)}</span></td>
      <td>${clean(c.wb_lending_name)}</td>
      <td>${clean(c.capital_city)}</td>
      <td>${viewBtn(c.iso3)}</td>
    `;
    tbody.appendChild(tr);
  }
  wireViewBtns();

  storeExport('wb-export-note', {
    filename: `world-bank_filtered_${filtered.length}rows.csv`,
    headers: ['country_name_en','iso3','wb_country_name','wb_region_name','wb_income_name','wb_lending_name','capital_city'],
    rows: filtered.map(c => [
      clean(c.country_name_en), clean(c.iso3), clean(c.wb_country_name),
      clean(c.wb_region_name), clean(c.wb_income_name), clean(c.wb_lending_name), clean(c.capital_city),
    ]),
  });
}

// ══════════════════════════ TAB 3: OECD DAC ══════════════════════════════════

function renderOECD() {
  const q      = (document.getElementById('oecd-search')?.value || '').trim().toLowerCase();
  const group  = document.getElementById('oecd-group')?.value || '';
  const unReg  = document.getElementById('oecd-un-region')?.value || '';

  const oecdAll = S.countries.filter(c => flag(c.oecd_dac_eligible));

  // Build per-country OECD group info from memberships
  const oecdGroupMap = {}; // iso3 → {dacGroup, wbIncome, reportingYear}
  for (const m of (S.bySrc['oecd_dac'] || [])) {
    if (!oecdGroupMap[m.iso3]) oecdGroupMap[m.iso3] = { dacGroup: '', wbIncome: '', reportingYear: '' };
    if (m.group_type === 'oda_recipient_group') oecdGroupMap[m.iso3].dacGroup = m.group_name;
    if (m.group_type === 'wb_income_hint')      oecdGroupMap[m.iso3].wbIncome = m.group_name;
    if (m.group_type === 'reporting_year')      oecdGroupMap[m.iso3].reportingYear = m.group_name;
  }

  const filtered = applyCrossFilters(oecdAll.filter(c => {
    const info = oecdGroupMap[c.iso3] || {};
    if (group && info.dacGroup !== group) return false;
    if (unReg && clean(c.region_name_en) !== unReg) return false;
    if (q) {
      const hay = `${c.country_name_en} ${c.iso3}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }));

  document.getElementById('oecd-count').textContent = `${filtered.length} of ${oecdAll.length}`;
  document.getElementById('oecd-total').textContent  = oecdAll.length;
  if (document.getElementById('oecd-total-inline')) document.getElementById('oecd-total-inline').textContent = oecdAll.length;

  // Group counts from memberships
  const dacGroups = {};
  for (const m of (S.bySrc['oecd_dac'] || [])) {
    if (m.group_type !== 'oda_recipient_group') continue;
    dacGroups[m.group_name] = (dacGroups[m.group_name] || 0) + 1;
  }
  // Simplify long names for counting LDCs etc.
  const ldcCount  = oecdAll.filter(c => {
    const g = (oecdGroupMap[c.iso3]?.dacGroup || '');
    return g.includes('LDC') && !g.includes('LMIC');
  }).length;
  const lmicCount = oecdAll.filter(c => (oecdGroupMap[c.iso3]?.dacGroup || '').includes('LMIC')).length;
  const umicCount = oecdAll.filter(c => (oecdGroupMap[c.iso3]?.dacGroup || '').includes('UMIC')).length;
  const otherCount = oecdAll.filter(c => (oecdGroupMap[c.iso3]?.dacGroup || '').includes('Other')).length;
  document.getElementById('oecd-ldc').textContent   = ldcCount;
  document.getElementById('oecd-lmic').textContent  = lmicCount;
  document.getElementById('oecd-umic').textContent  = umicCount;
  document.getElementById('oecd-other').textContent = otherCount;

  // DAC group chart
  const dacLabels = Object.keys(dacGroups).sort((a,b) => dacGroups[b]-dacGroups[a]);
  barChart('chart-oecd-group', dacLabels, dacLabels.map(k => dacGroups[k]), PALETTE);

  // UN region chart (ODA recipients)
  const regCounts = {};
  for (const c of oecdAll) { const r = clean(c.region_name_en) || 'Other'; regCounts[r] = (regCounts[r] || 0) + 1; }
  const rLabels = Object.keys(regCounts).sort((a,b) => regCounts[b]-regCounts[a]);
  barChart('chart-oecd-region', rLabels, rLabels.map(k => regCounts[k]), PALETTE, { horizontal: true });

  // Table
  const tbody = document.getElementById('oecd-body');
  tbody.innerHTML = '';
  for (const c of filtered) {
    const info = oecdGroupMap[c.iso3] || {};
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${clean(c.country_name_en)}</td>
      <td><code>${clean(c.iso3)}</code></td>
      <td>${clean(c.region_name_en)}</td>
      <td>${info.dacGroup || ''}</td>
      <td>${info.wbIncome || ''}</td>
      <td>${info.reportingYear || ''}</td>
      <td>${viewBtn(c.iso3)}</td>
    `;
    tbody.appendChild(tr);
  }
  wireViewBtns();

  storeExport('oecd-export-note', {
    filename: `oecd-dac_filtered_${filtered.length}rows.csv`,
    headers: ['country_name_en','iso3','un_region_name_en','dac_group','wb_income_hint','reporting_year'],
    rows: filtered.map(c => {
      const info = oecdGroupMap[c.iso3] || {};
      return [clean(c.country_name_en), clean(c.iso3), clean(c.region_name_en), info.dacGroup || '', info.wbIncome || '', info.reportingYear || ''];
    }),
  });
}

// ══════════════════════════ TAB 4: WB FCS ════════════════════════════════════

function renderFCS() {
  const q       = (document.getElementById('fcs-search')?.value || '').trim().toLowerCase();
  const cat     = document.getElementById('fcs-category')?.value || '';
  const unReg   = document.getElementById('fcs-un-region')?.value || '';
  const wbReg   = document.getElementById('fcs-wb-region')?.value || '';

  const fcsAll = S.countries.filter(c => flag(c.wb_fcs_status));

  // Show/hide the no-data warning
  const noDataEl = document.getElementById('fcs-no-data');
  if (noDataEl) noDataEl.classList.toggle('hidden', fcsAll.length > 0);

  const filtered = applyCrossFilters(fcsAll.filter(c => {
    if (cat    && clean(c.wb_fcs_category) !== cat)    return false;
    if (unReg  && clean(c.region_name_en)  !== unReg)  return false;
    if (wbReg  && clean(c.wb_region_name)  !== wbReg)  return false;
    if (q) {
      const hay = `${c.country_name_en} ${c.iso3}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }));

  document.getElementById('fcs-count').textContent    = fcsAll.length ? `${filtered.length} of ${fcsAll.length}` : 'No data';
  document.getElementById('fcs-total').textContent    = fcsAll.length || '—';
  document.getElementById('fcs-conflict').textContent = fcsAll.filter(c => c.wb_fcs_category === 'Conflict').length || (fcsAll.length ? 0 : '—');
  document.getElementById('fcs-fragile').textContent  = fcsAll.filter(c => c.wb_fcs_category !== 'Conflict' && flag(c.wb_fcs_status)).length || (fcsAll.length ? 0 : '—');

  // FCS by region chart
  const regCounts = {};
  for (const c of fcsAll) { const r = clean(c.region_name_en) || 'Other'; regCounts[r] = (regCounts[r] || 0) + 1; }
  const rLabels = Object.keys(regCounts).sort((a,b) => regCounts[b]-regCounts[a]);
  barChart('chart-fcs', rLabels, rLabels.map(k => regCounts[k]), PALETTE, { horizontal: rLabels.length > 4 });

  // Table
  const tbody = document.getElementById('fcs-body');
  tbody.innerHTML = '';
  if (fcsAll.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;padding:1.5rem">FCS data not available — see warning above</td></tr>';
    return;
  }
  for (const c of filtered) {
    const catCls = c.wb_fcs_category === 'Conflict' ? 'pill-warn' : 'pill-sids';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${clean(c.country_name_en)}</td>
      <td><code>${clean(c.iso3)}</code></td>
      <td>${clean(c.region_name_en)}</td>
      <td>${clean(c.wb_region_name)}</td>
      <td>${clean(c.wb_income_name)}</td>
      <td><span class="pill ${catCls}">${clean(c.wb_fcs_category)}</span></td>
      <td>${clean(c.wb_fcs_fy)}</td>
      <td>${viewBtn(c.iso3)}</td>
    `;
    tbody.appendChild(tr);
  }
  wireViewBtns();

  storeExport('fcs-export-note', {
    filename: `wb-fcs_filtered_${filtered.length}rows.csv`,
    headers: ['country_name_en','iso3','un_region_name_en','wb_region_name','wb_income_name','wb_fcs_category','wb_fcs_fy'],
    rows: filtered.map(c => [
      clean(c.country_name_en), clean(c.iso3), clean(c.region_name_en), clean(c.wb_region_name),
      clean(c.wb_income_name), clean(c.wb_fcs_category), clean(c.wb_fcs_fy),
    ]),
  });
}

// ══════════════════════════ TAB 5: UN SDG ════════════════════════════════════

function renderSDG() {
  const selectedGroup = document.getElementById('sdg-group')?.value || '';
  const q             = (document.getElementById('sdg-search')?.value || '').trim().toLowerCase();

  // Build iso3 → [sdg group names]
  const sdgGroups = {};
  for (const m of (S.bySrc['un_sdg'] || [])) {
    if (!sdgGroups[m.iso3]) sdgGroups[m.iso3] = [];
    sdgGroups[m.iso3].push(m.group_name);
  }

  const allGroups = unique((S.bySrc['un_sdg'] || []).map(m => m.group_name));
  document.getElementById('sdg-groups-count').textContent = allGroups.length;
  if (document.getElementById('sdg-groups-inline')) document.getElementById('sdg-groups-inline').textContent = allGroups.length;

  let filtered = applyCrossFilters(S.countries.filter(c => {
    if (selectedGroup) {
      const groups = sdgGroups[c.iso3] || [];
      if (!groups.includes(selectedGroup)) return false;
    }
    if (q) {
      const hay = `${c.country_name_en} ${c.iso3} ${c.m49}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }));

  document.getElementById('sdg-count').textContent         = `${filtered.length}`;
  document.getElementById('sdg-filtered-count').textContent = filtered.length;

  // Top-level SDG chart: continents only (Africa, Americas, Asia, Europe, Oceania)
  const topGroups = ['Africa','Americas','Asia','Europe','Oceania'];
  const topCounts = topGroups.map(g => (S.bySrc['un_sdg'] || []).filter(m => m.group_name === g).length);
  barChart('chart-sdg', topGroups, topCounts, PALETTE);

  // Table
  const tbody = document.getElementById('sdg-body');
  tbody.innerHTML = '';
  for (const c of filtered) {
    const groups = (sdgGroups[c.iso3] || []).sort((a,b) => a.localeCompare(b));
    const pills = groups.map(g => `<span class="pill pill-sdg">${g}</span>`).join(' ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${clean(c.country_name_en)}</td>
      <td><code>${clean(c.iso3)}</code></td>
      <td>${clean(c.m49)}</td>
      <td style="max-width:520px;white-space:normal">${pills}</td>
      <td>${viewBtn(c.iso3)}</td>
    `;
    tbody.appendChild(tr);
  }
  wireViewBtns();

  storeExport('sdg-export-note', {
    filename: `un-sdg_filtered_${filtered.length}rows.csv`,
    headers: ['country_name_en','iso3','m49','sdg_groups'],
    rows: filtered.map(c => {
      const groups = (sdgGroups[c.iso3] || []).sort((a,b) => a.localeCompare(b));
      return [clean(c.country_name_en), clean(c.iso3), clean(c.m49), groups.join(';')];
    }),
  });
}

// ══════════════════════════ TAB 6: ALL GROUPS ════════════════════════════════

function renderAllGroups() {
  const q       = (document.getElementById('all-search')?.value || '').trim().toLowerCase();
  const srcFlt  = document.getElementById('all-source')?.value || '';

  const filtered = S.countries.filter(c => {
    if (q) {
      const mems = S.byIso3.get(c.iso3) || [];
      const groupText = mems.map(m => m.group_name).join(' ').toLowerCase();
      const hay = `${c.country_name_en} ${c.iso3} ${c.m49} ${groupText}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  document.getElementById('all-count').textContent = `${filtered.length} of ${S.countries.length}`;

  const tbody = document.getElementById('all-body');
  tbody.innerHTML = '';
  for (const c of filtered) {
    let mems = S.byIso3.get(c.iso3) || [];
    if (srcFlt) mems = mems.filter(m => m.source === srcFlt);
    const totalMems = (S.byIso3.get(c.iso3) || []).length;
    const pills = mems
      .sort((a, b) => `${a.source}:${a.group_name}`.localeCompare(`${b.source}:${b.group_name}`))
      .map(m => `<span class="pill src-pill src-${m.source.replace(/_/g,'-')}">${m.group_name}</span>`)
      .join(' ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${clean(c.country_name_en)}</td>
      <td><code>${clean(c.iso3)}</code></td>
      <td>${clean(c.m49)}</td>
      <td style="text-align:center"><span class="pill">${totalMems}</span></td>
      <td style="max-width:560px;white-space:normal">${pills || '<em style="color:#aaa;font-size:.8rem">none in this source</em>'}</td>
      <td>${viewBtn(c.iso3)}</td>
    `;
    tbody.appendChild(tr);
  }
  wireViewBtns();

  // Export: long format (one row per country-group, matching aggregates.csv)
  storeExport('all-export-note', {
    filename: `all-groups_${filtered.length}countries.csv`,
    headers: ['Country or Area', 'M49 Code', 'iso2', 'iso3', 'source', 'group_type', 'group_name'],
    rows: filtered.flatMap(c => {
      let mems = S.byIso3.get(c.iso3) || [];
      if (srcFlt) mems = mems.filter(m => m.source === srcFlt);
      return mems.map(m => [
        clean(c.country_name_en), clean(c.m49), clean(c.iso2), clean(c.iso3),
        m.source, m.group_type, m.group_name,
      ]);
    }),
  });
}

// ══════════════════════════ Country detail panel ══════════════════════════════

function showDetail(iso3) {
  const c = S.countries.find(c => c.iso3 === iso3);
  const memberships = (S.byIso3.get(iso3) || [])
    .sort((a,b) => `${a.source}:${a.group_type}:${a.group_name}`.localeCompare(`${b.source}:${b.group_type}:${b.group_name}`));

  document.getElementById('detail-label').textContent =
    `${clean(c?.country_name_en) || iso3}  (${iso3})  —  ${memberships.length} group memberships`;

  // Multilingual names
  const names = [
    c?.country_name_ar && `AR: ${c.country_name_ar}`,
    c?.country_name_fr && `FR: ${c.country_name_fr}`,
    c?.country_name_es && `ES: ${c.country_name_es}`,
    c?.country_name_zh && `ZH: ${c.country_name_zh}`,
    c?.country_name_ru && `RU: ${c.country_name_ru}`,
  ].filter(Boolean);
  document.getElementById('detail-names').textContent = names.join('  ·  ');

  // All memberships table
  const tbody = document.getElementById('detail-body');
  tbody.innerHTML = '';
  for (const m of memberships) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="pill src-pill src-${m.source.replace(/_/g,'-')}">${m.source}</span></td><td>${m.group_type}</td><td>${m.group_code || ''}</td><td>${m.group_name}</td>`;
    tbody.appendChild(tr);
  }

  // Quick-ref flags
  document.getElementById('detail-flags-inner').innerHTML = `
    <table style="width:100%;font-size:.85rem;border-collapse:collapse">
      <tr><td style="padding:.25rem 0;color:#555">M49 code</td><td><strong>${clean(c?.m49)}</strong></td></tr>
      <tr><td style="padding:.25rem 0;color:#555">ISO2</td><td><strong>${clean(c?.iso2)}</strong></td></tr>
      <tr><td style="padding:.25rem 0;color:#555">UN Region</td><td>${clean(c?.region_name_en)}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">UN Sub-region</td><td>${clean(c?.sub_region_name_en)}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">WB Income</td><td>${clean(c?.wb_income_name) || '<em style="color:#aaa">Not classified</em>'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">WB Lending</td><td>${clean(c?.wb_lending_name) || '<em style="color:#aaa">n/a</em>'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">WB Region</td><td>${clean(c?.wb_region_name) || '<em style="color:#aaa">n/a</em>'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">Capital</td><td>${clean(c?.capital_city) || '—'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">LDC</td><td>${flag(c?.is_ldc) ? '<span class="pill pill-yes">Yes</span>' : 'No'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">LLDC</td><td>${flag(c?.is_lldc) ? '<span class="pill pill-yes">Yes</span>' : 'No'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">SIDS</td><td>${flag(c?.is_sids) ? '<span class="pill pill-sids">Yes</span>' : 'No'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">FCS</td><td>${flag(c?.wb_fcs_status) ? `<span class="pill pill-warn">${clean(c?.wb_fcs_category)}</span>` : 'No'}</td></tr>
      <tr><td style="padding:.25rem 0;color:#555">ODA-eligible</td><td>${flag(c?.oecd_dac_eligible) ? '<span class="pill pill-oda">Yes</span>' : 'No'}</td></tr>
    </table>
  `;

  const panel = document.getElementById('detail-panel');
  panel.style.display = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wireViewBtns() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => showDetail(btn.dataset.iso3));
  });
}

// ── Populate filter dropdowns ─────────────────────────────────────────────────

function populateFilters() {
  // M49 — build cascading region→sub-region map
  S.regionSubMap = {};
  for (const c of S.countries) {
    const r = clean(c.region_name_en), s = clean(c.sub_region_name_en);
    if (r && s) {
      if (!S.regionSubMap[r]) S.regionSubMap[r] = new Set();
      S.regionSubMap[r].add(s);
    }
  }
  fillSelect('m49-region',    unique(S.countries.map(c => c.region_name_en)),     'All UN regions');
  fillSelect('m49-subregion', unique(S.countries.map(c => c.sub_region_name_en)), 'All sub-regions');

  // WB
  const wb = S.countries.filter(c => clean(c.wb_income_name));
  fillSelect('wb-income',  INCOME_ORDER.filter(k => wb.some(c => c.wb_income_name === k)), 'All income levels');
  fillSelect('wb-region',  unique(wb.map(c => c.wb_region_name)),  'All WB regions');
  fillSelect('wb-lending', unique(wb.map(c => c.wb_lending_name)), 'All lending types');

  // OECD
  const dacGroupNames = unique(
    (S.bySrc['oecd_dac'] || []).filter(m => m.group_type === 'oda_recipient_group').map(m => m.group_name)
  );
  fillSelect('oecd-group',     dacGroupNames, 'All DAC groups');
  fillSelect('oecd-un-region', unique(S.countries.filter(c => flag(c.oecd_dac_eligible)).map(c => c.region_name_en)), 'All UN regions');

  // FCS
  const fcsAll = S.countries.filter(c => flag(c.wb_fcs_status));
  fillSelect('fcs-un-region', unique(fcsAll.map(c => c.region_name_en)), 'All UN regions');
  fillSelect('fcs-wb-region', unique(fcsAll.map(c => c.wb_region_name)), 'All WB regions');

  // SDG
  const sdgGroupNames = unique((S.bySrc['un_sdg'] || []).map(m => m.group_name));
  fillSelect('sdg-group', sdgGroupNames, 'All SDG groups (select one to filter)');

  // Cross-system filters
  fillSelect('cross-wb-income', INCOME_ORDER.filter(k => S.countries.some(c => c.wb_income_name === k)), 'Any income level');
  fillSelect('cross-sdg-group', sdgGroupNames, 'Any SDG group');
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireEvents() {
  // Tab buttons
  document.querySelectorAll('.cls-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // "Switch to M49 tab" link inside SDG tab description
  document.querySelectorAll('.link-btn[data-switch-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.switchTab));
  });

  // Close detail panel
  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-panel').style.display = 'none';
  });

  // Export buttons (one per tab, all share same class)
  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!S.exportData) return;
      downloadCSV(S.exportData.filename, S.exportData.headers, S.exportData.rows);
    });
  });

  // Cross-system filters (always active regardless of tab)
  ['cross-wb-income', 'cross-sdg-group'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => renderActiveTab());
  });
  document.getElementById('cross-filter-clear')?.addEventListener('click', () => {
    const wb = document.getElementById('cross-wb-income');
    const sdg = document.getElementById('cross-sdg-group');
    if (wb) wb.value = '';
    if (sdg) sdg.value = '';
    renderActiveTab();
  });

  // Cascading region → sub-region for M49 tab
  const m49RegionEl = document.getElementById('m49-region');
  if (m49RegionEl) {
    m49RegionEl.addEventListener('change', () => {
      updateSubregionFilter();
      if (S.activeTab === 'm49') renderActiveTab();
    });
  }

  // Per-tab filter inputs (region handled separately above for M49)
  const tabInputs = {
    'm49':  ['m49-search', 'm49-subregion', 'm49-special'],
    'wb':   ['wb-search', 'wb-income', 'wb-region', 'wb-lending'],
    'oecd': ['oecd-search', 'oecd-group', 'oecd-un-region'],
    'fcs':  ['fcs-search', 'fcs-category', 'fcs-un-region', 'fcs-wb-region'],
    'sdg':  ['sdg-group', 'sdg-search'],
    'all':  ['all-search', 'all-source'],
  };
  for (const [tab, ids] of Object.entries(tabInputs)) {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input',  () => { if (S.activeTab === tab) renderActiveTab(); });
        el.addEventListener('change', () => { if (S.activeTab === tab) renderActiveTab(); });
      }
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  try {
    const [countries, memberships, manifest] = await Promise.all([
      loadJson('countries_master.json'),
      loadJson('country_group_membership.json'),
      loadJson('run_manifest.json').catch(() => null),
    ]);

    S.countries   = Array.isArray(countries)   ? countries   : [];
    S.memberships = Array.isArray(memberships) ? memberships : [];
    buildByIso3();
    buildBySrc();
    buildSDGGroups();

    const snap = manifest?.snapshot_id || 'n/a';
    const ts   = manifest?.generated_at_utc
      ? new Date(manifest.generated_at_utc).toUTCString()
      : 'n/a';
    document.getElementById('snapshot-meta').innerHTML =
      `Data snapshot <strong>${snap}</strong> &nbsp;·&nbsp; Generated (UTC): ${ts} &nbsp;·&nbsp; ${S.countries.length} countries &nbsp;·&nbsp; ${S.memberships.length.toLocaleString()} memberships`;

    updateTabCounts();
    populateFilters();
    wireEvents();
    renderActiveTab();       // render default (M49) tab

  } catch (err) {
    const errEl = document.getElementById('load-error');
    errEl.classList.remove('hidden');
    errEl.innerHTML = `<strong>Could not load data:</strong><br><pre style="margin:.5rem 0 0;font-size:.8rem;white-space:pre-wrap">${err.message}</pre>`;
    document.getElementById('snapshot-meta').textContent = 'Data load failed.';
  }
}

main();
