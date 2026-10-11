"""Configuration. All secrets come from environment variables (.env locally)."""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _bool(name, default=False):
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


def _db_url():
    url = os.environ.get("DATABASE_URL", "sqlite:///forms_agent.db")
    if url.startswith("postgres://"):  # older providers use this scheme
        url = "postgresql://" + url[len("postgres://"):]
    return url


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY")
    TOKEN_ENC_KEY = os.environ.get("TOKEN_ENC_KEY")  # Fernet key for stored Google tokens

    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
    GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")

    SQLALCHEMY_DATABASE_URI = _db_url()
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_DIR = os.environ.get("UPLOAD_DIR")  # defaults to <instance>/uploads
    MAX_UPLOAD_MB = 10  # per file (documents and respondent uploads)
    MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # hard cap for a whole request

    DEV_LOGIN = _bool("DEV_LOGIN")  # local testing only, never enable in production
    TRUST_PROXY = _bool("TRUST_PROXY")  # set to 1 behind Render/other reverse proxies

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = not _bool("FLASK_DEBUG")
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    WTF_CSRF_TIME_LIMIT = 60 * 60 * 8

    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_HEADERS_ENABLED = True
