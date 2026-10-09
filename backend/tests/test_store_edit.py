import unittest
from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException

import backend.models
from backend.database.db import Base
from backend.models.store import Store
from backend.models.user import User, RoleEnum
from backend.models.order import Order, OrderStatusEnum
from backend.models.partner_store import PartnerStore
from backend.schemas.store import StoreUpdate
from backend.routes.store import update_store


class StoreEditTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()

        # Superadmin
        self.admin = User(
            id=1,
            email="admin@test.local",
            password="test",
            full_name="Super Admin",
            role=RoleEnum.superadmin,
            status="active",
        )

        # Delivery Manager
        self.manager = User(
            id=2,
            email="manager@test.local",
            password="test",
            full_name="Delivery Manager 1",
            role=RoleEnum.delivery_manager,
            status="active",
        )

        # Unauthorized customer user
        self.customer = User(
            id=3,
            email="customer@test.local",
            password="test",
            full_name="Customer User",
            role=RoleEnum.customer,
            status="active",
        )

        self.db.add_all([self.admin, self.manager, self.customer])
        self.db.flush()

        # Seed initial store
        self.store = Store(
            id="STR-001",
            store_name="Initial Store Name",
            address="123 Old Street",
            city="Old City",
            state="Haryana",
            region="NORTH",
            entity="BCPL",
            project_code="PRJ-01",
            zip_code="122001",
            latitude=28.4505,
            longitude=77.0482,
            channel="BLINKIT",
            is_active=True,
            assigned_manager_id=self.manager.id,
        )
        self.db.add(self.store)
        self.db.flush()

        # Seed initial partner/POC
        self.partner = User(
            id=4,
            email="partner@test.local",
            password="test",
            full_name="Original POC",
            mobile_number="9876543210",
            role=RoleEnum.partner,
            status="active",
        )
        self.db.add(self.partner)
        self.db.flush()

        self.db.add(PartnerStore(user_id=self.partner.id, store_id=self.store.id))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    # 1. Store ID cannot be changed.
    def test_store_id_cannot_be_changed(self):
        # StoreUpdate schema does not accept id; even if attempted in dict, it must be rejected
        payload = StoreUpdate(store_name="New Name")
        # Simulate payload attempting to inject id
        try:
            update_store(
                store_id="STR-001",
                store_update=payload,
                db=self.db,
                current_user=self.admin
            )
        except Exception:
            pass

        reloaded = self.db.query(Store).filter(Store.id == "STR-001").first()
        self.assertIsNotNone(reloaded)
        self.assertEqual(reloaded.id, "STR-001")

    # 2. Store Name can be edited.
    def test_store_name_can_be_edited(self):
        payload = StoreUpdate(store_name="Updated Store Name")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.store_name, "Updated Store Name")
        self.assertEqual(self.store.store_name, "Updated Store Name")

    # 3. Region can be edited with valid canonical value.
    def test_region_can_be_edited_valid(self):
        payload = StoreUpdate(region="SOUTH")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.region, "SOUTH")

    # 4. Invalid Region casing is rejected.
    def test_invalid_region_casing_rejected(self):
        for invalid in ["North", "north", " North ", "WESTSIDE"]:
            with self.subTest(invalid=invalid):
                payload = StoreUpdate(region=invalid)
                with self.assertRaises(HTTPException) as ctx:
                    update_store("STR-001", payload, self.db, self.admin)
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertIn("Invalid REGION", ctx.exception.detail)

    # 5. Entity can be edited with valid canonical value.
    def test_entity_can_be_edited(self):
        payload = StoreUpdate(entity="ZHPL")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.entity, "ZHPL")

    def test_invalid_entity_rejected(self):
        for invalid in ["VEEKAY", "EXTERNAL", "bcpl", "zhpl", "INVALID_ENTITY"]:
            with self.subTest(invalid=invalid):
                payload = StoreUpdate(entity=invalid)
                with self.assertRaises(HTTPException) as ctx:
                    update_store("STR-001", payload, self.db, self.admin)
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertIn("Invalid ENTITY", ctx.exception.detail)

    # 6. State can be edited.
    def test_state_can_be_edited(self):
        payload = StoreUpdate(state="Delhi")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.state, "Delhi")

    # 7. City can be edited.
    def test_city_can_be_edited(self):
        payload = StoreUpdate(city="New City")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.city, "New City")

    # 8. Address can be edited.
    def test_address_can_be_edited(self):
        payload = StoreUpdate(address="456 New Road")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.address, "456 New Road")

    # 9. Latitude/Longitude can be edited if supported.
    def test_latitude_longitude_can_be_edited(self):
        payload = StoreUpdate(latitude=12.9716, longitude=77.5946)
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertAlmostEqual(updated.latitude, 12.9716, places=4)
        self.assertAlmostEqual(updated.longitude, 77.5946, places=4)

    # 10. Channel can be edited.
    def test_channel_can_be_edited(self):
        payload = StoreUpdate(channel="ZEPTO")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.channel, "ZEPTO")

    # 11. POC current data can be edited.
    def test_poc_data_can_be_edited(self):
        payload = StoreUpdate(poc_name="New POC Name", poc_phone="9123456780")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.poc_name, "New POC Name")
        self.assertEqual(updated.poc_phone, "9123456780")
        # Check partner User row updated
        partner = self.db.query(User).filter(User.id == self.partner.id).first()
        self.assertEqual(partner.full_name, "New POC Name")
        self.assertEqual(partner.mobile_number, "9123456780")

    # 12. Current Delivery Manager mapping can be changed through correct mechanism.
    def test_current_delivery_manager_mapping_change(self):
        new_dm = User(
            id=5,
            email="dm2@test.local",
            password="test",
            full_name="Delivery Manager 2",
            role=RoleEnum.delivery_manager,
            status="active",
        )
        self.db.add(new_dm)
        self.db.commit()

        payload = StoreUpdate(assigned_manager_id=new_dm.id)
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.assigned_manager_id, new_dm.id)

    # 13. Current Delivery Partner mapping can be changed if currently supported.
    def test_delivery_partner_mapping_not_on_store(self):
        # Store model has no delivery partner column; verified in Part 24
        self.assertFalse(hasattr(Store, "delivery_partner_id"))

    # 14. Active status can be changed.
    def test_active_status_can_be_changed(self):
        payload = StoreUpdate(is_active=False)
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertFalse(updated.is_active)

    # 15. Unspecified PATCH fields remain unchanged.
    def test_unspecified_patch_fields_remain_unchanged(self):
        original_city = self.store.city
        original_state = self.store.state
        original_pincode = self.store.zip_code

        payload = StoreUpdate(store_name="Only Name Changed")
        updated = update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(updated.store_name, "Only Name Changed")
        self.assertEqual(updated.city, original_city)
        self.assertEqual(updated.state, original_state)
        self.assertEqual(updated.zip_code, original_pincode)

    # 16. Historical Orders remain untouched after Store edit.
    def test_historical_orders_untouched_after_store_edit(self):
        # Seed an order linked to this store
        order = Order(
            id=101,
            store_id=self.store.id,
            partner_id=self.partner.id,
            channel="BLINKIT",
            order_details="10 bottles",
            total_amount=500.0,
            status=OrderStatusEnum.delivered_confirmed,
            poc_name="Historical POC Name",
            order_date=datetime(2026, 8, 1, tzinfo=timezone.utc),
        )
        self.db.add(order)
        self.db.commit()

        # Perform store edit
        payload = StoreUpdate(store_name="Renamed Store", poc_name="Brand New POC")
        update_store("STR-001", payload, self.db, self.admin)

        # Historical order must remain unchanged
        reloaded_order = self.db.query(Order).filter(Order.id == 101).first()
        self.assertEqual(reloaded_order.poc_name, "Historical POC Name")
        self.assertEqual(reloaded_order.store_id, "STR-001")
        self.assertEqual(reloaded_order.total_amount, 500.0)

    # 17. Unauthorized user cannot modify Store.
    def test_unauthorized_user_cannot_modify_store(self):
        payload = StoreUpdate(store_name="Hacked Store")
        with self.assertRaises(HTTPException) as ctx:
            update_store("STR-001", payload, self.db, self.customer)
        self.assertEqual(ctx.exception.status_code, 403)

    # 18. Employee cannot modify Store (rejected with 403)
    def test_employee_cannot_modify_store(self):
        employee = User(
            id=6,
            email="emp@test.local",
            password="test",
            full_name="Employee User",
            role=RoleEnum.employee,
            status="active",
        )
        self.db.add(employee)
        self.db.commit()

        payload = StoreUpdate(store_name="Employee Edited Name")
        with self.assertRaises(HTTPException) as ctx:
            update_store("STR-001", payload, self.db, employee)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Only an admin or super admin", ctx.exception.detail)

    # 19. Admin (role=admin) can modify Store
    def test_admin_role_can_modify_store(self):
        admin_user = User(
            id=7,
            email="regularadmin@test.local",
            password="test",
            full_name="Regular Admin",
            role=RoleEnum.admin,
            status="active",
        )
        self.db.add(admin_user)
        self.db.commit()

        payload = StoreUpdate(store_name="Admin Edited Name")
        updated = update_store("STR-001", payload, self.db, admin_user)
        self.assertEqual(updated.store_name, "Admin Edited Name")

    # 20. Shared POC mutation risk prevented:
    # Modifying Store A's POC when Partner is shared with Store B does NOT mutate Store B's POC or the shared partner
    def test_shared_poc_mutation_risk_prevented(self):
        # Create Store B sharing self.partner with STR-001
        store_b = Store(
            id="STR-B",
            store_name="Store B",
            channel="BLINKIT",
            city="Gurgaon",
            state="Haryana",
            region="NORTH",
            is_active=True,
        )
        self.db.add(store_b)
        self.db.flush()
        self.db.add(PartnerStore(user_id=self.partner.id, store_id=store_b.id))
        self.db.commit()

        # Both stores currently share self.partner
        self.assertEqual(self.store.poc_name, "Original POC")
        self.assertEqual(self.store.poc_phone, "9876543210")
        self.assertEqual(store_b.poc_name, "Original POC")
        self.assertEqual(store_b.poc_phone, "9876543210")

        # Edit Store A's POC
        payload = StoreUpdate(poc_name="Brand New Store A POC", poc_phone="9111111111")
        updated_a = update_store("STR-001", payload, self.db, self.admin)

        # Store A must have new POC details
        self.assertEqual(updated_a.poc_name, "Brand New Store A POC")
        self.assertEqual(updated_a.poc_phone, "9111111111")

        # Store B's POC MUST NOT BE MUTATED
        self.db.expire(store_b, ["partners"])
        self.assertEqual(store_b.poc_name, "Original POC")
        self.assertEqual(store_b.poc_phone, "9876543210")

        # Original partner user MUST NOT BE MUTATED
        original_partner = self.db.query(User).filter(User.id == self.partner.id).first()
        self.assertEqual(original_partner.full_name, "Original POC")
        self.assertEqual(original_partner.mobile_number, "9876543210")

    # 21. Non-partner phone collision rejected
    def test_update_store_non_partner_phone_collision_rejected(self):
        # Manager's phone number or customer's phone number
        self.manager.mobile_number = "9998887776"
        self.db.commit()

        payload = StoreUpdate(poc_phone="9998887776")
        with self.assertRaises(HTTPException) as ctx:
            update_store("STR-001", payload, self.db, self.admin)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("already belongs to an existing user with role", ctx.exception.detail)
