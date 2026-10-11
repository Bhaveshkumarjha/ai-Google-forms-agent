"""Google Forms API client (official REST API) with token refresh and error mapping.

Flow for one form: forms.create -> forms.batchUpdate -> forms.setPublishSettings -> forms.get.
Forms created through the API are unpublished by default, so the publish step is required.
File-upload questions cannot be created through this API; those forms are custom forms.
"""
import logging
from datetime import timedelta

import requests
from flask import current_app

from extensions import db
from models import utcnow
from security import decrypt_token, encrypt_token

log = logging.getLogger(__name__)

FORMS_API = "https://forms.googleapis.com/v1"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
FORMS_SCOPE = "https://www.googleapis.com/auth/forms.body"
TIMEOUT = (5, 30)
CHUNK = 40  # requests per batchUpdate call


class GoogleFormsError(Exception):
    def __init__(self, message, *, status=None, reauth=False, partial=None):
        super().__init__(message)
        self.status = status
        self.reauth = reauth  # user must sign in / grant access again
        self.partial = partial  # {"form_id", "edit_url"} when a form was created but not finished


def edit_url(form_id):
    return f"https://docs.google.com/forms/d/{form_id}/edit"


# ---------- tokens ----------
def has_forms_access(user):
    return bool(user.enc_refresh or user.enc_access) and FORMS_SCOPE in (user.scopes or "").split()


def get_access_token(user):
    if not has_forms_access(user):
        raise GoogleFormsError(
            "Google Forms access is not granted yet. Please reconnect your Google account.",
            reauth=True,
        )
    now = utcnow()
    if user.enc_access and user.token_expiry and user.token_expiry - now > timedelta(seconds=60):
        token = decrypt_token(user.enc_access)
        if token:
            return token
    return _refresh(user)


def _refresh(user):
    refresh = decrypt_token(user.enc_refresh) if user.enc_refresh else None
    if not refresh:
        raise GoogleFormsError(
            "Your Google session expired. Please reconnect your Google account.", reauth=True
        )
    try:
        resp = requests.post(
            TOKEN_URL,
            data={
                "client_id": current_app.config["GOOGLE_CLIENT_ID"],
                "client_secret": current_app.config["GOOGLE_CLIENT_SECRET"],
                "refresh_token": refresh,
                "grant_type": "refresh_token",
            },
            timeout=TIMEOUT,
        )
    except requests.RequestException:
        raise GoogleFormsError("Could not reach Google to refresh your session. Try again.")
    if resp.status_code != 200:
        log.warning("token refresh failed: HTTP %s", resp.status_code)
        if resp.status_code in (400, 401):
            user.enc_access = None
            user.enc_refresh = None
            db.session.commit()
            raise GoogleFormsError(
                "Google access was revoked or expired. Please reconnect your Google account.",
                reauth=True,
            )
        raise GoogleFormsError("Google could not refresh your session. Try again later.")
    data = resp.json()
    user.enc_access = encrypt_token(data["access_token"])
    user.token_expiry = utcnow() + timedelta(seconds=int(data.get("expires_in", 3600)))
    if data.get("scope"):
        user.scopes = data["scope"]
    db.session.commit()
    return data["access_token"]


def revoke(user):
    """Best effort: revoke Google tokens (used when a user deletes their account)."""
    for enc in (user.enc_refresh, user.enc_access):
        token = decrypt_token(enc) if enc else None
        if token:
            try:
                requests.post(REVOKE_URL, params={"token": token}, timeout=TIMEOUT)
            except requests.RequestException:
                pass
            return


# ---------- request building (pure, unit-tested) ----------
def question_body(q, quiz):
    kind = q["type"]
    question = {"required": bool(q.get("required", True))}
    if kind in ("multiple_choice", "true_false", "dropdown", "checkbox"):
        choice_type = {
            "multiple_choice": "RADIO",
            "true_false": "RADIO",
            "dropdown": "DROP_DOWN",
            "checkbox": "CHECKBOX",
        }[kind]
        question["choiceQuestion"] = {
            "type": choice_type,
            "options": [{"value": o} for o in q["options"]],
        }
        if quiz and q.get("correct"):
            question["grading"] = {
                "pointValue": int(q.get("points", 1)),
                "correctAnswers": {"answers": [{"value": c} for c in q["correct"]]},
            }
    elif kind == "paragraph":
        question["textQuestion"] = {"paragraph": True}
    elif kind in ("short_answer", "email"):
        question["textQuestion"] = {"paragraph": False}
    else:
        raise GoogleFormsError("File upload questions cannot be created with the Google Forms API.")
    return question


def build_requests(spec):
    requests_ = []
    quiz = bool(spec.get("is_quiz"))
    if quiz:
        requests_.append(
            {
                "updateSettings": {
                    "settings": {"quizSettings": {"isQuiz": True}},
                    "updateMask": "quizSettings.isQuiz",
                }
            }
        )
    if spec.get("description"):
        requests_.append(
            {
                "updateFormInfo": {
                    "info": {"description": spec["description"]},
                    "updateMask": "description",
                }
            }
        )
    for index, q in enumerate(spec["questions"]):
        requests_.append(
            {
                "createItem": {
                    "item": {
                        "title": q["text"],
                        "questionItem": {"question": question_body(q, quiz)},
                    },
                    "location": {"index": index},
                }
            }
        )
    return requests_


# ---------- API calls ----------
def _call(method, url, token, *, json_body=None):
    try:
        resp = requests.request(
            method,
            url,
            json=json_body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=TIMEOUT,
        )
    except requests.RequestException:
        raise GoogleFormsError("Could not reach Google Forms. Please try again.")
    if 200 <= resp.status_code < 300:
        return resp.json() if resp.content else {}
    raise _map_error(resp)


def _map_error(resp):
    status = resp.status_code
    try:
        message = resp.json().get("error", {}).get("message", "")
    except ValueError:
        message = ""
    log.warning("Google Forms API error: HTTP %s", status)
    if status == 401:
        return GoogleFormsError(
            "Google rejected the session. Please reconnect your Google account.",
            status=status,
            reauth=True,
        )
    if status == 403:
        if "has not been used" in message or "is disabled" in message:
            return GoogleFormsError(
                "The Google Forms API is not enabled for this app's Google Cloud project. "
                "Enable it in the Cloud Console and try again.",
                status=status,
            )
        return GoogleFormsError(
            "Google denied permission. Reconnect your account and allow Google Forms access.",
            status=status,
            reauth=True,
        )
    if status == 429:
        return GoogleFormsError(
            "Google Forms API quota reached. Please wait a few minutes and try again.",
            status=status,
        )
    if status == 400:
        return GoogleFormsError(f"Google rejected the form: {message or 'invalid request'}", status=status)
    return GoogleFormsError("Google Forms had a problem. Please try again later.", status=status)


def create_google_form(user, spec):
    """Create, fill and publish a real Google Form. Returns a dict of URLs.

    Raises GoogleFormsError; if the form already exists in Google but a later step failed,
    the error carries `.partial` with the form id and edit link.
    """
    token = get_access_token(user)
    title = spec["title"]
    created = _call(
        "POST", f"{FORMS_API}/forms", token,
        json_body={"info": {"title": title, "documentTitle": title}},
    )
    form_id = created["formId"]
    partial = {"form_id": form_id, "edit_url": edit_url(form_id)}

    try:
        reqs = build_requests(spec)
        for start in range(0, len(reqs), CHUNK):
            _call(
                "POST", f"{FORMS_API}/forms/{form_id}:batchUpdate", token,
                json_body={"requests": reqs[start:start + CHUNK]},
            )
    except GoogleFormsError as exc:
        raise GoogleFormsError(
            f"The form was created but adding questions failed: {exc}. "
            "Open it in Google Forms to finish or delete it.",
            status=exc.status, reauth=exc.reauth, partial=partial,
        )

    try:
        _call(
            "POST", f"{FORMS_API}/forms/{form_id}:setPublishSettings", token,
            json_body={
                "publishSettings": {
                    "publishState": {"isPublished": True, "isAcceptingResponses": True}
                },
                "updateMask": "publishState",
            },
        )
        final = _call("GET", f"{FORMS_API}/forms/{form_id}", token)
    except GoogleFormsError as exc:
        raise GoogleFormsError(
            f"The form was created but publishing failed: {exc}. "
            "Open it in Google Forms and publish it from there.",
            status=exc.status, reauth=exc.reauth, partial=partial,
        )

    responder = final.get("responderUri")
    if not responder:
        raise GoogleFormsError(
            "Google did not return a respondent link. Open the form in Google Forms.",
            partial=partial,
        )
    return {"form_id": form_id, "responder_url": responder, "edit_url": edit_url(form_id)}
