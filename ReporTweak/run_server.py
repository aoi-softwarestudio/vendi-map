import http.server
import socketserver
import webbrowser
import threading
import time
import os

PORT = 8008
# 実行スクリプトのディレクトリを基準にする
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

def open_browser():
    time.sleep(1.0)
    webbrowser.open(f"http://localhost:{PORT}")

if __name__ == "__main__":
    print(f"ReporTweak 開発サーバーを起動しています (ポート: {PORT})...")
    print(f"ドキュメントルート: {BASE_DIR}")
    
    # ブラウザ自動起動
    threading.Thread(target=open_browser, daemon=True).start()
    
    # アドレス再利用の許可
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"サーバーが起動しました: http://localhost:{PORT}")
        print("Ctrl+C でサーバーを終了できます。")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nサーバーを停止しました。")
