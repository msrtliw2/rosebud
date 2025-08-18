import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, Table as TableIcon, Newspaper, MapPin } from "lucide-react";

/* =============================================================================
   Rosebud — Clean data + Intelligence (News & Issues)
   - Hidden Source section, no chart
   - Tabs: Polling averages / Seat projections / Scotland / Insights / News / Issues
   - Sticky headers + pagination (“Load more”) on desktop
   - Mobile card view for tables
   - Seat projections: drop problematic “4 July 2024” row
   - Exclude POLARIS and “Different Conservative Party leaders...” tables
   - News tab reads /data/news.json (scripts/fetch-news.mjs)
   - Issues tab reads /data/mood.json (scripts/analyse-news.mjs)
   - Keyboard shortcuts: R to refresh, 1–6 to switch tabs
============================================================================= */

const WIKI_URL_DEFAULT =
  "https://en.m.wikipedia.org/wiki/Opinion_polling_for_the_next_United_Kingdom_general_election";

/* ----------------------------- tiny design system --------------------------- */

const colors = {
  bg: "#0b0f17",
  panel: "#111827",
  panelBorder: "#1f2937",
  text: "#e5e7eb",
  subtext: "#9ca3af",
  accent: "#f43f5e",
  chip: "#1f2937",
  chipOn: "#374151",
  chipBorder: "#2a3341",
};

function Row({ gap = 8, wrap = true, style = {}, children }) {
  return (
    <div
      style={{
        display: "flex",
        gap,
        flexWrap: wrap ? "wrap" : "nowrap",
        alignItems: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Card({ title, right, children }) {
  return (
    <div
      style={{
        border: `1px solid ${colors.panelBorder}`,
        borderRadius: 14,
        background: colors.panel,
        padding: 16,
      }}
    >
      {title && (
        <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, color: colors.text }}>{title}</div>
          {right}
        </Row>
      )}
      {children}
    </div>
  );
}

function Button({ label, onClick, variant = "primary", small = false, icon }) {
  const isPrimary = variant === "primary";
  return (
    <button
      onClick={onClick}
      className="rb-btn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 10,
        padding: small ? "6px 10px" : "10px 14px",
        border: `1px solid ${isPrimary ? colors.accent : colors.chipBorder}`,
        background: isPrimary ? colors.accent : colors.chip,
        color: isPrimary ? "white" : colors.text,
        cursor: "pointer",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 999,
        padding: "6px 10px",
        border: `1px solid ${colors.chipBorder}`,
        background: active ? colors.chipOn : colors.chip,
        color: colors.text,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span>{children}</span>
    </button>
  );
}

/* ------------------------------- helpers ------------------------------------ */

function downloadCSV(filename, rows) {
  if (!rows || !rows.length) return;
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v).replaceAll('"', '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const headers = Object.keys(rows[0] ?? {});
  const csv = [headers.map(escape).join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join(
    "\n"
  );
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function tableToObjects(table) {
  const headers = Array.from(table.querySelectorAll("thead tr th, tr th"))
    .map((th) => th.innerText.trim())
    .filter(Boolean);
  const bodyRows = table.querySelectorAll("tbody tr, tr");
  let rows = [];
  for (const tr of bodyRows) {
    const cells = Array.from(tr.querySelectorAll("td"));
    if (!cells.length) continue;
    const obj = {};
    cells.forEach((td, i) => {
      const key = headers[i] ?? `col_${i + 1}`;
      obj[key] = td.innerText.replace(/\[.*?\]/g, "").trim();
    });
    rows.push(obj);
  }
  return rows;
}

// Walk in order; pair heading/caption to each wikitable for robust sectioning
function extractTablesWithHeadings(html) {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  let lastHeading = "";
  const out = [];

  while (node) {
    const tag = node.tagName || "";
    if (/^H[1-6]$/.test(tag)) {
      lastHeading = (node.textContent || "").trim();
    }
    if (tag === "TABLE" && node.classList && node.classList.contains("wikitable")) {
      const caption = node.querySelector("caption")?.textContent?.trim() || "";
      const heading = caption || lastHeading || "";
      out.push({ heading, rows: tableToObjects(node) });
    }
    node = walker.nextNode();
  }
  return out;
}

function headingMatches(heading = "", filter = "") {
  const h = heading.toLowerCase();
  const f = (filter || "").toLowerCase();
  if (!f) return true;
  const tests = {
    "polling averages": /averages?|rolling\s*average|trend/,
    "seat projections": /seat|projection|mrp|constituency\s*model/,
    scotland: /scotland/,
  };
  const rx = tests[f] || new RegExp(f.replace(/\s+/g, ".*"), "i");
  return rx.test(h);
}

function titleFromWikiUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return "Opinion_polling_for_the_next_United_Kingdom_general_election";
  }
}

function apiUrlForWiki(url) {
  const title = titleFromWikiUrl(url || WIKI_URL_DEFAULT);
  return `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
}

function useFetchWiki(url) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState(null);

  const fetchPage = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrlForWiki(url), {
        method: "GET",
        headers: { Accept: "text/html" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setHtml(text);
      setFetchedAt(new Date());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { html, loading, error, fetchedAt, fetchPage };
}

/* ----------------------------- tables component ------------------------------ */

function ParsedTables({ html, filter }) {
  // detect small screens
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 1024); //1024px instead of 768
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // parse tables
  const allTables = React.useMemo(() => {
    const all = extractTablesWithHeadings(html);
    // remove POLARIS + “Different Conservative leaders…”
    const excludeRx = /(polaris\b|different\s+conservative\s+party\s+leaders:?\s*voting\s+intention)/i;
    return all.filter((t) => !excludeRx.test(t.heading || ""));
  }, [html]);

  const parsed = React.useMemo(() => {
    let list = allTables;
    if (filter) {
      const matched = allTables.filter((t) => headingMatches(t.heading, filter));
      list = matched.length ? matched : allTables.slice(0, 1);
    }

    // Seat projections: drop row where Date is "4 July 2024" (it explodes width)
    if (/seat projections/i.test(filter || "")) {
      list = list.map((t) => {
        const rows = (t.rows || []).filter((r) => {
          const d = (r["Date(s) conducted"] || r["Date"] || "").trim();
          return d !== "4 July 2024";
        });
        return { ...t, rows };
      });
    }

    return list;
  }, [allTables, filter]);

  // per-table pagination limits
  const [limits, setLimits] = React.useState({});
  const getLimit = (i) => limits[i] ?? 60;
  const incLimit = (i) => setLimits((s) => ({ ...s, [i]: getLimit(i) + 60 }));

  // prefer showing these columns on mobile if they exist (ordered)
  const MOBILE_KEYS_PREFERENCE = [
    "Date(s) conducted", "Date",
    "Polling firm/Client", "Polling firm", "Client", "Pollster",
    "Sample size",
    "Lead", "Con lead", "Lab lead",
    // main parties — these are the most asked-for figures
    "Labour", "Conservative", "Reform",
    "Liberal Democrats", "Lib Dems", "Green", "Greens", "SNP", "Plaid Cymru",
  ];

  // helper: choose very compact set of columns for phones
function pickMobileColumns(rows) {
  const allKeys = Object.keys(rows[0] || {});
  if (!allKeys.length) return [];
  const chosen = [];
  // pull from our preference list in order
  for (const k of MOBILE_KEYS_PREFERENCE) {
    if (allKeys.includes(k)) chosen.push(k);
    if (chosen.length >= 6) break; // <- hard cap for readability
  }
  // as a fallback, include the very first column if we somehow missed context
  if (chosen.length === 0 && allKeys.length) chosen.push(allKeys[0]);
  return chosen;
}

  // compact desktop columns for key sections
  function pickDesktopColumns(rows, compact) {
    if (!compact) return Object.keys(rows[0] || {});
    const all = Object.keys(rows[0] || {});
    const PREFERRED = [
      "Date(s) conducted", "Date",
      "Polling firm/Client", "Polling firm", "Client", "Pollster",
      "Sample size", "Method",
      "Labour", "Conservative", "Reform",
      "Liberal Democrats", "Lib Dems", "Green", "Greens", "SNP", "Plaid Cymru",
      "Lead", "Con lead", "Lab lead"
    ];
    const chosen = [];
    for (const k of PREFERRED) if (all.includes(k)) chosen.push(k);
    for (const k of all) if (!chosen.includes(k)) chosen.push(k);
    return chosen.slice(0, 12); // cap width
  }

  if (!parsed.length)
    return <div style={{ fontSize: 14, color: "#9ca3af" }}>No tables found. Try Refresh.</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {parsed.map(({ heading, rows }, idx) => {
        const title = heading || `Table #${idx + 1}`;
        if (!rows?.length) return null;

        const compact = /polling averages|seat projections|scotland/i.test(filter || "");
        const limit = getLimit(idx);

        // —— MOBILE CARD VIEW ——
        if (isMobile) {
          const cols = pickMobileColumns(rows);
          return (
            <div key={idx} style={{ border: "1px solid #1f2937", borderRadius: 12, background: "#111827" }}>
              <div style={{ padding: 12, borderBottom: "1px solid #1f2937", fontWeight: 600 }}>{title}</div>
              <div style={{ display: "grid", gap: 8, padding: 10 }}>
                {rows.slice(0, limit).map((r, i) => (
                  <div key={i} className="rb-card">
                    {cols.map((k) => (
                      <div key={k} className="rb-kv">
                        <div className="rb-k">{k}</div>
                        <div className="rb-v">{r[k]}</div>
                      </div>
                    ))}
                  </div>
                ))}
                {rows.length > limit && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button label="Load more" variant="secondary" small onClick={() => incLimit(idx)} />
                    <Button label="Export CSV" variant="secondary" small onClick={() => downloadCSV(title.replace(/\s+/g, "_") + ".csv", rows)} />
                  </div>
                )}
                {rows.length <= limit && (
                  <div>
                    <Button label="Export CSV" variant="secondary" small onClick={() => downloadCSV(title.replace(/\s+/g, "_") + ".csv", rows)} />
                  </div>
                )}
              </div>
            </div>
          );
        }

        // —— DESKTOP TABLE VIEW ——
        const cols = pickDesktopColumns(rows, compact);

        return (
          <div key={idx} style={{ border: "1px solid #1f2937", borderRadius: 12, background: "#111827" }}>
            <div style={{ padding: 12, borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
                <TableIcon size={16} /> <span>{title}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button label="Export CSV" variant="secondary" small onClick={() => downloadCSV(title.replace(/\s+/g, "_") + ".csv", rows)} />
              </div>
            </div>

            <div className="rb-table-wrap">
              <table className={`rb-table ${compact ? "rb-compact" : ""}`}>
                <thead className="rb-sticky">
                  <tr>
                    {cols.map((h) => (
                      <th key={h} title={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((r, i) => (
                    <tr key={i}>
                      {cols.map((h) => (
                        <td key={h} title={r[h]}>{r[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length > limit && (
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 12px" }}>
                <Button label="Load more rows" variant="secondary" small onClick={() => incLimit(idx)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------- News & Issues panels ---------------------------- */

function NewsPanel() {
  const [data, setData] = useState({ items: [], updatedAt: null });

  useEffect(() => {
    fetch("/data/news.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ items: [] }));
  }, []);

  const items = (data.items || []).slice(0, 60);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: colors.subtext }}>
        <Newspaper size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Politics feed — last update: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
      </div>

      {items.length ? (
        items.map((n, i) => (
          <div
            key={i}
            style={{
              border: "1px solid #1f2937",
              borderRadius: 10,
              padding: 12,
              background: "#111827",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              <a href={n.link} target="_blank" rel="noreferrer" style={{ color: "#e5e7eb", textDecoration: "none" }}>
                {n.title}
              </a>
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af" }}>
              {n.source} · {n.pubDate ? new Date(n.pubDate).toLocaleString() : ""}
            </div>
            {n.summary && <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 6 }}>{n.summary}</div>}
          </div>
        ))
      ) : (
        <div style={{ color: colors.subtext }}>
          No news yet — run: <code>npm run news</code>
        </div>
      )}
    </div>
  );
}

function IssuesPanel() {
  const [data, setData] = useState({ areas: [], updatedAt: null });
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/data/mood.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ areas: [] }));
  }, []);

  const areas = useMemo(() => {
    if (!query) return data.areas || [];
    const q = query.toLowerCase();
    return (data.areas || []).filter((a) => a.place.toLowerCase().includes(q));
  }, [data.areas, query]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: colors.subtext }}>
          <MapPin size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Local issues — last update: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter places (e.g., Bolton, Wigan)…"
          style={{
            flex: "1 1 260px",
            border: `1px solid ${colors.panelBorder}`,
            borderRadius: 10,
            padding: "8px 10px",
            background: "#0f1624",
            color: colors.text,
          }}
        />
      </div>

      {areas.length ? (
        areas.map((a, idx) => (
          <div key={idx} style={{ border: "1px solid #1f2937", borderRadius: 10, padding: 12, background: "#111827" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{a.place}</div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>{a.sampleCount} recent articles</div>
            </div>

            {a.issues?.length ? (
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {a.issues.slice(0, 8).map((t) => (
                  <span
                    key={t}
                    style={{
                      padding: "4px 8px",
                      border: "1px solid #2a3341",
                      borderRadius: 999,
                      background: "#1f2937",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : null}

            {a.examples?.length ? (
              <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                {a.examples.slice(0, 6).map((ex, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <a href={ex.link} target="_blank" rel="noreferrer" style={{ color: "#e5e7eb", textDecoration: "none" }}>
                      {ex.title}
                    </a>
                    <span style={{ color: "#9ca3af", fontSize: 12 }}>
                      {" "}
                      — {ex.source} {ex.pubDate ? `· ${new Date(ex.pubDate).toLocaleString()}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))
      ) : (
        <div style={{ color: colors.subtext }}>
          No places yet — run <code>npm run news</code> then <code>npm run mood</code>.
        </div>
      )}
    </div>
  );
}

/* ---------------------- Insights Panel (news.items & mood.areas) ------------- */

function InsightsPanel() {
  const [mood, setMood] = React.useState({ areas: [], updatedAt: null });
  const [news, setNews] = React.useState({ items: [], updatedAt: null });

  React.useEffect(() => {
    fetch("/data/mood.json", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : { areas: [], updatedAt: null }))
      .then(setMood)
      .catch(() => setMood({ areas: [], updatedAt: null }));

    fetch("/data/news.json", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : { items: [], updatedAt: null }))
      .then(setNews)
      .catch(() => setNews({ items: [], updatedAt: null }));
  }, []);

  const { topIssues, hotspots, election } = React.useMemo(() => {
    const areas = Array.isArray(mood.areas) ? mood.areas : [];
    const items = Array.isArray(news.items) ? news.items : [];

    // 1) Top issues across the UK (count places mentioning them)
    const issueCounts = new Map();
    for (const a of areas) for (const issue of a.issues || [])
      issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);

    const topIssues = Array.from(issueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([text, count]) => ({ text, count }));

    // 2) Hotspots: change in article volume vs last snapshot
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem("rosebud_prevVolumes") || "{}"); } catch {}
    const deltas = areas.map(a => {
      const now = Number(a.sampleCount || 0);
      const before = Number(prev[a.place] || 0);
      return { place: a.place, change: now - before, now, before };
    }).sort((a,b) => b.change - a.change).slice(0, 8);

    const snap = {};
    for (const a of areas) snap[a.place] = Number(a.sampleCount || 0);
    try { localStorage.setItem("rosebud_prevVolumes", JSON.stringify(snap)); } catch {}

    // 3) Election-related headlines
    const electionRx = /\b(election|by-?election|poll|mrp|constituency|swing|seat projection)\b/i;
    const election = items
      .filter(it => electionRx.test(`${it.title || ""} ${it.summary || ""}`))
      .slice(0, 8)
      .map(it => ({ title: it.title, link: it.link, source: it.source, when: it.pubDate }));

    return { topIssues, hotspots: deltas, election };
  }, [mood, news]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card title="Top UK issues (by number of areas mentioning them)">
        {topIssues.length ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {topIssues.map(i => (
              <span key={i.text}
                style={{ padding: "6px 10px", border: "1px solid #2a3341", borderRadius: 999, background: "#1f2937" }}>
                {i.text} <span style={{ color: "#9ca3af" }}>· {i.count}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14, color: "#9ca3af" }}>No issues yet — run news+mood.</div>
        )}
      </Card>

      <Card title="Hotspots (biggest change in article volume since last open)">
        {hotspots.length ? (
          <table style={{ width: "100%", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8 }}>Place</th>
                <th style={{ textAlign: "right", padding: 8 }}>Change</th>
                <th style={{ textAlign: "right", padding: 8 }}>Now</th>
                <th style={{ textAlign: "right", padding: 8 }}>Before</th>
              </tr>
            </thead>
            <tbody>
              {hotspots.map(h => (
                <tr key={h.place} style={{ borderTop: "1px solid #1f2937" }}>
                  <td style={{ padding: 8 }}>{h.place}</td>
                  <td style={{ padding: 8, textAlign: "right", color: h.change >= 0 ? "#22c55e" : "#ef4444" }}>
                    {h.change >= 0 ? "+" : ""}{h.change}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>{h.now}</td>
                  <td style={{ padding: 8, textAlign: "right", color: "#9ca3af" }}>{h.before}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 14, color: "#9ca3af" }}>No hotspots yet.</div>
        )}
      </Card>

      <Card title="Election-related headlines">
        {election.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {election.map((it, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <a href={it.link} target="_blank" rel="noreferrer" style={{ color: "#e5e7eb", textDecoration: "none" }}>
                  {it.title}
                </a>
                {it.source ? <span style={{ color: "#9ca3af", fontSize: 12 }}> — {it.source}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontSize: 14, color: "#9ca3af" }}>No election items detected.</div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------- App -------------------------------------- */

// localStorage hook (so your selected tab is remembered)
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = React.useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });
  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch {}
  };
  return [storedValue, setValue];
}

export default function App() {
  const [url] = useState(WIKI_URL_DEFAULT);
  const { html, loading, error, fetchedAt, fetchPage } = useFetchWiki(url);

  const tabs = ["Polling averages", "Seat projections", "Scotland", "Insights", "News", "Issues"];
  const [filter, setFilter] = useLocalStorage("rosebud_tab", tabs[0]);

  // keyboard shortcuts: R to refresh, 1..6 to switch tabs
  useEffect(() => {
    const handler = (e) => {
      if (e.key.toLowerCase() === "r") fetchPage();
      const idx = parseInt(e.key, 10) - 1;
      if (!Number.isNaN(idx) && tabs[idx]) setFilter(tabs[idx]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fetchPage]);

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 20px" }}>
        {/* top bar */}
        <Row style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>🌹 Rosebud — Polling Trends</div>
            <div style={{ fontSize: 12, color: colors.subtext }}>
              {fetchedAt ? `Last updated: ${fetchedAt.toLocaleString()}` : "Not fetched yet"}
            </div>
          </div>
          <Button
            label={loading ? "Refreshing…" : "Refresh"}
            onClick={fetchPage}
            icon={<RefreshCw size={16} />}
            variant="primary"
          />
        </Row>

        {/* tabs */}
        <Row gap={8} style={{ marginTop: 12 }}>
          {tabs.map((t) => (
            <Chip key={t} active={filter === t} onClick={() => setFilter(t)}>
              {t}
            </Chip>
          ))}
        </Row>

        {/* content */}
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <Card title="Loading">
              <div style={{ fontSize: 14, color: colors.subtext }}>Fetching latest tables…</div>
            </Card>
          ) : error ? (
            <Card title="Error">
              <Row gap={6}>
                <AlertTriangle size={16} /> <span style={{ fontSize: 13 }}>{error}</span>
              </Row>
            </Card>
          ) : filter === "Insights" ? (
            <InsightsPanel />
          ) : filter === "News" ? (
            <NewsPanel />
          ) : filter === "Issues" ? (
            <IssuesPanel />
          ) : (
            <ParsedTables html={html} filter={filter} />
          )}
        </div>

        <div style={{ margin: "24px 0", fontSize: 12, color: colors.subtext }}>
          Tip: Press <code>R</code> to refresh • Press <code>1–6</code> to switch tabs quickly.
        </div>
      </div>
    </div>
  );
}
