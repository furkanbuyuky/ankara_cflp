"""Algoritma iz kaydı (trace).

İki seviye:
  - detail:     her pseudocode satırı / operatör olayı + o anki küçük durum anlık görüntüsü
                (Sekme 3, toy örnek)
  - generation: yalnızca nesil özetleri (Sekme 4 ve 5, gerçek örnek)
Algoritmalar tek bir kod olarak yazılır; seviye sadece neyin kaydedildiğini değiştirir.
"""
from __future__ import annotations

import copy
from typing import Any, Callable

import numpy as np


def _clean(v: Any) -> Any:
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


class Tracer:
    def __init__(
        self,
        detail: bool = False,
        trace_decoder: bool = True,
        max_events: int = 5000,
        on_generation: Callable[[dict], None] | None = None,
    ):
        self.detail = detail
        self.trace_decoder = detail and trace_decoder
        self.max_events = max_events
        self.events: list[dict] = []
        self.generations: list[dict] = []
        self.state: dict[str, Any] = {}
        self.on_generation = on_generation
        self.truncated = False

    def emit(self, line: str, kind: str, **payload: Any) -> None:
        if not self.detail:
            return
        if len(self.events) >= self.max_events:
            self.truncated = True
            return
        ev = {"step": len(self.events), "line": line, "kind": kind, **_clean(payload)}
        ev["state"] = copy.deepcopy(_clean(self.state))
        self.events.append(ev)

    def generation(self, summary: dict) -> None:
        summary = _clean(summary)
        self.generations.append(summary)
        if self.on_generation:
            self.on_generation(summary)

    @property
    def stop_requested(self) -> bool:
        """Detay modunda olay sınırı dolunca algoritma erken bitebilir."""
        return self.detail and self.truncated
