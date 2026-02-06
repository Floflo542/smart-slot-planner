"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DURATION_MIN = {
  training: 60,
  demo: 120,
  reseller: 60,
} as const;

const DEFAULT_HOME_ADDRESS = "Rue du Tram 7850 Enghien";
const DEFAULT_DAY_START = "07:30";
const DEFAULT_DAY_END = "16:30";
const DEFAULT_BUFFER_MIN = 10;
const DEFAULT_SEARCH_DAYS = 10;

type VisitType = keyof typeof DURATION_MIN;

type GeoPoint = {
  label: string;
  lat: number;
  lon: number;
};

type TokenBundle = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
};

type FixedEvent = {
  id: string;
  label: string;
  start: Date;
  end: Date;
  location: GeoPoint | null;
  locationLabel?: string | null;
};

type BestSlot = {
  start: Date;
  end: Date;
  travelFromPrev: number;
  travelToNext: number;
  prevLabel?: string;
  nextLabel?: string;
  notes: string[];
};

type FormState = {
  homeAddress: string;
  appointmentAddress: string;
  appointmentTitle: string;
  type: VisitType;
  durationMin: string;
  avgSpeedKmh: string;
  searchDays: string;
  includeWeekends: boolean;
  autoCreate: boolean;
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const OUTLOOK_SCOPES = "User.Read Calendars.ReadWrite offline_access";

const TOKEN_KEY = "ssp_outlook_tokens_v1";
const VERIFIER_KEY = "ssp_outlook_verifier_v1";
const STATE_KEY = "ssp_outlook_state_v1";

const OUTLOOK_TENANT = process.env.NEXT_PUBLIC_OUTLOOK_TENANT || "common";
const OUTLOOK_CLIENT_ID = process.env.NEXT_PUBLIC_OUTLOOK_CLIENT_ID || "";
const OUTLOOK_REDIRECT_URI = process.env.NEXT_PUBLIC_OUTLOOK_REDIRECT_URI || "";

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256(text: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseDateTime(dateStr: string, timeStr: string) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function toLocalIso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

function formatHHMM(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}

function clampDate(date: Date, min: Date, max: Date) {
  return new Date(Math.max(min.getTime(), Math.min(max.getTime(), date.getTime())));
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildDateCandidates(days: number, includeWeekends: boolean) {
  const result: Date[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (result.length < days) {
    const day = cursor.getDay();
    const isWeekend = day === 0 || day === 6;
    if (includeWeekends || !isWeekend) {
      result.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

function haversineKm(a: GeoPoint, b: GeoPoint) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function travelMinutes(
  a: GeoPoint | null,
  b: GeoPoint | null,
  avgSpeedKmh: number
) {
  if (!a || !b) return 0;
  const km = haversineKm(a, b);
  const hours = km / Math.max(avgSpeedKmh, 5);
  return Math.max(1, Math.round(hours * 60));
}

function isOnlineLocation(label: string) {
  const lower = label.toLowerCase();
  return [
    "teams",
    "zoom",
    "google meet",
    "meet.google",
    "webex",
    "online",
    "visioconference",
  ].some((token) => lower.includes(token));
}

function loadTokens(): TokenBundle | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TokenBundle;
  } catch {
    return null;
  }
}

function saveTokens(tokens: TokenBundle) {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function clearTokens() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function mergeBusyEvents(events: FixedEvent[]) {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: FixedEvent[] = [];

  for (const evt of sorted) {
    const last = merged[merged.length - 1];
    if (!last || evt.start.getTime() > last.end.getTime()) {
      merged.push({ ...evt });
      continue;
    }

    if (evt.end.getTime() > last.end.getTime()) {
      last.end = evt.end;
    }

    if (last.label !== evt.label) {
      last.label = `${last.label} / ${evt.label}`;
    }

    last.location = null;
    last.locationLabel = null;
  }

  return merged;
}

function findBestSlot(params: {
  dayStart: Date;
  dayEnd: Date;
  home: GeoPoint;
  appointment: GeoPoint;
  durationMin: number;
  bufferMin: number;
  avgSpeedKmh: number;
  fixed: FixedEvent[];
}) {
  const timeline = [
    {
      id: "day-start",
      label: "Départ",
      start: params.dayStart,
      end: params.dayStart,
      location: params.home,
    },
    ...mergeBusyEvents(params.fixed),
    {
      id: "day-end",
      label: "Fin",
      start: params.dayEnd,
      end: params.dayEnd,
      location: params.home,
    },
  ];

  const notes: string[] = [];
  let best: BestSlot | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let i = 0; i < timeline.length - 1; i += 1) {
    const prev = timeline[i];
    const next = timeline[i + 1];

    const prevBuffer = prev.id === "day-start" ? 0 : params.bufferMin;
    const nextBuffer = params.bufferMin;

    const travelFromPrev = travelMinutes(prev.location ?? null, params.appointment, params.avgSpeedKmh);
    const travelToNext = travelMinutes(params.appointment, next.location ?? null, params.avgSpeedKmh);

    const earliest = addMinutes(prev.end, prevBuffer + travelFromPrev);
    const latest = addMinutes(
      next.start,
      -1 * (nextBuffer + travelToNext + params.durationMin)
    );

    if (earliest.getTime() > latest.getTime()) {
      continue;
    }

    const candidateStart = earliest;
    const candidateEnd = addMinutes(candidateStart, params.durationMin);
    const cost = travelFromPrev + travelToNext;

    if (cost < bestCost || (cost === bestCost && (!best || candidateStart < best.start))) {
      bestCost = cost;
      best = {
        start: candidateStart,
        end: candidateEnd,
        travelFromPrev,
        travelToNext,
        prevLabel: prev.label,
        nextLabel: next.label,
        notes,
      };
    }
  }

  return best;
}

export default function Home() {
  const [status, setStatus] = useState("Prêt.");
  const [outlookConnected, setOutlookConnected] = useState(false);
  const [outlookUser, setOutlookUser] = useState<string | null>(null);
  const [result, setResult] = useState<BestSlot | null>(null);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    homeAddress: DEFAULT_HOME_ADDRESS,
    appointmentAddress: "",
    appointmentTitle: "",
    type: "demo",
    durationMin: "",
    avgSpeedKmh: "60",
    searchDays: String(DEFAULT_SEARCH_DAYS),
    includeWeekends: false,
    autoCreate: true,
  });

  const geocodeCache = useRef(new Map<string, GeoPoint | null>());

  const hasOutlookConfig = Boolean(OUTLOOK_CLIENT_ID && OUTLOOK_REDIRECT_URI);
  const connectDisabled = !hasOutlookConfig;
  const authority = `https://login.microsoftonline.com/${OUTLOOK_TENANT}/oauth2/v2.0`;

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const error = params.get("error");
      const errorDescription = params.get("error_description");
      const code = params.get("code");
      const state = params.get("state");

      if (error) {
        setStatus(`Erreur Outlook: ${errorDescription || error}`);
      }

      if (code) {
        try {
          await exchangeCodeForToken(code, state);
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err: any) {
          setStatus(`Erreur auth Outlook: ${err?.message || String(err)}`);
        }
      }

      const token = await getAccessToken();
      if (token) {
        setOutlookConnected(true);
        await fetchProfile(token);
      }
    };

    run();
  }, []);

  async function exchangeCodeForToken(code: string, state?: string | null) {
    if (!hasOutlookConfig) {
      throw new Error("Configuration Outlook manquante");
    }

    const storedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);

    if (!verifier) {
      throw new Error("Code verifier introuvable. Relancer la connexion.");
    }

    if (state && storedState && state !== storedState) {
      throw new Error("État OAuth invalide.");
    }

    const body = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: OUTLOOK_REDIRECT_URI,
      code_verifier: verifier,
      scope: OUTLOOK_SCOPES,
    });

    const res = await fetch(`${authority}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error_description || "Erreur de token OAuth");
    }

    const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 - 30000;
    saveTokens({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: expiresAt,
      scope: json.scope,
    });

    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
  }

  async function refreshAccessToken(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: OUTLOOK_SCOPES,
    });

    const res = await fetch(`${authority}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error_description || "Erreur de refresh token");
    }

    const expiresAt = Date.now() + (json.expires_in ?? 3600) * 1000 - 30000;
    const updated: TokenBundle = {
      access_token: json.access_token,
      refresh_token: json.refresh_token || refreshToken,
      expires_at: expiresAt,
      scope: json.scope,
    };
    saveTokens(updated);
    return updated.access_token;
  }

  async function getAccessToken() {
    const tokens = loadTokens();
    if (!tokens) return null;

    if (tokens.expires_at > Date.now()) {
      return tokens.access_token;
    }

    if (tokens.refresh_token) {
      try {
        return await refreshAccessToken(tokens.refresh_token);
      } catch {
        clearTokens();
        return null;
      }
    }

    return null;
  }

  async function fetchProfile(token: string) {
    try {
      const res = await fetch(`${GRAPH_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      const name = json.mail || json.userPrincipalName || json.displayName;
      if (name) setOutlookUser(name);
    } catch {
      // silent
    }
  }

  async function startOutlookLogin() {
    if (!hasOutlookConfig) {
      setStatus("Configurez les variables Outlook sur Vercel.");
      return;
    }

    const verifier = randomBase64Url(64);
    const challenge = await sha256(verifier);
    const state = randomBase64Url(16);

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
      client_id: OUTLOOK_CLIENT_ID,
      response_type: "code",
      redirect_uri: OUTLOOK_REDIRECT_URI,
      response_mode: "query",
      scope: OUTLOOK_SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });

    window.location.href = `${authority}/authorize?${params.toString()}`;
  }

  function disconnectOutlook() {
    clearTokens();
    setOutlookConnected(false);
    setOutlookUser(null);
    setStatus("Déconnecté d'Outlook.");
  }

  async function geocodeAddress(label: string): Promise<GeoPoint> {
    const cached = geocodeCache.current.get(label);
    if (cached) return cached;
    if (cached === null) {
      throw new Error("Adresse introuvable");
    }

    const res = await fetch(`/api/geocode?q=${encodeURIComponent(label)}`);
    const json = await res.json();

    if (!res.ok || !json?.ok) {
      geocodeCache.current.set(label, null);
      throw new Error(json?.error || "Adresse introuvable");
    }

    const point: GeoPoint = {
      label: json.label || label,
      lat: json.lat,
      lon: json.lon,
    };

    geocodeCache.current.set(label, point);
    return point;
  }

  async function fetchCalendarEvents(token: string, dayStart: Date, dayEnd: Date) {
    let url = `${GRAPH_BASE}/me/calendarView?startDateTime=${encodeURIComponent(
      dayStart.toISOString()
    )}&endDateTime=${encodeURIComponent(dayEnd.toISOString())}&$top=50`;
    const all: any[] = [];

    while (url) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: `outlook.timezone="${timezone}"`,
        },
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || "Erreur de lecture calendrier");
      }

      all.push(...(json.value || []));
      url = json["@odata.nextLink"] || "";
    }

    return all;
  }

  async function buildFixedEvents(
    rawEvents: any[],
    dayStart: Date,
    dayEnd: Date
  ) {
    const fixed: FixedEvent[] = [];

    for (const evt of rawEvents) {
      if (evt.isCancelled) continue;
      if (evt.showAs && evt.showAs === "free") continue;

      const isAllDay = Boolean(evt.isAllDay);
      const rawStart = evt.start?.dateTime;
      const rawEnd = evt.end?.dateTime;
      if (!rawStart || !rawEnd) continue;

      const start = isAllDay ? dayStart : new Date(rawStart);
      const end = isAllDay ? dayEnd : new Date(rawEnd);

      const clampedStart = clampDate(start, dayStart, dayEnd);
      const clampedEnd = clampDate(end, dayStart, dayEnd);

      if (clampedEnd.getTime() <= clampedStart.getTime()) continue;

      let location: GeoPoint | null = null;
      const label = evt.subject || "RDV";
      const locationLabel =
        evt.location?.displayName || evt.locations?.[0]?.displayName || "";

      if (locationLabel && !isOnlineLocation(locationLabel)) {
        try {
          location = await geocodeAddress(locationLabel);
        } catch {
          location = null;
        }
      }

      fixed.push({
        id: evt.id || `${label}-${rawStart}`,
        label,
        start: clampedStart,
        end: clampedEnd,
        location,
        locationLabel: locationLabel || null,
      });
    }

    return fixed;
  }

  async function createOutlookEvent(
    token: string,
    payload: {
      subject: string;
      start: Date;
      end: Date;
      location: string;
      body?: string;
    }
  ) {
    const res = await fetch(`${GRAPH_BASE}/me/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: payload.subject,
        start: {
          dateTime: toLocalIso(payload.start),
          timeZone: timezone,
        },
        end: {
          dateTime: toLocalIso(payload.end),
          timeZone: timezone,
        },
        location: {
          displayName: payload.location,
        },
        body: payload.body
          ? {
              contentType: "text",
              content: payload.body,
            }
          : undefined,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error?.message || "Erreur de création du RDV");
    }

    return json;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Analyse du meilleur créneau...");
    setResult(null);
    setCreatedEventId(null);

    if (!outlookConnected) {
      setStatus("Connectez Outlook avant de planifier.");
      return;
    }

    if (!form.homeAddress.trim()) {
      setStatus("Adresse de départ manquante.");
      return;
    }

    if (!form.appointmentAddress.trim()) {
      setStatus("Adresse du RDV manquante.");
      return;
    }

    const durationMin = form.durationMin
      ? Number.parseInt(form.durationMin, 10)
      : DURATION_MIN[form.type];

    if (!Number.isFinite(durationMin) || durationMin <= 0) {
      setStatus("Durée invalide.");
      return;
    }

    const bufferMin = DEFAULT_BUFFER_MIN;
    const avgSpeedKmh = Number.parseFloat(form.avgSpeedKmh) || 60;
    const searchDaysRaw = Number.parseInt(form.searchDays, 10);
    const searchDays =
      Number.isFinite(searchDaysRaw) && searchDaysRaw > 0
        ? searchDaysRaw
        : DEFAULT_SEARCH_DAYS;
    const windowLabel = form.includeWeekends ? "jours" : "jours ouvres";
    setStatus(`Analyse des ${searchDays} prochains ${windowLabel}...`);

    try {
      const token = await getAccessToken();
      if (!token) {
        setStatus("Token Outlook expiré. Reconnectez-vous.");
        setOutlookConnected(false);
        return;
      }

      const home = await geocodeAddress(form.homeAddress.trim());
      const appointment = await geocodeAddress(form.appointmentAddress.trim());

      const now = new Date();
      const candidates = buildDateCandidates(searchDays, form.includeWeekends);

      let chosen:
        | { slot: BestSlot; missingLocations: number }
        | null = null;
      let bestCost = Number.POSITIVE_INFINITY;

      for (const day of candidates) {
        const dateStr = localDateString(day);
        let dayStart = parseDateTime(dateStr, DEFAULT_DAY_START);
        const dayEnd = parseDateTime(dateStr, DEFAULT_DAY_END);

        if (isSameDay(day, now) && now.getTime() > dayStart.getTime()) {
          dayStart = new Date(Math.min(now.getTime(), dayEnd.getTime()));
        }

        if (dayEnd.getTime() <= dayStart.getTime()) {
          continue;
        }

        const events = await fetchCalendarEvents(token, dayStart, dayEnd);
        const fixed = await buildFixedEvents(events, dayStart, dayEnd);

        const best = findBestSlot({
          dayStart,
          dayEnd,
          home,
          appointment,
          durationMin,
          bufferMin,
          avgSpeedKmh,
          fixed,
        });

        if (!best) {
          continue;
        }

        const missingLocations = fixed.filter(
          (evt) => evt.locationLabel && !evt.location
        ).length;
        const travelCost = best.travelFromPrev + best.travelToNext;

        if (
          !chosen ||
          travelCost < bestCost ||
          (travelCost === bestCost && best.start < chosen.slot.start)
        ) {
          bestCost = travelCost;
          chosen = { slot: best, missingLocations };
        }
      }

      if (!chosen) {
        setStatus(
          `Aucun creneau disponible sur les ${searchDays} prochains ${windowLabel}.`
        );
        return;
      }

      const notes: string[] = [...chosen.slot.notes];
      if (chosen.missingLocations > 0) {
        notes.push(
          `${chosen.missingLocations} RDV Outlook sans geocodage: trajets estimes a 0 min.`
        );
      }

      const enrichedBest: BestSlot = { ...chosen.slot, notes };
      setResult(enrichedBest);

      const subject =
        form.appointmentTitle.trim() ||
        `${form.type.toUpperCase()} — ${form.appointmentAddress.trim()}`;

      if (form.autoCreate) {
        const created = await createOutlookEvent(token, {
          subject,
          start: enrichedBest.start,
          end: enrichedBest.end,
          location: form.appointmentAddress.trim(),
          body: `Type: ${form.type}\nAdresse: ${form.appointmentAddress.trim()}\nTrajet estimé: ${enrichedBest.travelFromPrev} min (aller) / ${enrichedBest.travelToNext} min (retour).`,
        });

        setCreatedEventId(created?.id || null);
        setStatus(
          `RDV cree dans Outlook le ${formatDateLabel(
            enrichedBest.start
          )} : ${formatHHMM(enrichedBest.start)} - ${formatHHMM(
            enrichedBest.end
          )}`
        );
      } else {
        setStatus(
          `Creneau recommande le ${formatDateLabel(
            enrichedBest.start
          )} : ${formatHHMM(enrichedBest.start)} - ${formatHHMM(
            enrichedBest.end
          )}`
        );
      }
    } catch (err: any) {
      setStatus(`Erreur: ${err?.message || String(err)}`);
    }
  }

  return (
    <main className="page">
      <div className="topbar">
        <img className="logo" src="/unox-logo.png" alt="Unox" />
      </div>
      <header className="hero">
        <div className="eyebrow">Planification + Outlook</div>
        <h1>Smart Slot Planner</h1>
        <p>
          Connectez Outlook, saisissez l'adresse du prochain RDV et laissez le
          planner proposer le meilleur créneau avec ajout automatique.
        </p>
      </header>

      <section className="card">
        <div className="card-title">Connexion Outlook</div>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="badge">
            {outlookConnected
              ? `Connecté${outlookUser ? ` · ${outlookUser}` : ""}`
              : "Non connecté"}
          </span>
          {!hasOutlookConfig ? (
            <span className="small">
              Renseignez NEXT_PUBLIC_OUTLOOK_CLIENT_ID et
              NEXT_PUBLIC_OUTLOOK_REDIRECT_URI sur Vercel.
            </span>
          ) : null}
        </div>
        <div className="row">
          <button
            className="btn primary"
            type="button"
            onClick={startOutlookLogin}
            disabled={connectDisabled}
            title={
              connectDisabled
                ? "Configurez NEXT_PUBLIC_OUTLOOK_CLIENT_ID et NEXT_PUBLIC_OUTLOOK_REDIRECT_URI"
                : ""
            }
          >
            Connecter Outlook
          </button>
          <button className="btn ghost" type="button" onClick={disconnectOutlook}>
            Déconnecter
          </button>
        </div>
        <p className="small" style={{ marginTop: 10 }}>
          Permissions demandées: lecture/écriture du calendrier et profil utilisateur.
        </p>
      </section>

      <section className="card">
        <div className="card-title">Nouveau RDV</div>
        <form onSubmit={handleSubmit}>
          <div className="row" style={{ marginBottom: 12 }}>
            <span className="badge">
              Journee: {DEFAULT_DAY_START} - {DEFAULT_DAY_END}
            </span>
            <span className="badge">Buffer: {DEFAULT_BUFFER_MIN} min</span>
          </div>
          <div className="grid">
            <div className="field">
              <label>Type</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as VisitType })
                }
              >
                <option value="demo">Demo</option>
                <option value="training">Training</option>
                <option value="reseller">Reseller</option>
              </select>
            </div>
            <div className="field">
              <label>Duree (min)</label>
              <input
                type="number"
                min={15}
                placeholder={`${DURATION_MIN[form.type]}`}
                value={form.durationMin}
                onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Adresse de depart</label>
              <input
                type="text"
                placeholder="Votre base / maison"
                value={form.homeAddress}
                onChange={(e) => setForm({ ...form, homeAddress: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Adresse du RDV</label>
              <input
                type="text"
                placeholder="Adresse complète"
                value={form.appointmentAddress}
                onChange={(e) =>
                  setForm({ ...form, appointmentAddress: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Titre (optionnel)</label>
              <input
                type="text"
                placeholder="Nom client / sujet"
                value={form.appointmentTitle}
                onChange={(e) =>
                  setForm({ ...form, appointmentTitle: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Vitesse moyenne (km/h)</label>
              <input
                type="number"
                min={5}
                value={form.avgSpeedKmh}
                onChange={(e) => setForm({ ...form, avgSpeedKmh: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Jours a analyser</label>
              <input
                type="number"
                min={1}
                value={form.searchDays}
                onChange={(e) => setForm({ ...form, searchDays: e.target.value })}
              />
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <label
              className="inline"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={form.includeWeekends}
                onChange={(e) =>
                  setForm({ ...form, includeWeekends: e.target.checked })
                }
              />
              Inclure le week-end
            </label>
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <label
              className="inline"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <input
                type="checkbox"
                checked={form.autoCreate}
                onChange={(e) =>
                  setForm({ ...form, autoCreate: e.target.checked })
                }
              />
              Ajouter automatiquement dans Outlook
            </label>
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" type="submit">
              Trouver le meilleur créneau
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-title">Statut</div>
        <div className="status">{status}</div>
      </section>

      {result ? (
        <section className="card">
          <div className="card-title">Créneau recommandé</div>
          <div className="result-grid">
            <div className="result-card">
              <div className="small">Date recommandee</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {formatDateLabel(result.start)}
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                Heure proposee
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {formatHHMM(result.start)} - {formatHHMM(result.end)}
              </div>
              <div className="small">Fuseau: {timezone}</div>
            </div>
            <div className="result-card">
              <div className="small">Trajet estimé</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {result.travelFromPrev} min depuis {result.prevLabel || "départ"}
              </div>
              <div className="small">
                {result.travelToNext} min vers {result.nextLabel || "fin"}
              </div>
            </div>
            <div className="result-card">
              <div className="small">Ajout Outlook</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>
                {createdEventId ? "Créé" : form.autoCreate ? "En attente" : "Non créé"}
              </div>
              {createdEventId ? (
                <div className="small">ID: {createdEventId}</div>
              ) : null}
            </div>
          </div>
          {result.notes.length ? (
            <ul className="note-list">
              {result.notes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
