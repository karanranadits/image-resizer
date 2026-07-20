import base64
import json

from fastapi import APIRouter, Form, HTTPException, UploadFile
from fastapi.responses import Response

from domain.exceptions import InvalidImageError
from domain.models import ImageFormat, ResizeRequest, SizeUnit
from services.resizer_service import ResizerService

router = APIRouter()
_service = ResizerService()

_CONTENT_TYPES = {
    ImageFormat.JPEG: "image/jpeg",
    ImageFormat.PNG: "image/png",
    ImageFormat.WEBP: "image/webp",
}


@router.post("/resize")
async def resize_image(
    file: UploadFile,
    target_size: float = Form(..., gt=0),
    unit: SizeUnit = Form(...),
    output_format: ImageFormat = Form(default=ImageFormat.JPEG),
):
    """
    Resize/compress an uploaded image to hit an exact target file size.

    Returns the processed image bytes directly in the response body, with
    a JSON metadata blob (achieved size, warnings, etc.) base64-free in the
    `X-Resize-Metadata` header so the frontend can read both in one request.
    """
    source_bytes = await file.read()
    target_bytes = unit.to_bytes(target_size)

    request = ResizeRequest(
        source_bytes=source_bytes,
        target_bytes=target_bytes,
        output_format=output_format,
    )

    try:
        result = _service.resize(request)
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    metadata = {
        "original_size_bytes": result.original_size_bytes,
        "target_size_bytes": result.target_size_bytes,
        "achieved_size_bytes": result.achieved_size_bytes,
        "exact_match": result.exact_match,
        "output_format": result.output_format.value,
        "warnings": result.warnings,
    }

    headers = {
        "X-Resize-Metadata": json.dumps(metadata),
        "Content-Disposition": f'attachment; filename="resized.{result.output_format.value}"',
        # Expose the custom header to browser JS (blocked by default under CORS).
        "Access-Control-Expose-Headers": "X-Resize-Metadata, Content-Disposition",
    }

    return Response(
        content=result.image_bytes,
        media_type=_CONTENT_TYPES[result.output_format],
        headers=headers,
    )
