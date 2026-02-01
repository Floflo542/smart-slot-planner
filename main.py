from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Literal, Optional, Tuple
from datetime import datetime, time, timedelta

app = FastAPI()

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://smart-slot-planner.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIG ---
VisitType = Literal["training", "demo", "reseller"]

DURATION_MIN = {
    "training": 60,
    "demo": 120,
    "reseller": 60,
}

# --- MODELS ---
class Location(BaseModel):
    label: str
    lat: float
    lon: float

class AppointmentRequest(BaseModel):
    id: str
    type: VisitType
    location: Location
    duration_min: Optional[int] = None

class SuggestRequest(BaseModel):
    date: str
    home: Location
    appointments: List[AppointmentRequest]

    start_time: str = "07:30"
    end_time: str = "16:30"

    # Lunch flexible
    lunch_window_start: str = "12:00"
    lunch_window_end: str = "14:00"
    lunch_duration_min: int = 30

    # Buffer entre RDV
    buffer_min: int = 10

    # Estimation route
    avg_speed_kmh: float = 60.0

class PlannedStop(BaseModel):
    kind: Literal["home", "appointment", "lunch"]
    id: Optional[str] = None
    label: str
    start: str
    end: str
    travel_min_from_prev: int

AlertLevel = Literal["info", "warn", "critical"]
AlertType = Literal["idle", "travel", "lunch", "back_home", "swap"]

class PlanAlert(BaseModel):
    level: AlertLevel
    type: AlertType
    message: str
    impact: Optional[str] = None

class PlanAnalysis(BaseModel):
    score: int
    total_travel_min: int
    idle_min: int
    long_idle_blocks_min: List[int]
    planned_appointments: int
    unplanned_appointments: int
    recommendations: List[str]
    alerts: List[PlanAlert]

class SuggestVariant(BaseModel):
    name: str
    stops: List[PlannedStop]
    unplanned: List[str]
    analysis: PlanAnalysis

class SuggestResponse(BaseModel):
    best: SuggestVariant
    variants: List[SuggestVariant]

# --- UTILS ---
def parse_hhmm(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))

def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    import math
    lat1, lon1 = a
    lat2, lon2 = b
    R = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (math.sin(dlat/2)**2 +
         math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2)
    return 2 * R * math.asin(math.sqrt(h))

def travel_minutes(a: Location, b: Location, avg_speed_kmh: float) -> int:
    km = haversine_km((a.lat, a.lon), (b.lat, b.lon))
    hours = km / max(avg_speed_kmh, 5.0)
    return max(1, int(round(hours * 60)))

def distance_from_home(home: Location, ap: AppointmentRequest) -> float:
    return haversine_km((home.lat, home.lon), (ap.location.lat, ap.location.lon))

def clamp(dt: datetime, lo: datetime, hi: datetime) -> datetime:
    return max(lo, min(dt, hi))

def schedule_in_order(req: SuggestRequest, ordered: List[AppointmentRequest]) -> Tuple[List[PlannedStop], List[str]]:
    day = datetime.fromisoformat(req.date)
    start_dt = datetime.combine(day.date(), parse_hhmm(req.start_time))
    end_dt = datetime.combine(day.date(), parse_hhmm(req.end_time))

    lunch_ws = datetime.combine(day.date(), parse_hhmm(req.lunch_window_start))
    lunch_we = datetime.combine(day.date(), parse_hhmm(req.lunch_window_end))
    lunch_dur = timedelta(minutes=req.lunch_duration_min)

    buffer_td = timedelta(minutes=req.buffer_min)

    stops: List[PlannedStop] = []
    unplanned: List[str] = []

    current_loc = req.home
    current_time = start_dt
    lunch_taken = False

    stops.append(PlannedStop(
        kind="home",
        label=f"Home: {req.home.label}",
        start=start_dt.isoformat(),
        end=start_dt.isoformat(),
        travel_min_from_prev=0
    ))

    def can_lunch_at(t: datetime) -> bool:
        return (t >= lunch_ws) and (t + lunch_dur <= lunch_we)

    def insert_lunch_if_opportune(next_start_candidate: datetime) -> bool:
        nonlocal lunch_taken, current_time
        if lunch_taken:
            return False
        if current_time >= lunch_we:
            return False

        overlaps_window = (next_start_candidate < lunch_we) and (next_start_candidate >= lunch_ws)
        inside_window = lunch_ws <= current_time < lunch_we
        if not (inside_window or overlaps_window):
            return False

        latest_start = lunch_we - lunch_dur
        t = clamp(current_time, lunch_ws, latest_start)
        if not can_lunch_at(t):
            return False

        stops.append(PlannedStop(
            kind="lunch",
            label="Lunch",
            start=t.isoformat(),
            end=(t + lunch_dur).isoformat(),
            travel_min_from_prev=0
        ))
        current_time = t + lunch_dur
        lunch_taken = True
        return True

    for ap in ordered:
        dur_min = ap.duration_min or DURATION_MIN[ap.type]
        dur_td = timedelta(minutes=dur_min)

        travel_min = travel_minutes(current_loc, ap.location, req.avg_speed_kmh)
        start_candidate = current_time + timedelta(minutes=travel_min)

        # lunch opportuniste
        inserted = insert_lunch_if_opportune(start_candidate)
        if inserted:
            travel_min = travel_minutes(current_loc, ap.location, req.avg_speed_kmh)
            start_candidate = current_time + timedelta(minutes=travel_min)

        end_candidate = start_candidate + dur_td
        if end_candidate > end_dt:
            unplanned.append(ap.id)
            continue

        stops.append(PlannedStop(
            kind="appointment",
            id=ap.id,
            label=f"{ap.type.upper()} — {ap.location.label}",
            start=start_candidate.isoformat(),
            end=end_candidate.isoformat(),
            travel_min_from_prev=travel_min
        ))

        current_time = end_candidate + buffer_td
        current_loc = ap.location

    # return home if fits
    travel_home = travel_minutes(current_loc, req.home, req.avg_speed_kmh)
    arrive_home = current_time + timedelta(minutes=travel_home)
    if arrive_home <= end_dt:
        stops.append(PlannedStop(
            kind="home",
            label=f"Home: {req.home.label}",
            start=arrive_home.isoformat(),
            end=arrive_home.isoformat(),
            travel_min_from_prev=travel_home
        ))

    return stops, unplanned

def compute_analysis(req: SuggestRequest, stops: List[PlannedStop], unplanned: List[str]) -> PlanAnalysis:
    buffer_min = req.buffer_min

    total_travel = sum(s.travel_min_from_prev for s in stops)
    planned_appointments = sum(1 for s in stops if s.kind == "appointment")

    idle_min = 0
    long_blocks: List[int] = []
    alerts: List[PlanAlert] = []
    rec: List[str] = []

    dt_starts = [datetime.fromisoformat(s.start) for s in stops]
    dt_ends = [datetime.fromisoformat(s.end) for s in stops]

    # --- Idle blocks detection ---
    for i in range(1, len(stops)):
        prev = stops[i - 1]
        gap = dt_starts[i] - dt_ends[i - 1]
        gap_min = max(0, int(gap.total_seconds() // 60))

        travel = stops[i].travel_min_from_prev
        buf = buffer_min if prev.kind == "appointment" else 0

        effective_idle = max(0, gap_min - travel - buf)
        idle_min += effective_idle

        if effective_idle >= 45:
            long_blocks.append(effective_idle)
            alerts.append(PlanAlert(
                level="warn" if effective_idle < 75 else "critical",
                type="idle",
                message=f"Trou long détecté: {effective_idle} min entre '{prev.label}' et '{stops[i].label}'.",
                impact="Temps mort élevé"
            ))
        elif effective_idle >= 20:
            alerts.append(PlanAlert(
                level="info",
                type="idle",
                message=f"Petit trou: {effective_idle} min entre '{prev.label}' et '{stops[i].label}'.",
                impact=None
            ))

    # --- Lunch sanity ---
    has_lunch = any(s.kind == "lunch" for s in stops)
    day = datetime.fromisoformat(req.date)
    lunch_ws = datetime.combine(day.date(), parse_hhmm(req.lunch_window_start))
    lunch_we = datetime.combine(day.date(), parse_hhmm(req.lunch_window_end))

    has_activity_after_lunch_start = any(
        (s.kind == "appointment") and (datetime.fromisoformat(s.start) >= lunch_ws)
        for s in stops
    )
    if has_activity_after_lunch_start and not has_lunch:
        alerts.append(PlanAlert(
            level="warn",
            type="lunch",
            message="Aucune pause lunch planifiée alors que la journée passe après midi.",
            impact="Risque fatigue / timing"
        ))

    # --- Back home mid-day detection ---
    home_indices = [i for i, s in enumerate(stops) if s.kind == "home"]
    if len(home_indices) >= 2:
        for idx in home_indices[:-1]:
            if any(s.kind == "appointment" for s in stops[idx+1:]):
                alerts.append(PlanAlert(
                    level="warn",
                    type="back_home",
                    message="Retour maison au milieu de la journée détecté. Souvent ça casse le flow.",
                    impact="Risque km/temps perdu"
                ))
                break

    # --- Swap suggestion (heuristique simple) ---
    ap_positions = [i for i, s in enumerate(stops) if s.kind == "appointment"]
    if len(ap_positions) >= 2:
        best_gain = 0
        best_pair = None  # (id1, id2, gain_guess)
        for k in range(len(ap_positions) - 1):
            i = ap_positions[k]
            j = ap_positions[k + 1]
            if (stops[j].travel_min_from_prev - stops[i].travel_min_from_prev) >= 10:
                gain_guess = stops[j].travel_min_from_prev - stops[i].travel_min_from_prev
                if gain_guess > best_gain:
                    best_gain = gain_guess
                    best_pair = (stops[i].id, stops[j].id, gain_guess)

        if best_pair and best_pair[0] and best_pair[1]:
            alerts.append(PlanAlert(
                level="info",
                type="swap",
                message=f"Suggestion: tester l'inversion {best_pair[0]} ↔ {best_pair[1]} (ordre des RDV).",
                impact=f"Potentiel -{best_gain} min de route (estimation)"
            ))

    # --- Score (0..100) ---
    score = 100.0
    score -= 0.6 * total_travel
    score -= 1.2 * idle_min
    score -= 20.0 * len(long_blocks)
    score -= 15.0 * len(unplanned)
    score += min(10.0, planned_appointments * 2.0)
    score_0_100 = int(max(0, min(100, round(score))))

    # --- Recommendations ---
    if long_blocks:
        rec.append(f"⚠️ Trou(s) long(s): {long_blocks} min. Objectif: éviter >45 min.")
        rec.append("Actions: déplacer lunch, permuter 2 RDV, ou ajouter un RDV proche.")
    else:
        rec.append("✅ Pas de trou > 45 min. Planning fluide.")

    if idle_min > 0 and not long_blocks:
        rec.append(f"Temps mort total (hors route/buffer): {idle_min} min.")

    rec.append(f"Route totale estimée: {total_travel} min.")

    if unplanned:
        rec.append(f"⚠️ RDV non planifiés: {len(unplanned)}")

    if alerts:
        rec.append(f"⚡ Priorité: {alerts[0].message}")

    return PlanAnalysis(
        score=score_0_100,
        total_travel_min=total_travel,
        idle_min=idle_min,
        long_idle_blocks_min=long_blocks,
        planned_appointments=planned_appointments,
        unplanned_appointments=len(unplanned),
        recommendations=rec,
        alerts=alerts
    )

def build_variants(req: SuggestRequest) -> List[SuggestVariant]:
    aps = req.appointments

    # Variant 1: balanced (nearest neighbor greedy)
    remaining = aps.copy()
    order_balanced: List[AppointmentRequest] = []
    cur = req.home
    while remaining:
        remaining.sort(key=lambda a: haversine_km((cur.lat, cur.lon), (a.location.lat, a.location.lon)))
        nxt = remaining.pop(0)
        order_balanced.append(nxt)
        cur = nxt.location

    # Variant 2: short_drive (distance from home)
    order_short = sorted(aps, key=lambda a: distance_from_home(req.home, a))

    # Variant 3: dense (shorter duration first)
    def dur(a: AppointmentRequest) -> int:
        return a.duration_min or DURATION_MIN[a.type]
    order_dense = sorted(aps, key=lambda a: (dur(a), distance_from_home(req.home, a)))

    variants_raw = [
        ("balanced", order_balanced),
        ("short_drive", order_short),
        ("dense", order_dense),
    ]

    out: List[SuggestVariant] = []
    for name, order in variants_raw:
        stops, unplanned = schedule_in_order(req, order)
        analysis = compute_analysis(req, stops, unplanned)
        out.append(SuggestVariant(name=name, stops=stops, unplanned=unplanned, analysis=analysis))

    out.sort(key=lambda v: v.analysis.score, reverse=True)
    return out

# --- ROUTES ---
@app.get("/health")
def health():
    return {"ok": True}

@app.post("/suggest", response_model=SuggestResponse)
def suggest(req: SuggestRequest):
    variants = build_variants(req)
    best = variants[0]
    return SuggestResponse(best=best, variants=variants)
