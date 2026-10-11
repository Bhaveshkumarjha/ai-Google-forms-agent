"""Auth helpers, token encryption and ownership checks."""
from functools import wraps

from cryptography.fernet import Fernet, InvalidToken
from flask import abort, current_app, g, jsonify, redirect, request, session, url_for

from extensions import db
from models import User


def current_user():
    if "_user" not in g:
        uid = session.get("uid")
        g._user = db.session.get(User, uid) if uid else None
    return g._user


def wants_json():
    return request.headers.get("X-Requested-With") == "fetch" or request.is_json


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            if wants_json():
                return jsonify(error="Please sign in again."), 401
            return redirect(url_for("auth.login"))
        return view(*args, **kwargs)

    return wrapped


def owned_or_404(model, obj_id):
    """Return the row only if it belongs to the signed-in user, otherwise 404.

    404 (not 403) so other users' record ids cannot even be probed.
    """
    obj = db.session.get(model, obj_id)
    user = current_user()
    if obj is None or user is None or obj.user_id != user.id:
        abort(404)
    return obj


def _fernet():
    key = current_app.config.get("TOKEN_ENC_KEY")
    if not key:
        raise RuntimeError("TOKEN_ENC_KEY is not set.")
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_token(value):
    return _fernet().encrypt(value.encode()).decode()


def decrypt_token(value):
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None
