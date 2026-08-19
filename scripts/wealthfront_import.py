#!/usr/bin/env python3
"""
Wealthfront QFX → CSV converter + TradingAgents PortfolioStore importer.

Usage:
    # Convert QFX to CSV
    python scripts/wealthfront_import.py convert ~/Downloads/wealthfront.qfx --output ~/wealthfront_positions.csv

    # Import CSV into TradingAgents portfolio + watchlist
    python scripts/wealthfront_import.py import ~/wealthfront_positions.csv

    # One-liner: convert + import
    python scripts/wealthfront_import.py convert-import ~/Downloads/wealthfront.qfx

    # Extract transactions to CSV
    python scripts/wealthfront_import.py transactions ~/Downloads/wealthfront.qfx --output ~/wf_transactions.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Optional

try:
    from ofxparse import OfxParser
except ImportError:
    print("Error: ofxparse not installed. Run: pip install ofxparse", file=sys.stderr)
    sys.exit(1)


@dataclass
class Position:
    symbol: str
    name: str
    quantity: float
    unit_price: Optional[float]
    market_value: Optional[float]
    currency: str = "USD"


@dataclass
class Transaction:
    date: str  # YYYY-MM-DD
    symbol: str
    name: str
    type: str  # BUY, SELL, DIV, REINVEST, SPLIT, etc.
    units: float
    unit_price: Optional[float]
    total: Optional[float]
    commission: Optional[float]
    memo: str


def parse_qfx(qfx_path: Path) -> tuple[list[Position], dict]:
    """Parse Wealthfront QFX file.

    Returns (positions, summary) where summary holds account-level info.
    QFX positions carry a security uniqueid (usually CUSIP); the <SECLIST>
    section maps that to a ticker symbol + name, which we resolve here.
    """
    with open(qfx_path, "rb") as f:
        ofx = OfxParser.parse(f)

    # Build uniqueid -> (ticker, name) map from the security list.
    sec_map: dict[str, tuple[str, str]] = {}
    for sec in ofx.security_list or []:
        ticker = (sec.ticker or sec.uniqueid).upper()
        name = sec.name or ticker
        sec_map[sec.uniqueid] = (ticker, name)

    positions: list[Position] = []
    total_nav = Decimal("0")
    total_cash = Decimal("0")

    for account in ofx.accounts:
        stmt = account.statement
        if stmt is None:
            continue
        total_cash += Decimal(getattr(stmt, "available_cash", 0) or 0)

        for pos in stmt.positions:
            uniqueid = pos.security
            ticker, name = sec_map.get(uniqueid, (uniqueid.upper(), uniqueid.upper()))
            units = pos.units or 0
            unit_price = pos.unit_price or 0
            market_value = pos.market_value or 0
            total_nav += Decimal(market_value)

            if units > 0:
                positions.append(Position(
                    symbol=ticker,
                    name=name,
                    quantity=float(units),
                    unit_price=float(unit_price) if unit_price else None,
                    market_value=float(market_value) if market_value else None,
                ))

    summary = {
        "nav": float(total_nav),
        "cash": float(total_cash),
        "accounts": len(ofx.accounts),
        "positions": len(positions),
    }
    return positions, summary


def parse_transactions(qfx_path: Path) -> list[Transaction]:
    """Parse transaction history from QFX file."""
    with open(qfx_path, "rb") as f:
        ofx = OfxParser.parse(f)

    # Build uniqueid -> (ticker, name) map from the security list.
    sec_map: dict[str, tuple[str, str]] = {}
    for sec in ofx.security_list or []:
        ticker = (sec.ticker or sec.uniqueid).upper()
        name = sec.name or ticker
        sec_map[sec.uniqueid] = (ticker, name)

    transactions: list[Transaction] = []

    for account in ofx.accounts:
        stmt = account.statement
        if stmt is None:
            continue

        for txn in stmt.transactions:
            # Transaction type is in the XML tag name (e.g., 'buy', 'sell', 'div', 'reinvest', etc.)
            # ofxparse stores it in txn.type or infers from the tag
            txn_type = getattr(txn, "type", None)
            if txn_type is None:
                # Try to infer from class name or other attributes
                txn_type = txn.__class__.__name__.replace("Transaction", "").upper()

            uniqueid = getattr(txn, "security", "")
            ticker, name = sec_map.get(uniqueid, (uniqueid.upper(), uniqueid.upper()))

            units = getattr(txn, "units", 0) or 0
            unit_price = getattr(txn, "unit_price", None)
            total = getattr(txn, "total", None)
            commission = getattr(txn, "commission", None)
            memo = getattr(txn, "memo", "") or ""

            # Parse date
            txn_date = getattr(txn, "date", None)
            if txn_date:
                date_str = txn_date.strftime("%Y-%m-%d")
            else:
                date_str = ""

            transactions.append(Transaction(
                date=date_str,
                symbol=ticker,
                name=name,
                type=txn_type,
                units=float(units) if units else 0.0,
                unit_price=float(unit_price) if unit_price else None,
                total=float(total) if total else None,
                commission=float(commission) if commission else None,
                memo=memo,
            ))

    return transactions


def write_csv(positions: list[Position], output_path: Path) -> None:
    """Write positions to CSV with TradingAgents-friendly columns."""
    fieldnames = ["symbol", "name", "quantity", "unit_price", "market_value", "currency"]
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for pos in sorted(positions, key=lambda p: p.market_value or 0, reverse=True):
            writer.writerow({
                "symbol": pos.symbol,
                "name": pos.name,
                "quantity": pos.quantity,
                "unit_price": pos.unit_price if pos.unit_price is not None else "",
                "market_value": pos.market_value if pos.market_value is not None else "",
                "currency": pos.currency,
            })
    print(f"Wrote {len(positions)} positions to {output_path}")


def write_transactions_csv(transactions: list[Transaction], output_path: Path) -> None:
    """Write transactions to CSV."""
    fieldnames = ["date", "symbol", "name", "type", "units", "unit_price", "total", "commission", "memo"]
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for txn in sorted(transactions, key=lambda t: t.date, reverse=True):
            writer.writerow({
                "date": txn.date,
                "symbol": txn.symbol,
                "name": txn.name,
                "type": txn.type,
                "units": txn.units,
                "unit_price": txn.unit_price if txn.unit_price is not None else "",
                "total": txn.total if txn.total is not None else "",
                "commission": txn.commission if txn.commission is not None else "",
                "memo": txn.memo,
            })
    print(f"Wrote {len(transactions)} transactions to {output_path}")


def import_to_portfolio_store(csv_path: Path) -> None:
    """Import positions CSV into TradingAgents PortfolioStore.

    Each position becomes a portfolio entry (ticker, shares, cost_basis) and
    is also added to the watchlist so the console surfaces it.
    """
    project_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(project_root))

    from tradingagents.command_center.portfolio_store import PortfolioStore

    store = PortfolioStore()
    existing = {p["ticker"].upper() for p in store.get_portfolio()}

    added, updated = 0, 0
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            symbol = (row.get("symbol") or "").upper().strip()
            if not symbol:
                continue
            try:
                shares = float(row.get("quantity") or 0)
            except ValueError:
                shares = 0.0
            try:
                cost_basis = float(row.get("unit_price") or 0)
            except ValueError:
                cost_basis = 0.0

            if symbol in existing:
                updated += 1
            else:
                added += 1
                existing.add(symbol)
            store.add_position(symbol, shares=shares, cost_basis=cost_basis)
            store.add_to_watchlist(symbol)

    portfolio = store.get_portfolio()
    print(f"Portfolio: {added} added, {updated} updated (total {len(portfolio)} positions)")
    print("Tickers:", ", ".join(sorted(p["ticker"] for p in portfolio)))


def build_scorecard(qfx_path: Path, config: dict | None = None) -> list[dict]:
    """Build a scorecard comparing Wealthfront trades to AI ratings on trade dates.

    Returns list of dicts for the UI scorecard.
    """
    project_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(project_root))

    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.agents.utils.memory import TradingMemoryLog

    cfg = config or DEFAULT_CONFIG
    memory = TradingMemoryLog(cfg)

    # Parse transactions
    transactions = parse_transactions(qfx_path)

    # Filter to "AI-relevant" trades: buys/sells with units > 0, skip pure dividend reinvests
    # and zero-unit transactions
    relevant = []
    for txn in transactions:
        if txn.type.upper() in ("BUY", "SELL") and txn.units > 0:
            relevant.append(txn)

    # Get all memory entries for quick lookup
    all_entries = memory.load_entries()
    by_ticker_date: dict[tuple[str, str], dict] = {}
    for e in all_entries:
        key = (e.get("ticker", "").upper(), e.get("date", ""))
        if key not in by_ticker_date:
            by_ticker_date[key] = e

    scorecard = []
    for txn in relevant:
        symbol = txn.symbol
        trade_date = txn.date  # YYYY-MM-DD
        wf_action = "BUY" if txn.units > 0 and txn.type.upper() == "BUY" else "SELL"

        # Look up AI rating on the trade date (or closest prior)
        entry = by_ticker_date.get((symbol.upper(), trade_date))
        if not entry:
            # Try to find closest prior entry for this ticker
            prior = [e for e in all_entries if e.get("ticker", "").upper() == symbol.upper()
                     and e.get("date", "") <= trade_date]
            if prior:
                prior.sort(key=lambda e: e.get("date", ""), reverse=True)
                entry = prior[0]

        ai_rating = entry.get("rating", "Hold") if entry else "No run"
        ai_date = entry.get("date", "") if entry else ""
        ai_note = entry.get("reflection", "")[:200] if entry else ""

        # Determine agreement
        agreement = "N/A"
        if wf_action == "BUY" and ai_rating in ("Buy", "Overweight", "Strong Buy"):
            agreement = "✅ Agree"
        elif wf_action == "SELL" and ai_rating in ("Sell", "Underweight", "Strong Sell"):
            agreement = "✅ Agree"
        elif wf_action == "BUY" and ai_rating in ("Sell", "Underweight", "Strong Sell"):
            agreement = "❌ Disagree"
        elif wf_action == "SELL" and ai_rating in ("Buy", "Overweight", "Strong Buy"):
            agreement = "❌ Disagree"
        elif ai_rating == "No run":
            agreement = "⚪ No AI run"
        else:
            agreement = "➖ Neutral"

        scorecard.append({
            "date": trade_date,
            "symbol": symbol,
            "name": txn.name,
            "wf_action": wf_action,
            "wf_units": txn.units,
            "wf_price": txn.unit_price,
            "wf_total": txn.total,
            "ai_rating": ai_rating,
            "ai_date": ai_date,
            "ai_note": ai_note,
            "agreement": agreement,
        })

    return scorecard


def write_scorecard_csv(scorecard: list[dict], output_path: Path) -> None:
    """Write scorecard to CSV."""
    fieldnames = ["date", "symbol", "name", "wf_action", "wf_units", "wf_price",
                  "wf_total", "ai_rating", "ai_date", "agreement", "ai_note"]
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in scorecard:
            writer.writerow(row)
    print(f"Wrote {len(scorecard)} scorecard rows to {output_path}")


def import_to_portfolio_store(csv_path: Path) -> None:
    """Import positions CSV into TradingAgents PortfolioStore.

    Each position becomes a portfolio entry (ticker, shares, cost_basis) and
    is also added to the watchlist so the console surfaces it.
    """
    project_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(project_root))

    from tradingagents.command_center.portfolio_store import PortfolioStore

    store = PortfolioStore()
    existing = {p["ticker"].upper() for p in store.get_portfolio()}

    added, updated = 0, 0
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            symbol = (row.get("symbol") or "").upper().strip()
            if not symbol:
                continue
            try:
                shares = float(row.get("quantity") or 0)
            except ValueError:
                shares = 0.0
            try:
                cost_basis = float(row.get("unit_price") or 0)
            except ValueError:
                cost_basis = 0.0

            if symbol in existing:
                updated += 1
            else:
                added += 1
                existing.add(symbol)
            store.add_position(symbol, shares=shares, cost_basis=cost_basis)
            store.add_to_watchlist(symbol)

    portfolio = store.get_portfolio()
    print(f"Portfolio: {added} added, {updated} updated (total {len(portfolio)} positions)")
    print("Tickers:", ", ".join(sorted(p["ticker"] for p in portfolio)))


def main():
    parser = argparse.ArgumentParser(description="Wealthfront QFX converter + importer")
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_convert = subparsers.add_parser("convert", help="Convert QFX to CSV")
    p_convert.add_argument("qfx_file", type=Path, help="Path to Wealthfront QFX file")
    p_convert.add_argument("--output", "-o", type=Path, help="Output CSV path (default: <qfx_stem>.csv)")

    p_import = subparsers.add_parser("import", help="Import CSV into PortfolioStore")
    p_import.add_argument("csv_file", type=Path, help="Path to positions CSV")

    p_both = subparsers.add_parser("convert-import", help="Convert QFX to CSV and import")
    p_both.add_argument("qfx_file", type=Path, help="Path to Wealthfront QFX file")
    p_both.add_argument("--output", "-o", type=Path, help="Output CSV path (default: <qfx_stem>.csv)")

    p_transactions = subparsers.add_parser("transactions", help="Extract transactions to CSV")
    p_transactions.add_argument("qfx_file", type=Path, help="Path to Wealthfront QFX file")
    p_transactions.add_argument("--output", "-o", type=Path, help="Output CSV path (default: <qfx_stem>_transactions.csv)")

    p_scorecard = subparsers.add_parser("scorecard", help="Build AI vs Wealthfront scorecard")
    p_scorecard.add_argument("qfx_file", type=Path, help="Path to Wealthfront QFX file")
    p_scorecard.add_argument("--output", "-o", type=Path, help="Output CSV path (default: <qfx_stem>_scorecard.csv)")

    args = parser.parse_args()

    if args.command in ("convert", "convert-import"):
        qfx_path = args.qfx_file
        if not qfx_path.exists():
            print(f"Error: {qfx_path} not found", file=sys.stderr)
            sys.exit(1)
        output = args.output or qfx_path.with_suffix(".csv")
        positions, summary = parse_qfx(qfx_path)
        print(f"Account summary: NAV=${summary['nav']:,.2f} cash=${summary['cash']:,.2f} "
              f"({summary['positions']} positions across {summary['accounts']} account(s))")
        if not positions:
            print("Warning: No positions found in QFX", file=sys.stderr)
            sys.exit(1)
        write_csv(positions, output)

        if args.command == "convert-import":
            import_to_portfolio_store(output)

    elif args.command == "import":
        csv_path = args.csv_file
        if not csv_path.exists():
            print(f"Error: {csv_path} not found", file=sys.stderr)
            sys.exit(1)
        import_to_portfolio_store(csv_path)

    elif args.command == "transactions":
        qfx_path = args.qfx_file
        if not qfx_path.exists():
            print(f"Error: {qfx_path} not found", file=sys.stderr)
            sys.exit(1)
        output = args.output or qfx_path.with_name(qfx_path.stem + "_transactions.csv")
        transactions = parse_transactions(qfx_path)
        if not transactions:
            print("Warning: No transactions found in QFX", file=sys.stderr)
            sys.exit(1)
        write_transactions_csv(transactions, output)

    elif args.command == "scorecard":
        qfx_path = args.qfx_file
        if not qfx_path.exists():
            print(f"Error: {qfx_path} not found", file=sys.stderr)
            sys.exit(1)
        output = args.output or qfx_path.with_name(qfx_path.stem + "_scorecard.csv")
        scorecard = build_scorecard(qfx_path)
        if not scorecard:
            print("Warning: No relevant trades found for scorecard", file=sys.stderr)
            sys.exit(1)
        write_scorecard_csv(scorecard, output)


if __name__ == "__main__":
    main()