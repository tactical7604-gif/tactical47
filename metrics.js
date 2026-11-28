// EPL team + player metrics → data/metrics.json, read by the app's '지표' tab (and copied into the 투자실 app by the Tue/Fri task).
// Runs on GitHub Actions every 6 hours (.github/workflows/metrics.yml). Plain Node 20, no packages.
// Sources: Understat (xG, xGA, npxG, xPTS, PPDA, deep, players' xA / xGChain / xGBuildup) and, when it answers, FotMob's
// public stat lists (xGOT, goals prevented, ...). A source that fails is reported in `missing`, never filled with guesses.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const fs = require('fs');
const OUT = 'data/metrics.json';

const KO = {
  'Arsenal': '아스널', 'Manchester City': '맨시티', 'Brighton': '브라이튼', 'Chelsea': '첼시', 'Liverpool': '리버풀', 'Brentford': '브렌트퍼드',
  'Everton': '에버턴', 'Bournemouth': '본머스', 'Tottenham': '토트넘', 'Aston Villa': '아스톤 빌라', 'Hull': '헐 시티', 'Hull City': '헐 시티',
  'Leeds': '리즈', 'Newcastle United': '뉴캐슬', 'Ipswich': '입스위치', 'Fulham': '풀럼', 'Coventry': '코번트리', 'Coventry City': '코번트리',
  'Manchester United': '맨유', 'Crystal Palace': '크리스탈 팰리스', 'Nottingham Forest': '노팅엄', 'Sunderland': '선덜랜드', 'West Ham': '웨스트햄',
  'Burnley': '번리', 'Wolverhampton Wanderers': '울버햄튼', 'Leicester': '레스터', 'Southampton': '사우샘프턴',
  /* FotMob spellings */
  'Brighton & Hove Albion': '브라이튼', 'AFC Bournemouth': '본머스', 'Tottenham Hotspur': '토트넘', 'Leeds United': '리즈', 'Ipswich Town': '입스위치',
  'Newcastle': '뉴캐슬', 'Man City': '맨시티', 'Man United': '맨유', 'Man Utd': '맨유', 'Manchester Utd': '맨유', 'Nott\'m Forest': '노팅엄',
  'West Ham United': '웨스트햄', 'Wolves': '울버햄튼', 'Leicester City': '레스터'
};
const ko = n => KO[n] || n;
const r2 = x => Math.round(x * 100) / 100;
const why = e => String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e);

async function get(url, headers = {}, type = 'json', tries = 2) {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9', ...headers }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return type === 'json' ? await r.json() : await r.text();
    } catch (e) { if (k === tries - 1) throw e; await new Promise(res => setTimeout(res, 2000)); }
  }
}

/* ---------- Understat ---------- */
function seasonYear(d = new Date()) { return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }   /* 2026-27 → 2026 */
async function understat(season) {
  const ref = `https://understat.com/league/EPL/${season}`;
  try {
    const j = await get(`https://understat.com/getLeagueData/EPL/${season}`, { 'X-Requested-With': 'XMLHttpRequest', Referer: ref, Accept: 'application/json, text/javascript, */*; q=0.01' });
    if (j && j.teams) return { teams: j.teams, players: j.players || [], how: 'api' };
    throw new Error('no teams in answer');
  } catch (e) {
    /* older layout: the page itself carries JSON.parse('...') blobs */
    const html = await get(ref, {}, 'text');
    const blob = name => { const m = html.match(new RegExp(name + "\\s*=\\s*JSON\\.parse\\('([^']+)'\\)")); return m ? JSON.parse(m[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))) : null; };
    const teams = blob('teamsData'), players = blob('playersData');
    if (!teams) throw new Error('api: ' + why(e) + ' · page: no teamsData');
    return { teams, players: players || [], how: 'page' };
  }
}
function teamRows(teams) {
  return Object.values(teams).map(t => {
    const h = (t.history || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const s = k => h.reduce((a, m) => a + (+m[k] || 0), 0);
    const ppAtt = h.reduce((a, m) => a + (+(m.ppda && m.ppda.att) || 0), 0), ppDef = h.reduce((a, m) => a + (+(m.ppda && m.ppda.def) || 0), 0);
    const oaAtt = h.reduce((a, m) => a + (+(m.ppda_allowed && m.ppda_allowed.att) || 0), 0), oaDef = h.reduce((a, m) => a + (+(m.ppda_allowed && m.ppda_allowed.def) || 0), 0);
    const n = h.length, g = s('scored'), ga = s('missed'), xg = s('xG'), xga = s('xGA'), pts = s('pts'), xpts = s('xpts');
    const last = h.slice(-5);
    return {
      name: t.title, ko: ko(t.title), mp: n,
      w: s('wins'), d: s('draws'), l: s('loses'), pts, g, ga,
      xg: r2(xg), xga: r2(xga), xgd: r2(xg - xga), npxg: r2(s('npxG')), npxga: r2(s('npxGA')),
      xpts: r2(xpts), ppda: ppDef ? r2(ppAtt / ppDef) : null, oppda: oaDef ? r2(oaAtt / oaDef) : null,
      deep: s('deep'), deepA: s('deep_allowed'),
      luckG: r2(g - xg), luckGA: r2(xga - ga), luckPts: r2(pts - xpts),
      form: last.map(m => ({ d: String(m.date).slice(0, 10), ha: m.h_a, r: m.result, g: +m.scored, ga: +m.missed, xg: r2(+m.xG), xga: r2(+m.xGA) }))
    };
  }).filter(t => t.mp > 0).sort((a, b) => b.pts - a.pts || (b.g - b.ga) - (a.g - a.ga) || b.g - a.g);
}
function playerRows(players) {
  const P = players.map(p => ({ name: p.player_name, team: String(p.team_title || '').split(',').pop().trim(), pos: p.position, mp: +p.games, min: +p.time,
    g: +p.goals, a: +p.assists, xg: r2(+p.xG), xa: r2(+p.xA), npxg: r2(+p.npxG), chain: r2(+p.xGChain), build: r2(+p.xGBuildup), kp: +p.key_passes, sh: +p.shots }))
    .map(p => ({ ...p, teamKo: ko(p.team) }));
  const top = (k, n = 15) => P.slice().sort((a, b) => b[k] - a[k]).slice(0, n);
  const byTeam = {};
  for (const p of P) {
    const t = byTeam[p.team] || (byTeam[p.team] = {});
    for (const k of ['xa', 'chain', 'build', 'npxg']) if (!t[k] || p[k] > t[k].v) t[k] = { name: p.name, v: p[k] };
  }
  return { xa: top('xa'), chain: top('chain'), build: top('build'), npxg: top('npxg'), byTeam };
}

/* ---------- FotMob (optional) ---------- */
const FM_WANT = /expected_goals_on_target|xgot|goals_prevented|clean_sheet|expected_goals_conceded|big_chance/i;
async function fotmob() {
  const lg = await get('https://www.fotmob.com/api/leagues?id=47&ccode3=KOR', { Referer: 'https://www.fotmob.com/' });
  const st = lg && lg.stats;
  if (!st) throw new Error('no stats block');
  const lists = [];
  for (const [kind, arr] of [['team', st.teams || []], ['player', st.players || []]]) {
    for (const c of arr) {
      const name = c.name || c.stat || '', url = c.fetchAllUrl;
      if (!FM_WANT.test(name) || !url) continue;
      try {
        const j = await get(url, { Referer: 'https://www.fotmob.com/' });
        const rows = ((((j || {}).TopLists || [])[0] || {}).StatList || []).slice(0, kind === 'team' ? 30 : 15)
          .map(r => ({ name: r.ParticipantName || r.TeamName, team: r.TeamName, teamKo: ko(r.TeamName), v: r2(+r.StatValue), sub: r.SubStatValue != null ? r2(+r.SubStatValue) : null }));
        if (rows.length) lists.push({ kind, key: name, title: c.header || name, rows });
      } catch (e) { /* one list failing is fine */ }
    }
  }
  if (!lists.length) throw new Error('stat lists empty');
  return lists;
}

(async () => {
  const season = +(process.env.SEASON || seasonYear());
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const out = { at: new Date().toISOString(), season: `${season}-${String(season + 1).slice(2)}`, src: [], missing: [] };
  try {
    const u = await understat(season);
    out.teams = teamRows(u.teams);
    out.players = playerRows(u.players);
    out.src.push({ name: 'Understat', url: `https://understat.com/league/EPL/${season}`, how: u.how });
    console.log('understat ok:', out.teams.length, 'teams,', u.players.length, 'players');
  } catch (e) {
    console.log('understat failed:', why(e));
    out.missing.push('understat: ' + why(e));
    if (prev && prev.teams) { out.teams = prev.teams; out.players = prev.players; out.stale = prev.at; }
  }
  try {
    out.fotmob = await fotmob();
    out.src.push({ name: 'FotMob', url: 'https://www.fotmob.com/leagues/47/stats/premier-league' });
    console.log('fotmob ok:', out.fotmob.map(l => l.kind + ':' + l.key).join(', '));
  } catch (e) {
    console.log('fotmob failed:', why(e));
    out.missing.push('fotmob: ' + why(e));
    if (prev && prev.fotmob) out.fotmob = prev.fotmob;
  }
  if (!out.teams) { console.log('nothing to write'); process.exit(prev ? 0 : 1); }
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
})();
