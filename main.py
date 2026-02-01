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
    lunch_start: str = "12:00"
    lunch_end: str = "12:30"

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
    lunch_s = datetime.combine(day.date(), parse_hhmm(req.lunch_start))
    lunch_e = datetime.combine(day.date(), parse_hhmm(req.lunch_end))

    remaining = req.appointments.copy()
    current_loc = req.home
    current_time = start_dt

    stops: List[PlannedStop] = []
    unplanned: List[str] = []

    stops.append(PlannedStop(
        kind="home",
        label=f"Home: {req.home.label}",
        start=start_dt.isoformat(),
        end=start_dt.isoformat(),
        travel_min_from_prev=0
    ))

    def add_lunch_if_needed():
        nonlocal current_time
        if lunch_s <= current_time < lunch_e:
            stops.append(PlannedStop(
                kind="lunch",
                label="Lunch",
                start=current_time.isoformat(),
                end=lunch_e.isoformat(),
                travel_min_from_prev=0
            ))
            current_time = lunch_e

    while remaining:
        add_lunch_if_needed()

        remaining.sort(key=lambda ap: haversine_km(
            (current_loc.lat, current_loc.lon),
            (ap.location.lat, ap.location.lon)
        ))
        candidate = remaining[0]

        dur = candidate.duration_min or DURATION_MIN[candidate.type]
        travel = travel_minutes(current_loc, candidate.location, req.avg_speed_kmh)

        arrival = current_time + timedelta(minutes=travel)
        start_ap = arrival

        if start_ap < lunch_e and (start_ap + timedelta(minutes=dur)) > lunch_s:
            start_ap = lunch_e

        end_ap = start_ap + timedelta(minutes=dur)

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

        current_time = end_ap
        current_loc = candidate.location
        remaining = [x for x in remaining if x.id != candidate.id]

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

