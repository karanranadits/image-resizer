"""
Domain models: pure data structures with no dependency on Pillow, FastAPI,
or any other framework/library. This is the innermost layer of the
architecture — everything else depends on this, this depends on nothing.
"""

from dataclasses import dataclass, field
from enum import Enum


class ImageFormat(str, Enum):
    JPEG = "jpeg"
    PNG = "png"
    WEBP = "webp"


class SizeUnit(str, Enum):
    KB = "KB"
    KiB = "KiB"
    MB = "MB"
    MiB = "MiB"

    def to_bytes(self, value: float) -> int:
        if self is SizeUnit.KB:
            return int(value * 1000)
        elif self is SizeUnit.KiB:
            return int(value * 1024)
        elif self is SizeUnit.MB:
            return int(value * 1000 * 1000)
        elif self is SizeUnit.MiB:
            return int(value * 1024 * 1024)
        return int(value * 1000)


@dataclass(frozen=True)
class ResizeRequest:
    """Use-case input: raw bytes of the source image and the desired output."""
    source_bytes: bytes
    target_bytes: int
    output_format: ImageFormat


@dataclass(frozen=True)
class CompressionResult:
    """Output of a Compressor: the smallest-under-target bytes it could find."""
    image_bytes: bytes
    width: int
    height: int
    quality: int | None  # None for formats without a quality dial (PNG)


@dataclass(frozen=True)
class ResizeResult:
    """Final use-case output returned to the API layer."""
    image_bytes: bytes
    achieved_size_bytes: int
    target_size_bytes: int
    original_size_bytes: int
    output_format: ImageFormat
    exact_match: bool
    warnings: list[str] = field(default_factory=list)
