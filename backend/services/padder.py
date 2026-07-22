"""
Padder strategies. Each Padder knows how to append harmless, format-legal
filler bytes to reach an EXACT target byte count, without touching the
decoded pixel data. This is what gets us bit-exact output sizes on top of
whatever the Compressor already got us close to.
"""

from abc import ABC, abstractmethod


class Padder(ABC):
    """Strategy interface: pad already-compressed bytes to an exact size."""

    @abstractmethod
    def can_pad(self, current_bytes: bytes) -> bool:
        """Whether this format/file supports the padding trick at all."""
        ...

    @abstractmethod
    def pad_to_exact(self, current_bytes: bytes, target_bytes: int) -> bytes:
        """Return bytes padded to exactly target_bytes. Caller guarantees
        target_bytes >= len(current_bytes) before calling.
        """
        ...


class JpegPadder(Padder):
    """JPEG allows an arbitrary COM (comment) marker segment: FF FE, then a
    2-byte big-endian length (including the 2 length bytes themselves, max
    65535), then payload. We insert one right after the SOI marker (FF D8),
    which every valid JPEG starts with. Decoders universally ignore COM
    segments, so this is invisible to the rendered image.
    """

    SOI = b"\xff\xd8"
    COM_MARKER = b"\xff\xfe"
    MAX_SEGMENT_PAYLOAD = 65535 - 2  # length field caps segment at 65535 bytes total

    def can_pad(self, current_bytes: bytes) -> bool:
        return current_bytes.startswith(self.SOI)

    def _build_com_segment(self, payload_size: int) -> bytes:
        segment_length = payload_size + 2  # length field includes itself
        length_bytes = segment_length.to_bytes(2, "big")
        return self.COM_MARKER + length_bytes + (b"\x00" * payload_size)

    MIN_SEGMENT_OVERHEAD = 4  # marker (2) + length field (2); payload can be 0

    def pad_to_exact(self, current_bytes: bytes, target_bytes: int) -> bytes:
        needed = target_bytes - len(current_bytes)
        if needed <= 0:
            return current_bytes
        if not self.can_pad(current_bytes):
            raise ValueError("Not a valid JPEG (missing SOI marker); cannot pad.")
        if 0 < needed < self.MIN_SEGMENT_OVERHEAD:
            # Can't express 1-3 spare bytes with a real COM segment (min
            # overhead is 4 bytes). Instead of rounding up and exceeding
            # the target size (which causes OS rounding to next KB), we
            # append trailing null bytes after the EOI marker.
            return current_bytes + (b"\x00" * needed)

        padding_blob = self._build_segment_chain(needed)
        return current_bytes[: len(self.SOI)] + padding_blob + current_bytes[len(self.SOI):]

    def _build_segment_chain(self, total_padding_bytes: int) -> bytes:
        """Split total_padding_bytes across as many COM segments as needed.
        The sum of segment lengths always equals total_padding_bytes exactly
        (never more), because the caller already rounded up any amount
        smaller than one segment's minimum overhead.
        """
        segments = []
        remaining = total_padding_bytes

        while remaining > 0:
            if remaining <= self.MAX_SEGMENT_PAYLOAD + self.MIN_SEGMENT_OVERHEAD:
                payload_size = remaining - self.MIN_SEGMENT_OVERHEAD
                segments.append(self._build_com_segment(payload_size))
                remaining = 0
            else:
                segments.append(self._build_com_segment(self.MAX_SEGMENT_PAYLOAD))
                remaining -= self.MAX_SEGMENT_PAYLOAD + self.MIN_SEGMENT_OVERHEAD

        return b"".join(segments)


class PngPadder(Padder):
    """PNG is a sequence of length-prefixed chunks: 4-byte length, 4-byte
    type, payload, 4-byte CRC32. We insert a private ancillary chunk
    (lowercase first letter = ancillary, safe to ignore) called "juNk"
    right after the IHDR chunk. Any spec-compliant decoder skips chunks it
    doesn't recognize, so this is invisible to the rendered image.
    """

    SIGNATURE = b"\x89PNG\r\n\x1a\n"
    CHUNK_TYPE = b"juNk"
    CHUNK_OVERHEAD = 12  # 4 length + 4 type + 4 crc (payload is variable)

    def can_pad(self, current_bytes: bytes) -> bool:
        return current_bytes.startswith(self.SIGNATURE)

    def _build_chunk(self, payload_size: int) -> bytes:
        import zlib

        payload = b"\x00" * payload_size
        length = payload_size.to_bytes(4, "big")
        crc = zlib.crc32(self.CHUNK_TYPE + payload).to_bytes(4, "big")
        return length + self.CHUNK_TYPE + payload + crc

    def _find_ihdr_end(self, data: bytes) -> int:
        # IHDR is always the first chunk, immediately after the 8-byte
        # signature: 4 length + 4 "IHDR" + 13-byte payload + 4 CRC.
        ihdr_length = int.from_bytes(data[8:12], "big")
        return 8 + 4 + 4 + ihdr_length + 4

    def pad_to_exact(self, current_bytes: bytes, target_bytes: int) -> bytes:
        needed = target_bytes - len(current_bytes)
        if needed <= 0:
            return current_bytes
        if not self.can_pad(current_bytes):
            raise ValueError("Not a valid PNG (missing signature); cannot pad.")
        if 0 < needed < self.CHUNK_OVERHEAD:
            # Can't express a gap smaller than one chunk's overhead (12
            # bytes). Instead of rounding up, we append trailing null bytes
            # to the end of the file (after IEND).
            return current_bytes + (b"\x00" * needed)

        insert_at = self._find_ihdr_end(current_bytes)
        payload_size = needed - self.CHUNK_OVERHEAD
        chunk = self._build_chunk(payload_size)

        return current_bytes[:insert_at] + chunk + current_bytes[insert_at:]


class NullPadder(Padder):
    """Fallback for formats where the padding trick isn't implemented.
    Returns bytes unchanged and reports that padding isn't possible, so
    the service layer can surface a warning instead of silently failing.
    """

    def can_pad(self, current_bytes: bytes) -> bool:
        return False

    def pad_to_exact(self, current_bytes: bytes, target_bytes: int) -> bytes:
        return current_bytes


class PadderFactory:
    """Single place where format -> Padder mapping lives (DRY)."""

    _registry = {
        "jpeg": JpegPadder,
        "png": PngPadder,
        "webp": NullPadder,  # WebP's RIFF container padding not yet implemented
    }

    @classmethod
    def get(cls, format_value: str) -> Padder:
        return cls._registry.get(format_value, NullPadder)()
