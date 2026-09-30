"""Live portfolio: every account, API-connected or statement-backed, in one view.

Two kinds of account feed this screen:

* **API accounts** — each connected brokerage (see :mod:`ui.server.brokers`).
  Positions, cost basis and activity come straight from the broker.
* **Statement accounts** — brokerages with no usable API (Wealthfront). Their
  Quicken export (QFX/OFX) supplies share counts and transaction history; cost
  basis is rebuilt from the trades in the file(s), and prices are live.

Drop newer exports into ``STATEMENTS_DIR`` whenever you want the share counts
refreshed; files for the same account are merged, newest positions winning.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from ofxparse import OfxParser

from . import history, market
from .brokers import BrokerError, BrokerRegistry

STATEMENTS_DIR = Path(os.getenv("STATEMENTS_DIR", "~/Downloads")).expanduser()

# OFX transaction type -> the action label every activity source uses.
_ACTIONS = {
    "buystock": "BUY",
    "buymf": "BUY",
    "buyother": "BUY",
    "sellstock": "SELL",
    "sellmf": "SELL",
    "sellother": "SELL",
    "reinvest": "REINVEST",
    "income": "DIVIDEND",
    "transfer": "TRANSFER",
    "split": "SPLIT",
    "retofcap": "RETURN OF CAPITAL",
}
# Share counts this far apart mean the files do not cover the whole holding.
_UNIT_TOLERANCE = 0.001


def statement_files() -> list[Path]:
    """QFX/OFX exports in ``STATEMENTS_DIR``."""
    if not STATEMENTS_DIR.is_dir():
        return []
    return sorted(p for p in STATEMENTS_DIR.iterdir() if p.suffix.lower() in {".qfx", ".ofx"})


@lru_cache(maxsize=32)
def _parse(path: str, mtime: float) -> list[dict]:
    """Accounts in one statement file. Cached per (path, mtime) — a 1MB QFX is slow to parse.

    Args:
        path: File to parse.
        mtime: Modification time; part of the cache key so a re-export is re-read.

    Returns:
        One dict per investment account: id, as_of, positions, transactions.
    """
    with open(path, "rb") as f:
        ofx = OfxParser.parse(f)
    securities = {}
    for s in ofx.security_list or []:
        ticker = (s.ticker or "").upper()
        # Some exports put the CUSIP where the ticker belongs.
        if (not ticker or ticker == s.uniqueid.upper()) and s.name:
            ticker = market.ticker_for_name(s.name) or s.uniqueid.upper()
        securities[s.uniqueid] = (ticker, s.name or ticker)
    accounts = []
    for account in ofx.accounts:
        stmt = account.statement
        if stmt is None or not hasattr(stmt, "positions"):
            continue  # a bank/credit account, not investments
        positions = []
        for pos in stmt.positions:
            sym, name = securities.get(pos.security, (pos.security, pos.security))
            positions.append(
                {"sym": sym, "name": name, "qty": float(pos.units), "price": float(pos.unit_price)}
            )
        transactions = []
        for txn in stmt.transactions:
            sym, name = securities.get(getattr(txn, "security", ""), ("", ""))
            # Cash rows (credit, fee) are plain OFX transactions with a `date`
            # instead of investment trade/settle dates.
            date = getattr(txn, "tradeDate", None) or getattr(txn, "settleDate", None) or getattr(txn, "date", None)
            transactions.append(
                {
                    "id": txn.id,
                    "date": date.strftime("%Y-%m-%d") if date else "",
                    "sym": sym,
                    "type": txn.type,
                    "income_type": getattr(txn, "income_type", "") or "",
                    "units": float(getattr(txn, "units", 0) or 0),
                    "unit_price": float(getattr(txn, "unit_price", 0) or 0),
                    "total": float(getattr(txn, "total", None) or getattr(txn, "amount", 0) or 0),
                    "memo": getattr(txn, "memo", "") or "",
                }
            )
        accounts.append(
            {
                "id": account.account_id,
                "as_of": stmt.end_date.strftime("%Y-%m-%d") if stmt.end_date else "",
                "positions": positions,
                "transactions": transactions,
                "file": Path(path).name,
            }
        )
    return accounts


def statement_accounts() -> tuple[list[dict], list[str]]:
    """Every statement account, with multiple exports of one account merged.

    Returns:
        ``(accounts, errors)`` — errors name files that could not be parsed.
    """
    merged: dict[str, dict] = {}
    errors = []
    for path in statement_files():
        try:
            parsed = _parse(str(path), path.stat().st_mtime)
        except Exception as exc:  # a malformed export should not blank the screen
            errors.append(f"{path.name}: {exc}")
            continue
        for acct in parsed:
            have = merged.get(acct["id"])
            if have is None:
                merged[acct["id"]] = {**acct, "transactions": list(acct["transactions"]), "files": [acct["file"]]}
                continue
            seen = {t["id"] for t in have["transactions"]}
            have["transactions"] += [t for t in acct["transactions"] if t["id"] not in seen]
            have["files"].append(acct["file"])
            if acct["as_of"] > have["as_of"]:  # newest export's share counts win
                have["positions"], have["as_of"] = acct["positions"], acct["as_of"]
    return list(merged.values()), errors


def average_cost(transactions: list[dict], symbol: str, held: float) -> float | None:
    """Average cost per share rebuilt from a statement's trades.

    Buys add their cash cost, sells remove cost pro rata (average-cost method).
    When the trades do not add up to the shares actually held — the position
    predates the export, or arrived by transfer — the basis is unknowable from
    these files and None is returned rather than a wrong number.

    Args:
        transactions: Statement transaction dicts (see :func:`_parse`).
        symbol: Ticker to rebuild.
        held: Shares the statement says are held.

    Returns:
        Average cost per share, or None when the history is incomplete.
    """
    units = cost = 0.0
    for t in sorted((t for t in transactions if t["sym"] == symbol), key=lambda t: t["date"]):
        action = _ACTIONS.get(t["type"])
        if action in ("BUY", "REINVEST"):
            units += abs(t["units"])
            cost += abs(t["total"]) or abs(t["units"]) * t["unit_price"]
        elif action == "SELL" and units:
            sold = min(abs(t["units"]), units)
            cost -= cost * sold / units
            units -= sold
        elif action in ("TRANSFER", "SPLIT"):
            return None  # shares whose cost the file does not state
    if held <= 0 or abs(units - held) > max(_UNIT_TOLERANCE, held * _UNIT_TOLERANCE):
        return None
    return round(cost / units, 4)


def _api_accounts(brokers: BrokerRegistry) -> list[dict]:
    out = []
    for status in brokers.status():
        if not status["connected"]:
            continue
        broker = brokers.get(status["name"])
        try:
            data = broker.portfolio()
        except BrokerError as exc:
            out.append({"key": broker.name, "label": broker.label, "source": "api", "error": str(exc), "positions": []})
            continue
        out.append(
            {
                "key": broker.name,
                "label": broker.label,
                "source": "api",
                "as_of": "live",
                "cash": data.get("cash"),
                "positions": data["positions"],
            }
        )
    return out


def portfolio(brokers: BrokerRegistry) -> dict:
    """Every holding in every account, live-priced and joined to agent ratings.

    Args:
        brokers: The console's broker registry; every connected one is read.

    Returns:
        ``accounts`` (per-account totals), ``holdings`` (one row per account and
        symbol), ``totals`` and any ``errors`` worth surfacing.
    """
    accounts = _api_accounts(brokers)
    statements, errors = statement_accounts()

    prices = market.last_prices(
        tuple(sorted({p["sym"] for a in statements for p in a["positions"] if p["qty"]}))
    )
    for acct in statements:
        positions = []
        for p in acct["positions"]:
            if not p["qty"]:
                continue
            live = prices.get(p["sym"])
            price = live if live is not None else p["price"]
            cost = average_cost(acct["transactions"], p["sym"], p["qty"])
            value = round(price * p["qty"], 2)
            pl = round(value - cost * p["qty"], 2) if cost is not None else None
            positions.append(
                {
                    "sym": p["sym"],
                    "name": p["name"],
                    "qty": p["qty"],
                    "cost": cost,
                    "price": price,
                    # A price from the statement is stale; say so rather than pass it off as live.
                    "price_as_of": "live" if live is not None else acct["as_of"],
                    "value": value,
                    "pl": pl,
                    "pl_pct": round(pl / (cost * p["qty"]) * 100, 2) if pl is not None and cost else None,
                }
            )
        accounts.append(
            {
                "key": f"stmt:{acct['id']}",
                "label": f"Account ···{acct['id'][-4:]}",
                "source": "statement",
                "as_of": acct["as_of"],
                "files": acct["files"],
                "cash": None,
                "positions": positions,
            }
        )

    ratings = history.latest_by_ticker()
    holdings = []
    for acct in accounts:
        acct["value"] = round(sum(p["value"] or 0 for p in acct["positions"]) + (acct.get("cash") or 0), 2)
        for p in acct["positions"]:
            rating = ratings.get(p["sym"])
            holdings.append(
                {
                    **p,
                    "price_as_of": p.get("price_as_of", "live"),
                    "account": acct["key"],
                    "account_label": acct["label"],
                    "rating": rating["rating"] if rating else None,
                    "rated_on": rating["date"] if rating else None,
                }
            )
        del acct["positions"]

    holdings.sort(key=lambda h: h["value"] or 0, reverse=True)
    known_pl = [h for h in holdings if h["pl"] is not None]
    return {
        "accounts": accounts,
        "holdings": holdings,
        "totals": {
            "value": round(sum(a["value"] for a in accounts), 2),
            "pl": round(sum(h["pl"] for h in known_pl), 2),
            "pl_positions": len(known_pl),
            "positions": len(holdings),
        },
        "statements_dir": str(STATEMENTS_DIR),
        "errors": errors,
    }


def activity(brokers: BrokerRegistry, symbol: str) -> dict:
    """Every recorded transaction in ``symbol`` across all accounts, newest first.

    Args:
        brokers: The console's broker registry; every connected one is read.
        symbol: Ticker to filter to.

    Returns:
        ``rows`` (normalised transactions tagged with their account) and
        ``errors`` for brokers whose history could not be fetched.
    """
    symbol = symbol.upper()
    rows, errors = [], []
    for status in brokers.status():
        if not status["connected"]:
            continue
        broker = brokers.get(status["name"])
        try:
            rows += [{**r, "account_label": broker.label} for r in broker.activity() if r["symbol"] == symbol]
        except BrokerError as exc:
            errors.append(f"{broker.label}: {exc}")

    statements, _ = statement_accounts()
    for acct in statements:
        for t in acct["transactions"]:
            if t["sym"] != symbol:
                continue
            action = _ACTIONS.get(t["type"], t["type"].upper())
            if action == "DIVIDEND" and t["income_type"] and t["income_type"] != "DIV":
                action = t["income_type"]  # CGLONG, CGSHORT, INTEREST…
            rows.append(
                {
                    "date": t["date"],
                    "symbol": symbol,
                    "action": action,
                    "qty": abs(t["units"]) or None,
                    "price": t["unit_price"] or None,
                    "amount": t["total"],
                    "description": t["memo"],
                    "account_label": f"Account ···{acct['id'][-4:]}",
                }
            )
    rows.sort(key=lambda r: r["date"], reverse=True)
    return {"rows": rows, "errors": errors}
