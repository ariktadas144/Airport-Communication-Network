/* Airport network simulator: topology, routing (OSPF-style SPF), HSRP, ACLs, UI. */
const ZONES = { CHK:'Check-in', SEC:'Security', IMM:'Immigration', ATC:'ATC', ADM:'Admin', AIR:'Airlines', WIFI:'Guest Wi-Fi', SRV:'Servers', INET:'Internet' };
const EXT = { CHK:1001, SEC:2001, ATC:3001, ADM:4001, AIR:5001 };
const HA = ['ATC', 'SEC'];                       // zones behind the HSRP pair
const STAFF = ['CHK','SEC','IMM','ATC','ADM','AIR'];

// id: [x, y, label]
const NODES = {
  CORE:[390,170,'Core L3'], R1:[240,270,'R1 (HSRP)'], R2:[540,270,'R2 (HSRP)'], TA:[130,170,'Terminal A'], TB:[650,170,'Terminal B'],
  CHK:[50,70], IMM:[50,280], AIR:[730,70], WIFI:[730,280], ADM:[240,70], SRV:[390,60], INET:[540,70], ATC:[310,410], SEC:[470,410]
};
for (const k in ZONES) NODES[k][2] = ZONES[k];

// [a, b, ospfCost]
const LINKS = [
  ['CORE','R1',10],['CORE','R2',10],['R1','R2',5],['CORE','TA',10],['CORE','TB',10],['TA','R1',20],['TB','R2',20],
  ['CORE','SRV',1],['CORE','ADM',1],['SRV','INET',1],['TA','CHK',1],['TA','IMM',1],['TB','AIR',1],['TB','WIFI',1],
  ['R1','ATC',1],['R2','ATC',1],['R1','SEC',1],['R2','SEC',1]
];

const $ = id => document.getElementById(id);
const linkId = l => l[0] + '-' + l[1];
const down = new Set(), dead = new Set(), acl = {};
const isUp = n => !dead.has(n);
const aclKey = (s, d) => s + '>' + d;

/* ---------- policy ---------- */
function defaultPolicy(s, d) {
  if (s === 'WIFI') return d === 'INET';
  if (d === 'INET' || d === 'SRV' || s === 'ADM') return true;
  if (d === 'ATC') return false;                 // only Admin reaches ATC
  return ['CHK>IMM','CHK>AIR','SEC>IMM','IMM>CHK','AIR>CHK','IMM>SEC'].includes(aclKey(s, d));
}
['WIFI', ...STAFF].forEach(s => Object.keys(ZONES).forEach(d => { acl[aclKey(s, d)] = defaultPolicy(s, d); }));

/* ---------- routing ---------- */
function neighbours(n) {
  return LINKS.filter(l => !down.has(linkId(l)) && isUp(l[0]) && isUp(l[1]) && (l[0] === n || l[1] === n))
              .map(l => [l[0] === n ? l[1] : l[0], l[2]]);
}
function shortestPath(a, b) {                     // Dijkstra, as OSPF's SPF would compute
  if (!isUp(a) || !isUp(b)) return null;
  const dist = { [a]: 0 }, prev = {}, done = new Set();
  for (;;) {
    let u = null;
    for (const k in dist) if (!done.has(k) && (u === null || dist[k] < dist[u])) u = k;
    if (u === null) return null;
    if (u === b) break;
    done.add(u);
    for (const [v, c] of neighbours(u)) if (dist[v] === undefined || dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; }
  }
  const path = [b];
  while (path[0] !== a) path.unshift(prev[path[0]]);
  return { path, cost: dist[b] };
}
const activeGateway = () => isUp('R1') ? 'R1' : isUp('R2') ? 'R2' : null;

function route(s, d) {
  const ha = HA.includes(d) ? d : HA.includes(s) ? s : null;
  if (!ha) return shortestPath(s, d);
  const other = ha === d ? s : d;
  const order = [activeGateway(), 'R1', 'R2'].filter((g, i, a) => g && a.indexOf(g) === i);
  for (const gw of order) {
    if (down.has(gw + '-' + ha) || !isUp(gw)) continue;
    const q = shortestPath(other, gw);
    if (!q) continue;
    const path = ha === d ? [...q.path, ha] : [ha, ...q.path.slice().reverse()];
    return { path, cost: q.cost + 1, gw };
  }
  return null;
}

/* ---------- drawing ---------- */
function draw(hot = []) {
  const hotLinks = new Set();
  hot.forEach((n, i) => { if (i) { hotLinks.add(hot[i-1] + '-' + n); hotLinks.add(n + '-' + hot[i-1]); } });
  let h = '<rect class="area" x="190" y="20" width="400" height="440"/><text class="alab" x="202" y="40">Area 0 backbone</text>' +
          '<rect class="area" x="10" y="20" width="160" height="320"/><text class="alab" x="22" y="40">Area 1</text>' +
          '<rect class="area" x="610" y="20" width="160" height="320"/><text class="alab" x="622" y="40">Area 2</text>';
  for (const l of LINKS) {
    const [a, b] = [NODES[l[0]], NODES[l[1]]], id = linkId(l), off = down.has(id);
    h += `<g class="lk" data-link="${id}" tabindex="0" role="button" aria-label="Link ${id}, ${off ? 'down' : 'up'}, cost ${l[2]}">
      <line class="link ${off ? 'off' : ''} ${hotLinks.has(id) ? 'hot' : ''}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>
      <line class="hit" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/></g>`;
  }
  for (const k in NODES) {
    const [x, y, label] = NODES[k], rt = k === 'R1' || k === 'R2', w = Math.max(72, label.length * 8 + 16);
    h += `<g class="nd ${rt ? 'rt' : ''} ${dead.has(k) ? 'dead' : ''} ${hot.includes(k) ? 'hot' : ''}" ${rt ? `data-router="${k}" tabindex="0" role="button" aria-label="${label}, ${dead.has(k) ? 'off' : 'on'}"` : ''}>
      <rect x="${x - w/2}" y="${y - 16}" width="${w}" height="32"/><text x="${x}" y="${y + 5}">${label}</text></g>`;
  }
  $('map').innerHTML = h;
}
function stats() {
  const g = activeGateway();
  $('stats').innerHTML =
    `<div><dt>HSRP active</dt><dd class="${g ? '' : 'warn'}">${g || 'None'}</dd></div>` +
    `<div><dt>Links down</dt><dd class="${down.size ? 'warn' : ''}">${down.size}</dd></div>` +
    `<div><dt>Routers off</dt><dd class="${dead.size ? 'warn' : ''}">${dead.size}</dd></div>`;
}
function aclTable() {
  const cols = Object.keys(ZONES);
  let h = '<table><thead><tr><th></th>' + cols.map(d => `<th scope="col">${d}</th>`).join('') + '</tr></thead><tbody>';
  for (const s of ['WIFI', ...STAFF]) {
    h += `<tr><th scope="row">${s}</th>` + cols.map(d => {
      if (s === d) return '<td class="self"></td>';
      const ok = acl[aclKey(s, d)];
      return `<td class="cell ${ok ? 'p' : 'd'}" data-acl="${aclKey(s, d)}" tabindex="0" role="button" aria-label="${s} to ${d}: ${ok ? 'permit' : 'deny'}">${ok ? 'P' : 'D'}</td>`;
    }).join('') + '</tr>';
  }
  $('acl').innerHTML = h + '</tbody></table>';
}

/* ---------- log, test, security ---------- */
function log(msg) {
  const el = $('log');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
}
function show(ok, html, hot) { const r = $('res'); r.className = 'result' + (ok ? '' : ' no'); r.innerHTML = html; draw(hot || []); }

function runTest() {
  const s = $('src').value, d = $('dst').value, voice = $('mode').value === 'voice';
  if (s === d) return show(false, '<b>Same zone</b><br>Pick two different zones.');
  if (voice) {
    if (!EXT[s] || !EXT[d]) return show(false, '<b>No phone</b><br>Only Check-in, Security, ATC, Admin and Airlines have IP phones.');
  } else if (!acl[aclKey(s, d)]) {
    log(`%SEC-6-IPACCESSLOGP: list ${s}-IN denied icmp ${s} -> ${d}`);
    return show(false, `<b>Denied by ACL</b><br>The ${ZONES[s]} gateway blocks traffic to ${ZONES[d]}.`);
  }
  const r = route(s, d);
  if (!r) return show(false, '<b>Unreachable</b><br>No path exists with the current failures.');
  const ms = r.cost * 2 + 3, p = `<span class="path">${r.path.join(' > ')}</span>`;
  show(true, voice
    ? `<b>Call connected</b><br>Ext ${EXT[s]} to ext ${EXT[d]} over the voice VLAN, CME.<br>${p}<br>Cost ${r.cost}, delay about ${ms} ms`
    : `<b>Permitted</b><br>Reply from ${ZONES[d]}, ${r.path.length - 1} hops, about ${ms} ms.<br>${p}${r.gw ? `<br>Gateway: HSRP active ${r.gw}` : ''}<br>Cost ${r.cost}`, r.path);
}
function security(kind) {
  const msgs = {
    ps:   '%PM-4-ERR_DISABLE: psecure-violation on Fa0/1 (Check-in), port err-disabled\n%PORT_SECURITY-2-PSECURE_VIOLATION: MAC aa:bb:cc:00:99:01 not in secure list, limit 1',
    dhcp: '%DHCP_SNOOPING-5-UNTRUSTED_PORT: DHCPOFFER on untrusted port Fa0/7 (Security VLAN), dropped',
    arp:  '%SW_DAI-4-DHCP_SNOOPING_DENY: invalid ARP on Fa0/9 (ATC VLAN), sender 10.30.0.1 not in binding table',
    reset:'errdisable recovery: ports re-enabled, violation counters cleared'
  };
  log(msgs[kind]); log('Syslog sent to 10.0.0.50');
}

/* ---------- events ---------- */
function toggleLink(id) {
  down.has(id) ? down.delete(id) : down.add(id);
  log(`%OSPF-5-ADJCHG: link ${id} ${down.has(id) ? 'DOWN, SPF rerun' : 'UP, adjacency FULL'}`);
  draw(); stats();
}
function toggleRouter(n) {
  const before = activeGateway();
  dead.has(n) ? dead.delete(n) : dead.add(n);
  log(`%OSPF-5-ADJCHG: ${n} ${dead.has(n) ? 'DOWN' : 'UP'}`);
  const now = activeGateway();
  if (before !== now) log(now ? `%STANDBY-6-STATECHANGE: ATC and Security gateway now active on ${now}` : '%STANDBY-4-NOACTIVE: no HSRP gateway available');
  draw(); stats();
}
const activate = t => {
  const l = t.closest('[data-link]'), r = t.closest('[data-router]'), c = t.closest('[data-acl]');
  if (l) toggleLink(l.dataset.link);
  else if (r) toggleRouter(r.dataset.router);
  else if (c) { acl[c.dataset.acl] = !acl[c.dataset.acl]; aclTable(); document.querySelector(`[data-acl="${c.dataset.acl}"]`).focus(); }
};
document.addEventListener('click', e => { activate(e.target); const b = e.target.closest('[data-sec]'); if (b) security(b.dataset.sec); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-link],[data-router],[data-acl]')) { e.preventDefault(); activate(e.target); }
});
$('run').addEventListener('click', runTest);

/* ---------- init ---------- */
const opts = Object.keys(ZONES).map(k => `<option value="${k}">${ZONES[k]}</option>`).join('');
$('src').innerHTML = opts; $('dst').innerHTML = opts; $('src').value = 'ADM'; $('dst').value = 'ATC';
$('ext').innerHTML = Object.keys(EXT).map(k => `<dt>${ZONES[k]}</dt><dd>${EXT[k]}</dd>`).join('');
draw(); aclTable(); stats();
log('Ready. OSPF adjacencies FULL, HSRP active on R1.');
