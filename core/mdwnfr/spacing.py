"""Shared physical spacing derived from the active writing-column width."""
from __future__ import annotations

import math


def gap_for_column(column_width: float) -> float:
    """Return the one default separation distance: exactly 10% of column width."""
    if (type(column_width) not in (int, float) or
            not math.isfinite(column_width) or column_width <= 0):
        raise ValueError('Column width must be a positive finite number')
    return float(column_width) / 10.0
