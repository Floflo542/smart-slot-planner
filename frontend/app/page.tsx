"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DURATION_MIN = {
  training: 60,
  demo: 120,
  reseller: 60,
} as const;

const DEFAULT_HOME_ADDRESS = "Rue du Viaduc 83, 7850 Enghien, Belgique";
const DEFAULT_HOME_COORDS = { lat: 50.695, lon: 4.04 };
const DEFAULT_DAY_START = "07:30";
const DEFAULT_DAY_END = "16:30";
const DEFAULT_BUFFER_MIN = 10;
const DEFAULT_AVG_SPEED_KMH = 60;
const DEFAULT_SEARCH_DAYS = 10;
const CALENDAR_RANGE_DAYS = 30;
const TRAFFIC_MARGIN = 1.0;
const TRAFFIC_BUFFER_MIN = 5;
const ADMIN_WINDOWS = [
  { start: "09:00", end: "11:00" },
  { start: "14:00", end: "17:00" },
] as const;
const MAX_RESELLERS_PER_DAY = 3;

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
const ADDRESS_OVERRIDES: Record<string, string> = {
  "chau. du roeulx 1003, 7021 mons":
    "Chaussée du Roeulx 1003, 7021 Mons, Belgique",
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
  const looksLikeAddress = (value: string) => {
    if (!value) return false;
    const lower = value.toLowerCase();
    if (/\b\d{4}\b/.test(lower)) return true;
    return /(rue|avenue|av\.|chauss[eé]e|boulevard|bd\.?|bld\.?|straat|laan|weg|route|road|place|pl\.?)/i.test(
      lower
    );
  };

  const extractAddress = (value: string) => {
    if (!value) return "";
    const parenMatch = value.match(/\(([^)]+)\)/);
    if (parenMatch && looksLikeAddress(parenMatch[1])) {
      return parenMatch[1].trim();
    }
    const parts = value.split(/ - | — | \| /);
    for (const part of parts) {
      if (looksLikeAddress(part)) return part.trim();
    }
    return value.trim();
  };

  const rawBase =
    locationRaw ||
    summaryOverride ||
    (looksLikeAddress(summaryRaw) ? summaryRaw : "");
  const base = extractAddress(rawBase);
  if (!base) return "";
  const normalized = normalizeLocationKey(base);
  return (
    ADDRESS_OVERRIDES[base.toLowerCase()] ||
    ADDRESS_OVERRIDES[normalized] ||
    LOCATION_OVERRIDES[normalized] ||
    base
  );
}

function detectEventKind(event: IcsEvent): VisitType | "other" {
  const haystack = `${event.summary} ${event.location}`.toLowerCase();
  if (/\bice\b/.test(haystack)) {
    return "demo";
  }
  if (/\btt\b/.test(haystack)) {
    return "training";
  }
  if (haystack.includes("demo") || haystack.includes("démo")) {
    return "demo";
  }
  if (haystack.includes("formation")) {
    return "training";
  }
  if (haystack.includes("revendeur")) {
    return "reseller";
  }
  return "other";
}

function extractPostalCodes(value: string) {
  const matches = value.match(/\b\d{4}\b/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function guessMapZoom(points: GeoPoint[]) {
  if (points.length <= 1) return 13;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const lonSpan = Math.max(...lons) - Math.min(...lons);
  const span = Math.max(latSpan, lonSpan);
  if (span < 0.02) return 14;
  if (span < 0.05) return 12;
  if (span < 0.15) return 11;
  if (span < 0.3) return 10;
  return 9;
}

function buildStaticMapUrl(points: GeoPoint[]) {
  if (!points.length) return null;
  const limited = points.slice(0, MAX_MAP_MARKERS);
  const payload = limited
    .map((point) => `${point.lat},${point.lon}`)
    .join("|");
  const params = new URLSearchParams({
    points: payload,
    size: "900x420",
  });
  return `/api/staticmap?${params.toString()}`;
}

const MAX_GEOCODE_LOCATIONS = Number.POSITIVE_INFINITY;
const MAX_MAP_MARKERS = 40;
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

type SlotOption = {
  slot: BestSlot;
  dayEvents: number;
  cost: number;
};

type TabKey = "planner" | "report" | "calendar" | "resellers";

type Reseller = {
  id: string;
  name: string;
  address: string;
  notes?: string;
};

type AdminWindow = {
  label: string;
  start: Date;
  end: Date;
};

type ReportSuggestion =
  | {
      kind: "reseller";
      reseller: Reseller;
      slot: BestSlot;
      travelCost: number;
    }
  | {
      kind: "admin";
      windows: AdminWindow[];
    }
  | {
      kind: "none";
      reason: string;
    };

type ReportItem = {
  day: Date;
  counts: {
    training: number;
    demo: number;
    reseller: number;
    other: number;
  };
  totalEvents: number;
  isFull: boolean;
  hasAllDay: boolean;
  suggestion: ReportSuggestion | null;
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

type CalendarData = {
  events: IcsEvent[];
  windowEvents: IcsEvent[];
  locationMap: Map<string, GeoPoint | null>;
  rangeStart: Date;
  rangeEnd: Date;
  days: Date[];
  skipped: number;
  isEmpty: boolean;
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

function unescapeIcsText(value: string) {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";");
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
      current.summary = unescapeIcsText(value);
    } else if (prop === "LOCATION") {
      current.location = unescapeIcsText(value);
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

    const summary = unescapeIcsText(extractProp(body, "SUMMARY"));
    const location = unescapeIcsText(extractProp(body, "LOCATION"));
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

function downloadIcsRange(start: Date, end: Date, payload: IcsPayload) {
  const ics = buildIcsEvent({
    start,
    end,
    summary: payload.summary,
    location: payload.location,
    description: payload.description,
  });

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStamp = localDateString(start);
  a.href = url;
  a.download = `rdv-${dateStamp}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadIcsFile(slot: BestSlot, payload: IcsPayload) {
  downloadIcsRange(slot.start, slot.end, payload);
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

type BusyInterval = {
  start: Date;
  end: Date;
};

function mergeIntervals(intervals: BusyInterval[]) {
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  const merged: BusyInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start.getTime() > last.end.getTime()) {
      merged.push({ ...interval });
      continue;
    }
    if (interval.end.getTime() > last.end.getTime()) {
      last.end = interval.end;
    }
  }
  return merged;
}

function buildBusyIntervals(
  events: IcsEvent[],
  dayStart: Date,
  dayEnd: Date,
  bufferMin: number
) {
  const intervals: BusyInterval[] = [];
  for (const evt of events) {
    const start = clampDate(
      evt.isAllDay ? dayStart : evt.start,
      dayStart,
      dayEnd
    );
    const end = clampDate(
      evt.isAllDay ? dayEnd : evt.end,
      dayStart,
      dayEnd
    );
    if (end.getTime() <= start.getTime()) continue;
    const bufferedStart = clampDate(addMinutes(start, -bufferMin), dayStart, dayEnd);
    const bufferedEnd = clampDate(addMinutes(end, bufferMin), dayStart, dayEnd);
    intervals.push({ start: bufferedStart, end: bufferedEnd });
  }
  return mergeIntervals(intervals);
}

function findFreeBlocks(
  windowStart: Date,
  windowEnd: Date,
  busy: BusyInterval[]
) {
  const blocks: BusyInterval[] = [];
  let cursor = windowStart;
  for (const interval of busy) {
    if (interval.end.getTime() <= windowStart.getTime()) continue;
    if (interval.start.getTime() >= windowEnd.getTime()) break;
    if (interval.start.getTime() > cursor.getTime()) {
      blocks.push({
        start: cursor,
        end: new Date(
          Math.min(interval.start.getTime(), windowEnd.getTime())
        ),
      });
    }
    if (interval.end.getTime() > cursor.getTime()) {
      cursor = new Date(Math.max(cursor.getTime(), interval.end.getTime()));
    }
    if (cursor.getTime() >= windowEnd.getTime()) break;
  }
  if (cursor.getTime() < windowEnd.getTime()) {
    blocks.push({ start: cursor, end: windowEnd });
  }
  return blocks.filter((block) => block.end.getTime() > block.start.getTime());
}

function pickLargestBlock(blocks: BusyInterval[]) {
  if (!blocks.length) return null;
  return [...blocks].sort((a, b) => {
    const durationA = a.end.getTime() - a.start.getTime();
    const durationB = b.end.getTime() - b.start.getTime();
    if (durationA !== durationB) return durationB - durationA;
    return a.start.getTime() - b.start.getTime();
  })[0];
}

function buildAdminWindowsForDay(day: Date, busy: BusyInterval[]) {
  const dateStr = localDateString(day);
  const windows: AdminWindow[] = [];

  for (const window of ADMIN_WINDOWS) {
    const windowStart = parseDateTime(dateStr, window.start);
    const windowEnd = parseDateTime(dateStr, window.end);
    const blocks = findFreeBlocks(windowStart, windowEnd, busy);
    const best = pickLargestBlock(blocks);
    if (!best) continue;
    windows.push({
      label: `${window.start} - ${window.end}`,
      start: best.start,
      end: best.end,
    });
  }

  return windows;
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
      const nextLabel =
        next.id === "day-end"
          ? next.label
          : `${next.label} (${formatHHMM(next.start)})`;
      best = {
        start: candidateStart,
        end: candidateEnd,
        travelFromPrev,
        travelToNext,
        prevLabel: prev.label,
        nextLabel,
        notes,
      };
    }
  }

  return best;
}

export default function Home() {
  const [status, setStatus] = useState("Prêt.");
  const [options, setOptions] = useState<SlotOption[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("planner");
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | null>(
    null
  );
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [resellersLoading, setResellersLoading] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [resellerDraft, setResellerDraft] = useState({
    name: "",
    address: "",
    notes: "",
  });

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
  const activeResellers = resellers;

  const buildIcsPayload = (slot: BestSlot): IcsPayload => {
    const subject =
      form.appointmentTitle.trim() ||
      `${form.type.toUpperCase()} — ${form.appointmentAddress.trim()}`;
    const description = `Commercial: ${form.commercial}\nType: ${form.type}\nAdresse: ${form.appointmentAddress.trim()}\nTrajet estime: ${slot.travelFromPrev} min (aller) / ${slot.travelToNext} min (retour).`;
    return {
      summary: subject,
      location: form.appointmentAddress.trim(),
      description,
    };
  };

  const buildResellerIcsPayload = (
    reseller: Reseller,
    slot: BestSlot
  ): IcsPayload => {
    return {
      summary: `REVENDEUR — ${reseller.name}`,
      location: reseller.address,
      description: `Commercial: ${form.commercial}\nType: revendeur\nAdresse: ${reseller.address}\nTrajet estime: ${slot.travelFromPrev} min (aller) / ${slot.travelToNext} min (retour).`,
    };
  };

  const buildAdminIcsPayload = (window: AdminWindow): IcsPayload => {
    return {
      summary: `ADMIN — ${form.commercial}`,
      location: "Administration",
      description: `Commercial: ${form.commercial}\nType: admin\nFenetre: ${window.label}`,
    };
  };


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
        const minutes = Math.max(
          1,
          Math.round(json.duration_min * TRAFFIC_MARGIN + TRAFFIC_BUFFER_MIN)
        );
        routeCache.current.set(key, minutes);
        return minutes;
      }
    } catch {
      // ignore and fallback below
    }

    const fallback = Math.max(
      1,
      Math.round(
        travelMinutes(a, b, DEFAULT_AVG_SPEED_KMH) * TRAFFIC_MARGIN +
          TRAFFIC_BUFFER_MIN
      )
    );
    routeCache.current.set(key, fallback);
    return fallback;
  };

  const parseSearchDays = () => {
    const searchDaysRaw = Number.parseInt(form.searchDays, 10);
    return Number.isFinite(searchDaysRaw) && searchDaysRaw > 0
      ? searchDaysRaw
      : DEFAULT_SEARCH_DAYS;
  };

  const handleLoadCalendar = async () => {
    await loadCalendarWindow(CALENDAR_RANGE_DAYS, false);
  };

  const loadResellers = async (commercial: Commercial) => {
    setResellersLoading(true);
    try {
      const res = await fetch(
        `/api/resellers?commercial=${encodeURIComponent(commercial)}`
      );
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setStatus(json?.error || "Impossible de charger les revendeurs.");
        setResellers([]);
        return [];
      }
      const items = Array.isArray(json.items) ? json.items : [];
      setResellers(items);
      return items;
    } catch {
      setStatus("Impossible de charger les revendeurs.");
      setResellers([]);
      return [];
    } finally {
      setResellersLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "resellers") {
      loadResellers(form.commercial);
    }
  }, [activeTab, form.commercial]);

  const buildReportItems = async (
    calendar: CalendarData,
    resellersForReport: Reseller[]
  ) => {
    const items: ReportItem[] = [];
    const resellerPoints = new Map<string, GeoPoint | null>();
    let homePoint: GeoPoint = {
      label: DEFAULT_HOME_ADDRESS,
      lat: DEFAULT_HOME_COORDS.lat,
      lon: DEFAULT_HOME_COORDS.lon,
    };

    try {
      homePoint = await geocodeAddress(DEFAULT_HOME_ADDRESS);
    } catch {
      // fallback to default coords
    }

    if (resellersForReport.length) {
      let done = 0;
      for (const reseller of resellersForReport) {
        done += 1;
        setStatus(
          `Geocodage des revendeurs (${done}/${resellersForReport.length})...`
        );
        try {
          const point = await geocodeAddress(reseller.address);
          resellerPoints.set(reseller.id, point);
        } catch {
          resellerPoints.set(reseller.id, null);
        }
      }
    }

    for (let index = 0; index < calendar.days.length; index += 1) {
      const day = calendar.days[index];
      setStatus(`Analyse du rapport (${index + 1}/${calendar.days.length})...`);

      const dateStr = localDateString(day);
      const dayStart = parseDateTime(dateStr, DEFAULT_DAY_START);
      const dayEnd = parseDateTime(dateStr, DEFAULT_DAY_END);
      const dayEvents = filterIcsEventsForDay(
        calendar.windowEvents,
        dayStart,
        dayEnd
      );

      const counts = {
        training: 0,
        demo: 0,
        reseller: 0,
        other: 0,
      };
      const hasAllDay = dayEvents.some((evt) => evt.isAllDay);

      for (const evt of dayEvents) {
        const kind = detectEventKind(evt);
        if (kind === "other") {
          counts.other += 1;
        } else {
          counts[kind] += 1;
        }
      }

      const isFull =
        hasAllDay ||
        counts.training >= 4 ||
        counts.demo >= 2 ||
        (counts.demo >= 1 && counts.training >= 2);

      let suggestion: ReportSuggestion | null = null;

      if (!isFull) {
        const fixed = await buildFixedEventsFromIcs(
          calendar.windowEvents,
          dayStart,
          dayEnd,
          calendar.locationMap
        );

        const dayPoints: GeoPoint[] = [];
        for (const evt of dayEvents) {
          const locationLabel = resolveEventLocationLabel(evt);
          if (!locationLabel) continue;
          const point = calendar.locationMap.get(locationLabel);
          if (point) {
            dayPoints.push(point);
          }
        }

        const resellerCandidates = resellersForReport
          .map((reseller) => ({
            reseller,
            point: resellerPoints.get(reseller.id) || null,
          }))
          .filter((entry) => entry.point);

        if (resellerCandidates.length) {
          const ranked = [...resellerCandidates].sort((a, b) => {
            if (!dayPoints.length) return 0;
            const distanceA = Math.min(
              ...dayPoints.map((point) =>
                haversineKm(point, a.point as GeoPoint)
              )
            );
            const distanceB = Math.min(
              ...dayPoints.map((point) =>
                haversineKm(point, b.point as GeoPoint)
              )
            );
            return distanceA - distanceB;
          });

          const selected = ranked.slice(0, MAX_RESELLERS_PER_DAY);
          let best: {
            reseller: Reseller;
            slot: BestSlot;
            cost: number;
          } | null = null;

          for (const candidate of selected) {
            const slot = await findBestSlot({
              dayStart,
              dayEnd,
              home: homePoint,
              appointment: candidate.point as GeoPoint,
              durationMin: DURATION_MIN.reseller,
              bufferMin: DEFAULT_BUFFER_MIN,
              fixed,
              travelMinutesFn: travelMinutesWithTraffic,
            });
            if (!slot) continue;
            const cost = slot.travelFromPrev + slot.travelToNext;
            if (
              !best ||
              cost < best.cost ||
              (cost === best.cost &&
                slot.start.getTime() < best.slot.start.getTime())
            ) {
              best = {
                reseller: candidate.reseller,
                slot,
                cost,
              };
            }
          }

          if (best) {
            suggestion = {
              kind: "reseller",
              reseller: best.reseller,
              slot: best.slot,
              travelCost: best.cost,
            };
          }
        }

        if (!suggestion) {
          const busy = buildBusyIntervals(
            dayEvents,
            dayStart,
            dayEnd,
            DEFAULT_BUFFER_MIN
          );
          const adminWindows = buildAdminWindowsForDay(day, busy);
          if (adminWindows.length) {
            suggestion = { kind: "admin", windows: adminWindows };
          } else {
            suggestion = {
              kind: "none",
              reason: "Aucun créneau admin disponible.",
            };
          }
        }
      }

      items.push({
        day,
        counts,
        totalEvents: dayEvents.length,
        isFull,
        hasAllDay,
        suggestion,
      });
    }

    return items;
  };

  const handleAnalyzeReport = async () => {
    const calendar = await loadCalendarWindow(CALENDAR_RANGE_DAYS, false);
    if (!calendar) return;
    const resellersForReport = await loadResellers(form.commercial);
    const items = await buildReportItems(calendar, resellersForReport);
    setReportItems(items);
    setStatus("Rapport mis a jour.");
  };

  const handleAddReseller = () => {
    const name = resellerDraft.name.trim();
    const address = resellerDraft.address.trim();
    if (!name || !address) {
      setStatus("Nom ou adresse du revendeur manquante.");
      return;
    }
    const payload = {
      commercial: form.commercial,
      name,
      address,
      notes: resellerDraft.notes.trim() || undefined,
    };
    setStatus("Enregistrement du revendeur...");
    fetch("/api/resellers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Erreur lors de l'ajout.");
        }
        setResellerDraft({ name: "", address: "", notes: "" });
        setStatus("Revendeur ajoute.");
        await loadResellers(form.commercial);
      })
      .catch((err) => {
        setStatus(`Erreur: ${err?.message || String(err)}`);
      });
  };

async function geocodeAddress(label: string): Promise<GeoPoint> {
    const trimmed = label.trim();
    const override =
      ADDRESS_OVERRIDES[trimmed.toLowerCase()] ||
      ADDRESS_OVERRIDES[normalizeLocationKey(trimmed)];
    if (override) {
      return geocodeAddress(override);
    }
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
    let lastError = "";

    const expandAddress = (value: string) => {
      const variants = new Set<string>();
      const replacements: Array<[RegExp, string]> = [
        [/\bChau\.?\b/gi, "Chaussée"],
        [/\bChaus\.?\b/gi, "Chaussée"],
        [/\bCh\.\b/gi, "Chaussée"],
        [/\bAv\.?\b/gi, "Avenue"],
        [/\bBd\.?\b/gi, "Boulevard"],
        [/\bBld\.?\b/gi, "Boulevard"],
        [/\bRte\.?\b/gi, "Route"],
        [/\bChem\.?\b/gi, "Chemin"],
      ];
      let expanded = value;
      for (const [regex, replacement] of replacements) {
        expanded = expanded.replace(regex, replacement);
      }
      if (expanded !== value) variants.add(expanded);
      const simplified = value
        .replace(/[’']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (simplified !== value) variants.add(simplified);
      return variants;
    };

    addAttempt(trimmed);
    for (const variant of expandAddress(trimmed)) {
      addAttempt(variant);
    }
    addAttempt(trimmed.replace(/\./g, ""));

    const withCommaPostal = trimmed.replace(
      /(\S)\s+(\d{4})\s+/,
      "$1, $2 "
    );
    addAttempt(withCommaPostal);
    for (const variant of expandAddress(withCommaPostal)) {
      addAttempt(variant);
    }
    addAttempt(withCommaPostal.replace(/\./g, ""));

    const hasCountry = /belgique|belgium/i.test(trimmed);
    if (!hasCountry) {
      addAttempt(`${withCommaPostal}, Belgique`);
      addAttempt(`${trimmed}, Belgique`);
      for (const variant of expandAddress(withCommaPostal)) {
        addAttempt(`${variant}, Belgique`);
      }
      addAttempt(`${trimmed.replace(/\./g, "")}, Belgique`);
    }

    const postalMatch = trimmed.match(/(\d{4})\s+(.+)/);
    if (postalMatch) {
      addAttempt(`${postalMatch[1]} ${postalMatch[2]}, Belgique`);
      addAttempt(`${postalMatch[1]} ${postalMatch[2].replace(/\./g, "")}, Belgique`);
      addAttempt(
        `${postalMatch[2]}, ${postalMatch[1]}, Belgique`
      );
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
        lastError = "Geocodage indisponible";
        continue;
      }
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        geocodeCache.current.set(query, null);
        lastError = json?.error || `Geocodage indisponible (${res.status})`;
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
    throw new Error(
      lastError ? `Adresse introuvable (${lastError})` : "Adresse introuvable"
    );
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

  function filterIcsEventsForRange(
    events: IcsEvent[],
    rangeStart: Date,
    rangeEnd: Date
  ) {
    return events.filter((evt) => {
      if (evt.isAllDay) {
        return evt.start <= rangeEnd && evt.end >= rangeStart;
      }
      return evt.end > rangeStart && evt.start < rangeEnd;
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

  async function loadCalendarWindow(
    searchDays: number,
    includeWeekends: boolean
  ) {
    if (!commercialIcsUrl.trim()) {
      setStatus("Aucun calendrier disponible pour ce commercial.");
      return null;
    }

    setStatus("Chargement du calendrier ICS...");
    const res = await fetch(
      `/api/ics?url=${encodeURIComponent(commercialIcsUrl)}`
    );
    if (!res.ok) {
      setStatus("Impossible de charger le lien ICS.");
      return null;
    }
    const text = await res.text();

    const rawEventCount = (text.match(/BEGIN:VEVENT/gi) || []).length;
    const rawFreeBusyCount = (text.match(/BEGIN:VFREEBUSY/gi) || []).length;
    if (rawEventCount === 0 && rawFreeBusyCount === 0) {
      setStatus("Calendrier ICS invalide ou vide.");
      return null;
    }

    let events = parseIcsEvents(text);
    if (events.length === 0 && (rawEventCount > 0 || rawFreeBusyCount > 0)) {
      events = parseIcsEventsFallback(text);
    }

    const isEmpty = events.length === 0;
    if (isEmpty) {
      setStatus(
        `Calendrier charge: 0 RDV (flux: ${rawEventCount} VEVENT / ${rawFreeBusyCount} VFREEBUSY).`
      );
    } else {
      setStatus(`Calendrier charge: ${events.length} RDV.`);
    }

    const days = buildDateCandidates(searchDays, includeWeekends);
    if (days.length === 0) {
      setStatus("Aucune date a analyser.");
      return null;
    }

    const rangeStart = parseDateTime(
      localDateString(days[0]),
      DEFAULT_DAY_START
    );
    const rangeEnd = parseDateTime(
      localDateString(days[days.length - 1]),
      DEFAULT_DAY_END
    );
    const windowEvents = filterIcsEventsForRange(
      events,
      rangeStart,
      rangeEnd
    );
    const { locationMap, skipped } = await preloadIcsLocations(windowEvents);

    const data: CalendarData = {
      events,
      windowEvents,
      locationMap,
      rangeStart,
      rangeEnd,
      days,
      skipped,
      isEmpty,
    };
    setCalendarData(data);
    setSelectedCalendarDay((prev) => prev || days[0]);
    return data;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Analyse du meilleur créneau...");
    setOptions([]);

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
    const searchDays = parseSearchDays();
    const windowLabel = form.includeWeekends ? "jours" : "jours ouvres";
    const modeLabel =
      form.optimizeMode === "travel" ? "trajets optimises" : "plus tot possible";
    setStatus(`Analyse des ${searchDays} prochains ${windowLabel} (${modeLabel})...`);

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

      const calendar = await loadCalendarWindow(
        searchDays,
        form.includeWeekends
      );
      if (!calendar) {
        return;
      }

      const now = new Date();
      const candidates = calendar.days;
      const windowEvents = calendar.windowEvents;
      const locationMap = calendar.locationMap;
      const skipped = calendar.skipped;
      const isEmptyCalendar = calendar.isEmpty;

      const slotCandidates: SlotOption[] = [];

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

        const dayEvents = filterIcsEventsForDay(windowEvents, dayStart, dayEnd);
        const fixed = await buildFixedEventsFromIcs(
          windowEvents,
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

        const travelCost = best.travelFromPrev + best.travelToNext;

        slotCandidates.push({
          slot: best,
          cost: travelCost,
          dayEvents: dayEvents.length,
        });
      }

      if (slotCandidates.length === 0) {
        setStatus(
          `Aucun creneau disponible sur les ${searchDays} prochains ${windowLabel}.`
        );
        return;
      }

      const sorted = [...slotCandidates].sort((a, b) => {
        const aHasEvents = a.dayEvents > 0;
        const bHasEvents = b.dayEvents > 0;
        if (aHasEvents !== bHasEvents) {
          return aHasEvents ? -1 : 1;
        }
        if (form.optimizeMode === "earliest") {
          const diff = a.slot.start.getTime() - b.slot.start.getTime();
          if (diff !== 0) return diff;
          return a.cost - b.cost;
        }
        if (a.cost !== b.cost) return a.cost - b.cost;
        return a.slot.start.getTime() - b.slot.start.getTime();
      });

      const buildNotes = (candidate: SlotOption) => {
        const notes: string[] = [];
        if (isEmptyCalendar) {
          notes.push(
            "Aucun RDV detecte dans le calendrier ICS (planning base sur un agenda vide)."
          );
        }
        if (homeNote) {
          notes.push(homeNote);
        }
        notes.push(`RDV detectes ce jour: ${candidate.dayEvents}.`);
        if (skipped > 0) {
          notes.push(
            `${skipped} adresses ignorees pour accelerer l'optimisation.`
          );
        }
        return notes;
      };

      const top = sorted.slice(0, 3).map((candidate) => ({
        ...candidate,
        slot: { ...candidate.slot, notes: buildNotes(candidate) },
      }));

      setOptions(top);
      const label = top.length === 1 ? "1 creneau propose." : `${top.length} creneaux proposes.`;
      setStatus(label);
    } catch (err: any) {
      setStatus(`Erreur: ${err?.message || String(err)}`);
    }
  }

  const reportDays = reportItems;

  const calendarDays = calendarData?.days || [];
  const activeCalendarDay = selectedCalendarDay || calendarDays[0] || null;
  const calendarDayEvents = useMemo(() => {
    if (!calendarData || !activeCalendarDay) return [];
    const dateStr = localDateString(activeCalendarDay);
    const dayStart = parseDateTime(dateStr, DEFAULT_DAY_START);
    const dayEnd = parseDateTime(dateStr, DEFAULT_DAY_END);
    return filterIcsEventsForDay(calendarData.windowEvents, dayStart, dayEnd);
  }, [calendarData, activeCalendarDay]);

  const calendarPoints = useMemo(() => {
    if (!calendarData) return [];
    const points: GeoPoint[] = [];
    for (const evt of calendarDayEvents) {
      const locationLabel = resolveEventLocationLabel(evt);
      if (!locationLabel) continue;
      const point = calendarData.locationMap.get(locationLabel);
      if (point) {
        points.push({
          ...point,
          label: evt.summary || point.label,
        });
      }
    }
    return points;
  }, [calendarData, calendarDayEvents]);

  const mapUrl = useMemo(() => {
    const base = buildStaticMapUrl(calendarPoints);
    if (!base) return null;
    const dayTag = activeCalendarDay ? localDateString(activeCalendarDay) : "na";
    return `${base}&t=${encodeURIComponent(dayTag)}`;
  }, [calendarPoints, activeCalendarDay]);

  useEffect(() => {
    setMapError(false);
  }, [mapUrl]);

  const renderTravelLabel = (label?: string, fallback?: string) => {
    const raw = (label || fallback || "").toLowerCase();
    if (raw === "départ") {
      return <span className="home-label">Maison (départ)</span>;
    }
    if (raw === "fin") {
      return <span className="home-label">Maison (fin)</span>;
    }
    return <span>{label || fallback}</span>;
  };

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

      <div className="tabs">
        <button
          className={`tab ${activeTab === "planner" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("planner")}
        >
          Accueil
        </button>
        <button
          className={`tab ${activeTab === "report" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("report")}
        >
          Rapport
        </button>
        <button
          className={`tab ${activeTab === "calendar" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("calendar")}
        >
          Agenda & Carte
        </button>
        <button
          className={`tab ${activeTab === "resellers" ? "active" : ""}`}
          type="button"
          onClick={() => setActiveTab("resellers")}
        >
          Revendeurs
        </button>
      </div>

      <section className="card">
        <div className="card-title">Statut</div>
        <div className="status">{status}</div>
      </section>

      {activeTab === "planner" ? (
        <>
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
          </section>

          <section className="card">
            <div className="card-title">Nouveau RDV</div>
            <form onSubmit={handleSubmit}>
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
                    onChange={(e) =>
                      setForm({ ...form, durationMin: e.target.value })
                    }
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
                    onChange={(e) =>
                      setForm({ ...form, searchDays: e.target.value })
                    }
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
              </div>
            </form>
          </section>

          {options.length ? (
            <section className="card">
              <div className="card-title">Créneaux proposés</div>
              {options.map((option, idx) => {
                const slot = option.slot;
                return (
                  <div
                    key={`${slot.start.toISOString()}-${idx}`}
                    style={{ marginTop: 16 }}
                  >
                    <div className="small">Option {idx + 1}</div>
                    <div className="result-grid">
                      <div className="result-card">
                        <div className="small">Date recommandee</div>
                        <div style={{ fontSize: 20, fontWeight: 700 }}>
                          {formatDateLabel(slot.start)}
                        </div>
                        <div className="small" style={{ marginTop: 6 }}>
                          Heure proposee
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700 }}>
                          {formatHHMM(slot.start)} - {formatHHMM(slot.end)}
                        </div>
                        <div className="small">Fuseau: {timezone}</div>
                      </div>
                      <div className="result-card">
                        <div className="small">Trajet estimé</div>
                        <div style={{ fontSize: 20, fontWeight: 600 }}>
                          {slot.travelFromPrev} min depuis{" "}
                          {renderTravelLabel(slot.prevLabel, "départ")}
                        </div>
                        <div className="small">
                          {slot.travelToNext} min vers{" "}
                          {renderTravelLabel(slot.nextLabel, "fin")}
                        </div>
                      </div>
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => downloadIcsFile(slot, buildIcsPayload(slot))}
                      >
                        Telecharger le fichier .ics
                      </button>
                    </div>
                    {slot.notes.length ? (
                      <ul className="note-list">
                        {slot.notes.map((note, noteIdx) => (
                          <li key={noteIdx}>{note}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "report" ? (
        <section className="card">
          <div className="card-title">Rapport des journées</div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              className="btn ghost"
              type="button"
              onClick={handleAnalyzeReport}
            >
              Analyser le calendrier
            </button>
            <span className="badge">
              Objectif: 4 formations / 2 démos / 1 démo + 2 formations
            </span>
          </div>
          {!calendarData ? (
            <div className="small">
              Chargez le calendrier pour obtenir le rapport détaillé.
            </div>
          ) : reportDays.length === 0 ? (
            <div className="small">
              Lancez l'analyse pour generer les recommandations.
            </div>
          ) : (
            <div className="report-list">
              {reportDays.map((report) => (
                <div key={report.day.toISOString()} className="report-card">
                  <div className="row">
                    <div className="report-date">
                      {formatDateLabel(report.day)}
                    </div>
                    <span
                      className={`pill ${
                        report.isFull ? "pill-ok" : "pill-warn"
                      }`}
                    >
                      {report.isFull ? "Journee complete" : "A completer"}
                    </span>
                  </div>
                  <div className="row report-metrics">
                    <span className="chip">Formations: {report.counts.training}</span>
                    <span className="chip">Demos: {report.counts.demo}</span>
                    <span className="chip">Revendeurs: {report.counts.reseller}</span>
                    <span className="chip">Autres: {report.counts.other}</span>
                    <span className="chip">Total: {report.totalEvents}</span>
                  </div>
                  {!report.isFull ? (
                    <div className="report-suggestions">
                      {report.suggestion?.kind === "reseller" ? (
                        <>
                          {(() => {
                            const suggestion = report.suggestion;
                            if (!suggestion || suggestion.kind !== "reseller") {
                              return null;
                            }
                            return (
                              <>
                          <div className="small">
                            Revendeur recommande (le plus proche)
                          </div>
                          <div className="suggestion-item">
                            <div>{suggestion.reseller.name}</div>
                            <div className="small">
                              {suggestion.reseller.address}
                            </div>
                            <div className="small" style={{ marginTop: 6 }}>
                              Creneau optimal:{" "}
                              {formatHHMM(suggestion.slot.start)} -{" "}
                              {formatHHMM(suggestion.slot.end)}
                            </div>
                            <div className="small">
                              Trajet estime:{" "}
                              {suggestion.slot.travelFromPrev} min
                              depuis{" "}
                              {renderTravelLabel(
                                suggestion.slot.prevLabel,
                                "départ"
                              )}{" "}
                              / {suggestion.slot.travelToNext} min vers{" "}
                              {renderTravelLabel(
                                suggestion.slot.nextLabel,
                                "fin"
                              )}
                            </div>
                            <div className="row" style={{ marginTop: 8 }}>
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() =>
                                  downloadIcsRange(
                                    suggestion.slot.start,
                                    suggestion.slot.end,
                                    buildResellerIcsPayload(
                                      suggestion.reseller,
                                      suggestion.slot
                                    )
                                  )
                                }
                              >
                                Télécharger .ics
                              </button>
                            </div>
                          </div>
                              </>
                            );
                          })()}
                        </>
                      ) : null}
                      {report.suggestion?.kind === "admin" ? (
                        <>
                          <div className="small">
                            Admin recommande (plages 09:00-11:00 et 14:00-17:00)
                          </div>
                          <div className="suggestion-list">
                            {report.suggestion.windows.map((window, idx) => (
                              <div key={idx} className="suggestion-item">
                                <div>Fenetre {window.label}</div>
                                <div className="small">
                                  {formatHHMM(window.start)} - {formatHHMM(window.end)}
                                </div>
                                <div className="row" style={{ marginTop: 8 }}>
                                  <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() =>
                                      downloadIcsRange(
                                        window.start,
                                        window.end,
                                        buildAdminIcsPayload(window)
                                      )
                                    }
                                  >
                                    Télécharger .ics
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                      {report.suggestion?.kind === "none" ? (
                        <div className="small">{report.suggestion.reason}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "calendar" ? (
        <section className="card">
          <div className="card-title">Agenda & carte</div>
          <div className="row" style={{ marginBottom: 12 }}>
            <button className="btn ghost" type="button" onClick={handleLoadCalendar}>
              Charger l'agenda
            </button>
            {calendarData ? (
              <span className="badge">
                Fenetre: {formatDateLabel(calendarData.rangeStart)} →{" "}
                {formatDateLabel(calendarData.rangeEnd)}
              </span>
            ) : null}
          </div>
          {!calendarData ? (
            <div className="small">
              Chargez le calendrier pour afficher l'agenda et la carte.
            </div>
          ) : (
            <div className="calendar-layout">
              <div className="calendar-days">
                {calendarDays.map((day) => {
                  const dateStr = localDateString(day);
                  const dayStart = parseDateTime(dateStr, DEFAULT_DAY_START);
                  const dayEnd = parseDateTime(dateStr, DEFAULT_DAY_END);
                  const count = filterIcsEventsForDay(
                    calendarData.windowEvents,
                    dayStart,
                    dayEnd
                  ).length;
                  const isActive =
                    activeCalendarDay && isSameDay(day, activeCalendarDay);
                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      className={`day-item ${isActive ? "active" : ""}`}
                      onClick={() => setSelectedCalendarDay(day)}
                    >
                      <div className="day-label">{formatDateLabel(day)}</div>
                      <div className="small">{count} RDV</div>
                    </button>
                  );
                })}
              </div>
              <div className="calendar-map">
                {mapUrl && !mapError ? (
                  <img
                    className="map-image"
                    src={mapUrl}
                    alt="Carte des RDV"
                    onError={() => setMapError(true)}
                  />
                ) : (
                  <div className="map-placeholder">
                    {mapUrl
                      ? "Carte indisponible pour ce jour."
                      : "Aucun point geocode pour ce jour."}
                  </div>
                )}
                <div className="points-list">
                  {calendarDayEvents.length ? (
                    calendarDayEvents.map((evt) => (
                      <div key={`${evt.summary}-${evt.start.toISOString()}`} className="point-row">
                        <div>
                          {formatHHMM(evt.start)} - {formatHHMM(evt.end)} ·{" "}
                          {evt.summary || "RDV"}
                        </div>
                        <div className="small">
                          {resolveEventLocationLabel(evt) || "Adresse non renseignee"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="small">Aucun RDV pour ce jour.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "resellers" ? (
        <section className="card">
          <div className="card-title">Revendeurs</div>
          <div className="grid">
            <div className="field">
              <label>Commercial</label>
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
            <div className="field">
              <label>Nom du revendeur</label>
              <input
                type="text"
                placeholder="Nom du revendeur"
                value={resellerDraft.name}
                onChange={(e) =>
                  setResellerDraft({ ...resellerDraft, name: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Adresse</label>
              <input
                type="text"
                placeholder="Adresse complète"
                value={resellerDraft.address}
                onChange={(e) =>
                  setResellerDraft({ ...resellerDraft, address: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label>Notes (optionnel)</label>
              <input
                type="text"
                placeholder="Informations utiles"
                value={resellerDraft.notes}
                onChange={(e) =>
                  setResellerDraft({ ...resellerDraft, notes: e.target.value })
                }
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" type="button" onClick={handleAddReseller}>
              Ajouter revendeur
            </button>
          </div>
          <div className="reseller-list">
            {resellersLoading ? (
              <div className="small">Chargement des revendeurs...</div>
            ) : activeResellers.length ? (
              activeResellers.map((reseller) => (
                <div key={reseller.id} className="reseller-item">
                  <div className="reseller-name">{reseller.name}</div>
                  <div className="small">{reseller.address}</div>
                  {reseller.notes ? (
                    <div className="small">{reseller.notes}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="small">Aucun revendeur enregistre.</div>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
