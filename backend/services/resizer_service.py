"""
Service layer / use case orchestration. This is the only place that wires
Compressor + Padder together. It has no knowledge of Pillow (that's
image_codec's job) and no knowledge of HTTP (that's the api layer's job) —
strict separation, per clean architecture.
"""

from domain.exceptions import TargetUnreachableError
from domain.models import ResizeRequest, ResizeResult
from infrastructure import image_codec
from services.compressor import CompressorFactory
from services.padder import PadderFactory


class ResizerService:
    """Use case: resize/compress an image to hit a target file size,
    using compression first and exact-byte padding second.
    """

    def resize(self, request: ResizeRequest) -> ResizeResult:
        warnings: list[str] = []

        original_image = image_codec.decode(request.source_bytes)
        original_size = len(request.source_bytes)

        prepared_image = self._prepare_for_format(original_image, request.output_format.value)

        compressor = CompressorFactory.get(request.output_format.value)

        try:
            compression_result = compressor.compress(prepared_image, request.target_bytes)
        except TargetUnreachableError as exc:
            warnings.append(
                f"Target of {request.target_bytes} bytes is smaller than the "
                f"smallest achievable size ({exc.smallest_achievable_bytes} bytes) "
                f"for this format even at minimum resolution/quality. "
                f"Returning the smallest possible file instead."
            )
            # Fall back to the smallest achievable representation: encode at
            # a 1x1 image / minimum quality so the caller still gets a result.
            compression_result = self._smallest_possible(prepared_image, compressor)

        padder = PadderFactory.get(request.output_format.value)

        image_bytes = compression_result.image_bytes
        if len(image_bytes) < request.target_bytes:
            if padder.can_pad(image_bytes):
                image_bytes = padder.pad_to_exact(image_bytes, request.target_bytes)
            else:
                warnings.append(
                    f"Exact byte-padding is not supported for "
                    f"'{request.output_format.value}'; returning closest "
                    f"achievable size instead of an exact match."
                )

        exact_match = len(image_bytes) == request.target_bytes

        return ResizeResult(
            image_bytes=image_bytes,
            achieved_size_bytes=len(image_bytes),
            target_size_bytes=request.target_bytes,
            original_size_bytes=original_size,
            output_format=request.output_format,
            exact_match=exact_match,
            warnings=warnings,
        )

    @staticmethod
    def _prepare_for_format(image, format_value: str):
        """Format-specific pre-processing that has to happen before any
        compressor runs (e.g. JPEG can't encode an alpha channel).
        """
        if format_value == "jpeg":
            return image_codec.to_rgb(image)
        return image

    @staticmethod
    def _smallest_possible(image, compressor):
        """Used only when the target is unreachable: force the absolute
        smallest representation the compressor can produce, by asking for
        an impossible-to-miss target of 0 bytes handled via its own search
        logic (it will bottom out at minimum quality/resolution).
        """
        from domain.models import CompressionResult
        from infrastructure import image_codec as codec

        # Shrink to 1x1 as the true floor, encode at lowest settings.
        tiny = codec.resize(image, 0.01)
        if hasattr(compressor, "_encode"):
            data = compressor._encode(tiny, 1)
            quality = 1
        else:
            data = codec.encode_png(tiny)
            quality = None
        return CompressionResult(image_bytes=data, width=tiny.width, height=tiny.height, quality=quality)
