const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const urls=[
 ['https://understat.com/league/EPL/2026',{}],
 ['https://understat.com/getLeagueData/EPL/2026',{'X-Requested-With':'XMLHttpRequest',Referer:'https://understat.com/league/EPL/2026'}],
 ['https://understat.com/getLeagueData/EPL/2025',{'X-Requested-With':'XMLHttpRequest',Referer:'https://understat.com/league/EPL/2025'}],
 ['https://understat.com/league/EPL',{}],
 ['https://www.fotmob.com/api/data/leagues?id=47&ccode3=KOR',{Referer:'https://www.fotmob.com/'}],
 ['https://www.fotmob.com/api/leagues?id=47',{Referer:'https://www.fotmob.com/'}],
 ['https://www.fotmob.com/leagues/47/stats/premier-league',{}],
];
(async()=>{for(const [u,h] of urls){try{const r=await fetch(u,{headers:{'User-Agent':UA,...h}});const t=await r.text();
console.log('==',u,r.status,t.length);
console.log(t.slice(0,300).replace(/\s+/g,' '));
const m=[...t.matchAll(/(JSON\.parse\(|getLeagueData|teamsData|datesData|playersData|<script[^>]*src="[^"]*")/g)].map(x=>x[0]).slice(0,15);console.log('hits',m.join(' | '));
const nd=t.match(/fetchAllUrl":"([^"]+)"/g);if(nd)console.log('fetchAll',nd.slice(0,40).join('\n'));
const bn=t.match(/"buildId":"([^"]+)"/);if(bn)console.log('buildId',bn[1]);
}catch(e){console.log('ERR',u,e.message)}}})();
