// Step 1 (probe): can GitHub's servers reach Betman, and what do its pages return?
// Writes what it sees into betman-log/ so it can be read from the repo. Runs from .github/workflows/betman.yml.
const fs = require('fs');
fs.mkdirSync('betman-log', { recursive: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const out = [];
let cookie = '';
async function hit(name, url, opts = {}) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
    const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) };
    const r = await fetch(url, { ...opts, headers, signal: ctl.signal, redirect: 'follow' });
    clearTimeout(tm);
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = [...new Set([...cookie.split('; ').filter(Boolean), ...sc.map(c => c.split(';')[0])])].join('; ');
    const body = await r.text();
    fs.writeFileSync(`betman-log/${name}.txt`, body.slice(0, 400000));
    out.push({ name, url, status: r.status, finalUrl: r.url, ms: Date.now() - t0, len: body.length, type: r.headers.get('content-type'), cookies: sc.length });
    return body;
  } catch (e) {
    out.push({ name, url, error: String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e), ms: Date.now() - t0 });
    return null;
  }
}
(async () => {
  const main = await hit('main', 'https://www.betman.co.kr/');
  await hit('mobile', 'https://m.betman.co.kr/');
  await hit('robots', 'https://www.betman.co.kr/robots.txt');
  const ts = main ? [...new Set([...main.matchAll(/gmTs=(\d{5,7})/g)].map(m => m[1]))].slice(0, 6) : [];
  const ajax = { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://www.betman.co.kr', Referer: 'https://www.betman.co.kr/' };
  await hit('buyable', 'https://www.betman.co.kr/buyPsblGame/inqCacheBuyAbleGameInfoList.do', { method: 'POST', headers: ajax, body: JSON.stringify({ _sbmInfo: { debugMode: 'false' } }) });
  for (const t of ts.slice(0, 3)) {
    await hit('game-' + t, 'https://www.betman.co.kr/buyPsblGame/gameInfoInq.do', { method: 'POST', headers: ajax, body: JSON.stringify({ gmId: 'G101', gmTs: t, gameYear: '', _sbmInfo: { debugMode: 'false' } }) });
    await hit('slip-' + t, `https://www.betman.co.kr/main/mainPage/gamebuy/gameSlip.do?gmId=G101&gmTs=${t}`);
  }
  fs.writeFileSync('betman-log/summary.json', JSON.stringify({ at: new Date().toISOString(), ts, out }, null, 1));
  if (!fs.existsSync('betman.json')) fs.writeFileSync('betman.json', JSON.stringify({ at: null, games: [] }));
  console.log(JSON.stringify(out, null, 1));
})();
