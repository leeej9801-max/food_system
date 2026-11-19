from fastapi import APIRouter

from app.api.v1.endpoints import (
    analytics,
    attendance,
    holidays,
    imports,
    ingredients,
    inventory,
    menus,
    owner_auth,
    pnl,
    staff_auth,
    stores,
    tables,
    weather,
)

api_router = APIRouter()
api_router.include_router(stores.router)
api_router.include_router(tables.router)
api_router.include_router(menus.router)
api_router.include_router(menus.category_router)
api_router.include_router(ingredients.router)
api_router.include_router(imports.router)
api_router.include_router(inventory.router)
api_router.include_router(analytics.router)
api_router.include_router(holidays.router)
api_router.include_router(pnl.router)
api_router.include_router(weather.router)
api_router.include_router(attendance.router)
api_router.include_router(staff_auth.router)
api_router.include_router(staff_auth.owner)
api_router.include_router(staff_auth.mobile)
api_router.include_router(owner_auth.router)
