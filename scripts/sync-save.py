#!/usr/bin/env python3
"""
Stardew Valley Save File Sync Utility for stardew.app
======================================================
Automatically finds your Stardew Valley save file and imports it into a
locally-running stardew.app instance.  Runs periodically so your tracker
always reflects the latest in-game progress without any manual upload.

Usage:
    python sync-save.py [--host HOST] [--interval SECONDS] [--once]

Requirements: Python 3.8+, a running stardew.app dev server on localhost:3000
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

# ---------------------------------------------------------------------------
# Minimum Python version check (must happen before any other imports)
# ---------------------------------------------------------------------------
if sys.version_info < (3, 8):
    print("ERROR: Python 3.8 or higher is required.")
    print(f"       You are running Python {platform.python_version()}.")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Dependency bootstrap – install 'requests' if missing
# ---------------------------------------------------------------------------
try:
    import requests  # noqa: F401
except ImportError:
    print("'requests' package not found – installing it now…")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "--quiet", "requests"]
    )
    import requests  # noqa: F401 (re-import after install)

import requests as _requests  # type: ignore  # used throughout

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_HOST = "http://localhost:3000"
CONFIG_FILE = Path.home() / ".config" / "stardew-app-sync" / "config.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _color(code: int, text: str) -> str:
    """Wrap text in ANSI color code when stdout is a TTY."""
    if sys.stdout.isatty():
        return f"\033[{code}m{text}\033[0m"
    return text


def info(msg: str) -> None:
    print(_color(36, "[INFO]"), msg)


def ok(msg: str) -> None:
    print(_color(32, "[ OK ]"), msg)


def warn(msg: str) -> None:
    print(_color(33, "[WARN]"), msg, file=sys.stderr)


def error(msg: str) -> None:
    print(_color(31, "[ERR ]"), msg, file=sys.stderr)


# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

def check_dependencies() -> None:
    """Check that the Node.js runtime and package manager are available."""
    node_found = shutil.which("node") is not None
    bun_found = shutil.which("bun") is not None
    npm_found = shutil.which("npm") is not None

    if not node_found and not bun_found:
        warn(
            "Neither 'node' nor 'bun' was found in PATH.  "
            "The stardew.app dev server requires one of them.\n"
            "  • Install Node.js:  https://nodejs.org/\n"
            "  • Install Bun:      https://bun.sh/"
        )
    else:
        runtime = "bun" if bun_found else "node"
        ok(f"JavaScript runtime found: {runtime}")

    if not npm_found and not bun_found:
        warn(
            "'npm' (or 'bun') is required to install project dependencies.\n"
            "  Install Node.js (includes npm): https://nodejs.org/"
        )


# ---------------------------------------------------------------------------
# Save file discovery
# ---------------------------------------------------------------------------

def get_saves_dir() -> Path:
    """Return the platform-specific Stardew Valley saves directory."""
    system = platform.system()
    if system == "Windows":
        appdata = os.environ.get("APPDATA") or str(
            Path.home() / "AppData" / "Roaming"
        )
        return Path(appdata) / "StardewValley" / "Saves"
    # macOS and Linux
    return Path.home() / ".config" / "StardewValley" / "Saves"


def list_saves() -> list[str]:
    """Return a list of valid save directory names (farmer name + ID)."""
    saves_dir = get_saves_dir()
    if not saves_dir.exists():
        return []
    return [
        entry.name
        for entry in sorted(saves_dir.iterdir())
        if entry.is_dir() and (entry / entry.name).is_file()
    ]


def get_save_file(save_name: str) -> Path:
    """Return the path to the actual save file within a save directory."""
    return get_saves_dir() / save_name / save_name


# ---------------------------------------------------------------------------
# Persistent configuration
# ---------------------------------------------------------------------------

def load_config() -> dict:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Import logic
# ---------------------------------------------------------------------------

def import_save(xml: str, uid: str | None, host: str) -> dict:
    """
    POST the raw XML save file to the stardew.app /api/import-save endpoint.

    The server parses the XML, stores the player data in the database, and
    returns the UID associated with the data.
    """
    url = f"{host}/api/import-save"
    if uid:
        url += f"?uid={uid}"

    resp = _requests.post(
        url,
        data=xml.encode("utf-8"),
        headers={"Content-Type": "text/plain; charset=utf-8"},
        timeout=30,
    )

    if resp.status_code == 404:
        raise RuntimeError(
            "The /api/import-save endpoint returned 404.\n"
            "Make sure the stardew.app dev server is running with "
            "NEXT_PUBLIC_DEVELOPMENT=1."
        )

    resp.raise_for_status()
    return resp.json()


def check_server(host: str) -> bool:
    """Return True if the stardew.app server is reachable at *host*."""
    try:
        resp = _requests.get(host, timeout=5)
        return resp.status_code < 500
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Interactive save selection
# ---------------------------------------------------------------------------

def select_save(saves: list[str], previous: str | None) -> str:
    """Prompt the user to choose a save, defaulting to the previously used one."""
    if not saves:
        error(
            f"No Stardew Valley save files found in {get_saves_dir()}.\n"
            "Make sure you have played the game at least once."
        )
        sys.exit(1)

    if len(saves) == 1:
        info(f"Found one save: {saves[0]}")
        return saves[0]

    print("\nAvailable save files:")
    for i, name in enumerate(saves, 1):
        marker = " (last used)" if name == previous else ""
        print(f"  {i}. {name}{marker}")

    default_idx = (saves.index(previous) + 1) if previous in saves else 1
    prompt = f"\nSelect save [1-{len(saves)}] (default {default_idx}): "
    while True:
        raw = input(prompt).strip()
        if raw == "":
            return saves[default_idx - 1]
        if raw.isdigit() and 1 <= int(raw) <= len(saves):
            return saves[int(raw) - 1]
        warn(f"Please enter a number between 1 and {len(saves)}.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Sync your Stardew Valley save file into a local stardew.app instance."
        )
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=f"stardew.app base URL (default: {DEFAULT_HOST})",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=60,
        help="Seconds between sync checks (default: 60)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Sync once and exit instead of watching for changes",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open a browser window after the first successful sync",
    )
    args = parser.parse_args()

    print(_color(35, "\n=== stardew.app Save Sync ===\n"))

    # 1. Check JavaScript runtime
    check_dependencies()

    # 2. Load persisted config
    cfg = load_config()

    # 3. Discover and select save
    saves = list_saves()
    save_name = select_save(saves, cfg.get("save_name"))
    cfg["save_name"] = save_name
    save_config(cfg)

    uid: str | None = cfg.get("uid")
    save_file = get_save_file(save_name)
    # None means we haven't synced yet; the first iteration always triggers an
    # import so the user gets immediate feedback when the script starts.
    last_mtime: float | None = None
    browser_opened = False

    info(f"Watching: {save_file}")
    if args.once:
        info("Running in single-shot mode (--once).")
    else:
        info(f"Checking for changes every {args.interval}s.  Press Ctrl+C to stop.")

    while True:
        try:
            current_mtime = save_file.stat().st_mtime
        except FileNotFoundError:
            warn(f"Save file not found: {save_file}")
            if args.once:
                return 1
            time.sleep(args.interval)
            continue

        if current_mtime != last_mtime:
            info(
                "Importing save…"
                if last_mtime is None
                else "Change detected – importing save…"
            )

            # Verify the server is up before attempting the import
            if not check_server(args.host):
                warn(
                    f"Cannot reach {args.host}.  "
                    "Is the stardew.app dev server running?\n"
                    "  Start it with:  bun run dev   (or npm run dev)"
                )
                if args.once:
                    return 1
                time.sleep(args.interval)
                continue

            try:
                xml = save_file.read_text(encoding="utf-8")
                result = import_save(xml, uid=uid, host=args.host)
                uid = result.get("uid", uid)
                player_count = result.get("players", 0)
                cfg["uid"] = uid
                save_config(cfg)
                last_mtime = current_mtime

                link = f"{args.host}?_uid={uid}"
                ok(
                    f"Imported {player_count} player(s).  "
                    f"Open your tracker: {link}"
                )

                # Open the browser the first time so the user gets the right UID
                if not browser_opened and not args.no_browser:
                    webbrowser.open(link)
                    browser_opened = True

            except Exception as exc:
                error(f"Sync failed: {exc}")
                if args.once:
                    return 1

        if args.once:
            break

        time.sleep(args.interval)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
