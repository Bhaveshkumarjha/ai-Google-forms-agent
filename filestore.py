"""Safe handling of uploaded files. Uploaded content is only stored or parsed, never executed."""
import codecs
import io
import os
import uuid
import zipfile

from werkzeug.utils import secure_filename

MAGIC = {
    ".pdf": lambda head: head.startswith(b"%PDF-"),
    ".png": lambda head: head.startswith(b"\x89PNG\r\n\x1a\n"),
    ".jpg": lambda head: head.startswith(b"\xff\xd8\xff"),
    ".jpeg": lambda head: head.startswith(b"\xff\xd8\xff"),
}
RESPONDENT_EXTS = {".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg"}
DOCUMENT_EXTS = {".pdf", ".docx", ".txt"}
MAX_UNZIPPED = 200 * 1024 * 1024  # guards against zip bombs inside .docx


class UploadError(Exception):
    """Raised with a message that is safe to show to the user."""


def _size(stream):
    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(0)
    return size


def _looks_like_text(head):
    if b"\x00" in head:
        return False
    decoder = codecs.getincrementaldecoder("utf-8")()
    try:
        decoder.decode(head, final=False)  # tolerate a cut-off multi-byte char
    except UnicodeDecodeError:
        return False
    return True


def _valid_docx(stream):
    try:
        with zipfile.ZipFile(stream) as zf:
            names = zf.namelist()
            if "word/document.xml" not in names:
                return False
            if sum(i.file_size for i in zf.infolist()) > MAX_UNZIPPED:
                return False
    except zipfile.BadZipFile:
        return False
    finally:
        stream.seek(0)
    return True


def validate(file_storage, allowed_exts, max_bytes):
    """Check extension, size and real content type. Returns (ext, size)."""
    if file_storage is None or not file_storage.filename:
        raise UploadError("No file selected.")
    ext = os.path.splitext(file_storage.filename)[1].lower()
    if ext not in allowed_exts:
        allowed = ", ".join(sorted(e.lstrip(".").upper() for e in allowed_exts))
        raise UploadError(f"This file type is not allowed. Allowed: {allowed}.")
    stream = file_storage.stream
    size = _size(stream)
    if size == 0:
        raise UploadError("The file is empty.")
    if size > max_bytes:
        raise UploadError(f"The file is larger than {max_bytes // (1024 * 1024)} MB.")
    head = stream.read(4096)
    stream.seek(0)
    if ext == ".docx":
        ok = head.startswith(b"PK\x03\x04") and _valid_docx(stream)
    elif ext == ".txt":
        ok = _looks_like_text(head)
    else:
        ok = MAGIC[ext](head)
    if not ok:
        raise UploadError("The file content does not match its type, so it was rejected.")
    return ext, size


def save_upload(file_storage, dest_dir, allowed_exts, max_bytes):
    """Validate and store a respondent upload under a random name."""
    ext, size = validate(file_storage, allowed_exts, max_bytes)
    os.makedirs(dest_dir, exist_ok=True)
    stored = uuid.uuid4().hex + ext
    file_storage.save(os.path.join(dest_dir, stored))
    return {
        "original": secure_filename(file_storage.filename) or f"file{ext}",
        "stored": stored,
        "size": size,
    }


def read_validated(file_storage, allowed_exts, max_bytes):
    """Validate and return (ext, bytes) without writing to disk."""
    ext, _ = validate(file_storage, allowed_exts, max_bytes)
    data = file_storage.stream.read()
    return ext, io.BytesIO(data)
