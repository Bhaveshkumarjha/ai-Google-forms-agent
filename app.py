"""AI Forms Agent: create real Google Forms (and custom forms) by chatting with an AI."""
import logging
import os

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from config import Config
from extensions import csrf, db, limiter, oauth
from gforms import FORMS_SCOPE
from security import current_user, wants_json

FRIENDLY = {
    400: "That request could not be processed. If the page was open for a long time, refresh it.",
    403: "You are not allowed to do that.",
    404: "We could not find that page.",
    405: "That action is not allowed here.",
    413: "The upload is too large. Each file can be up to 10 MB.",
    429: "Too many requests. Please slow down and try again in a bit.",
}


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_object(Config)

    if test_config:
        app.config.update(test_config)

    if not app.config.get("SECRET_KEY"):
        raise RuntimeError(
            "SECRET_KEY is not set. Copy .env.example to .env and fill it in."
        )

    if app.config.get("TRUST_PROXY"):
        app.wsgi_app = ProxyFix(
            app.wsgi_app, x_for=1, x_proto=1, x_host=1
        )

    os.makedirs(app.instance_path, exist_ok=True)

    if not app.config.get("UPLOAD_DIR"):
        app.config["UPLOAD_DIR"] = os.path.join(
            app.instance_path, "uploads"
        )

    os.makedirs(app.config["UPLOAD_DIR"], exist_ok=True)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    db.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)
    oauth.init_app(app)

    if app.config.get("GOOGLE_CLIENT_ID"):
        oauth.register(
            name="google",
            client_id=app.config["GOOGLE_CLIENT_ID"],
            client_secret=app.config["GOOGLE_CLIENT_SECRET"],
            server_metadata_url=(
                "https://accounts.google.com/.well-known/openid-configuration"
            ),
            client_kwargs={
                "scope": f"openid email profile {FORMS_SCOPE}"
            },
        )

    from auth import bp as auth_bp
    from public import bp as public_bp
    from views import bp as main_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(public_bp)

    # Google Search Console verification
    @app.route("/googlecd9fb3dcbfa79372.html")
    def google_verification():
        return Response(
            "google-site-verification: googlecd9fb3dcbfa79372.html",
            mimetype="text/html",
        )

    # Privacy Policy page
    @app.route("/privacy-policy")
    def privacy_policy():
        return render_template("privacy_policy.html")

    # Terms of Service page
    @app.route("/terms")
    def terms():
        return render_template("terms.html")

    @app.context_processor
    def inject_user():
        return {"current_user": current_user()}

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
            "img-src 'self' data: https:; font-src 'self' https://cdn.jsdelivr.net; "
            "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; "
            "base-uri 'self'",
        )

        if request.path.startswith(
            ("/chat", "/draft", "/forms", "/dashboard", "/settings")
        ):
            resp.headers["Cache-Control"] = "no-store"

        return resp

    @app.errorhandler(HTTPException)
    def http_error(exc):
        code = exc.code or 500
        message = FRIENDLY.get(
            code, exc.description or "Something went wrong."
        )

        if wants_json():
            return jsonify(error=message), code

        return render_template(
            "error.html", code=code, message=message
        ), code

    @app.errorhandler(Exception)
    def server_error(exc):
        app.logger.exception("Unhandled error")
        message = "Something went wrong on our side. Please try again."

        if wants_json():
            return jsonify(error=message), 500

        return render_template(
            "error.html", code=500, message=message
        ), 500

    with app.app_context():
        db.create_all()

    return app


if __name__ == "__main__":
    create_app().run(
        debug=os.environ.get("FLASK_DEBUG") == "1"
    )
