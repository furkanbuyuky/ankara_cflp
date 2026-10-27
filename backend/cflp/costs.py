"""Mesafe ve maliyet yardımcıları."""
from __future__ import annotations

import numpy as np

EARTH_RADIUS_KM = 6371.0088


def haversine_km(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a: (n, 2) [lat, lon], b: (m, 2) → (n, m) kuş uçuşu mesafe (km)."""
    lat1, lon1 = np.radians(a[:, 0])[:, None], np.radians(a[:, 1])[:, None]
    lat2, lon2 = np.radians(b[:, 0])[None, :], np.radians(b[:, 1])[None, :]
    h = (
        np.sin((lat2 - lat1) / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(h))


def capital_recovery_factor(rate: float, years: int) -> float:
    """Tek seferlik yatırımı eşit yıllık taksitlere çeviren katsayı."""
    if rate == 0:
        return 1.0 / years
    g = (1 + rate) ** years
    return rate * g / (g - 1)
