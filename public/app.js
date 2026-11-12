/* Athens Flow · Ροή — όψη «Ανάλυση ροών» και όψη «Πότε να φύγω» */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nf = new Intl.NumberFormat('el-GR');
  const n = (x, unit = '') => (x === null || x === undefined ? 'χωρίς μέτρηση' : `${nf.format(x)}${unit}`);
  const hm = new Intl.DateTimeFormat('el-GR', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hourOf = (iso) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
  const dayMonth = new Intl.DateTimeFormat('el-GR', { timeZone: 'Europe/Athens', day: 'numeric', month: 'long' });

  const LEVEL = [null, 'ελεύθερη', 'πυκνή', 'αργή', 'μποτιλιάρισμα'];
  const LEVEL_IS = [null, 'κυλάει ελεύθερα', 'είναι πυκνή', 'είναι αργή', 'έχει μποτιλιάρισμα'];
  const DIR = { in: 'Προς Αθήνα', out: 'Από Αθήνα', cross: 'Εγκάρσια' };
  const DIR_LC = { in: 'προς Αθήνα', out: 'από Αθήνα', cross: 'εγκάρσια' };
  const KIND = { main: 'Κύριος δρόμος', ramp_in: 'Ράμπα εισόδου', ramp_out: 'Ράμπα εξόδου', side: 'Παράδρομος', turn: 'Λωρίδα στροφής', bus: 'Λεωφορειολωρίδα' };
  const DAYS = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];
  const DAYS_ACC = ['τη Δευτέρα', 'την Τρίτη', 'την Τετάρτη', 'την Πέμπτη', 'την Παρασκευή', 'το Σάββατο', 'την Κυριακή'];
  const DAYS_S = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;

  const S = {
    data: null, koin: [], view: 'flow', sel: { type: 'overview' }, dir: 'all',
    when: { key: null, dir: 'in', day: null, all: false },
    detail: new Map(), map: null, markers: new Map(), polys: new Map(),
  };

  // ---------- tooltip ----------
  const tipEl = $('#tip');
  function tip(html, ev) {
    if (!html) { tipEl.hidden = true; return; }
    tipEl.innerHTML = html; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX + 14))}px`;
    tipEl.style.top = `${ev.clientY + 18 + r.height > window.innerHeight ? ev.clientY - r.height - 12 : ev.clientY + 18}px`;
  }
  document.addEventListener('mouseover', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) tip(t.dataset.tip, e); });
  document.addEventListener('mousemove', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) tip(t.dataset.tip, e); else if (!e.target.closest?.('.chart')) tip(null); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) tip(null); });

  // ---------- κοινά κομμάτια ----------
  const mainOn = (list) => list.filter((s) => s.kind === 'main' && s.online && s.level);
  function distBar(list, cls = '') {
    const on = mainOn(list);
    if (!on.length) return `<div class="dist-empty ${cls}"></div>`;
    const c = [0, 0, 0, 0, 0];
    on.forEach((s) => c[s.level]++);
    const parts = [1, 2, 3, 4].filter((l) => c[l]).map((l) => `<i class="lv${l}" style="flex:${c[l]}" data-tip="<b>${c[l]} από ${on.length} σταθμούς</b><br>${LEVEL[l]}"></i>`);
    return `<div class="dist ${cls}">${parts.join('')}</div>`;
  }
  const chip = (level) => (level ? `<span class="chip"><i class="sw lv${level}"></i>${LEVEL[level][0].toUpperCase()}${LEVEL[level].slice(1)}</span>` : '<span class="chip"><i class="sw lv0"></i>Χωρίς μέτρηση</span>');
  const stationTip = (s) => `<b>${esc(s.roadLabel || s.id)}</b> ${esc(DIR_LC[s.dir] || '')}<br>${s.online ? `${s.level ? LEVEL[s.level] + ', ' : ''}${n(s.speed, ' km/h')}, ${n(s.flow, ' οχ./ώρα')}` : 'Εκτός λειτουργίας'}`;

  function heat(profile, { today, nowHour, pick } = {}) {
    let h = `<div class="heat${pick ? ' pick' : ''}" role="img" aria-label="Τυπική κίνηση ανά ημέρα και ώρα"><div></div>`;
    for (let i = 0; i < 24; i++) h += `<div class="hd">${i % 3 === 0 ? i : ''}</div>`;
    for (let d = 0; d < 7; d++) {
      h += `<div class="dw${d === today ? ' today' : ''}" data-day="${d}">${DAYS_S[d]}</div>`;
      for (let i = 0; i < 24; i++) {
        const p = profile[d * 24 + i];
        const cls = p.level ? `l${p.level}` : p.speed !== null ? 'some' : '';
        const t = p.speed !== null ? `<b>${DAYS[d]} ${hh(i)}</b><br>${p.level ? LEVEL[p.level] + ', ' : ''}${p.speed} km/h συνήθως` : `<b>${DAYS[d]} ${hh(i)}</b><br>Δεν υπάρχει ακόμη ιστορικό`;
        h += `<div class="c ${cls}${d === today && i === nowHour ? ' now' : ''}" data-day="${d}" data-tip="${esc(t)}"></div>`;
      }
    }
    return h + '</div>';
  }
  const levelLegend = () => `<div class="legendrow">${[1, 2, 3, 4].map((l) => `<span><i class="sw lv${l}"></i>${LEVEL[l]}</span>`).join('')}<span><i class="sw lv0"></i>χωρίς ιστορικό</span></div>`;

  // Γράφημα γραμμών (ταχύτητα στον χρόνο). series: [{ name, cls, points: [{t, speed}] }]
  function lineChart(series, { height = 150 } = {}) {
    const all = series.flatMap((s) => s.points).filter((p) => p.speed !== null);
    if (all.length < 3) return '<p class="note">Η σειρά 24 ωρών γεμίζει όσο μαζεύονται μετρήσεις.</p>';
    const W = 420, H = height, L = 30, R = 44, T = 10, B = 22;
    const t0 = Math.min(...all.map((p) => Date.parse(p.t))), t1 = Math.max(...all.map((p) => Date.parse(p.t)));
    const max = Math.max(40, Math.ceil(Math.max(...all.map((p) => p.speed)) / 20) * 20);
    const x = (t) => L + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - v / max) * (H - T - B);
    let g = '';
    for (let v = 0; v <= max; v += max / 2) g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const first = new Date(t0); first.setMinutes(0, 0, 0);
    for (let t = first.getTime() + 3600000; t <= t1; t += 3600000) {
      const h = hourOf(t);
      if (h % 6 === 0) g += `<text x="${x(new Date(t).toISOString())}" y="${H - 5}" text-anchor="middle">${hh(h)}</text>`;
    }
    const ends = [];
    for (const s of series) {
      const pts = s.points.filter((p) => p.speed !== null);
      if (pts.length < 2) continue;
      g += `<path class="ln ${s.cls}" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.speed).toFixed(1)}`).join('')}"/>`;
      const last = pts[pts.length - 1];
      ends.push({ y: y(last.speed), v: last.speed });
    }
    ends.sort((a, b) => a.y - b.y);
    if (ends.length === 2 && ends[1].y - ends[0].y < 13) { const m = (ends[0].y + ends[1].y) / 2; ends[0].y = m - 6.5; ends[1].y = m + 6.5; }
    ends.forEach((e) => { g += `<text x="${W - R + 6}" y="${e.y + 4}" style="font-weight:600;fill:var(--ink)">${e.v}</text>`; });
    const id = `ch${Math.random().toString(36).slice(2, 8)}`;
    charts.set(id, { series, x0: L, x1: W - R, t0, t1, W });
    return `<svg class="chart" id="${id}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Διάμεση ταχύτητα τις τελευταίες 24 ώρες"><text x="${L - 6}" y="${T - 1}" text-anchor="end"></text>${g}<line class="cross" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-width="1" visibility="hidden"/></svg>`;
  }
  const charts = new Map();
  document.addEventListener('mousemove', (e) => {
    const svg = e.target.closest?.('.chart');
    if (!svg) return;
    const c = charts.get(svg.id); if (!c) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * c.W;
    const t = c.t0 + Math.max(0, Math.min(1, (px - c.x0) / (c.x1 - c.x0))) * (c.t1 - c.t0);
    const near = (pts) => pts.reduce((b, p) => (Math.abs(Date.parse(p.t) - t) < Math.abs(Date.parse(b.t) - t) ? p : b), pts[0]);
    const rows = c.series.filter((s) => s.points.length).map((s) => { const p = near(s.points); return { name: s.name, p }; });
    if (!rows.length) return;
    const cx = c.x0 + ((Date.parse(rows[0].p.t) - c.t0) / Math.max(1, c.t1 - c.t0)) * (c.x1 - c.x0);
    const cross = $('.cross', svg); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    tip(`<b>${hm.format(new Date(rows[0].p.t))}</b><br>${rows.map((x) => `${esc(x.name)} ${n(x.p.speed, ' km/h')}`).join('<br>')}`, e);
  });
  document.addEventListener('mouseout', (e) => { const svg = e.target.closest?.('.chart'); if (svg) { $('.cross', svg)?.setAttribute('visibility', 'hidden'); tip(null); } });

  // ---------- χάρτης ----------
  function initMap() {
    const map = (S.map = L.map('map', { zoomControl: true, minZoom: 10, maxZoom: 18, zoomSnap: 0.5 }).setView([37.985, 23.735], 12.5));
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Δεδομένα: Περιφέρεια Αττικής, data.gov.gr' }).addTo(map);
    map.createPane('koin').style.zIndex = 350;
    for (const k of S.koin) {
      const p = L.polygon(k.r.map((ring) => ring.map(([x, y]) => [y, x])), { pane: 'koin', color: '#1d4f91', weight: 1.6, opacity: 0.75, fillColor: '#1d4f91', fillOpacity: 0.05 }).addTo(map);
      p.on('click', () => go({ type: 'community', id: k.id }));
      S.polys.set(k.id, p);
      L.marker([k.c[1], k.c[0]], { interactive: false, pane: 'koin', icon: L.divIcon({ className: 'klabel', html: `${k.id}η`, iconSize: [30, 16] }) }).addTo(map);
    }
    $('#legend').innerHTML = `<b>Κίνηση τώρα</b>${[1, 2, 3, 4].map((l) => `<div class="row"><i class="sw lv${l}"></i>${LEVEL[l][0].toUpperCase()}${LEVEL[l].slice(1)}</div>`).join('')}<div class="row"><i class="sw" style="background:none;box-shadow:inset 0 0 0 1.5px var(--off);border-radius:50%"></i>Εκτός λειτουργίας</div><div class="row" style="margin-top:2px">Το βέλος δείχνει την πορεία των οχημάτων</div><div class="row"><i class="sw" style="background:none;box-shadow:inset 0 0 0 1.6px var(--sign)"></i>Δημοτικές κοινότητες Αθήνας</div>`;
  }

  function icon(s) {
    const minor = s.kind !== 'main';
    const cls = ['st', s.online ? `l${s.level || 0}` : 'off', minor ? 'minor' : ''];
    const k = (minor ? 0.62 : 0.8) + (s.online && s.flow ? Math.min(1, s.flow / 4500) * 0.55 : 0);
    let inner;
    if (!s.online) inner = '<circle cx="13" cy="13" r="3"/>';
    else if (s.arrow === null) inner = '<path d="M13 8a5 5 0 1 0 0 10a5 5 0 1 0 0-10z"/>';
    // Το βέλος μπαίνει λίγο δεξιά από τον άξονά του, όπως οδηγούμε, για να μην πέφτουν το ένα πάνω στο άλλο τα δύο ρεύματα
    else inner = `<g transform="rotate(${s.arrow} 13 13) translate(4.5 0) scale(${k.toFixed(2)})" style="transform-origin:13px 13px"><path d="M13 3.5L20 20.5L13 16.5L6 20.5Z"/></g>`;
    return L.divIcon({ className: cls.join(' '), html: `<svg width="26" height="26" viewBox="0 0 26 26">${inner}</svg>`, iconSize: [26, 26], iconAnchor: [13, 13] });
  }

  function drawStations() {
    for (const s of S.data.stations) {
      if (s.lat === null) continue;
      let m = S.markers.get(s.id);
      const sig = `${s.online}|${s.level}|${s.arrow}|${Math.round((s.flow || 0) / 500)}`;
      if (!m) {
        m = L.marker([s.lat, s.lon], { icon: icon(s), keyboard: false, zIndexOffset: s.kind === 'main' ? 100 : 0 }).addTo(S.map);
        m.on('click', () => go({ type: 'station', id: s.id }));
        m.bindTooltip('', { className: 'sttip', direction: 'top', offset: [0, -10], opacity: 1 });
        S.markers.set(s.id, m);
      } else if (m._sig !== sig) m.setIcon(icon(s));
      m._sig = sig;
      m.setTooltipContent(stationTip(s));
    }
    dimMarkers();
  }

  // Ποιοι σταθμοί τονίζονται, ανάλογα με το φίλτρο κατεύθυνσης και την επιλογή
  function dimMarkers() {
    const { sel } = S;
    for (const s of S.data.stations) {
      const m = S.markers.get(s.id); if (!m) continue;
      let on = S.dir === 'all' || s.dir === S.dir;
      if (sel.type === 'corridor') on = on && s.road === sel.road;
      if (sel.type === 'community') on = on && s.community === sel.id;
      const e = m.getElement(); if (!e) continue;
      e.classList.toggle('dim', !on);
      e.classList.toggle('sel', sel.type === 'station' && sel.id === s.id);
    }
    for (const [id, p] of S.polys) p.setStyle({ weight: sel.type === 'community' && sel.id === id ? 3 : 1.6, fillOpacity: sel.type === 'community' && sel.id === id ? 0.12 : 0.05 });
  }

  // ---------- πλαίσιο: επισκόπηση ----------
  function lane(name, sub, list, sum) {
    return `<div class="lane"><div class="lane-name">${name}<small>${sub}</small></div>${distBar(list)}<div class="lane-speed num">${sum.speed ?? '–'}<small>km/h</small></div></div>`;
  }
  function overview() {
    const d = S.data, s = d.summary, st = d.stations;
    const main = st.filter((x) => x.kind === 'main');
    const li = s.in.level, lo = s.out.level;
    const lead = li && lo
      ? (li === lo ? `Η κίνηση ${LEVEL_IS[li]} και στα δύο ρεύματα, προς και από την Αθήνα.` : `Προς Αθήνα η κίνηση ${LEVEL_IS[li]}. Από Αθήνα ${LEVEL_IS[lo]}.`)
      : 'Δεν υπάρχουν αρκετές μετρήσεις αυτή τη στιγμή.';
    const typ = [];
    const dayHour = `${DAYS_ACC[Math.floor(d.meta.slot / 24)]} στις ${hh(d.meta.slot % 24)}`;
    for (const k of ['in', 'out']) if (s[k].vsTypical !== null && Math.abs(s[k].vsTypical) >= 5) typ.push(`${typ.length ? DIR_LC[k] : DIR[k]} ${Math.abs(s[k].vsTypical)}% πιο ${s[k].vsTypical < 0 ? 'αργά' : 'γρήγορα'}`);
    const sub = `Μέτρηση ${hm.format(new Date(d.meta.latest))}, από ${nf.format(d.meta.online)} σταθμούς σε λειτουργία.${typ.length ? ` ${typ.join(' και ')} από το συνηθισμένο για ${dayHour}.` : ''}`;
    const cors = [...d.corridors].filter((c) => c.online).sort((a, b) => (b.slowShare ?? -1) - (a.slowShare ?? -1) || (a.speed ?? 999) - (b.speed ?? 999));
    const corRows = cors.map((c) => {
      const list = main.filter((x) => x.road === c.road);
      const ml = (k, sym) => (c.dirs[k] ? `<div class="minilane"><span title="${DIR[k]}">${sym}</span>${distBar(list.filter((x) => x.dir === k), 'thin')}<b class="num">${c.dirs[k].speed ?? '–'}</b></div>` : '');
      return `<button class="rowbtn" data-go="corridor" data-id="${c.key}"><div><span class="plate">${esc(c.label)}</span><div class="rowmeta">${c.online} σταθμοί${c.inAthens ? `, ${c.inAthens} στον Δήμο` : ''}</div></div><div class="minilanes">${ml('in', '→')}${ml('out', '←')}${!c.dirs.in && !c.dirs.out ? ml('cross', '↔') : ''}</div></button>`;
    }).join('');
    const kRows = d.communities.map((k) => `<button class="rowbtn krow" data-go="community" data-id="${k.id}"><span class="kid">${k.id}η</span><div>${k.online ? `${chip(k.level)}<div class="rowmeta">${k.online} σταθμοί${k.slowShare ? `, ${k.slowShare}% με αργή κίνηση` : ''}</div>` : '<span class="rowmeta">Δεν έχει σταθμούς κύριου δρόμου σε λειτουργία</span>'}</div><span class="ksp num">${k.speed ?? '–'}<small>km/h</small></span></button>`).join('');
    return `
      <div class="card">
        <h1 class="lead">${lead}</h1>
        <p class="sub">${sub}</p>
        <div class="road" aria-label="Κατανομή σταθμών ανά βαθμίδα κίνησης">
          ${lane('Προς Αθήνα', `${s.in.online} σταθμοί`, main.filter((x) => x.dir === 'in'), s.in)}
          ${lane('Από Αθήνα', `${s.out.online} σταθμοί`, main.filter((x) => x.dir === 'out'), s.out)}
        </div>
        <div class="kv">
          <div><b class="num">${s.athens.speed ?? '–'} km/h</b><span>μέσα στον Δήμο Αθηναίων</span></div>
          <div><b class="num">${s.approach.speed ?? '–'} km/h</b><span>στις προσβάσεις προς τον Δήμο</span></div>
          <div><b class="num">${s.in.slowShare ?? '–'}%</b><span>των σταθμών προς Αθήνα με αργή κίνηση</span></div>
        </div>
      </div>
      <div class="card">
        <h2 class="h">Τελευταίες 24 ώρες <small>διάμεση ταχύτητα, km/h</small></h2>
        ${lineChart([{ name: 'Προς Αθήνα', cls: 'ln-in', points: s.trend.in }, { name: 'Από Αθήνα', cls: 'ln-out', points: s.trend.out }])}
        <div class="key"><span><i class="k-in"></i>Προς Αθήνα</span><span><i class="k-out"></i>Από Αθήνα</span></div>
      </div>
      <div class="card">
        <h2 class="h">Άξονες <small>→ προς Αθήνα, ← από Αθήνα, km/h</small></h2>
        <div class="rows">${corRows}</div>
      </div>
      <div class="card">
        <h2 class="h">Δημοτικές κοινότητες της Αθήνας <small>κύριοι δρόμοι</small></h2>
        <div class="rows">${kRows}</div>
      </div>`;
  }

  // ---------- πλαίσιο: άξονας ----------
  async function detail(kind, id) {
    const key = `${kind}/${id}`;
    const hit = S.detail.get(key);
    if (hit && hit.at === S.data.meta.updated) return hit.d;
    const res = await fetch(`api/${kind}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Δεν βρέθηκε');
    const d = await res.json();
    S.detail.set(key, { at: S.data.meta.updated, d });
    return d;
  }
  function corridorHtml(c) {
    const byId = new Map(S.data.stations.map((s) => [s.id, s]));
    const today = Math.floor(S.data.meta.slot / 24), nowHour = S.data.meta.slot % 24;
    let dirs = '';
    for (const k of ['in', 'out', 'cross']) {
      const x = c.dirs[k]; if (!x) continue;
      const cells = x.stationIds.map((id) => { const s = byId.get(id); return `<button class="lv${s.online && s.level ? s.level : 0}" data-go="station" data-id="${id}" data-hot="${id}" data-tip="${esc(stationTip(s) + '<br>' + esc(s.desc || ''))}" aria-label="Σταθμός ${id}"></button>`; }).join('');
      const ends = k === 'in' ? ['περιφέρεια', 'κέντρο'] : k === 'out' ? ['κέντρο', 'περιφέρεια'] : ['', ''];
      dirs += `<div class="dirhead"><b>${DIR[k]}</b><span>${x.speed !== null ? `${x.speed} km/h, ${LEVEL[x.level] || 'χωρίς βαθμίδα'}` : 'χωρίς μέτρηση'}${x.vsTypical !== null && Math.abs(x.vsTypical) >= 5 ? `, ${Math.abs(x.vsTypical)}% πιο ${x.vsTypical < 0 ? 'αργά' : 'γρήγορα'} από το συνηθισμένο` : ''}</span></div>
        <div class="strip">${cells}</div><div class="strip-ends"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
    }
    const series = ['in', 'out'].filter((k) => c.dirs[k]).map((k) => ({ name: DIR[k], cls: `ln-${k}`, points: c.dirs[k].trend }));
    const heats = ['in', 'out', 'cross'].filter((k) => c.dirs[k]).slice(0, 2).map((k) => `<div class="dirhead"><b>${DIR[k]}</b><span>τυπική εβδομάδα</span></div>${heat(c.dirs[k].profile, { today, nowHour })}`).join('');
    return `
      <div class="card">
        <button class="back" data-go="overview">‹ Όλοι οι άξονες</button>
        <div style="margin-top:12px"><span class="plate big">${esc(c.label)}</span></div>
        <p class="sub">${c.stations} σταθμοί κύριου δρόμου, ${c.online} σε λειτουργία${c.inAthens ? `, ${c.inAthens} μέσα στον Δήμο Αθηναίων` : ''}. Κάθε κουτάκι είναι ένας σταθμός, στη σειρά που τον συναντάς.</p>
        ${dirs}
        ${c.dirs.in || c.dirs.out ? `<p style="margin-top:16px"><button class="linkbtn" data-when="${c.key}">Πότε να φύγω από αυτόν τον δρόμο</button></p>` : ''}
      </div>
      ${series.length ? `<div class="card"><h2 class="h">Τελευταίες 24 ώρες <small>διάμεση ταχύτητα, km/h</small></h2>${lineChart(series)}<div class="key">${series.map((s) => `<span><i class="k-${s.cls.slice(3)}"></i>${s.name}</span>`).join('')}</div></div>` : ''}
      <div class="card"><h2 class="h">Πότε βαραίνει <small>ώρα Αθήνας</small></h2>${heats}${levelLegend()}${historyNote()}</div>`;
  }
  function historyNote() {
    const h = S.data.meta.history;
    if (!h || !h.since) return '<p class="note">Το ιστορικό δεν έχει αρχίσει ακόμη να μαζεύεται.</p>';
    const days = Math.floor(h.hours / 24);
    return `<p class="note">Ιστορικό από ${dayMonth.format(new Date(h.since))} (${days >= 2 ? `${days} ημέρες` : `${h.hours} ώρες`}, ${nf.format(h.samples)} μετρήσεις).${days < 14 ? ' Ο πίνακας γεμίζει και σταθεροποιείται όσο περνούν οι εβδομάδες.' : ''}</p>`;
  }

  // ---------- πλαίσιο: σταθμός ----------
  function stationHtml(s) {
    const today = Math.floor(S.data.meta.slot / 24), nowHour = S.data.meta.slot % 24;
    const cor = S.data.corridors.find((c) => c.road === s.road);
    const tags = [DIR[s.dir], KIND[s.kind], s.dimos, s.community ? `${s.community}η Δημοτική Κοινότητα` : null, s.lanes ? `${s.lanes} ${s.lanes === 1 ? 'ανιχνευτής' : 'ανιχνευτές'}` : null].filter(Boolean).map(esc).join(', ');
    return `
      <div class="card">
        <button class="back" data-go="${cor ? 'corridor' : 'overview'}" data-id="${cor ? cor.key : ''}">‹ ${cor ? esc(cor.label) : 'Επισκόπηση'}</button>
        <div style="margin-top:12px"><span class="plate big">${esc(s.roadLabel || s.id)}</span></div>
        <p class="sub">${esc(s.desc || '')}</p>
        <p class="sub">${tags}. Σταθμός ${esc(s.id)}.</p>
        <div style="margin-top:14px">${s.online ? chip(s.level) : '<span class="chip"><i class="sw lv0"></i>Εκτός λειτουργίας</span>'}${s.t ? `<span class="rowmeta" style="margin-left:10px">τελευταία μέτρηση ${hm.format(new Date(s.t))}</span>` : ''}</div>
        <div class="kv">
          <div><b class="num">${s.speed ?? '–'}</b><span>km/h τώρα</span></div>
          <div><b class="num">${s.flow !== null ? nf.format(s.flow) : '–'}</b><span>οχήματα ανά ώρα</span></div>
          <div><b class="num">${s.occ ?? '–'}%</b><span>κατάληψη</span></div>
          <div><b class="num">${s.typical ?? '–'}</b><span>km/h συνήθως τέτοια ώρα</span></div>
          <div><b class="num">${s.ff ?? '–'}</b><span>km/h ελεύθερη ροή</span></div>
        </div>
      </div>
      <div class="card"><h2 class="h">Τελευταίες 24 ώρες <small>ταχύτητα, km/h</small></h2>${lineChart([{ name: 'Ταχύτητα', cls: 'ln-in', points: s.trend }])}</div>
      <div class="card"><h2 class="h">Τυπική εβδομάδα <small>ώρα Αθήνας</small></h2>${heat(s.profile, { today, nowHour })}${levelLegend()}${historyNote()}</div>`;
  }

  // ---------- πλαίσιο: κοινότητα ----------
  function communityHtml(id) {
    const d = S.data, k = d.communities.find((x) => x.id === id);
    const list = d.stations.filter((s) => s.community === id && s.kind === 'main');
    const roads = [...new Set(list.map((s) => s.road).filter(Boolean))].map((r) => {
      const m = list.filter((s) => s.road === r);
      const on = mainOn(m);
      const cor = d.corridors.find((c) => c.road === r);
      const sp = on.length ? Math.round(on.map((s) => s.speed).sort((a, b) => a - b)[on.length >> 1]) : null;
      return { r, m, on, cor, sp };
    }).sort((a, b) => b.m.length - a.m.length);
    const rows = roads.map((x) => `<button class="rowbtn" ${x.cor ? `data-go="corridor" data-id="${x.cor.key}"` : `data-go="station" data-id="${x.m[0].id}"`}><div><span class="plate">${esc(x.m[0].roadLabel || x.r)}</span><div class="rowmeta">${x.m.length} ${x.m.length === 1 ? 'σταθμός' : 'σταθμοί'} στην κοινότητα</div></div><div class="minilanes"><div class="minilane"><span></span>${distBar(x.m, 'thin')}<b class="num">${x.sp ?? '–'}</b></div></div></button>`).join('');
    return `
      <div class="card">
        <button class="back" data-go="overview">‹ Επισκόπηση</button>
        <h1 class="lead" style="margin-top:10px">${esc(k.name)}</h1>
        <p class="sub">${k.online ? `Στους κύριους δρόμους της η κίνηση ${LEVEL_IS[k.level] || 'δεν έχει βαθμίδα'}, με διάμεση ταχύτητα ${k.speed} km/h.` : 'Δεν έχει σταθμούς κύριου δρόμου σε λειτουργία αυτή τη στιγμή.'}</p>
        ${k.online ? `<div class="road">${lane('Προς το κέντρο', `${k.in.online} σταθμοί`, list.filter((s) => s.dir === 'in'), k.in)}${lane('Από το κέντρο', `${k.out.online} σταθμοί`, list.filter((s) => s.dir === 'out'), k.out)}</div>` : ''}
        <div class="kv">
          <div><b class="num">${k.stations}</b><span>σταθμοί κύριου δρόμου</span></div>
          <div><b class="num">${k.flow !== null ? nf.format(k.flow) : '–'}</b><span>οχήματα ανά ώρα, διάμεσος</span></div>
          <div><b class="num">${k.slowShare ?? '–'}%</b><span>σταθμών με αργή κίνηση</span></div>
        </div>
      </div>
      ${rows ? `<div class="card"><h2 class="h">Δρόμοι με σταθμούς <small>km/h</small></h2><div class="rows">${rows}</div></div>` : ''}`;
  }

  // ---------- πλοήγηση ----------
  async function renderPanel() {
    const p = $('#panel'), { sel } = S;
    try {
      if (sel.type === 'corridor') p.innerHTML = corridorHtml(await detail('corridors', sel.id));
      else if (sel.type === 'station') p.innerHTML = stationHtml(await detail('stations', sel.id));
      else if (sel.type === 'community') p.innerHTML = communityHtml(sel.id);
      else p.innerHTML = overview();
    } catch (e) { S.sel = { type: 'overview' }; p.innerHTML = overview(); }
  }
  function go(sel, { fit = true } = {}) {
    if (sel.type === 'corridor') { const c = S.data.corridors.find((x) => x.key === sel.id); if (!c) sel = { type: 'overview' }; else sel.road = c.road; }
    S.sel = sel;
    const hash = sel.type === 'corridor' ? `#a/${sel.id}` : sel.type === 'station' ? `#s/${sel.id}` : sel.type === 'community' ? `#k/${sel.id}` : '#roes';
    if (location.hash !== hash) history.replaceState(null, '', hash);
    setView('flow');
    renderPanel().then(() => { $('#panel').scrollTop = 0; });
    dimMarkers();
    if (!fit) return;
    if (sel.type === 'corridor') { const b = S.data.corridors.find((x) => x.key === sel.id).bbox; S.map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [50, 50], maxZoom: 15 }); }
    if (sel.type === 'community') S.map.fitBounds(S.polys.get(sel.id).getBounds(), { padding: [30, 30] });
    if (sel.type === 'station') { const s = S.data.stations.find((x) => x.id === sel.id); if (s?.lat) S.map.setView([s.lat, s.lon], Math.max(S.map.getZoom(), 15)); }
  }
  function setView(v) {
    S.view = v;
    $('#view-flow').hidden = v !== 'flow';
    $('#view-when').hidden = v !== 'when';
    document.querySelectorAll('.views a').forEach((a) => (a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (v === 'flow') setTimeout(() => S.map.invalidateSize(), 0);
  }

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { tip(null); return go(g.dataset.go === 'community' ? { type: 'community', id: Number(g.dataset.id) } : { type: g.dataset.go, id: g.dataset.id }); }
    const w = e.target.closest('[data-when]');
    if (w) { S.when.key = w.dataset.when; openWhen(); window.scrollTo({ top: 0 }); return; }
    const v = e.target.closest('.views a');
    if (v) { e.preventDefault(); if (v.dataset.view === 'when') openWhen(); else go(S.sel.type ? S.sel : { type: 'overview' }, { fit: false }); }
  });
  document.addEventListener('mouseover', (e) => {
    const h = e.target.closest?.('[data-hot]'); if (!h) return;
    S.markers.get(h.dataset.hot)?.getElement()?.classList.add('sel');
    h.addEventListener('mouseleave', () => { if (!(S.sel.type === 'station' && S.sel.id === h.dataset.hot)) S.markers.get(h.dataset.hot)?.getElement()?.classList.remove('sel'); }, { once: true });
  });
  $('#dirfilter').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.dir = b.dataset.v;
    $('#dirfilter').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    dimMarkers();
  });

  // ---------- Πότε να φύγω ----------
  // Από το τυπικό προφίλ μιας ημέρας βρίσκει τις ώρες αιχμής (πρωί, απόγευμα) και προτείνει πότε να ξεκινήσεις.
  function advise(profile, day) {
    const row = profile.slice(day * 24, day * 24 + 24);
    const maxSp = Math.max(...profile.map((p) => p.speed ?? 0));
    const score = row.map((p) => (p.ratio !== null ? p.ratio : p.speed !== null && maxSp ? p.speed / maxSp : null));
    const known = score.slice(6, 22).filter((x) => x !== null).length;
    if (known < 10) return { enough: false, known: score.filter((x) => x !== null).length };
    const peak = (from, to) => {
      let worst = null;
      for (let h = from; h <= to; h++) if (score[h] !== null && (worst === null || score[h] < score[worst])) worst = h;
      if (worst === null || score[worst] >= 0.62) return null;
      let a = worst, b = worst;
      const lim = Math.max(0.66, score[worst] + 0.12);
      while (a > 5 && score[a - 1] !== null && score[a - 1] < lim) a--;
      while (b < 22 && score[b + 1] !== null && score[b + 1] < lim) b++;
      return { from: a, to: b + 1, worst, speed: row[worst].speed };
    };
    return { enough: true, am: peak(6, 11), pm: peak(13, 21), row, score };
  }

  async function openWhen() {
    const d = S.data;
    const options = d.corridors.filter((c) => c.dirs.in || c.dirs.out);
    const W = S.when;
    if (!W.key || !options.some((c) => c.key === W.key)) W.key = options[0]?.key;
    const cor = options.find((c) => c.key === W.key);
    if (cor && !cor.dirs[W.dir]) W.dir = cor.dirs.in ? 'in' : 'out';
    const today = Math.floor(d.meta.slot / 24), nowHour = d.meta.slot % 24;
    if (W.day === null) W.day = today;
    setView('when');
    const hash = `#pote/${W.key}/${W.dir}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    const root = $('#view-when');
    const shown = W.all ? options : options.slice(0, 12);
    if (!shown.some((c) => c.key === W.key) && cor) shown.push(cor);
    const head = `
      <header>
        <h1>Πότε να φύγω για να μην πέσω στην κίνηση;</h1>
        <p class="intro">Διάλεξε τον δρόμο που παίρνεις και προς τα πού πας. Θα δεις πώς είναι τώρα και ποιες ώρες βαραίνει συνήθως, από τις μετρήσεις των σταθμών της Περιφέρειας Αττικής.</p>
      </header>
      <div>
        <div class="q">Ποιον δρόμο παίρνεις;</div>
        <div class="plates" id="w-roads">${shown.map((c) => `<button data-key="${c.key}" aria-pressed="${c.key === W.key}">${esc(c.label)}</button>`).join('')}${options.length > shown.length ? '<button class="more" data-more="1">Περισσότεροι δρόμοι</button>' : ''}</div>
      </div>
      <div class="choices">
        <div><div class="q">Προς τα πού;</div><div class="seg" id="w-dir">${['in', 'out'].map((k) => `<button data-v="${k}" aria-pressed="${k === W.dir}" ${cor?.dirs[k] ? '' : 'disabled style="opacity:.4;cursor:default"'}>${DIR[k]}</button>`).join('')}</div></div>
        <div><div class="q">Ποια ημέρα;</div><div class="seg" id="w-day">${DAYS_S.map((x, i) => `<button data-v="${i}" aria-pressed="${i === W.day}">${i === today ? 'Σήμερα' : x}</button>`).join('')}</div></div>
      </div>`;
    root.innerHTML = `${head}<div class="answer"><p class="skeleton">Φόρτωση…</p></div>`;
    bindWhen(root);
    if (!cor) { $('.answer', root).innerHTML = '<p>Δεν υπάρχουν διαθέσιμοι άξονες αυτή τη στιγμή.</p>'; return; }
    let c;
    try { c = await detail('corridors', W.key); } catch { $('.answer', root).innerHTML = '<p>Τα δεδομένα του άξονα δεν φορτώθηκαν. Δοκίμασε ξανά σε λίγο.</p>'; return; }
    if (S.when.key !== c.key) return;
    const x = c.dirs[W.dir];
    const isToday = W.day === today;
    const slotNow = x.profile[today * 24 + nowHour];
    const nowTxt = x.speed !== null
      ? `Τώρα η κίνηση ${LEVEL_IS[x.level] || 'δεν έχει βαθμίδα'}, με ${x.speed} km/h.`
      : 'Δεν υπάρχει μέτρηση αυτή τη στιγμή.';
    const nowSub = slotNow.speed !== null ? `Τέτοια ώρα ${DAYS_ACC[today]} κινείται συνήθως με ${slotNow.speed} km/h.` : 'Δεν υπάρχει ακόμη ιστορικό για αυτή την ώρα της εβδομάδας.';
    const a = advise(x.profile, W.day);
    const dayName = isToday ? 'Σήμερα' : `${DAYS_ACC[W.day][0].toUpperCase()}${DAYS_ACC[W.day].slice(1)}`;
    let adv;
    if (!a.enough) adv = `<p>Για ${DAYS_ACC[W.day]} υπάρχουν μετρήσεις μόνο για ${a.known} από τις 24 ώρες, οπότε δεν βγαίνει ακόμη σίγουρη συμβουλή. Ο πίνακας γεμίζει μόνος του όσο περνούν οι ημέρες.</p>`;
    else {
      const ps = [];
      const rng = (p) => `από τις <strong>${hh(p.from)}</strong> έως τις <strong>${hh(p.to % 24)}</strong>`;
      if (a.am) ps.push(`<p>${dayName} το πρωί ο δρόμος βαραίνει συνήθως ${rng(a.am)}, με τη χειρότερη ώρα γύρω στις ${hh(a.am.worst)} (${a.am.speed} km/h). Ξεκίνα πριν από τις ${hh(a.am.from)} ή μετά τις ${hh(a.am.to % 24)}.</p>`);
      if (a.pm) ps.push(`<p>${a.am ? 'Το' : `${dayName} το`} απόγευμα βαραίνει ${rng(a.pm)}, με τη χειρότερη ώρα γύρω στις ${hh(a.pm.worst)} (${a.pm.speed} km/h). Ξεκίνα πριν από τις ${hh(a.pm.from)} ή μετά τις ${hh(a.pm.to % 24)}.</p>`);
      if (!ps.length) ps.push(`<p>${dayName} ο δρόμος κυλάει συνήθως χωρίς μεγάλες καθυστερήσεις όλη την ημέρα. Ξεκίνα όποτε σε βολεύει.</p>`);
      if (isToday) {
        const s0 = a.score[nowHour], s1 = a.score[(nowHour + 1) % 24];
        if (s0 !== null && s1 !== null && nowHour < 23) {
          if (s1 - s0 > 0.08) ps.push('<p>Αν μπορείς να περιμένεις, σε μία ώρα συνήθως είναι καλύτερα.</p>');
          else if (s0 - s1 > 0.08) ps.push('<p>Αν είναι να φύγεις, φύγε τώρα. Σε μία ώρα συνήθως είναι χειρότερα.</p>');
        }
      }
      adv = ps.join('');
    }
    const row = x.profile.slice(W.day * 24, W.day * 24 + 24);
    const dayCells = row.map((p, i) => `<div class="c ${p.level ? `l${p.level}` : p.speed !== null ? 'some' : ''}${isToday && i === nowHour ? ' now' : ''}" data-tip="${esc(`<b>${DAYS[W.day]} ${hh(i)}</b><br>${p.speed !== null ? `${p.level ? LEVEL[p.level] + ', ' : ''}${p.speed} km/h συνήθως` : 'Δεν υπάρχει ακόμη ιστορικό'}`)}"></div>`).join('');
    $('.answer', root).innerHTML = `
      <div class="now"><i class="bigsw lv${x.level || 0}"></i><div><p style="margin-bottom:8px"><span class="plate">${esc(c.label)}</span> <span class="rowmeta">${DIR_LC[W.dir]}</span></p><p class="nowtxt">${nowTxt}</p><p class="nowsub">${nowSub}</p></div></div>
      <div class="advice">${adv}</div>
      <div>
        <div class="q">${isToday ? 'Η σημερινή ημέρα' : DAYS[W.day]}, ώρα με την ώρα</div>
        <div class="day">${dayCells}${row.map((_, i) => `<div class="hl">${i}</div>`).join('')}</div>
        ${levelLegend()}
      </div>
      <div>
        <div class="q">Όλη η εβδομάδα</div>
        ${heat(x.profile, { today, nowHour, pick: true })}
      </div>
      <p class="cover">${coverText(x.profile)} Οι σταθμοί μετράνε ταχύτητα σε συγκεκριμένα σημεία του δρόμου, οπότε η εικόνα είναι ένδειξη και όχι χρόνος διαδρομής.</p>
      <p><button class="linkbtn" data-go="corridor" data-id="${c.key}">Δες τον δρόμο στον χάρτη, σταθμό προς σταθμό</button></p>`;
    $('.heat.pick', root).addEventListener('click', (e) => { const t = e.target.closest('[data-day]'); if (t) { W.day = Number(t.dataset.day); openWhen(); } });
  }
  function coverText(profile) {
    const h = S.data.meta.history;
    const filled = profile.filter((p) => p.speed !== null).length;
    if (!h || !h.since) return 'Το ιστορικό δεν έχει αρχίσει ακόμη να μαζεύεται.';
    return `Οι «συνηθισμένες» τιμές βγαίνουν από τις μετρήσεις που μαζεύει η εφαρμογή από ${dayMonth.format(new Date(h.since))}. Μέχρι τώρα καλύπτουν ${filled} από τις 168 ώρες της εβδομάδας για αυτόν τον δρόμο.`;
  }
  function bindWhen(root) {
    $('#w-roads', root).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.more) S.when.all = true; else S.when.key = b.dataset.key;
      openWhen();
    });
    $('#w-dir', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.disabled) { S.when.dir = b.dataset.v; openWhen(); } });
    $('#w-day', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.when.day = Number(b.dataset.v); openWhen(); } });
  }

  // ---------- φόρτωση ----------
  function status() {
    const m = S.data.meta, st = $('#status');
    const age = m.latest ? Math.round((Date.now() - Date.parse(m.latest)) / 60000) : null;
    const stale = m.lastError || age === null || age > 20;
    st.classList.toggle('err', Boolean(stale) && !m.mock);
    st.innerHTML = `<span class="dot"></span>${m.latest ? `Τελευταία μέτρηση ${hm.format(new Date(m.latest))}` : 'Χωρίς μετρήσεις'}${stale && !m.mock ? ', η πηγή καθυστερεί' : ''}${m.mock ? ' (δοκιμαστικά δεδομένα)' : ''}`;
    $('#envbar').hidden = m.env === 'production';
  }
  async function load(first) {
    try {
      const res = await fetch('api/live');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Σφάλμα');
      S.data = await res.json();
      status();
      drawStations();
      if (first) route(); else if (S.view === 'flow') renderPanel(); else if (!document.activeElement?.closest?.('#view-when')) openWhen();
    } catch (e) {
      const st = $('#status'); st.classList.add('err');
      st.innerHTML = `<span class="dot"></span>${esc(e.message || 'Τα δεδομένα δεν είναι διαθέσιμα')}`;
      if (first) $('#panel').innerHTML = '<div class="card"><h1 class="lead">Τα ανοιχτά δεδομένα δεν απαντούν αυτή τη στιγμή.</h1><p class="sub">Η σελίδα θα ξαναδοκιμάσει μόνη της σε ένα λεπτό.</p></div>';
    }
  }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)).split('/');
    if (h[0] === 'pote') { if (h[1]) S.when.key = h[1]; if (h[2] === 'in' || h[2] === 'out') S.when.dir = h[2]; return openWhen(); }
    if (h[0] === 'a' && h[1]) return go({ type: 'corridor', id: h[1] });
    if (h[0] === 's' && h[1] && S.data.stations.some((s) => s.id === h[1])) return go({ type: 'station', id: h[1] });
    if (h[0] === 'k' && Number(h[1]) >= 1 && Number(h[1]) <= 7) return go({ type: 'community', id: Number(h[1]) });
    go({ type: 'overview' }, { fit: false });
  }
  window.addEventListener('hashchange', () => S.data && route());

  (async () => {
    $('#panel').innerHTML = '<p class="skeleton">Φόρτωση μετρήσεων…</p>';
    S.koin = await fetch('data/koinotites.json').then((r) => r.json()).catch(() => []);
    initMap();
    await load(true);
    setInterval(() => { if (!document.hidden) load(false); }, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.data && Date.now() - Date.parse(S.data.meta.updated) > 90000) load(false); });
  })();
})();
