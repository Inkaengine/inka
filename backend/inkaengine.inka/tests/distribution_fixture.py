"""Generate the shared template fixtures as a plone.exportimport distribution.

The templates the @templates tests run against are the SAME ones the JS suites use, so
neither side can drift from the other's idea of what a template looks like. They live in
the inka repo as markdown (`tests-playwright/fixtures/site-root/templates/*.md`), decoded
into memory by the mock API at load time — there is no distribution on disk to point
Plone at.

So one is generated here: boot the mock API, ask it to `@export`, unpack the result. It is
a build artifact (gitignored), not a second source of truth — edit the `.md` files and the
next test run picks the change up, with no committed copy to go stale.

Requires `node` and the inka checkout. When either is missing the fixture skips rather
than fails: this addon can be worked on without the JS repo, just not on these tests.
"""

from pathlib import Path

import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request


# backend/inkaengine.inka/tests/ -> backend/inkaengine.inka -> backend -> <inka repo>
INKA_ROOT = Path(__file__).resolve().parents[3]
MOCK_SERVER = INKA_ROOT / "tests-playwright" / "fixtures" / "mock-api-server.cjs"
# Only the /templates tree is needed here. The export also carries images, the search page
# and the site root; importing those into the test portal would be slower and would couple
# these tests to fixtures they do not read.
KEEP_PREFIX = "templates/"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(port, proc, timeout=120):
    """Block until the mock answers /health.

    The mock scans every content mount before it listens (~40s on a cold run), so this
    waits generously — and fails loudly with the server's own output if it dies, rather
    than timing out with nothing to read.
    """
    deadline = time.time() + timeout
    url = f"http://localhost:{port}/health"
    while time.time() < deadline:
        if proc.poll() is not None:
            out = proc.stdout.read().decode("utf8", "replace") if proc.stdout else ""
            raise RuntimeError(f"mock API exited ({proc.returncode}):\n{out[-2000:]}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            time.sleep(1)
    raise RuntimeError(f"mock API did not become healthy within {timeout}s")


def _trim_to_templates(content_dir: Path):
    """Keep only the /templates tree.

    The metadata lists every exported item; anything left in `_data_files_` must exist on
    disk or the import fails, so the file list and the directories are trimmed together.
    """
    metadata_path = content_dir / "__metadata__.json"
    metadata = json.loads(metadata_path.read_text())

    metadata["_data_files_"] = [
        f for f in metadata.get("_data_files_", []) if f.startswith(KEEP_PREFIX)
    ]
    # Blobs belong to the images that were just dropped.
    metadata["_blob_files_"] = []
    for key in ("ordering", "local_roles", "default_page", "relations"):
        value = metadata.get(key)
        if isinstance(value, dict):
            metadata[key] = {
                k: v for k, v in value.items() if "templates" in k
            }

    metadata_path.write_text(json.dumps(metadata, indent=2))

    for child in content_dir.iterdir():
        if child.name == "__metadata__.json":
            continue
        if child.is_dir() and child.name == "templates":
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()


def build_distribution(dest: Path) -> Path:
    """Export the shared template fixtures into `dest`. Returns the distribution root."""
    if not MOCK_SERVER.exists():
        raise FileNotFoundError(
            f"mock API not found at {MOCK_SERVER} — these tests need the inka checkout"
        )
    if shutil.which("node") is None:
        raise FileNotFoundError("node not found on PATH")

    port = _free_port()
    env = {
        **os.environ,
        "PORT": str(port),
        # The site-root mount is the one carrying the shared templates.
        "CONTENT_MOUNTS": "/:tests-playwright/fixtures/site-root",
    }
    proc = subprocess.Popen(
        ["node", str(MOCK_SERVER)],
        cwd=str(INKA_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        _wait_for_health(port, proc)
        request = urllib.request.Request(
            f"http://localhost:{port}/++api++/@export",
            data=json.dumps({"format": "json", "allowMissingBlobs": True}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            archive_bytes = response.read()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    dest.mkdir(parents=True, exist_ok=True)
    archive = dest / "export.zip"
    archive.write_bytes(archive_bytes)
    # @export answers with a zip, matching real plone.exportimport.
    shutil.unpack_archive(str(archive), str(dest), format="zip")
    archive.unlink()

    _trim_to_templates(dest / "content")
    return dest
