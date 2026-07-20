# Exact Image Resizer

Resize/compress an image to hit a **precise target file size**, down to the
exact byte for JPEG and PNG (bit-exact padding trick), with best-effort
closest-match for WebP.

## Architecture (Clean Architecture, SOLID, DRY)

```
backend/
├── domain/                  # Pure data + exceptions, zero external deps
│   ├── models.py
│   └── exceptions.py
├── infrastructure/          # The ONLY layer that imports Pillow
│   └── image_codec.py
├── services/                # Business logic / use cases
│   ├── compressor.py        # Strategy pattern: JPEG/WebP/PNG compression
│   ├── padder.py            # Strategy pattern: exact-byte padding
│   └── resizer_service.py   # Orchestrates compressor + padder
├── api/                     # HTTP layer (FastAPI)
│   ├── routes.py
│   └── schemas.py
├── main.py                  # App assembly / DI wiring
├── requirements.txt
└── test_resizer.py          # Standalone test, no server needed

frontend/
├── index.html               # Main UI
├── styles.css               # Extracted CSS styles
├── config.js                # Frontend configuration
└── script.js                # Extracted JS logic
```

**Why this shape:**
- `domain` has zero dependencies — everything else depends on it, it depends on nothing.
- `infrastructure/image_codec.py` isolates Pillow. Swap imaging libraries later without touching business logic.
- `services/compressor.py` and `services/padder.py` use the **Strategy pattern** (`Compressor`/`Padder` abstract base classes) with a **Factory** (`CompressorFactory`/`PadderFactory`) picking the right implementation per format — format-branching logic lives in exactly one place each (DRY).
- `QualityDialCompressor` holds the shared binary-search-on-quality + progressive-downscale algorithm once, reused by both `JpegCompressor` and `WebpCompressor` (DRY, Open/Closed — add AVIF later by adding one small subclass).
- `resizer_service.py` is the use case orchestrator — no Pillow calls, no HTTP, just coordinates the strategies.
- `api/routes.py` only translates HTTP ↔ domain objects.

## How exact sizing works

1. **Compress toward target:** binary search JPEG/WebP quality (1–95) to get the largest quality that still fits under the target byte count. If even quality=1 is too big, progressively downscale resolution (10% steps) and retry. PNG has no quality dial, so it's pure resolution search at max lossless compression.
2. **Pad to exact:** once compressed bytes are at-or-under target, append harmless format-legal filler:
   - **JPEG:** a COM (comment) marker segment (`FF FE`) right after the SOI marker — every decoder ignores it.
   - **PNG:** a private ancillary chunk (`juNk`) right after IHDR — every spec-compliant decoder skips unknown ancillary chunks.
   - **WebP:** not yet implemented (RIFF container padding is more involved) — falls back to closest-achievable with a warning.

There's a hard floor on exactness: a JPEG COM segment needs at least 4 bytes of overhead, and a PNG chunk needs at least 12. So a 1–3 byte (JPEG) or 1–11 byte (PNG) gap can't be filled exactly — the tool rounds up slightly in that rare case rather than under-shooting.

## Run with Docker (Recommended)

The easiest way to run the application is using Docker Compose.

```bash
docker-compose up --build
```

- **Frontend** will be available at `http://localhost:8080`
- **Backend API** will be running at `http://localhost:8002` (interactive docs at `http://localhost:8002/docs`)

## Manual Setup

### Run the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
```

### Run the frontend

Serve the `frontend/` directory with any static file server. It's configured to call the API at `http://localhost:8002/api`. To deploy the backend elsewhere, edit the `API_BASE` constant in `frontend/config.js`.

## Test the core engine without running a server

```bash
cd backend
python3 test_resizer.py
```

This exercises the full compress + pad pipeline across several formats and
target sizes and verifies every output is a valid, openable image.

## API

`POST /api/resize` (multipart/form-data)

| Field | Type | Description |
|---|---|---|
| `file` | file | The image to resize |
| `target_size` | float | Numeric target size |
| `unit` | `KB` \| `MB` | Unit for target_size |
| `output_format` | `jpeg` \| `png` \| `webp` | Output format (default `jpeg`) |

Response: the processed image as binary body, plus an `X-Resize-Metadata`
response header containing JSON:

```json
{
  "original_size_bytes": 132545,
  "target_size_bytes": 204800,
  "achieved_size_bytes": 204800,
  "exact_match": true,
  "output_format": "jpeg",
  "warnings": []
}
```

## Extending

- **New format (e.g. AVIF):** add an `AvifCompressor(QualityDialCompressor)` and register it in `CompressorFactory._registry`. No other file changes.
- **WebP exact padding:** implement a `WebpPadder(Padder)` that inserts a padding RIFF chunk, register it in `PadderFactory._registry`.
