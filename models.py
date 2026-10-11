from datetime import datetime, timezone

from extensions import db


def utcnow():
    """Naive UTC timestamp (SQLite drops tzinfo, so we keep everything naive-UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    google_sub = db.Column(db.String(64), unique=True, index=True, nullable=False)
    email = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), default="")
    picture = db.Column(db.String(500), default="")
    # Google tokens are stored encrypted (Fernet); never in plain text.
    enc_access = db.Column(db.Text)
    enc_refresh = db.Column(db.Text)
    token_expiry = db.Column(db.DateTime)
    scopes = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=utcnow)

    drafts = db.relationship("Draft", backref="user", cascade="all, delete-orphan")
    forms = db.relationship("Form", backref="user", cascade="all, delete-orphan")


class Draft(db.Model):
    """One chat conversation and the form definition it is building."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), index=True, nullable=False)
    title = db.Column(db.String(200), default="New chat")
    spec = db.Column(db.JSON)  # current form definition, or None
    warnings = db.Column(db.JSON, default=list)
    status = db.Column(db.String(20), default="open")  # open | created
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    messages = db.relationship(
        "Message", backref="draft", cascade="all, delete-orphan", order_by="Message.id"
    )


class Message(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    draft_id = db.Column(db.Integer, db.ForeignKey("draft.id"), index=True, nullable=False)
    role = db.Column(db.String(10), nullable=False)  # user | assistant
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)


class Form(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), index=True, nullable=False)
    kind = db.Column(db.String(10), nullable=False)  # google | custom
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    spec = db.Column(db.JSON, nullable=False)
    status = db.Column(db.String(20), default="published")  # published | partial | failed
    slug = db.Column(db.String(40), unique=True, index=True)  # custom forms only
    google_form_id = db.Column(db.String(120))
    responder_url = db.Column(db.String(500))
    edit_url = db.Column(db.String(500))
    error = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)

    submissions = db.relationship(
        "Submission", backref="form", cascade="all, delete-orphan", order_by="Submission.id"
    )


class Submission(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    form_id = db.Column(db.Integer, db.ForeignKey("form.id"), index=True, nullable=False)
    answers = db.Column(db.JSON, default=dict)  # {"q1": "text" | ["a", "b"]}
    files = db.Column(db.JSON, default=dict)  # {"q3": {"original", "stored", "size"}}
    score = db.Column(db.Integer)
    max_score = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=utcnow)
