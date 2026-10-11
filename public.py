"""Public pages for custom forms (no login for respondents)."""
import os
import re
import shutil

from flask import Blueprint, current_app, render_template, request

from extensions import db, limiter
from filestore import RESPONDENT_EXTS, UploadError, save_upload
from models import Form, Submission

bp = Blueprint("public", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _score(spec, answers):
    if not spec.get("is_quiz"):
        return None, None
    got = total = 0
    for i, q in enumerate(spec["questions"], 1):
        if q["type"] in ("multiple_choice", "dropdown", "true_false", "checkbox") and q["correct"]:
            total += q["points"]
            given = answers.get(f"q{i}")
            given = given if isinstance(given, list) else [given] if given else []
            if sorted(given) == sorted(q["correct"]):
                got += q["points"]
    return (got, total) if total else (None, None)


@bp.route("/c/<slug>", methods=["GET", "POST"])
@limiter.limit("40 per hour", methods=["POST"])
def custom_form(slug):
    form = Form.query.filter_by(slug=slug, kind="custom", status="published").first_or_404()
    spec = form.spec
    if request.method == "GET":
        return render_template("public_form.html", form=form, spec=spec, errors=[], values={})

    max_bytes = current_app.config["MAX_UPLOAD_MB"] * 1024 * 1024
    dest = os.path.join(current_app.config["UPLOAD_DIR"], str(form.id))
    answers, files, errors, saved = {}, {}, [], []

    for i, q in enumerate(spec["questions"], 1):
        key, kind = f"q{i}", q["type"]
        label = q["text"]
        if kind == "file_upload":
            upload = request.files.get(key)
            if not upload or not upload.filename:
                if q["required"]:
                    errors.append(f"{label}: please choose a file.")
                continue
            try:
                meta = save_upload(upload, dest, RESPONDENT_EXTS, max_bytes)
            except UploadError as exc:
                errors.append(f"{label}: {exc}")
                continue
            files[key] = meta
            saved.append(os.path.join(dest, meta["stored"]))
        elif kind == "checkbox":
            picked = [v for v in request.form.getlist(key) if v in q["options"]]
            if q["required"] and not picked:
                errors.append(f"{label}: choose at least one option.")
            answers[key] = picked
        elif kind in ("multiple_choice", "dropdown", "true_false"):
            value = request.form.get(key, "")
            if value and value not in q["options"]:
                errors.append(f"{label}: invalid choice.")
            elif q["required"] and not value:
                errors.append(f"{label}: please choose an option.")
            answers[key] = value
        else:
            value = (request.form.get(key) or "").strip()[:5000]
            if q["required"] and not value:
                errors.append(f"{label}: this field is required.")
            elif kind == "email" and value and not EMAIL_RE.match(value):
                errors.append(f"{label}: enter a valid email address.")
            answers[key] = value

    if errors:
        for path in saved:  # nothing from a rejected submission is kept
            try:
                os.remove(path)
            except OSError:
                pass
        values = {k: v for k, v in answers.items()}
        return render_template(
            "public_form.html", form=form, spec=spec, errors=errors, values=values
        ), 400

    score, max_score = _score(spec, answers)
    db.session.add(
        Submission(form_id=form.id, answers=answers, files=files, score=score, max_score=max_score)
    )
    db.session.commit()
    return render_template("public_thanks.html", form=form, score=score, max_score=max_score)
