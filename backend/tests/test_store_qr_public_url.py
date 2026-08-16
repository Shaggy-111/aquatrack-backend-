import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.routes.store_qr_delivery import _qr_url


class StoreQrPublicUrlTests(unittest.TestCase):
    def test_uses_configured_public_browser_url(self):
        with patch(
            "backend.routes.store_qr_delivery.settings",
            SimpleNamespace(STORE_QR_PUBLIC_BASE_URL="https://veekayaquatech.com/qr/"),
        ):
            self.assertEqual(
                _qr_url(None, "token"),
                "https://veekayaquatech.com/qr/token",
            )

    def test_forces_https_for_configured_url(self):
        with patch(
            "backend.routes.store_qr_delivery.settings",
            SimpleNamespace(STORE_QR_PUBLIC_BASE_URL="http://example.com/qr"),
        ):
            self.assertEqual(
                _qr_url(None, "token"),
                "https://example.com/qr/token",
            )

    def test_uses_https_public_fallback(self):
        with patch(
            "backend.routes.store_qr_delivery.settings",
            SimpleNamespace(STORE_QR_PUBLIC_BASE_URL=None),
        ):
            self.assertEqual(
                _qr_url(None, "token"),
                "https://aquatrack-prod-final.fly.dev/qr/token",
            )


if __name__ == "__main__":
    unittest.main()
