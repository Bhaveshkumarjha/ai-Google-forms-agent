from authlib.integrations.flask_client import OAuth
from flask import request, session
from flask_limiter import Limiter
from flask_sqlalchemy import SQLAlchemy
from flask_wtf import CSRFProtect

db = SQLAlchemy()
csrf = CSRFProtect()
oauth = OAuth()


def limiter_key():
    """Rate-limit per signed-in user, otherwise per client IP."""
    uid = session.get("uid")
    if uid:
        return f"user:{uid}"
    return request.remote_addr or "anonymous"


limiter = Limiter(key_func=limiter_key, default_limits=["300 per hour"])
