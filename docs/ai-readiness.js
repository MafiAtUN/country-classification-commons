const DATA_BASES = [
  'data/', './data/', '/country-classification-commons/data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/docs/data/',
];

const GENERATED_BY = 'Country Classification Commons';
const SOURCE_CITATION = 'Oxford Insights (2025), Government AI Readiness Index 2025, https://oxfordinsights.com/ai-readiness/government-ai-readiness-index-2025/';

const SCHEMES = {
  all: { label: 'All classifications', getValues: () => ['All countries'] },
  un_region: { label: 'UN M49 Region', getValues: r => [clean(r.country?.region_name_en)] },
  un_sub_region: { label: 'UN M49 Sub-region', getValues: r => [clean(r.country?.sub_region_name_en)] },
  wb_region: { label: 'World Bank Region', getValues: r => [clean(r.country?.wb_region_name)] },
  wb_income: { label: 'World Bank Income', getValues: r => [clean(r.country?.wb_income_name)] },
  sdg_geo: { label: 'UN SDG Group', getValues: r => r.members?.un_sdg || [] },
  oecd_group: { label: 'OECD DAC Group', getValues: r => r.members?.oecd_dac_group || [] },
  fcs_category: { label: 'WB FCS Category', getValues: r => r.members?.fcs_category || [] },
  special_un: {
    label: 'UN Special (LDC/LLDC/SIDS)',
    getValues: r => {
      const out = [];
      if (flag(r.country?.is_ldc)) out.push('LDC');
      if (flag(r.country?.is_lldc)) out.push('LLDC');
      if (flag(r.country?.is_sids)) out.push('SIDS');
      return out;
    },
  },
};

const METRICS = [
  ['total', 'Overall AI Readiness'],
  ['policy_capacity', 'Policy Capacity'],
  ['ai_infrastructure', 'AI Infrastructure'],
  ['governance', 'Governance'],
  ['public_sector_adoption', 'Public Sector Adoption'],
  ['development_diffusion', 'Development & Diffusion'],
  ['resilience', 'Resilience'],
  ['policy_vision', 'Policy Vision'],
  ['policy_commitment', 'Policy Commitment'],
  ['compute_capacity', 'Compute Capacity'],
  ['enabling_technical_infrastructure', 'Enabling Technical Infrastructure'],
  ['data_quality', 'Data Quality'],
  ['governance_principles', 'Governance Principles'],
  ['regulatory_compliance', 'Regulatory Compliance'],
  ['government_digital_policy', 'Government Digital Policy'],
  ['egovernment_delivery', 'eGovernment Delivery'],
  ['human_capital', 'Human Capital'],
  ['ai_sector_maturity', 'AI Sector Maturity'],
  ['ai_technology_diffusion', 'AI Technology Diffusion'],
  ['societal_transition', 'Societal Transition'],
  ['safety_and_security', 'Safety & Security'],
];

const S = {
  rows: [],
  filtered: [],
  countries: [],
  memberships: [],
  byIso2Country: new Map(),
  byIso3Memberships: new Map(),
  chartExports: {},
  map: null,
  mapLayer: null,
};

const E = {
  error: document.getElementById('ai-error'),
  search: document.getElementById('ai-search'),
  metric: document.getElementById('ai-metric'),
  region: document.getElementById('ai-region'),
  income: document.getElementById('ai-income'),
  scheme: document.getElementById('ai-scheme'),
  group: document.getElementById('ai-group'),
  topN: document.getElementById('ai-topn'),
  missing: document.getElementById('ai-missing'),
  reset: document.getElementById('ai-reset'),
  kpis: document.getElementById('ai-kpis'),
  country: document.getElementById('ai-country'),
  meta: document.getElementById('ai-meta'),
};

function clean(v) { return (v == null || String(v).toLowerCase() === 'null') ? '' : String(v).trim(); }
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function flag(v) { return String(v).toLowerCase() === 'true'; }
function avg(arr) { const a = arr.filter(v => v !== null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function esc(s) { return clean(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function slug(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'chart'; }
function metricLabel(k) { return METRICS.find(x => x[0] === k)?.[1] || k; }
function context(f) { return `${SCHEMES[f.scheme]?.label || ''} | ${f.group || 'All groups'} | ${f.region || 'All AI regions'}`; }
function palette(i) { return ['#0b6e4f','#457b9d','#f4a261','#e76f51','#2a9d8f','#264653','#c0392b','#8e44ad'][i % 8]; }

async function loadJson(file) {
  const errs = [];
  for (const base of DATA_BASES) {
    const url = `${base}${file}`;
    try {
      const r = await fetch(url);
      if (!r.ok) { errs.push(`${url}:${r.status}`); continue; }
      return await r.json();
    } catch (e) { errs.push(`${url}:${e.message}`); }
  }
  throw new Error(`Failed to load ${file}: ${errs.join(' | ')}`);
}

function setChartExport(id, headers, rows, baseName, ctx) { S.chartExports[id] = { headers, rows, baseName, ctx }; }
function csvEscape(v) { const s = v == null ? '' : String(v); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replaceAll('"', '""')}"` : s; }
function downloadCsv(fileName, headers, rows, ctx) {
  const lines = [
    `# Created by ${GENERATED_BY}`,
    `# Data source citation: ${SOURCE_CITATION}`,
    `# Generated UTC: ${new Date().toISOString()}`,
    `# Filter context: ${ctx || ''}`,
    headers.map(csvEscape).join(','),
  ];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 900);
}

async function exportImage(chartId) {
  const ex = S.chartExports[chartId] || {};
  const footer = `Created by ${GENERATED_BY} | Source: ${SOURCE_CITATION}`;
  async function withFooter(dataUrl, fileName) {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = dataUrl;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height + 54;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = '#0f2d2a'; ctx.fillRect(0, img.height, c.width, 54);
    ctx.fillStyle = '#fff'; ctx.font = '14px Space Grotesk, sans-serif';
    ctx.fillText(footer.slice(0, 170), 14, img.height + 32);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png'); a.download = `${fileName || chartId}.png`; a.click();
  }

  try {
    if (chartId === 'ai-map') {
      const node = document.getElementById('ai-map');
      const c = await html2canvas(node, { useCORS: true, backgroundColor: '#fff', scale: 2 });
      await withFooter(c.toDataURL('image/png'), ex.baseName || 'ai-readiness-map');
    } else {
      const node = document.getElementById(chartId);
      const url = await Plotly.toImage(node, { format: 'png', width: 1400, height: 900 });
      await withFooter(url, ex.baseName || chartId);
    }
  } catch (e) {
    console.error(e); window.alert('Image export failed.');
  }
}

function exportData(chartId) {
  const ex = S.chartExports[chartId];
  if (!ex) return window.alert('No data export available yet.');
  downloadCsv(`${ex.baseName || chartId}.csv`, ex.headers, ex.rows, ex.ctx);
}

function setupFilters() {
  E.metric.innerHTML = METRICS.map(([k, lbl]) => `<option value="${k}">${lbl}</option>`).join('');
  E.scheme.innerHTML = Object.entries(SCHEMES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  const regions = [...new Set(S.rows.map(r => clean(r.region[0])).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const incomes = [...new Set(S.rows.map(r => clean(r.income_group[0])).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  E.region.innerHTML = '<option value="">All regions</option>' + regions.map(v => `<option value="${v}">${v}</option>`).join('');
  E.income.innerHTML = '<option value="">All income groups</option>' + incomes.map(v => `<option value="${v}">${v}</option>`).join('');
  refillGroups();
}

function refillGroups() {
  const scheme = E.scheme.value || 'all';
  const vals = new Set();
  for (const r of S.rows) for (const g of SCHEMES[scheme].getValues(r)) if (clean(g)) vals.add(g);
  const arr = [...vals].sort((a,b)=>a.localeCompare(b));
  E.group.innerHTML = '<option value="">All groups</option>' + arr.map(v => `<option value="${v}">${v}</option>`).join('');
}

function getFilters() {
  return {
    q: clean(E.search.value).toLowerCase(),
    metric: E.metric.value || 'total',
    region: E.region.value,
    income: E.income.value,
    scheme: E.scheme.value || 'all',
    group: E.group.value,
    topN: Number(E.topN.value) || 15,
    includeMissing: E.missing.value === 'include',
  };
}

function applyFilters() {
  const f = getFilters();
  S.filtered = S.rows.filter(r => {
    const hay = `${r.name} ${r.code} ${r.country?.country_name_en || ''}`.toLowerCase();
    if (f.q && !hay.includes(f.q)) return false;
    if (f.region && clean(r.region[0]) !== f.region) return false;
    if (f.income && clean(r.income_group[0]) !== f.income) return false;
    if (f.group) {
      const vals = SCHEMES[f.scheme].getValues(r);
      if (!vals.includes(f.group)) return false;
    }
    if (!f.includeMissing && n(r[f.metric]) === null) return false;
    return true;
  });

  renderKpis(f);
  renderCharts(f);
  renderCountrySelect();
}

function renderKpis(f) {
  const valid = S.filtered.filter(r => n(r[f.metric]) !== null);
  const vals = valid.map(r => n(r[f.metric]));
  const sorted = [...valid].sort((a,b)=>n(b[f.metric])-n(a[f.metric]));
  const top = sorted[0];
  E.kpis.innerHTML = `
    <article class="card kpi-card"><div class="kpi-label">Filtered countries</div><div class="kpi-value">${S.filtered.length}</div></article>
    <article class="card kpi-card"><div class="kpi-label">Average ${metricLabel(f.metric)}</div><div class="kpi-value">${vals.length ? (avg(vals).toFixed(1)) : 'n/a'}</div><div class="kpi-sub">${valid.length} with non-missing value</div></article>
    <article class="card kpi-card"><div class="kpi-label">Top country</div><div class="kpi-value">${top ? esc(top.name) : 'n/a'}</div></article>
    <article class="card kpi-card"><div class="kpi-label">Data source</div><div class="kpi-sub">Oxford Insights 2025</div></article>
  `;
}

function renderCharts(f) {
  const ctx = context(f);
  const validRows = S.filtered.filter(r => n(r[f.metric]) !== null);
  const sorted = [...validRows].sort((a,b)=>n(b[f.metric])-n(a[f.metric]));
  const top = sorted.slice(0, f.topN).reverse();
  const bottom = [...validRows].sort((a,b)=>n(a[f.metric])-n(b[f.metric])).slice(0, f.topN);

  const topTitle = document.getElementById('ai-top-title');
  const bottomTitle = document.getElementById('ai-bottom-title');
  const scatterTitle = document.getElementById('ai-scatter-title');
  const regionTitle = document.getElementById('ai-region-title');
  if (topTitle) topTitle.textContent = `Top ${Math.min(f.topN, sorted.length)} by ${metricLabel(f.metric)} | ${ctx}`;
  if (bottomTitle) bottomTitle.textContent = `Bottom ${Math.min(f.topN, sorted.length)} by ${metricLabel(f.metric)} | ${ctx}`;
  if (scatterTitle) scatterTitle.textContent = `Policy Capacity vs Development & Diffusion | ${ctx}`;
  if (regionTitle) regionTitle.textContent = `Average ${metricLabel(f.metric)} by AI region | ${ctx}`;

  Plotly.newPlot('ai-top-chart', [{ type:'bar', orientation:'h', y: top.map(r=>r.name), x: top.map(r=>n(r[f.metric])), marker:{color:'#0b6e4f'} }],
    { margin:{l:135,r:12,t:10,b:35}, xaxis:{title:metricLabel(f.metric)}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)' }, {displayModeBar:false,responsive:true});
  setChartExport('ai-top-chart', ['country','iso2','metric','value'], top.map(r=>[r.name,r.code,metricLabel(f.metric),n(r[f.metric])]), `ai_top_${slug(metricLabel(f.metric))}`, ctx);

  Plotly.newPlot('ai-bottom-chart', [{ type:'bar', orientation:'h', y: bottom.map(r=>r.name), x: bottom.map(r=>n(r[f.metric])), marker:{color:'#c0392b'} }],
    { margin:{l:135,r:12,t:10,b:35}, xaxis:{title:metricLabel(f.metric)}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)' }, {displayModeBar:false,responsive:true});
  setChartExport('ai-bottom-chart', ['country','iso2','metric','value'], bottom.map(r=>[r.name,r.code,metricLabel(f.metric),n(r[f.metric])]), `ai_bottom_${slug(metricLabel(f.metric))}`, ctx);

  Plotly.newPlot('ai-scatter-chart', [{
    type:'scatter', mode:'markers',
    x:validRows.map(r=>n(r.policy_capacity)), y:validRows.map(r=>n(r.development_diffusion)),
    text:validRows.map(r=>`${r.name} (${r.code})`),
    marker:{ size:validRows.map(r=>Math.max(8, Math.min(24, (n(r.total)||0)/4))), color:validRows.map((_,i)=>palette(i)), opacity:.8 },
    hovertemplate:'<b>%{text}</b><br>Policy Capacity: %{x:.2f}<br>Development & Diffusion: %{y:.2f}<extra></extra>',
  }], { margin:{l:55,r:12,t:10,b:40}, xaxis:{title:'Policy Capacity'}, yaxis:{title:'Development & Diffusion'}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)' }, {displayModeBar:false,responsive:true});
  setChartExport('ai-scatter-chart', ['country','iso2','policy_capacity','development_diffusion','total'], validRows.map(r=>[r.name,r.code,n(r.policy_capacity),n(r.development_diffusion),n(r.total)]), 'ai_policy_vs_diffusion', ctx);

  const regionMap = new Map();
  for (const r of validRows) {
    const rg = clean(r.region[0]) || 'Unspecified';
    if (!regionMap.has(rg)) regionMap.set(rg, []);
    regionMap.get(rg).push(n(r[f.metric]));
  }
  const rEntries = [...regionMap.entries()].map(([k,v])=>({region:k,avg:avg(v),n:v.filter(x=>x!==null).length})).filter(x=>x.avg!==null).sort((a,b)=>b.avg-a.avg);
  Plotly.newPlot('ai-region-chart', [{ type:'bar', x:rEntries.map(x=>x.region), y:rEntries.map(x=>x.avg), marker:{color:rEntries.map((_,i)=>palette(i)) } }],
    { margin:{l:55,r:12,t:10,b:90}, yaxis:{title:`Avg ${metricLabel(f.metric)}`}, xaxis:{tickangle:-30}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)' }, {displayModeBar:false,responsive:true});
  setChartExport('ai-region-chart', ['ai_region','average_metric','countries_count','metric'], rEntries.map(x=>[x.region,x.avg,x.n,metricLabel(f.metric)]), `ai_region_avg_${slug(metricLabel(f.metric))}`, ctx);

  renderMap(f, ctx);
}

function ensureMap() {
  if (S.map) return;
  S.map = L.map('ai-map', { worldCopyJump: true }).setView([18, 10], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 6, attribution: '&copy; OpenStreetMap contributors' }).addTo(S.map);
  S.mapLayer = L.layerGroup().addTo(S.map);
}

function color(v) {
  if (v == null) return '#8f9ca8';
  if (v < 25) return '#c0392b';
  if (v < 45) return '#e67e22';
  if (v < 60) return '#d4a017';
  if (v < 75) return '#2a9d8f';
  return '#0b6e4f';
}

function renderMap(f, ctx) {
  ensureMap();
  S.mapLayer.clearLayers();
  const rows = S.filtered.filter(r => r.lat !== null && r.lon !== null && n(r[f.metric]) !== null);
  for (const r of rows) {
    const v = n(r[f.metric]);
    const mk = L.circleMarker([r.lat, r.lon], { radius: Math.max(4, Math.min(14, (v || 0) / 6)), color:'#fff', weight:1, fillColor:color(v), fillOpacity:.9 });
    mk.bindPopup(`<strong>${esc(r.name)} (${esc(r.code)})</strong><br>${esc(metricLabel(f.metric))}: ${v == null ? 'n/a' : v.toFixed(2)}<br>AI region: ${esc(clean(r.region[0]))}<br>UN region: ${esc(r.country?.region_name_en || '')}<br>WB income: ${esc(r.country?.wb_income_name || '')}`);
    mk.addTo(S.mapLayer);
  }
  if (rows.length) S.map.fitBounds(L.latLngBounds(rows.map(r => [r.lat, r.lon])).pad(0.12));
  setChartExport('ai-map', ['country','iso2','lat','lon','metric','value','ai_region','ai_income_group','un_region','wb_income'], rows.map(r=>[r.name,r.code,r.lat,r.lon,metricLabel(f.metric),n(r[f.metric]),clean(r.region[0]),clean(r.income_group[0]),clean(r.country?.region_name_en),clean(r.country?.wb_income_name)]), `ai_map_${slug(metricLabel(f.metric))}`, ctx);
}

function renderCountrySelect() {
  const opts = [...S.filtered].sort((a,b)=>a.name.localeCompare(b.name));
  const cur = E.country.value;
  E.country.innerHTML = '';
  for (const r of opts) {
    const o = document.createElement('option');
    o.value = r.code; o.textContent = `${r.name} (${r.code})`; E.country.appendChild(o);
  }
  if (!opts.length) {
    E.meta.innerHTML = '<p>No countries match current filters.</p>';
    Plotly.purge('ai-radar-chart');
    setChartExport('ai-radar-chart', ['country','iso2','pillar','score'], [], 'ai_country_profile', context(getFilters()));
    return;
  }
  if (opts.some(x => x.code === cur)) E.country.value = cur; else E.country.value = opts[0].code;
  renderCountryProfile();
}

function renderCountryProfile() {
  const code = E.country.value;
  const r = S.filtered.find(x => x.code === code) || S.rows.find(x => x.code === code);
  if (!r) return;
  const pillars = [
    ['policy_capacity','Policy Capacity'],
    ['ai_infrastructure','AI Infrastructure'],
    ['governance','Governance'],
    ['public_sector_adoption','Public Sector Adoption'],
    ['development_diffusion','Development & Diffusion'],
    ['resilience','Resilience'],
  ];
  E.meta.innerHTML = `
    <h3 style="margin:.4rem 0">${esc(r.name)} (${esc(r.code)})</h3>
    <p style="margin:.2rem 0">Overall score: <strong>${n(r.total)?.toFixed(2) || 'n/a'}</strong> | AI region: <strong>${esc(clean(r.region[0]))}</strong></p>
    <p style="margin:.2rem 0">Income group: <strong>${esc(clean(r.income_group[0]))}</strong> | UN region: <strong>${esc(clean(r.country?.region_name_en))}</strong></p>
  `;

  const theta = pillars.map(p => p[1]);
  const values = pillars.map(p => n(r[p[0]]));
  Plotly.newPlot('ai-radar-chart', [{ type:'scatterpolar', theta:[...theta,theta[0]], r:[...values,values[0]], fill:'toself', line:{color:'#0b6e4f', width:2}, fillcolor:'rgba(11,110,79,.24)' }],
    { polar:{radialaxis:{visible:true, range:[0,100]}}, margin:{l:25,r:25,t:10,b:10}, paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)', showlegend:false }, {displayModeBar:false,responsive:true});
  setChartExport('ai-radar-chart', ['country','iso2','pillar','score'], pillars.map(p=>[r.name,r.code,p[1],n(r[p[0]])]), `ai_country_profile_${slug(r.code)}`, `${context(getFilters())} | Country=${r.code}`);
}

function wire() {
  const rerender = () => applyFilters();
  [E.search,E.metric,E.region,E.income,E.group,E.topN].forEach(el => { el.addEventListener('input', rerender); el.addEventListener('change', rerender); });
  E.missing.addEventListener('input', rerender);
  E.missing.addEventListener('change', rerender);
  E.scheme.addEventListener('change', () => { refillGroups(); applyFilters(); });
  E.country.addEventListener('change', renderCountryProfile);
  E.reset.addEventListener('click', () => {
    E.search.value=''; E.metric.value='total'; E.region.value=''; E.income.value=''; E.scheme.value='all'; refillGroups(); E.group.value=''; E.topN.value='15'; E.missing.value='exclude'; applyFilters();
  });
  document.querySelectorAll('.ai-export').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.chart; const mode = btn.dataset.export;
      if (mode === 'data') exportData(id);
      if (mode === 'image') await exportImage(id);
    });
  });
}

async function init() {
  try {
    const [countries, memberships, aiRows] = await Promise.all([
      loadJson('countries_master.json'),
      loadJson('country_group_membership.json'),
      loadJson('gairi_2025.json'),
    ]);

    S.countries = countries;
    S.memberships = memberships;
    S.rows = Array.isArray(aiRows) ? aiRows : [];
    S.byIso2Country = new Map(countries.map(c => [clean(c.iso2), c]));

    for (const m of memberships) {
      if (!S.byIso3Memberships.has(m.iso3)) S.byIso3Memberships.set(m.iso3, []);
      S.byIso3Memberships.get(m.iso3).push(m);
    }

    S.rows = S.rows.map(r => {
      const country = S.byIso2Country.get(clean(r.code)) || null;
      const ms = country ? (S.byIso3Memberships.get(country.iso3) || []) : [];
      const members = { un_sdg: [], oecd_dac_group: [], fcs_category: [] };
      for (const m of ms) {
        if (m.source === 'un_sdg' && m.group_type === 'region') members.un_sdg.push(m.group_name);
        if (m.source === 'oecd_dac' && m.group_type === 'oda_recipient_group') members.oecd_dac_group.push(m.group_name);
        if (m.source === 'world_bank_fcs' && m.group_type === 'fcs_category') members.fcs_category.push(m.group_name);
      }
      members.un_sdg = [...new Set(members.un_sdg)].sort((a,b)=>a.localeCompare(b));
      members.oecd_dac_group = [...new Set(members.oecd_dac_group)].sort((a,b)=>a.localeCompare(b));
      members.fcs_category = [...new Set(members.fcs_category)].sort((a,b)=>a.localeCompare(b));
      return {
        ...r,
        code: clean(r.code),
        name: clean(r.name),
        lat: n(country?.latitude),
        lon: n(country?.longitude),
        country,
        members,
      };
    });

    setupFilters();
    E.metric.value = 'total';
    E.scheme.value = 'all';
    refillGroups();
    wire();
    applyFilters();
  } catch (err) {
    console.error(err);
    E.error.textContent = `Failed to load AI Readiness analysis: ${err.message}`;
    E.error.classList.remove('hidden');
  }
}

init();
