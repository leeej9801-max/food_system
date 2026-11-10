from sqlalchemy.orm import Session

from app.db.models import AuditEvent


def add(db: Session, event: AuditEvent) -> None:
    db.add(event)
