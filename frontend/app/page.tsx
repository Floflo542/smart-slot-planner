"use client";

export default function Home() {
  async function testApi() {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL;
    const res = await fetch(`${base}/health`);
    const data = await res.json();
    alert(JSON.stringify(data));
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
    </main>
  );
}