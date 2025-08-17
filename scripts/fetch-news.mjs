// scripts/fetch-news.mjs
import Parser from "rss-parser";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** -------------------------------------------------------------------------
 *  SOURCES: national + regional (with fallbacks)
 *  Tip: add more by pushing { name, candidates: [ ...feed URLs... ] }
 * ------------------------------------------------------------------------ */
const SOURCES = [
  // ===== National =====
  { name: "BBC Politics", candidates: ["https://feeds.bbci.co.uk/news/politics/rss.xml"] },
  { name: "Guardian Politics", candidates: ["https://www.theguardian.com/politics/rss"] },
  { name: "Sky Politics", candidates: ["http://feeds.skynews.com/feeds/rss/politics.xml", "https://news.sky.com/feeds/rss/politics.xml"] },
  { name: "Independent UK Politics", candidates: ["https://www.independent.co.uk/news/uk/politics/rss"] },
  { name: "Financial Times UK/Politics", candidates: ["https://www.ft.com/world/uk?format=rss", "https://www.ft.com/uk-politics?format=rss"] },

  // ===== North West =====
  { name: "The Bolton News", candidates: ["https://www.theboltonnews.co.uk/news/rss"] },
  { name: "Wigan Today", candidates: ["https://www.wigantoday.net/rss", "https://www.wigantoday.net/news/rss", "https://www.wigantoday.net/politics/rss"] },
  { name: "Manchester Evening News", candidates: ["https://www.manchestereveningnews.co.uk/?service=rss"] },
  { name: "Liverpool Echo", candidates: ["https://www.liverpoolecho.co.uk/?service=rss"] },
  { name: "Lancashire Evening Post", candidates: ["https://www.lep.co.uk/rss", "https://www.lep.co.uk/news/rss"] },
  { name: "Blackpool Gazette", candidates: ["https://www.blackpoolgazette.co.uk/rss", "https://www.blackpoolgazette.co.uk/news/rss"] },

  // ===== Yorkshire & North East =====
  { name: "York Press", candidates: ["https://www.yorkpress.co.uk/news/rss"] },
  { name: "Northern Echo", candidates: ["https://www.thenorthernecho.co.uk/news/rss"] },
  { name: "The Scarborough News", candidates: ["https://www.thescarboroughnews.co.uk/rss"] },
  { name: "Leeds Live", candidates: ["https://www.leeds-live.co.uk/?service=rss"] },
  { name: "Yorkshire Post", candidates: ["https://www.yorkshirepost.co.uk/rss"] },
  { name: "Hull Daily Mail", candidates: ["https://www.hulldailymail.co.uk/?service=rss"] },
  { name: "Sheffield Star", candidates: ["https://www.thestar.co.uk/rss", "https://www.thestar.co.uk/news/rss"] },
  { name: "Bradford Telegraph & Argus", candidates: ["https://www.thetelegraphandargus.co.uk/news/rss"] },

  // ===== Midlands =====
  { name: "Birmingham Mail", candidates: ["https://www.birminghammail.co.uk/?service=rss"] },
  { name: "Nottingham Post", candidates: ["https://www.nottinghampost.com/?service=rss"] },
  { name: "Derby Telegraph", candidates: ["https://www.derbytelegraph.co.uk/?service=rss"] },
  { name: "Leicester Mercury", candidates: ["https://www.leicestermercury.co.uk/?service=rss"] },
  { name: "Coventry Telegraph", candidates: ["https://www.coventrytelegraph.net/?service=rss"] },
  { name: "Stoke Sentinel", candidates: ["https://www.stokesentinel.co.uk/?service=rss"] },

  // ===== East / South East =====
  // KentOnline exposes per-town feeds at /rss-feeds (we still list the index and try some town feeds):
  { name: "KentOnline (index)", candidates: ["https://www.kentonline.co.uk/rss-feeds/"] },
  { name: "Oxford Mail", candidates: ["https://www.oxfordmail.co.uk/news/rss/"] },
  { name: "Cambridgeshire Live", candidates: ["https://www.cambridge-news.co.uk/?service=rss"] },
  { name: "Essex Live", candidates: ["https://www.essexlive.news/?service=rss"] },
  { name: "HertsLive", candidates: ["https://www.hertfordshiremercury.co.uk/?service=rss"] },
  { name: "Suffolk News (East Anglian Daily Times)", candidates: ["https://www.eadt.co.uk/news/rss"] },

  // ===== South / South West =====
  { name: "Portsmouth News", candidates: ["https://www.portsmouth.co.uk/rss", "https://www.portsmouth.co.uk/news/rss"] },
  { name: "Bristol Post", candidates: ["https://www.bristolpost.co.uk/?service=rss"] },
  { name: "Somerset Live", candidates: ["https://www.somersetlive.co.uk/?service=rss"] },
  { name: "Gloucestershire Live", candidates: ["https://www.gloucestershirelive.co.uk/?service=rss"] },
  { name: "Plymouth Herald", candidates: ["https://www.plymouthherald.co.uk/?service=rss"] },
  { name: "Cornwall Live", candidates: ["https://www.cornwalllive.com/?service=rss"] },

  // ===== London =====
  { name: "Evening Standard", candidates: ["https://www.standard.co.uk/rss"] },
  { name: "MyLondon", candidates: ["https://www.mylondon.news/?service=rss"] },

  // ===== Scotland, Wales, NI =====
  { name: "Herald Scotland / Glasgow Times", candidates: ["https://www.heraldscotland.com/news/rss", "https://www.glasgowtimes.co.uk/news/rss"] },
  { name: "The Scotsman", candidates: ["https://www.scotsman.com/rss", "https://www.scotsman.com/news/rss"] },
  { name: "WalesOnline", candidates: ["https://www.walesonline.co.uk/?service=rss"] },
  { name: "Belfast Live", candidates: ["https://www.belfastlive.co.uk/?service=rss"] },
  { name: "Belfast Telegraph", candidates: ["https://www.belfasttelegraph.co.uk/rss/"] },
];

/** ---------------- politics-only filters (keep these tight) ----------------- */
const INCLUDE = [
  "election","by-election","by election",
  "council","councillor","council tax","local plan","mayor","combined authority",
  "parliament","mp ","mps ","msps","ms ","senedd","stormont","westminster","whitehall",
  "manifesto","policy","pledge","bill","act","legislation","committee","select committee",
  "poll","polling","mrp","seat projection","swing","constituency",
  "budget","spending","tax","nhs","schools","housing","planning","immigration","benefits",
  "devolution","transport","rail","buses","clean air","ulez","levelling up",
  "police commissioner","pcc","crime","justice",
].map(s=>new RegExp(`\\b${s}\\b`,"i"));

const EXCLUDE = [
  "strictly come dancing","strictly","love island","big brother","x factor","britain's got talent",
  "premier league","champions league","transfer","fixture","line-up","lineup","goal","match report",
  "celebrity","gossip","royal family","soap","coronation street","eastenders","emmerdale",
  "lotto","lottery","horoscope","weather warning",
].map(s=>new RegExp(s,"i"));

/** ------------------------------- fetcher ------------------------------------ */
const parser = new Parser({
  headers: {
    "User-Agent": "Rosebud/1.0 (politics feed)",
    Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  },
  timeout: 15000,
});

function isPolitical(title="", summary="") {
  const t = (title||"") + " " + (summary||"");
  if (EXCLUDE.some(rx=>rx.test(t))) return false;
  return INCLUDE.some(rx=>rx.test(t));
}

function normalize(item, sourceTitle) {
  const summary = (item.contentSnippet || item.content || "").replace(/\s+/g, " ").trim();
  return {
    title: item.title || "",
    link: item.link || "",
    pubDate: item.isoDate || item.pubDate || null,
    source: sourceTitle,
    summary,
  };
}

async function parseWithFallback(candidates) {
  let lastErr;
  for (const url of candidates) {
    try {
      await delay(100);
      const feed = await parser.parseURL(url);
      if (feed?.items?.length) return { feed, url };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All candidates failed");
}

async function main() {
  const all = [];

  for (const src of SOURCES) {
    try {
      const { feed } = await parseWithFallback(src.candidates);
      const sourceTitle = feed.title || src.name;
      for (const raw of feed.items || []) {
        const it = normalize(raw, sourceTitle);
        if (isPolitical(it.title, it.summary)) all.push(it);
      }
    } catch (e) {
      console.warn(`Feed failed for ${src.name}: ${e?.message || e}`);
    }
  }

  // De-dup by title+source; keep latest
  const map = new Map();
  for (const it of all) {
    const key = `${it.source}__${it.title}`.toLowerCase();
    const prev = map.get(key);
    if (!prev || new Date(it.pubDate || 0) > new Date(prev.pubDate || 0)) map.set(key, it);
  }

  const items = Array.from(map.values())
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, 200); // a bit more room now that we’re local-heavy

  await writeFile("public/data/news.json", JSON.stringify({ updatedAt: new Date().toISOString(), items }, null, 2));
  console.log(`Wrote ${items.length} political items to public/data/news.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
