from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router

app = FastAPI(
    title="Image Resizer API",
    description="Resize/compress images to an exact target file size.",
    version="1.0.0",
)

# Permissive CORS for local development with a static HTML/JS frontend.
# Tighten allow_origins for production use.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Resize-Metadata", "Content-Disposition"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
def health_check():
    return {"status": "ok"}
