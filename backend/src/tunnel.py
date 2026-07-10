import os
from pyngrok import ngrok, conf
from sqlalchemy.orm import Session
from src.db import Settings

def start_ngrok_tunnel(db: Session):
    # HARD GUARD: never start an ngrok tunnel in production. The tunnel is a
    # local-development convenience only; production has a real public domain.
    # When this ran inside the Coolify container it auto-ran setup_retell_agent.py
    # with the ngrok URL, and because retell_agent_state.json is gitignored (not
    # in the image), every redeploy "found no existing agent" and created a NEW
    # duplicate Retell agent pointed at a throwaway tunnel. Coolify injects
    # COOLIFY_FQDN/COOLIFY_URL into containers, so their presence identifies
    # production; DISABLE_NGROK=1 is an explicit manual override for any other
    # hosted environment.
    if os.getenv("COOLIFY_FQDN") or os.getenv("COOLIFY_URL") or os.getenv("DISABLE_NGROK"):
        print("INFO: Production/hosted environment detected (COOLIFY_* or DISABLE_NGROK set) — ngrok tunneling skipped.")
        return

    token_setting = db.query(Settings).filter(Settings.key == "ngrok_auth_token").first()
    auth_token = token_setting.value if token_setting else os.getenv("NGROK_AUTH_TOKEN")

    url_setting = db.query(Settings).filter(Settings.key == "ngrok_url").first()

    if not auth_token or auth_token.strip() == "":
        print("INFO: Ngrok Auth Token not configured. Automatic tunneling skipped.")
        print("To enable automatic webhook tunneling, configure your Ngrok Auth Token in settings.")
        if url_setting:
            db.delete(url_setting)
            db.commit()
        return

    try:
        # Set auth token
        ngrok.set_auth_token(auth_token.strip())
        
        # Kill existing tunnels to avoid conflicts
        try:
            for t in ngrok.get_tunnels():
                ngrok.disconnect(t.public_url)
        except:
            pass

        # Open new tunnel
        port = int(os.getenv("PORT", "5000"))
        tunnel = ngrok.connect(port, bind_tls=True)
        public_url = tunnel.public_url

        print(f"\n========================================================")
        print(f"SUCCESS: NGROK TUNNEL CREATED SUCCESSFULLY!")
        print(f"Public Webhook URL: {public_url}/api/webhooks/retell")
        print(f"Set this in Retell dashboard under Webhook Settings")
        print(f"========================================================\n")

        # Save to database Settings
        if not url_setting:
            url_setting = Settings(key="ngrok_url", value=public_url)
            db.add(url_setting)
        else:
            url_setting.value = public_url
        db.commit()

        # Automatically update Retell Agent definitions with the new webhook URL
        try:
            import subprocess
            import sys
            
            # Get api key from db or env
            api_key_setting = db.query(Settings).filter(Settings.key == "retell_api_key").first()
            api_key = api_key_setting.value if api_key_setting else os.getenv("RETELL_API_KEY")
            
            if api_key:
                env = os.environ.copy()
                env["RETELL_API_KEY"] = api_key
                env["WEBHOOK_BASE_URL"] = f"{public_url}/api/webhooks"
                
                # tunnel.py is in src/, setup_retell_agent.py is in the parent directory
                script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "setup_retell_agent.py"))
                if os.path.exists(script_path):
                    print(f"[TUNNEL] Automatically updating Retell agent tools using {script_path}...")
                    # Run in a separate process to avoid blocking startup
                    subprocess.Popen([sys.executable, script_path], env=env)
                else:
                    print(f"[TUNNEL] setup_retell_agent.py not found at {script_path}")
            else:
                print("[TUNNEL] Retell API key not found. Skipping auto agent update.")
        except Exception as update_err:
            print(f"[TUNNEL] Failed to auto-update Retell agent: {update_err}")

    except Exception as e:
        print("WARNING: Failed to establish Ngrok tunnel:", e)
        if url_setting:
            db.delete(url_setting)
            db.commit()
