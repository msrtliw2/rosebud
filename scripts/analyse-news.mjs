import { readFile, writeFile } from "node:fs/promises";

/**
 * Why this version shows more places:
 * - Still finds places in title/summary (your original method)
 * - ALSO maps domain/source → place (local papers rarely repeat the place in the headline)
 * - Keeps ALL areas (no hard cap)
 */

// Add more as you add feeds (easy wins listed)
const DOMAIN_TO_PLACE = {
  "theboltonnews.co.uk": "Bolton",
  "wigantoday.net": "Wigan",
  "manchestereveningnews.co.uk": "Manchester",
  "liverpoolecho.co.uk": "Liverpool",
  "yorkshirepost.co.uk": "Yorkshire",
  "edinburghnews.scotsman.com": "Edinburgh",
  "glasgowtimes.co.uk": "Glasgow",
  "birminghammail.co.uk": "Birmingham",
  "bristolpost.co.uk": "Bristol",
  "leeds-live.co.uk": "Leeds",
  "lancs.live": "Lancashire",
  "nottinghampost.com": "Nottingham",
  "leicestermercury.co.uk": "Leicester",
  "cambridge-news.co.uk": "Cambridge",
  "oxfordmail.co.uk": "Oxford",
  "kentonline.co.uk": "Kent",
  "somersetlive.co.uk": "Somerset",
  "devonlive.com": "Devon",
  "cornwalllive.com": "Cornwall",
  "northamptonchron.co.uk": "Northampton",
  "edinburghlive.co.uk": "Edinburgh",
  "birminghammail.co.uk": "Birmingham",
  "eveningnews24.co.uk": "Norwich",
  "derbytelegraph.co.uk": "Derby",
  "stokesentinel.co.uk": "Stoke-on-Trent",
  "coventrytelegraph.net": "Coventry",
  "belfasttelegraph.co.uk": "Belfast",
  "walesonline.co.uk": "Wales",
  "pressandjournal.co.uk": "Aberdeen",
};

const SOURCE_TO_PLACE = {
  "The Bolton News": "Bolton",
  "Wigan Today": "Wigan",
  "Manchester Evening News": "Manchester",
  "Liverpool Echo": "Liverpool",
  "Yorkshire Post": "Yorkshire",
  "Edinburgh Evening News": "Edinburgh",
  "Glasgow Times": "Glasgow",
  "Birmingham Mail": "Birmingham",
  "Bristol Post": "Bristol",
  "Leeds Live": "Leeds",
  "Lancs Live": "Lancashire",
  "Nottingham Post": "Nottingham",
  "Leicester Mercury": "Leicester",
  "Cambridge News": "Cambridge",
  "Oxford Mail": "Oxford",
  "Somerset Live": "Somerset",
  "Devon Live": "Devon",
  "Cornwall Live": "Cornwall",
  "Northampton Chronicle": "Northampton",
  "Edinburgh Live": "Edinburgh",
  "Coventry Telegraph": "Coventry",
  "WalesOnline": "Wales",
  "Press and Journal": "Aberdeen",
};

const PLACES = [
  "Bolton","Wigan","Manchester","Salford","Bury","Rochdale","Oldham","Tameside","Stockport","Trafford",
  "Liverpool","Sefton","Wirral","Knowsley","St Helens","Halton",
  "Leeds","Bradford","Kirklees","Calderdale","Wakefield",
  "Birmingham","Solihull","Sandwell","Walsall","Dudley","Wolverhampton",
  "Bristol","Bath","Somerset","Gloucestershire",
  "Sheffield","Rotherham","Barnsley","Doncaster",
  "Nottingham","Leicester","Cambridge","Oxford","Coventry","Derby","Stoke-on-Trent","Northampton",
  "Newcastle","Gateshead","Sunderland","North Tyneside","South Tyneside",
  "Lancashire","Yorkshire","Norwich",
  "London","Westminster","Camden","Islington","Hackney","Tower Hamlets","Newham","Barking","Dagenham",
  "Croydon","Lambeth","Southwark","Lewisham","Greenwich","Haringey","Enfield","Ealing","Hounslow",
  "Edinburgh","Glasgow","Aberdeen","Dundee",
  "Cardiff","Swansea","Newport","Wrexham","Flintshire","Wales",
  "Belfast","Derry","Lisburn","Newry","Northern Ireland"
];

const STOP = new Set(["the","a","an","and","or","of","to","for","in","on","at","by","from","with","about","after","over",
  "into","uk","britain","british","england","scotland","wales","northern","ireland","today","new","plan","plans","says",
  "amid","as","vs","pm","mp","mps","council","councils"
]);

const tokens = s => String(s||"").toLowerCase()
  .replace(/https?:\/\/\S+/g," ")
  .replace(/[^a-z0-9\s\-]/g," ")
  .split(/\s+/).filter(Boolean);

const isContent = w => w.length>2 && !STOP.has(w) && !/^\d+$/.test(w);

function phrases(title, summary){
  const t = tokens(`${title} ${summary}`).filter(isContent);
  const uni = new Map();
  const bi = new Map();
  for (const w of t) uni.set(w,(uni.get(w)||0)+1);
  for (let i=0;i<t.length-1;i++){
    const k=`${t[i]} ${t[i+1]}`;
    bi.set(k,(bi.get(k)||0)+1);
  }
  return {uni,bi};
}

const placeFromText = s => PLACES.filter(p => new RegExp(`\\b${p}\\b`, "i").test(s));
const topN = (m,n=10) => Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([text,count])=>({text,count}));

function hostnameOf(url){
  try { return new URL(url).hostname.replace(/^www\./,"").toLowerCase(); }
  catch { return ""; }
}

function inferPlaces(it){
  const text = `${it.title || ""} ${it.summary || ""}`;
  const a = new Set();

  // 1) From headline/summary
  for (const p of placeFromText(text)) a.add(p);

  // 2) From link hostname
  const host = hostnameOf(it.link || "");
  if (host && DOMAIN_TO_PLACE[host]) a.add(DOMAIN_TO_PLACE[host]);

  // 3) From source name
  const src = (it.source || "").trim();
  if (src && SOURCE_TO_PLACE[src]) a.add(SOURCE_TO_PLACE[src]);

  // 4) As a last resort: try match any PLACES inside source string
  if (src) for (const p of placeFromText(src)) a.add(p);

  return Array.from(a);
}

async function main(){
  const raw = JSON.parse(await readFile("public/data/news.json","utf8"));
  const items = Array.isArray(raw.items) ? raw.items : [];

  const buckets = new Map(); // place -> { items:Set, uni, bi }

  for (const it of items){
    const places = inferPlaces(it);
    if (!places.length) continue;
    const { uni, bi } = phrases(it.title, it.summary);

    for (const place of places){
      if (!buckets.has(place)) buckets.set(place, { items: new Map(), uni: new Map(), bi: new Map() });
      const b = buckets.get(place);

      // de-duplicate by link per place
      const key = it.link || it.title;
      if (!b.items.has(key)) b.items.set(key, { title: it.title, link: it.link, source: it.source, pubDate: it.pubDate });

      for (const [k,v] of uni) b.uni.set(k,(b.uni.get(k)||0)+v);
      for (const [k,v] of bi)  b.bi.set(k,(b.bi.get(k)||0)+v);
    }
  }

  const areas = Array.from(buckets.entries()).map(([place,b])=>{
    const issues = topN(b.bi, 10).map(x=>x.text);
    const singles = topN(b.uni, 10).map(x=>x.text).filter(w=>!issues.some(i=>i.includes(w)));
    const examples = Array.from(b.items.values()).slice(0, 8);
    return { place, sampleCount: b.items.size, issues, keywords: singles, examples };
  }).sort((a,b)=>b.sampleCount-a.sampleCount);

  await writeFile("public/data/mood.json", JSON.stringify({ updatedAt: new Date().toISOString(), areas }, null, 2));
  console.log(`Wrote mood.json for ${areas.length} places (total items=${items.length})`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
