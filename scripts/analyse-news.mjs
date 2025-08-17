import { readFile, writeFile } from "node:fs/promises";

const PLACES = [
  "Bolton","Wigan","Manchester","Salford","Bury","Rochdale","Oldham","Tameside","Stockport","Trafford",
  "Liverpool","Sefton","Wirral","Knowsley","St Helens","Halton",
  "Leeds","Bradford","Kirklees","Calderdale","Wakefield",
  "Birmingham","Solihull","Sandwell","Walsall","Dudley","Wolverhampton",
  "Bristol","Bath","Somerset","Gloucestershire",
  "Sheffield","Rotherham","Barnsley","Doncaster",
  "Newcastle","Gateshead","Sunderland","North Tyneside","South Tyneside",
  "London","Westminster","Camden","Islington","Hackney","Tower Hamlets","Newham","Barking","Dagenham",
  "Croydon","Lambeth","Southwark","Lewisham","Greenwich","Haringey","Enfield","Ealing","Hounslow",
  "Edinburgh","Glasgow","Aberdeen","Dundee",
  "Cardiff","Swansea","Newport","Wrexham","Flintshire",
  "Belfast","Derry","Lisburn","Newry"
];

const STOP = new Set(["the","a","an","and","or","of","to","for","in","on","at","by","from","with","about","after","over",
  "into","uk","britain","british","england","scotland","wales","northern","ireland","today","new","plan","plans","says",
  "amid","as","vs","pm","mp","mps","council","councils"
]);

const tokens = s => String(s||"").toLowerCase().replace(/https?:\/\/\S+/g," ").replace(/[^a-z0-9\s\-]/g," ").split(/\s+/).filter(Boolean);
const isContent = w => w.length>2 && !STOP.has(w) && !/^\d+$/.test(w);

function phrases(title, summary){
  const t = tokens(`${title} ${summary}`).filter(isContent);
  const uni = new Map(); for (const w of t) uni.set(w,(uni.get(w)||0)+1);
  const bi = new Map(); for (let i=0;i<t.length-1;i++){ const k=`${t[i]} ${t[i+1]}`; bi.set(k,(bi.get(k)||0)+1); }
  return {uni,bi};
}
const findPlaces = s => PLACES.filter(p => new RegExp(`\\b${p}\\b`, "i").test(s));
const topN = (m,n=8) => Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([text,count])=>({text,count}));

async function main(){
  const raw = JSON.parse(await readFile("public/data/news.json","utf8"));
  const items = raw.items || [];
  const buckets = new Map(); // place -> { items, uni, bi }

  for (const it of items){
    const text = `${it.title} ${it.summary}`;
    const places = findPlaces(text);
    if (!places.length) continue;
    const { uni, bi } = phrases(it.title, it.summary);

    for (const place of places){
      if (!buckets.has(place)) buckets.set(place, { items:[], uni:new Map(), bi:new Map() });
      const b = buckets.get(place);
      b.items.push(it);
      for (const [k,v] of uni) b.uni.set(k,(b.uni.get(k)||0)+v);
      for (const [k,v] of bi) b.bi.set(k,(b.bi.get(k)||0)+v);
    }
  }

  const areas = Array.from(buckets.entries()).map(([place,b])=>{
    const issues = topN(b.bi, 10).map(x=>x.text);
    const singles = topN(b.uni, 10).map(x=>x.text).filter(w=>!issues.some(i=>i.includes(w)));
    const examples = b.items.slice(0,8).map(it=>({ title: it.title, link: it.link, source: it.source, pubDate: it.pubDate }));
    return { place, sampleCount: b.items.length, issues, keywords: singles, examples };
  }).sort((a,b)=>b.sampleCount-a.sampleCount);

  await writeFile("public/data/mood.json", JSON.stringify({ updatedAt: new Date().toISOString(), areas }, null, 2));
  console.log(`Wrote mood.json for ${areas.length} places`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
