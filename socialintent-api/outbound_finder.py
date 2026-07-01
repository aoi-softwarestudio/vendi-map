# -*- coding: utf-8 -*-
"""
outbound_finder.py - X (Twitter) Outbound Outreach Finder for SocialIntent AI.
Generates highly targeted X Search links and reply templates.

Usage:
    python outbound_finder.py --theme dev
    python outbound_finder.py --theme sns
    python outbound_finder.py --theme ai
"""
import sys
import os
import argparse
import urllib.parse

# Force UTF-8 stdout encoding for Windows console compatibility
if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

THEMES = {
    "dev": {
        "name": "個人開発 / 個人アプリ開発のお悩み",
        "query": '("個人開発" OR "個人アプリ") ("アイデア" OR "マネタイズ" OR "集客" OR "マーケティング" OR "宣伝" OR "伸びない") -filter:links',
        "advice_templates": [
            (
                "個人開発お疲れ様です！「{keyword}」がどのSNSでバズっているかわかるチャートを可視化しました📊 (画像添付)\n\n"
                "詳細やバズ動画フック案はプロフの無料ツールから分析できますので集客の参考にどうぞ！🤖"
            ),
            (
                "はじめまして！個人開発の集客は難しいですよね😭「{keyword}」がどのSNSでバズっているかわかるチャートを貼っておきます📊 (画像添付)\n\n"
                "バズフック等の詳細レポートは、返信で「分析」とくださればDMでお送りします！📩"
            )
        ]
    },
    "sns": {
        "name": "SNS運用 (Instagram/TikTok/YouTube) のお悩み",
        "query": '("インスタ" OR "TikTok" OR "SNS運用" OR "リール") ("伸ばし方" OR "伸びない" OR "ネタ切れ" OR "フォロワー" OR "バズ") -filter:links',
        "advice_templates": [
            (
                "SNS発信お疲れ様です！「{keyword}」がどのSNSでバズっているかわかるチャートを分析しました📊 (画像添付)\n\n"
                "リールやTikTokのバズる冒頭3秒フック案など、プロフの無料ツールで公開中ですので参考にどうぞ！👇"
            ),
            (
                "はじめまして！SNSのネタ切れ悩みますよね😭「{keyword}」がどのSNSでバズっているかわかるチャートを作りました📊 (画像添付)\n\n"
                "バズフックなどの詳細レポートは、返信に「分析」と書くだけでDMで即送付します！🤖"
            )
        ]
    },
    "ai": {
        "name": "AI副業・AIツールのお悩み",
        "query": '("AI副業" OR "AIツール" OR "ChatGPT" OR "Claude") ("稼ぎ方" OR "おすすめ" OR "使いこなせない" OR "始め方") -filter:links',
        "advice_templates": [
            (
                "AI副業の発信お疲れ様です！「{keyword}」がどのSNSでバズっているかわかるチャートを作成しました📊 (画像添付)\n\n"
                "狙い目チャネルやバズ動画フック案など、プロフのリンク先ツールで無料診断できます！🤖"
            ),
            (
                "はじめまして！AIのトレンドは追うのが大変ですよね😭「{keyword}」がどのSNSでバズっているかわかる攻略チャートを貼っておきます📊 (画像添付)\n\n"
                "詳細レポートは、リプに「分析」と返信いただければDMで即送付します！👇"
            )
        ]
    }
}

def calculate_x_char_count(template_text):
    """
    X (Twitter) character limit calculation logic:
    - Raw text length since there are no external URLs in our templates.
    """
    return len(template_text)

def main():
    parser = argparse.ArgumentParser(description="Find outbound target tweets on X and generate advice replies.")
    parser.add_argument(
        "--theme", 
        choices=["dev", "sns", "ai"], 
        default="dev",
        help="Target theme to search on X (dev: 個人開発, sns: SNS運用, ai: AI副業)."
    )
    parser.add_argument(
        "--keyword",
        type=str,
        default="AIツール",
        help="The specific keyword/topic of the user's tweet to prefill the templates."
    )
    args = parser.parse_args()
    
    theme_data = THEMES[args.theme]
    
    print("\n=========================================================================")
    print(f"📊 SocialIntent AI : アプローチ先検索 ＆ コピペ返信ジェネレーター")
    print(f"👉 選択したテーマ: {theme_data['name']}")
    print("=========================================================================\n")
    
    # Generate X Advanced Search URL (Forces "Live" tab for newest tweets)
    encoded_query = urllib.parse.quote(theme_data["query"])
    search_url = f"https://x.com/search?q={encoded_query}&f=live"
    
    print("💡 ステップ 1: Xでお悩みツイートを探す")
    print("以下のURLをクリックしてブラウザで開いてください（最新の投稿が並んでいます）。")
    print(f"🔗 Xお悩み検索リンク (Live): \n{search_url}\n")
    
    print("💡 ステップ 2: 悩んでいる人のツイートのテーマでレーダーチャートを作成")
    print("例えば相手が「英会話の個人開発」で悩んでいたら、以下のコマンドを実行します：")
    print(f"👉 コマンド:  python generate_draft.py --keyword \"相手の悩みテーマ (例: 英会話)\"")
    print("※ 生成されたチャート画像は `C:\\COO\\メモ\\X投稿ドラフト\\` に保存されます。\n")
    
    print("💡 ステップ 3: 画像を添付して返信する")
    print(f"相手のツイートに対し、生成したチャート画像を添付した上で、以下の返信テンプレートをコピペ送信します。")
    print(f"（今回の入力キーワード: 「{args.keyword}」で仮プリフィルしています）\n")
    
    for idx, template in enumerate(theme_data["advice_templates"]):
        prefilled = template.format(keyword=args.keyword)
        
        # Calculate X character weight
        x_char_count = calculate_x_char_count(prefilled)
        status = "✅ 安全 (140文字以内)" if x_char_count <= 140 else "⚠️ 警告 (140文字超過！編集してください)"
        
        print(f"--- 📋 返信パターン {idx+1} ({x_char_count}文字相当 / {status}) ---")
        print(prefilled)
        print("----------------------------------------------------\n")

if __name__ == "__main__":
    main()
