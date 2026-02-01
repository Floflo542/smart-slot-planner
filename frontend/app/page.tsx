"use client";

import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Idle");

  async function testApi() {
    try {
      const url = `/api/health`;
      setStatus(`⏳ Test en cours… (${url})`);

      const res = await fetch(url, { cache: "no-store" });
      const text = await res.text();

      setStatus(`✅ HTTP ${res.status} — ${text}`);
    } catch (err: any) {
      setStatus(`❌ Erreur: ${err?.message || String(err)}`);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Smart Slot Planner</h1>
      <p>Test connexion backend Railway</p>

      <button
        onClick={testApi}
        style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer" }}
      >
        Tester l’API
      </button>

      <pre
        style={{
          marginTop: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      >
        {status}
      </pre>
    </main>
  );
}
