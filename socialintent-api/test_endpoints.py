# -*- coding: utf-8 -*-
"""
Unit tests for SocialIntent Flask API endpoints.
"""
import os
import sys
import json
import unittest
from unittest.mock import patch, MagicMock

# Add current directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configure test environment variables before importing app
os.environ["STRIPE_SECRET_KEY"] = "sk_test_mock_12345"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_mock_12345"
os.environ["GEMINI_API_KEY"] = "mock_gemini_api_key"
os.environ["LICENSE_SIGNING_SALT"] = "test_signing_salt_for_unit_tests"

import database
from main import app, generate_license_key

class TestEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Initialize database
        database.init_db()

    def setUp(self):
        # Create Flask test client
        self.app = app.test_client()
        self.app.testing = True

        # Clear proxy usage rate limits and validation logs
        from main import proxy_usage, checkout_creation_log, license_validation_log
        proxy_usage.clear()
        checkout_creation_log.clear()
        license_validation_log.clear()

    def test_root_endpoint(self):
        """Test GET / returns API proxy info."""
        response = self.app.get('/')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["status"], "ok")
        self.assertIn("SocialIntent API Proxy", data["service"])

    def test_health_endpoint(self):
        """Test GET /health returns healthy status."""
        response = self.app.get('/health')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data["status"], "healthy")

    def test_checkout_session_creation(self):
        """Test POST /api/checkout-session creates session in mock mode."""
        payload = {
            "email": "test@example.com",
            "origin": "http://test-origin.com"
        }
        response = self.app.post('/api/checkout-session', 
                                 data=json.dumps(payload),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn("id", data)
        self.assertIn("url", data)
        self.assertTrue(data["id"].startswith("mock_session_"))

    def test_checkout_session_creation_rate_limit(self):
        """Test POST /api/checkout-session triggers rate limiting after 5 requests from the same IP."""
        payload = {
            "email": "test@example.com",
            "origin": "http://test-origin.com"
        }
        # First 5 requests should pass
        for _ in range(5):
            response = self.app.post('/api/checkout-session', 
                                     data=json.dumps(payload),
                                     content_type='application/json',
                                     headers={"X-Forwarded-For": "192.168.1.1"})
            self.assertEqual(response.status_code, 200)
            
        # 6th request should be rate limited (429)
        response = self.app.post('/api/checkout-session', 
                                 data=json.dumps(payload),
                                 content_type='application/json',
                                 headers={"X-Forwarded-For": "192.168.1.1"})
        self.assertEqual(response.status_code, 429)
        data = json.loads(response.data)
        self.assertIn("error", data)

    def test_stripe_webhook_completed(self):
        """Test Stripe Webhook checkout.session.completed inserts to database and generates license."""
        # Clean up any existing transaction
        test_session_id = "mock_session_webhook_test"
        conn = database.get_db_connection()
        conn.execute("DELETE FROM transactions WHERE transaction_id = ?", (test_session_id,))
        conn.execute("DELETE FROM licenses WHERE transaction_id = ?", (test_session_id,))
        conn.commit()
        conn.close()

        # In mock mode, construct_webhook_event returns mock dict.
        # Let's mock stripe_integration.construct_webhook_event to return our specific test session
        with patch('stripe_integration.construct_webhook_event') as mock_webhook:
            mock_webhook.return_value = {
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "id": test_session_id,
                        "customer_email": "webhook_customer@test.com",
                        "amount_total": 580
                    }
                }
            }
            
            response = self.app.post('/webhook/stripe', 
                                     data=json.dumps({}),
                                     headers={"Stripe-Signature": "dummy_sig"})
            self.assertEqual(response.status_code, 200)
            
            # Verify license generated in DB
            license_data = database.get_license_by_transaction(test_session_id)
            self.assertIsNotNone(license_data)
            self.assertEqual(license_data["email"], "webhook_customer@test.com")
            
            # Clean up
            conn = database.get_db_connection()
            conn.execute("DELETE FROM transactions WHERE transaction_id = ?", (test_session_id,))
            conn.execute("DELETE FROM licenses WHERE transaction_id = ?", (test_session_id,))
            conn.commit()
            conn.close()

    def test_checkout_session_status(self):
        """Test GET /api/checkout-session-status returns correct payment status and license."""
        # 1. Non-existent session
        with patch('stripe_integration.retrieve_checkout_session') as mock_retrieve:
            mock_retrieve.return_value = None
            response = self.app.get('/api/checkout-session-status?session_id=non_existent')
            self.assertEqual(response.status_code, 404)

        # 2. Existing paid session
        test_session_id = "mock_session_status_test"
        # Mock retrieval of successful payment
        with patch('stripe_integration.retrieve_checkout_session') as mock_retrieve:
            mock_retrieve.return_value = {
                "id": test_session_id,
                "payment_status": "paid",
                "customer_details": {"email": "status_customer@test.com"},
                "amount_total": 580
            }
            
            # Clean database first
            conn = database.get_db_connection()
            conn.execute("DELETE FROM transactions WHERE transaction_id = ?", (test_session_id,))
            conn.execute("DELETE FROM licenses WHERE transaction_id = ?", (test_session_id,))
            conn.commit()
            conn.close()
            
            # Call status endpoint (it should generate license if not already in DB)
            response = self.app.get(f'/api/checkout-session-status?session_id={test_session_id}')
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.data)
            self.assertEqual(data["status"], "paid")
            self.assertIn("license_key", data)
            
            # Clean up
            conn = database.get_db_connection()
            conn.execute("DELETE FROM transactions WHERE transaction_id = ?", (test_session_id,))
            conn.execute("DELETE FROM licenses WHERE transaction_id = ?", (test_session_id,))
            conn.commit()
            conn.close()

    def test_validate_license(self):
        """Test POST /api/validate-license validates license keys."""
        # Cryptographically generate a valid key
        valid_key = generate_license_key()
        
        # Verify it validates correctly via API
        response = self.app.post('/api/validate-license',
                                 data=json.dumps({"license_key": valid_key}),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data["valid"])

        # Verify an invalid key fails
        response = self.app.post('/api/validate-license',
                                 data=json.dumps({"license_key": "INVALID-KEY"}),
                                 content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertFalse(data["valid"])

    def test_gemini_proxy_unauthorized(self):
        """Test POST /api/gemini-proxy without a license key gets rate-limited or fails."""
        # 1. Test standard rate limit of 2 requests/day
        # Perform 2 requests
        for i in range(2):
            response = self.app.post('/api/gemini-proxy',
                                     data=json.dumps({"contents": [{"parts": [{"text": "Hello"}]}]}),
                                     content_type='application/json',
                                     headers={"X-Forwarded-For": "10.0.0.1"})
            self.assertNotEqual(response.status_code, 429)

        # 3rd request should be rate-limited (429)
        response = self.app.post('/api/gemini-proxy',
                                 data=json.dumps({"contents": [{"parts": [{"text": "Hello"}]}]}),
                                 content_type='application/json',
                                 headers={"X-Forwarded-For": "10.0.0.1"})
        self.assertEqual(response.status_code, 429)

        # 2. Test viral loop share bypass (limit of 3 requests/day)
        # Perform 3 requests with X-Share-Unlocked header
        for i in range(3):
            response = self.app.post('/api/gemini-proxy',
                                     data=json.dumps({"contents": [{"parts": [{"text": "Hello"}]}]}),
                                     content_type='application/json',
                                     headers={
                                         "X-Forwarded-For": "10.0.0.9",
                                         "X-Share-Unlocked": "true"
                                     })
            self.assertNotEqual(response.status_code, 429)

        # 4th request with X-Share-Unlocked header should be rate-limited (429)
        response = self.app.post('/api/gemini-proxy',
                                 data=json.dumps({"contents": [{"parts": [{"text": "Hello"}]}]}),
                                 content_type='application/json',
                                 headers={
                                     "X-Forwarded-For": "10.0.0.9",
                                     "X-Share-Unlocked": "true"
                                 })
        self.assertEqual(response.status_code, 429)

    def test_gemini_proxy_authorized(self):
        """Test POST /api/gemini-proxy with a valid license key bypasses free rate limits."""
        with patch('main.http_requests.post') as mock_post:
            # Mock Gemini response
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"candidates": [{"content": {"parts": [{"text": "Mocked Gemini Response"}]}}]}
            mock_post.return_value = mock_response

            valid_key = generate_license_key()

            # Perform 5 requests with the valid key (exceeding the free tier rate limit of 3)
            for _ in range(5):
                response = self.app.post('/api/gemini-proxy',
                                         data=json.dumps({"contents": [{"parts": [{"text": "Hello"}]}]}),
                                         content_type='application/json',
                                         headers={
                                             "X-Forwarded-For": "10.0.0.2",
                                             "X-License-Key": valid_key
                                         })
                self.assertEqual(response.status_code, 200)
                data = json.loads(response.data)
                self.assertIn("candidates", data)

    def test_trends_page_caching(self):
        """Test GET /trends/<keyword> renders properly and caches the results."""
        keyword = "TestEndpointTrend"
        
        # Clean any cached trend
        conn = database.get_db_connection()
        conn.execute("DELETE FROM cached_trends WHERE keyword = ?", (keyword,))
        conn.commit()
        conn.close()

        # Call trend page (which will mock analysis and render templates)
        response = self.app.get(f'/trends/{keyword}')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"TestEndpointTrend", response.data)
        
        # Verify cached trend in database
        cached = database.get_cached_trend(keyword)
        self.assertIsNotNone(cached)
        
        # Call again (should load from cache)
        response2 = self.app.get(f'/trends/{keyword}')
        self.assertEqual(response2.status_code, 200)

        # Clean up cache
        conn = database.get_db_connection()
        conn.execute("DELETE FROM cached_trends WHERE keyword = ?", (keyword,))
        conn.commit()
        conn.close()

if __name__ == '__main__':
    unittest.main()
