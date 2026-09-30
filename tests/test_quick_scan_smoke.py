"""Smoke test for StockPickerAgent.quick_scan (live yfinance, small universe)."""
import os
import sys

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from tradingagents.command_center.stock_picker_agent import StockPickerAgent


@pytest.mark.integration
def test_quick_scan_small():
    """Run quick_scan on a 3-ticker universe; assert we get candidates back."""
    sp = StockPickerAgent()
    candidates = sp.quick_scan(
        universe=["AAPL", "MSFT", "NVDA"],
        min_volume=1e6,
        min_price=5.0,
        max_pe=100.0,  # loose so at least one passes
        top_n=3,
    )
    print(f"\nQuick-scan candidates ({len(candidates)}):")
    for c in candidates:
        print(f"  {c.ticker}: price={c.price}, 5d={c.change_pct:+.1f}%, "
              f"vol={c.volume}, P/E={c.pe_ratio}, score={c.score:.1f}")

    # With loose filters on mega-caps, we expect at least one candidate
    assert len(candidates) >= 1, "Expected at least one candidate from mega-cap universe"
    # All returned candidates should be in our universe
    assert all(c.ticker in {"AAPL", "MSFT", "NVDA"} for c in candidates)
    # Sorted by score desc
    scores = [c.score for c in candidates]
    assert scores == sorted(scores, reverse=True), "Candidates must be sorted by score desc"
    print("quick_scan smoke test passed")


if __name__ == "__main__":
    test_quick_scan_small()
    print("ALL TESTS PASSED")
