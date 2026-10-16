"""
tests/conftest.py

Pytest configuration and portable GenLayer SDK environment bootstrap.
Resolves repository root dynamically without hardcoded paths, sets up WASI mocks,
and configures the GenLayer standard library path portably across developer machines,
CI runners, and clean clones.
"""

import os
import sys
from pathlib import Path

# 1. Dynamically resolve project root and add to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# 2. Setup WASI mocks for native GenLayer SDK in-memory testing
try:
    from genvm_linter.validate.sdk_loader import setup_wasi_mocks
    setup_wasi_mocks()
except ImportError:
    pass

# 3. Locate and add GenLayer SDK standard library to sys.path portably
def setup_genlayer_sdk():
    # If genlayer is already importable and functional, we're done
    try:
        import genlayer as gl
        if hasattr(gl, "storage") and hasattr(gl.storage, "inmem_allocate"):
            return
    except ImportError:
        pass

    # A. Explicit environment variables
    for env_var in ["GENLAYER_SDK_PATH", "GENVMROOT"]:
        val = os.environ.get(env_var)
        if val:
            p = Path(val)
            candidates = [
                p,
                p / "src",
                p / "runners" / "genlayer-py-std" / "src",
                p / "runners" / "py-lib-genlayer-std" / "src",
            ]
            for c in candidates:
                if (c / "genlayer" / "contract").exists():
                    if str(c) not in sys.path:
                        sys.path.insert(0, str(c))
                    return

    # B. Search cached locations in ~/.cache/genvm-linter or ~/.cache/gltest-direct
    cache_roots = [
        Path.home() / ".cache" / "genvm-linter",
        Path.home() / ".cache" / "gltest-direct",
    ]
    KNOWN_HASHES = [
        "z7fv8bqpetj3wnjd8sn5s5xfqve3rz8nmtq4npwf2qdvns57zjgg",  # v0.6.0-rc9 (matches deployed contract)
        "kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0",  # v0.6.0-rc7/rc8
        "10pqy9vk4a8w8pg25py83s23k3mjjy7dwpdqjvqggb9ms7ycipvh",  # v0.3.0-rc7
    ]

    for cache_dir in cache_roots:
        if not cache_dir.exists():
            continue
        # Check known hashes first
        for h in KNOWN_HASHES:
            matches = list(cache_dir.glob(f"**/py-lib-genlayer-std/{h}"))
            for m in matches:
                target = m / "src" if (m / "src" / "genlayer").is_dir() else m
                if (target / "genlayer" / "contract").exists():
                    if str(target) not in sys.path:
                        sys.path.insert(0, str(target))
                    return

        # Check any extracted py-lib-genlayer-std
        for m in sorted(cache_dir.glob("**/py-lib-genlayer-std/*"), reverse=True):
            target = m / "src" if (m / "src" / "genlayer").is_dir() else m
            if (target / "genlayer" / "contract").exists():
                if str(target) not in sys.path:
                    sys.path.insert(0, str(target))
                return

    # C. Auto-extract via genvm_linter if available
    try:
        from genvm_linter.validate.artifacts import download_artifacts, extract_runner, get_tarball_path
        version = "genlayerlabs-genvm-manager-v0.6.0-rc9"
        tarball_path = get_tarball_path(version)
        if not tarball_path.exists():
            tarball_path = download_artifacts(version)
        extracted = extract_runner(
            tarball_path,
            "py-lib-genlayer-std",
            "z7fv8bqpetj3wnjd8sn5s5xfqve3rz8nmtq4npwf2qdvns57zjgg",
        )
        target = extracted / "src" if (extracted / "src" / "genlayer").is_dir() else extracted
        if (target / "genlayer").is_dir():
            if str(target) not in sys.path:
                sys.path.insert(0, str(target))
            return
    except Exception:
        pass

setup_genlayer_sdk()
