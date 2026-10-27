"""Vercel Python fonksiyonu giriş noktası.

vercel.json tüm /api/* isteklerini buraya yönlendirir; FastAPI isteğin özgün yolunu görür.
Sunucusuz ortamda yalnızca geçici klasör (/tmp) yazılabilir ve arka plan işi sürdürülemez;
bu ayarlar uygulama içe aktarılmadan önce yapılır.
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

_TMP = Path(tempfile.gettempdir())
os.environ.setdefault("CFLP_SERVERLESS", "1")
os.environ.setdefault("CFLP_CACHE_DIR", str(_TMP / "cflp-cache"))
os.environ.setdefault("NUMBA_CACHE_DIR", str(_TMP / "numba"))

from server.main import app  # noqa: E402,F401
