"""Copy a SQLite snapshot into an empty, migrated deployment DB without changing the source."""

import argparse
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import Engine

import app.db.models  # noqa: F401
from app.core.config import settings
from app.db.base import Base


def copy_data(source: Engine, target: Engine) -> dict[str, int]:
    tables = Base.metadata.sorted_tables
    counts: dict[str, int] = {}
    with source.connect() as src, target.begin() as dest:
        for table in tables:
            if dest.scalar(select(func.count()).select_from(table)):
                raise ValueError("Target DB is not empty; refusing to overwrite or merge data")
        for table in tables:
            rows = []
            for row in src.execute(select(table)).mappings():
                values = dict(row)
                for name, value in values.items():
                    if isinstance(value, datetime) and value.tzinfo is None:
                        values[name] = value.replace(tzinfo=UTC)
                rows.append(values)
            if rows:
                dest.execute(table.insert(), rows)
            counts[table.name] = len(rows)
            if dest.scalar(select(func.count()).select_from(table)) != len(rows):
                raise ValueError(f"Row count mismatch: {table.name}")
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="An existing SQLite backup file")
    args = parser.parse_args()
    source_path = args.source.resolve(strict=True)
    source_engine = create_engine(f"sqlite:///file:{source_path.as_posix()}?mode=ro&uri=true")
    target_engine = create_engine(settings.database_url)
    print(copy_data(source_engine, target_engine))
