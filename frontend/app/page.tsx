"use client";

import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Idle");

  async function testHealth() {
    try {
      const url = `/api/health`;
      setStatus(`⏳ Test en cours… (${url})`);

      const res = await fetch(url, { cache: "no-store" });
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
          {
            id: "A1",
            type: "demo",
            location: { label: "Client 1", lat: 50.83, lon: 4.37 },
          },
          {
            id: "A2",
            type: "training",
            location: { label: "Client 2", lat: 50.88, lon: 4.30 },
          },
        ],
      };

      setStatus(`⏳ Test /suggest en cours…\n${JSON.stringify(payload, null, 2)}`);

      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      setStatus(`✅ /suggest HTTP ${res.status}\n${text}`);
    } catch (err: any) {
      setStatus(`❌ /suggest erreur: ${err?.message || String(err)}`);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Smart Slot Planner</h1>
      <p>Tests API (via proxy Vercel)</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={testHealth}
          style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer" }}
        >
          Tester /health
        </button>

        <button
          onClick={testSuggest}
          style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer" }}
        >
          Tester /suggest
        </button>
      </div>

      <pre
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {status}
      </pre>
    </main>
  );
}
