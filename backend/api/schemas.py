from pydantic import BaseModel, Field

from domain.models import ImageFormat, SizeUnit


class ResizeMetadata(BaseModel):
    """JSON metadata about the resize operation, returned alongside the
    file via response headers (see routes.py) or as a separate endpoint.
    """
    original_size_bytes: int
    target_size_bytes: int
    achieved_size_bytes: int
    exact_match: bool
    output_format: ImageFormat
    warnings: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    detail: str


# Re-exported for convenience so routes.py has one import location for
# request-shaping types used in Form(...) fields.
__all__ = ["ResizeMetadata", "ErrorResponse", "ImageFormat", "SizeUnit"]
