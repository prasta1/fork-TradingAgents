"""Cost basis rebuilt from statement trades (ui.server.holdings.average_cost)."""

import pytest

from ui.server.holdings import average_cost


def _t(date, type_, units, total, sym="ABC"):
    return {"date": date, "sym": sym, "type": type_, "units": units, "unit_price": 0, "total": total}


@pytest.mark.unit
def test_buys_and_a_sell_use_average_cost():
    txns = [
        _t("2025-01-02", "buystock", 10, -1000),  # 10 @ 100
        _t("2025-02-03", "buystock", 10, -2000),  # 10 @ 200 -> avg 150
        _t("2025-03-04", "sellstock", -5, 900),   # selling keeps the average
        _t("2025-03-05", "buystock", 1, -50, sym="XYZ"),  # other symbols ignored
    ]
    assert average_cost(txns, "ABC", 15) == 150.0


@pytest.mark.unit
def test_shares_bought_before_the_export_leave_basis_unknown():
    # Statement holds 20 but the file only shows 10 being bought.
    assert average_cost([_t("2025-01-02", "buystock", 10, -1000)], "ABC", 20) is None


@pytest.mark.unit
def test_transferred_in_shares_leave_basis_unknown():
    txns = [_t("2025-01-02", "buystock", 10, -1000), _t("2025-01-03", "transfer", 5, 0)]
    assert average_cost(txns, "ABC", 15) is None
