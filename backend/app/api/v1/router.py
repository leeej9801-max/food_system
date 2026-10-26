from fastapi import APIRouter

from app.api.v1.endpoints import (
    analytics,
    imports,
    ingredients,
    inventory,
    menus,
    stores,
    tables,
)

api_router = APIRouter()
api_router.include_router(stores.router)
api_router.include_router(tables.router)
api_router.include_router(menus.router)
api_router.include_router(ingredients.router)
api_router.include_router(imports.router)
api_router.include_router(inventory.router)
api_router.include_router(analytics.router)
