const UA='Mozilla/5.0 (compatible; tactical47-metrics/1.0)';
(async()=>{
 const j=await (await fetch('https://www.fotmob.com/api/data/leagues?id=47&ccode3=KOR',{headers:{'User-Agent':UA}})).json();
 console.log('keys',Object.keys(j).join(','));
 const st=j.stats||{};console.log('statkeys',Object.keys(st).join(','));
 for(const k of Object.keys(st)){const a=st[k];if(Array.isArray(a))console.log(k,a.map(c=>(c.name||c.stat)+'|'+(c.header||'')+'|'+(c.fetchAllUrl||'').split('/').pop()).join(' ; '));}
 const s=JSON.stringify(j.table);console.log('table',s.slice(0,600));
 const i=s.indexOf('"xg');console.log('xg idx',i,s.slice(Math.max(0,i-300),i+900));
 const tt=st.teams&&st.teams[0];if(tt&&tt.fetchAllUrl){const x=await (await fetch(tt.fetchAllUrl,{headers:{'User-Agent':UA}})).json();console.log('teamlist',JSON.stringify(x).slice(0,700));}
 const p=await (await fetch('https://data.fotmob.com/stats/47/season/36781/_goals_prevented.json',{headers:{'User-Agent':UA}})).json();console.log('gp',JSON.stringify(p).slice(0,900));
})();
