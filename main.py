from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Literal, Optional, Tuple, Dict
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

    # V0: estimation temps route
    avg_speed_kmh: float = 60.0

class PlannedStop(BaseModel):
    kind: Literal["home", "appointment", "lunch"]
    id: Optional[str] = None
    label: str
    start: str
    end: str
    travel_min_from_prev: int

class PlanAnalysis(BaseModel):
    score: int
    total_travel_min: int
    idle_min: int
    long_idle_blocks_min: List[int]
    planned_appointments: int
    unplanned_appointments: int
    recommendations: List[str]

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

def schedule_in_order(name: str, req: SuggestRequest, ordered: List[AppointmentRequest]) -> Tuple[List[PlannedStop], List[str], bool]:
    """
    Returns: stops, unplanned_ids, lunch_taken
    """
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

    # start home
    stops.append(PlannedStop(
        kind="home",
        label=f"Home: {req.home.label}",
        start=start_dt.isoformat(),
        end=start_dt.isoformat(),
        travel_min_from_prev=0
    ))

    def can_lunch_at(t: datetime) -> bool:
        return (t >= lunch_ws) and (t + lunch_dur <= lunch_we)

    def should_take_lunch_today() -> bool:
        # If the schedule would end before lunch window starts, we don't force lunch.
        # (Assistant can recommend it, but we won't insert it.)
        return True

    def insert_lunch_if_opportune(before_travel_min: int, next_start_candidate: datetime) -> bool:
        nonlocal lunch_taken, current_time

        if lunch_taken:
            return False

        # If we're already past lunch window end, too late.
        if current_time >= lunch_we:
            return False

        # If the day would end before lunch window starts, don't insert.
        # (We can't know final end exactly here; but if current_time is still morning and no more appointments later,
        # analysis will catch it. We'll also avoid forcing lunch if already no ap left after noon in many cases.)
        if not should_take_lunch_today():
            return False

        # We insert lunch when:
        # - we're inside the window, OR
        # - the next appointment would overlap the window (meaning we'd "miss" lunch)
        overlaps_window = (next_start_candidate < lunch_we) and (next_start_candidate + timedelta(minutes=0) >= lunch_ws)
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

    # schedule appointments
    for ap in ordered:
        dur_min = ap.duration_min or DURATION_MIN[ap.type]
        dur_td = timedelta(minutes=dur_min)

        # compute travel & arrival if we go now
        travel_min = travel_minutes(current_loc, ap.location, req.avg_speed_kmh)
        start_candidate = current_time + timedelta(minutes=travel_min)

        # Try to insert lunch opportunistically before moving to this appointment
        inserted = insert_lunch_if_opportune(travel_min, start_candidate)
        if inserted:
            # recompute after lunch
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

    # Optional: return home if it fits
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

    return stops, unplanned, lunch_taken

def compute_analysis(req: SuggestRequest, stops: List[PlannedStop], unplanned: List[str]) -> PlanAnalysis:
    buffer_min = req.buffer_min

    total_travel = sum(s.travel_min_from_prev for s in stops)
    planned_appointments = sum(1 for s in stops if s.kind == "appointment")

    # Compute idle time excluding travel and excluding buffer (buffer is neutral)
    idle_min = 0
    long_blocks: List[int] = []

    # Rebuild datetimes
    dt_starts = [datetime.fromisoformat(s.start) for s in stops]
    dt_ends = [datetime.fromisoformat(s.end) for s in stops]

    for i in range(1, len(stops)):
        prev = stops[i - 1]
        gap = dt_starts[i] - dt_ends[i - 1]
        gap_min = max(0, int(gap.total_seconds() // 60))

        # subtract travel (already accounted separately)
        travel = stops[i].travel_min_from_prev

        # subtract buffer if previous was appointment (since we deliberately add it)
        buf = buffer_min if prev.kind == "appointment" else 0

        effective_idle = max(0, gap_min - travel - buf)
        idle_min += effective_idle
        if effective_idle >= 45:
            long_blocks.append(effective_idle)

    # Multi-objective score (tunable)
    # - reward appointments
    # - penalize travel
    # - penalize idle
    # - huge penalty for long idle blocks
    score = 0
    score += planned_appointments * 120
    score -= total_travel * 2
    score -= idle_min * 5
    score -= sum(50 for _ in long_blocks)

    # clamp to 0..100 for readability
    score_0_100 = max(0, min(100, int(round(score / 10))))

    rec: List[str] = []
    if long_blocks:
        rec.append(f"⚠️ Trou(s) long(s) détecté(s) : {long_blocks} min.")
        rec.append("Idée: déplacer lunch, permuter 2 RDV, ou ajouter un RDV dans la zone.")
    else:
        rec.append("✅ Pas de trou > 45 min. Planning fluide.")

    if idle_min > 0 and not long_blocks:
        rec.append(f"Temps mort total (hors route/buffer): {idle_min} min.")

    if total_travel > 120:
        rec.append("⚠️ Beaucoup de route. Variante 'short_drive' à privilégier si possible.")

    if unplanned:
        rec.append(f"⚠️ RDV non planifiés: {len(unplanned)} (trop dense / trop loin / fin 16:30).")

    return PlanAnalysis(
        score=score_0_100,
        total_travel_min=total_travel,
        idle_min=idle_min,
        long_idle_blocks_min=long_blocks,
        planned_appointments=planned_appointments,
        unplanned_appointments=len(unplanned),
        recommendations=rec
    )

def build_variants(req: SuggestRequest) -> List[SuggestVariant]:
    aps = req.appointments

    # Variant 1: "balanced" (nearest-neighbor greedy from current position)
    remaining = aps.copy()
    order_balanced: List[AppointmentRequest] = []
    cur = req.home
    while remaining:
        remaining.sort(key=lambda a: haversine_km((cur.lat, cur.lon), (a.location.lat, a.location.lon)))
        nxt = remaining.pop(0)
        order_balanced.append(nxt)
        cur = nxt.location

    # Variant 2: "short_drive" (sort by distance from home ascending)
    order_short = sorted(aps, key=lambda a: distance_from_home(req.home, a))

    # Variant 3: "dense" (try to fit more: shorter duration first, tie-break by distance)
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
        stops, unplanned, _ = schedule_in_order(name, req, order)
        analysis = compute_analysis(req, stops, unplanned)
        out.append(SuggestVariant(name=name, stops=stops, unplanned=unplanned, analysis=analysis))

    # sort best first
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
