"use client";

import { useMemo, useState } from "react";

type StopKind = "home" | "appointment" | "lunch";

type PlannedStop = {
  kind: StopKind;
  id: string | null;
  label: string;
  start: string;
  end: string;
  travel_min_from_prev: number;
};

type PlanAlert = {
  level: "info" | "warn" | "critical";
  type: "idle" | "travel" | "lunch" | "back_home" | "swap";
  message: string;
  impact?: string | null;
};

type Analysis = {
  score: number;
  total_travel_min: number;
  idle_min: number;
  long_idle_blocks_min: number[];
  planned_appointments: number;
  unplanned_appointments: number;
  recommendations: string[];
  alerts?: PlanAlert[];
};

type Variant = {
  name: string;
  stops: PlannedStop[];
  unplanned: string[];
  analysis: Analysis;
};

type SuggestResponse = {
  best: Variant;
  variants: Variant[];
};

function hhmm(iso: string) {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function minutesBetween(aIso: string, bIso: string) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  return Math.max(0, Math.round((b - a) / 60000));
}

function badge(kind: StopKind) {
  if (kind === "home") return { t: "HOME", bg: "#1f2937" };
  if (kind === "lunch") return { t: "LUNCH", bg: "#7c2d12" };
  return { t: "RDV", bg: "#064e3b" };
}

function levelColor(level: PlanAlert["level"]) {
  if (level === "critical") return "#991b1b";
  if (level === "warn") return "#9a3412";
  return "#1f2937";
}

export default function Home() {
  const [status, setStatus] = useState<string>("Idle");
  const [data, setData] = useState<SuggestResponse | null>(null);
  const [selected, setSelected] = useState<string>("best");
  const [showDebug, setShowDebug] = useState<boolean>(false);

  async function testHealth() {
    try {
      setStatus("⏳ Test /health...");
      const res = await fetch("/api/health", { cache: "no-store" });
      const text = await res.text();
      setStatus(`✅ /health HTTP ${res.status} — ${text}`);
    } catch (err: any) {
      setStatus(`❌ /health erreur: ${err?.message || String(err)}`);
    }
  }

  async function testSuggest() {
    try {
      const payload = {
        date: "2026-02-02",
        home: { label: "Maison", lat: 50.85, lon: 4.35 },
        appointments: [
          { id: "A1", type: "demo", location: { label: "Client 1", lat: 50.83, lon: 4.37 } },
          { id: "A2", type: "training", location: { label: "Client 2", lat: 50.88, lon: 4.30 } },
        ],
      };

      setStatus("⏳ Test /suggest...");
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as SuggestResponse;
      setData(json);
      setSelected("best");
      setStatus(`✅ /suggest HTTP ${res.status}`);
    } catch (err: any) {
      setStatus(`❌ /suggest erreur: ${err?.message || String(err)}`);
    }
  }
         <button
          onClick={testSuggestRealDay}
          style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}
        >
          Journée réaliste (15 RDV)
        </button>

  async function testSuggestRealDay() {
    try {
      // Journée "Belgique" réaliste (Bruxelles + alentours + un détour type Liège)
      const payload = {
        date: "2026-02-02",
        home: { label: "Maison", lat: 50.85, lon: 4.35 }, // Bruxelles approx
        start_time: "07:30",
        end_time: "16:30",
        buffer_min: 10,
        lunch_window_start: "12:00",
        lunch_window_end: "14:00",
        lunch_duration_min: 30,
        avg_speed_kmh: 60,
        appointments: [
          { id: "A1", type: "reseller", location: { label: "Revendeur Anderlecht", lat: 50.836, lon: 4.309 } },
          { id: "A2", type: "demo",     location: { label: "Client Uccle", lat: 50.803, lon: 4.331 } },
          { id: "A3", type: "training", location: { label: "Site Forest", lat: 50.811, lon: 4.319 } },

          { id: "A4", type: "reseller", location: { label: "Revendeur Ixelles", lat: 50.828, lon: 4.372 } },
          { id: "A5", type: "demo",     location: { label: "Client Etterbeek", lat: 50.835, lon: 4.392 } },

          { id: "A6", type: "training", location: { label: "Client Zaventem", lat: 50.885, lon: 4.470 } },
          { id: "A7", type: "reseller", location: { label: "Revendeur Vilvoorde", lat: 50.928, lon: 4.429 } },

          // petit saut plus loin (pour déclencher des différences de variantes)
          { id: "A8", type: "demo",     location: { label: "Client Mechelen", lat: 51.025, lon: 4.477 } },
          { id: "A9", type: "reseller", location: { label: "Revendeur Leuven", lat: 50.879, lon: 4.700 } },

          // Détour "gros" type Liège (rare mais réaliste)
          { id: "A10", type: "training", location: { label: "Formation Liège", lat: 50.633, lon: 5.567 } },

          // retour zone centre
          { id: "A11", type: "demo",     location: { label: "Client Wavre", lat: 50.716, lon: 4.612 } },
          { id: "A12", type: "reseller", location: { label: "Revendeur Waterloo", lat: 50.718, lon: 4.399 } },

          { id: "A13", type: "demo",     location: { label: "Client Nivelles", lat: 50.597, lon: 4.329 } },
          { id: "A14", type: "training", location: { label: "Client Charleroi", lat: 50.410, lon: 4.444 } },

          // un dernier “petit” pour tester la fin de journée
          { id: "A15", type: "reseller", location: { label: "Revendeur Halle", lat: 50.733, lon: 4.235 } },
        ],
      };

      setStatus("⏳ Test /suggest (journée réaliste)...");
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as SuggestResponse;
      setData(json);
      setSelected("best");
      setStatus(`✅ /suggest (journée réaliste) HTTP ${res.status}`);
    } catch (err: any) {
      setStatus(`❌ /suggest (journée réaliste) erreur: ${err?.message || String(err)}`);
    }
  }

  const chosen: Variant | null = useMemo(() => {
    if (!data) return null;
    if (selected === "best") return data.best;
    return data.variants.find((v) => v.name === selected) || data.best;
  }, [data, selected]);

  const variantNames = useMemo(() => {
    if (!data) return [];
    return ["best", ...data.variants.map((v) => v.name)];
  }, [data]);

  const agendaRows = useMemo(() => {
    if (!chosen) return [];
    const s = chosen.stops;

    return s.map((stop, i) => {
      const prev = i > 0 ? s[i - 1] : null;
      const gapMin = prev ? minutesBetween(prev.end, stop.start) : 0;

      return {
        stop,
        gapMin,
        start: hhmm(stop.start),
        end: hhmm(stop.end),
        badge: badge(stop.kind),
      };
    });
  }, [chosen]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Smart Slot Planner</h1>
      <p style={{ marginTop: 8, opacity: 0.8 }}>Assistant planning — version agenda</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <button onClick={testHealth} style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}>
          Tester /health
        </button>

        <button onClick={testSuggest} style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}>
          Tester /suggest
        </button>

        <button onClick={() => setShowDebug((x) => !x)} style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}>
          {showDebug ? "Masquer debug JSON" : "Afficher debug JSON"}
        </button>
      </div>

      <div
        style={{
          marginTop: 14,
          padding: 12,
          border: "1px solid #2b2b2b",
          borderRadius: 12,
          background: "#0b0b0b",
          color: "#eaeaea",
        }}
      >
        {status}
      </div>

      {!data || !chosen ? null : (
        <>
          {/* Selector */}
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {variantNames.map((name) => {
              const active = selected === name;
              const label = name === "best" ? `Recommandée (${data.best.name})` : name;

              return (
                <button
                  key={name}
                  onClick={() => setSelected(name)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    cursor: "pointer",
                    border: active ? "1px solid #fff" : "1px solid #333",
                    background: active ? "#111" : "#000",
                    color: "#fff",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Summary cards */}
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Score</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{chosen.analysis.score}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>/ 100</div>
            </div>

            <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Route totale</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{chosen.analysis.total_travel_min} min</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>estimation</div>
            </div>

            <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Temps mort</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{chosen.analysis.idle_min} min</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>hors route/buffer</div>
            </div>

            <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>RDV</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{chosen.analysis.planned_appointments} planifiés</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{chosen.analysis.unplanned_appointments} non planifiés</div>
            </div>
          </div>

          {/* Recommendations */}
          <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Recommandations</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {chosen.analysis.recommendations.map((r, idx) => (
                <li key={idx} style={{ marginBottom: 6 }}>
                  {r}
                </li>
              ))}
            </ul>
          </div>

          {/* Alerts */}
          {chosen.analysis.alerts && chosen.analysis.alerts.length ? (
            <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Alertes</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {chosen.analysis.alerts.map((a, idx) => (
                  <li key={idx} style={{ marginBottom: 10 }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: levelColor(a.level),
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        marginRight: 8,
                      }}
                    >
                      {a.level.toUpperCase()}
                    </span>
                    {a.message}
                    {a.impact ? (
                      <div style={{ opacity: 0.75, fontSize: 12, marginTop: 4 }}>Impact: {a.impact}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Agenda */}
          <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 14, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Planning (agenda)</div>

            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
              {agendaRows.map((row, idx) => (
                <div key={idx} style={{ display: "contents" }}>
                  <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                    <div style={{ fontWeight: 700 }}>{row.start}</div>
                    <div style={{ opacity: 0.7 }}>{row.end}</div>
                    {idx > 0 && row.gapMin > 0 ? (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>+{row.gapMin} min (gap)</div>
                    ) : null}
                  </div>

                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid #ddd",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: row.badge.bg,
                        color: "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        marginBottom: 8,
                      }}
                    >
                      {row.badge.t}
                    </div>

                    <div style={{ fontSize: 16, fontWeight: 700 }}>{row.stop.label}</div>

                    <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                      Route depuis précédent: {row.stop.travel_min_from_prev} min
                      {row.stop.kind === "appointment" && row.stop.id ? ` • ID: ${row.stop.id}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Debug JSON */}
          {showDebug ? (
            <pre
              style={{
                marginTop: 16,
                padding: 12,
                border: "1px solid #2b2b2b",
                borderRadius: 12,
                background: "#0b0b0b",
                color: "#eaeaea",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(data, null, 2)}
            </pre>
          ) : null}
        </>
      )}
    </main>
  );
}