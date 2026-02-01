"use client";

import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Idle");
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;

  async function testApi() {
    try {
      if (!base) {
        setStatus("❌ NEXT_PUBLIC_API_BASE_URL est NON DÉFINIE sur Vercel");
        return;
      }

      const url = `${base}/health`;
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

      <p>
        <b>API Base:</b> {base || "❌ NON DÉFINIE"}
      </p>

      <button
        onClick={testApi}
        style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer" }}
      >
        Tester l’API
      </button>

      <pre style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
        {status}
      </pre>
    </main>
  );
}