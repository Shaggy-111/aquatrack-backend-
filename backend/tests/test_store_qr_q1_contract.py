import asyncio
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException

from backend.routes import store_qr_delivery
from backend.services.store_qr_delivery import IST
from backend.utils.store_qr_tokens import StoreQrTokenError, decode_store_qr_token


class StoreQrQ1ContractTests(unittest.TestCase):
    def test_scan_returns_server_controlled_ist_business_date(self):
        request = SimpleNamespace(client=SimpleNamespace(host="127.0.0.21"))
        store = SimpleNamespace(
            store_name="Store Q1",
            city="Delhi",
            channel="GENERAL",
            qr_public_id="qid-q1",
            qr_token_version=1,
        )
        with (
            patch.object(store_qr_delivery.scan_rate_limiter, "allow", return_value=True),
            patch.object(
                store_qr_delivery,
                "_decode_permanent_token",
                return_value={"qid": "qid-q1", "ver": 1},
            ),
            patch.object(
                store_qr_delivery,
                "get_scan_context",
                return_value=(store, None),
            ),
            patch.object(
                store_qr_delivery,
                "create_submission_token",
                return_value=("submission", "idem", "jti"),
            ),
        ):
            response = store_qr_delivery.scan_store_qr(
                "signed-token", request, SimpleNamespace()
            )

        self.assertEqual(response.business_date, datetime.now(IST).date())

    def test_submit_contract_requires_integer_empty_and_accepts_no_date_or_ids(self):
        app = FastAPI()
        app.include_router(store_qr_delivery.router)
        schema = app.openapi()
        request_schema = schema["paths"]["/store-qr/submit"]["post"]["requestBody"][
            "content"
        ]["multipart/form-data"]["schema"]
        if "$ref" in request_schema:
            request_schema = schema["components"]["schemas"][
                request_schema["$ref"].rsplit("/", 1)[-1]
            ]

        self.assertIn("empty_bottles_collected", request_schema["required"])
        self.assertEqual(
            request_schema["properties"]["empty_bottles_collected"]["type"],
            "integer",
        )
        for forbidden in ("business_date", "delivery_date", "store_id", "qr_public_id", "order_id"):
            self.assertNotIn(forbidden, request_schema["properties"])

    def test_negative_empty_is_rejected_before_transaction(self):
        request = SimpleNamespace(
            client=SimpleNamespace(host="127.0.0.22"),
            headers={},
        )
        with patch.object(
            store_qr_delivery.submit_rate_limiter,
            "allow",
            return_value=True,
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(
                    store_qr_delivery.submit_qr_delivery(
                        request=request,
                        submission_token="unused",
                        idempotency_key="00000000-0000-0000-0000-000000000001",
                        bottles_delivered=5,
                        empty_bottles_collected=-1,
                        remarks=None,
                        delivered_by=None,
                        latitude=None,
                        longitude=None,
                        gps_accuracy=None,
                        photo=None,
                        db=SimpleNamespace(),
                    )
                )
        self.assertEqual(raised.exception.status_code, 400)

    def test_raw_qr_public_id_is_not_a_valid_permanent_token(self):
        with self.assertRaises(StoreQrTokenError):
            decode_store_qr_token("7d4ac54f-raw-public-id")


if __name__ == "__main__":
    unittest.main()
