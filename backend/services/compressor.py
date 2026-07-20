"""
Compressor strategies. Each Compressor knows how to get an image's encoded
byte size AT OR UNDER a target, for one specific format. The generic
"binary search quality, then step down resolution if needed" algorithm
lives once in the abstract base class (DRY) and is reused by any format
that has a quality dial (JPEG, WebP). PNG has no quality dial, so it
overrides the strategy with a pure resolution search.
"""

from abc import ABC, abstractmethod

from PIL import Image

from domain.exceptions import TargetUnreachableError
from domain.models import CompressionResult
from infrastructure import image_codec

MIN_QUALITY = 1
MAX_QUALITY = 95
QUALITY_SEARCH_ITERATIONS = 8  # binary search steps; 2^8 = 256 > 95 range, plenty
SCALE_STEP = 0.9  # shrink by 10% each time resolution needs to come down
MIN_SCALE = 0.01  # never fully vanish; image_codec.resize floors at 1x1 anyway


class Compressor(ABC):
    """Strategy interface: compress an image to at-or-under target_bytes."""

    @abstractmethod
    def compress(self, image: Image.Image, target_bytes: int) -> CompressionResult:
        ...


class QualityDialCompressor(Compressor):
    """Shared algorithm for any format with a 1-100 quality parameter
    (JPEG, WebP). Subclasses only provide the format-specific encode call.
    """

    def _encode(self, image: Image.Image, quality: int) -> bytes:
        raise NotImplementedError

    def _smallest_possible_size(self, image: Image.Image) -> int:
        """Size at lowest quality — the floor for the current resolution."""
        return len(self._encode(image, MIN_QUALITY))

    def _search_quality(self, image: Image.Image, target_bytes: int) -> tuple[bytes, int]:
        """Binary search for the highest quality whose size <= target_bytes.
        Assumes _smallest_possible_size(image) <= target_bytes (checked by caller).
        """
        low, high = MIN_QUALITY, MAX_QUALITY
        best_bytes = self._encode(image, MIN_QUALITY)
        best_quality = MIN_QUALITY

        for _ in range(QUALITY_SEARCH_ITERATIONS):
            if low > high:
                break
            mid = (low + high) // 2
            candidate = self._encode(image, mid)
            if len(candidate) <= target_bytes:
                # Fits — this is our new best, try to push quality higher.
                best_bytes, best_quality = candidate, mid
                low = mid + 1
            else:
                high = mid - 1

        return best_bytes, best_quality

    def compress(self, image: Image.Image, target_bytes: int) -> CompressionResult:
        working_image = image
        scale = 1.0

        while True:
            floor_size = self._smallest_possible_size(working_image)

            if floor_size <= target_bytes:
                best_bytes, best_quality = self._search_quality(working_image, target_bytes)
                return CompressionResult(
                    image_bytes=best_bytes,
                    width=working_image.width,
                    height=working_image.height,
                    quality=best_quality,
                )

            # Even minimum quality is too big at this resolution — shrink further.
            if scale <= MIN_SCALE or (working_image.width <= 1 and working_image.height <= 1):
                raise TargetUnreachableError(
                    smallest_achievable_bytes=floor_size, target_bytes=target_bytes
                )

            scale *= SCALE_STEP
            working_image = image_codec.resize(image, scale)


class JpegCompressor(QualityDialCompressor):
    def _encode(self, image: Image.Image, quality: int) -> bytes:
        return image_codec.encode_jpeg(image, quality)


class WebpCompressor(QualityDialCompressor):
    def _encode(self, image: Image.Image, quality: int) -> bytes:
        return image_codec.encode_webp(image, quality)


class PngCompressor(Compressor):
    """PNG has no quality dial — it's lossless. The only lever is
    resolution (fewer pixels = fewer bytes, deterministically, at max
    compression level).
    """

    def compress(self, image: Image.Image, target_bytes: int) -> CompressionResult:
        working_image = image
        scale = 1.0

        while True:
            encoded = image_codec.encode_png(working_image)

            if len(encoded) <= target_bytes:
                return CompressionResult(
                    image_bytes=encoded,
                    width=working_image.width,
                    height=working_image.height,
                    quality=None,
                )

            if scale <= MIN_SCALE or (working_image.width <= 1 and working_image.height <= 1):
                raise TargetUnreachableError(
                    smallest_achievable_bytes=len(encoded), target_bytes=target_bytes
                )

            scale *= SCALE_STEP
            working_image = image_codec.resize(image, scale)


class CompressorFactory:
    """Single place where format -> Compressor mapping lives (DRY: no
    other file branches on format for compression purposes).
    """

    _registry = {
        "jpeg": JpegCompressor,
        "webp": WebpCompressor,
        "png": PngCompressor,
    }

    @classmethod
    def get(cls, format_value: str) -> Compressor:
        try:
            return cls._registry[format_value]()
        except KeyError:
            raise ValueError(f"No compressor registered for format '{format_value}'")
