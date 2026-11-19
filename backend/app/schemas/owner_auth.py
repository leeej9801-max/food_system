from uuid import UUID

from pydantic import BaseModel


class OwnerStoreItem(BaseModel):
    id: UUID
    name: str


class OwnerMe(BaseModel):
    owner_id: UUID
    nickname: str | None
    stores: list[OwnerStoreItem]
