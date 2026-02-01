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
    lunch_window_start: str = "12:00"   # fenêtre début
    lunch_window_end: str = "14:00"     # fenêtre fin
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

class SuggestResponse(BaseModel):
    stops: List[PlannedStop]
    unplanned: List[str]

# --- UTILS ---
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

def parse_hhmm(hhmm: str) -> time:
    h, m = hhmm.split(":")
    return time(int(h), int(m))

# --- ROUTES ---
@app.get("/health")
def health():
    return {"ok": True}

@app.post("/suggest", response_model=SuggestResponse)
def suggest(req: SuggestRequest):
    day = datetime.fromisoformat(req.date)

    start_dt = datetime.combine(day.date(), parse_hhmm(req.start_time))
    end_dt = datetime.combine(day.date(), parse_hhmm(req.end_time))

    lunch_ws = datetime.combine(day.date(), parse_hhmm(req.lunch_window_start))
    lunch_we = datetime.combine(day.date(), parse_hhmm(req.lunch_window_end))
    lunch_dur = timedelta(minutes=req.lunch_duration_min)

    buffer_td = timedelta(minutes=req.buffer_min)

    remaining = req.appointments.copy()
    current_loc = req.home
    current_time = start_dt

    stops: List[PlannedStop] = []
    unplanned: List[str] = []

    lunch_taken = False

    def can_place_lunch_at(t: datetime) -> bool:
        return (t >= lunch_ws) and (t + lunch_dur <= lunch_we)

    def place_lunch(at_time: datetime):
        nonlocal current_time, lunch_taken
        stops.append(PlannedStop(
            kind="lunch",
            label="Lunch",
            start=at_time.isoformat(),
            end=(at_time + lunch_dur).isoformat(),
            travel_min_from_prev=0
        ))
        current_time = at_time + lunch_dur
        lunch_taken = True

    # Start at home
    stops.append(PlannedStop(
        kind="home",
        label=f"Home: {req.home.label}",
        start=start_dt.isoformat(),
        end=start_dt.isoformat(),
        travel_min_from_prev=0
    ))

    while remaining:
        # --- Strategy lunch (flex 12-14, 30min) ---
        # If we are already inside the window and lunch not taken -> take it ASAP (unless too late to fit)
        if (not lunch_taken) and can_place_lunch_at(current_time):
            place_lunch(current_time)
            continue

        # pick next closest
        remaining.sort(key=lambda ap: haversine_km(
            (current_loc.lat, current_loc.lon),
            (ap.location.lat, ap.location.lon)
        ))
        candidate = remaining[0]
        dur_min = candidate.duration_min or DURATION_MIN[candidate.type]
        dur_td = timedelta(minutes=dur_min)

        travel = travel_minutes(current_loc, candidate.location, req.avg_speed_kmh)
        arrival = current_time + timedelta(minutes=travel)

        start_ap = arrival

        # If lunch not taken and appointment would collide with lunch window,
        # we try to place lunch at the best possible moment.
        if not lunch_taken:
            # Case 1: appointment would start before lunch window but run into it
            if start_ap < lunch_ws and (start_ap + dur_td) > lunch_ws:
                # take lunch at lunch_ws (if possible)
                if can_place_lunch_at(lunch_ws):
                    place_lunch(lunch_ws)
                    continue

            # Case 2: appointment would start during lunch window
            if lunch_ws <= start_ap < lunch_we:
                # place lunch at start_ap if it fits, else at earliest in window
                t = start_ap
                if not can_place_lunch_at(t):
                    t = lunch_ws
                if can_place_lunch_at(t):
                    place_lunch(t)
                    continue
                # if lunch can't fit anymore, we skip lunch (rare), continue scheduling

        # After lunch logic, recompute start (current_time may have moved)
        travel = travel_minutes(current_loc, candidate.location, req.avg_speed_kmh)
        arrival = current_time + timedelta(minutes=travel)
        start_ap = arrival
        end_ap = start_ap + dur_td

        # bounds check
        if end_ap > end_dt:
            unplanned.append(candidate.id)
            remaining = [x for x in remaining if x.id != candidate.id]
            continue

        stops.append(PlannedStop(
            kind="appointment",
            id=candidate.id,
            label=f"{candidate.type.upper()} — {candidate.location.label}",
            start=start_ap.isoformat(),
            end=end_ap.isoformat(),
            travel_min_from_prev=travel
        ))

        # move time forward: appointment + buffer
        current_time = end_ap + buffer_td
        current_loc = candidate.location
        remaining = [x for x in remaining if x.id != candidate.id]

    # If lunch still not taken, and we are before end of lunch window, place it at the earliest possible slot
    if (not lunch_taken) and can_place_lunch_at(max(current_time, lunch_ws)):
        place_lunch(max(current_time, lunch_ws))

    # return home
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

    return SuggestResponse(stops=stops, unplanned=unplanned)



