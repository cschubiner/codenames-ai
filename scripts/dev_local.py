#!/usr/bin/env python3
"""
Local dev runner for the Codenames web game.

Starts:
  1) Cloudflare Worker (wrangler dev --local) on a free port (default 8787+)
  2) Static frontend server for /docs on a free port (default 8000+)

Prints a URL with ?api=... so the frontend targets the chosen worker port.
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER_DIR = ROOT / "worker"
DOCS_DIR = ROOT / "docs"


def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
        return True


def find_free_port(start: int, max_tries: int = 100, *, exclude: set[int] | None = None) -> int:
    exclude = exclude or set()
    port = start
    for _ in range(max_tries):
        if port in exclude:
            port += 1
            continue
        if is_port_free(port):
            return port
        port += 1
    raise RuntimeError(f"No free port found in range {start}-{start+max_tries-1}")


def wait_for_health(worker_port: int, timeout_s: float = 20.0) -> None:
    url = f"http://localhost:{worker_port}/api/health"
    deadline = time.time() + timeout_s
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception as e:  # noqa: BLE001
            last_err = e
        time.sleep(0.5)
    raise RuntimeError(f"Worker did not become healthy at {url}: {last_err}")


def main() -> int:
    if not WORKER_DIR.exists():
        print("Missing worker/ directory. Are you in the repo root?", file=sys.stderr)
        return 2
    if not DOCS_DIR.exists():
        print("Missing docs/ directory. Are you in the repo root?", file=sys.stderr)
        return 2

    worker_port = find_free_port(int(os.environ.get("WORKER_PORT", "8787")))
    # Avoid common dev port conflicts (e.g., user has something on 3000).
    web_port = find_free_port(int(os.environ.get("WEB_PORT", "8000")), exclude={3000})

    worker_cmd = ["npx", "wrangler", "dev", "--local", "--port", str(worker_port)]
    web_cmd = [sys.executable, "-m", "http.server", str(web_port), "--directory", str(DOCS_DIR)]

    print(f"Starting worker on port {worker_port}...")
    worker_proc = subprocess.Popen(
        worker_cmd,
        cwd=str(WORKER_DIR),
        start_new_session=True,
    )

    try:
        wait_for_health(worker_port)
    except Exception as e:
        print(f"Worker failed to start: {e}", file=sys.stderr)
        try:
            os.killpg(worker_proc.pid, signal.SIGTERM)
        except Exception:
            worker_proc.terminate()
        worker_proc.wait(timeout=5)
        return 1

    print(f"Starting frontend on port {web_port}...")
    web_proc = subprocess.Popen(
        web_cmd,
        cwd=str(ROOT),
        start_new_session=True,
    )

    api_base = f"http://localhost:{worker_port}"
    api_param = urllib.parse.quote(api_base, safe="")
    url = f"http://localhost:{web_port}/?api={api_param}"

    print("\nLocal game is running:")
    print(f"- Worker:   {api_base}")
    print(f"- Frontend: {url}")
    print("\nPress Ctrl+C to stop.")

    def shutdown(*_args: object) -> None:
        for proc in (web_proc, worker_proc):
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except Exception:
                    proc.terminate()
        for proc in (web_proc, worker_proc):
            try:
                proc.wait(timeout=5)
            except Exception:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except Exception:
                    proc.kill()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            if worker_proc.poll() is not None:
                raise RuntimeError("Worker process exited.")
            if web_proc.poll() is not None:
                raise RuntimeError("Web server exited.")
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"\nStopping due to error: {e}", file=sys.stderr)
    finally:
        shutdown()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
