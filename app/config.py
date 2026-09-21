from dataclasses import dataclass, field
from pathlib import Path
import os

@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('DATA_DIR', './data')).resolve())
    token: str = field(default_factory=lambda: os.getenv('APP_TOKEN', ''))
    allowed_hosts: list[str] = field(default_factory=lambda: os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]').split(','))
    secure_cookie: bool = field(default_factory=lambda: os.getenv('SECURE_COOKIE', 'false').lower() == 'true')
    max_upload: int = field(default_factory=lambda: int(os.getenv('MAX_UPLOAD_MB', '4096')) * 1024 * 1024)
    min_free: int = 1024 * 1024 * 1024
    public_base_url: str = field(default_factory=lambda: os.getenv('PUBLIC_BASE_URL', ''))
