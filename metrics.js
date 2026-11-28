// EPL team + player metrics → data/metrics.json, read by the app's '지표' tab (and copied into the 투자실 app by the Tue/Fri task).
// Runs on GitHub Actions every 6 hours (.github/workflows/metrics.yml). Plain Node 20, no packages.
// Source: FotMob's public league data (xG table + stat lists). Nothing is guessed: a list that fails is reported in `missing`
// and the last good copy is kept. (Understat refuses automated clients, so PPDA / xG Chain / xG Buildup are not collected.)

const fs = require('fs');
const OUT = 'data/metrics.json';
const UA = 'Mozilla/5.0 (compatible; tactical47-metrics/1.0; +https://github.com/tactical7604-gif/tactical47)';
const LEAGUE = 47;   /* Premier League */

const KO = {
  'Arsenal': '아스널', 'Manchester City': '맨시티', 'Brighton & Hove Albion': '브라이튼', 'Brighton and Hove Albion': '브라이튼', 'Chelsea': '첼시',
  'Liverpool': '리버풀', 'Brentford': '브렌트퍼드', 'Everton': '에버턴', 'AFC Bournemouth': '본머스', 'Bournemouth': '본머스',
  'Tottenham Hotspur': '토트넘', 'Aston Villa': '아스톤 빌라', 'Hull City': '헐 시티', 'Leeds United': '리즈', 'Newcastle United': '뉴캐슬',
  'Ipswich Town': '입스위치', 'Fulham': '풀럼', 'Coventry City': '코번트리', 'Manchester United': '맨유', 'Crystal Palace': '크리스탈 팰리스',
  'Nottingham Forest': '노팅엄', 'Sunderland': '선덜랜드', 'West Ham United': '웨스트햄', 'Burnley': '번리', 'Wolverhampton Wanderers': '울버햄튼',
  'Leicester City': '레스터', 'Southampton': '사우샘프턴'
};
const ko = n => KO[n] || n;
const r2 = x => (x == null || !Number.isFinite(+x)) ? null : Math.round(+x * 100) / 100;
const why = e => String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e);

async function get(url, tries = 2) {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (k === tries - 1) throw e; await new Promise(res => setTimeout(res, 2000)); }
  }
}
/* find the first array stored under `key` anywhere inside obj */
function findArr(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (Array.isArray(obj[key]) && obj[key].length && typeof obj[key][0] === 'object') return obj[key];
  for (const v of Object.values(obj)) { const hit = findArr(v, key, depth + 1); if (hit) return hit; }
  return null;
}
const statList = j => ((((j || {}).TopLists || [])[0] || {}).StatList || []);

/* team lists we keep (FotMob name → our key) */
const TEAM_LISTS = {
  expected_goals_team: 'xg', expected_goals_conceded_team: 'xga', big_chance_team: 'bigCh', big_chance_missed_team: 'bigMiss',
  touches_in_opp_box_team: 'boxTouch', poss_won_att_3rd_team: 'won3rd', possession_percentage_team: 'poss',
  ontarget_scoring_att_team: 'sot', penalty_won_team: 'pkWon', goals_team_match: 'gpm', goals_conceded_team_match: 'gapm'
};
/* player lists (top 15 kept) */
const PLAYER_LISTS = {
  expected_goals: 'xg', expected_assists: 'xa', expected_goalsontarget: 'xgot', _goals_prevented: 'gp',
  big_chance_created: 'bigCr', lbp_total: 'lbp', won_contest: 'drib', total_att_assist: 'chances'
};

(async () => {
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const out = { at: new Date().toISOString(), src: [{ name: 'FotMob', url: `https://www.fotmob.com/leagues/${LEAGUE}/stats/premier-league` }], missing: [] };
  let lg;
  try { lg = await get(`https://www.fotmob.com/api/data/leagues?id=${LEAGUE}&ccode3=KOR`); }
  catch (e) { console.log('league failed:', why(e)); if (prev) { console.log('keeping last copy'); process.exit(0); } process.exit(1); }
  out.season = (lg.allAvailableSeasons || [])[0] || '';

  /* 1) xG table: xG, xGA, xPTS, and how far real goals / points are from them */
  const xt = findArr(lg.table, 'xg') || [];
  const all = findArr(lg.table, 'all') || [];
  const rank = new Map(all.map((t, i) => [t.id, t.idx || i + 1]));
  const teams = new Map();
  for (const t of xt) {
    const [g, ga] = String(t.scoresStr || '').split('-').map(Number);
    teams.set(t.id || t.teamId, {
      id: t.id || t.teamId, name: t.name || t.teamName, ko: ko(t.name || t.teamName), rank: rank.get(t.id) || t.position || null,
      mp: t.played, w: t.wins, d: t.draws, l: t.losses, pts: t.pts, g: Number.isFinite(g) ? g : null, ga: Number.isFinite(ga) ? ga : null,
      xg: r2(t.xg), xga: r2(t.xgConceded), xgd: r2(t.xg - t.xgConceded), xpts: r2(t.xPoints), xrank: t.xPosition || null,
      luckG: r2(t.xgDiff != null ? t.xgDiff : g - t.xg),             /* goals − xG   (+ = 결정력/운) */
      luckGA: r2(t.xgConcededDiff != null ? -t.xgConcededDiff : t.xgConceded - ga),   /* xGA − conceded (+ = 덜 먹음) */
      luckPts: r2(t.xPointsDiff != null ? t.xPointsDiff : t.pts - t.xPoints)          /* pts − xPTS   (+ = 운이 좋았음) */
    });
  }
  if (!teams.size) out.missing.push('xG 순위표');

  /* 2) team stat lists */
  const st = lg.stats || {};
  for (const c of st.teams || []) {
    const key = TEAM_LISTS[c.name]; if (!key || !c.fetchAllUrl) continue;
    try {
      for (const r of statList(await get(c.fetchAllUrl))) {
        const t = teams.get(r.TeamId); if (!t) continue;
        if (key === 'xg' || key === 'xga') { t[key + 'L'] = r2(r.StatValue); continue; }   /* cross-check only */
        t[key] = r2(r.StatValue);
      }
    } catch (e) { out.missing.push(c.name + ': ' + why(e)); }
  }
  for (const t of teams.values()) {
    /* npxG ≈ xG − 0.79 × penalties awarded (FotMob's penalty xG). Marked as an estimate in the app. */
    if (t.xg != null && t.pkWon != null) t.npxg = r2(t.xg - 0.79 * t.pkWon);
  }

  /* 3) player stat lists */
  out.players = {};
  const gpTeam = new Map();
  for (const c of st.players || []) {
    const key = PLAYER_LISTS[c.name]; if (!key || !c.fetchAllUrl) continue;
    try {
      const rows = statList(await get(c.fetchAllUrl));
      if (key === 'gp') for (const r of rows) gpTeam.set(r.TeamId, r2((gpTeam.get(r.TeamId) || 0) + (+r.StatValue || 0)));
      out.players[key] = rows.slice(0, 15).map(r => ({ name: r.ParticipantName, team: r.TeamName, teamKo: ko(r.TeamName), v: r2(r.StatValue), sub: r.SubStatValue ? r2(r.SubStatValue) : null, mp: r.MatchesPlayed || null }));
    } catch (e) { out.missing.push(c.name + ': ' + why(e)); }
  }
  for (const [id, v] of gpTeam) { const t = teams.get(id); if (t) t.gp = v; }   /* team goals prevented = sum over its keepers */

  out.teams = [...teams.values()].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  if (!out.teams.length && prev && prev.teams) { out.teams = prev.teams; out.stale = prev.at; }
  if (!out.teams.length) { console.log('no teams'); process.exit(1); }
  console.log('teams', out.teams.length, '· players', Object.keys(out.players).join(','), '· missing', out.missing.length);
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
})();
