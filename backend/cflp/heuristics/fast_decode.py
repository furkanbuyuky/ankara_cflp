"""Decoder'ın numba ile derlenmiş sürümü.

`Evaluator.decode` içindeki Python döngüsüyle birebir aynı mantık; iz kaydı gerekmeyen
çalışmalarda (Sekme 4–5) kullanılır. Eşdeğerlik tests/test_heuristics.py'de sınanır.
"""
from __future__ import annotations

import numpy as np

try:
    from numba import njit

    AVAILABLE = True
except ImportError:  # pragma: no cover - numba yoksa Python sürümü kullanılır
    AVAILABLE = False

    def njit(*a, **k):
        def wrap(f):
            return f

        return wrap


EPS = 1e-9


@njit(cache=True)
def _ejection(i, assign, cap_left, open_sorted, order, d, assign_cost):
    I, J = open_sorted.shape
    need = np.full(J, np.inf)
    for p in range(J):
        if open_sorted[i, p]:
            j = order[i, p]
            need[j] = d[i] - cap_left[j]
    best_cost = np.inf
    bj, bi2, bj2 = -1, -1, -1
    for i2 in range(I):
        j = assign[i2]
        if j < 0 or d[i2] < need[j] - EPS:
            continue
        for p in range(J):
            if not open_sorted[i2, p]:
                continue
            j2 = order[i2, p]
            if j2 == j or cap_left[j2] < d[i2] - EPS:
                continue
            cost = assign_cost[i, j] + assign_cost[i2, j2] - assign_cost[i2, j]
            if cost < best_cost:
                best_cost = cost
                bj, bi2, bj2 = j, i2, j2
            break
    return bj, bi2, bj2


@njit(cache=True)
def decode_fast(seq, has1, first, open_sorted, order, d, cap_left, assign_cost):
    I, J = open_sorted.shape
    assign = np.full(I, -1, np.int64)
    for i in seq:
        if not has1[i]:
            continue
        di = d[i]
        j = first[i]
        if cap_left[j] < di - EPS:
            j = -1
            for p in range(J):
                if open_sorted[i, p]:
                    jj = order[i, p]
                    if cap_left[jj] >= di - EPS:
                        j = jj
                        break
        if j >= 0:
            assign[i] = j
            cap_left[j] -= di
    for i in seq:
        if assign[i] >= 0 or not has1[i]:
            continue
        if cap_left.sum() < d[i] - EPS:
            continue
        j, i2, j2 = _ejection(i, assign, cap_left, open_sorted, order, d, assign_cost)
        if j < 0:
            continue
        assign[i2] = j2
        cap_left[j2] -= d[i2]
        cap_left[j] += d[i2] - d[i]
        assign[i] = j
    return assign
