import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_require_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_guest_cookie_is_secure_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GUEST_COOKIE_SECURE", raising=False)
    assert Settings(_env_file=None, database_url="sqlite://").guest_cookie_secure is True
