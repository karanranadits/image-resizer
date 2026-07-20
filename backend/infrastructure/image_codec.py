"""
Infrastructure layer: the ONLY module in this codebase that imports Pillow.
Every other layer talks to images through this interface, so swapping the
imaging library later (e.g. to pillow-simd or wand) means touching only
this file.
"""

import io

from PIL import Image, UnidentifiedImageError

from domain.exceptions import InvalidImageError


def decode(source_bytes: bytes) -> Image.Image:
    """Decode raw bytes into a Pillow Image, raising a domain error on failure."""
    try:
        img = Image.open(io.BytesIO(source_bytes))
        img.load()
        return img
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("Uploaded file is not a readable image.") from exc


def to_rgb(image: Image.Image) -> Image.Image:
    """Flatten transparency onto a white background and convert to RGB.
    Required before saving as JPEG, which has no alpha channel.
    """
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def resize(image: Image.Image, scale: float) -> Image.Image:
    """Return a new image scaled by `scale` (0 < scale <= 1), min 1x1 px."""
    new_w = max(1, round(image.width * scale))
    new_h = max(1, round(image.height * scale))
    return image.resize((new_w, new_h), Image.LANCZOS)


def encode_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def encode_webp(image: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=quality)
    return buffer.getvalue()


def encode_png(image: Image.Image, compress_level: int = 9) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=compress_level, optimize=True)
    return buffer.getvalue()
