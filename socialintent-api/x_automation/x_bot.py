# -*- coding: utf-8 -*-
import os
import time
import tweepy

class XBot:
    def __init__(self):
        self.consumer_key = os.environ.get("X_CONSUMER_KEY")
        self.consumer_secret = os.environ.get("X_CONSUMER_SECRET")
        self.access_token = os.environ.get("X_ACCESS_TOKEN")
        self.access_token_secret = os.environ.get("X_ACCESS_TOKEN_SECRET")
        self.bearer_token = os.environ.get("X_BEARER_TOKEN")
        
        # Check if we should run in simulation mode
        self.is_simulation = False
        if not all([self.consumer_key, self.consumer_secret, self.access_token, self.access_token_secret]):
            self.is_simulation = True
            print("X Bot: X API credentials not fully configured. Running in SIMULATION MODE.")
        else:
            try:
                # API v1.1 for media upload
                auth = tweepy.OAuth1UserHandler(
                    self.consumer_key, self.consumer_secret, 
                    self.access_token, self.access_token_secret
                )
                self.api_v1 = tweepy.API(auth)
                
                # API v2 for posting and DM
                self.client = tweepy.Client(
                    bearer_token=self.bearer_token,
                    consumer_key=self.consumer_key,
                    consumer_secret=self.consumer_secret,
                    access_token=self.access_token,
                    access_token_secret=self.access_token_secret
                )
                print("X Bot: Real X API Client initialized successfully.")
            except Exception as e:
                print(f"X Bot initialization failed: {e}. Falling back to SIMULATION MODE.")
                self.is_simulation = True

    def upload_media(self, image_path):
        """Upload image to X and return media_id."""
        if self.is_simulation:
            print(f"[X BOT SIMULATION] Uploading image: {image_path}")
            return "mock_media_id_12345"
            
        try:
            media = self.api_v1.media_upload(filename=image_path)
            print(f"X Bot: Image successfully uploaded to X. Media ID: {media.media_id}")
            return media.media_id
        except Exception as e:
            print(f"X Bot: Failed to upload media: {e}")
            return None

    def post_thread(self, tweets, media_id=None):
        """
        Posts a thread (list of tweet texts).
        Attaches media_id to the first tweet if provided.
        Returns the final tweet ID of the thread.
        """
        if self.is_simulation:
            print(f"[X BOT SIMULATION] Posting thread ({len(tweets)} tweets):")
            for idx, text in enumerate(tweets):
                media_info = f" (Attached Media: {media_id})" if idx == 0 and media_id else ""
                print(f"  Tweet {idx+1}/{len(tweets)}: {text}{media_info}")
            return "mock_tweet_id_thread_end"

        previous_tweet_id = None
        try:
            for i, text in enumerate(tweets):
                if i == 0 and media_id:
                    response = self.client.create_tweet(text=text, media_ids=[media_id])
                elif previous_tweet_id:
                    response = self.client.create_tweet(text=text, in_reply_to_tweet_id=previous_tweet_id)
                else:
                    response = self.client.create_tweet(text=text)
                    
                previous_tweet_id = response.data['id']
                print(f"X Bot: Posted tweet {i+1}/{len(tweets)}. ID: {previous_tweet_id}")
                time.sleep(2)  # 2-second delay to comply with X posting limits and prevent rate limit blocks
            return previous_tweet_id
        except Exception as e:
            print(f"X Bot: Failed to post thread: {e}")
            return previous_tweet_id

    def send_dm(self, recipient_id, message_text):
        """Sends a Direct Message to a user."""
        if self.is_simulation:
            print(f"[X BOT SIMULATION] Sending DM to User {recipient_id}: {message_text}")
            return True
            
        try:
            # Note: tweepy send_direct_message requires appropriate Direct Message API permissions
            self.client.send_direct_message(
                recipient_id=recipient_id,
                text=message_text
            )
            print(f"X Bot: DM successfully sent to user {recipient_id}")
            return True
        except Exception as e:
            print(f"X Bot: Failed to send DM to user {recipient_id}: {e}")
            return False

    def reply_to_tweet(self, tweet_id, text):
        """Replies to a specific tweet."""
        if self.is_simulation:
            print(f"[X BOT SIMULATION] Replying to Tweet {tweet_id}: {text}")
            return "mock_reply_id_5678"
            
        try:
            response = self.client.create_tweet(text=text, in_reply_to_tweet_id=tweet_id)
            reply_id = response.data['id']
            print(f"X Bot: Successfully replied to tweet {tweet_id}. Reply ID: {reply_id}")
            return reply_id
        except Exception as e:
            print(f"X Bot: Failed to reply to tweet {tweet_id}: {e}")
            return None

    def search_recent_tweets(self, query, max_results=10):
        """Searches recent tweets matching query."""
        if self.is_simulation:
            print(f"[X BOT SIMULATION] Searching tweets for query: '{query}'")
            mock_tweets = []
            if "分析" in query:
                # Mock a user reply "分析" to our thread end
                mock_tweets.append(
                    MockTweet(
                        id="mock_reply_id_analysis_1",
                        author_id="mock_user_888",
                        text="分析",
                        referenced_tweets=[MockReferencedTweet(id="mock_tweet_id_thread_end", type="replied_to")]
                    )
                )
            else:
                # Mock some general organic tweets
                mock_tweets.append(
                    MockTweet(
                        id="mock_keyword_tweet_1",
                        author_id="mock_user_111",
                        text="最近副業でAIツール使いたいなと思ってるんだけど、何がおすすめ？"
                    )
                )
                mock_tweets.append(
                    MockTweet(
                        id="mock_keyword_tweet_2",
                        author_id="mock_user_222",
                        text="インスタのフォロワーを伸ばし方、誰か教えて！全然増えない。。"
                    )
                )
            return MockResponse(data=mock_tweets)

        try:
            response = self.client.search_recent_tweets(
                query=query,
                tweet_fields=["author_id", "created_at", "referenced_tweets"],
                max_results=max_results
            )
            return response
        except Exception as e:
            print(f"X Bot: Failed to search tweets: {e}")
            return None

    def get_username(self):
        """Get the authenticated bot username."""
        username = os.environ.get("X_BOT_USERNAME")
        if username:
            return username
            
        if self.is_simulation:
            return "socialintent_ai"
            
        try:
            me = self.client.get_me()
            if me and me.data:
                return me.data.username
        except Exception as e:
            print(f"X Bot: Failed to fetch me/username: {e}")
        return "socialintent_ai"

# Helper classes for simulation/mock mode
class MockTweet:
    def __init__(self, id, author_id, text, referenced_tweets=None):
        self.id = id
        self.author_id = author_id
        self.text = text
        self.referenced_tweets = referenced_tweets or []

class MockReferencedTweet:
    def __init__(self, id, type="replied_to"):
        self.id = id
        self.type = type

class MockResponse:
    def __init__(self, data):
        self.data = data

