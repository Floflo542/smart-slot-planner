"use client";

import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("Idle");
  const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  const base = rawBase.trim();
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;

  async function testApi() {
    try {
      if (!normalizedBase) {
        setStatus("❌ NEXT_PUBLIC_API_BASE_URL est NON DÉFINIE sur Vercel");
        return;
      }

      const url = `${normalizedBase}/health`;
      setStatus(`⏳ Test en cours… (${url})`);

      const res = await fetch(url, { cache: "no-store", mode: "cors" });
      const text = await res.text();

      setStatus(`✅ HTTP ${res.status} — ${text}`);
    } catch (err: any) {
      setStatus(`❌ Erreur: ${err?.message || String(err)}`);
    }
  }
