"""Signed-in pages: dashboard, chat, preview/edit, form creation, history, responses, settings."""
import csv
import io
import logging
import os
import secrets
import shutil

from flask import (
    Blueprint, Response, abort, current_app, flash, jsonify, redirect,
    render_template, request, send_from_directory, session, url_for,
)
from sqlalchemy import or_

import ai
import gforms
from docextract import extract_text
from extensions import db, limiter
from filestore import UploadError
from models import Draft, Form, Message, Submission
from security import current_user, login_required, owned_or_404

log = logging.getLogger(__name__)
bp = Blueprint("main", __name__)

MAX_CHAT_CHARS = 20000


def _max_bytes():
    return current_app.config["MAX_UPLOAD_MB"] * 1024 * 1024


def _upload_dir(form_id):
    return os.path.join(current_app.config["UPLOAD_DIR"], str(int(form_id)))


# ------------------------------------------------------------------ public
@bp.route("/")
def landing():
    if current_user():
        return redirect(url_for("main.dashboard"))
    return render_template("landing.html")


@bp.route("/health")
def health():
    return jsonify(status="ok")


# --------------------------------------------------------------- dashboard
@bp.route("/dashboard")
@login_required
def dashboard():
    user = current_user()
    forms = Form.query.filter_by(user_id=user.id)
    recent_forms = forms.order_by(Form.id.desc()).limit(5).all()
    stats = {
        "total": forms.count(),
        "google": forms.filter_by(kind="google", status="published").count(),
        "custom": forms.filter_by(kind="custom").count(),
        "responses": (
            db.session.query(Submission)
            .join(Form, Submission.form_id == Form.id)
            .filter(Form.user_id == user.id)
            .count()
        ),
    }
    chats = Draft.query.filter_by(user_id=user.id).order_by(Draft.updated_at.desc()).limit(5).all()
    return render_template("dashboard.html", recent_forms=recent_forms, stats=stats, chats=chats)


# -------------------------------------------------------------------- chat
@bp.route("/chat/new", methods=["POST"])
@login_required
@limiter.limit("30 per hour")
def chat_new():
    draft = Draft(user_id=current_user().id, spec=None, warnings=[])
    db.session.add(draft)
    db.session.commit()
    return redirect(url_for("main.chat", draft_id=draft.id))


@bp.route("/chat/<int:draft_id>")
@login_required
def chat(draft_id):
    draft = owned_or_404(Draft, draft_id)
    return render_template(
        "chat.html", draft=draft, messages=draft.messages,
        ai_ready=bool(current_app.config.get("GEMINI_API_KEY")),
    )


def _run_turn(draft, text, *, mode, doc_name=None, shown_text=None, truncated=False):
    history = [(m.role, m.content) for m in draft.messages[-10:]]
    try:
        result = ai.handle_message(text, history, draft.spec, mode=mode, doc_name=doc_name)
    except ai.GeminiError as exc:
        return jsonify(error=str(exc)), exc.status if exc.status in (429, 503, 504) else 502

    reply = result["reply"]
    if truncated:
        reply += " (The document was long, so only the first part was read.)"
    db.session.add(Message(draft_id=draft.id, role="user", content=shown_text or text))
    db.session.add(Message(draft_id=draft.id, role="assistant", content=reply))
    if result["spec"]:
        draft.spec = result["spec"]
        draft.title = result["spec"]["title"][:200] or draft.title
    draft.warnings = result["warnings"]
    db.session.commit()
    spec = draft.spec
    return jsonify(
        reply=reply,
        has_spec=bool(spec),
        question_count=len(spec["questions"]) if spec else 0,
        warnings=draft.warnings,
        preview_url=url_for("main.preview", draft_id=draft.id),
    )


@bp.route("/chat/<int:draft_id>/message", methods=["POST"])
@login_required
@limiter.limit("20 per minute;300 per day")
def chat_message(draft_id):
    draft = owned_or_404(Draft, draft_id)
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "").strip()
    if not text:
        return jsonify(error="Please type a message."), 400
    if len(text) > MAX_CHAT_CHARS:
        return jsonify(error=f"Message too long (max {MAX_CHAT_CHARS} characters)."), 400
    return _run_turn(draft, text, mode="chat")


@bp.route("/chat/<int:draft_id>/upload", methods=["POST"])
@login_required
@limiter.limit("10 per minute;100 per day")
def chat_upload(draft_id):
    draft = owned_or_404(Draft, draft_id)
    try:
        text, truncated = extract_text(request.files.get("file"), _max_bytes())
    except UploadError as exc:
        return jsonify(error=str(exc)), 400
    name = (request.files["file"].filename or "document")[:80]
    return _run_turn(
        draft, text, mode="document", doc_name=name,
        shown_text=f"Uploaded document: {name}", truncated=truncated,
    )


# ----------------------------------------------------------------- preview
@bp.route("/draft/<int:draft_id>/preview")
@login_required
def preview(draft_id):
    draft = owned_or_404(Draft, draft_id)
    if not draft.spec:
        flash("There is no form to preview yet. Tell the assistant what you need first.", "info")
        return redirect(url_for("main.chat", draft_id=draft.id))
    _, errors = ai.validate_spec(draft.spec)
    return render_template(
        "preview.html", draft=draft, spec=draft.spec, errors=errors,
        warnings=draft.warnings or [], google_ok=gforms.has_forms_access(current_user()),
    )


@bp.route("/draft/<int:draft_id>/spec", methods=["POST"])
@login_required
@limiter.limit("60 per minute")
def save_spec(draft_id):
    draft = owned_or_404(Draft, draft_id)
    clean, errors = ai.validate_spec(request.get_json(silent=True))
    draft.spec = clean
    draft.title = clean["title"][:200] or draft.title
    draft.warnings = []  # the user has reviewed the extraction
    db.session.commit()
    return jsonify(spec=clean, errors=errors, has_upload=ai.has_file_upload(clean))


@bp.route("/draft/<int:draft_id>/create", methods=["POST"])
@login_required
@limiter.limit("20 per hour")
def create_form(draft_id):
    draft = owned_or_404(Draft, draft_id)
    user = current_user()
    spec, errors = ai.validate_spec(draft.spec)
    if errors:
        flash("Fix these problems first: " + " ".join(errors[:3]), "danger")
        return redirect(url_for("main.preview", draft_id=draft.id))

    kind = "custom" if request.form.get("destination") == "custom" else "google"
    if ai.has_file_upload(spec):
        kind = "custom"  # the Google Forms API cannot create file-upload questions

    form = Form(
        user_id=user.id, kind=kind, title=spec["title"], description=spec["description"],
        spec=spec, status="published",
    )
    if kind == "custom":
        form.slug = secrets.token_urlsafe(8)
        db.session.add(form)
        draft.status = "created"
        db.session.commit()
        form.responder_url = url_for("public.custom_form", slug=form.slug, _external=True)
        db.session.commit()
        return redirect(url_for("main.form_created", form_id=form.id))

    try:
        created = gforms.create_google_form(user, spec)
    except gforms.GoogleFormsError as exc:
        if exc.partial:  # exists in Google but unfinished: keep a record, show honest status
            form.status = "partial"
            form.error = str(exc)
            form.google_form_id = exc.partial["form_id"]
            form.edit_url = exc.partial["edit_url"]
            db.session.add(form)
            db.session.commit()
            return redirect(url_for("main.form_created", form_id=form.id))
        if exc.reauth:
            flash(str(exc), "warning")
            return redirect(url_for("main.preview", draft_id=draft.id))
        flash(str(exc), "danger")
        return redirect(url_for("main.preview", draft_id=draft.id))

    form.google_form_id = created["form_id"]
    form.responder_url = created["responder_url"]
    form.edit_url = created["edit_url"]
    db.session.add(form)
    draft.status = "created"
    db.session.commit()
    return redirect(url_for("main.form_created", form_id=form.id))


@bp.route("/forms/<int:form_id>/created")
@login_required
def form_created(form_id):
    form = owned_or_404(Form, form_id)
    return render_template("created.html", form=form)


# ----------------------------------------------------------------- history
@bp.route("/forms")
@login_required
def forms_history():
    q = (request.args.get("q") or "").strip()[:100]
    query = Form.query.filter_by(user_id=current_user().id)
    if q:
        like = "%" + q.replace("%", r"\%").replace("_", r"\_") + "%"
        query = query.filter(Form.title.ilike(like, escape="\\"))
    forms = query.order_by(Form.id.desc()).all()
    counts = dict(
        db.session.query(Submission.form_id, db.func.count(Submission.id))
        .filter(Submission.form_id.in_([f.id for f in forms] or [0]))
        .group_by(Submission.form_id)
        .all()
    )
    return render_template("history.html", forms=forms, q=q, counts=counts)


@bp.route("/forms/<int:form_id>/delete", methods=["POST"])
@login_required
def delete_form(form_id):
    form = owned_or_404(Form, form_id)
    shutil.rmtree(_upload_dir(form.id), ignore_errors=True)
    kind = form.kind
    db.session.delete(form)
    db.session.commit()
    if kind == "google":
        flash("Removed from your history. The form itself still exists in your Google Forms.", "info")
    else:
        flash("Form and all its responses were deleted.", "info")
    return redirect(url_for("main.forms_history"))


# --------------------------------------------------------------- responses
def _own_custom_form(form_id):
    form = owned_or_404(Form, form_id)
    if form.kind != "custom":
        abort(404)
    return form


@bp.route("/forms/<int:form_id>/responses")
@login_required
def responses(form_id):
    form = _own_custom_form(form_id)
    return render_template("responses.html", form=form, questions=form.spec["questions"])


def _csv_safe(value):
    value = "" if value is None else str(value)
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


@bp.route("/forms/<int:form_id>/responses.csv")
@login_required
def responses_csv(form_id):
    form = _own_custom_form(form_id)
    out = io.StringIO()
    writer = csv.writer(out)
    questions = form.spec["questions"]
    writer.writerow(["Submitted (UTC)"] + [_csv_safe(q["text"]) for q in questions] + ["Score"])
    for sub in form.submissions:
        row = [sub.created_at.isoformat(timespec="seconds")]
        for i, q in enumerate(questions, 1):
            key = f"q{i}"
            if q["type"] == "file_upload":
                row.append(_csv_safe((sub.files.get(key) or {}).get("original", "")))
            else:
                val = sub.answers.get(key, "")
                row.append(_csv_safe(", ".join(val) if isinstance(val, list) else val))
        row.append("" if sub.score is None else f"{sub.score}/{sub.max_score}")
        writer.writerow(row)
    return Response(
        out.getvalue(), mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="responses-{form.id}.csv"'},
    )


@bp.route("/forms/<int:form_id>/submissions/<int:sub_id>/file/<qkey>")
@login_required
def download_file(form_id, sub_id, qkey):
    form = _own_custom_form(form_id)
    sub = db.session.get(Submission, sub_id)
    if sub is None or sub.form_id != form.id:
        abort(404)
    meta = (sub.files or {}).get(qkey)
    if not meta:
        abort(404)
    return send_from_directory(
        _upload_dir(form.id), meta["stored"], as_attachment=True, download_name=meta["original"]
    )


# ---------------------------------------------------------------- settings
@bp.route("/settings")
@login_required
def settings():
    user = current_user()
    return render_template(
        "settings.html", google_ok=gforms.has_forms_access(user),
        n_forms=Form.query.filter_by(user_id=user.id).count(),
        google_configured=bool(current_app.config.get("GOOGLE_CLIENT_ID")),
    )


@bp.route("/settings/delete-account", methods=["POST"])
@login_required
def delete_account():
    user = current_user()
    if request.form.get("confirm") != "yes":
        flash("Tick the confirmation box to delete your account.", "warning")
        return redirect(url_for("main.settings"))
    for form in Form.query.filter_by(user_id=user.id).all():
        shutil.rmtree(_upload_dir(form.id), ignore_errors=True)
    gforms.revoke(user)
    db.session.delete(user)
    db.session.commit()
    session.clear()
    flash("Your account and all its data were deleted.", "info")
    return redirect(url_for("main.landing"))
