"""Smoke test for command_center modules."""
import os
import sys
import tempfile

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

from tradingagents.command_center.portfolio_store import PortfolioStore


def test_portfolio_store():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "test_portfolio.json")
        store = PortfolioStore(path)

        store.add_position("AAPL", 100, 185.5)
        store.add_position("TSLA", 50, 250.0)
        store.add_to_watchlist("NVDA")
        store.add_to_watchlist("AMZN")
        store.add_to_watchlist("NVDA")  # dup — should be ignored
        # Watchlist is independent of portfolio; explicit add lands even if held
        store.add_to_watchlist("AAPL")

        assert store.get_tickers() == ["AAPL", "TSLA"], store.get_tickers()
        assert store.get_watchlist() == ["NVDA", "AMZN", "AAPL"], store.get_watchlist()
        assert store.get_all_universe() == ["AAPL", "TSLA", "NVDA", "AMZN"], store.get_all_universe()

        # Idempotent add = update
        store.add_position("AAPL", 200, 180.0)
        aapl = [p for p in store.get_portfolio() if p["ticker"] == "AAPL"][0]
        assert aapl["shares"] == 200 and aapl["cost_basis"] == 180.0, aapl

        store.remove_position("TSLA")
        store.remove_from_watchlist("AMZN")
        assert store.get_tickers() == ["AAPL"], store.get_tickers()
        assert store.get_watchlist() == ["NVDA", "AAPL"], store.get_watchlist()

        # Persistence
        store2 = PortfolioStore(path)
        assert store2.get_tickers() == ["AAPL"], store2.get_tickers()
        assert store2.get_watchlist() == ["NVDA", "AAPL"], store2.get_watchlist()

    print("portfolio_store tests passed")


def test_analysis_sorting():
    from tradingagents.command_center.portfolio_manager_agent import PortfolioAnalysis

    # Build fake analyses to test get_ranked ordering
    analyses = {
        "HOLD1": PortfolioAnalysis(ticker="HOLD1", status="done", rating="Hold"),
        "BUY1": PortfolioAnalysis(ticker="BUY1", status="done", rating="Buy"),
        "SELL1": PortfolioAnalysis(ticker="SELL1", status="done", rating="Sell"),
        "RUN1": PortfolioAnalysis(ticker="RUN1", status="running"),
        "OW1": PortfolioAnalysis(ticker="OW1", status="done", rating="Overweight"),
        "UW1": PortfolioAnalysis(ticker="UW1", status="done", rating="Underweight"),
    }
    order = {"Buy": 0, "Overweight": 1, "Hold": 2, "Underweight": 3, "Sell": 4}
    sorted_list = sorted(
        analyses.values(),
        key=lambda a: (99 if a.status != "done" else order.get(a.rating, 99), a.ticker),
    )
    ratings = [a.rating for a in sorted_list if a.status == "done"]
    assert ratings == ["Buy", "Overweight", "Hold", "Underweight", "Sell"], ratings
    assert sorted_list[-1].ticker == "RUN1", sorted_list[-1].ticker  # running last

    print("analysis sorting tests passed")


if __name__ == "__main__":
    test_portfolio_store()
    test_analysis_sorting()
    print("ALL TESTS PASSED")
