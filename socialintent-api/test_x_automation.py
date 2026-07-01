# -*- coding: utf-8 -*-
"""
Verification script for X Automation system of SocialIntent AI.
"""
import os
import sys
import unittest

# Ensure API directory is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import database
from x_automation.x_bot import XBot
from x_automation.visual_generator import generate_trend_radar
from x_automation.scheduler import (
    run_daily_trend_task, 
    run_keyword_monitor_task, 
    run_dm_response_monitor_task
)

class TestXAutomation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Initialize database
        database.init_db()

    def test_database_posted_threads(self):
        """Verify we can record and retrieve posted threads in the SQLite database."""
        test_tweet_id = "test_tweet_12345"
        test_keyword = "Test Keyword AI"
        
        # Clean up any existing test records
        conn = database.get_db_connection()
        conn.execute("DELETE FROM x_posted_threads WHERE tweet_id = ?", (test_tweet_id,))
        conn.commit()
        conn.close()

        # Insert record
        success = database.record_x_posted_thread(test_tweet_id, test_keyword)
        self.assertTrue(success, "Should successfully insert posted thread record")

        # Retrieve keyword
        retrieved_keyword = database.get_x_posted_thread_keyword(test_tweet_id)
        self.assertEqual(retrieved_keyword, test_keyword, "Retrieved keyword should match inserted keyword")

        # Double insertion should fail (IntegrityError due to PRIMARY KEY constraint)
        fail_success = database.record_x_posted_thread(test_tweet_id, "Another Keyword")
        self.assertFalse(fail_success, "Should fail on double insertion with same tweet_id")

        # Clean up test record
        conn = database.get_db_connection()
        conn.execute("DELETE FROM x_posted_threads WHERE tweet_id = ?", (test_tweet_id,))
        conn.commit()
        conn.close()

    def test_visual_generator(self):
        """Verify we can generate a radar chart PNG image."""
        test_keyword = "Test Visuals"
        test_scores = {
            "YouTube": 85,
            "Instagram": 65,
            "TikTok": 90,
            "X": 70,
            "Google SEO": 50
        }
        
        chart_path = generate_trend_radar(test_keyword, test_scores, "test_chart")
        self.assertTrue(os.path.exists(chart_path), f"Chart image should exist at {chart_path}")
        
        # Verify it's a file
        self.assertTrue(os.path.isfile(chart_path))
        
        # Clean up generated file
        try:
            os.remove(chart_path)
        except OSError:
            pass

    def test_x_bot_simulation(self):
        """Verify XBot works correctly in simulation mode."""
        bot = XBot()
        # Force simulation mode for tests
        bot.is_simulation = True
        
        # Test upload_media
        media_id = bot.upload_media("dummy_path.png")
        self.assertEqual(media_id, "mock_media_id_12345")

        # Test post_thread
        tweets = ["Tweet 1", "Tweet 2", "Tweet 3"]
        last_id = bot.post_thread(tweets, media_id=media_id)
        self.assertEqual(last_id, "mock_tweet_id_thread_end")

        # Test reply_to_tweet
        reply_id = bot.reply_to_tweet("parent_id", "Reply text")
        self.assertEqual(reply_id, "mock_reply_id_5678")

        # Test search_recent_tweets
        search_res = bot.search_recent_tweets("分析")
        self.assertIsNotNone(search_res.data)
        self.assertEqual(search_res.data[0].text, "分析")

        # Test send_dm
        dm_success = bot.send_dm("user_id", "DM content")
        self.assertTrue(dm_success)

    def test_scheduler_dry_runs(self):
        """Execute the scheduler tasks in dry run (simulation) mode to ensure no crashes."""
        print("\n--- Dry Run: run_daily_trend_task ---")
        try:
            run_daily_trend_task()
        except Exception as e:
            self.fail(f"run_daily_trend_task crashed: {e}")

        print("\n--- Dry Run: run_keyword_monitor_task ---")
        try:
            run_keyword_monitor_task()
        except Exception as e:
            self.fail(f"run_keyword_monitor_task crashed: {e}")

        print("\n--- Dry Run: run_dm_response_monitor_task ---")
        # Ensure our mock parent tweet ID is registered in the database for the DM search mock
        database.record_x_posted_thread("mock_tweet_id_thread_end", "Mock Gemini Topic")
        try:
            run_dm_response_monitor_task()
        except Exception as e:
            self.fail(f"run_dm_response_monitor_task crashed: {e}")
        finally:
            # Clean up mock thread record
            conn = database.get_db_connection()
            conn.execute("DELETE FROM x_posted_threads WHERE tweet_id = ?", ("mock_tweet_id_thread_end",))
            conn.commit()
            conn.close()

if __name__ == "__main__":
    unittest.main()
