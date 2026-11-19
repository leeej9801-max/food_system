"""Run after the frontend build: python deploy/test_nginx.py (Docker required)."""

import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "nginx:1.28-alpine"


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    dist = ROOT / "frontend/dist"
    html = (dist / "index.html").read_text(encoding="utf-8")
    assets = re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', html)
    # The existing font stylesheet is served by a CDN, outside this Nginx.
    assets = [p for p in assets if not p.startswith(("https://", "http://", "//"))]
    assert assets and all(p.startswith("/assets/") for p in assets), assets
    name = "food-nginx-test-" + uuid.uuid4().hex[:12]
    opener = urllib.request.build_opener(NoRedirect)

    def request(path, host="food.leejblab.site"):
        req = urllib.request.Request(base + path, headers={"Host": host})
        try:
            response = opener.open(req, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read().decode()

    with tempfile.TemporaryDirectory(prefix="food-nginx-") as scratch:
        mock = Path(scratch) / "api.conf"
        mock.write_text('server { listen 8000; location / { return 200 "$request_uri"; } }\n')
        try:
            docker("network", "create", name)
            docker("run", "-d", "--name", name + "-api", "--network", name,
                   "--network-alias", "backend", "--mount",
                   f"type=bind,source={mock},target=/etc/nginx/conf.d/default.conf,readonly", IMAGE)
            mounts = ["--mount", f"type=bind,source={ROOT / 'frontend/nginx.conf'},target=/etc/nginx/conf.d/default.conf,readonly",
                      "--mount", f"type=bind,source={dist},target=/usr/share/nginx/html,readonly"]
            docker("run", "--rm", "--network", name, *mounts, IMAGE, "nginx", "-t")
            docker("run", "-d", "--name", name + "-web", "--network", name,
                   "-p", "127.0.0.1::80", *mounts, IMAGE)
            port = docker("port", name + "-web", "80/tcp").rsplit(":", 1)[1]
            base = "http://127.0.0.1:" + port
            for attempt in range(30):
                try:
                    status, _, body = request("/")
                    assert status == 200 and body == html
                    break
                except (OSError, AssertionError):
                    if attempt == 29:
                        raise
                    time.sleep(0.2)

            for path in ("/menus?store=test&q=pasta", "/guest/table", "/analytics"):
                status, headers, body = request(path)
                assert status == 200 and body == html, path
                assert headers["Cache-Control"] == "no-store"
            for path in assets:
                status, headers, _ = request(path)
                assert status == 200 and "immutable" in headers["Cache-Control"], path
            assert request("/assets/missing.js")[0] == 404
            for path in ("/api/v1/stores?limit=1&offset=2", "/api/v1/stores/",
                         "/api/v1/stores/a%2Fb?q=%2F&x=1"):
                status, headers, body = request(path)
                assert status == 200 and body == path, (path, body)
                assert headers["Cache-Control"] == "no-store"
            assert request("/health")[2] == "/health"
            for path, target in (
                ("/food", "/"), ("/food/", "/"), ("/food?store=x", "/?store=x"),
                ("/food/menus?store=x&q=a%20b", "/menus?store=x&q=a%20b"),
                ("/food/a%2Fb?q=%2F&x=1", "/a%2Fb?q=%2F&x=1"),
            ):
                status, headers, _ = request(path, "lci.leejblab.site")
                assert status == 301 and headers["Location"] == "https://food.leejblab.site" + target, path
                assert request(path)[0] == 200, "Legacy redirect leaked to new host"
            assert request("/foodish", "lci.leejblab.site")[0] == 200
            assert request("/menus", "lci.leejblab.site")[0] == 200
            print("PASS: nginx syntax, root/SPA/assets/cache, API URI/query, health, host-scoped 301 with encoded paths/query")
        finally:
            for container in (name + "-web", name + "-api"):
                subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            subprocess.run(["docker", "network", "rm", name], capture_output=True)


if __name__ == "__main__":
    main()
