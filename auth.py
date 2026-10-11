"""Google OAuth 2.0 sign-in (state and nonce are validated by Authlib)."""
import logging
from datetime import timedelta

from authlib.integrations.base_client.errors import OAuthError
from flask import Blueprint, current_app, flash, redirect, render_template, request, session, url_for

from extensions import db, limiter, oauth
from gforms import FORMS_SCOPE
from models import User, utcnow
from security import current_user, encrypt_token, login_required

log = logging.getLogger(__name__)
bp = Blueprint("auth", __name__)


def _sign_in(user):
    session.clear()  # new session id after login (prevents session fixation)
    session["uid"] = user.id
    session.permanent = True


@bp.route("/login")
def login():
    if current_user():
        return redirect(url_for("main.dashboard"))
    return render_template(
        "login.html",
        google_ready=bool(current_app.config.get("GOOGLE_CLIENT_ID")),
        dev_login=current_app.config["DEV_LOGIN"],
    )


@bp.route("/auth/google/start")
@limiter.limit("20 per minute")
def google_start():
    if not current_app.config.get("GOOGLE_CLIENT_ID"):
        flash("Google sign-in is not configured on this server.", "danger")
        return redirect(url_for("auth.login"))
    redirect_uri = url_for("auth.google_callback", _external=True)
    # offline + consent: we need a refresh token to keep creating forms later
    return oauth.google.authorize_redirect(
        redirect_uri, access_type="offline", prompt="consent", include_granted_scopes="true"
    )


@bp.route("/auth/google/callback")
@limiter.limit("20 per minute")
def google_callback():
    try:
        token = oauth.google.authorize_access_token()
    except OAuthError as exc:
        log.warning("OAuth error: %s", exc.error)
        flash("Google sign-in was cancelled or failed. Please try again.", "danger")
        return redirect(url_for("auth.login"))

    info = token.get("userinfo") or {}
    sub, email = info.get("sub"), info.get("email")
    if not sub or not email or not info.get("email_verified", False):
        flash("Your Google account needs a verified email address.", "danger")
        return redirect(url_for("auth.login"))

    user = User.query.filter_by(google_sub=sub).first()
    if user is None:
        user = User(google_sub=sub, email=email)
        db.session.add(user)
    user.email = email
    user.name = info.get("name", "") or email.split("@")[0]
    user.picture = info.get("picture", "")
    user.enc_access = encrypt_token(token["access_token"])
    if token.get("refresh_token"):
        user.enc_refresh = encrypt_token(token["refresh_token"])
    user.token_expiry = utcnow() + timedelta(seconds=int(token.get("expires_in", 3600)))
    user.scopes = token.get("scope", "")
    db.session.commit()

    _sign_in(user)
    if FORMS_SCOPE not in user.scopes.split():
        flash(
            "You signed in, but did not allow Google Forms access. "
            "You can still build custom forms; reconnect from Settings to create Google Forms.",
            "warning",
        )
    return redirect(url_for("main.dashboard"))


@bp.route("/auth/dev", methods=["POST"])
def dev_login():
    """Local testing only (DEV_LOGIN=1). Creates a user without Google."""
    if not current_app.config["DEV_LOGIN"]:
        return redirect(url_for("auth.login"))
    email = (request.form.get("email") or "dev@example.com").strip()[:200]
    user = User.query.filter_by(google_sub=f"dev:{email}").first()
    if user is None:
        user = User(google_sub=f"dev:{email}", email=email, name=email.split("@")[0], scopes="")
        db.session.add(user)
        db.session.commit()
    _sign_in(user)
    return redirect(url_for("main.dashboard"))


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    flash("You have been signed out.", "info")
    return redirect(url_for("main.landing"))
