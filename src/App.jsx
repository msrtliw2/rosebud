import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, Table as TableIcon, Newspaper, MapPin } from "lucide-react";

/* =============================================================================
   Rosebud — Clean data + Intelligence (News & Issues)
   - Hidden Source section, no chart
   - Tabs: Polling averages / Seat projections / MRP / Scotland / News / Issues
   - Seat projections: wrap long cells + drop problematic "4 July 2024" row
   - Exclude POLARIS and "Different Conservative Party leaders..." tables
   - News tab reads /data/news.json (from scripts/fetch-news.mjs)
   - Issues tab reads /data/mood.json (from scripts/analyse-news.mjs)
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
  tableRow: "#0f1622",
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
      <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontWeight: 600, color: colors.text }}>{title}</div>
        {right}
      </Row>
      {children}
    </div>
  );
}

function Button({ label, onClick, variant = "primary", small = false, icon }) {
  const isPrimary = variant === "primary";
  return (
    <button
      onClick={onClick}
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
    mrp: /\bmrp\b|multilevel/,
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
  // All tables, excluding ones you asked to remove
  const allTables = useMemo(() => {
    const all = extractTablesWithHeadings(html);

    // Remove POLARIS + "Different Conservative Party leaders..." tables
    const excludeRx =
      /(polaris\b|different\s+conservative\s+party\s+leaders:?\s*voting\s+intention|seat\s+projection)/i;

    return all.filter((t) => !excludeRx.test(t.heading || ""));
  }, [html]);

  const parsed = useMemo(() => {
    if (!filter) return allTables;
    const matched = allTables.filter((t) => headingMatches(t.heading, filter));
    return matched.length ? matched : allTables.slice(0, 1);
  }, [allTables, filter]);

  // Narrow "Seat projections": remove the wide 4 July 2024 row
  const sanitized = useMemo(() => {
    return parsed.map((t) => {
      if (/seat projections?/i.test(t.heading || "")) {
        const rows = (t.rows || []).filter((r) => {
          const vals = Object.values(r).map((v) => String(v));
          return !vals.some((v) => /4\s+Jul(?:y)?\s+2024/i.test(v));
        });
        return { ...t, rows };
      }
      return t;
    });
  }, [parsed]);

  if (!sanitized.length)
    return <div style={{ fontSize: 14, color: colors.subtext }}>No tables found. Try Refresh.</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {sanitized.map(({ heading, rows }, idx) => (
        <Card
          key={idx}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <TableIcon size={16} /> {heading || `Table #${idx + 1}`}
            </span>
          }
          right={
            rows?.length ? (
              <Button
                variant="secondary"
                label="Export CSV"
                onClick={() => downloadCSV((heading || `table_${idx + 1}`).replace(/\s+/g, "_") + ".csv", rows)}
              />
            ) : null
          }
        >
          <div
            style={{
              maxHeight: 480,
              overflow: "auto",
              borderRadius: 8,
              border: `1px solid ${colors.panelBorder}`,
            }}
          >
            <table
              style={{
                width: "100%",
                fontSize: 14,
                borderCollapse: "separate",
                borderSpacing: 0,
                tableLayout: "fixed", // keep width under control
              }}
            >
              <thead style={{ position: "sticky", top: 0, background: colors.panel }}>
                <tr style={{ borderBottom: `1px solid ${colors.panelBorder}` }}>
                  {Object.keys(rows[0] || {}).map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        position: "sticky",
                        top: 0,
                        whiteSpace: "normal", // allow wrapping
                        wordBreak: "break-word",
                        maxWidth: 220, // stop super-wide columns
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 80).map((r, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${colors.panelBorder}`, background: colors.tableRow }}>
                    {Object.keys(rows[0] || {}).map((h) => (
                      <td
                        key={h}
                        style={{
                          padding: 10,
                          whiteSpace: "normal", // wrap cell content
                          wordBreak: "break-word",
                          maxWidth: 260,
                          verticalAlign: "top",
                        }}
                      >
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 80 && (
              <div style={{ fontSize: 12, color: colors.subtext, padding: 8 }}>
                Showing first 80 rows. Export for full table.
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function InsightsPanel() {
  const [mood, setMood] = useState({ areas: [], updatedAt: null });

  useEffect(() => {
    fetch("/data/mood.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { areas: [], updatedAt: null }))
      .then(setMood)
      .catch(() => setMood({ areas: [], updatedAt: null }));
  }, []);

  const { topIssues, hotspots } = useMemo(() => {
    const allIssues = new Map();   // issue -> in how many areas it appears
    const areaVolumes = new Map(); // place -> sampleCount

    for (const a of mood.areas || []) {
      areaVolumes.set(a.place, a.sampleCount || 0);
      const uniqueIssues = new Set(a.issues || []);
      for (const issue of uniqueIssues) {
        allIssues.set(issue, (allIssues.get(issue) || 0) + 1);
      }
    }

    const topIssues = Array.from(allIssues.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([text, places]) => ({ text, places }));

    // Compare volume vs previous snapshot (stored locally)
    let prev = {};
    try { prev = JSON.parse(localStorage.getItem("rosebud_prevVolumes") || "{}"); } catch {}
    const deltas = [];
    for (const [place, vol] of areaVolumes.entries()) {
      const before = Number(prev[place] || 0);
      deltas.push({ place, change: vol - before, now: vol, before });
    }
    deltas.sort((a, b) => b.change - a.change);
    const hotspots = deltas.slice(0, 8);

    // Save current snapshot
    const snapshot = {};
    for (const [place, vol] of areaVolumes.entries()) snapshot[place] = vol;
    try { localStorage.setItem("rosebud_prevVolumes", JSON.stringify(snapshot)); } catch {}

    return { topIssues, hotspots };
  }, [mood]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Card title="Top national issues (seen across the most areas)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {topIssues.length ? (
            topIssues.map((i) => (
              <span
                key={i.text}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #2a3341",
                  borderRadius: 999,
                  background: "#1f2937",
                }}
              >
                {i.text} <span style={{ color: "#9ca3af" }}>· {i.places}</span>
              </span>
            ))
          ) : (
            <span style={{ color: "#9ca3af" }}>No issues yet — run news + mood.</span>
          )}
        </div>
      </Card>

      <Card title="Hotspots (biggest change in volume since last open)">
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
              {hotspots.map((h) => (
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
          <div style={{ color: "#9ca3af" }}>No hotspots yet.</div>
        )}
      </Card>
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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 12, color: colors.subtext }}>
        <Newspaper size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
        Politics feed — last update: {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "—"}
      </div>

      {data.items?.length ? (
        data.items.slice(0, 60).map((n, i) => (
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
          No news yet — run: <code>node scripts/fetch-news.mjs</code>
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
          No places yet — run <code>node scripts/fetch-news.mjs</code> then <code>node scripts/analyse-news.mjs</code>.
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- App -------------------------------------- */

// ---------------- localStorage hook ----------------
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = React.useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn("LocalStorage error", error);
      return initialValue;
    }
  });

  const setValue = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.warn("LocalStorage set error", error);
    }
  };

  return [storedValue, setValue];
}

export default function App() {
  const [url] = useState(WIKI_URL_DEFAULT);
  const { html, loading, error, fetchedAt, fetchPage } = useFetchWiki(url);

  const tabs = ["Polling averages", "Seat projections", "MRP", "Scotland", "Insights", "News", "Issues"];
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
