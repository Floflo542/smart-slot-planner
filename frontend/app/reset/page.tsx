"use client";

import { useState } from "react";

export default function ResetPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const token =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("token") || ""
      : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setMessage(json?.error || "Reset impossible.");
        return;
      }
      setMessage("Mot de passe mis a jour. Vous pouvez vous connecter.");
      setPassword("");
    } catch (err: any) {
      setMessage(err?.message || "Reset impossible.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page">
      <div className="topbar">
        <img className="logo" src="/unox-logo.png" alt="Unox" />
      </div>
      <header className="hero">
        <div className="eyebrow">Reinitialisation</div>
        <h1>Mot de passe</h1>
        <p>Choisissez un nouveau mot de passe pour votre compte.</p>
      </header>
      <section className="card">
        <div className="card-title">Nouveau mot de passe</div>
        {message ? <div className="status">{message}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" type="submit" disabled={loading}>
              Mettre a jour
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
