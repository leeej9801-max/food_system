from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Ingredient, InventoryReceipt, MenuItem
from app.schemas import (
    IngredientCreate,
    InventoryReceiptCreate,
    MenuCreate,
    RecipeItemInput,
    RecipeUpsertRequest,
)
from app.services import ingredients as ing_service
from app.services import inventory as inv_service
from app.services import menus as menu_service


def seed_western_bistro_demo(db: Session, *, store_id: str) -> dict[str, int]:
    """양식당(Western Bistro) 프로토타입 시연용 마스터 데이터(식자재·메뉴·레시피·입고단가) 일괄 세팅.
    이미 존재하는 항목은 건너뛰어 멱등성을 보장하며, 가짜 매출은 자동 커밋하지 않는다.
    """
    menu_service.get_store_or_404(db, store_id)

    demo_ingredients = [
        {
            "name": "스파게티면(데체코)",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(1500),
            "purchase_qty": Decimal(3),
            "total_cost": Decimal(27000),  # 9원/g
        },
        {
            "name": "관찰레(이탈리아산)",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(500),
            "purchase_qty": Decimal(1),
            "total_cost": Decimal(32000),  # 32원/g
        },
        {
            "name": "페코리노 로마노 치즈",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(400),
            "purchase_qty": Decimal(1),
            "total_cost": Decimal(45000),  # 45원/g
        },
        {
            "name": "엑스트라버진 올리브오일",
            "base_unit": "ml",
            "purchase_unit": "L",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(500),
            "purchase_qty": Decimal(2),
            "total_cost": Decimal(36000),  # 18원/ml
        },
        {
            "name": "프라임 부채살",
            "base_unit": "g",
            "purchase_unit": "kg",
            "conversion_factor": Decimal(1000),
            "safety_stock": Decimal(1000),
            "purchase_qty": Decimal(2),
            "total_cost": Decimal(84000),  # 42원/g
        },
    ]

    ing_map: dict[str, str] = {}
    created_ings = 0
    created_receipts = 0

    for item in demo_ingredients:
        existing = db.scalars(
            select(Ingredient).where(
                Ingredient.store_id == store_id,
                Ingredient.name == str(item["name"]),
            )
        ).first()
        if existing is None:
            created = ing_service.create_ingredient(
                db,
                store_id=store_id,
                payload=IngredientCreate(
                    name=str(item["name"]),
                    base_unit=item["base_unit"],  # type: ignore[arg-type]
                    purchase_unit=item["purchase_unit"],  # type: ignore[arg-type]
                    conversion_factor=Decimal(str(item["conversion_factor"])),
                    safety_stock=Decimal(str(item["safety_stock"])),
                ),
            )
            ing_id = created.id
            created_ings += 1
        else:
            ing_id = existing.id
        ing_map[str(item["name"])] = ing_id

        has_receipt = db.scalars(
            select(InventoryReceipt).where(
                InventoryReceipt.store_id == store_id,
                InventoryReceipt.ingredient_id == ing_id,
            )
        ).first()
        if has_receipt is None:
            inv_service.create_receipt(
                db,
                store_id=store_id,
                payload=InventoryReceiptCreate(
                    ingredient_id=ing_id,
                    purchase_quantity=Decimal(str(item["purchase_qty"])),
                    total_cost=Decimal(str(item["total_cost"])),
                    supplier_name="유로푸드 파트너스(프로토타입)",
                    notes="프로토타입 초기 입고 단가",
                ),
            )
            created_receipts += 1

    demo_menus = [
        {
            "name": "까르보나라",
            "category": "파스타",
            "selling_price": Decimal(16000),
            "recipe": [
                ("스파게티면(데체코)", Decimal(120)),
                ("관찰레(이탈리아산)", Decimal(50)),
                ("페코리노 로마노 치즈", Decimal(30)),
            ],
        },
        {
            "name": "알리오올리오",
            "category": "파스타",
            "selling_price": Decimal(14000),
            "recipe": [
                ("스파게티면(데체코)", Decimal(120)),
                ("엑스트라버진 올리브오일", Decimal(45)),
                ("페코리노 로마노 치즈", Decimal(15)),
            ],
        },
        {
            "name": "부채살 스테이크",
            "category": "스테이크",
            "selling_price": Decimal(29000),
            "recipe": [
                ("프라임 부채살", Decimal(220)),
                ("엑스트라버진 올리브오일", Decimal(20)),
            ],
        },
        {
            "name": "하우스 와인(글라스)",
            "category": "음료/와인",
            "selling_price": Decimal(9000),
            "recipe": [],
        },
    ]

    created_menus = 0
    for m_item in demo_menus:
        existing_menu = db.scalars(
            select(MenuItem).where(
                MenuItem.store_id == store_id,
                MenuItem.name == str(m_item["name"]),
            )
        ).first()
        if existing_menu is None:
            created_m = menu_service.create_menu(
                db,
                store_id=store_id,
                payload=MenuCreate(
                    name=str(m_item["name"]),
                    category=str(m_item["category"]),
                    selling_price=Decimal(str(m_item["selling_price"])),
                    is_active=True,
                ),
            )
            menu_id = created_m.id
            created_menus += 1
        else:
            menu_id = existing_menu.id

        recipe_tuples: list[tuple[str, Decimal]] = m_item["recipe"]  # type: ignore[assignment]
        if recipe_tuples:
            ing_service.upsert_menu_recipe(
                db,
                store_id=store_id,
                menu_id=menu_id,
                payload=RecipeUpsertRequest(
                    items=[
                        RecipeItemInput(
                            ingredient_id=ing_map[ing_name],
                            quantity=qty,
                        )
                        for ing_name, qty in recipe_tuples
                    ]
                ),
            )

    return {
        "ingredients_created": created_ings,
        "menus_created": created_menus,
        "receipts_created": created_receipts,
    }
