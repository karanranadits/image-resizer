"""
Standalone sanity test for the resizer service — no FastAPI/uvicorn
required, only Pillow. Run with: python3 test_resizer.py

Useful to verify the core engine works in your environment before
starting the API server.
"""

import io
import random

from PIL import Image

from domain.models import ImageFormat, ResizeRequest, SizeUnit
from services.resizer_service import ResizerService


def make_test_image(width=800, height=600) -> bytes:
    """Noisy image so it doesn't compress trivially to near-zero size."""
    random.seed(7)
    img = Image.new("RGB", (width, height))
    pixels = img.load()
    for x in range(0, width, 4):
        for y in range(0, height, 4):
            color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
            for dx in range(4):
                for dy in range(4):
                    if x + dx < width and y + dy < height:
                        pixels[x + dx, y + dy] = color
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def run():
    source_bytes = make_test_image()
    print(f"Test source image: {len(source_bytes)} bytes ({len(source_bytes)/1024:.1f} KB)\n")

    service = ResizerService()

    cases = [
        (200, SizeUnit.KB, ImageFormat.JPEG),
        (50, SizeUnit.KB, ImageFormat.JPEG),
        (10, SizeUnit.KB, ImageFormat.JPEG),
        (300, SizeUnit.KB, ImageFormat.PNG),
        (100, SizeUnit.KB, ImageFormat.WEBP),
    ]

    all_ok = True
    for size, unit, fmt in cases:
        target_bytes = unit.to_bytes(size)
        request = ResizeRequest(source_bytes=source_bytes, target_bytes=target_bytes, output_format=fmt)
        result = service.resize(request)

        # Verify the output is a genuinely valid, openable image.
        try:
            Image.open(io.BytesIO(result.image_bytes)).load()
            valid = True
        except Exception:
            valid = False
            all_ok = False

        status = "OK" if valid else "FAILED (invalid image!)"
        print(
            f"[{status}] target={size}{unit.value} format={fmt.value:<5} "
            f"achieved={result.achieved_size_bytes}B exact={result.exact_match} "
            f"warnings={result.warnings}"
        )

    print("\nAll tests passed." if all_ok else "\nSOME TESTS FAILED.")


if __name__ == "__main__":
    run()
