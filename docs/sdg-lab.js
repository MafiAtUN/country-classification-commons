const SDR_API_URL = 'https://services7.arcgis.com/IyvyFk20mB7Wpc95/arcgis/rest/services/Sustainable_Development_Report_2025_(with_indicators)/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json';
const GENERATED_BY = 'Country Classification Commons';
const SOURCE_CITATION = 'Sachs, J.D., Lafortune, G., Fuller, G., and Drumm, E. (2025). Sustainable Development Report 2025. DOI: 10.25546/111909';

const DATA_BASES = [
  'data/',
  './data/',
  '/country-classification-commons/data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/docs/data/',
];

const GOAL_KEYS = Array.from({ length: 17 }, (_, i) => `Goal_${i + 1}_Score`);

const CLASS_SCHEMES = {
  all: {
    label: 'All classifications',
    getValues: () => ['All countries'],
  },
  un_region: {
    label: 'UN M49 Region',
    getValues: row => [clean(row.country?.region_name_en)],
  },
  un_sub_region: {
    label: 'UN M49 Sub-region',
    getValues: row => [clean(row.country?.sub_region_name_en)],
  },
  wb_region: {
    label: 'World Bank Region',
    getValues: row => [clean(row.country?.wb_region_name)],
  },
  wb_income: {
    label: 'World Bank Income',
    getValues: row => [clean(row.country?.wb_income_name)],
  },
  wb_lending: {
    label: 'World Bank Lending Type',
    getValues: row => [clean(row.country?.wb_lending_name)],
  },
  sdg_geo: {
    label: 'UN SDG Geographic Group',
    getValues: row => row.members?.un_sdg || [],
  },
  oecd_group: {
    label: 'OECD DAC Recipient Group',
    getValues: row => row.members?.oecd_dac_group || [],
  },
  fcs_category: {
    label: 'World Bank FCS Category',
    getValues: row => row.members?.fcs_category || [],
  },
  special_un: {
    label: 'UN Special Group (LDC/LLDC/SIDS)',
    getValues: row => {
      const out = [];
      if (flag(row.country?.is_ldc)) out.push('LDC');
      if (flag(row.country?.is_lldc)) out.push('LLDC');
      if (flag(row.country?.is_sids)) out.push('SIDS');
      return out;
    },
  },
};

const S = {
  rows: [],
  filtered: [],
  countries: [],
  memberships: [],
  codebook: [],
  byIsoCountry: new Map(),
  byIsoMembership: new Map(),
  indicatorsByIso: new Map(),
  codebookByInd: new Map(),
  chartExports: {},
  aggregates: [],
  map: null,
  mapLayer: null,
};

const E = {
  error: document.getElementById('lab-error'),
  sourceRibbon: document.getElementById('source-ribbon'),
  search: document.getElementById('lab-search'),
  metric: document.getElementById('lab-metric'),
  scheme: document.getElementById('lab-scheme'),
  group: document.getElementById('lab-group'),
  publisherRegion: document.getElementById('lab-publisher-region'),
  topN: document.getElementById('lab-topn'),
  min: document.getElementById('lab-score-min'),
  max: document.getElementById('lab-score-max'),
  missing: document.getElementById('lab-missing'),
  reset: document.getElementById('lab-reset'),
  kpis: document.getElementById('lab-kpis'),
  tableBody: document.getElementById('lab-table-body'),
  rankingTitle: document.getElementById('lab-ranking-title'),
  notes: document.getElementById('lab-classification-notes'),
  countrySelect: document.getElementById('lab-country-select'),
  countryMeta: document.getElementById('lab-country-meta'),
  metricExplainer: document.getElementById('lab-metric-explainer'),
  aggGroup: document.getElementById('lab-agg-group'),
  aggSummary: document.getElementById('lab-agg-summary'),
  aggBody: document.getElementById('lab-agg-body'),
};

function clean(v) {
  if (v === null || v === undefined || String(v).toLowerCase() === 'null') return '';
  return String(v).trim();
}

function flag(v) {
  return String(v).toLowerCase() === 'true';
}

function n(v) {
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

function avg(arr) {
  const vals = arr.filter(v => v !== null && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function format1(v) {
  return v === null ? 'n/a' : v.toFixed(1);
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replaceAll('"', '""')}"` : s;
}

function downloadCsv(fileName, headers, rows, meta = {}) {
  const lines = [
    `# Created by ${GENERATED_BY}`,
    `# Data source citation: ${SOURCE_CITATION}`,
    `# Generated UTC: ${new Date().toISOString()}`,
  ];
  if (meta.context) lines.push(`# Filter context: ${meta.context}`);
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'chart';
}

function filterContext(f) {
  const scheme = CLASS_SCHEMES[f.scheme]?.label || 'All classifications';
  const group = f.group || 'All groups';
  const region = f.region || 'All SDR regions';
  return `${scheme} | ${group} | ${region}`;
}

function setTitle(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setChartExport(chartId, headers, rows, baseName, context = '') {
  S.chartExports[chartId] = { headers, rows, baseName, context };
}

function esc(s) {
  return clean(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function loadJson(file) {
  const errors = [];
  for (const base of DATA_BASES) {
    const url = `${base}${file}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(`Failed to load ${file}. ${errors.join(' | ')}`);
}

async function loadText(file) {
  const errors = [];
  for (const base of DATA_BASES) {
    const url = `${base}${file}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(`Failed to load ${file}. ${errors.join(' | ')}`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      row.push(cur);
      cur = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cur);
      cur = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }
  const headers = rows[0] || [];
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

async function loadSDRRows() {
  const res = await fetch(SDR_API_URL);
  if (!res.ok) throw new Error(`SDR API HTTP ${res.status}`);
  const payload = await res.json();
  const features = Array.isArray(payload.features) ? payload.features : [];
  return features.map((f) => {
    const a = f.attributes || {};
    const row = {
      iso3: clean(a.iso3),
      name: clean(a.Name),
      apiRegion: clean(a.Region),
      lat: n(f.geometry?.y),
      lon: n(f.geometry?.x),
      Overall_Score: n(a.Overall_Score),
      Overall_Rank: n(a.Overall_Rank),
      Spillover_Score: n(a.Spillover_Score),
      Spillover_Rank: n(a.Spillover_Rank),
      progress: n(a.progress),
      goalScores: {},
    };
    for (const key of GOAL_KEYS) row.goalScores[key] = n(a[key]);
    return row;
  }).filter(r => r.iso3);
}

function indexMemberships() {
  S.byIsoMembership.clear();
  for (const m of S.memberships) {
    if (!S.byIsoMembership.has(m.iso3)) S.byIsoMembership.set(m.iso3, []);
    S.byIsoMembership.get(m.iso3).push(m);
  }
}

function enrichRows() {
  S.rows = S.rows.map((r) => {
    const country = S.byIsoCountry.get(r.iso3) || null;
    const ms = S.byIsoMembership.get(r.iso3) || [];
    const sdr = S.indicatorsByIso.get(r.iso3) || null;

    const member = {
      un_sdg: [],
      oecd_dac_group: [],
      fcs_category: [],
    };

    for (const m of ms) {
      if (m.source === 'un_sdg' && m.group_type === 'region') member.un_sdg.push(m.group_name);
      if (m.source === 'oecd_dac' && m.group_type === 'oda_recipient_group') member.oecd_dac_group.push(m.group_name);
      if (m.source === 'world_bank_fcs' && m.group_type === 'fcs_category') member.fcs_category.push(m.group_name);
    }

    member.un_sdg = [...new Set(member.un_sdg)].sort((a, b) => a.localeCompare(b));
    member.oecd_dac_group = [...new Set(member.oecd_dac_group)].sort((a, b) => a.localeCompare(b));
    member.fcs_category = [...new Set(member.fcs_category)].sort((a, b) => a.localeCompare(b));

    return { ...r, country, members: member, sdr };
  });
}

function metricOptions() {
  const opts = [
    ['Overall_Score', 'Overall SDG Score'],
    ['Spillover_Score', 'Spillover Score'],
    ['progress', 'SDG Progress'],
  ];
  for (let i = 1; i <= 17; i += 1) opts.push([`Goal_${i}_Score`, `Goal ${i} Score`]);
  for (const c of S.codebook) {
    const ind = clean(c.IndCode);
    if (!ind) continue;
    opts.push([`ind:${ind}`, `Indicator - ${clean(c.Indicator)}`]);
  }
  return opts;
}

function getMetricValue(row, metric) {
  if (metric in row) return n(row[metric]);
  if (metric.startsWith('Goal_')) return n(row.goalScores[metric]);
  if (metric.startsWith('ind:')) {
    const ind = metric.slice(4);
    return n(row.sdr?.indicators?.[ind]);
  }
  return null;
}

function fillSelect(el, values, placeholder = 'All') {
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
  if (values.includes(current)) el.value = current;
}

function initFilterOptions() {
  E.metric.innerHTML = '';
  for (const [val, label] of metricOptions()) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = label;
    E.metric.appendChild(o);
  }

  E.scheme.innerHTML = '';
  for (const [id, cfg] of Object.entries(CLASS_SCHEMES)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = cfg.label;
    E.scheme.appendChild(o);
  }

  const regions = [...new Set(S.rows.map(r => r.apiRegion).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fillSelect(E.publisherRegion, regions, 'All SDR regions');

  updateGroupOptions();
}

function groupValuesForScheme(scheme) {
  const cfg = CLASS_SCHEMES[scheme] || CLASS_SCHEMES.all;
  const vals = new Set();
  for (const row of S.rows) {
    for (const v of cfg.getValues(row)) {
      if (clean(v)) vals.add(v);
    }
  }
  return [...vals].sort((a, b) => a.localeCompare(b));
}

function updateGroupOptions() {
  const scheme = E.scheme.value || 'all';
  fillSelect(E.group, groupValuesForScheme(scheme), 'All groups');
}

function passesGroupFilter(row, scheme, group) {
  if (!group) return true;
  const cfg = CLASS_SCHEMES[scheme] || CLASS_SCHEMES.all;
  return cfg.getValues(row).includes(group);
}

function activeFilters() {
  return {
    q: clean(E.search.value).toLowerCase(),
    metric: E.metric.value,
    scheme: E.scheme.value,
    group: E.group.value,
    region: E.publisherRegion.value,
    topN: Number(E.topN.value) || 15,
    min: E.min.value === '' ? null : n(E.min.value),
    max: E.max.value === '' ? null : n(E.max.value),
    includeMissing: E.missing.value === 'include',
  };
}

function applyFilters() {
  const f = activeFilters();
  S.filtered = S.rows.filter((row) => {
    const hay = `${row.name} ${row.iso3} ${row.country?.country_name_en || ''}`.toLowerCase();
    if (f.q && !hay.includes(f.q)) return false;
    if (f.region && row.apiRegion !== f.region) return false;
    if (!passesGroupFilter(row, f.scheme, f.group)) return false;

    const metricVal = getMetricValue(row, f.metric);
    if (!f.includeMissing && metricVal === null) return false;
    if (f.min !== null && metricVal !== null && metricVal < f.min) return false;
    if (f.max !== null && metricVal !== null && metricVal > f.max) return false;
    return true;
  });

  renderMetricExplainer(f.metric);
  renderKPIs(f);
  renderOverview(f);
  renderClassification(f);
  renderGeo(f);
  renderCountryPanel(f);
  renderTable(f);
}

function renderKPIs(f) {
  const metricVals = S.filtered.map(r => getMetricValue(r, f.metric));
  const scoreAvg = avg(metricVals);
  const withScore = metricVals.filter(v => v !== null).length;

  const top = [...S.filtered]
    .filter(r => getMetricValue(r, f.metric) !== null)
    .sort((a, b) => getMetricValue(b, f.metric) - getMetricValue(a, f.metric))[0] || null;

  const fcsCount = S.filtered.filter(r => (r.members?.fcs_category || []).length > 0).length;
  const ldcCount = S.filtered.filter(r => flag(r.country?.is_ldc)).length;

  E.kpis.innerHTML = `
    <article class="card kpi-card">
      <div class="kpi-label">Filtered countries</div>
      <div class="kpi-value">${S.filtered.length}</div>
      <div class="kpi-sub">of ${S.rows.length} in SDR 2025 dataset</div>
    </article>
    <article class="card kpi-card">
      <div class="kpi-label">Average selected metric</div>
      <div class="kpi-value">${format1(scoreAvg)}</div>
      <div class="kpi-sub">${withScore} countries with non-missing values</div>
    </article>
    <article class="card kpi-card">
      <div class="kpi-label">Top country (filtered)</div>
      <div class="kpi-value">${top ? esc(top.name) : 'n/a'}</div>
      <div class="kpi-sub">${top ? `${f.metric}: ${format1(getMetricValue(top, f.metric))}` : 'No available value'}</div>
    </article>
    <article class="card kpi-card">
      <div class="kpi-label">Classification signals</div>
      <div class="kpi-value">${ldcCount} LDC | ${fcsCount} FCS</div>
      <div class="kpi-sub">Within current filter context</div>
    </article>
  `;
}

function palette(i) {
  const colors = ['#0b6e4f', '#f4a261', '#457b9d', '#e76f51', '#2a9d8f', '#264653', '#c0392b', '#d4a017', '#5d6d7e'];
  return colors[i % colors.length];
}

function renderOverview(f) {
  const hasMetric = S.filtered
    .filter(r => getMetricValue(r, f.metric) !== null)
    .sort((a, b) => getMetricValue(b, f.metric) - getMetricValue(a, f.metric));

  const topRows = hasMetric.slice(0, f.topN).reverse();
  const bottomRows = [...hasMetric].sort((a, b) => getMetricValue(a, f.metric) - getMetricValue(b, f.metric)).slice(0, f.topN);
  const ctx = filterContext(f);
  setTitle('lab-ranking-title', `Top ${Math.min(f.topN, hasMetric.length)} by ${metricLabel(f.metric)} | ${ctx}`);
  setTitle('lab-scatter-title', `Overall vs Spillover | ${ctx}`);
  setTitle('lab-bottom-title', `Bottom ${Math.min(f.topN, hasMetric.length)} by ${metricLabel(f.metric)} | ${ctx}`);
  setTitle('lab-hist-title', `${metricLabel(f.metric)} distribution | ${ctx}`);

  Plotly.newPlot('lab-ranking-chart', [{
    type: 'bar',
    orientation: 'h',
    y: topRows.map(r => r.name),
    x: topRows.map(r => getMetricValue(r, f.metric)),
    marker: { color: topRows.map((_, i) => palette(i)) },
    hovertemplate: '%{y}<br>Score: %{x:.2f}<extra></extra>',
  }], {
    margin: { l: 135, r: 20, t: 12, b: 35 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    xaxis: { title: metricLabel(f.metric) },
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-ranking-chart',
    ['country', 'iso3', 'metric', 'metric_value'],
    topRows.map(r => [r.name, r.iso3, metricLabel(f.metric), getMetricValue(r, f.metric)]),
    `ranking_top_${slug(metricLabel(f.metric))}`,
    ctx
  );

  const groupKey = f.group || '(mixed groups)';
  const colorMap = new Map();
  const colorPool = ['#0b6e4f', '#c0392b', '#457b9d', '#f4a261', '#2a9d8f', '#8e44ad', '#a04000'];

  function colorFor(row) {
    const vals = CLASS_SCHEMES[f.scheme]?.getValues(row) || [];
    const label = vals[0] || groupKey;
    if (!colorMap.has(label)) colorMap.set(label, colorPool[colorMap.size % colorPool.length]);
    return colorMap.get(label);
  }

  const pts = S.filtered.filter(r => r.Overall_Score !== null && r.Spillover_Score !== null);
  Plotly.newPlot('lab-scatter-chart', [{
    type: 'scatter',
    mode: 'markers',
    x: pts.map(r => r.Overall_Score),
    y: pts.map(r => r.Spillover_Score),
    text: pts.map(r => `${r.name} (${r.iso3})`),
    marker: {
      size: pts.map(r => r.progress === null ? 8 : Math.max(8, Math.min(24, r.progress * 1.6))),
      color: pts.map(colorFor),
      line: { color: '#ffffff', width: 0.8 },
      opacity: 0.85,
    },
    hovertemplate: '<b>%{text}</b><br>Overall: %{x:.2f}<br>Spillover: %{y:.2f}<extra></extra>',
  }], {
    margin: { l: 55, r: 12, t: 12, b: 45 },
    xaxis: { title: 'Overall SDG Score' },
    yaxis: { title: 'Spillover Score' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-scatter-chart',
    ['country', 'iso3', 'overall_score', 'spillover_score', 'progress', 'classification_scheme', 'classification_group'],
    pts.map(r => {
      const vals = CLASS_SCHEMES[f.scheme]?.getValues(r) || [];
      return [r.name, r.iso3, r.Overall_Score, r.Spillover_Score, r.progress, CLASS_SCHEMES[f.scheme]?.label || '', vals.join('; ')];
    }),
    'overall_vs_spillover',
    ctx
  );

  Plotly.newPlot('lab-bottom-chart', [{
    type: 'bar',
    orientation: 'h',
    y: bottomRows.map(r => r.name),
    x: bottomRows.map(r => getMetricValue(r, f.metric)),
    marker: { color: '#c0392b' },
    hovertemplate: '%{y}<br>Score: %{x:.2f}<extra></extra>',
  }], {
    margin: { l: 135, r: 20, t: 12, b: 35 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    xaxis: { title: metricLabel(f.metric) },
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-bottom-chart',
    ['country', 'iso3', 'metric', 'metric_value'],
    bottomRows.map(r => [r.name, r.iso3, metricLabel(f.metric), getMetricValue(r, f.metric)]),
    `ranking_bottom_${slug(metricLabel(f.metric))}`,
    ctx
  );

  const distVals = hasMetric.map(r => getMetricValue(r, f.metric));
  Plotly.newPlot('lab-hist-chart', [{
    type: 'histogram',
    x: distVals,
    marker: { color: '#457b9d' },
    nbinsx: 20,
    hovertemplate: 'Bin count: %{y}<br>Value: %{x}<extra></extra>',
  }], {
    margin: { l: 55, r: 12, t: 12, b: 45 },
    xaxis: { title: metricLabel(f.metric) },
    yaxis: { title: 'Country count' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-hist-chart',
    ['metric', 'metric_value'],
    distVals.map(v => [metricLabel(f.metric), v]),
    `distribution_${slug(metricLabel(f.metric))}`,
    ctx
  );
}

function metricLabel(metric) {
  if (metric.startsWith('ind:')) {
    const ind = metric.slice(4);
    const c = S.codebookByInd.get(ind);
    if (c) return clean(c.Indicator) || ind;
    return ind;
  }
  return metricOptions().find(([k]) => k === metric)?.[1] || metric;
}

function renderMetricExplainer(metric) {
  if (!E.metricExplainer) return;
  if (metric.startsWith('ind:')) {
    const ind = metric.slice(4);
    const c = S.codebookByInd.get(ind);
    if (!c) {
      E.metricExplainer.innerHTML = `<p><strong>${esc(ind)}</strong></p><p class="meta">No codebook definition found.</p>`;
      return;
    }
    E.metricExplainer.innerHTML = `
      <p><strong>${esc(clean(c.Indicator))}</strong> <code>${esc(ind)}</code></p>
      <p>${esc(clean(c.Description) || 'No description available.')}</p>
      <p class="meta">
        SDG ${esc(clean(c.SDG))} | Source: ${esc(clean(c.Source) || 'n/a')} | Reference year: ${esc(clean(c['Reference year']) || 'n/a')}
      </p>
      <p class="meta">
        Bounds: Optimum=${esc(clean(c['Optimum (= 100)']) || 'n/a')}, Green=${esc(clean(c['Green threshold']) || 'n/a')}, Red=${esc(clean(c['Red threshold']) || 'n/a')}, Lower=${esc(clean(c['Lower Bound (=0)']) || 'n/a')}
      </p>
    `;
    return;
  }

  const generic = {
    Overall_Score: 'Composite SDG Index score (0-100) summarizing overall SDG performance.',
    Spillover_Score: 'International spillovers score (0-100), where higher means lower negative cross-border spillovers.',
    progress: 'Progress on headline SDGi (percentage-point trend).',
  };
  if (metric.startsWith('Goal_')) {
    E.metricExplainer.innerHTML = `<p><strong>${esc(metricLabel(metric))}</strong></p><p class="meta">Goal-level aggregate score (0-100) from SDR 2025 country data.</p>`;
    return;
  }
  E.metricExplainer.innerHTML = `<p><strong>${esc(metricLabel(metric))}</strong></p><p class="meta">${esc(generic[metric] || 'Metric from SDR 2025 data.')}</p>`;
}

function renderClassification(f) {
  const cfg = CLASS_SCHEMES[f.scheme] || CLASS_SCHEMES.all;
  const ctx = filterContext(f);
  setTitle('lab-group-avg-title', `Average ${metricLabel(f.metric)} by group | ${ctx}`);
  setTitle('lab-heat-title', `Goal heat view by group | ${ctx}`);
  setTitle('lab-coverage-title', `Group coverage (countries) | ${ctx}`);
  setTitle('lab-goal-line-title', `Goal averages for filtered set | ${ctx}`);
  const groupMap = new Map();

  for (const row of S.filtered) {
    const m = getMetricValue(row, f.metric);
    if (m === null) continue;
    for (const g of cfg.getValues(row)) {
      const key = g || 'Unclassified';
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(m);
    }
  }

  const entries = [...groupMap.entries()]
    .map(([k, arr]) => ({
      group: k,
      avg: avg(arr),
      n: arr.length,
    }))
    .filter(e => e.avg !== null)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 20);

  Plotly.newPlot('lab-group-avg-chart', [{
    type: 'bar',
    orientation: 'h',
    y: entries.map(e => `${e.group} (n=${e.n})`).reverse(),
    x: entries.map(e => e.avg).reverse(),
    marker: { color: entries.map((_, i) => palette(i)).reverse() },
    hovertemplate: '%{y}<br>Average: %{x:.2f}<extra></extra>',
  }], {
    margin: { l: 220, r: 20, t: 10, b: 35 },
    xaxis: { title: `Average ${metricLabel(f.metric)}` },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-group-avg-chart',
    ['group', 'average_metric', 'countries_count', 'metric'],
    entries.map(e => [e.group, e.avg, e.n, metricLabel(f.metric)]),
    `group_averages_${slug(metricLabel(f.metric))}`,
    ctx
  );

  const heatGroups = entries.slice(0, 8).map(e => e.group);
  const z = [];

  for (const group of heatGroups) {
    const rowVals = [];
    for (const goal of GOAL_KEYS) {
      const vals = S.filtered
        .filter(r => cfg.getValues(r).includes(group))
        .map(r => getMetricValue(r, goal));
      rowVals.push(avg(vals));
    }
    z.push(rowVals);
  }

  Plotly.newPlot('lab-goal-heat-chart', [{
    type: 'heatmap',
    z,
    x: GOAL_KEYS.map(k => `G${k.split('_')[1]}`),
    y: heatGroups,
    colorscale: 'YlGnBu',
    zmin: 0,
    zmax: 100,
    hovertemplate: 'Group: %{y}<br>Goal: %{x}<br>Avg score: %{z:.2f}<extra></extra>',
  }], {
    margin: { l: 140, r: 15, t: 10, b: 35 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  const heatRows = [];
  for (let i = 0; i < heatGroups.length; i += 1) {
    for (let j = 0; j < GOAL_KEYS.length; j += 1) {
      heatRows.push([heatGroups[i], `Goal ${j + 1}`, z[i]?.[j]]);
    }
  }
  setChartExport(
    'lab-goal-heat-chart',
    ['group', 'goal', 'average_score'],
    heatRows,
    'goal_heatmap_group_averages',
    ctx
  );

  Plotly.newPlot('lab-group-coverage-chart', [{
    type: 'bar',
    x: entries.map(e => e.group),
    y: entries.map(e => e.n),
    marker: { color: '#264653' },
    hovertemplate: '%{x}<br>Countries: %{y}<extra></extra>',
  }], {
    margin: { l: 55, r: 12, t: 10, b: 95 },
    xaxis: { tickangle: -30 },
    yaxis: { title: 'Countries in group' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-group-coverage-chart',
    ['group', 'countries_count'],
    entries.map(e => [e.group, e.n]),
    'group_coverage',
    ctx
  );

  const goalAverages = GOAL_KEYS.map((g, i) => ({
    goal: `Goal ${i + 1}`,
    score: avg(S.filtered.map(r => getMetricValue(r, g))),
  }));
  Plotly.newPlot('lab-goal-line-chart', [{
    type: 'scatter',
    mode: 'lines+markers',
    x: goalAverages.map(g => g.goal),
    y: goalAverages.map(g => g.score),
    line: { color: '#0b6e4f', width: 2 },
    marker: { color: '#0b6e4f', size: 7 },
    hovertemplate: '%{x}<br>Avg score: %{y:.2f}<extra></extra>',
  }], {
    margin: { l: 50, r: 12, t: 10, b: 70 },
    xaxis: { tickangle: -28 },
    yaxis: { title: 'Average goal score', range: [0, 100] },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-goal-line-chart',
    ['goal', 'average_score'],
    goalAverages.map(g => [g.goal, g.score]),
    'goal_averages_filtered',
    ctx
  );

  E.notes.innerHTML = `
    <p><strong>Current scheme:</strong> ${esc(cfg.label)}${f.group ? ` | <strong>Selected group:</strong> ${esc(f.group)}` : ''}.</p>
    <p>
      This comparison recomputes peer averages after filtering. A country can move from top quartile to median depending on which classification
      is used (income class, geographic region, fragility, or SDG geogroup), so policy interpretation should always state the grouping rule.
    </p>
    <p>
      Tip: use <strong>UN SDG Geographic Group</strong> to align with UN SDG reporting narratives, and <strong>World Bank Income</strong>
      for financing and economic comparability.
    </p>
  `;
}

function metricColor(v) {
  if (v === null) return '#8f9ca8';
  if (v < 40) return '#c0392b';
  if (v < 55) return '#e67e22';
  if (v < 70) return '#d4a017';
  if (v < 85) return '#2a9d8f';
  return '#0b6e4f';
}

function ensureMap() {
  if (S.map) return;
  S.map = L.map('lab-map', { zoomControl: true, worldCopyJump: true }).setView([18, 12], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 6,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(S.map);
  S.mapLayer = L.layerGroup().addTo(S.map);
}

function renderGeo(f) {
  const geoPanelHidden = document.getElementById('panel-geo')?.classList.contains('hidden');
  if (!S.map && geoPanelHidden) return;
  const ctx = filterContext(f);
  setTitle('lab-region-dist-title', `Regional average ${metricLabel(f.metric)} | ${ctx}`);
  setTitle('lab-region-box-title', `Regional spread ${metricLabel(f.metric)} | ${ctx}`);

  ensureMap();
  S.mapLayer.clearLayers();

  const geoRows = S.filtered.filter(r => r.lat !== null && r.lon !== null);
  for (const row of geoRows) {
    const mv = getMetricValue(row, f.metric);
    const radius = mv === null ? 5 : Math.max(4, Math.min(16, mv / 6));
    const marker = L.circleMarker([row.lat, row.lon], {
      radius,
      color: '#ffffff',
      weight: 1,
      fillColor: metricColor(mv),
      fillOpacity: 0.9,
    });

    marker.bindPopup(`
      <strong>${esc(row.name)} (${esc(row.iso3)})</strong><br>
      ${esc(metricLabel(f.metric))}: ${mv === null ? 'n/a' : mv.toFixed(2)}<br>
      Overall: ${row.Overall_Score === null ? 'n/a' : row.Overall_Score.toFixed(2)}<br>
      SDR region: ${esc(row.apiRegion)}<br>
      UN region: ${esc(row.country?.region_name_en)}<br>
      WB income: ${esc(row.country?.wb_income_name)}<br>
      FCS: ${esc((row.members?.fcs_category || []).join(', ') || 'No')}
    `);

    marker.addTo(S.mapLayer);
  }

  if (geoRows.length) {
    const bounds = L.latLngBounds(geoRows.map(r => [r.lat, r.lon]));
    S.map.fitBounds(bounds.pad(0.12));
  }

  const reg = new Map();
  for (const row of S.filtered) {
    const key = row.apiRegion || 'Unspecified';
    if (!reg.has(key)) reg.set(key, []);
    reg.get(key).push(getMetricValue(row, f.metric));
  }

  const regEntries = [...reg.entries()].map(([k, vals]) => ({ region: k, v: avg(vals), n: vals.filter(x => x !== null).length }))
    .filter(e => e.v !== null)
    .sort((a, b) => b.v - a.v);

  Plotly.newPlot('lab-region-dist-chart', [{
    type: 'bar',
    x: regEntries.map(e => e.region),
    y: regEntries.map(e => e.v),
    marker: { color: regEntries.map((_, i) => palette(i)) },
    hovertemplate: '%{x}<br>Average: %{y:.2f}<extra></extra>',
  }], {
    margin: { l: 55, r: 12, t: 10, b: 80 },
    yaxis: { title: `Average ${metricLabel(f.metric)}` },
    xaxis: { tickangle: -25 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-region-dist-chart',
    ['sdr_region', 'average_metric', 'countries_with_metric', 'metric'],
    regEntries.map(e => [e.region, e.v, e.n, metricLabel(f.metric)]),
    `region_distribution_${slug(metricLabel(f.metric))}`,
    ctx
  );

  setChartExport(
    'lab-map',
    ['country', 'iso3', 'lat', 'lon', 'metric', 'metric_value', 'overall_score', 'spillover_score', 'sdr_region', 'un_region', 'wb_income'],
    geoRows.map(r => [
      r.name, r.iso3, r.lat, r.lon, metricLabel(f.metric), getMetricValue(r, f.metric), r.Overall_Score, r.Spillover_Score,
      r.apiRegion, r.country?.region_name_en || '', r.country?.wb_income_name || '',
    ]),
    `map_points_${slug(metricLabel(f.metric))}`,
    ctx
  );

  const boxGroups = [...new Set(S.filtered.map(r => r.apiRegion).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const traces = boxGroups.map((region, i) => ({
    type: 'box',
    name: region,
    y: S.filtered.filter(r => r.apiRegion === region).map(r => getMetricValue(r, f.metric)).filter(v => v !== null),
    marker: { color: palette(i) },
    boxmean: 'sd',
  }));
  Plotly.newPlot('lab-region-box-chart', traces, {
    margin: { l: 55, r: 12, t: 10, b: 85 },
    yaxis: { title: metricLabel(f.metric), range: [0, 100] },
    xaxis: { tickangle: -25 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  const boxRows = [];
  for (const region of boxGroups) {
    for (const r of S.filtered.filter(x => x.apiRegion === region)) {
      const v = getMetricValue(r, f.metric);
      if (v !== null) boxRows.push([region, r.name, r.iso3, metricLabel(f.metric), v]);
    }
  }
  setChartExport(
    'lab-region-box-chart',
    ['sdr_region', 'country', 'iso3', 'metric', 'metric_value'],
    boxRows,
    `region_boxplot_${slug(metricLabel(f.metric))}`,
    ctx
  );
}

function renderCountryPanel() {
  const options = [...S.filtered].sort((a, b) => a.name.localeCompare(b.name));
  const current = E.countrySelect.value;
  E.countrySelect.innerHTML = '';
  for (const row of options) {
    const o = document.createElement('option');
    o.value = row.iso3;
    o.textContent = `${row.name} (${row.iso3})`;
    E.countrySelect.appendChild(o);
  }

  if (!options.length) {
    E.countryMeta.innerHTML = '<p>No countries match current filters.</p>';
    Plotly.purge('lab-country-goals-chart');
    Plotly.purge('lab-country-indicator-chart');
    setChartExport('lab-country-goals-chart', ['country', 'iso3', 'goal', 'goal_score'], [], 'country_goal_profile');
    setChartExport('lab-country-indicator-chart', ['country', 'iso3', 'bucket', 'indicator_code', 'indicator_name', 'normalized_score'], [], 'country_indicators');
    return;
  }

  if (options.some(o => o.iso3 === current)) E.countrySelect.value = current;
  else E.countrySelect.value = options[0].iso3;

  renderSelectedCountry();
}

function renderSelectedCountry() {
  const iso3 = E.countrySelect.value;
  const row = S.filtered.find(r => r.iso3 === iso3) || S.rows.find(r => r.iso3 === iso3);
  if (!row) return;
  const f = activeFilters();
  const ctx = `${filterContext(f)} | Country=${row.iso3}`;
  setTitle('lab-country-goal-title', `Goal profile for ${row.name} (${row.iso3})`);
  setTitle('lab-country-indicator-title', `Indicator strengths and gaps for ${row.name} (${row.iso3})`);

  const groups = {
    'UN SDG groups': (row.members?.un_sdg || []).join('; ') || 'n/a',
    'OECD DAC': (row.members?.oecd_dac_group || []).join('; ') || 'n/a',
    'FCS category': (row.members?.fcs_category || []).join('; ') || 'n/a',
  };

  E.countryMeta.innerHTML = `
    <h3 style="margin:.6rem 0 .35rem">${esc(row.name)} (${esc(row.iso3)})</h3>
    <p style="margin:.2rem 0">SDR region: <strong>${esc(row.apiRegion || 'n/a')}</strong></p>
    <p style="margin:.2rem 0">Overall rank: <strong>${row.Overall_Rank === null ? 'n/a' : row.Overall_Rank}</strong> | Spillover rank: <strong>${row.Spillover_Rank === null ? 'n/a' : row.Spillover_Rank}</strong></p>
    <p style="margin:.2rem 0">Missing indicator share: <strong>${row.sdr?.pct_missing == null ? 'n/a' : `${row.sdr.pct_missing}%`}</strong> | VNRs completed: <strong>${row.sdr?.vnr_completed == null ? 'n/a' : row.sdr.vnr_completed}</strong></p>
    <p style="margin:.2rem 0">UN region: <strong>${esc(row.country?.region_name_en || 'n/a')}</strong> | WB income: <strong>${esc(row.country?.wb_income_name || 'n/a')}</strong></p>
    <p style="margin:.2rem 0">${Object.entries(groups).map(([k, v]) => `<strong>${esc(k)}:</strong> ${esc(v)}`).join(' | ')}</p>
  `;

  const x = Array.from({ length: 17 }, (_, i) => `G${i + 1}`);
  const y = GOAL_KEYS.map(k => getMetricValue(row, k));

  Plotly.newPlot('lab-country-goals-chart', [{
    type: 'scatterpolar',
    r: [...y, y[0]],
    theta: [...x, x[0]],
    fill: 'toself',
    line: { color: '#0b6e4f', width: 2 },
    fillcolor: 'rgba(11,110,79,0.25)',
    hovertemplate: '%{theta}: %{r:.2f}<extra></extra>',
  }], {
    polar: { radialaxis: { visible: true, range: [0, 100] } },
    margin: { l: 30, r: 30, t: 10, b: 10 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    showlegend: false,
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-country-goals-chart',
    ['country', 'iso3', 'goal', 'goal_score'],
    GOAL_KEYS.map((k, i) => [row.name, row.iso3, `Goal ${i + 1}`, getMetricValue(row, k)]),
    `country_goal_profile_${slug(row.iso3)}`,
    ctx
  );

  const indicatorEntries = Object.entries(row.sdr?.indicators || {})
    .map(([ind, val]) => ({ ind, val: n(val), name: clean(S.codebookByInd.get(ind)?.Indicator) || ind }))
    .filter(x => x.val !== null);
  const strongest = [...indicatorEntries].sort((a, b) => b.val - a.val).slice(0, 8);
  const weakest = [...indicatorEntries].sort((a, b) => a.val - b.val).slice(0, 8);
  const combo = [...strongest.map(x => ({ ...x, bucket: 'Strongest' })), ...weakest.map(x => ({ ...x, bucket: 'Weakest' }))];

  Plotly.newPlot('lab-country-indicator-chart', [{
    type: 'bar',
    orientation: 'h',
    y: combo.map(c => `${c.bucket}: ${c.name}`),
    x: combo.map(c => c.val),
    marker: { color: combo.map(c => c.bucket === 'Strongest' ? '#0b6e4f' : '#c0392b') },
    hovertemplate: '%{y}<br>Score: %{x:.2f}<extra></extra>',
  }], {
    margin: { l: 240, r: 15, t: 10, b: 35 },
    xaxis: { title: 'Normalized indicator score' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });
  setChartExport(
    'lab-country-indicator-chart',
    ['country', 'iso3', 'bucket', 'indicator_code', 'indicator_name', 'normalized_score'],
    combo.map(c => [row.name, row.iso3, c.bucket, c.ind, c.name, c.val]),
    `country_indicators_${slug(row.iso3)}`,
    ctx
  );
}

function renderTable() {
  E.tableBody.innerHTML = '';
  for (const row of S.filtered.slice(0, 120)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(row.name)}</td>
      <td><code>${esc(row.iso3)}</code></td>
      <td>${esc(row.apiRegion)}</td>
      <td>${row.Overall_Score === null ? '' : row.Overall_Score.toFixed(2)}</td>
      <td>${row.Spillover_Score === null ? '' : row.Spillover_Score.toFixed(2)}</td>
      <td>${row.progress === null ? '' : row.progress.toFixed(2)}</td>
      <td>${esc(row.country?.region_name_en)}</td>
      <td>${esc(row.country?.wb_income_name)}</td>
      <td>${esc((row.members?.fcs_category || []).join('; '))}</td>
    `;
    E.tableBody.appendChild(tr);
  }
}

function initAggregatesOptions() {
  if (!E.aggGroup) return;
  const groups = [...new Set(S.aggregates.map(r => clean(r.country_grouping)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  E.aggGroup.innerHTML = '';
  for (const g of groups) {
    const o = document.createElement('option');
    o.value = g;
    o.textContent = g;
    E.aggGroup.appendChild(o);
  }
}

function renderAggregatesTab() {
  if (!E.aggGroup || !E.aggBody) return;
  const selected = E.aggGroup.value || '';
  if (!selected) return;

  const grouped = S.aggregates.filter(r => clean(r.country_grouping) === selected);
  const byIso = new Map();
  for (const r of grouped) {
    if (!byIso.has(r.iso3)) byIso.set(r.iso3, r);
  }
  const uniqueRows = [...byIso.values()].sort((a, b) => clean(a['Country or Area']).localeCompare(clean(b['Country or Area'])));

  setTitle('lab-agg-chart-title', `Countries per classification group | Selected: ${selected}`);
  setTitle('lab-agg-table-title', `Countries in: ${selected}`);
  if (E.aggSummary) E.aggSummary.textContent = `${uniqueRows.length} unique countries in selected group (${grouped.length} aggregate records).`;

  E.aggBody.innerHTML = '';
  for (const r of uniqueRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(r['Country or Area'])}</td>
      <td><code>${esc(r.iso3)}</code></td>
      <td>${esc(r.iso2)}</td>
      <td>${esc(r['M49 Code'])}</td>
      <td>${esc(r.country_grouping)}</td>
    `;
    E.aggBody.appendChild(tr);
  }

  const groupToIso = new Map();
  for (const r of S.aggregates) {
    const g = clean(r.country_grouping);
    if (!g) continue;
    if (!groupToIso.has(g)) groupToIso.set(g, new Set());
    if (clean(r.iso3)) groupToIso.get(g).add(clean(r.iso3));
  }
  const counts = [...groupToIso.entries()].map(([group, isoSet]) => ({ group, countries: isoSet.size }))
    .sort((a, b) => b.countries - a.countries)
    .slice(0, 35);

  Plotly.newPlot('lab-agg-group-size-chart', [{
    type: 'bar',
    x: counts.map(c => c.group),
    y: counts.map(c => c.countries),
    marker: { color: counts.map(c => c.group === selected ? '#c0392b' : '#0b6e4f') },
    hovertemplate: '%{x}<br>Countries: %{y}<extra></extra>',
  }], {
    margin: { l: 55, r: 12, t: 10, b: 120 },
    xaxis: { tickangle: -35 },
    yaxis: { title: 'Unique countries' },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
  }, { displayModeBar: false, responsive: true });

  setChartExport(
    'lab-agg-group-size-chart',
    ['country_grouping', 'unique_country_count'],
    counts.map(c => [c.group, c.countries]),
    'aggregates_group_sizes',
    `Aggregates tab | selected group=${selected}`
  );
}

async function downloadChartImage(chartId) {
  const ex = S.chartExports[chartId] || {};
  const foot = `Created by ${GENERATED_BY} | Source: ${SOURCE_CITATION}`;

  async function drawFooterAndDownload(dataUrl, fileName) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = dataUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height + 52;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = '#0f2d2a';
    ctx.fillRect(0, img.height, canvas.width, 52);
    ctx.fillStyle = '#ffffff';
    ctx.font = '15px Space Grotesk, sans-serif';
    ctx.fillText(foot.slice(0, 170), 14, img.height + 31);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${fileName || chartId}.png`;
    a.click();
  }

  if (chartId === 'lab-map') {
    const node = document.getElementById('lab-map');
    if (!node || typeof html2canvas !== 'function') {
      window.alert('Map image export is unavailable.');
      return;
    }
    try {
      const canvas = await html2canvas(node, { useCORS: true, backgroundColor: '#ffffff', scale: 2 });
      await drawFooterAndDownload(canvas.toDataURL('image/png'), ex.baseName || 'sdg-map');
    } catch (err) {
      console.error(err);
      window.alert('Map image export failed. Try again after map tiles finish loading.');
    }
    return;
  }

  const chartEl = document.getElementById(chartId);
  if (!chartEl) return;
  try {
    const url = await Plotly.toImage(chartEl, {
      format: 'png',
      width: 1400,
      height: 900,
    });
    await drawFooterAndDownload(url, ex.baseName || chartId);
  } catch (err) {
    console.error(err);
    window.alert('Chart image export failed.');
  }
}

function downloadChartData(chartId) {
  const ex = S.chartExports[chartId];
  if (!ex || !ex.rows) {
    window.alert('No data available for this chart yet.');
    return;
  }
  downloadCsv(`${ex.baseName || chartId}.csv`, ex.headers || [], ex.rows || [], { context: ex.context || '' });
}

function wireChartExports() {
  document.querySelectorAll('.chart-export').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const chartId = btn.dataset.chart;
      const mode = btn.dataset.export;
      if (!chartId || !mode) return;
      if (mode === 'data') downloadChartData(chartId);
      if (mode === 'image') await downloadChartImage(chartId);
    });
  });
}

function wireTabs() {
  document.querySelectorAll('.lab-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.lab-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('main .tab-content').forEach(panel => panel.classList.add('hidden'));
      document.getElementById(`panel-${tab}`).classList.remove('hidden');
      if (tab === 'geo') {
        renderGeo(activeFilters());
        if (S.map) setTimeout(() => S.map.invalidateSize(), 80);
      }
      if (tab === 'all-classifications') {
        renderAggregatesTab();
      }
    });
  });
}

function wireFilters() {
  const rerender = () => applyFilters();
  [E.search, E.metric, E.group, E.publisherRegion, E.topN, E.min, E.max, E.missing]
    .forEach(el => {
      el.addEventListener('input', rerender);
      el.addEventListener('change', rerender);
    });

  E.scheme.addEventListener('change', () => {
    updateGroupOptions();
    applyFilters();
  });

  E.reset.addEventListener('click', () => {
    E.search.value = '';
    E.metric.value = 'Overall_Score';
    E.scheme.value = 'all';
    updateGroupOptions();
    E.group.value = '';
    E.publisherRegion.value = '';
    E.topN.value = '15';
    E.min.value = '';
    E.max.value = '';
    E.missing.value = 'exclude';
    applyFilters();
  });

  E.countrySelect.addEventListener('change', renderSelectedCountry);
  if (E.aggGroup) E.aggGroup.addEventListener('change', renderAggregatesTab);
}

function renderSources() {
  E.sourceRibbon.innerHTML = `
    <a class="src-link" href="https://www.unsdsn.org/resources/sustainable-development-report-2025" target="_blank" rel="noreferrer">SDSN SDR 2025</a>
    <a class="src-link" href="https://dashboards.sdgindex.org/downloads/" target="_blank" rel="noreferrer">Report & materials</a>
    <a class="src-link" href="https://doi.org/10.25546/111909" target="_blank" rel="noreferrer">Official DOI citation</a>
    <a class="src-link" href="${SDR_API_URL}" target="_blank" rel="noreferrer">ArcGIS API endpoint</a>
  `;
}

async function init() {
  try {
    const [countries, memberships, codebook, indicatorRows, rows, aggregatesCsv] = await Promise.all([
      loadJson('countries_master.json'),
      loadJson('country_group_membership.json'),
      loadJson('sdr2025_codebook.json').catch(() => []),
      loadJson('sdr2025_indicator_scores.json').catch(() => []),
      loadSDRRows(),
      loadText('aggregates.csv').catch(() => ''),
    ]);

    S.countries = countries;
    S.memberships = memberships;
    S.codebook = Array.isArray(codebook) ? codebook : [];
    S.rows = rows;
    S.aggregates = aggregatesCsv ? parseCsv(aggregatesCsv) : [];
    S.indicatorsByIso = new Map((Array.isArray(indicatorRows) ? indicatorRows : []).map(r => [r.iso3, r]));
    S.codebookByInd = new Map(S.codebook.map(c => [clean(c.IndCode), c]));

    S.byIsoCountry = new Map(countries.map(c => [c.iso3, c]));
    indexMemberships();
    enrichRows();

    initFilterOptions();
    initAggregatesOptions();
    renderSources();
    wireFilters();
    wireChartExports();
    wireTabs();
    E.metric.value = 'Overall_Score';
    E.scheme.value = 'all';
    applyFilters();
    renderAggregatesTab();
  } catch (err) {
    console.error(err);
    E.error.textContent = `Failed to load SDG Analytics Lab data: ${err.message}`;
    E.error.classList.remove('hidden');
  }
}

init();
