# -*- coding: utf-8 -*-
"""
On-demand X (Twitter) draft generator for SocialIntent AI.

Usage modes:
    python generate_draft.py --mode predict                   # 予言型（毎週金曜投稿）
    python generate_draft.py --mode predict --verify          # 予言答え合わせ（毎週月曜投稿）
    python generate_draft.py --mode celeb --target "ヒカキン"     # 名指し分析型
    python generate_draft.py --mode community                 # 個人開発コミュニティ型
    python generate_draft.py --keyword "AI副業"              # レガシー：トレンドデータ型
    python generate_draft.py --dm-only --keyword "AI副業"    # DMテンプレートのみ
"""
import os
import sys
import argparse
import datetime
import urllib.parse
import shutil
from dotenv import load_dotenv

# Ensure the root socialintent-api folder is in python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

load_dotenv()

# Force UTF-8 stdout encoding for Windows console compatibility
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

import database
from x_automation.scheduler import (
    get_trending_keyword,
    analyze_keyword_via_gemini
)
from x_automation.visual_generator import generate_trend_radar

def generate_local_draft(keyword=None, dm_only=False):
    # Ensure database is initialized
    database.init_db()
    
    if not keyword:
        if dm_only:
            print("Error: --keyword is required when using --dm-only.", file=sys.stderr)
            sys.exit(1)
        print("No keyword provided. Fetching a trending topic from Gemini...")
        keyword = get_trending_keyword()
        
    if dm_only:
        encoded_keyword = urllib.parse.quote(keyword)
        report_url = f"https://socialintent-trends.onrender.com/?keyword={encoded_keyword}"
        dm_template = (
            f"こんにちは！SocialIntent AIです🤖✨\n\n"
            f"「{keyword}」に関する最新のチャネル分析レポートの個別URLをご用意しました！👇\n"
            f"{report_url}\n\n"
            f"このレポートでは、各プラットフォームでの需要傾向やバズるフック、効果的なポジショニング戦略をご確認いただけます。ビジネスや発信活動にぜひお役立てください！"
        )
        print("\n=== コピペ用 DM テンプレート ===")
        print(dm_template)
        print("===============================\n")
        return

    print(f"Analyzing keyword: '{keyword}'...")
    analysis = analyze_keyword_via_gemini(keyword)
    
    print("Generating radar chart...")
    scores = {
        "YouTube": analysis["platforms"]["youtube"]["score"],
        "Instagram": analysis["platforms"]["instagram"]["score"],
        "TikTok": analysis["platforms"]["tiktok"]["score"],
        "X": analysis["platforms"]["x"]["score"],
        "Google SEO": analysis["platforms"]["seo"]["score"]
    }
    
    # Generate the chart in the temporary folder first
    temp_image_path = generate_trend_radar(keyword, scores, "daily_trend")
    
    # Determine vault directory
    draft_dir = r"C:\COO\メモ\X投稿ドラフト"
    os.makedirs(draft_dir, exist_ok=True)
    
    today_str = datetime.date.today().isoformat()
    safe_keyword = "".join([c for c in keyword if c.isalnum() or c in (' ', '_', '-')]).rstrip()
    safe_keyword = safe_keyword.replace(' ', '_')
    
    # Copy radar chart to vault folder
    image_filename = f"daily_trend_{safe_keyword}.png"
    vault_image_path = os.path.join(draft_dir, image_filename)
    try:
        shutil.copy(temp_image_path, vault_image_path)
        print(f"Saved radar chart to Obsidian vault: {vault_image_path}")
    except Exception as e:
        print(f"Failed to copy radar chart to vault: {e}")
        vault_image_path = temp_image_path
        
    # Generate the 5-tweet thread
    # Obsidian Voice: short declarative sentences, personal/experience-based, honest tone
    # Avoid: AI-sounding, over-polished, excessive emoji
    display_kw = keyword[:20] + "..." if len(keyword) > 20 else keyword
    
    # Pick the top platform by score for the hook
    top_platform_name = max(scores, key=scores.get)
    top_score = scores[top_platform_name]
    platform_emoji = {"YouTube": "🎥", "Instagram": "📸", "TikTok": "🎵", "X": "🐦", "Google SEO": "🔍"}
    top_emoji = platform_emoji.get(top_platform_name, "📊")
    
    tweet1 = (
        f"「{display_kw}」って今どこで一番バズってるか知ってた？\n\n"
        f"{top_emoji} {top_platform_name}がスコア{top_score}/100でダントツだった。\n"
        f"実際にデータで出してみたら思ってた以上に差があった。\n"
        f"プラットフォーム別の全スコア、スレッドで出す👇"
    )
    
    yt_trend = analysis['platforms']['youtube']['trend'][:12]
    ig_trend = analysis['platforms']['instagram']['trend'][:12]
    tt_trend = analysis['platforms']['tiktok']['trend'][:12]
    tweet2 = (
        f"📊 プラットフォーム別スコア\n\n"
        f"🎥 YouTube: {scores['YouTube']}/100\n"
        f"({yt_trend})\n"
        f"📸 Instagram: {scores['Instagram']}/100\n"
        f"({ig_trend})\n"
        f"🎵 TikTok: {scores['TikTok']}/100\n"
        f"({tt_trend})"
    )
    
    x_trend = analysis['platforms']['x']['trend'][:15]
    seo_trend = analysis['platforms']['seo']['trend'][:15]
    tweet3 = (
        f"🐦 X: {scores['X']}/100\n"
        f"({x_trend})\n\n"
        f"🔍 Google SEO: {scores['Google SEO']}/100\n"
        f"({seo_trend})\n\n"
        f"プラットフォームによってここまで差があるなら、\n"
        f"戦略を変えないともったいない。"
    )
    
    hook1 = analysis.get("hooks", [""])[0]
    hook2 = analysis.get("hooks", ["", ""])[1]
    tweet4 = (
        f"💡 このデータをもとにしたフック案\n\n"
        f"1️⃣ 「{hook1[:32]}」\n"
        f"2️⃣ 「{hook2[:32]}」\n\n"
        f"どちらが刺さりそう？"
    )
    
    raw_tags = [h if h.startswith('#') else f"#{h}" for h in analysis.get("hashtags", [])[:2]]
    tags_str = ""
    for tag in raw_tags:
        tag_clean = tag.replace(" ", "").replace("\n", "")
        if len(tags_str) + len(tag_clean) + 1 <= 35:
            tags_str += (" " if tags_str else "") + tag_clean
            
    tweet5 = (
        f"このキーワードの詳細な攻略レポート、欲しい人いたら送ります。\n\n"
        f"1. フォロー\n"
        f"2. 「分析」とリプ\n\n"
        f"URLをDMで送ります📩\n\n"
        f"{tags_str} #SocialIntentAI"
    )
    
    tweets = [tweet1, tweet2, tweet3, tweet4, tweet5]
    
    # Templates for manual copy-pasting
    encoded_keyword = urllib.parse.quote(keyword)
    report_url = f"https://socialintent-trends.onrender.com/?keyword={encoded_keyword}"
    
    reply_template = "リプありがとうございます！個別分析レポートを作成しました。DMをご確認ください！📩"
    dm_template = (
        f"こんにちは！SocialIntent AIです🤖✨\n\n"
        f"「{keyword}」に関する最新のチャネル分析レポートの個別URLをご用意しました！👇\n"
        f"{report_url}\n\n"
        f"このレポートでは、各プラットフォームでの需要傾向やバズるフック、効果的なポジショニング戦略をご確認いただけます。ビジネスや発信活動にぜひお役立てください！"
    )
    
    draft_path = os.path.join(draft_dir, f"{today_str}_{safe_keyword}.md")
    
    with open(draft_path, "w", encoding="utf-8") as f:
        f.write(f"# 📝 X投稿ドラフト: {keyword} ({today_str})\n\n")
        f.write(f"本日生成されたX投稿用の下書きです。手動でコピー＆ペーストして投稿してください。\n\n")
        
        f.write(f"## 📋 投稿チェックリスト\n")
        f.write(f"- [ ] **1. 添付画像を保存**: Obsidian上で以下の画像が表示されていることを確認します。\n")
        f.write(f"  - 画像ファイルパス: `{vault_image_path}`\n")
        f.write(f"- [ ] **2. 1つ目の投稿を作成**: `【1ポスト目】`のテキストをXの新規投稿画面に入力し、上記の画像を添付します。\n")
        f.write(f"- [ ] **3. スレッドを繋げる**: Xの「＋」ボタンを押し、残りの`【2ポスト目】`〜`【5ポスト目】`を順番に追加してスレッドを投稿します。\n")
        f.write(f"- [ ] **4. プロフィール確認**: Xのプロフィールか固定ツイートにツールURL（ `https://socialintent-trends.onrender.com/` ）が載っているか確認します。\n\n")
        
        f.write(f"## 📊 添付用レーダーチャート画像\n")
        f.write(f"![[{image_filename}]]\n")
        f.write(f"*(※ Obsidianのプレビュー表示で画像が確認できます)*\n\n")
        
        f.write(f"---\n\n")
        f.write(f"## 🐦 X投稿テキスト（スレッド用）\n\n")
        
        for idx, text in enumerate(tweets):
            char_count = len(text)
            status = "✅ 安全 (140文字以内)" if char_count <= 140 else "⚠️ 警告 (140文字超過！編集してください)"
            f.write(f"### 📌 【{idx+1}ポスト目】 ({char_count}文字 / {status})\n")
            f.write(f"```text\n{text}\n```\n\n")
            
        f.write(f"---\n\n")
        f.write(f"## 💬 反応があった時の手動返信・DM用テンプレート\n")
        f.write(f"投稿に対して「分析」とリプが来たら、以下のテンプレートを使って手動で返信・DMを送信してください。\n\n")
        f.write(f"### 1. リプへの返信用テキスト\n")
        f.write(f"```text\n{reply_template}\n```\n\n")
        f.write(f"### 2. 送信用DMテキスト\n")
        f.write(f"```text\n{dm_template}\n```\n")
        
    print(f"Successfully generated local draft: {draft_path}")



def generate_predict_draft(verify=False):
    """予言型ドラフトを生成（金曜: 予言投稿 / 月曜: 答え合わせ）"""
    draft_dir = r"C:\COO\メモ\X投稿ドラフト"
    os.makedirs(draft_dir, exist_ok=True)
    today_str = datetime.date.today().isoformat()

    # トレンドキーワードをTop3取得
    print("\u30c8レンドキーワードを分析中...")
    keywords = []
    for _ in range(3):
        kw = get_trending_keyword()
        if kw not in keywords:
            keywords.append(kw)
    if len(keywords) < 3:
        keywords = keywords + ["AI\u526f\u696d", "ChatGPT\u6d3b\u7528\u8853", "\u500b\u4eba\u958b\u767a"]
        keywords = list(dict.fromkeys(keywords))[:3]

    if not verify:
        post_text = (
            f"\u3010\u6765\u9031\u30d0\u30ba\u308b\u4e88\u8a00\u3011\n\n"
            f"AI\u3067\u30c8\u30ec\u30f3\u30c9\u30c7\u30fc\u30bf\u3092\u5206\u6790\u3057\u305f\u7d50\u679c\u3001\u6765\u9031Instagram\u3067\u4e00\u756a\u4f38\u3073\u305d\u3046\u306a\u30ad\u30fc\u30ef\u30fc\u30c9:\n\n"
            f"1\ufe0f\u20e3 \u300c{keywords[0]}\u300d\n"
            f"2\ufe0f\u20e3 \u300c{keywords[1]}\u300d\n"
            f"3\ufe0f\u20e3 \u300c{keywords[2]}\u300d\n\n"
            f"\u6765\u9031\u6708\u66dc\u306b\u7b54\u3048\u5408\u308f\u305b\u3057\u307e\u3059\u3002\n"
            f"\u5f53\u305f\u3063\u305f\u3089RT\u55ac\u3057\u3044\u3067\u3059\u7b11"
        )
        filename = f"{today_str}_\u4e88\u8a00.md"
        post_type = "\u4e88\u8a00"
    else:
        post_text = (
            f"\u5148\u9031\u306e\u4e88\u8a00\u3001\u7b54\u3048\u5408\u308f\u305b\u3002\n\n"
            f"\u300c{keywords[0]}\u304cInstagram\u3067\u4f38\u3073\u308b\u300d\u3068\u8a00\u3063\u305f\u3084\u3064\u3002\n\n"
            f"\u7d50\u679c: \u2193\u30b9\u30ec\u30c3\u30c9\u3067\u78ba\u8a8d\n\n"
            f"\u306a\u305c\u5f53\u305f\u3063\u305f\u304b\uff08or\u5916\u308c\u305f\u304b\uff09\u3092\u5206\u6790\u3059\u308b\u3068:\n"
            f"\u2192 \u6b21\u306e\u6295\u7a3f\u3067\u89e3\u8aac\u3057\u307e\u3059\u3002"
        )
        filename = f"{today_str}_\u4e88\u8a00\u7b54\u3048\u5408\u308f\u305b.md"
        post_type = "\u4e88\u8a00\u7b54\u3048\u5408\u308f\u305b"

    draft_path = os.path.join(draft_dir, filename)
    with open(draft_path, "w", encoding="utf-8") as f:
        f.write(f"# 🔮 X投稿ドラフト: {post_type} ({today_str})\n\n")
        f.write(f"戦略A「予言型」の投稿ドラフト。\n\n---\n\n")
        f.write(f"## X投稿テキスト\n\n")
        f.write(f"```text\n{post_text}\n```\n\n")
        f.write(f"---\n\n## チェックリスト\n")
        f.write(f"- [ ] 投稿内容をコピペしてXに入力\n")
        f.write(f"- [ ] 画像なしでOK（テキストのみ）\n")
        f.write(f"- [ ] リンクなしでOK（シャドウバン対策）\n")
    print(f"[OK] {post_type}ドラフトを保存: {draft_path}")


def generate_celeb_draft(target_name: str):
    """名指し分析型ドラフトを生成"""
    draft_dir = r"C:\COO\メモ\X投稿ドラフト"
    os.makedirs(draft_dir, exist_ok=True)
    today_str = datetime.date.today().isoformat()

    print(f"'{target_name}'のトレンドを分析中...")
    analysis = analyze_keyword_via_gemini(target_name)
    scores = {
        "YouTube": analysis["platforms"]["youtube"]["score"],
        "Instagram": analysis["platforms"]["instagram"]["score"],
        "TikTok": analysis["platforms"]["tiktok"]["score"],
        "X": analysis["platforms"]["x"]["score"],
        "Google SEO": analysis["platforms"]["seo"]["score"]
    }
    top = max(scores, key=scores.get)
    weak = min(scores, key=scores.get)

    post_text = (
        f"{target_name}がSNSで未だに伸び続ける理由、AIで分析してみた。\n\n"
        f"プラットフォーム別スコア:\n"
        f"YouTube: {scores['YouTube']}/100\n"
        f"Instagram: {scores['Instagram']}/100\n"
        f"TikTok: {scores['TikTok']}/100\n"
        f"X: {scores['X']}/100\n\n"
        f"一言で言うと「{top}」が圧倒的に強い。\n"
        f"逆に{weak}は意外と低くて、ここを攻めたらもっと伸びそう。"
    )

    safe_name = "".join([c for c in target_name if c.isalnum() or c in (' ', '_')]).rstrip().replace(' ', '_')
    draft_path = os.path.join(draft_dir, f"{today_str}_分析_{safe_name}.md")
    with open(draft_path, "w", encoding="utf-8") as f:
        f.write(f"# 👤 X投稿ドラフト: {target_name}分析 ({today_str})\n\n")
        f.write(f"戦略B「名指し分析型」の投稿ドラフト。\n\n---\n\n")
        f.write(f"## X投稿テキスト\n\n")
        f.write(f"```text\n{post_text}\n```\n\n")
        f.write(f"---\n\n## チェックリスト\n")
        f.write(f"- [ ] 投稿内容をコピペしてXに入力\n")
        f.write(f"- [ ] リンクなしでOK\n")
        f.write(f"- [ ] 分析チャート画像を添付する場合は下に登録\n")
    print(f"[OK] {target_name}分析ドラフトを保存: {draft_path}")


def generate_community_draft():
    """個人開発コミュニティ特化型ドラフトを生成"""
    import random
    draft_dir = r"C:\COO\メモ\X投稿ドラフト"
    os.makedirs(draft_dir, exist_ok=True)
    today_str = datetime.date.today().isoformat()

    templates = [
        (
            "失敗共有",
            "個人開発、本当に孤独だな。\n\n"
            "毎日スレッド投げてたのにいいね完全ゼロ。\n"
            "2週間無駄にしてた。\n\n"
            "原因を調べたら、リプにURLを貼ってたのがまずかった。\n"
            "Xはリンクを貼ると表示を約80%減らす仕様らしい。\n\n"
            "今日から全部変えた。\n#個人開発"
        ),
        (
            "気づき共有",
            "個人開発者が絶対知っておくべきXの仕様、シェアします。\n\n"
            "1. リプにURL貼る → インプに激減\n"
            "2. 投稿から最初の30分の反応率でアルゴが評価を決める\n"
            "3. 画像付き投稿はテキストのみよりリーチが2倍以上\n\n"
            "信じてなかったが全部本当だった。\n#個人開発 #SNS攻略"
        ),
        (
            "等身大水ポスト",
            "大学1年でMicroSaaSを作った話。\n\n"
            "バイトをやめてアプリ開発に全振りした。\n"
            "ローンチ初日の売上: 0円。\n\n"
            "でも「作れた」という事実は誰にも消せない。\n\n"
            "0→1にするのに時間がかかるらしいから、とりあえず3か月はやる。\n#個人開発 #MicroSaaS"
        )
    ]

    chosen_name, post_text = random.choice(templates)
    draft_path = os.path.join(draft_dir, f"{today_str}_community_{chosen_name}.md")
    with open(draft_path, "w", encoding="utf-8") as f:
        f.write(f"# 👥 X投稿ドラフト: {chosen_name} ({today_str})\n\n")
        f.write(f"戦略C「個人開発コミュニティ特化型」の投稿ドラフト。\n\n---\n\n")
        f.write(f"## X投稿テキスト\n\n")
        f.write(f"```text\n{post_text}\n```\n\n")
        f.write(f"---\n\n## 手動リプアクション\n")
        f.write(f"投稿後に `#個人開発` で検索し、\n")
        f.write(f"本日投稿されたポストに3件手動リプすること。\n")
        f.write(f"- [ ] 投稿完了\n")
        f.write(f"- [ ] `#個人開発` リプ3件完了\n")
    print(f"[OK] communityドラフト({chosen_name})を保存: {draft_path}")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate X post drafts for SocialIntent AI.")
    parser.add_argument("--mode", type=str, default="legacy",
                        choices=["predict", "celeb", "community", "legacy"],
                        help="\u6295\u7a3f\u6a21\u5f0f: predict=\u4e88\u8a00\u578b, celeb=\u540d\u6307\u3057\u5206\u6790, community=\u500b\u4eba\u958b\u767a, legacy=\u65e7\u30c8\u30ec\u30f3\u30c9\u30c7\u30fc\u30bf")
    parser.add_argument("--keyword", type=str, help="[legacy\u30e2\u30fc\u30c9] \u5206\u6790\u3059\u308b\u30ad\u30fc\u30ef\u30fc\u30c9")
    parser.add_argument("--target", type=str, help="[celeb\u30e2\u30fc\u30c9] \u5206\u6790\u5bfe\u8c61\u306e\u540d\u524d")
    parser.add_argument("--verify", action="store_true", help="[predict\u30e2\u30fc\u30c9] \u7b54\u3048\u5408\u308f\u305b\u6295\u7a3f\u3092\u751f\u6210")
    parser.add_argument("--dm-only", action="store_true", help="[legacy] DM\u30c6\u30f3\u30d7\u30ec\u30fc\u30c8\u306e\u307f\u51fa\u529b")
    args = parser.parse_args()

    if args.mode == "predict":
        generate_predict_draft(verify=args.verify)
    elif args.mode == "celeb":
        if not args.target:
            print("Error: --target \u3092\u6307\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044 (\u4f8b: --target \"\u30d2\u30ab\u30ad\u30f3\")")
            sys.exit(1)
        generate_celeb_draft(args.target)
    elif args.mode == "community":
        generate_community_draft()
    else:
        generate_local_draft(args.keyword, dm_only=args.dm_only)
