import os
import sys
import time
import subprocess
import re
import signal

# Unified AI Business Empire Launcher & Dynamic Integrator
# Configured ports:
# 8000: LinguoSync FastAPI (Core API Gateway & Proxy)
# 8001: StudyFlow AI (Static Server)
# 8002: NovaCapital Wealth (Static Server)
# 8004: VentureOS Command Center (Static Server)

PORTS = {
    8000: ("VendiMap API", ""),
    8003: ("VendiMap", ""),
    8004: ("VentureOS", "VentureOS"),
    8005: ("SocialIntent", "SocialIntent")
}

processes = []
tunnels = []
tunnel_urls = {}
is_local_mode = False

def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")

def load_gemini_key():
    """Load Gemini API Key from environment, local .env, or gemini_key.txt."""
    if os.environ.get("GEMINI_API_KEY"):
        print("[KEY] GEMINI_API_KEY is already set in environment.")
        return os.environ.get("GEMINI_API_KEY")
    
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Check .env file
    env_path = os.path.join(base_dir, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GEMINI_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if key:
                            os.environ["GEMINI_API_KEY"] = key
                            print("[KEY] Loaded GEMINI_API_KEY from .env")
                            return key
        except Exception as e:
            print(f"[KEY-ERROR] Error reading .env: {e}")
            
    # Check gemini_key.txt file
    key_txt_path = os.path.join(base_dir, "gemini_key.txt")
    if os.path.exists(key_txt_path):
        try:
            with open(key_txt_path, "r", encoding="utf-8") as f:
                key = f.read().strip()
                if key:
                    os.environ["GEMINI_API_KEY"] = key
                    print("[KEY] Loaded GEMINI_API_KEY from gemini_key.txt")
                    return key
        except Exception as e:
            print(f"[KEY-ERROR] Error reading gemini_key.txt: {e}")
            
    print("[KEY-WARNING] GEMINI_API_KEY not found in environment, .env, or gemini_key.txt.")
    return None


def kill_port_owner(port):
    """Safely terminate any process listening on the specified port (Windows specific)."""
    try:
        cmd = f"netstat -ano | findstr LISTENING | findstr :{port}"
        output = subprocess.check_output(cmd, shell=True).decode()
        for line in output.strip().split("\n"):
            parts = line.split()
            if len(parts) >= 5:
                pid = parts[-1]
                print(f"[CLEANUP] Clearing port {port} (PID: {pid})...")
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(0.5)
    except subprocess.CalledProcessError:
        pass

def kill_conflicting_processes():
    """Kill existing cloudflared processes to prevent conflicts."""
    print("[CLEANUP] Cleaning up old tunnel processes...")
    subprocess.run("taskkill /F /IM cloudflared.exe", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    
    for port in PORTS.keys():
        kill_port_owner(port)

def start_servers():
    """Spin up the FastAPI server and local static servers."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("\n[SERVER] Initiating Business Unit Servers...")
    for port, (name, folder) in PORTS.items():
        folder_path = os.path.join(base_dir, folder)
        
        if port == 8000:
            # FastAPI Server
            print(f"   [8000] Launching {name} FastAPI Gateway...")
            p = subprocess.Popen([sys.executable, "server.py"], cwd=folder_path)
        else:
            # Static HTTP Servers
            print(f"   [{port}] Launching {name} HTTP Server...")
            p = subprocess.Popen([sys.executable, "-m", "http.server", str(port)], cwd=folder_path)
            
        processes.append(p)
    time.sleep(2)

def start_tunnels():
    """Launch Cloudflare Quick Tunnels for each server."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    cloudflared_path = os.path.join(base_dir, "cloudflared.exe")
    
    if not os.path.exists(cloudflared_path):
        print(f"[ERROR] cloudflared.exe not found at {cloudflared_path}")
        sys.exit(1)
        
    print("\n[TUNNEL] Establishing Secure Cloudflare Tunnels (trycloudflare.com)...")
    for port, (name, _) in PORTS.items():
        log_file = os.path.join(base_dir, f"tunnel_{port}_err.log")
        # Remove old log if exists
        if os.path.exists(log_file):
            try: os.remove(log_file)
            except: pass
            
        print(f"   [{port}] Tunneling {name} to the web...")
        # Start tunnel in background with TCP-based HTTP2 protocol to bypass UDP egress firewall blockages, and write logs
        log_handle = open(log_file, "w", encoding="utf-8")
        p = subprocess.Popen([cloudflared_path, "tunnel", "--protocol", "http2", "--url", f"http://localhost:{port}"], stdout=log_handle, stderr=log_handle)
        tunnels.append((p, log_handle))
    
    print("[WAIT] Waiting for Cloudflare to issue public HTTPS domains...")

def extract_tunnel_url(port):
    """Parse log file to find generated trycloudflare.com URL."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    log_file = os.path.join(base_dir, f"tunnel_{port}_err.log")
    
    if not os.path.exists(log_file):
        return None
        
    try:
        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            for line in content.split("\n"):
                if "trycloudflare.com" in line and "https://" in line:
                    parts = line.split("https://")
                    if len(parts) >= 2:
                        url_part = parts[1].split()[0]
                        url = "https://" + url_part.replace("|", "").strip()
                        return url
    except Exception as e:
        print(f"Error parsing log for port {port}: {e}")
    return None

def check_firewall_blocked():
    """Check if the network blocks port 7844 by scanning tunnel logs."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    for port in PORTS.keys():
        log_file = os.path.join(base_dir, f"tunnel_{port}_err.log")
        if os.path.exists(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    if "7844" in content and ("timeout" in content.lower() or "failed to dial" in content.lower() or "unable to establish connection" in content.lower()):
                        return True
            except:
                pass
    return False

def poll_for_urls():
    """Wait and poll log files until all 5 tunnel URLs are generated, or fallback to Local Host if blocked."""
    global is_local_mode
    start_time = time.time()
    timeout = 12 # Shorter timeout for faster local fallback
    
    while time.time() - start_time < timeout:
        # Check if university or corporate firewall is blocking Cloudflare Tunnel port 7844
        if check_firewall_blocked():
            print("\n[FIREWALL] Outbound connection to port 7844 is BLOCKED by your network firewall.")
            print("           (This is common on university networks or corporate Wi-Fi.)")
            print("           Switching to high-performance LOCAL MODE seamlessly...")
            is_local_mode = True
            
            # Kill the cloudflared processes to free resources
            subprocess.run("taskkill /F /IM cloudflared.exe", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Configure URLs to localhost
            for port in PORTS.keys():
                tunnel_urls[port] = f"http://localhost:{port}"
            return True
            
        all_resolved = True
        for port in PORTS.keys():
            if port not in tunnel_urls:
                url = extract_tunnel_url(port)
                if url:
                    tunnel_urls[port] = url
                    print(f"   [SUCCESS] Port {port} -> {url}")
                else:
                    all_resolved = False
                    
        if all_resolved:
            return True
        time.sleep(1)
        
    print("\n[WARNING] Cloudflare tunnels timed out. Switching to LOCAL MODE fallback...")
    is_local_mode = True
    # Kill the cloudflared processes to free resources
    subprocess.run("taskkill /F /IM cloudflared.exe", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    for port in PORTS.keys():
        tunnel_urls[port] = f"http://localhost:{port}"
    return True

def update_routing():
    """Dynamically perform dynamic file-level routing rewrites with the live HTTPS URLs."""
    print("\n[ROUTING] Dynamically Overwriting SaaS Production Routes...")
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Update VentureOS config.js
    config_path = os.path.join(base_dir, "VentureOS", "config.js")
    vendimap_url = tunnel_urls.get(8003, "http://localhost:8003")
    socialintent_url = tunnel_urls.get(8005, "http://localhost:8005")
    
    # In Local Mode, use relative links or localhost URLs for clean click-through
    if is_local_mode:
        config_content = f"""const VENTURE_LINKS = {{
    vendimap: "http://localhost:8003/index.html",
    socialintent: "http://localhost:8005/index.html"
}};
"""
    else:
        config_content = f"""const VENTURE_LINKS = {{
    vendimap: "{vendimap_url}",
    socialintent: "{socialintent_url}"
}};
"""
    with open(config_path, "w", encoding="utf-8") as f:
        f.write(config_content)
    print(f"   Updated: {config_path}")
    
    # 2. Update backendApiUrl
    core_backend_url = tunnel_urls.get(8000, "http://localhost:8000")
    
    def update_js_backend(file_path):
        if not os.path.exists(file_path):
            return
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        pattern = r"let backendApiUrl\s*=\s*['\"].*?['\"]"
        replacement = f"let backendApiUrl = '{core_backend_url}'"
        updated = re.sub(pattern, replacement, content)
        
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(updated)
        print(f"   Updated: {file_path} -> backend = {core_backend_url}")

    update_js_backend(os.path.join(base_dir, "SocialIntent", "index.html"))
    update_js_backend(os.path.join(base_dir, "app.js"))
    
    # 3. Update config.json with current backendApiUrl
    import json
    config_json_path = os.path.join(base_dir, "config.json")
    try:
        with open(config_json_path, "w", encoding="utf-8") as f:
            json.dump({"backendApiUrl": core_backend_url}, f, ensure_ascii=False, indent=2)
        print(f"   Updated: {config_json_path} -> backendApiUrl = {core_backend_url}")
    except Exception as e:
        print(f"   [ERROR] Failed to write config.json: {e}")


def print_dashboard():
    clear_screen()
    border = "=" * 80
    logo = """
__      __  ______   _   _   _______   _    _   _____    ______    ____     _____ 
\ \    / / |  ____| | \ | | |__   __| | |  | | |  __ \  |  ____|  / __ \   / ____|
 \ \  / /  | |__    |  \| |    | |    | |  | | | Rog  | | |__    | |  | | | (___  
  \ \/ /   |  __|   | . ` |    | |    | |  | | |  _  /  |  __|   | |  | |  \___ \ 
   \  /    | |____  | |\  |    | |    | |__| | | | \ \  | |____  | |__| |  ____) |
    \/     |______| |_| \_|    |_|     \____/  |_|  \_\ |______|  \____/  |_____/ 
    """
    print(logo)
    print(border)
    print("   [EMPIRE] AI EMPIRE OPERATIONAL COMMAND CENTER - DEPLOYED SUCCESS")
    print(border)
    print(f"   Chairman: ADMIN")
    if is_local_mode:
        print(f"   System Status: ACTIVE IN LOCAL INTEGRATED MODE (Firewall Bypass Active)")
    else:
        print(f"   System Status: ACTIVE AND SECURED IN PRODUCTION (Cloud Tunnels Live)")
    print(border)
    print("   ACTIVE SaaS BUSINESS UNITS:")
    print(border)
    
    if is_local_mode:
        print("   [NOTICE] You are currently on a restricted network (Restricted Wi-Fi).")
        print("            Please open the following local links in your browser:")
        print("            --------------------------------------------------------")
        print(f"    [Venture OS Center] : http://localhost:8004/index.html")
        print(f"    [VendiMap App]      : http://localhost:8003/index.html")
        print(f"    [SocialIntent AI]   : http://localhost:8005/index.html")
    else:
        print(f"    [Venture OS Center] : {tunnel_urls.get(8004)}")
        print(f"    [VendiMap App]      : {tunnel_urls.get(8003)}")
        print(f"    [SocialIntent AI]   : {tunnel_urls.get(8005)}")
        
    print(border)
    print("   [PROXY] Secure Server Proxy  : Route all API requests globally through")
    print(f"                                  {tunnel_urls.get(8000)}/api/gemini-proxy")
    print(border)
    print("   [INFO] PRESS CTRL+C AT ANY TIME TO GRACEFULLY SHUT DOWN ALL SERVERS")
    print(border)

def shutdown(signum=None, frame=None):
    print("\n[SHUTDOWN] Initiating graceful shutdown of all services...")
    for p in processes:
        try: p.terminate()
        except: pass
    for p, log in tunnels:
        try:
            p.terminate()
            log.close()
        except: pass
    print("[CLEANUP] All processes stopped. Goodbye!")
    sys.exit(0)

if __name__ == "__main__":
    # Register shutdown signals
    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    
    try:
        clear_screen()
        print("========================================================================")
        print("          VENTURE OS AUTOMATED MULTI-SaaS TUNNEL LAUNCH ORCHESTRATOR    ")
        print("========================================================================")
        
        load_gemini_key()
        kill_conflicting_processes()
        start_servers()

        # Force high-performance local mode directly to avoid network timeouts and Cloudflare 1033 errors
        is_local_mode = True
        for port in PORTS.keys():
            tunnel_urls[port] = f"http://localhost:{port}"

        update_routing()
        print_dashboard()
        
        # Keep script alive to maintain server subprocesses
        while True:
            time.sleep(1)
            
    except KeyboardInterrupt:
        shutdown()
