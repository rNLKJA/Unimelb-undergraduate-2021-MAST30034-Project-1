"""Sparse-design OLS helpers for the 579-column one-hot trip model (imported by rigour.py).

The model matrix has, per row, an intercept, 11 numeric columns and exactly one
active level in each of 8 one-hot blocks. Storing it densely would take
75M x 520 doubles, so every quantity is computed from the row's 20 non-zero
positions instead:

* ``Xa``  (n, 1 + k) dense part: intercept and numeric columns, reduced indices 0..k
* ``R``   (n, 8) reduced index of each block's active level; ``Q - 1`` is a dummy
          slot for dropped (reference or unused) levels whose value is ignored

``Q`` is the size of the reduced design plus that dummy slot. Matrices returned
here are (Q, Q); callers drop the dummy row and column.

``self_check`` compares these functions against statsmodels on a dense design.
"""

from __future__ import annotations

import numpy as np


def outer_sum(Xa: np.ndarray, R: np.ndarray, w: np.ndarray, Q: int) -> np.ndarray:
    """sum_i w_i x_i x_i' for the sparse rows (x_i = Xa_i on 0..k, ones at R_i)."""
    k1 = Xa.shape[1]
    M = np.zeros((Q, Q))
    Xw = Xa * w[:, None]
    M[:k1, :k1] += Xw.T @ Xa
    nb = R.shape[1]
    for c in range(nb):
        rc = R[:, c]
        # dense x one-hot block (and its transpose)
        for a in range(k1):
            v = np.bincount(rc, weights=Xw[:, a], minlength=Q)
            M[a, :] += v
            M[:, a] += v
        # one-hot block with itself: diagonal only
        M[np.arange(Q), np.arange(Q)] += np.bincount(rc, weights=w, minlength=Q)
        for d in range(c + 1, nb):
            flat = np.bincount(rc.astype(np.int64) * Q + R[:, d], weights=w, minlength=Q * Q).reshape(Q, Q)
            M += flat + flat.T
    return M


def leverage(Xa: np.ndarray, R: np.ndarray, A: np.ndarray) -> np.ndarray:
    """h_i = x_i' A x_i for the sparse rows (A is (Q, Q), zero on the dummy slot)."""
    k1 = Xa.shape[1]
    h = np.einsum("ij,jk,ik->i", Xa, A[:k1, :k1], Xa)
    nb = R.shape[1]
    for c in range(nb):
        rc = R[:, c]
        h += 2.0 * np.einsum("ij,ji->i", Xa, A[:k1, rc])
        h += A[rc, rc]
        for d in range(c + 1, nb):
            h += 2.0 * A[rc, R[:, d]]
    return h


def cluster_scores(Xa: np.ndarray, R: np.ndarray, e: np.ndarray, g: np.ndarray, G: int, Q: int) -> np.ndarray:
    """S[g, j] = sum over rows in cluster g of x_ij * e_i  (shape (G, Q))."""
    k1 = Xa.shape[1]
    S = np.zeros((G, Q))
    for a in range(k1):
        S[:, a] += np.bincount(g, weights=Xa[:, a] * e, minlength=G)
    for c in range(R.shape[1]):
        S += np.bincount(g.astype(np.int64) * Q + R[:, c], weights=e, minlength=G * Q).reshape(G, Q)
    return S


def sandwich(A: np.ndarray, meat: np.ndarray) -> np.ndarray:
    return A @ meat @ A


def self_check(seed: int = 7) -> dict:
    """Compare leverage, HC3 and cluster-robust SEs with statsmodels on a random dense design."""
    import statsmodels.api as sm

    rng = np.random.default_rng(seed)
    n, k, levels = 4000, 3, [5, 4, 6]
    Xn = rng.normal(size=(n, k))
    cats = [rng.integers(0, L, size=n) for L in levels]
    groups = rng.integers(0, 40, size=n)
    # reduced layout: 0 intercept, 1..k numeric, then levels 1.. of each block (level 0 = reference)
    offsets, start = [], 1 + k
    for L in levels:
        offsets.append(start)
        start += L - 1
    Q = start + 1  # + dummy
    dummy = Q - 1
    R = np.stack(
        [np.where(c == 0, dummy, off + c - 1) for c, off in zip(cats, offsets)], axis=1
    ).astype(np.int64)
    Xa = np.column_stack([np.ones(n), Xn])
    y = 1 + Xn @ np.array([0.5, -1.0, 2.0]) + sum(c * 0.3 for c in cats) + rng.normal(size=n) * (1 + np.abs(Xn[:, 0]))

    XtX = outer_sum(Xa, R, np.ones(n), Q)[:-1, :-1]
    dense = np.zeros((n, Q - 1))
    dense[:, : 1 + k] = Xa
    for c in range(len(levels)):
        m = R[:, c] != dummy
        dense[np.flatnonzero(m), R[m, c]] = 1.0
    assert np.allclose(XtX, dense.T @ dense)
    Xty = dense.T @ y
    beta = np.linalg.solve(XtX, Xty)
    A = np.zeros((Q, Q))
    A[:-1, :-1] = np.linalg.inv(XtX)
    e = y - dense @ beta
    h = leverage(Xa, R, A)
    w = e**2 / (1 - h) ** 2
    V_hc3 = sandwich(A, outer_sum(Xa, R, w, Q))[:-1, :-1]
    S = cluster_scores(Xa, R, e, groups, 40, Q)[:, :-1]
    p = Q - 1
    adj = 40 / 39 * (n - 1) / (n - p)
    V_cl = adj * (A[:-1, :-1] @ (S.T @ S) @ A[:-1, :-1])

    ols = sm.OLS(y, dense)
    r_hc3 = ols.fit(cov_type="HC3")
    r_cl = ols.fit(cov_type="cluster", cov_kwds={"groups": groups})
    h_sm = r_hc3.get_influence().hat_matrix_diag
    out = {
        "beta_max_abs_diff": float(np.max(np.abs(beta - r_hc3.params))),
        "leverage_max_abs_diff": float(np.max(np.abs(h - h_sm))),
        "se_hc3_max_rel_diff": float(np.max(np.abs(np.sqrt(np.diag(V_hc3)) / r_hc3.bse - 1))),
        "se_cluster_max_rel_diff": float(np.max(np.abs(np.sqrt(np.diag(V_cl)) / r_cl.bse - 1))),
    }
    assert out["beta_max_abs_diff"] < 1e-9, out
    assert out["leverage_max_abs_diff"] < 1e-10, out
    assert out["se_hc3_max_rel_diff"] < 1e-8, out
    assert out["se_cluster_max_rel_diff"] < 1e-8, out
    return out
