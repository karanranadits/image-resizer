"""Domain-specific exceptions. Framework-agnostic — the API layer maps
these to HTTP status codes; nothing in here knows about HTTP.
"""


class ImageResizerError(Exception):
    """Base class for all domain errors raised by the resizer."""


class InvalidImageError(ImageResizerError):
    """Raised when the uploaded bytes can't be decoded as an image."""


class TargetUnreachableError(ImageResizerError):
    """Raised when the target size cannot be reached even at the smallest
    possible dimensions/quality, and padding cannot make up the difference
    (e.g. target is smaller than the minimum possible encoded size).
    """

    def __init__(self, smallest_achievable_bytes: int, target_bytes: int):
        self.smallest_achievable_bytes = smallest_achievable_bytes
        self.target_bytes = target_bytes
        super().__init__(
            f"Cannot reach target of {target_bytes} bytes; "
            f"smallest achievable is {smallest_achievable_bytes} bytes."
        )
