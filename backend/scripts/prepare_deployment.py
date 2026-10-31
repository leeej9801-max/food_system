"""Create local deployment secrets and a consistent backup without changing the live SQLite DB."""

import secrets
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

root = Path(__file__).resolve().parents[2]
env_file = root / ".env.deploy"
if not env_file.exists():
    env_file.write_text(
        f"POSTGRES_PASSWORD={secrets.token_hex(32)}\n"
        "FOOD_PORT=8088\nTUNNEL_NETWORK=lci-prod_edge\n",
        encoding="utf-8",
    )
    print("Created .env.deploy (secret values not displayed)")

backup_dir = root / ".deploy"
backup_dir.mkdir(exist_ok=True)
backup = backup_dir / f"sqlite-before-docker-{datetime.now(UTC):%Y%m%d-%H%M%S}.db"
source_path = root / "backend" / "local_dev.db"
with (
    sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True) as source,
    sqlite3.connect(backup) as target,
):
    source.backup(target)
print(f"SQLite backup: {backup}")
