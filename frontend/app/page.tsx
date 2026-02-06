"use client";

import { useMemo, useRef, useState } from "react";

const DURATION_MIN = {
  training: 60,
  demo: 120,
  reseller: 60,
} as const;

const DEFAULT_HOME_ADDRESS = "Rue du Tram, 7850 Enghien, Belgique";
const DEFAULT_HOME_COORDS = { lat: 50.695, lon: 4.04 };
const DEFAULT_DAY_START = "07:30";
const DEFAULT_DAY_END = "16:30";
const DEFAULT_BUFFER_MIN = 10;
const DEFAULT_AVG_SPEED_KMH = 60;
const DEFAULT_SEARCH_DAYS = 10;

function normalizeLocationKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOCATION_OVERRIDES: Record<string, string> = {
  "depot speed pro michael mainville":
    "Grand'Route 202, 4347 Fexhe-le-Haut-Clocher, Belgique",
};
const SUMMARY_LOCATION_OVERRIDES: Record<string, string> = {
  "depot speed pro michael mainville":
    "Grand'Route 202, 4347 Fexhe-le-Haut-Clocher, Belgique",
};

function resolveEventLocationLabel(event: IcsEvent) {
  const locationRaw = event.location?.trim() || "";
  const summaryRaw = event.summary?.trim() || "";
  const summaryKey = normalizeLocationKey(summaryRaw);
  let summaryOverride = SUMMARY_LOCATION_OVERRIDES[summaryKey] || "";
  if (!summaryOverride) {
    for (const key of Object.keys(SUMMARY_LOCATION_OVERRIDES)) {
      if (summaryKey.includes(key)) {
        summaryOverride = SUMMARY_LOCATION_OVERRIDES[key];
        break;
      }
    }
  }
  const base = locationRaw || summaryOverride;
  if (!base) return "";
  return LOCATION_OVERRIDES[normalizeLocationKey(base)] || base;
}

const MAX_GEOCODE_LOCATIONS = Number.POSITIVE_INFINITY;
const COMMERCIALS = [
  {
    name: "Florian Monoyer",
    icsUrl:
      "https://outlook.office365.com/owa/calendar/df8485983c5d4b38b8bbf8800a546eec@unox.com/9d9e207ca6414d4ca8be7c0f3070313715591987231137818096/calendar.ics",
  },
] as const;

type VisitType = keyof typeof DURATION_MIN;
type Commercial = (typeof COMMERCIALS)[number]["name"];

type GeoPoint = {
  label: string;
  lat: number;
  lon: number;
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

type IcsPayload = {
  summary: string;
  location: string;
  description: string;
};

type IcsEvent = {
  summary: string;
  location: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
};

type FormState = {
  commercial: Commercial;
  appointmentAddress: string;
  appointmentTitle: string;
  type: VisitType;
  durationMin: string;
  searchDays: string;
  includeWeekends: boolean;
  optimizeMode: "travel" | "earliest";
};

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseDateTime(dateStr: string, timeStr: string) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function formatHHMM(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatIcsDate(date: Date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function parseIcsDate(value: string, isDateOnly: boolean) {
  if (isDateOnly) {
    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(4, 6), 10) - 1;
    const day = Number.parseInt(value.slice(6, 8), 10);
    return new Date(year, month, day, 0, 0, 0);
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/
  );
  if (!match) {
    return new Date(value);
  }

  const [, y, m, d, hh, mm, ss, zulu] = match;
  const year = Number.parseInt(y, 10);
  const month = Number.parseInt(m, 10) - 1;
  const day = Number.parseInt(d, 10);
  const hour = Number.parseInt(hh, 10);
  const min = Number.parseInt(mm, 10);
  const sec = Number.parseInt(ss || "0", 10);

  if (zulu) {
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }
  return new Date(year, month, day, hour, min, sec);
}

function parseIcsDuration(value: string) {
  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );
  if (!match) return null;
  const days = Number.parseInt(match[1] || "0", 10);
  const hours = Number.parseInt(match[2] || "0", 10);
  const minutes = Number.parseInt(match[3] || "0", 10);
  const seconds = Number.parseInt(match[4] || "0", 10);
  const totalMs =
    (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
  return Number.isFinite(totalMs) && totalMs > 0 ? totalMs : null;
}

function parseFreeBusyRanges(value: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  const ranges = value.split(",");
  for (const range of ranges) {
    const [startRaw, endRaw] = range.split("/");
    if (!startRaw || !endRaw) continue;
    const isDateOnly = startRaw.length === 8 && endRaw.length === 8;
    const start = parseIcsDate(startRaw, isDateOnly);
    let end: Date | null = null;
    if (endRaw.startsWith("P")) {
      const durationMs = parseIcsDuration(endRaw);
      if (durationMs) {
        end = new Date(start.getTime() + durationMs);
      }
    } else {
      end = parseIcsDate(endRaw, isDateOnly);
    }
    if (!end) continue;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end.getTime() <= start.getTime()) continue;
    out.push({
      summary: "Busy",
      location: "",
      start,
      end,
      isAllDay: isDateOnly,
    });
  }
  return out;
}

function parseIcsEvents(text: string): IcsEvent[] {
  const rawLines = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  for (const line of rawLines) {
    if (!line) continue;
    if (line.startsWith(" ") || line.startsWith("\t")) {
      const prev = lines[lines.length - 1] || "";
      lines[lines.length - 1] = prev + line.trim();
    } else {
      lines.push(line.trim());
    }
  }

  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;
  let currentAllDay = false;
  let inFreeBusy = false;
  let currentDurationMs: number | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = {};
      currentAllDay = false;
      currentDurationMs = null;
      inFreeBusy = false;
      continue;
    }
    if (upper === "BEGIN:VFREEBUSY") {
      current = null;
      inFreeBusy = true;
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current?.start && !current.end && currentDurationMs) {
        current.end = new Date(current.start.getTime() + currentDurationMs);
      }
      if (current?.start && current.end) {
        events.push({
          summary: current.summary || "RDV",
          location: current.location || "",
          start: current.start,
          end: current.end,
          isAllDay: currentAllDay,
        });
      }
      current = null;
      currentDurationMs = null;
      continue;
    }
    if (upper === "END:VFREEBUSY") {
      inFreeBusy = false;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const left = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const [rawProp, ...paramParts] = left.split(";");
    const prop = rawProp.toUpperCase();
    const params = paramParts.join(";").toUpperCase();

    if (prop === "FREEBUSY") {
      events.push(...parseFreeBusyRanges(value));
      continue;
    }

    if (!current) continue;

    if (prop === "SUMMARY") {
      current.summary = value;
    } else if (prop === "LOCATION") {
      current.location = value;
    } else if (prop === "DTSTART") {
      const isDateOnly = params.includes("VALUE=DATE") || value.length === 8;
      current.start = parseIcsDate(value, isDateOnly);
      currentAllDay = isDateOnly;
    } else if (prop === "DTEND") {
      const isDateOnly = params.includes("VALUE=DATE") || value.length === 8;
      current.end = parseIcsDate(value, isDateOnly);
    } else if (prop === "DURATION") {
      currentDurationMs = parseIcsDuration(value);
    }
  }

  return events;
}

function parseIcsEventsFallback(text: string): IcsEvent[] {
  const unfolded = text.replace(/\r/g, "").replace(/\n[ \t]/g, "");
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const events: IcsEvent[] = [];

  const extractProp = (body: string, prop: string) => {
    const regex = new RegExp(`^${prop}[^:]*:(.*)$`, "im");
    const match = body.match(regex);
    return match ? match[1].trim() : "";
  };

  for (const block of blocks) {
    const endIdx = block.search(/END:VEVENT/i);
    if (endIdx === -1) continue;
    const body = block.slice(0, endIdx);

    const summary = extractProp(body, "SUMMARY");
    const location = extractProp(body, "LOCATION");
    const dtstart = extractProp(body, "DTSTART");
    const dtend = extractProp(body, "DTEND");
    const duration = extractProp(body, "DURATION");

    if (!dtstart) continue;
    const isDateOnly = dtstart.length === 8;
    const start = parseIcsDate(dtstart, isDateOnly);
    if (Number.isNaN(start.getTime())) continue;

    let end: Date | null = null;
    if (dtend) {
      end = parseIcsDate(dtend, dtend.length === 8);
    } else if (duration) {
      const durationMs = parseIcsDuration(duration);
      if (durationMs) {
        end = new Date(start.getTime() + durationMs);
      }
    }

    if (!end || Number.isNaN(end.getTime())) continue;
    if (end.getTime() <= start.getTime()) continue;

    events.push({
      summary: summary || "RDV",
      location: location || "",
      start,
      end,
      isAllDay: isDateOnly,
    });
  }

  return events;
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function buildIcsEvent(params: {
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
}) {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@smart-slot-planner`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Slot Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(params.start)}`,
    `DTEND:${formatIcsDate(params.end)}`,
    `SUMMARY:${escapeIcsText(params.summary)}`,
    `LOCATION:${escapeIcsText(params.location)}`,
    `DESCRIPTION:${escapeIcsText(params.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function downloadIcsFile(slot: BestSlot, payload: IcsPayload) {
  const ics = buildIcsEvent({
    start: slot.start,
    end: slot.end,
    summary: payload.summary,
    location: payload.location,
    description: payload.description,
  });

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStamp = localDateString(slot.start);
  a.href = url;
  a.download = `rdv-${dateStamp}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

function roundToMinutes(date: Date, step: number) {
  const ms = step * 60 * 1000;
  return new Date(Math.round(date.getTime() / ms) * ms);
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

async function findBestSlot(params: {
  dayStart: Date;
  dayEnd: Date;
  home: GeoPoint;
  appointment: GeoPoint;
  durationMin: number;
  bufferMin: number;
  fixed: FixedEvent[];
  travelMinutesFn: (
    a: GeoPoint | null,
    b: GeoPoint | null,
    departAt: Date
  ) => Promise<number>;
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

    const departFromPrev = addMinutes(prev.end, prevBuffer);
    const travelFromPrev = await params.travelMinutesFn(
      prev.location ?? null,
      params.appointment,
      departFromPrev
    );

    const candidateStart = addMinutes(departFromPrev, travelFromPrev);
    const candidateEnd = addMinutes(candidateStart, params.durationMin);

    const travelToNext = await params.travelMinutesFn(
      params.appointment,
      next.location ?? null,
      candidateEnd
    );
    const arrivesNext = addMinutes(candidateEnd, travelToNext + nextBuffer);

    if (arrivesNext.getTime() > next.start.getTime()) {
      continue;
    }
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
  const [result, setResult] = useState<BestSlot | null>(null);
  const [icsPayload, setIcsPayload] = useState<IcsPayload | null>(null);

  const [form, setForm] = useState<FormState>({
    commercial: "Florian Monoyer",
    appointmentAddress: "",
    appointmentTitle: "",
    type: "demo",
    durationMin: "",
    searchDays: String(DEFAULT_SEARCH_DAYS),
    includeWeekends: false,
    optimizeMode: "travel",
  });

  const geocodeCache = useRef(new Map<string, GeoPoint | null>());
  const routeCache = useRef(new Map<string, number>());

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    []
  );
  const commercialIcsUrl =
    COMMERCIALS.find((item) => item.name === form.commercial)?.icsUrl || "";

  const travelMinutesWithTraffic = async (
    a: GeoPoint | null,
    b: GeoPoint | null,
    departAt: Date
  ) => {
    if (!a || !b) return 0;
    const bucket = roundToMinutes(departAt, 5).toISOString();
    const key = `${a.lat},${a.lon}|${b.lat},${b.lon}|${bucket}`;
    const cached = routeCache.current.get(key);
    if (cached !== undefined) return cached;

    try {
      const res = await fetch(
        `/api/route?from=${encodeURIComponent(
          `${a.lat},${a.lon}`
        )}&to=${encodeURIComponent(`${b.lat},${b.lon}`)}&depart_at=${encodeURIComponent(
          departAt.toISOString()
        )}`
      );
      const json = await res.json();
      if (res.ok && json?.ok && Number.isFinite(json.duration_min)) {
        const minutes = Math.max(1, Math.round(json.duration_min));
        routeCache.current.set(key, minutes);
        return minutes;
      }
    } catch {
      // ignore and fallback below
    }

    const fallback = travelMinutes(a, b, DEFAULT_AVG_SPEED_KMH);
    routeCache.current.set(key, fallback);
    return fallback;
  };

async function geocodeAddress(label: string): Promise<GeoPoint> {
    const trimmed = label.trim();
    const cached = geocodeCache.current.get(trimmed);
    if (cached) return cached;
    if (cached === null) {
      throw new Error("Adresse introuvable");
    }

    const attempts = new Set<string>();
    const addAttempt = (value: string) => {
      const candidate = value.trim();
      if (candidate) attempts.add(candidate);
    };

    addAttempt(trimmed);

    const withCommaPostal = trimmed.replace(
      /(\S)\s+(\d{4})\s+/,
      "$1, $2 "
    );
    addAttempt(withCommaPostal);

    const hasCountry = /belgique|belgium/i.test(trimmed);
    if (!hasCountry) {
      addAttempt(`${withCommaPostal}, Belgique`);
      addAttempt(`${trimmed}, Belgique`);
    }

    const postalMatch = trimmed.match(/(\d{4})\s+(.+)/);
    if (postalMatch) {
      addAttempt(`${postalMatch[1]} ${postalMatch[2]}, Belgique`);
    }

    for (const query of attempts) {
      const cachedQuery = geocodeCache.current.get(query);
      if (cachedQuery) {
        geocodeCache.current.set(trimmed, cachedQuery);
        return cachedQuery;
      }
      if (cachedQuery === null) {
        continue;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeout);
      if (!res) {
        geocodeCache.current.set(query, null);
        continue;
      }
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        geocodeCache.current.set(query, null);
        continue;
      }

      const point: GeoPoint = {
        label: json.label || query,
        lat: json.lat,
        lon: json.lon,
      };

      geocodeCache.current.set(query, point);
      geocodeCache.current.set(trimmed, point);
      return point;
    }

    geocodeCache.current.set(trimmed, null);
    throw new Error("Adresse introuvable");
  }

  async function preloadIcsLocations(events: IcsEvent[]) {
    const unique = Array.from(
      new Set(
        events
          .map((evt) => resolveEventLocationLabel(evt))
          .filter((loc) => loc && !isOnlineLocation(loc))
      )
    );

    const limited = unique.slice(0, MAX_GEOCODE_LOCATIONS);
    const skipped = Math.max(0, unique.length - limited.length);
    const locationMap = new Map<string, GeoPoint | null>();

    let done = 0;
    for (const loc of limited) {
      done += 1;
      setStatus(`Geocodage des RDV existants (${done}/${limited.length})...`);
      try {
        const point = await geocodeAddress(loc);
        locationMap.set(loc, point);
      } catch {
        locationMap.set(loc, null);
      }
    }

    return { locationMap, skipped };
  }

  function filterIcsEventsForDay(
    events: IcsEvent[],
    dayStart: Date,
    dayEnd: Date
  ) {
    return events.filter((evt) => {
      if (evt.isAllDay) {
        return evt.start <= dayEnd && evt.end >= dayStart;
      }
      return evt.end > dayStart && evt.start < dayEnd;
    });
  }

  async function buildFixedEventsFromIcs(
    events: IcsEvent[],
    dayStart: Date,
    dayEnd: Date,
    locationMap: Map<string, GeoPoint | null>
  ) {
    const fixed: FixedEvent[] = [];
    const dayEvents = filterIcsEventsForDay(events, dayStart, dayEnd);

    for (const evt of dayEvents) {
      const clampedStart = clampDate(
        evt.isAllDay ? dayStart : evt.start,
        dayStart,
        dayEnd
      );
      const clampedEnd = clampDate(
        evt.isAllDay ? dayEnd : evt.end,
        dayStart,
        dayEnd
      );
      if (clampedEnd.getTime() <= clampedStart.getTime()) continue;

      let location: GeoPoint | null = null;
      const locationLabel = resolveEventLocationLabel(evt);
      if (locationLabel && !isOnlineLocation(locationLabel)) {
        location = locationMap.get(locationLabel) ?? null;
      }

      fixed.push({
        id: `${evt.summary}-${evt.start.toISOString()}`,
        label: evt.summary || "RDV",
        start: clampedStart,
        end: clampedEnd,
        location,
        locationLabel: locationLabel || null,
      });
    }

    return fixed;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Analyse du meilleur créneau...");
    setResult(null);
    setIcsPayload(null);

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
    const searchDaysRaw = Number.parseInt(form.searchDays, 10);
    const searchDays =
      Number.isFinite(searchDaysRaw) && searchDaysRaw > 0
        ? searchDaysRaw
        : DEFAULT_SEARCH_DAYS;
    const windowLabel = form.includeWeekends ? "jours" : "jours ouvres";
    const modeLabel =
      form.optimizeMode === "travel" ? "trajets optimises" : "plus tot possible";
    setStatus(`Analyse des ${searchDays} prochains ${windowLabel} (${modeLabel})...`);

    if (!commercialIcsUrl.trim()) {
      setStatus("Aucun calendrier disponible pour ce commercial.");
      return;
    }

    try {
      let home: GeoPoint;
      let appointment: GeoPoint;
      let homeNote: string | null = null;

      try {
        home = await geocodeAddress(DEFAULT_HOME_ADDRESS);
      } catch {
        home = {
          label: DEFAULT_HOME_ADDRESS,
          lat: DEFAULT_HOME_COORDS.lat,
          lon: DEFAULT_HOME_COORDS.lon,
        };
        homeNote =
          "Adresse de depart introuvable: utilisation du centre d'Enghien.";
      }

      try {
        appointment = await geocodeAddress(form.appointmentAddress.trim());
      } catch {
        setStatus(`Adresse introuvable: ${form.appointmentAddress.trim()}`);
        return;
      }

      setStatus("Chargement du calendrier ICS...");
      const res = await fetch(
        `/api/ics?url=${encodeURIComponent(commercialIcsUrl)}`
      );
      if (!res.ok) {
        throw new Error("Impossible de charger le lien ICS.");
      }
      const text = await res.text();

      const rawEventCount = (text.match(/BEGIN:VEVENT/gi) || []).length;
      const rawFreeBusyCount = (text.match(/BEGIN:VFREEBUSY/gi) || []).length;
      if (rawEventCount === 0 && rawFreeBusyCount === 0) {
        throw new Error("Calendrier ICS invalide ou vide.");
      }
      let icsEvents = parseIcsEvents(text);
      if (icsEvents.length === 0 && (rawEventCount > 0 || rawFreeBusyCount > 0)) {
        icsEvents = parseIcsEventsFallback(text);
      }
      const isEmptyCalendar = icsEvents.length === 0;
      if (isEmptyCalendar) {
        setStatus(
          `Calendrier charge: 0 RDV (flux: ${rawEventCount} VEVENT / ${rawFreeBusyCount} VFREEBUSY).`
        );
      } else {
        setStatus(`Calendrier charge: ${icsEvents.length} RDV.`);
      }
      const { locationMap, skipped } = await preloadIcsLocations(icsEvents);

      const now = new Date();
      const candidates = buildDateCandidates(searchDays, form.includeWeekends);

      let chosen:
        | { slot: BestSlot; missingLocations: number; cost: number }
        | null = null;
      let chosenDayEvents = 0;

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

        const dayEvents = filterIcsEventsForDay(icsEvents, dayStart, dayEnd);
        const fixed = await buildFixedEventsFromIcs(
          icsEvents,
          dayStart,
          dayEnd,
          locationMap
        );

        const best = await findBestSlot({
          dayStart,
          dayEnd,
          home,
          appointment,
          durationMin,
          bufferMin,
          fixed,
          travelMinutesFn: travelMinutesWithTraffic,
        });

        if (!best) {
          continue;
        }

        const missingLocations = fixed.filter(
          (evt) => evt.locationLabel && !evt.location
        ).length;
        const travelCost = best.travelFromPrev + best.travelToNext;

        const candidate = { slot: best, missingLocations, cost: travelCost };

        if (!chosen) {
          chosen = candidate;
          chosenDayEvents = dayEvents.length;
          continue;
        }

        if (form.optimizeMode === "earliest") {
          if (
            candidate.slot.start < chosen.slot.start ||
            (candidate.slot.start.getTime() === chosen.slot.start.getTime() &&
              candidate.cost < chosen.cost)
          ) {
            chosen = candidate;
            chosenDayEvents = dayEvents.length;
          }
        } else {
          if (
            candidate.cost < chosen.cost ||
            (candidate.cost === chosen.cost &&
              candidate.slot.start < chosen.slot.start)
          ) {
            chosen = candidate;
            chosenDayEvents = dayEvents.length;
          }
        }
      }

      if (!chosen) {
        setStatus(
          `Aucun creneau disponible sur les ${searchDays} prochains ${windowLabel}.`
        );
        return;
      }

      const notes: string[] = [...chosen.slot.notes];
      notes.push(
        "Source calendrier: lien ICS."
      );
      if (isEmptyCalendar) {
        notes.push(
          "Aucun RDV detecte dans le calendrier ICS (planning base sur un agenda vide)."
        );
      }
      if (homeNote) {
        notes.push(homeNote);
      }
      if (chosen.missingLocations > 0) {
        notes.push(
          `${chosen.missingLocations} RDV calendrier sans geocodage: trajets estimes a 0 min.`
        );
      }
      notes.push(`RDV detectes ce jour: ${chosenDayEvents}.`);
      if (skipped > 0) {
        notes.push(
          `${skipped} adresses ignorees pour accelerer l'optimisation.`
        );
      }

      const enrichedBest: BestSlot = { ...chosen.slot, notes };
      setResult(enrichedBest);

      const subject =
        form.appointmentTitle.trim() ||
        `${form.type.toUpperCase()} — ${form.appointmentAddress.trim()}`;
      const description = `Commercial: ${form.commercial}\nType: ${form.type}\nAdresse: ${form.appointmentAddress.trim()}\nTrajet estime: ${enrichedBest.travelFromPrev} min (aller) / ${enrichedBest.travelToNext} min (retour).`;
      setIcsPayload({
        summary: subject,
        location: form.appointmentAddress.trim(),
        description,
      });

      setStatus(
        `Creneau recommande le ${formatDateLabel(
          enrichedBest.start
        )} : ${formatHHMM(enrichedBest.start)} - ${formatHHMM(
          enrichedBest.end
        )}`
      );
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
        <div className="eyebrow">Planification intelligente</div>
        <h1>Smart Slot Planner</h1>
        <p>
          Importez votre calendrier via un lien ICS, saisissez l'adresse du
          prochain RDV et laissez le planner proposer le meilleur créneau.
        </p>
      </header>

      <section className="card">
        <div className="card-title">Commercial</div>
        <div className="grid">
          <div className="field">
            <label>Selection</label>
            <select
              value={form.commercial}
              onChange={(e) =>
                setForm({
                  ...form,
                  commercial: e.target.value as Commercial,
                })
              }
            >
              {COMMERCIALS.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="small" style={{ marginTop: 10 }}>
          Le calendrier ICS est relie automatiquement au commercial selectionne.
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
            <span className="badge">Depart: {DEFAULT_HOME_ADDRESS}</span>
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
              <label>Priorite</label>
              <select
                value={form.optimizeMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    optimizeMode: e.target.value as FormState["optimizeMode"],
                  })
                }
              >
                <option value="travel">Optimiser les trajets</option>
                <option value="earliest">Le plus tot possible</option>
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
            <button className="btn primary" type="submit">
              Trouver le meilleur créneau
            </button>
            {result && icsPayload ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() => downloadIcsFile(result, icsPayload)}
              >
                Telecharger le fichier .ics
              </button>
            ) : null}
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
