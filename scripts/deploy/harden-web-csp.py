"""Prepare a CSP-hardened copy; callers validate Caddy before installing it."""

import hashlib
import re
import sys
from pathlib import Path

site = Path(sys.argv[1])
config = Path(sys.argv[2])
html = (site / "index.html").read_text(encoding="utf-8")
if re.search(r"\son[a-z]+\s*=", html, re.IGNORECASE):
    raise SystemExit("Review inline event handlers before enforcing CSP")


def external_script(match):
    body = match.group(1)
    digest = hashlib.sha256(body.encode()).hexdigest()[:16]
    asset = site / "assets" / f"landing-{digest}.js"
    asset.parent.mkdir(exist_ok=True)
    asset.write_text(body, encoding="utf-8")
    asset.chmod(0o644)
    return f'<script src="/assets/{asset.name}"></script>'


html = re.sub(r"<script>\s*(.*?)</script>", external_script, html, flags=re.DOTALL)
caddy = config.read_text(encoding="utf-8")
old_policy = "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com"
new_policy = "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com"
if old_policy not in caddy and new_policy not in caddy:
    raise SystemExit("Unexpected CSP: refusing to modify configuration")
caddy = caddy.replace(old_policy, new_policy)
if 'Strict-Transport-Security "max-age=31536000"' not in caddy:
    start = caddy.index("\ntrlka.com {")
    position = caddy.index("\n\theader {", start) + len("\n\theader {")
    caddy = caddy[:position] + '\n\t\tStrict-Transport-Security "max-age=31536000"' + caddy[position:]
(site / "index.html").write_text(html, encoding="utf-8")
config.write_text(caddy, encoding="utf-8")
