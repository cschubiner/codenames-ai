"""Central path configuration for the Codenames AI project."""

from pathlib import Path

# Project root is 3 levels up from this file (python/src/paths.py -> codenames-ai/)
PROJECT_ROOT = Path(__file__).parent.parent.parent

# Shared resources directory
SHARED_DIR = PROJECT_ROOT / "shared"
PROMPTS_DIR = SHARED_DIR / "prompts"
WORDLIST_PATH = SHARED_DIR / "wordlist.json"
