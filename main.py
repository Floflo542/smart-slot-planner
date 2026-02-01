from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS: autorise ton frontend Vercel à appeler l'API Railway
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://smart-slot-planner.vercel.app",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}
