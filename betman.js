// Betman (프로토 승부식) soccer odds → betman.json, joined to ESPN match ids so the app can fill its Betman boxes by itself.
// Runs on GitHub Actions every 30 minutes (.github/workflows/betman.yml). Plain Node 20, no packages.
// betman.json       : what the app reads — { at, rounds, g: { espnId: { b:[승,무,패], o:[first posted], c:'last change (KST)', r:round, k:kickoff } } }
// betman-state.json : what the robot remembers — learned team pairs (Betman id → ESPN id), which Betman match is which ESPN match, rounds seen

/* the mobile site answers GitHub's servers; the main site only does once it has the mobile site's cookies */
const HOSTS = (process.env.BM_HOSTS || 'https://m.betman.co.kr,https://www.betman.co.kr').split(',');
const ESPN = process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
/* Betman league code → ESPN league (the app's six) */
const LG = { '52': 'eng.1', '67': 'esp.1', '56': 'ger.1', '53': 'ita.1', '54': 'fra.1' };
const lgOf = r => LG[String(r.leagueCode)] || (/챔피언스리그/.test(r.leagueName || '') && !/AFC|아시아|엘리트/.test(r.leagueName || '') ? 'uefa.champions' : null);
const KEEP_DAYS = 70;

/* Korean names the app already uses: they help pair games that kick off at the same time */
const KO_ID = { '359': '아스널', '382': '맨시티', '331': '브라이튼', '363': '첼시', '364': '리버풀', '337': '브렌트퍼드', '368': '에버턴', '349': '본머스', '367': '토트넘', '362': '아스톤 빌라', '306': '헐 시티', '357': '리즈', '361': '뉴캐슬', '373': '입스위치', '370': '풀럼', '388': '코번트리', '360': '맨유', '384': '크리스탈 팰리스', '393': '노팅엄', '366': '선덜랜드', '371': '웨스트햄', '379': '번리' };
const KO_NAME = { 'Wolverhampton Wanderers': '울버햄튼', 'Leicester City': '레스터', 'Southampton': '사우샘프턴', 'Real Madrid': '레알 마드리드', 'Barcelona': '바르셀로나', 'Atlético Madrid': '아틀레티코', 'Atletico Madrid': '아틀레티코', 'Athletic Club': '빌바오', 'Real Sociedad': '레알 소시에다드', 'Villarreal': '비야레알', 'Real Betis': '레알 베티스', 'Sevilla': '세비야', 'Valencia': '발렌시아', 'Girona': '지로나', 'Bayern Munich': '바이에른', 'Borussia Dortmund': '도르트문트', 'Bayer Leverkusen': '레버쿠젠', 'RB Leipzig': '라이프치히', 'Eintracht Frankfurt': '프랑크푸르트', 'VfB Stuttgart': '슈투트가르트', 'SC Freiburg': '프라이부르크', 'VfL Wolfsburg': '볼프스부르크', 'Internazionale': '인테르', 'Inter Milan': '인테르', 'AC Milan': 'AC밀란', 'Juventus': '유벤투스', 'Napoli': '나폴리', 'AS Roma': '로마', 'Lazio': '라치오', 'Atalanta': '아탈란타', 'Fiorentina': '피오렌티나', 'Bologna': '볼로냐', 'Paris Saint-Germain': '파리 생제르맹', 'Marseille': '마르세유', 'AS Monaco': '모나코', 'Monaco': '모나코', 'Lyon': '리옹', 'Lille': '릴', 'Nice': '니스', 'Lens': '랑스', 'Benfica': '벤피카', 'Porto': '포르투', 'Sporting CP': '스포르팅', 'PSV Eindhoven': 'PSV', 'Ajax': '아약스', 'Feyenoord': '페예노르트', 'Celtic': '셀틱', 'Club Brugge': '브뤼헤', 'Galatasaray': '갈라타사라이' };

async function getJSON(url, opts = {}, tries = 2) {
  for (let k = 0; k < tries; k++) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 25000);
      const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(opts.headers || {}) } });
      clearTimeout(tm);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (k === tries - 1) throw e; await new Promise(res => setTimeout(res, 1500)); }
  }
}
const why = e => String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e);
let cookie = '', fails = 0, order = HOSTS.slice();
const sleep = ms => new Promise(res => setTimeout(res, ms));
const hostOf = h => h.replace(/^https?:\/\//, '');
function keepCookies(r) {
  let sc = r.headers && typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  if (!sc.length && r.headers) { const one = r.headers.get('set-cookie'); if (one) sc = one.split(/,(?=\s*[^;,=\s]+=)/); }
  if (!sc.length) return;
  const m = new Map(cookie.split('; ').filter(Boolean).map(c => [c.split('=')[0], c]));
  sc.forEach(c => { const kv = c.split(';')[0]; m.set(kv.split('=')[0], kv); });
  cookie = [...m.values()].join('; ');
}
/* open the mobile home page first, like a phone would, and keep its cookies */
async function warm(log) {
  for (const h of HOSTS) {
    try {
      /* follow redirects by hand so cookies set on the way are kept too */
      let url = h + '/', r, hops = 0;
      for (; hops < 6; hops++) {
        r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Accept: 'text/html,application/xhtml+xml', ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(20000) });
        keepCookies(r);
        const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
        await r.text().catch(() => '');
        if (!loc) break;
        url = new URL(loc, url).href;
      }
      const names = cookie.split('; ').filter(Boolean).map(c => c.split('=')[0]).join(',') || 'none';
      log.push(`warm ${hostOf(h)}: HTTP ${r.status}${hops ? ` after ${hops} redirect(s)` : ''} · cookies ${names}`);
      if (r.ok) return true;
    } catch (e) { log.push(`warm ${hostOf(h)}: ${why(e)}`); }
  }
  return false;
}
/* Betman's JSON calls: mobile site first, then the main site; after three failures in a row the run stops asking */
async function bm(path, body) {
  if (fails >= 3) throw new Error('skipped (Betman not answering this run)');
  const errs = [];
  for (const h of order) {
    try {
      await sleep(400);   /* go easy on Betman */
      const r = await fetch(h + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Origin: h, Referer: h + '/', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
      keepCookies(r);
      const txt = await r.text();
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      let j;
      try { j = JSON.parse(txt); } catch (e) { throw new Error(`not JSON (${(r.headers.get('content-type') || '?').split(';')[0]}, ${txt.length} bytes)`); }
      fails = 0;
      if (h !== order[0]) order = [h, ...order.filter(x => x !== h)];   /* ask the host that answered first next time */
      return j;
    } catch (e) { errs.push(`${hostOf(h).split('.')[0]}: ${why(e)}`); }
  }
  fails++;
  throw new Error(errs.join(' / '));
}

const odd = n => (n > 1 ? +(+n).toFixed(2) : null);
const kst = s => (s && s.length >= 12 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}` : null);
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const amToDec = v => { const n = parseFloat(String(v).replace('+', '')); if (!isFinite(n) || n === 0) return null; return +(n > 0 ? 1 + n / 100 : 1 + 100 / -n).toFixed(2); };

/* one round: its soccer 1X2 games in the app's leagues, with the first posted odds and the last change time */
async function fetchRound(ts) {
  const j = await bm('/buyPsblGame/gameInfoInq.do', { gmId: 'G101', gmTs: ts, gameYear: '', _sbmInfo: { debugMode: 'false' } });
  const cs = j && j.compSchedules;
  if (!cs || !Array.isArray(cs.keys) || !Array.isArray(cs.datas) || !cs.datas.length) return null;
  const K = cs.keys, rows = cs.datas.map(d => Object.fromEntries(K.map((k, i) => [k, d[i]])));
  const hist = {};
  (j.tooltipList || []).forEach(t => { if (t && t.GM_ID === 'G101') (hist[t.GM_SEQ] = hist[t.GM_SEQ] || []).push(t); });
  Object.values(hist).forEach(a => a.sort((x, y) => String(x.CHG_DTM).localeCompare(String(y.CHG_DTM))));
  const cl = j.currentLottery || {};
  const list = rows.filter(r => r.itemCode === 'SC' && String(r.betId) === '1' && lgOf(r)).map(r => {
    const h = hist[r.matchSeq] || [], f = h[0], l = h[h.length - 1];
    const o = f ? [odd(f.BCHG_W_ODDS / 100), odd(f.BCHG_D_ODDS / 100), odd(f.BCHG_L_ODDS / 100)] : null;
    return { ts, seq: r.matchSeq, lg: lgOf(r), k: +r.gameDate, h: String(r.homeName || ''), a: String(r.awayName || ''), hid: String(r.homeId), aid: String(r.awayId), b: [odd(r.winAllot), odd(r.drawAllot), odd(r.loseAllot)], o: o && o.every(Boolean) ? o : null, c: l ? kst(String(l.CHG_DTM)) : null };
  }).filter(x => x.b.every(Boolean) && x.k > 0);
  return { ts, n: +cl.gmOsidTs || ts % 10000, end: +cl.saleEndDate || 0, status: String(cl.saleStatus || ''), list };
}

/* ESPN games of one league on one day */
const espnCache = {};
async function espnDay(lg, d, log) {
  const key = lg + ':' + d;
  if (espnCache[key]) return espnCache[key];
  let evs = [];
  try {
    const j = await getJSON(`${ESPN}${lg}/scoreboard?dates=${d}`);
    evs = (j.events || []).map(e => {
      const c = (e.competitions || [])[0] || {}, cs = c.competitors || [];
      const H = cs.find(x => x.homeAway === 'home') || {}, A = cs.find(x => x.homeAway === 'away') || {};
      const ml = (((c.odds || [])[0] || {}).moneyline) || {}, g = x => x && amToDec((x.close && x.close.odds) || (x.open && x.open.odds));
      const O = [g(ml.home), g(ml.draw), g(ml.away)];
      return { id: String(e.id), k: Date.parse(e.date), hid: String((H.team || {}).id || ''), aid: String((A.team || {}).id || ''), hn: (H.team || {}).displayName || '', an: (A.team || {}).displayName || '', O: O.every(x => x > 1) ? O : null };
    });
  } catch (e) { log.push(`ESPN ${lg} ${d}: ${e.message}`); }
  return (espnCache[key] = evs);
}

/* share of the Korean short name's letters that show up in Betman's (longer) name; null when there's no Korean name */
function sim(ko, name) {
  if (!ko || !/[가-힣]/.test(ko)) return null;
  const a = ko.replace(/[\s.&·-]/g, '').toUpperCase(), b = String(name).replace(/[\s.&·-]/g, '').toUpperCase();
  if (!a) return null;
  let hit = 0;
  for (const ch of a) if (b.includes(ch)) hit++;
  return hit / a.length;
}
const koOf = (id, name) => KO_ID[id] || KO_NAME[name] || '';
function score(st, r, e) {
  let s = 0;
  const th = st.teams[r.hid], ta = st.teams[r.aid];
  if (th) s += th === e.hid ? 50 : -50;
  if (ta) s += ta === e.aid ? 50 : -50;
  const sh = sim(koOf(e.hid, e.hn), r.h), sa = sim(koOf(e.aid, e.an), r.a);
  if (sh != null) s += sh * 10 - 4;
  if (sa != null) s += sa * 10 - 4;
  if (e.O) { const p = r.b.map(v => 1 / v), q = e.O.map(v => 1 / v), d = Math.abs(p[0] - q[0]) + Math.abs(p[2] - q[2]); s += Math.max(-6, 4 - d * 25); }
  return s;
}
function learn(st, r, e) { if (!st.teams[r.hid]) st.teams[r.hid] = e.hid; if (!st.teams[r.aid]) st.teams[r.aid] = e.aid; }

/* pair Betman games with ESPN games: same league, kickoff within 45 minutes; games at the same time are told apart by
   team pairs learned earlier, Korean names and how close the odds are; a slot with one game each side is certain */
async function matchGames(st, all, log) {
  const used = new Set(Object.values(st.mm).filter(Boolean));
  const todo = all.filter(r => !st.mm[r.ts + ':' + r.seq] && (st.tries[r.ts + ':' + r.seq] || 0) < 12);
  const byLg = {};
  todo.forEach(r => (byLg[r.lg] = byLg[r.lg] || []).push(r));
  let made = 0;
  for (const [lg, rs] of Object.entries(byLg)) {
    const days = new Set();
    rs.forEach(r => [-1, 0, 1].forEach(dd => days.add(ymd(r.k + dd * 864e5))));
    let evs = [];
    for (const d of [...days].sort()) evs = evs.concat(await espnDay(lg, d, log));
    const seen = new Set();
    evs = evs.filter(e => e.id && !seen.has(e.id) && seen.add(e.id));
    const slots = {};
    rs.forEach(r => (slots[r.k] = slots[r.k] || []).push(r));
    for (const [k, srs] of Object.entries(slots)) {
      let R = srs.slice(), E = evs.filter(e => Math.abs(e.k - +k) <= 45 * 6e4 && !used.has(e.id));
      const take = (r, e, sure) => { st.mm[r.ts + ':' + r.seq] = e.id; used.add(e.id); if (sure) learn(st, r, e); R = R.filter(x => x !== r); E = E.filter(x => x !== e); made++; };
      if (R.length === 1 && E.length === 1) { if (score(st, R[0], E[0]) > -40) take(R[0], E[0], true); }
      else {
        for (let guard = 0; guard < 20 && R.length && E.length; guard++) {
          const pairs = [];
          R.forEach(r => E.forEach(e => pairs.push([score(st, r, e), r, e])));
          pairs.sort((x, y) => y[0] - x[0]);
          const [s, r, e] = pairs[0];
          const alt = Math.max(...pairs.filter(p => p !== pairs[0] && (p[1] === r || p[2] === e)).map(p => p[0]), -99);
          if (s >= 4 && s - alt >= 2) take(r, e, s >= 8); else break;
        }
        if (R.length === 1 && E.length === 1 && score(st, R[0], E[0]) > -40) take(R[0], E[0], true);
      }
      R.forEach(r => { const key = r.ts + ':' + r.seq; st.tries[key] = (st.tries[key] || 0) + 1; });
    }
  }
  return made;
}

/* the whole job: find rounds, read them, pair with ESPN, keep the last 70 days */
async function collect(st, prevGames, now = Date.now()) {
  st.teams = st.teams || {}; st.mm = st.mm || {}; st.tries = st.tries || {}; st.rounds = st.rounds || {};
  const log = [], games = { ...(prevGames || {}) };
  const want = new Set();
  await warm(log);
  try {
    const j = await bm('/buyPsblGame/inqCacheBuyAbleGameInfoList.do', { _sbmInfo: { debugMode: 'false' } });
    (j.protoGames || []).forEach(g => { if (g && g.gmId === 'G101' && g.gmTs) want.add(+g.gmTs); });
  } catch (e) { log.push('buyable list: ' + e.message); }
  Object.entries(st.rounds).forEach(([ts, r]) => { if (!r.done) want.add(+ts); });
  const known = [...want, ...Object.keys(st.rounds).map(Number)];
  const top = known.length ? Math.max(...known) : 260138;
  if (!Object.keys(st.rounds).length) for (let i = 0; i < 9; i++) want.add(top - i);   /* first run: about three weeks back */
  want.add(top + 1);                                                                     /* the next round, in case the list is behind */
  const rounds = [];
  for (const ts of [...want].sort((a, b) => a - b)) {
    try {
      const rd = await fetchRound(ts);
      if (!rd) continue;
      rounds.push(rd);
      st.rounds[ts] = { n: rd.n, end: rd.end, done: rd.end > 0 && now - rd.end > 36 * 36e5 };
    } catch (e) { log.push(`round ${ts}: ${e.message}`); }
  }
  const all = rounds.flatMap(r => r.list);
  const made = await matchGames(st, all, log);
  /* write the matched games; a game carried over to a later round takes the later round's odds */
  all.sort((x, y) => x.ts - y.ts).forEach(r => {
    const id = st.mm[r.ts + ':' + r.seq];
    if (!id) return;
    const n = (st.rounds[r.ts] || {}).n || r.ts % 10000;
    games[id] = { b: r.b, o: r.o, c: r.c, r: n, k: r.k };
  });
  Object.keys(games).forEach(id => { if (!games[id].k || now - games[id].k > KEEP_DAYS * 864e5) delete games[id]; });
  Object.keys(st.rounds).forEach(ts => { const r = st.rounds[ts]; if (r.end && now - r.end > (KEEP_DAYS + 10) * 864e5) { delete st.rounds[ts]; Object.keys(st.mm).forEach(k => { if (k.startsWith(ts + ':')) { delete st.mm[k]; delete st.tries[k]; } }); } });
  const open = rounds.filter(r => r.end > now).map(r => ({ n: r.n, ts: r.ts, end: r.end }));
  const un = all.filter(r => r.k > now - 864e5 && !st.mm[r.ts + ':' + r.seq]).slice(0, 40).map(r => ({ lg: r.lg, k: r.k, h: r.h, a: r.a }));
  log.push(`rounds ${rounds.map(r => r.n).join(',') || '-'} · games ${all.length} · newly paired ${made} · unpaired ${all.filter(r => !st.mm[r.ts + ':' + r.seq]).length}`);
  return { games, open, un, log };
}

if (typeof module !== 'undefined' && typeof require === 'function' && require.main === module) {
  const fs = require('fs');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const prev = read('betman.json', {}), st = read('betman-state.json', {});
  collect(st, prev.g).then(res => {
    fs.writeFileSync('betman.json', JSON.stringify({ v: 1, at: new Date().toISOString(), open: res.open, g: res.games, un: res.un, log: res.log }));
    fs.writeFileSync('betman-state.json', JSON.stringify(st));
    try { fs.rmSync('betman-log', { recursive: true, force: true }); } catch (e) { }
    console.log(res.log.join('\n'));
  }).catch(e => { console.error(e); process.exit(1); });
}
if (typeof module !== 'undefined') module.exports = { collect, fetchRound, sim };
