import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError

from app.db.base import Base
from app.db.models import MenuItem, Store
from scripts.import_sqlite import copy_data


def test_import_preserves_ids_relationships_and_refuses_nonempty_target():
    source = create_engine("sqlite://")
    target = create_engine("sqlite://")
    Base.metadata.create_all(source)
    Base.metadata.create_all(target)
    with source.begin() as connection:
        connection.execute(Store.__table__.insert(), {"id": "store-1", "name": "test"})
        connection.execute(MenuItem.__table__.insert(), {
            "id": "menu-1", "store_id": "store-1", "name": "pasta", "selling_price": 12000,
        })
    counts = copy_data(source, target)
    assert counts["stores"] == 1
    assert counts["menu_items"] == 1
    with target.connect() as connection:
        assert connection.scalar(select(MenuItem.store_id)) == "store-1"
    with pytest.raises(ValueError, match="not empty"):
        copy_data(source, target)
    with source.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Store)) == 1


def test_failed_import_rolls_back_all_previously_copied_tables():
    source = create_engine("sqlite://")
    target = create_engine("sqlite://")
    Base.metadata.create_all(source)
    Base.metadata.create_all(target)
    with source.begin() as connection:
        connection.execute(Store.__table__.insert(), {"id": "store-1", "name": "test"})
        connection.execute(MenuItem.__table__.insert(), {
            "id": "menu-1", "store_id": "store-1", "name": "pasta",
        })
    with target.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER reject_menu BEFORE INSERT ON menu_items "
            "BEGIN SELECT RAISE(ABORT, 'test failure'); END"
        )
    with pytest.raises(IntegrityError):
        copy_data(source, target)
    with target.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(Store)) == 0
