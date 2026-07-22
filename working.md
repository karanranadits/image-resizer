# How an Image is Resized — Full Backend Flow

## Dead Code Cleaned Up

| Removed | File | Reason |
|---|---|---|
| `import base64` | `api/routes.py` line 1 | Imported, never called anywhere |
| `ResizeMetadata` class | `api/schemas.py` | Defined, never imported by any other file |
| `ErrorResponse` class | `api/schemas.py` | Defined, never imported by any other file |
| Entire `api/schemas.py` | — | Completely dead after the above |

---

## Architecture: 4 Layers, Each Only Knows About the One Below

```
Browser
   ↓  HTTP POST /api/resize
[ api/routes.py ]                       ← knows HTTP, knows nothing about Pillow
   ↓
[ services/resizer_service.py ]         ← orchestrates, knows neither HTTP nor Pillow
   ↓
[ services/compressor.py + padder.py ]  ← algorithms, still no Pillow
   ↓
[ infrastructure/image_codec.py ]       ← the ONLY file that imports Pillow
   ↓
[ domain/models.py + exceptions.py ]    ← pure data, no dependencies at all
```

---

## Step 1 — Browser Sends the Request
**`frontend/script.js`**

When you click "Resize image", the browser builds a `FormData` object and fires an `XMLHttpRequest POST` to `/api/resize` with:
- `file` → the raw image bytes
- `target_size` → e.g. `150`
- `unit` → e.g. `"KB"`
- `output_format` → `"jpeg"` / `"png"` / `"webp"`

It uses `XMLHttpRequest` (not `fetch`) so we can track `upload.progress` events for the progress bar and ETA display.

---

## Step 2 — API Entry Point
**`api/routes.py` → `resize_image()`**

```python
async def resize_image(file, target_size, unit, output_format):
    source_bytes = await file.read()           # reads all uploaded bytes into RAM
    target_bytes = unit.to_bytes(target_size)  # "150 KB" → 150,000  (exact integer)

    request = ResizeRequest(
        source_bytes=source_bytes,
        target_bytes=target_bytes,
        output_format=output_format,
    )
    result = _service.resize(request)
```

FastAPI auto-parses the `Form(...)` fields and validates types. It then packages everything into a `ResizeRequest` dataclass (a frozen, immutable object — can't be changed after creation) and hands it to the service layer. This function knows nothing about image processing — it only deals with HTTP in/out.

After the service finishes:
```python
headers = {
    "X-Resize-Metadata": json.dumps(metadata),   # sizes, exact_match, warnings
    "Content-Disposition": 'attachment; filename="resized.jpeg"',
}
return Response(content=result.image_bytes, media_type="image/jpeg", headers=headers)
```

The image bytes go in the response **body**. The metadata (original size, achieved size, exact match flag, any warnings) go in a custom **HTTP header** called `X-Resize-Metadata` as JSON. That way the browser gets both image data AND stats in one single HTTP round-trip.

---

## Step 3 — Unit Conversion
**`domain/models.py` → `SizeUnit.to_bytes(value)`**

```python
def to_bytes(self, value: float) -> int:
    if self is SizeUnit.KB:    return int(value * 1000)       # 150 KB  = 150,000 bytes
    elif self is SizeUnit.KiB: return int(value * 1024)       # 150 KiB = 153,600 bytes
    elif self is SizeUnit.MB:  return int(value * 1_000_000)
    elif self is SizeUnit.MiB: return int(value * 1_048_576)
```

**This is the entire reason for the KB vs KiB distinction.**
- `KB` = SI standard (what `ls --si` and Ubuntu file properties show) → 1000 bytes
- `KiB` = Binary standard (what `ls -l` and Windows shows) → 1024 bytes

When you say "150 KB", the backend targets exactly `150,000` bytes. The output file will show as `150 kB` in your file manager and terminal `ls --si`.

---

## Step 4 — Service Layer Orchestrates
**`services/resizer_service.py` → `ResizerService.resize(request)`**

This is the conductor. It calls everything else in order:

### 4a. Decode the image
```python
original_image = image_codec.decode(request.source_bytes)
```
Turns the raw uploaded bytes into a Pillow `Image` object held in memory. See Step 7 for what `decode()` does internally.

### 4b. Prepare for format
```python
prepared_image = self._prepare_for_format(original_image, request.output_format.value)
```
**Only matters for JPEG.** JPEG cannot store transparency (alpha channel). If your image is a PNG with a transparent background, this step flattens the transparency onto a solid white background and converts to RGB mode. PNG and WebP skip this step entirely.

### 4c. Get a compressor for the format
```python
compressor = CompressorFactory.get(request.output_format.value)
compression_result = compressor.compress(prepared_image, request.target_bytes)
```
The `CompressorFactory` looks up which compressor strategy to use based on format:
- `"jpeg"` → `JpegCompressor`
- `"webp"` → `WebpCompressor`
- `"png"` → `PngCompressor`

The compressor's job is to bring the file **at or under** the target (not necessarily exact — the padder handles the last few bytes). See Step 5 for the full compression algorithm.

### 4d. Apply padding to hit the exact byte count
```python
padder = PadderFactory.get(request.output_format.value)
if len(image_bytes) < request.target_bytes:
    image_bytes = padder.pad_to_exact(image_bytes, request.target_bytes)
```
If the compressed output came in under the target (e.g. 149,820 bytes when you wanted 150,000), the padder fills the remaining 180 bytes with invisible format-legal padding. See Step 6.

### 4e. Handle the impossible case
```python
except TargetUnreachableError as exc:
    warnings.append("Target of X bytes is smaller than the smallest achievable...")
    compression_result = self._smallest_possible(prepared_image, compressor)
```
If even a 1×1 pixel image at quality=1 is **still bigger** than your target, compression cannot reach it. The service catches this, warns the user, and returns the smallest possible file instead of crashing.

---

## Step 5 — Compression Algorithm
**`services/compressor.py`**

### For JPEG and WebP — `QualityDialCompressor.compress()`

These formats have a quality dial (1–95). Higher quality = larger file.

**The algorithm:**
```
OUTER LOOP (resolution loop):
  1. Encode image at quality = 1  (worst possible quality, smallest file at this resolution)
  2. Is this ≤ target?
       YES → run binary search on quality (Step 5a). Done.
       NO  → image is too big even at worst quality. Shrink it 10% and repeat.
  3. If image is 1×1 px and still too big → raise TargetUnreachableError
```

**`_smallest_possible_size(image)`** — encodes at quality=1 to find the absolute floor for the current resolution. Used to decide whether binary search is worth trying.

**`_search_quality(image, target_bytes)`** — binary search:
```
low = 1, high = 95, best = quality-1 encoding

8 iterations (2^8 = 256 covers the 1-95 range comfortably):
  mid = (low + high) / 2
  encode at mid quality
  if size ≤ target:
      this is our new best result → push low up (try higher quality)
  else:
      too big → push high down (try lower quality)

Returns the highest quality that fits → best-looking image possible at target size.
```

### For PNG — `PngCompressor.compress()`

PNG is **lossless** — there is no quality dial. You can't degrade quality to save bytes. The only lever is resolution (fewer pixels = smaller file).

```
LOOP:
  1. Encode image at max compression level (compress_level=9)
  2. Fits? Done.
  3. Still too big? Shrink by 10%, repeat.
  4. If 1×1 px and still too big → TargetUnreachableError
```

---

## Step 6 — Byte-Exact Padding
**`services/padder.py`**

After compression, the file is almost never **exactly** the target. It's always a bit under (e.g. 149,820 bytes when you want 150,000). The padder injects invisible filler bytes directly into the file's binary structure.

### JPEG — `JpegPadder.pad_to_exact()`

Every JPEG starts with `FF D8` (the SOI — Start Of Image marker). JPEG has a "comment" marker segment called `COM` (`FF FE`) that all decoders universally skip.

**The padder inserts a COM segment immediately after the SOI:**
```
BEFORE: [FF D8] [FF E0 ...JFIF header...] [FF DB ...pixel data...] [FF D9 EOI]
AFTER:  [FF D8] [FF FE][LEN][0x00 × N]   [FF E0 ...] [FF DB ...] [FF D9 EOI]
                  ↑ COM segment, N = bytes needed to reach target
```

**`_build_com_segment(payload_size)`** — builds the raw bytes: marker (`FF FE`) + 2-byte big-endian length + N null bytes.

**`_build_segment_chain(total_bytes)`** — a single COM segment can only hold up to 65,533 bytes (the 2-byte length field caps at 65,535 total, minus 2 for itself). If you need more padding than that, it chains multiple COM segments together.

**Edge case:** If the gap is 1–3 bytes (smaller than the 4-byte minimum COM segment overhead), it appends null bytes **after the EOI** (end-of-image marker) instead. Image decoders stop reading at EOI and ignore trailing bytes.

### PNG — `PngPadder.pad_to_exact()`

PNG is a sequence of chunks: `[4-byte length][4-byte type][payload][4-byte CRC]`. The spec says: any chunk whose first letter is lowercase is "ancillary" (optional) — decoders must skip it if they don't recognize it.

**The padder inserts a `juNk` chunk right after the mandatory `IHDR` chunk:**
```
BEFORE: [PNG sig][IHDR chunk][IDAT chunk...][IEND]
AFTER:  [PNG sig][IHDR chunk][juNk chunk, N null bytes][IDAT chunk...][IEND]
```

**`_find_ihdr_end(data)`** — calculates the exact byte offset where IHDR ends (always at a fixed position: 8-byte PNG signature + 4-byte length + 4-byte type + 13-byte payload + 4-byte CRC = byte 33).

**`_build_chunk(payload_size)`** — builds the chunk bytes including computing a real CRC32 checksum so the file remains spec-valid.

**Edge case:** If the gap is 1–11 bytes (smaller than the 12-byte minimum chunk overhead), it appends null bytes to the end of the file.

### WebP — `NullPadder`

WebP uses a RIFF container. The padding rules are complex and not yet implemented. `NullPadder.can_pad()` always returns `False`, so the service layer surfaces a warning to the user: *"Exact byte-padding not supported for WebP"*. The closest possible file size is returned instead.

---

## Step 7 — Infrastructure (Pillow Wrapper)
**`infrastructure/image_codec.py`**

This is the **only** file in the entire backend that imports Pillow. Every other layer is library-agnostic. If you ever wanted to swap Pillow for a different imaging library, you'd only change this one file.

| Function | What it does |
|---|---|
| `decode(bytes)` | Opens bytes as a Pillow Image. Calls `.load()` to force full decode into memory. Raises `InvalidImageError` if unreadable |
| `to_rgb(image)` | If the image has transparency (RGBA, LA, or Palette mode), pastes it onto a white RGB background. Converts any other non-RGB mode to RGB. Required before JPEG encoding |
| `resize(image, scale)` | Multiplies width and height by `scale` (e.g. `0.9` = 90% of original). Floors at minimum 1×1 px. Uses `LANCZOS` filter for high-quality downsampling |
| `encode_jpeg(image, quality)` | Saves Pillow Image to an in-memory `BytesIO` buffer as JPEG at the given quality with `optimize=True`. Returns raw bytes |
| `encode_webp(image, quality)` | Same but WebP format |
| `encode_png(image)` | Same but PNG at `compress_level=9` (maximum compression) with `optimize=True` |

---

## Complete Flow Diagram

```
You set: 150 KB, JPEG
         │
         ▼
Browser → POST /api/resize (file bytes + "150" + "KB" + "jpeg")
         │
         ▼
routes.py:  read file → unit.to_bytes("150 KB") = 150,000 → build ResizeRequest
         │
         ▼
resizer_service.resize():
  │
  ├─ image_codec.decode()    → raw bytes → Pillow Image (e.g. 3MB, 4000×3000px)
  ├─ image_codec.to_rgb()    → strip alpha if any (JPEG requirement)
  │
  ├─ JpegCompressor.compress(image, 150000):
  │    Iteration 1:  encode at quality=1 → 48,000 bytes → fits! binary search starts
  │    Binary search:
  │      mid=48: encode → 162,000 bytes → too big, go lower
  │      mid=24: encode → 112,000 bytes → fits! new best, go higher
  │      mid=36: encode → 145,000 bytes → fits! new best, go higher
  │      mid=42: encode → 158,000 bytes → too big, go lower
  │      mid=39: encode → 149,820 bytes → fits! new best, go higher
  │      ... 3 more steps to fine-tune
  │    Result: 149,820 bytes at quality=39  (under target by 180 bytes)
  │
  ├─ JpegPadder.pad_to_exact(149820 bytes, 150000):
  │    needed = 180 bytes
  │    _build_segment_chain(180):
  │      one COM segment: [FF FE][00 B6][0x00 × 176] = 180 bytes exactly
  │    Insert after SOI:
  │      [FF D8] + [180-byte COM segment] + [rest of JPEG data]
  │    Result: exactly 150,000 bytes ✓
  │
  └─ ResizeResult { image_bytes=<150000 bytes>, achieved=150000, exact=True }
         │
         ▼
routes.py → HTTP Response  body=image bytes,  X-Resize-Metadata={"exact_match":true,...}
         │
         ▼
Browser → progress bar completes → "Exact match ✓" → Download button appears
```
