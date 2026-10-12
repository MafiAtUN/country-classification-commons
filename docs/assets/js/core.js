/* Country Classification Commons — shared behaviour for every page.
   Theme, mobile nav, ⌘K search, copy buttons, code tabs, toast, and the site data loader. */
(function () {
  'use strict';

  var PAGES_DATA = 'https://mafiatun.github.io/country-classification-commons/data/';
  var RAW_DATA = 'https://raw.githubusercontent.com/MafiAtUN/country-classification-commons/main/data/latest/';
  var root = document.documentElement;
  var here = document.currentScript && document.currentScript.src;
  var base = here ? here.replace(/assets\/js\/core\.js.*$/, '') : './';

  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  }

  /* ── Data ─────────────────────────────────────────────── */

  var sitePromise = null;
  function loadSite() {
    if (sitePromise) return sitePromise;
    sitePromise = fetch(base + 'data/site.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('site.json ' + r.status); return r.json(); })
      .then(function (d) {
        var byIso = {}, byGroup = {}, groupsOf = {};
        d.countries.forEach(function (c) { byIso[c.iso3] = c; groupsOf[c.iso3] = []; });
        d.groups.forEach(function (g) {
          byGroup[g.group_id] = g;
          g.set = new Set(g.members);
          g.members.forEach(function (iso) { if (groupsOf[iso]) groupsOf[iso].push(g); });
        });
        d.byIso = byIso; d.byGroup = byGroup; d.groupsOf = groupsOf;
        d.systems = [];
        d.groups.forEach(function (g) { if (d.systems.indexOf(g.system) < 0) d.systems.push(g.system); });
        return d;
      });
    return sitePromise;
  }
  var manifestPromise = null;
  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(base + 'data/run_manifest.json', { cache: 'no-cache' }).then(function (r) { return r.json(); });
    }
    return manifestPromise;
  }

  /* ── Theme ────────────────────────────────────────────── */

  function effectiveTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  $$('.theme-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store('cc-theme', next);
      document.dispatchEvent(new CustomEvent('cc:theme', { detail: next }));
    });
  });

  /* ── Mobile nav ───────────────────────────────────────── */

  var menuBtn = $('.menu-toggle'), nav = $('.site-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  /* ── Toast ────────────────────────────────────────────── */

  var toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  function copyText(text, label) {
    var done = function () { toast(label || 'Copied to clipboard'); };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    }
    fallbackCopy(text); done();
    return Promise.resolve();
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ }
    document.body.removeChild(ta);
  }

  /* ── Code blocks: copy buttons, tabs, light highlighting ── */

  /* Comments and strings only: enough to make code scannable without a highlighter library. */
  var COMMENT = { python: '#', r: '#', julia: '#', shell: '#', sql: '--', m: '//', js: '//', dax: '//', qlik: '//', stata: '//' };
  function highlight(code, lang) {
    var cm = COMMENT[lang] || '';
    var singleQuoted = lang !== 'm' && lang !== 'dax';
    return code.split('\n').map(function (line) {
      var out = '', inStr = null;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inStr) {
          out += esc(ch);
          if (ch === inStr) { out += '</span>'; inStr = null; }
          continue;
        }
        var prev = i === 0 ? ' ' : line[i - 1];
        if (cm && line.substr(i, cm.length) === cm && (cm === '#' || /\s/.test(prev))) {
          out += '<span class="tok-c">' + esc(line.slice(i)) + '</span>';
          break;
        }
        if (ch === '"' || (ch === "'" && singleQuoted)) { inStr = ch; out += '<span class="tok-s">' + esc(ch); continue; }
        out += esc(ch);
      }
      if (inStr) out += '</span>';
      return out;
    }).join('\n');
  }

  function enhanceCode(scope) {
    $$('.code', scope).forEach(function (block) {
      if (block.dataset.ready) return;
      block.dataset.ready = '1';
      var tabs = $$('pre[data-tab]', block);
      if (tabs.length > 1) {
        var bar = document.createElement('div');
        bar.className = 'code-tabs'; bar.setAttribute('role', 'tablist');
        tabs.forEach(function (pre, i) {
          var b = document.createElement('button');
          b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = pre.dataset.tab;
          b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
          if (i > 0) pre.hidden = true;
          b.addEventListener('click', function () {
            $$('[role=tab]', bar).forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
            b.setAttribute('aria-selected', 'true');
            tabs.forEach(function (p) { p.hidden = p !== pre; });
          });
          bar.appendChild(b);
        });
        block.insertBefore(bar, block.firstChild);
      }
      $$('pre', block).forEach(function (pre) {
        pre.tabIndex = 0;  // scrollable, so it must be reachable by keyboard
        pre.setAttribute('aria-label', (pre.dataset.tab || block.dataset.title || 'Code') + ' code');
      });
      $$('pre code', block).forEach(function (c) {
        if (c.dataset.raw) return;
        c.dataset.raw = '1';
        var lang = c.getAttribute('data-lang') || '';
        c.innerHTML = highlight(c.textContent.replace(/^\n/, '').replace(/\s+$/, ''), lang);
      });
      var head = $('.code-head', block);
      if (!head) {
        head = document.createElement('div'); head.className = 'code-head';
        head.innerHTML = '<span>' + esc(block.dataset.title || '') + '</span>';
        var tabsBar = $('.code-tabs', block);
        block.insertBefore(head, tabsBar ? tabsBar.nextSibling : block.firstChild);
      }
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'copy-btn'; btn.textContent = 'Copy';
      btn.addEventListener('click', function () {
        var pre = $$('pre', block).filter(function (p) { return !p.hidden; })[0];
        copyText(pre.textContent, 'Code copied').then(function () {
          btn.textContent = 'Copied'; btn.classList.add('done');
          setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
        });
      });
      head.appendChild(btn);
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-copy]');
    if (!t) return;
    e.preventDefault();
    copyText(t.getAttribute('data-copy'), t.getAttribute('data-copy-label') || 'Copied to clipboard');
  });

  /* ── Freshness stamps ─────────────────────────────────── */

  function stampFreshness() {
    var els = $$('[data-fresh]');
    if (!els.length) return;
    loadManifest().then(function (m) {
      var d = new Date(m.generated_at_utc);
      var txt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) +
        ', ' + d.toISOString().slice(11, 16) + ' UTC';
      els.forEach(function (el) {
        var kind = el.getAttribute('data-fresh');
        if (kind === 'count') el.textContent = fmt(m.record_counts[el.getAttribute('data-key')]);
        else el.textContent = txt;
      });
    }).catch(function () { /* stamps keep their static fallback text */ });
  }

  /* ── ⌘K search palette ────────────────────────────────── */

  var palette, pInput, pList, pItems = [], pIndex = 0, lastFocus;
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  function buildPalette() {
    palette = document.createElement('div');
    palette.className = 'palette';
    palette.setAttribute('role', 'dialog'); palette.setAttribute('aria-modal', 'true'); palette.setAttribute('aria-label', 'Search countries and groups');
    palette.innerHTML =
      '<div class="palette-box">' +
      '<div class="palette-input-row">' + ICON_SEARCH +
      '<input type="text" role="combobox" aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list" placeholder="Search 248 countries and 120 groups — try “Africa”, “KEN”, “SIDS”" autocomplete="off" spellcheck="false">' +
      '<span class="kbd">esc</span></div>' +
      '<ul class="palette-results" id="palette-results" role="listbox"></ul>' +
      '<div class="palette-foot"><span>↑↓ move</span><span>↵ open</span><span>name · ISO3 · ISO2 · M49</span></div>' +
      '</div>';
    document.body.appendChild(palette);
    pInput = $('input', palette); pList = $('.palette-results', palette);
    palette.addEventListener('click', function (e) { if (e.target === palette) closePalette(); });
    pInput.addEventListener('input', renderPalette);
    pInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (pItems[pIndex]) go(pItems[pIndex]); }
      else if (e.key === 'Escape') { closePalette(); }
      else if (e.key === 'Tab') { e.preventDefault(); }
    });
  }
  function move(d) {
    if (!pItems.length) return;
    pIndex = (pIndex + d + pItems.length) % pItems.length;
    paintSel();
  }
  function paintSel() {
    $$('.palette-item', pList).forEach(function (el, i) {
      el.setAttribute('aria-selected', i === pIndex ? 'true' : 'false');
      if (i === pIndex) { el.scrollIntoView({ block: 'nearest' }); pInput.setAttribute('aria-activedescendant', el.id); }
    });
  }
  function go(item) {
    var url = base + 'explorer.html?' + (item.type === 'country' ? 'country=' + item.id : 'g=' + encodeURIComponent(item.id) + '&scope=all');
    if (/explorer\.html/.test(location.pathname) && window.CCExplorer) {
      closePalette();
      if (item.type === 'country') window.CCExplorer.openCountry(item.id);
      else window.CCExplorer.showGroup(item.id);
      return;
    }
    location.href = url;
  }
  function renderPalette() {
    loadSite().then(function (d) {
      var q = fold(pInput.value.trim());
      var countries = [], groups = [];
      if (!q) {
        ['un_membership.membership.member', 'un_membership.regional_group.ag', 'un_m49.region.2', 'un_m49.special_group.ldc', 'un_m49.special_group.sids', 'world_bank.income_level.lic', 'oecd.membership.oecd']
          .forEach(function (id) { if (d.byGroup[id]) groups.push(d.byGroup[id]); });
      } else {
        d.countries.forEach(function (c) {
          var score = 0;
          var codes = [c.iso3, c.iso2, c.m49].map(fold);
          if (codes.indexOf(q) >= 0) score = 100;
          else if (fold(c.name).indexOf(q) === 0) score = 80;
          else if (fold(c.name).indexOf(q) > 0) score = 50;
          else if ((fold(c.name_fr) + ' ' + fold(c.name_es)).indexOf(q) >= 0) score = 30;
          if (score) countries.push({ c: c, s: score });
        });
        countries.sort(function (a, b) { return b.s - a.s || a.c.name.localeCompare(b.c.name); });
        countries = countries.slice(0, 8).map(function (x) { return x.c; });
        d.groups.forEach(function (g) {
          var hay = fold(g.group_name + ' ' + g.system + ' ' + g.group_code);
          if (hay.indexOf(q) >= 0) groups.push(g);
        });
        groups.sort(function (a, b) {
          var as = fold(a.group_name).indexOf(q) === 0 ? 0 : 1, bs = fold(b.group_name).indexOf(q) === 0 ? 0 : 1;
          return as - bs || b.n_members - a.n_members;
        });
        groups = groups.slice(0, 8);
      }
      pItems = []; var html = '';
      if (countries.length) {
        html += '<li class="palette-group-label" role="presentation">Countries and areas</li>';
        countries.forEach(function (c) {
          var i = pItems.length; pItems.push({ type: 'country', id: c.iso3 });
          html += '<li class="palette-item" role="option" id="pi-' + i + '" data-i="' + i + '"><span class="pi-code">' + esc(c.iso3) + '</span>' +
            '<span class="pi-main"><span class="pi-title">' + esc(c.name) + '</span><span class="pi-sub">' +
            esc([c.un_status === 'member_state' ? 'UN Member State' : c.un_status === 'observer_state' ? 'UN observer State' : 'Not a UN Member State', c.sub_region].filter(Boolean).join(' · ')) +
            '</span></span></li>';
        });
      }
      if (groups.length) {
        html += '<li class="palette-group-label" role="presentation">' + (q ? 'Groups' : 'Popular groups') + '</li>';
        groups.forEach(function (g) {
          var i = pItems.length; pItems.push({ type: 'group', id: g.group_id });
          html += '<li class="palette-item" role="option" id="pi-' + i + '" data-i="' + i + '"><span class="pi-main"><span class="pi-title">' + esc(g.group_name) +
            '</span><span class="pi-sub">' + esc(g.system) + '</span></span><span class="pi-count">' + g.n_members + '</span></li>';
        });
      }
      if (!pItems.length) html = '<li class="palette-empty">Nothing matches “' + esc(pInput.value) + '”. Try an ISO code or part of a name.</li>';
      pList.innerHTML = html;
      pIndex = 0; paintSel();
      $$('.palette-item', pList).forEach(function (el) {
        el.addEventListener('click', function () { go(pItems[+el.dataset.i]); });
        el.addEventListener('mousemove', function () { if (pIndex !== +el.dataset.i) { pIndex = +el.dataset.i; paintSel(); } });
      });
    }).catch(function () {
      pList.innerHTML = '<li class="palette-empty">Search needs the site data, which did not load. Check your connection and reload.</li>';
    });
  }
  function openPalette() {
    if (!palette) buildPalette();
    lastFocus = document.activeElement;
    palette.classList.add('open');
    pInput.value = '';
    renderPalette();
    setTimeout(function () { pInput.focus(); }, 0);
  }
  function closePalette() {
    if (!palette) return;
    palette.classList.remove('open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('.search-trigger').forEach(function (b) { b.addEventListener('click', openPalette); });
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openPalette(); }
  });

  /* ── Boot ─────────────────────────────────────────────── */

  enhanceCode(document);
  stampFreshness();

  window.CC = {
    $: $, $$: $$, esc: esc, fold: fold, fmt: fmt, store: store,
    loadSite: loadSite, loadManifest: loadManifest,
    toast: toast, copyText: copyText, enhanceCode: enhanceCode, highlight: highlight,
    effectiveTheme: effectiveTheme,
    PAGES_DATA: PAGES_DATA, RAW_DATA: RAW_DATA, base: base
  };
})();
