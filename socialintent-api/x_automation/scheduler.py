# -*- coding: utf-8 -*-
import os
import re
import time
import json
import random
import urllib.parse
import shutil
import requests
from apscheduler.schedulers.background import BackgroundScheduler
import database
from x_automation.x_bot import XBot
from x_automation.visual_generator import generate_trend_radar

# Initialize bot client
bot = XBot()

def call_gemini_api(prompt):
    """Utility to call Gemini API directly using configured key."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Scheduler: GEMINI_API_KEY not configured. Falling back to mock Gemini responses.")
        return None
        
    model = "gemini-3.5-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    try:
        res = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=30
        )
        if res.status_code == 200:
            data = res.json()
            return data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        else:
            print(f"Scheduler: Gemini API returned status {res.status_code}: {res.text}")
    except Exception as e:
        print(f"Scheduler: Gemini API request failed: {e}")
    return None

def get_trending_keyword():
    """Asks Gemini for a hot trending keyword in Japan today."""
    prompt = (
        "Suggest one popular, trending business, side-hustle, tech, or AI-related keyword or topic in Japanese "
        "that is highly relevant to creators, marketers, or personal developers today. "
        "Return ONLY the keyword or topic phrase in Japanese (maximum 3 words), with no quotes, no explanation, "
        "no punctuation, and no markdown. Example: AI副業"
    )
    result = call_gemini_api(prompt)
    if result:
        keyword = result.strip().replace('"', '').replace("'", "")
        if keyword:
            return keyword
            
    # Fallback default keywords list
    defaults = ["Claude 3.5 Sonnet", "AI副業", "インスタ リール伸ばし方", "個人開発 MicroSaaS", "ChatGPT活用術"]
    return random.choice(defaults)

def extract_json(text):
    """Extracts JSON structure from text block."""
    if not text:
        return None
    match = re.search(r'```json\s*([\s\S]*?)```', text) or re.search(r'(\{[\s\S]*\})', text)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception as e:
            print(f"Scheduler: JSON parsing failed: {e}")
    return None

def analyze_keyword_via_gemini(keyword):
    """Calls Gemini to get platform scores and insights for the keyword."""
    prompt = f"""あなたはSNSマーケティングの専門家です。
キーワード「{keyword}」について2026年時点の日本市場を分析し、以下のJSON形式でのみ回答してください。

{{
  "summary": "このキーワードの本質的な検索意図（2文以内）",
  "volume": 50000,
  "difficulty": 45,
  "platforms": {{
    "youtube": {{
      "score": 85,
      "trend": "現在のトレンド状況（ショート動画の伸びなど）"
    }},
    "instagram": {{
      "score": 75,
      "trend": "リールやカルーセルでの傾向"
    }},
    "tiktok": {{
      "score": 90,
      "trend": "動画フックの当たりやすさ"
    }},
    "x": {{
      "score": 60,
      "trend": "タイムラインでの拡散力・議論度"
    }},
    "seo": {{
      "score": 50,
      "trend": "検索インテントの強さ"
    }}
  }},
  "hooks": [
    "動画の冒頭3秒で惹きつけるフック文1",
    "動画の冒頭3秒で惹きつけるフック文2"
  ],
  "hashtags": ["ハッシュタグ1", "ハッシュタグ2", "ハッシュタグ3"]
}}

JSONのみを返してください。余計な説明文やMarkdown記法は不要です。"""

    result = call_gemini_api(prompt)
    data = extract_json(result)
    if data:
        return data
        
    # Simulated Mock Data fallback
    print("Scheduler: Generating simulated analysis data for keyword:", keyword)
    return {
        "summary": f"「{keyword}」に関する効率的な運用のコツとコンテンツの作り方",
        "volume": random.randint(5000, 80000),
        "difficulty": random.randint(20, 85),
        "platforms": {
            "youtube": {"score": random.randint(40, 95), "trend": "ハウツー系のショート動画が伸びやすい傾向"},
            "instagram": {"score": random.randint(40, 95), "trend": "図解カルーセルとリールでのまとめが効果的"},
            "tiktok": {"score": random.randint(40, 95), "trend": "体験型フックや検証動画の反響が大きい"},
            "x": {"score": random.randint(40, 95), "trend": "有益ノウハウを羅列するスレッド投稿が好相性"},
            "seo": {"score": random.randint(20, 90), "trend": "ロングテールキーワードを狙う個人ブログに好機"}
        },
        "hooks": [
            f"まだ誰も教えてくれない{keyword}の裏ワザ...",
            f"これで解決！本当は秘密にしたい{keyword}攻略法"
        ],
        "hashtags": [f"#{keyword}", "#SNSマーケティング", "#個人開発"]
    }

def run_daily_trend_task():
    """Daily marketing task: analyzed keyword trend, render radar chart, post thread on X."""
    print("Scheduler: Starting run_daily_trend_task...")
    try:
        # 1. Fetch trending keyword
        keyword = get_trending_keyword()
        print(f"Scheduler: Today's trend topic candidate: {keyword}")
        
        # 2. Analyze via Gemini
        analysis = analyze_keyword_via_gemini(keyword)
        
        # 3. Generate radar chart image
        scores = {
            "YouTube": analysis["platforms"]["youtube"]["score"],
            "Instagram": analysis["platforms"]["instagram"]["score"],
            "TikTok": analysis["platforms"]["tiktok"]["score"],
            "X": analysis["platforms"]["x"]["score"],
            "Google SEO": analysis["platforms"]["seo"]["score"]
        }
        image_path = generate_trend_radar(keyword, scores, "daily_trend")
        
        # 4. Upload chart to X
        media_id = None
        if not bot.is_simulation:
            media_id = bot.upload_media(image_path)
        else:
            print("Scheduler: [Simulation] Skipping real media upload.")
            media_id = "mock_media_id_12345"
        
        # Let's clean and limit keyword length to 20 characters in the tweet display
        display_kw = keyword[:20] + "..." if len(keyword) > 20 else keyword
        tweet1 = (
            f"【本日の急上昇キーワード分析：{display_kw}】\n\n"
            f"どのプラットフォームでバズっているかが一目でわかる攻略チャートを可視化しました📊\n"
            f"各チャンネルの相性と動向は？詳細をスレッドで解説👇"
        )
        
        yt_trend = analysis['platforms']['youtube']['trend'][:12]
        ig_trend = analysis['platforms']['instagram']['trend'][:12]
        tt_trend = analysis['platforms']['tiktok']['trend'][:12]
        tweet2 = (
            f"📊 プラットフォーム別攻略スコア\n\n"
            f"🎥 YouTube: {scores['YouTube']}/100 ({yt_trend})\n"
            f"📸 Instagram: {scores['Instagram']}/100 ({ig_trend})\n"
            f"🎵 TikTok: {scores['TikTok']}/100 ({tt_trend})"
        )
        
        x_trend = analysis['platforms']['x']['trend'][:15]
        seo_trend = analysis['platforms']['seo']['trend'][:15]
        tweet3 = (
            f"🐦 X (Twitter): {scores['X']}/100 ({x_trend})\n"
            f"🔍 Google SEO: {scores['Google SEO']}/100 ({seo_trend})"
        )
        
        hook1 = analysis.get("hooks", [""])[0]
        hook2 = analysis.get("hooks", ["", ""])[1]
        tweet4 = (
            f"💡 このトレンドを使った動画フック案\n\n"
            f"1️⃣ 「{hook1[:32]}」\n"
            f"2️⃣ 「{hook2[:32]}」\n\n"
            f"発信の切り口として活用してみてください！"
        )
        
        raw_tags = [h if h.startswith('#') else f"#{h}" for h in analysis.get("hashtags", [])[:2]]
        tags_str = ""
        for tag in raw_tags:
            tag_clean = tag.replace(" ", "").replace("\n", "")
            if len(tags_str) + len(tag_clean) + 1 <= 35:
                tags_str += (" " if tags_str else "") + tag_clean
                
        tweet5 = (
            f"🎁 このトレンドの詳細差別化戦略や動画台本を無料プレゼント！\n\n"
            f"1. フォロー\n"
            f"2. 「分析」とリプ\n\n"
            f"個別レポートのURLをDMで送付します！📩\n\n"
            f"{tags_str} #SocialIntentAI"
        )
        
        tweets = [tweet1, tweet2, tweet3, tweet4, tweet5]
        
        # 6. Post thread on X
        first_tweet_id = None
        enable_auto_post = os.environ.get("ENABLE_X_AUTO_POST", "false").lower() == "true"
        
        if not bot.is_simulation and enable_auto_post:
            first_tweet_id = bot.post_thread(tweets, media_id=media_id)
            if first_tweet_id:
                # Map tweet ID to keyword in database to recognize replies later
                database.record_x_posted_thread(first_tweet_id, keyword)
                print(f"Scheduler: Successfully published daily trend thread for keyword '{keyword}'. Tweet ID: {first_tweet_id}")
        else:
            print("Scheduler: Skipping real API thread posting (Simulation Mode or ENABLE_X_AUTO_POST is false). Draft will be created locally.")
            first_tweet_id = "mock_tweet_id_thread_end"

        # 7. Write the draft to an Obsidian markdown file & copy radar chart
        try:
            draft_dir = r"C:\COO\メモ\X投稿ドラフト"
            os.makedirs(draft_dir, exist_ok=True)
            import datetime
            today_str = datetime.date.today().isoformat()
            safe_keyword = "".join([c for c in keyword if c.isalnum() or c in (' ', '_', '-')]).rstrip()
            safe_keyword = safe_keyword.replace(' ', '_')
            
            # Copy image to Obsidian vault directory for visual rendering
            image_filename = f"daily_trend_{safe_keyword}.png"
            vault_image_path = os.path.join(draft_dir, image_filename)
            try:
                shutil.copy(image_path, vault_image_path)
                print(f"Scheduler: Copied chart image to Obsidian vault: {vault_image_path}")
            except Exception as e_copy:
                print(f"Scheduler: Failed to copy chart to Obsidian: {e_copy}")
                vault_image_path = image_path
                
            draft_path = os.path.join(draft_dir, f"{today_str}_{safe_keyword}.md")
            
            # Generate pre-filled response templates
            encoded_keyword = urllib.parse.quote(keyword)
            report_url = f"https://socialintent-trends.onrender.com/?keyword={encoded_keyword}"
            reply_template = "リプありがとうございます！個別分析レポートを作成しました。DMをご確認ください！📩"
            dm_template = (
                f"こんにちは！SocialIntent AIです🤖✨\n\n"
                f"「{keyword}」に関する最新のチャネル分析レポートの個別URLをご用意しました！👇\n"
                f"{report_url}\n\n"
                f"このレポートでは、各プラットフォームでの需要傾向やバズるフック、効果的なポジショニング戦略をご確認いただけます。ビジネスや発信活動にぜひお役立てください！"
            )
            
            with open(draft_path, "w", encoding="utf-8") as df:
                df.write(f"# 📝 X投稿ドラフト: {keyword} ({today_str})\n\n")
                df.write(f"本日生成されたX投稿用の下書きです。手動でコピー＆ペーストして投稿してください。\n\n")
                
                df.write(f"## 📋 投稿チェックリスト\n")
                df.write(f"- [ ] **1. 添付画像を保存**: Obsidian上で以下の画像が表示されていることを確認します。\n")
                df.write(f"  - 画像ファイルパス: `{vault_image_path}`\n")
                df.write(f"- [ ] **2. 1つ目の投稿を作成**: `【1ポスト目】`のテキストをXの新規投稿画面に入力し、上記の画像を添付します。\n")
                df.write(f"- [ ] **3. スレッドを繋げる**: Xの「＋」ボタンを押し、残りの`【2ポスト目】`〜`【5ポスト目】`を順番に追加してスレッドを投稿します。\n")
                df.write(f"- [ ] **4. プロフィール確認**: Xのプロフィールか固定ツイートにツールURL（ `https://socialintent-trends.onrender.com/` ）が載っているか確認します。\n\n")
                
                df.write(f"## 📊 添付用レーダーチャート画像\n")
                df.write(f"![[{image_filename}]]\n")
                df.write(f"*(※ Obsidianのプレビュー表示で画像が確認できます)*\n\n")
                
                df.write(f"---\n\n")
                df.write(f"## 🐦 X投稿テキスト（スレッド用）\n\n")
                
                for idx, text in enumerate(tweets):
                    char_count = len(text)
                    status = "✅ 安全 (140文字以内)" if char_count <= 140 else "⚠️ 警告 (140文字超過！編集してください)"
                    df.write(f"### 📌 【{idx+1}ポスト目】 ({char_count}文字 / {status})\n")
                    df.write(f"```text\n{text}\n```\n\n")
                    
                df.write(f"---\n\n")
                df.write(f"## 💬 反応があった時の手動返信・DM用テンプレート\n")
                df.write(f"投稿に対して「分析」とリプが来たら、以下のテンプレートを使って手動で返信・DMを送信してください。\n\n")
                df.write(f"### 1. リプへの返信用テキスト\n")
                df.write(f"```text\n{reply_template}\n```\n\n")
                df.write(f"### 2. 送信用DMテキスト\n")
                df.write(f"```text\n{dm_template}\n```\n")
                
            print(f"Scheduler: Obsidian draft successfully saved to {draft_path}")
        except Exception as ex_draft:
            print(f"Scheduler: Failed to write Obsidian draft: {ex_draft}")
            
    except Exception as e:
        print(f"Scheduler: Error in run_daily_trend_task: {e}")

def check_relevance_via_gemini(tweet_text):
    """Uses Gemini to filter target posts, ensuring they are safe, relevant, and not negative."""
    prompt = (
        f"Analyze the following tweet in Japanese:\n"
        f"「{tweet_text}」\n\n"
        f"Is this tweet discussing or seeking help with side-hustles, AI tools, SNS growth, or internet marketing?\n"
        f"Or is it a complaint, spam, negative, or completely unrelated?\n"
        f"Reply with 'SAFE' if the user is open to receiving helpful, positive advice about SNS or AI tools.\n"
        f"Otherwise, reply with 'UNSAFE'. Return ONLY the word SAFE or UNSAFE."
    )
    result = call_gemini_api(prompt)
    if result:
        verdict = result.strip().upper()
        if "SAFE" in verdict and "UNSAFE" not in verdict:
            return True
    return False

def generate_reply_via_gemini(tweet_text):
    """Uses Gemini to write a high-value advice reply that leads to DM CTA."""
    prompt = (
        f"以下のツイートに対して、親切で有益なアドバイス（100文字以内の日本語）を返信として作成してください。\n"
        f"ツイート: 「{tweet_text}」\n\n"
        f"【ルール】\n"
        f"1. リンク（URL）は含めないでください。\n"
        f"2. 文末は必ず「もっと詳しいチャネル攻略法やフック案を分析したい場合は、このリプに「分析」と返信してみてください！詳細レポートをDMでお送りします！🤖」に近い形で、分析というキーワードとDM誘導を含めてください。\n"
        f"3. 自然で人間らしい文体にしてください。"
    )
    result = call_gemini_api(prompt)
    if result:
        reply = result.strip()
        if len(reply) <= 140:
            return reply
        return reply[:110] + "... 続きはリプに「分析」と返信でDMします！"
        
    return "有益なSNS/AI運用ですね！チャネル別相性や具体的なバズるフックを個別に分析したい場合は、このリプライに「分析」と返信してみてください！レポートURLをDMします！🤖"

def run_keyword_monitor_task():
    """Hourly monitor task: searches target keywords, reply with advice and CTA."""
    print("Scheduler: Starting run_keyword_monitor_task...")
    keywords = ["副業 AI", "インスタ 伸ばし方", "SNSマーケティング", "個人開発"]
    selected_keyword = random.choice(keywords)
    print(f"Scheduler: Monitoring keyword '{selected_keyword}'...")
    
    try:
        response = bot.search_recent_tweets(selected_keyword, max_results=5)
        if not response or not response.data:
            print("Scheduler: No recent tweets found for keyword.")
            return
            
        for tweet in response.data:
            tweet_id = tweet.id
            author_id = tweet.author_id
            tweet_text = tweet.text
            
            if database.is_x_replied(tweet_id):
                continue
                
            is_relevant = check_relevance_via_gemini(tweet_text)
            if not is_relevant:
                print(f"Scheduler: Tweet {tweet_id} determined UNSAFE or irrelevant. Skipping.")
                continue
                
            reply_text = generate_reply_via_gemini(tweet_text)
            reply_tweet_id = bot.reply_to_tweet(tweet_id, reply_text)
            
            if reply_tweet_id:
                database.record_x_reply(tweet_id, author_id, selected_keyword)
                database.record_x_posted_thread(reply_tweet_id, selected_keyword)
                print(f"Scheduler: Replied to tweet {tweet_id} from user {author_id}. Reply ID: {reply_tweet_id}")
                time.sleep(random.randint(30, 90) if not bot.is_simulation else 1)
                
    except Exception as e:
        print(f"Scheduler: Error in run_keyword_monitor_task: {e}")

def run_dm_response_monitor_task():
    """Checks for user replies containing '分析' to send customized reports via DM."""
    print("Scheduler: Starting run_dm_response_monitor_task...")
    bot_username = bot.get_username()
    query = f"to:{bot_username} \"分析\""
    
    try:
        response = bot.search_recent_tweets(query, max_results=10)
        if not response or not response.data:
            print("Scheduler: No replies containing '分析' found.")
            return
            
        for reply in response.data:
            reply_id = reply.id
            author_id = reply.author_id
            
            if database.is_x_replied(reply_id):
                continue
                
            parent_tweet_id = None
            if hasattr(reply, "referenced_tweets") and reply.referenced_tweets:
                for ref in reply.referenced_tweets:
                    if getattr(ref, "type", None) == "replied_to" or ref.get("type") == "replied_to":
                        parent_tweet_id = getattr(ref, "id", None) or ref.get("id")
                        break
                        
            keyword = None
            if parent_tweet_id:
                keyword = database.get_x_posted_thread_keyword(parent_tweet_id)
                
            if not keyword:
                keyword = "SNSマーケティング"
                
            encoded_keyword = urllib.parse.quote(keyword)
            report_url = f"https://socialintent-trends.onrender.com/?keyword={encoded_keyword}"
            
            dm_text = (
                f"こんにちは！SocialIntent AIです🤖✨\n\n"
                f"「{keyword}」に関する最新のチャネル分析レポートの個別URLをご用意しました！👇\n"
                f"{report_url}\n\n"
                f"このレポートでは、各プラットフォームでの需要傾向やバズるフック、効果的なポジショニング戦略をご確認いただけます。ビジネスや発信活動にぜひお役立てください！"
            )
            
            success = bot.send_dm(author_id, dm_text)
            if success:
                database.record_x_reply(reply_id, author_id, "DM_SENT")
                database.record_x_dm_sent(author_id)
                print(f"Scheduler: DM sent to user {author_id} for keyword '{keyword}'.")
                
    except Exception as e:
        print(f"Scheduler: Error in run_dm_response_monitor_task: {e}")

# Scheduler Instance
scheduler = BackgroundScheduler()

def init_scheduler():
    """Initializes and starts the background task scheduler."""
    if scheduler.running:
        print("Scheduler: Already running.")
        return
        
    print("Scheduler: Initializing background jobs...")
    
    # 1. Daily trend post at 9:00 AM daily
    scheduler.add_job(run_daily_trend_task, 'cron', hour=9, minute=0, id='daily_trend_post')
    
    # Enable API monitoring only if credentials are found (not in simulation)
    if not bot.is_simulation:
        # 2. Hourly keyword monitor to engage with potential users
        scheduler.add_job(run_keyword_monitor_task, 'interval', hours=1, id='keyword_monitor')
        
        # 3. Check for '分析' replies to trigger DMs every 5 minutes
        scheduler.add_job(run_dm_response_monitor_task, 'interval', minutes=5, id='dm_response_monitor')
        print("Scheduler: Real automated monitor jobs scheduled.")
    else:
        print("Scheduler: Running in Simulation Mode. Automated X monitoring and DM responders are disabled.")
    
    # Start scheduler
    scheduler.start()
    print("Scheduler: Background scheduler started successfully.")
    
    # Trigger a dry run of the daily draft generation task on start if in simulation mode
    if bot.is_simulation:
        print("Scheduler: [Simulation] Triggering one-off immediate dry-run of daily trend draft generation.")
        run_daily_trend_task()
