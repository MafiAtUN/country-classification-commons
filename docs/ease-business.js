const DATA_BASES = [
  'data/', './data/', '../data/',
  'docs/data/', './docs/data/', '../docs/data/',
  '/data/', '/docs/data/',
  '/country-classification-commons/data/', '/country-classification-commons/docs/data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/docs/data/',
  'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/data/latest/',
  'https://cdn.jsdelivr.net/gh/MafiAtUN/country-classification-commons@main/docs/data/',
];

const GENERATED_BY = 'Country Classification Commons';
const SOURCE_CITATION = 'World Bank Doing Business source (archived), indicator IC.BUS.EASE.XQ and IC.BUS.EASE.DFRN.XQ.DB1719 via World Bank API source=Doing Business';
const WB_EDB_RANK_API = 'https://api.worldbank.org/v2/sources/1/country/all/series/IC.BUS.EASE.XQ/data?format=json&per_page=5000';
const WB_EDB_SCORE_API = 'https://api.worldbank.org/v2/sources/1/country/all/series/IC.BUS.EASE.DFRN.XQ.DB1719/data?format=json&per_page=5000';

const SCHEMES = {
  all: { label: 'All classifications', getValues: () => ['All countries'] },
  un_region: { label: 'UN M49 Region', getValues: r => [clean(r.country?.region_name_en)] },
  un_sub_region: { label: 'UN M49 Sub-region', getValues: r => [clean(r.country?.sub_region_name_en)] },
  wb_region: { label: 'World Bank Region', getValues: r => [clean(r.country?.wb_region_name)] },
  wb_income: { label: 'World Bank Income', getValues: r => [clean(r.country?.wb_income_name)] },
  sdg_geo: { label: 'UN SDG Group', getValues: r => r.members?.un_sdg || [] },
  oecd_group: { label: 'OECD DAC Group', getValues: r => r.members?.oecd_dac_group || [] },
  fcs_category: { label: 'WB FCS Category', getValues: r => r.members?.fcs_category || [] },
};

const S = {
  rows: [],
  filtered: [],
  countries: [],
  memberships: [],
  byIso3Country: new Map(),
  byIso3Memberships: new Map(),
  chartExports: {},
  map: null,
  mapLayer: null,
};

const E = {
  error: document.getElementById('edb-error'),
  search: document.getElementById('edb-search'),
  metric: document.getElementById('edb-metric'),
  scheme: document.getElementById('edb-scheme'),
  group: document.getElementById('edb-group'),
  topN: document.getElementById('edb-topn'),
  missing: document.getElementById('edb-missing'),
  reset: document.getElementById('edb-reset'),
  kpis: document.getElementById('edb-kpis'),
  country: document.getElementById('edb-country'),
  meta: document.getElementById('edb-meta'),
};

function clean(v){ return (v==null||String(v).toLowerCase()==='null')?'':String(v).trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function avg(arr){ const a=arr.filter(v=>v!==null); return a.length?a.reduce((x,y)=>x+y,0)/a.length:null; }
function esc(s){ return clean(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function slug(s){ return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')||'chart'; }
function palette(i){ return ['#0b6e4f','#457b9d','#f4a261','#e76f51','#2a9d8f','#264653','#c0392b','#8e44ad'][i%8]; }
function metricLabel(k){ return k==='rank' ? 'Ease of Doing Business Rank' : 'Ease of Doing Business Score'; }
function context(f){ return `${SCHEMES[f.scheme]?.label||''} | ${f.group||'All groups'}`; }

async function loadJson(file){
  const errs=[];
  for(const b of DATA_BASES){
    const u=`${b}${file}`;
    try{
      const r=await fetch(u);
      if(!r.ok){ errs.push(`${u}:${r.status}`); continue; }
      return await r.json();
    }catch(e){ errs.push(`${u}:${e.message}`); }
  }
  throw new Error(`Failed ${file}: ${errs.join(' | ')}`);
}

async function fetchWorldBankSeries(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`World Bank API request failed (${r.status}) for ${url}`);
  const payload = await r.json();
  if(!Array.isArray(payload) || !Array.isArray(payload[1])) throw new Error(`Unexpected World Bank response for ${url}`);
  return payload[1];
}

function latestByCountry(rows){
  const out = new Map();
  for(const row of rows){
    const iso3 = clean(row?.countryiso3code);
    if(!/^[A-Z]{3}$/.test(iso3)) continue;
    const year = Number(row?.date);
    const value = n(row?.value);
    if(!Number.isFinite(year) || value === null) continue;
    const prev = out.get(iso3);
    if(!prev || year > prev.year) out.set(iso3, { year, value });
  }
  return out;
}

async function loadEaseRows(){
  try{
    return await loadJson('ease_doing_business_latest.json');
  }catch(localErr){
    console.warn('Local ease_doing_business_latest.json missing, falling back to World Bank API.', localErr);
    try{
      const [rankRows, scoreRows] = await Promise.all([
        fetchWorldBankSeries(WB_EDB_RANK_API),
        fetchWorldBankSeries(WB_EDB_SCORE_API),
      ]);
      const nameByIso3 = new Map();
      for(const row of [...rankRows, ...scoreRows]){
        const iso3 = clean(row?.countryiso3code);
        if(!/^[A-Z]{3}$/.test(iso3)) continue;
        const name = clean(row?.country?.value);
        if(name && !nameByIso3.has(iso3)) nameByIso3.set(iso3, name);
      }
      const rankByIso3 = latestByCountry(rankRows);
      const scoreByIso3 = latestByCountry(scoreRows);
      const iso3s = [...new Set([...rankByIso3.keys(), ...scoreByIso3.keys()])].sort((a,b)=>a.localeCompare(b));
      return iso3s.map(iso3=>{
        const rank = rankByIso3.get(iso3) || null;
        const score = scoreByIso3.get(iso3) || null;
        return {
          iso3,
          country: nameByIso3.get(iso3) || iso3,
          rank: rank ? rank.value : null,
          rank_year: rank ? rank.year : null,
          score: score ? score.value : null,
          score_year: score ? score.year : null,
        };
      });
    }catch(wbErr){
      throw new Error(`Failed to load Ease dataset from local file and World Bank fallback. Local: ${localErr.message} | World Bank: ${wbErr.message}`);
    }
  }
}

function csvEscape(v){ const s=v==null?'':String(v); return (s.includes(',')||s.includes('"')||s.includes('\n'))?`"${s.replaceAll('"','""')}"`:s; }
function downloadCsv(file, headers, rows, ctx){
  const lines=[
    `# Created by ${GENERATED_BY}`,
    `# Data source citation: ${SOURCE_CITATION}`,
    `# Generated UTC: ${new Date().toISOString()}`,
    `# Filter context: ${ctx||''}`,
    headers.map(csvEscape).join(','),
  ];
  for(const r of rows) lines.push(r.map(csvEscape).join(','));
  const blob=new Blob([lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=file; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),900);
}
function setChartExport(id, headers, rows, baseName, ctx){ S.chartExports[id]={headers,rows,baseName,ctx}; }

async function exportImage(id){
  const ex=S.chartExports[id]||{};
  const footer=`Created by ${GENERATED_BY} | Source: ${SOURCE_CITATION}`;
  async function withFooter(dataUrl, fileName){
    const img=new Image(); img.crossOrigin='anonymous'; img.src=dataUrl;
    await new Promise((res,rej)=>{img.onload=res; img.onerror=rej;});
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height+54;
    const cx=c.getContext('2d');
    cx.fillStyle='#fff'; cx.fillRect(0,0,c.width,c.height); cx.drawImage(img,0,0);
    cx.fillStyle='#0f2d2a'; cx.fillRect(0,img.height,c.width,54);
    cx.fillStyle='#fff'; cx.font='14px Space Grotesk, sans-serif'; cx.fillText(footer.slice(0,170),14,img.height+32);
    const a=document.createElement('a'); a.href=c.toDataURL('image/png'); a.download=`${fileName||id}.png`; a.click();
  }
  try{
    if(id==='edb-map'){
      const node=document.getElementById('edb-map');
      const canvas=await html2canvas(node,{useCORS:true,backgroundColor:'#fff',scale:2});
      await withFooter(canvas.toDataURL('image/png'), ex.baseName||'edb-map');
    } else {
      const node=document.getElementById(id);
      const url=await Plotly.toImage(node,{format:'png',width:1400,height:900});
      await withFooter(url, ex.baseName||id);
    }
  }catch(e){ console.error(e); window.alert('Image export failed.'); }
}
function exportData(id){ const ex=S.chartExports[id]; if(!ex) return window.alert('No data yet.'); downloadCsv(`${ex.baseName||id}.csv`, ex.headers, ex.rows, ex.ctx); }

function refillGroups(){
  const scheme=E.scheme.value||'all';
  const vals=new Set();
  for(const r of S.rows) for(const g of SCHEMES[scheme].getValues(r)) if(clean(g)) vals.add(g);
  const arr=[...vals].sort((a,b)=>a.localeCompare(b));
  E.group.innerHTML='<option value="">All groups</option>'+arr.map(v=>`<option value="${v}">${v}</option>`).join('');
}

function getFilters(){
  return {
    q:clean(E.search.value).toLowerCase(),
    metric:E.metric.value||'score',
    scheme:E.scheme.value||'all',
    group:E.group.value,
    topN:Number(E.topN.value)||15,
    includeMissing:E.missing.value==='include',
  };
}

function applyFilters(){
  const f=getFilters();
  S.filtered=S.rows.filter(r=>{
    const hay=`${r.country_name} ${r.iso3} ${r.country?.country_name_en||''}`.toLowerCase();
    if(f.q && !hay.includes(f.q)) return false;
    if(f.group){
      const vals=SCHEMES[f.scheme].getValues(r);
      if(!vals.includes(f.group)) return false;
    }
    if(!f.includeMissing && n(r[f.metric])===null) return false;
    return true;
  });

  renderKpis(f);
  renderCharts(f);
  renderCountrySelect();
}

function renderKpis(f){
  const valid=S.filtered.filter(r=>n(r[f.metric])!==null);
  const vals=valid.map(r=>n(r[f.metric]));
  const sorted=[...valid].sort((a,b)=> f.metric==='rank' ? n(a.rank)-n(b.rank) : n(b.score)-n(a.score));
  const best=sorted[0];
  E.kpis.innerHTML=`
    <article class="card kpi-card"><div class="kpi-label">Filtered countries</div><div class="kpi-value">${S.filtered.length}</div></article>
    <article class="card kpi-card"><div class="kpi-label">Average ${metricLabel(f.metric)}</div><div class="kpi-value">${vals.length?avg(vals).toFixed(2):'n/a'}</div><div class="kpi-sub">${valid.length} with non-missing value</div></article>
    <article class="card kpi-card"><div class="kpi-label">Best country</div><div class="kpi-value">${best?esc(best.country_name):'n/a'}</div></article>
    <article class="card kpi-card"><div class="kpi-label">Series year</div><div class="kpi-value">2019</div></article>
  `;
}

function renderCharts(f){
  const ctx=context(f);
  const valid=S.filtered.filter(r=>n(r[f.metric])!==null);
  const sorted=[...valid].sort((a,b)=> f.metric==='rank' ? n(a.rank)-n(b.rank) : n(b.score)-n(a.score));
  const top=sorted.slice(0,f.topN).reverse();
  const bottom=(f.metric==='rank' ? [...valid].sort((a,b)=>n(b.rank)-n(a.rank)) : [...valid].sort((a,b)=>n(a.score)-n(b.score))).slice(0,f.topN);

  const topTitle=document.getElementById('edb-top-title');
  const bottomTitle=document.getElementById('edb-bottom-title');
  const regionTitle=document.getElementById('edb-region-title');
  const histTitle=document.getElementById('edb-hist-title');
  if(topTitle) topTitle.textContent=`Top ${Math.min(f.topN,sorted.length)} by ${metricLabel(f.metric)} | ${ctx}`;
  if(bottomTitle) bottomTitle.textContent=`Bottom ${Math.min(f.topN,sorted.length)} by ${metricLabel(f.metric)} | ${ctx}`;
  if(regionTitle) regionTitle.textContent=`Average ${metricLabel(f.metric)} by UN region | ${ctx}`;
  if(histTitle) histTitle.textContent=`${metricLabel(f.metric)} distribution | ${ctx}`;

  Plotly.newPlot('edb-top-chart',[{type:'bar',orientation:'h',y:top.map(r=>r.country_name),x:top.map(r=>n(r[f.metric])),marker:{color:'#0b6e4f'}}],
    {margin:{l:135,r:12,t:10,b:35},xaxis:{title:metricLabel(f.metric)},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)'},{displayModeBar:false,responsive:true});
  setChartExport('edb-top-chart',['country','iso3','metric','value'],top.map(r=>[r.country_name,r.iso3,metricLabel(f.metric),n(r[f.metric])]),`edb_top_${slug(metricLabel(f.metric))}`,ctx);

  Plotly.newPlot('edb-bottom-chart',[{type:'bar',orientation:'h',y:bottom.map(r=>r.country_name),x:bottom.map(r=>n(r[f.metric])),marker:{color:'#c0392b'}}],
    {margin:{l:135,r:12,t:10,b:35},xaxis:{title:metricLabel(f.metric)},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)'},{displayModeBar:false,responsive:true});
  setChartExport('edb-bottom-chart',['country','iso3','metric','value'],bottom.map(r=>[r.country_name,r.iso3,metricLabel(f.metric),n(r[f.metric])]),`edb_bottom_${slug(metricLabel(f.metric))}`,ctx);

  const reg=new Map();
  for(const r of valid){
    const k=clean(r.country?.region_name_en)||'Unspecified';
    if(!reg.has(k)) reg.set(k,[]);
    reg.get(k).push(n(r[f.metric]));
  }
  const re=[...reg.entries()].map(([k,v])=>({region:k,avg:avg(v),n:v.length})).filter(x=>x.avg!==null).sort((a,b)=>a.avg-b.avg);
  Plotly.newPlot('edb-region-chart',[{type:'bar',x:re.map(x=>x.region),y:re.map(x=>x.avg),marker:{color:re.map((_,i)=>palette(i))}}],
    {margin:{l:55,r:12,t:10,b:90},yaxis:{title:`Avg ${metricLabel(f.metric)}`},xaxis:{tickangle:-30},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)'},{displayModeBar:false,responsive:true});
  setChartExport('edb-region-chart',['un_region','average_metric','countries_count'],re.map(x=>[x.region,x.avg,x.n]),`edb_region_avg_${slug(metricLabel(f.metric))}`,ctx);

  Plotly.newPlot('edb-hist-chart',[{type:'histogram',x:valid.map(r=>n(r[f.metric])),nbinsx:20,marker:{color:'#457b9d'}}],
    {margin:{l:55,r:12,t:10,b:40},xaxis:{title:metricLabel(f.metric)},yaxis:{title:'Country count'},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)'},{displayModeBar:false,responsive:true});
  setChartExport('edb-hist-chart',['metric','value'],valid.map(r=>[metricLabel(f.metric),n(r[f.metric])]),`edb_distribution_${slug(metricLabel(f.metric))}`,ctx);

  renderMap(f, ctx, valid);
}

function ensureMap(){
  if(S.map) return;
  S.map=L.map('edb-map',{worldCopyJump:true}).setView([18,10],2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:6,attribution:'&copy; OpenStreetMap contributors'}).addTo(S.map);
  S.mapLayer=L.layerGroup().addTo(S.map);
}
function mapColor(v){
  if(v==null) return '#8f9ca8';
  if(v<25) return '#c0392b';
  if(v<50) return '#e67e22';
  if(v<75) return '#d4a017';
  return '#0b6e4f';
}
function renderMap(f, ctx, valid){
  ensureMap();
  S.mapLayer.clearLayers();
  const rows=valid.filter(r=>r.lat!==null && r.lon!==null);
  for(const r of rows){
    const v=n(r[f.metric]);
    const mk=L.circleMarker([r.lat,r.lon],{radius:Math.max(4,Math.min(13,(f.metric==='rank'?(200-(v||0)):(v||0))/8)),color:'#fff',weight:1,fillColor:mapColor(f.metric==='rank'?(200-(v||0)):v),fillOpacity:.9});
    mk.bindPopup(`<strong>${esc(r.country_name)} (${esc(r.iso3)})</strong><br>${esc(metricLabel(f.metric))}: ${v==null?'n/a':v.toFixed(2)}<br>UN region: ${esc(r.country?.region_name_en||'')}<br>WB income: ${esc(r.country?.wb_income_name||'')}`);
    mk.addTo(S.mapLayer);
  }
  if(rows.length) S.map.fitBounds(L.latLngBounds(rows.map(r=>[r.lat,r.lon])).pad(0.12));
  setChartExport('edb-map',['country','iso3','lat','lon','metric','value','un_region','wb_income'],rows.map(r=>[r.country_name,r.iso3,r.lat,r.lon,metricLabel(f.metric),n(r[f.metric]),clean(r.country?.region_name_en),clean(r.country?.wb_income_name)]),`edb_map_${slug(metricLabel(f.metric))}`,ctx);
}

function renderCountrySelect(){
  const opts=[...S.filtered].sort((a,b)=>a.country_name.localeCompare(b.country_name));
  const cur=E.country.value;
  E.country.innerHTML='';
  for(const r of opts){
    const o=document.createElement('option'); o.value=r.iso3; o.textContent=`${r.country_name} (${r.iso3})`; E.country.appendChild(o);
  }
  if(!opts.length){
    E.meta.innerHTML='<p>No countries match current filters.</p>';
    Plotly.purge('edb-country-chart');
    setChartExport('edb-country-chart',['country','iso3','metric','value'],[],'edb_country_profile',context(getFilters()));
    return;
  }
  if(opts.some(x=>x.iso3===cur)) E.country.value=cur; else E.country.value=opts[0].iso3;
  renderCountryProfile();
}

function renderCountryProfile(){
  const iso3=E.country.value;
  const r=S.filtered.find(x=>x.iso3===iso3) || S.rows.find(x=>x.iso3===iso3);
  if(!r) return;
  E.meta.innerHTML=`
    <h3 style="margin:.4rem 0">${esc(r.country_name)} (${esc(r.iso3)})</h3>
    <p style="margin:.2rem 0">Rank: <strong>${r.rank==null?'n/a':r.rank}</strong> (year ${r.rank_year||'n/a'}) | Score: <strong>${r.score==null?'n/a':Number(r.score).toFixed(2)}</strong> (year ${r.score_year||'n/a'})</p>
    <p style="margin:.2rem 0">UN region: <strong>${esc(clean(r.country?.region_name_en))}</strong> | WB income: <strong>${esc(clean(r.country?.wb_income_name))}</strong></p>
  `;

  Plotly.newPlot('edb-country-chart',[{type:'bar',x:['Rank','Score'],y:[n(r.rank),n(r.score)],marker:{color:['#c0392b','#0b6e4f']}}],
    {margin:{l:55,r:12,t:10,b:35},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)'},{displayModeBar:false,responsive:true});
  setChartExport('edb-country-chart',['country','iso3','rank','rank_year','score','score_year'],[[r.country_name,r.iso3,n(r.rank),r.rank_year,n(r.score),r.score_year]],`edb_country_${slug(r.iso3)}`,`${context(getFilters())} | Country=${r.iso3}`);
}

function wire(){
  const rerender=()=>applyFilters();
  [E.search,E.metric,E.group,E.topN,E.missing].forEach(el=>{el.addEventListener('input',rerender); el.addEventListener('change',rerender);});
  E.scheme.addEventListener('change',()=>{refillGroups(); applyFilters();});
  E.country.addEventListener('change',renderCountryProfile);
  E.reset.addEventListener('click',()=>{ E.search.value=''; E.metric.value='score'; E.scheme.value='all'; refillGroups(); E.group.value=''; E.topN.value='15'; E.missing.value='exclude'; applyFilters(); });
  document.querySelectorAll('.edb-export').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id=btn.dataset.chart, mode=btn.dataset.export;
      if(mode==='data') exportData(id);
      if(mode==='image') await exportImage(id);
    });
  });
}

async function init(){
  try{
    const [countries,memberships,rows]=await Promise.all([
      loadJson('countries_master.json'),
      loadJson('country_group_membership.json'),
      loadEaseRows(),
    ]);

    S.countries=countries;
    S.memberships=memberships;
    S.rows=Array.isArray(rows)?rows:[];
    S.byIso3Country=new Map(countries.map(c=>[clean(c.iso3),c]));

    for(const m of memberships){
      if(!S.byIso3Memberships.has(m.iso3)) S.byIso3Memberships.set(m.iso3,[]);
      S.byIso3Memberships.get(m.iso3).push(m);
    }

    S.rows=S.rows.map(r=>{
      const country=S.byIso3Country.get(clean(r.iso3)) || null;
      const ms=country?(S.byIso3Memberships.get(country.iso3)||[]):[];
      const members={un_sdg:[],oecd_dac_group:[],fcs_category:[]};
      for(const m of ms){
        if(m.source==='un_sdg' && m.group_type==='region') members.un_sdg.push(m.group_name);
        if(m.source==='oecd_dac' && m.group_type==='oda_recipient_group') members.oecd_dac_group.push(m.group_name);
        if(m.source==='world_bank_fcs' && m.group_type==='fcs_category') members.fcs_category.push(m.group_name);
      }
      members.un_sdg=[...new Set(members.un_sdg)].sort((a,b)=>a.localeCompare(b));
      members.oecd_dac_group=[...new Set(members.oecd_dac_group)].sort((a,b)=>a.localeCompare(b));
      members.fcs_category=[...new Set(members.fcs_category)].sort((a,b)=>a.localeCompare(b));
      return {
        ...r,
        iso3:clean(r.iso3),
        country_name:clean(r.country),
        rank:n(r.rank),
        score:n(r.score),
        lat:n(country?.latitude),
        lon:n(country?.longitude),
        country,
        members,
      };
    });

    E.scheme.innerHTML=Object.entries(SCHEMES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
    E.scheme.value='all';
    refillGroups();
    wire();
    applyFilters();
  }catch(err){
    console.error(err);
    E.error.textContent=`Failed to load Ease of Doing Business module: ${err.message}`;
    E.error.classList.remove('hidden');
  }
}

init();
