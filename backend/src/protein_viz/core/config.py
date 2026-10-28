"""Configuration independent of the working directory and the original Linux paths."""

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[4]
DEFAULT_DATA_DIR = PROJECT_DIR / "data"
DEFAULT_CORS_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:43147", "http://127.0.0.1:43147")


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS

    @classmethod
    def from_env(cls) -> "Settings":
        configured_dir = os.getenv("PROTEIN_DATA_DIR")
        origins = os.getenv("PROTEIN_CORS_ORIGINS")
        return cls(
            data_dir=Path(configured_dir).expanduser().resolve()
            if configured_dir
            else DEFAULT_DATA_DIR,
            cors_origins=tuple(value.strip() for value in origins.split(",") if value.strip())
            if origins is not None
            else DEFAULT_CORS_ORIGINS,
        )
