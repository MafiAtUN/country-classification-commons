/* Home: "same question, different answers" chart. */
(function () {
  'use strict';

  var TOPICS = {
    africa: [
      ['un_m49.region.2', 'UN M49 region'],
      ['un_membership.regional_group.ag', 'UN regional group'],
      ['un_sdg.region.738', 'UN SDG grouping'],
      ['un_m49.sub_region.202', 'UN M49 sub-region'],
      ['world_bank.region.ssf', 'World Bank region']
    ],
    asia: [
      ['un_membership.regional_group.apg', 'UN regional group'],
      ['un_m49.region.142', 'UN M49 region'],
      ['world_bank.region.eas', 'World Bank region'],
      ['world_bank.region.sas', 'World Bank region']
    ],
    ldc: [
      ['oecd_dac.oda_recipient_group.10016', 'OECD DAC ODA recipients'],
      ['un_m49.special_group.ldc', 'UN development group'],
      ['un_sdg.region.927', 'UN SDG grouping']
    ],
    sids: [
      ['un_m49.special_group.sids', 'UN development group'],
      ['un_sdg.region.932', 'UN SDG grouping'],
      ['un_sdg.region.934', 'UN SDG grouping'],
      ['un_sdg.region.931', 'UN SDG grouping']
    ]
  };

  var barsEl = document.getElementById('answer-bars');
  var chips = CC.$$('#topic-chips .chip');
  var tip = document.createElement('div');
  tip.className = 'viz-tip'; tip.setAttribute('aria-hidden', 'true');  // each bar's aria-label carries the same numbers
  document.body.appendChild(tip);

  function render(data, topic) {
    var rows = TOPICS[topic].map(function (t) { return { g: data.byGroup[t[0]], sys: t[1] }; })
      .filter(function (r) { return r.g; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.g.n_members; }));
    barsEl.innerHTML = rows.map(function (r) {
      var g = r.g, un = g.n_un_members, other = g.n_members - un;
      var label = CC.esc(g.group_name) + ': ' + g.n_members + ' countries and areas, of which ' + un + ' are UN Member States';
      return '<a class="bar-row" href="explorer.html?g=' + encodeURIComponent(g.group_id) + '&amp;scope=all" aria-label="' + label + '"' +
        ' data-name="' + CC.esc(g.group_name) + '" data-sys="' + CC.esc(r.sys) + '" data-un="' + un + '" data-other="' + other + '">' +
        '<span class="bar-label">' + CC.esc(g.group_name) + '<small>' + CC.esc(r.sys) + '</small></span>' +
        '<span class="bar-track"><span class="stacked" style="width:' + (g.n_members / max * 100).toFixed(1) + '%">' +
        '<span class="seg un" style="width:' + (un / g.n_members * 100).toFixed(1) + '%"></span>' +
        (other ? '<span class="seg other" style="flex:1"></span>' : '') +
        '</span></span>' +
        '<span class="bar-value">' + g.n_members + (other ? '<small>' + un + ' UN</small>' : '') + '</span></a>';
    }).join('');
    CC.$$('.bar-row', barsEl).forEach(function (row) {
      row.addEventListener('mousemove', function (e) {
        var other = +row.dataset.other;
        tip.innerHTML = '<b>' + CC.esc(row.dataset.name) + '</b> <span class="mono">' + CC.esc(row.dataset.sys) + '</span><br>' +
          row.dataset.un + ' UN Member States' + (other ? '<br>' + other + ' other countries and areas' : '');
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
        tip.classList.add('show');
      });
      row.addEventListener('mouseleave', function () { tip.classList.remove('show'); });
    });
  }

  CC.loadSite().then(function (data) {
    var current = 'africa';
    render(data, current);
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        current = chip.dataset.topic;
        chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
        render(data, current);
      });
    });
    var nonMember = data.countries.filter(function (c) { return c.un_status === 'non_member'; }).length;
    CC.$$('[data-nonmember]').forEach(function (el) { el.textContent = nonMember; });
  }).catch(function () {
    barsEl.innerHTML = '<p class="muted">The chart needs <code>data/site.json</code>, which did not load. The files below still work.</p>';
  });
})();
