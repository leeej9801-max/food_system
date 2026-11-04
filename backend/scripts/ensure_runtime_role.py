"""Create or update the store-scoped runtime DB role the API connects as (ADR-013).

Run as the DB owner after `alembic upgrade head` (the compose `migrate` service does both):
    DATABASE_URL=<owner url> RUNTIME_DB_USER=food_app RUNTIME_DB_PASSWORD=<secret> \
        python -m scripts.ensure_runtime_role

The role is LOGIN NOSUPERUSER NOBYPASSRLS and owns nothing, so RLS policies always apply.
The password is read from the environment and never printed.
"""

import os
import re

from sqlalchemy import create_engine, text

from app.core.config import settings


def ensure_runtime_role(owner_url: str, role: str, password: str) -> None:
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", role):
        raise ValueError("RUNTIME_DB_USER must be a plain lowercase identifier")
    if not password:
        raise ValueError("RUNTIME_DB_PASSWORD is empty")
    engine = create_engine(owner_url)
    try:
        with engine.begin() as conn:
            exists = conn.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role})
            verb = "ALTER" if exists else "CREATE"
            # CREATE/ALTER ROLE takes no bind parameters; quote_literal escapes the secret
            literal = conn.scalar(text("SELECT quote_literal(:p)"), {"p": password})
            conn.exec_driver_sql(
                f"{verb} ROLE {role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE "
                f"PASSWORD {literal}"
            )
            conn.exec_driver_sql(f"GRANT USAGE ON SCHEMA public TO {role}")
            conn.exec_driver_sql(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}"
            )
            conn.exec_driver_sql(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {role}")
            conn.exec_driver_sql(f"REVOKE ALL ON alembic_version FROM {role}")
            conn.exec_driver_sql(
                f"ALTER DEFAULT PRIVILEGES IN SCHEMA public "
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {role}"
            )
    finally:
        engine.dispose()


if __name__ == "__main__":
    ensure_runtime_role(
        settings.database_url,
        os.environ.get("RUNTIME_DB_USER", "food_app"),
        os.environ.get("RUNTIME_DB_PASSWORD", ""),
    )
    print("runtime role ready")
