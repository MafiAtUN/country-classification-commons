/* Explorer: build a country list from groups, view it as a table, map, breakdown or comparison,
   and export it as CSV, ISO3 codes, a share link or code. State lives in the URL. */
(function () {
  'use strict';

  var $ = CC.$, $$ = CC.$$, esc = CC.esc, fold = CC.fold;
  var DATA_URL = CC.PAGES_DATA;

  var SCOPES = {
    un: { label: 'UN Member States', test: function (c) { return c.un_status === 'member_state'; },
      note: 'Only the 193 UN Member States. Switch to “All areas” to include territories such as Réunion or Greenland.' },
    un_obs: { label: 'UN Member and observer States', test: function (c) { return c.un_status !== 'non_member'; },
      note: 'The 193 Member States plus the Holy See and the State of Palestine.' },
    all: { label: 'countries and areas', test: function () { return true; },
      note: 'Every country and area in the UN M49 standard, including territories. Right for statistics, not for a list of States.' }
  };

  var PRESETS = [
    { label: 'Africa · 54 UN Members', scope: 'un', inc: ['un_m49.region.2'] },
    { label: 'African LDCs', scope: 'un', inc: ['un_m49.region.2', 'un_m49.special_group.ldc'] },
    { label: 'Small island developing States', scope: 'all', inc: ['un_m49.special_group.sids'] },
    { label: 'Low and lower-middle income', scope: 'all', inc: ['world_bank.income_level.lic', 'world_bank.income_level.lmc'], match: 'any' },
    { label: 'Fragile and conflict-affected', scope: 'all', inc: ['world_bank_fcs.fcs_status.fcs'] },
    { label: 'ODA recipients outside Africa', scope: 'all', inc: ['oecd_dac.oda_eligibility.oda'], ex: ['un_m49.region.2'] },
    { label: 'OECD members', scope: 'un', inc: ['oecd.membership.oecd'] },
    { label: 'Asia-Pacific Group', scope: 'un', inc: ['un_membership.regional_group.apg'] }
  ];

  var DIMS = [
    { key: 'un_regional_group', label: 'UN regional group', names: { AG: 'African Group', APG: 'Asia-Pacific Group', EEG: 'Eastern European Group', GRULAC: 'Latin American and Caribbean Group', WEOG: 'Western European and Others Group' }, group: function (v) { return 'un_membership.regional_group.' + v.toLowerCase(); } },
    { key: 'region', label: 'M49 region', system: 'UN M49 regions' },
    { key: 'sdg_region', label: 'SDG region', system: 'UN SDG regional groupings' },
    { key: 'wb_income_group', label: 'WB income', system: 'World Bank income groups', order: ['Low income', 'Lower middle income', 'Upper middle income', 'High income'] },
    { key: 'wb_region', label: 'WB region', system: 'World Bank regions' }
  ];

  var REG_GROUP = DIMS[0].names;
  var STATUS_LABEL = { member_state: 'UN Member', observer_state: 'Observer', non_member: 'Not a Member' };
  var STATUS_CLASS = { member_state: 'member', observer_state: 'observer', non_member: 'non' };
  var X_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  var D; // site data
  var state = { scope: 'un', inc: [], ex: [], match: 'all', tab: 'table', dim: 'un_regional_group', a: 'un_m49.region.2', b: 'un_membership.regional_group.ag', sort: 'name', dir: 1, filter: '' };
  var result = [];
  var pickerMode = 'in';

  /* ── URL state ─────────────────────────────────────────── */

  function readUrl() {
    var p = new URLSearchParams(location.search);
    if (SCOPES[p.get('scope')]) state.scope = p.get('scope');
    var list = function (k) { return (p.get(k) || '').split(',').filter(function (id) { return D.byGroup[id]; }); };
    state.inc = list('in');
    if (p.get('g') && D.byGroup[p.get('g')]) state.inc = [p.get('g')];
    state.ex = list('ex');
    state.match = p.get('match') === 'any' ? 'any' : 'all';
    if (/^(table|map|breakdown|compare)$/.test(p.get('tab'))) state.tab = p.get('tab');
    if (p.get('a') && D.byGroup[p.get('a')]) state.a = p.get('a');
    if (p.get('b') && D.byGroup[p.get('b')]) state.b = p.get('b');
    if (DIMS.some(function (d) { return d.key === p.get('dim'); })) state.dim = p.get('dim');
    return p.get('country');
  }
  function writeUrl() {
    var p = new URLSearchParams();
    if (state.scope !== 'un') p.set('scope', state.scope);
    if (state.inc.length) p.set('in', state.inc.join(','));
    if (state.ex.length) p.set('ex', state.ex.join(','));
    if (state.match === 'any' && state.inc.length > 1) p.set('match', 'any');
    if (state.tab !== 'table') p.set('tab', state.tab);
    if (state.tab === 'breakdown' && state.dim !== 'un_regional_group') p.set('dim', state.dim);
    if (state.tab === 'compare') { p.set('a', state.a); p.set('b', state.b); }
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  /* ── Selection logic ───────────────────────────────────── */

  function compute() {
    var scope = SCOPES[state.scope];
    var inc = state.inc.map(function (id) { return D.byGroup[id].set; });
    var ex = state.ex.map(function (id) { return D.byGroup[id].set; });
    result = D.countries.filter(function (c) {
      if (!scope.test(c)) return false;
      if (inc.length) {
        var ok = state.match === 'any'
          ? inc.some(function (s) { return s.has(c.iso3); })
          : inc.every(function (s) { return s.has(c.iso3); });
        if (!ok) return false;
      }
      return !ex.some(function (s) { return s.has(c.iso3); });
    });
  }

  function groupLabel(id) {
    var g = D.byGroup[id];
    return g ? g.group_name : id;
  }

  function describe() {
    var scope = SCOPES[state.scope].label;
    if (!state.inc.length && !state.ex.length) return 'All ' + scope + '.';
    var parts = [];
    if (state.inc.length) {
      parts.push('in ' + state.inc.map(function (id) {
        return '<b>' + esc(groupLabel(id)) + '</b> <span class="muted">(' + esc(D.byGroup[id].system) + ')</span>';
      }).join(state.match === 'any' ? ' or ' : ' and '));
    }
    if (state.ex.length) {
      parts.push('not in ' + state.ex.map(function (id) { return '<b>' + esc(groupLabel(id)) + '</b>'; }).join(' or '));
    }
    return scope.charAt(0).toUpperCase() + scope.slice(1) + ' ' + parts.join(', ') + '.';
  }

  /* ── Rendering ─────────────────────────────────────────── */

  function render() {
    compute();
    var noun = result.length === 1 ? 'country' : (state.scope === 'all' ? 'countries and areas' : 'countries');
    if (state.scope === 'all' && result.length === 1) noun = 'country or area';
    $('#result-count').innerHTML = CC.fmt(result.length) + '<small>' + noun + '</small>';
    $('#result-desc').innerHTML = describe();
    $$('#scope button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope)); });
    $('#scope-note').textContent = SCOPES[state.scope].note;
    renderRules();
    renderPresets();
    if (state.tab === 'table') renderTable();
    if (state.tab === 'map') renderMap();
    if (state.tab === 'breakdown') renderBreakdown();
    if (state.tab === 'compare') renderCompare();
    writeUrl();
  }

  function ruleHtml(id, kind) {
    var g = D.byGroup[id];
    return '<div class="rule' + (kind === 'ex' ? ' ex-rule' : '') + '"><div><span class="rule-name">' + esc(g.group_name) + '</span>' +
      '<span class="rule-sys">' + esc(g.system) + ' · ' + g.n_members + '</span></div>' +
      '<button class="icon-btn" type="button" data-remove="' + kind + '" data-id="' + esc(id) + '" aria-label="Remove ' + esc(g.group_name) + '">' + X_ICON + '</button></div>';
  }
  function renderRules() {
    $('#include-list').innerHTML = state.inc.map(function (id) { return ruleHtml(id, 'in'); }).join('');
    $('#exclude-list').innerHTML = state.ex.map(function (id) { return ruleHtml(id, 'ex'); }).join('');
    $('#match-wrap').hidden = state.inc.length < 2;
    $$('#match-wrap button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.match === state.match)); });
  }
  function renderPresets() {
    $('#presets').innerHTML = PRESETS.map(function (p, i) {
      var on = p.scope === state.scope && same(p.inc, state.inc) && same(p.ex || [], state.ex) && (p.inc.length < 2 || (p.match || 'all') === state.match);
      return '<button class="chip" type="button" data-preset="' + i + '" aria-pressed="' + on + '">' + esc(p.label) + '</button>';
    }).join('');
  }
  function same(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }

  function flagTags(c) {
    var t = [];
    if (c.is_ldc) t.push('LDC');
    if (c.is_lldc) t.push('LLDC');
    if (c.is_sids) t.push('SIDS');
    if (c.is_fcs) t.push('FCS');
    if (c.is_oecd_member) t.push('OECD');
    return t.map(function (x) { return '<span class="tag">' + x + '</span>'; }).join('');
  }
  function statusPill(c) {
    return '<span class="status-pill ' + STATUS_CLASS[c.un_status] + '">' + STATUS_LABEL[c.un_status] +
      (c.un_regional_group ? ' · ' + c.un_regional_group : '') + '</span>';
  }

  function renderTable() {
    var q = fold(state.filter.trim());
    var rows = result.filter(function (c) {
      return !q || fold(c.name).indexOf(q) >= 0 || [c.iso3, c.iso2, c.m49].map(fold).indexOf(q) >= 0 ||
        fold(c.name_fr + ' ' + c.name_es).indexOf(q) >= 0;
    });
    var k = state.sort, dir = state.dir;
    rows.sort(function (a, b) { return String(a[k] || '').localeCompare(String(b[k] || '')) * dir || a.name.localeCompare(b.name); });
    $$('#table th[data-key]').forEach(function (th) {
      th.setAttribute('aria-sort', th.dataset.key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    var tb = $('#table tbody');
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="7" class="empty">' + (result.length ? 'No rows match “' + esc(state.filter) + '”.' : 'No countries match this combination. Try “any” instead of “all”, or widen the scope.') + '</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (c) {
      return '<tr class="clickable" tabindex="0" data-iso="' + c.iso3 + '">' +
        '<td class="name-cell">' + esc(c.name) + '</td>' +
        '<td class="code-cell">' + c.iso3 + '</td>' +
        '<td class="code-cell">' + esc(c.m49) + '</td>' +
        '<td class="nowrap">' + statusPill(c) + '</td>' +
        '<td class="nowrap">' + esc(c.sub_region) + (c.intermediate_region ? '<div class="dim" style="font-size:.78rem">' + esc(c.intermediate_region) + '</div>' : '') + '</td>' +
        '<td class="nowrap">' + (esc(c.wb_income_group) || '<span class="dim">—</span>') + '</td>' +
        '<td><div class="flags">' + flagTags(c) + '</div></td></tr>';
    }).join('');
  }

  /* Breakdown: one bar per category of the chosen dimension, single hue. */
  function renderBreakdown() {
    var dim = DIMS.filter(function (d) { return d.key === state.dim; })[0];
    $('#dims').innerHTML = DIMS.map(function (d) {
      return '<button type="button" data-dim="' + d.key + '" aria-pressed="' + (d.key === state.dim) + '">' + d.label + '</button>';
    }).join('');
    var counts = {};
    result.forEach(function (c) { var v = c[dim.key] || ''; counts[v] = (counts[v] || 0) + 1; });
    var keys = Object.keys(counts);
    if (dim.order) keys.sort(function (a, b) { return (dim.order.indexOf(a) + 1 || 99) - (dim.order.indexOf(b) + 1 || 99); });
    else keys.sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    var max = Math.max.apply(null, keys.map(function (k) { return counts[k]; }).concat([1]));
    if (!keys.length) { $('#breakdown').innerHTML = '<p class="empty">Nothing to count yet.</p>'; return; }
    $('#breakdown').innerHTML = keys.map(function (k) {
      var name = k ? (dim.names ? dim.names[k] || k : k) : 'Not classified';
      var gid = k ? groupIdFor(dim, k) : null;
      var tag = gid ? 'button type="button" data-addgroup="' + esc(gid) + '"' : 'div';
      var close = gid ? 'button' : 'div';
      return '<' + tag + ' class="bar-row" aria-label="' + esc(name) + ': ' + counts[k] + '">' +
        '<span class="bar-label">' + esc(name) + (dim.names && k ? '<small>' + esc(k) + '</small>' : '') + '</span>' +
        '<span class="bar-track"><span class="bar-fill' + (k ? '' : ' secondary') + '" style="width:' + (counts[k] / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="bar-value">' + counts[k] + '</span></' + close + '>';
    }).join('');
  }
  function groupIdFor(dim, value) {
    if (dim.group) return dim.group(value);
    var g = D.groups.filter(function (x) { return x.system === dim.system && x.group_name === value; })[0];
    return g ? g.group_id : null;
  }

  function renderCompare() {
    var opts = D.systems.map(function (sys) {
      return '<optgroup label="' + esc(sys) + '">' + D.groups.filter(function (g) { return g.system === sys; }).map(function (g) {
        return '<option value="' + esc(g.group_id) + '">' + esc(g.group_name) + ' (' + g.n_members + ')</option>';
      }).join('') + '</optgroup>';
    }).join('');
    ['a', 'b'].forEach(function (k) {
      var sel = $('#cmp-' + k);
      if (!sel.options.length) sel.innerHTML = opts;
      sel.value = state[k];
    });
    var A = D.byGroup[state.a].set, B = D.byGroup[state.b].set;
    var onlyA = [], both = [], onlyB = [];
    D.countries.forEach(function (c) {
      var a = A.has(c.iso3), b = B.has(c.iso3);
      if (a && b) both.push(c); else if (a) onlyA.push(c); else if (b) onlyB.push(c);
    });
    function col(title, list, cls) {
      return '<div class="compare-col ' + cls + '"><h3><span>' + title + '</span><b>' + list.length + '</b></h3>' +
        (list.length ? '<ul>' + list.map(function (c) {
          return '<li data-iso="' + c.iso3 + '" tabindex="0"><span>' + esc(c.name) + '</span>' +
            (c.un_status !== 'member_state' ? '<span class="tag">' + (c.un_status === 'observer_state' ? 'observer' : 'not a Member') + '</span>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="empty">None</p>') + '</div>';
    }
    $('#compare').innerHTML = col('Only in A', onlyA, 'a') + col('In both', both, 'both') + col('Only in B', onlyB, 'b');
  }

  /* Map: lazy-loads d3 and the Natural Earth 110m world, joins on M49 (= ISO 3166 numeric). */
  var mapReady = null, mapSvg = null;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function renderMap() {
    if (!mapReady) {
      mapReady = loadScript('https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js')
        .then(function () { return loadScript('https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js'); })
        .then(function () { return fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(function (r) { return r.json(); }); })
        .then(drawMapBase)
        .catch(function () {
          $('#map').innerHTML = '<p class="empty">The map could not load (it needs cdn.jsdelivr.net). The table has the same list.</p>';
        });
    }
    mapReady.then(paintMap);
  }
  function drawMapBase(world) {
    var width = 960, height = 470;
    var land = topojson.feature(world, world.objects.countries);
    land.features = land.features.filter(function (f) { return f.id !== '010'; });
    var projection = d3.geoEqualEarth().fitExtent([[8, 8], [width - 8, height - 8]], land);
    var path = d3.geoPath(projection);
    var drawn = {};
    land.features.forEach(function (f) { if (f.id) drawn[f.id] = true; });
    var wrap = $('#map'); wrap.innerHTML = '';
    var svg = d3.select(wrap).append('svg').attr('viewBox', '0 0 ' + width + ' ' + height)
      .attr('role', 'img').attr('aria-label', 'World map of the selected countries');
    svg.append('path').attr('class', 'map-sphere').attr('d', path({ type: 'Sphere' }));
    var tip = document.createElement('div'); tip.className = 'viz-tip'; tip.setAttribute('aria-hidden', 'true'); document.body.appendChild(tip);
    function show(e, c, fallback) {
      tip.innerHTML = c ? '<b>' + esc(c.name) + '</b> <span class="mono">' + c.iso3 + '</span><br>' + STATUS_LABEL[c.un_status] + (c.sub_region ? ' · ' + esc(c.sub_region) : '')
        : esc(fallback || 'Not in UN M49');
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
      tip.style.top = (e.clientY + 14) + 'px';
      tip.classList.add('show');
    }
    var byM49 = {};
    D.countries.forEach(function (c) { byM49[c.m49] = c; });
    svg.append('g').selectAll('path').data(land.features).join('path')
      .attr('class', 'map-country').attr('d', path)
      .attr('data-m49', function (f) { return f.id || ''; })
      .on('mousemove', function (e, f) { show(e, byM49[f.id], f.properties && f.properties.name); })
      .on('mouseleave', function () { tip.classList.remove('show'); })
      .on('click', function (e, f) { if (byM49[f.id]) openCountry(byM49[f.id].iso3); });
    var dots = D.countries.filter(function (c) {
      return !drawn[c.m49] && c.latitude !== '' && c.latitude != null && c.longitude !== '' && c.longitude != null;
    });
    svg.append('g').selectAll('circle').data(dots).join('circle')
      .attr('class', 'map-dot').attr('r', 3.6)
      .attr('data-m49', function (c) { return c.m49; })
      .attr('cx', function (c) { return projection([+c.longitude, +c.latitude])[0]; })
      .attr('cy', function (c) { return projection([+c.longitude, +c.latitude])[1]; })
      .on('mousemove', function (e, c) { show(e, c); })
      .on('mouseleave', function () { tip.classList.remove('show'); })
      .on('click', function (e, c) { openCountry(c.iso3); });
    var legend = document.createElement('div');
    legend.className = 'map-legend';
    legend.innerHTML = '<span><i style="background:var(--accent-mark)"></i>In your list</span><span><i style="background:var(--map-empty)"></i>Not in your list</span>';
    wrap.appendChild(legend);
    mapSvg = svg;
  }
  function paintMap() {
    if (!mapSvg) return;
    var on = {};
    result.forEach(function (c) { on[c.m49] = true; });
    mapSvg.selectAll('.map-country, .map-dot').classed('on', function () { return !!on[this.getAttribute('data-m49')]; });
  }

  /* ── Country drawer ────────────────────────────────────── */

  var lastFocus = null;
  function openCountry(iso) {
    var c = D.byIso[iso];
    if (!c) return;
    lastFocus = document.activeElement;
    $('#drawer-eyebrow').textContent = c.un_status === 'member_state' ? 'UN Member State' : c.un_status === 'observer_state' ? 'UN non-member observer State' : 'Country or area · not a UN Member State';
    $('#drawer-title').textContent = c.name;
    $('#drawer-tags').innerHTML = '<span class="tag">' + c.iso3 + '</span><span class="tag">' + esc(c.iso2) + '</span><span class="tag">M49 ' + esc(c.m49) + '</span>' + flagTags(c);
    var groups = D.groupsOf[iso] || [];
    var bySys = {};
    groups.forEach(function (g) { (bySys[g.system] = bySys[g.system] || []).push(g); });
    var kv = [
      ['UN regional group', c.un_regional_group ? REG_GROUP[c.un_regional_group] : '—'],
      ['M49 region', [c.region, c.sub_region, c.intermediate_region].filter(Boolean).join(' › ') || '—'],
      ['SDG region', c.sdg_region || '—'],
      ['World Bank', [c.wb_region, c.wb_income_group, c.wb_lending_type].filter(Boolean).join(' · ') || 'Not covered'],
      ['ODA eligible', c.is_oda_eligible ? 'Yes' + (c.oda_recipient_group ? ' · ' + c.oda_recipient_group : '') : 'No'],
      ['Capital', c.capital || '—'],
      ['French', c.name_fr], ['Spanish', c.name_es]
    ];
    $('#drawer-body').innerHTML = '<dl class="kv">' + kv.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      '<div class="membership-list">' + D.systems.filter(function (s) { return bySys[s]; }).map(function (s) {
        return '<div><h3>' + esc(s) + '</h3><div class="chips">' + bySys[s].map(function (g) {
          return '<button class="chip" type="button" data-showgroup="' + esc(g.group_id) + '">' + esc(g.group_name) + '<span class="chip-n">' + g.n_members + '</span></button>';
        }).join('') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="btn-row" style="margin-top:1.5rem"><button class="btn btn-sm" type="button" data-copy="' + c.iso3 + '">Copy ISO3</button>' +
      '<button class="btn btn-sm" type="button" data-copy="' + location.origin + location.pathname + '?country=' + c.iso3 + '" data-copy-label="Link copied">Copy link</button></div>';
    var drawer = $('#drawer');
    drawer.hidden = false;
    requestAnimationFrame(function () { drawer.classList.add('open'); $('#scrim').classList.add('open'); });
    $('#drawer-close').focus();
  }
  function closeDrawer() {
    var drawer = $('#drawer');
    drawer.classList.remove('open'); $('#scrim').classList.remove('open');
    setTimeout(function () { drawer.hidden = true; }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function showGroup(id) {
    if (!D.byGroup[id]) return;
    state.inc = [id]; state.ex = [];
    if (state.tab === 'compare') state.tab = 'table';
    selectTab(state.tab);
    render();
  }

  /* ── Group picker ──────────────────────────────────────── */

  function openPicker(mode) {
    pickerMode = mode;
    $('#picker-title').textContent = mode === 'in' ? 'Include countries in…' : 'Exclude countries in…';
    $('#picker-search').value = '';
    renderPicker();
    openModal('#picker');
    setTimeout(function () { $('#picker-search').focus(); }, 0);
  }
  function renderPicker() {
    var q = fold($('#picker-search').value.trim());
    var scope = SCOPES[state.scope];
    var html = '';
    D.systems.forEach(function (sys) {
      var items = D.groups.filter(function (g) {
        return g.system === sys && (!q || fold(g.group_name + ' ' + g.system + ' ' + g.group_code).indexOf(q) >= 0);
      });
      if (!items.length) return;
      html += '<p class="picker-sys">' + esc(sys) + '</p>';
      items.forEach(function (g) {
        var n = g.members.filter(function (iso) { return D.byIso[iso] && scope.test(D.byIso[iso]); }).length;
        var used = state.inc.indexOf(g.group_id) >= 0 || state.ex.indexOf(g.group_id) >= 0;
        html += '<button class="picker-item" type="button" data-pick="' + esc(g.group_id) + '"' + (used ? ' disabled' : '') + '>' +
          '<span>' + esc(g.group_name) + '</span><span class="n">' + (used ? 'added' : n + (n !== g.n_members ? ' of ' + g.n_members : '')) + '</span></button>';
      });
    });
    $('#picker-list').innerHTML = html || '<p class="empty">No group matches. Try “income”, “Africa” or “SIDS”.</p>';
  }

  /* ── Modals ────────────────────────────────────────────── */

  var modalReturn = null;
  function openModal(sel) {
    modalReturn = document.activeElement;
    $(sel).classList.add('open');
    $('#scrim').classList.add('open');
  }
  function closeModals() {
    $$('.modal.open').forEach(function (m) { m.classList.remove('open'); });
    if (!$('#drawer').classList.contains('open')) $('#scrim').classList.remove('open');
    if (modalReturn && modalReturn.focus) modalReturn.focus();
  }

  /* ── Export ────────────────────────────────────────────── */

  var CSV_COLS = ['iso3', 'iso2', 'm49', 'name', 'un_status', 'is_un_member', 'un_regional_group', 'region', 'sub_region', 'intermediate_region',
    'sdg_region', 'is_ldc', 'is_lldc', 'is_sids', 'wb_region', 'wb_income_group', 'wb_lending_type', 'is_fcs', 'is_oda_eligible', 'is_oecd_member'];
  function toCsv(rows) {
    var cell = function (v) {
      var s = v === true ? 'true' : v === false ? 'false' : String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return CSV_COLS.join(',') + '\n' + rows.map(function (r) { return CSV_COLS.map(function (k) { return cell(r[k]); }).join(','); }).join('\n') + '\n';
  }
  function download() {
    var blob = new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'country-list-' + result.length + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    CC.toast('Downloaded ' + result.length + ' rows');
  }

  function q(s) { return '"' + s + '"'; }
  function sq(s) { return "'" + s + "'"; }
  function codeFor() {
    var inc = state.inc, ex = state.ex, any = state.match === 'any' && inc.length > 1;
    var scopePy = { un: 'countries.is_un_member', un_obs: 'countries.un_status != "non_member"', all: '' }[state.scope];
    var lines;

    // Python
    lines = ['import pandas as pd', '', 'base = ' + q(DATA_URL),
      'opts = dict(keep_default_na=False, dtype={"m49": str})  # keeps Namibia\'s ISO2 "NA" and M49 leading zeros',
      'countries = pd.read_csv(base + "countries.csv", **opts)'];
    if (inc.length || ex.length) {
      lines.push('members = pd.read_csv(base + "country_group_membership.csv", **opts)', '',
        'def in_group(*group_ids):', '    return countries.iso3.isin(members.loc[members.group_id.isin(group_ids), "iso3"])');
    }
    lines.push('', 'keep = ' + (scopePy || 'pd.Series(True, index=countries.index)'));
    if (any) lines.push('keep &= in_group(' + inc.map(q).join(', ') + ')  # any of');
    else inc.forEach(function (id) { lines.push('keep &= in_group(' + q(id) + ')  # ' + groupLabel(id)); });
    ex.forEach(function (id) { lines.push('keep &= ~in_group(' + q(id) + ')  # not ' + groupLabel(id)); });
    lines.push('result = countries[keep]', 'len(result)  # ' + result.length);
    var py = lines.join('\n');

    // R
    lines = ['library(readr)', 'library(dplyr)', '', 'base <- ' + q(DATA_URL),
      '# na = "" keeps Namibia\'s ISO2 "NA"; m49 as text keeps leading zeros',
      'countries <- read_csv(paste0(base, "countries.csv"), na = "", col_types = cols(m49 = "c"))'];
    if (inc.length || ex.length) {
      lines.push('members <- read_csv(paste0(base, "country_group_membership.csv"), na = "", col_types = cols(m49 = "c"))',
        'in_group <- function(...) members$iso3[members$group_id %in% c(...)]');
    }
    var rf = [];
    if (state.scope === 'un') rf.push('is_un_member');
    if (state.scope === 'un_obs') rf.push('un_status != "non_member"');
    if (any) rf.push('iso3 %in% in_group(' + inc.map(q).join(', ') + ')');
    else inc.forEach(function (id) { rf.push('iso3 %in% in_group(' + q(id) + ')'); });
    ex.forEach(function (id) { rf.push('!iso3 %in% in_group(' + q(id) + ')'); });
    lines.push('', 'result <- countries' + (rf.length ? ' |>\n  filter(\n    ' + rf.join(',\n    ') + '\n  )' : ''), 'nrow(result)  # ' + result.length);
    var r = lines.join('\n');

    // SQL (DuckDB)
    var where = [];
    if (state.scope === 'un') where.push('is_un_member');
    if (state.scope === 'un_obs') where.push("un_status <> 'non_member'");
    var sub = function (ids) { return "(SELECT iso3 FROM members WHERE group_id IN (" + ids.map(sq).join(', ') + '))'; };
    if (any) where.push('iso3 IN ' + sub(inc));
    else inc.forEach(function (id) { where.push('iso3 IN ' + sub([id]) + '  -- ' + groupLabel(id)); });
    ex.forEach(function (id) { where.push('iso3 NOT IN ' + sub([id]) + '  -- not ' + groupLabel(id)); });
    var sql = '-- DuckDB reads straight from the URL\nCREATE OR REPLACE VIEW countries AS\n  SELECT * FROM read_csv(' + sq(DATA_URL + 'countries.csv') + ", types = {'m49': 'VARCHAR'});\n" +
      ((inc.length || ex.length) ? 'CREATE OR REPLACE VIEW members AS\n  SELECT * FROM read_csv(' + sq(DATA_URL + 'country_group_membership.csv') + ", types = {'m49': 'VARCHAR'});\n" : '') +
      '\nSELECT iso3, name, un_status\nFROM countries' + (where.length ? '\nWHERE ' + where.join('\n  AND ') : '') + '\nORDER BY name;  -- ' + result.length + ' rows';

    // Power Query (M)
    var m = ['let', '    Base = ' + q(DATA_URL) + ',',
      '    // RelativePath keeps the source static, so scheduled refresh works in the Power BI service',
      '    Load = (file as text) => Table.PromoteHeaders(Csv.Document(',
      '        Web.Contents(Base, [RelativePath = file]),',
      '        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]), [PromoteAllScalars = true]),',
      '    Countries = Load("countries.csv"),'];
    var conds = [];
    if (state.scope === 'un') conds.push('[is_un_member] = "true"');
    if (state.scope === 'un_obs') conds.push('[un_status] <> "non_member"');
    if (inc.length || ex.length) {
      m.push('    Members = Table.Buffer(Load("country_group_membership.csv")),',
        '    InGroup = (ids as list) => List.Buffer(Table.SelectRows(Members, each List.Contains(ids, [group_id]))[iso3]),');
      if (any) { m.push('    Inc = InGroup({' + inc.map(q).join(', ') + '}),'); conds.push('List.Contains(Inc, [iso3])'); }
      else inc.forEach(function (id, i) { m.push('    Inc' + (i + 1) + ' = InGroup({' + q(id) + '}),  // ' + groupLabel(id)); conds.push('List.Contains(Inc' + (i + 1) + ', [iso3])'); });
      ex.forEach(function (id, i) { m.push('    Ex' + (i + 1) + ' = InGroup({' + q(id) + '}),  // ' + groupLabel(id)); conds.push('not List.Contains(Ex' + (i + 1) + ', [iso3])'); });
    }
    m.push('    Result = ' + (conds.length ? 'Table.SelectRows(Countries, each\n        ' + conds.join('\n        and ') + ')' : 'Countries'), 'in', '    Result');
    var pq = m.join('\n');

    // JavaScript
    var js = ['// Browser or Node 18+: the files are served with CORS enabled',
      'import { csvParse } from "https://cdn.jsdelivr.net/npm/d3-dsv@3.0.1/+esm";', '',
      'const base = ' + q(DATA_URL) + ';',
      'const load = async (file) => csvParse(await (await fetch(base + file)).text());',
      'const countries = await load("countries.csv");'];
    var jc = [];
    if (state.scope === 'un') jc.push('c.is_un_member === "true"');
    if (state.scope === 'un_obs') jc.push('c.un_status !== "non_member"');
    if (inc.length || ex.length) {
      js.push('const members = await load("country_group_membership.csv");',
        'const inGroup = (...ids) => new Set(members.filter((m) => ids.includes(m.group_id)).map((m) => m.iso3));');
      if (any) { js.push('const inc = inGroup(' + inc.map(q).join(', ') + ');'); jc.push('inc.has(c.iso3)'); }
      else inc.forEach(function (id, i) { js.push('const inc' + (i + 1) + ' = inGroup(' + q(id) + ');  // ' + groupLabel(id)); jc.push('inc' + (i + 1) + '.has(c.iso3)'); });
      ex.forEach(function (id, i) { js.push('const ex' + (i + 1) + ' = inGroup(' + q(id) + ');  // ' + groupLabel(id)); jc.push('!ex' + (i + 1) + '.has(c.iso3)'); });
    }
    js.push('', 'const result = countries' + (jc.length ? '.filter((c) =>\n  ' + jc.join(' &&\n  ') + '\n)' : '') + ';', 'console.log(result.length);  // ' + result.length);
    js = js.join('\n');

    // Julia
    var jl = ['using CSV, DataFrames, Downloads', '', 'base = ' + q(DATA_URL),
      'load(file) = CSV.read(Downloads.download(base * file), DataFrame; types = Dict(:m49 => String))',
      'countries = load("countries.csv")'];
    var jlc = [];
    if (state.scope === 'un') jlc.push('r.is_un_member');
    if (state.scope === 'un_obs') jlc.push('r.un_status != "non_member"');
    if (inc.length || ex.length) {
      jl.push('members = load("country_group_membership.csv")', 'in_group(ids...) = Set(members.iso3[in.(members.group_id, Ref(ids))])');
      if (any) { jl.push('inc = in_group(' + inc.map(q).join(', ') + ')'); jlc.push('r.iso3 in inc'); }
      else inc.forEach(function (id, i) { jl.push('inc' + (i + 1) + ' = in_group(' + q(id) + ')  # ' + groupLabel(id)); jlc.push('r.iso3 in inc' + (i + 1)); });
      ex.forEach(function (id, i) { jl.push('ex' + (i + 1) + ' = in_group(' + q(id) + ')  # ' + groupLabel(id)); jlc.push('!(r.iso3 in ex' + (i + 1) + ')'); });
    }
    jl.push('', 'result = ' + (jlc.length ? 'filter(r -> ' + jlc.join(' && ') + ', countries)' : 'countries'), 'nrow(result)  # ' + result.length);
    jl = jl.join('\n');

    var lists = '# ISO3\n' + result.map(function (c) { return c.iso3; }).join(', ') +
      '\n\n# M49\n' + result.map(function (c) { return c.m49; }).join(', ') +
      '\n\n# Names\n' + result.map(function (c) { return c.name; }).join('\n');

    return [['Python', 'python', py], ['R', 'r', r], ['SQL · DuckDB', 'sql', sql], ['Power Query · Power BI, Excel', 'm', pq],
      ['JavaScript', 'js', js], ['Julia', 'julia', jl], ['Plain lists', 'shell', lists]];
  }
  function openCode() {
    var tabs = codeFor();
    var slot = $('#code-slot');
    slot.innerHTML = '<div class="code" data-title="' + result.length + ' rows">' + tabs.map(function (t) {
      return '<pre data-tab="' + esc(t[0]) + '"><code data-lang="' + t[1] + '">' + esc(t[2]) + '</code></pre>';
    }).join('') + '</div>';
    CC.enhanceCode(slot);
    openModal('#code-modal');
    var first = $('#code-modal .code-tabs button');
    if (first) first.focus();
  }

  /* ── Tabs ──────────────────────────────────────────────── */

  function selectTab(name) {
    state.tab = name;
    $$('.tabs [role=tab]').forEach(function (t) {
      var on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $('#panel-' + t.dataset.tab).hidden = !on;
    });
  }

  /* ── Events ────────────────────────────────────────────── */

  function bind() {
    $('#scope').addEventListener('click', function (e) {
      var b = e.target.closest('[data-scope]'); if (!b) return;
      state.scope = b.dataset.scope; render();
    });
    $('#match-wrap').addEventListener('click', function (e) {
      var b = e.target.closest('[data-match]'); if (!b) return;
      state.match = b.dataset.match; render();
    });
    $$('[data-add]').forEach(function (b) { b.addEventListener('click', function () { openPicker(b.dataset.add); }); });
    document.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-remove]'))) {
        var key = t.dataset.remove === 'in' ? 'inc' : 'ex';
        state[key] = state[key].filter(function (id) { return id !== t.dataset.id; });
        render();
      } else if ((t = e.target.closest('[data-preset]'))) {
        var p = PRESETS[+t.dataset.preset];
        state.scope = p.scope; state.inc = p.inc.slice(); state.ex = (p.ex || []).slice(); state.match = p.match || 'all';
        render();
      } else if ((t = e.target.closest('[data-pick]'))) {
        state[pickerMode === 'in' ? 'inc' : 'ex'].push(t.dataset.pick);
        closeModals(); render();
      } else if ((t = e.target.closest('[data-addgroup]'))) {
        if (state.inc.indexOf(t.dataset.addgroup) < 0) state.inc.push(t.dataset.addgroup);
        state.match = 'all';
        selectTab('table'); render();
        CC.toast('Added ' + groupLabel(t.dataset.addgroup));
      } else if ((t = e.target.closest('[data-showgroup]'))) {
        closeDrawer(); showGroup(t.dataset.showgroup);
        window.scrollTo({ top: 0 });
      } else if ((t = e.target.closest('[data-close]'))) {
        closeModals();
      } else if ((t = e.target.closest('tr[data-iso], .compare-col li[data-iso]'))) {
        openCountry(t.dataset.iso);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('.modal.open')) closeModals();
        else if ($('#drawer').classList.contains('open')) closeDrawer();
      }
      if (e.key === 'Enter') {
        var t = e.target.closest && e.target.closest('tr[data-iso], .compare-col li[data-iso]');
        if (t) openCountry(t.dataset.iso);
      }
    });
    $('#scrim').addEventListener('click', function () { closeModals(); if ($('#drawer').classList.contains('open')) closeDrawer(); });
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#reset').addEventListener('click', function () {
      state.scope = 'un'; state.inc = []; state.ex = []; state.match = 'all'; render();
    });
    $('#picker-search').addEventListener('input', renderPicker);
    $('#table-filter').addEventListener('input', function (e) { state.filter = e.target.value; renderTable(); });
    $$('#table th[data-key] button').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.parentNode.dataset.key;
        state.dir = state.sort === k ? -state.dir : 1; state.sort = k; renderTable();
      });
    });
    $('.tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[role=tab]'); if (!t) return;
      selectTab(t.dataset.tab); render();
    });
    $('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = $$('.tabs [role=tab]'), i = tabs.indexOf(document.activeElement);
      var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      next.focus(); selectTab(next.dataset.tab); render();
    });
    $('#dims').addEventListener('click', function (e) {
      var b = e.target.closest('[data-dim]'); if (!b) return;
      state.dim = b.dataset.dim; renderBreakdown(); writeUrl();
    });
    ['a', 'b'].forEach(function (k) {
      $('#cmp-' + k).addEventListener('change', function (e) { state[k] = e.target.value; renderCompare(); writeUrl(); });
    });
    $('#copy-iso').addEventListener('click', function () {
      CC.copyText(result.map(function (c) { return c.iso3; }).join(','), 'Copied ' + result.length + ' ISO3 codes');
    });
    $('#download').addEventListener('click', download);
    $('#share').addEventListener('click', function () { CC.copyText(location.href, 'Link copied'); });
    $('#get-code').addEventListener('click', openCode);
  }

  CC.loadSite().then(function (data) {
    D = data;
    var n = { un: 0, un_obs: 0, all: D.countries.length };
    D.countries.forEach(function (c) { if (SCOPES.un.test(c)) n.un++; if (SCOPES.un_obs.test(c)) n.un_obs++; });
    $$('[data-scope-n]').forEach(function (el) { el.textContent = n[el.dataset.scopeN]; });
    var country = readUrl();
    bind();
    selectTab(state.tab);
    render();
    if (country) openCountry(country.toUpperCase());
    window.CCExplorer = { openCountry: openCountry, showGroup: showGroup };
  }).catch(function (err) {
    $('#result-desc').textContent = 'The data did not load (' + err.message + '). Reload the page, or download the files from the Data page.';
  });
})();
