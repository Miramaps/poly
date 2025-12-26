#!/usr/bin/env python3
"""
Polymarket Order Executor
Handles EIP-712 signing and order placement for live trading.
Called by the C++ trading engine.
"""

import os
import sys
import json
import time
import argparse
from decimal import Decimal

try:
    from py_clob_client.client import ClobClient
    from py_clob_client.clob_types import OrderArgs, OrderType, ApiCreds
    from py_clob_client.order_builder.constants import BUY, SELL
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "py-clob-client not installed. Run: pip install py-clob-client"
    }))
    sys.exit(1)

# Polymarket endpoints
CLOB_HOST = "https://clob.polymarket.com"
CHAIN_ID = 137  # Polygon mainnet


def get_client() -> ClobClient:
    """Initialize the CLOB client with credentials from environment."""
    private_key = os.environ.get("POLYMARKET_PRIVATE_KEY")
    api_key = os.environ.get("POLYMARKET_API_KEY")
    api_secret = os.environ.get("POLYMARKET_SECRET")
    api_passphrase = os.environ.get("POLYMARKET_PASSPHRASE")
    
    if not private_key:
        raise ValueError("POLYMARKET_PRIVATE_KEY environment variable not set")
    
    # Clean up private key format
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key
    
    # Create client with or without API credentials
    if api_key and api_secret and api_passphrase:
        creds = ApiCreds(
            api_key=api_key,
            api_secret=api_secret,
            api_passphrase=api_passphrase
        )
        client = ClobClient(
            host=CLOB_HOST,
            key=private_key,
            chain_id=CHAIN_ID,
            creds=creds
        )
    else:
        client = ClobClient(
            host=CLOB_HOST,
            key=private_key,
            chain_id=CHAIN_ID
        )
    
    return client


def place_order(token_id: str, side: str, size: float, price: float) -> dict:
    """
    Place an order on Polymarket.
    
    Args:
        token_id: The token ID to trade
        side: "BUY" or "SELL"
        size: Number of shares
        price: Price per share (0.01 to 0.99)
        
    Returns:
        dict with success status, order_id, and fill details
    """
    try:
        client = get_client()
        
        # Convert side string to constant
        order_side = BUY if side.upper() == "BUY" else SELL
        
        # Create order arguments
        order_args = OrderArgs(
            price=price,
            size=size,
            side=order_side,
            token_id=token_id,
        )
        
        # Create and sign the order
        signed_order = client.create_order(order_args)
        
        # Post the order (GTC = Good Till Cancelled)
        response = client.post_order(signed_order, OrderType.GTC)
        
        # Parse response
        if response and hasattr(response, 'orderID'):
            return {
                "success": True,
                "order_id": response.orderID,
                "status": "POSTED",
                "size": size,
                "price": price,
                "side": side
            }
        elif isinstance(response, dict):
            return {
                "success": True,
                "order_id": response.get("orderID", response.get("id", "unknown")),
                "status": response.get("status", "POSTED"),
                "size": size,
                "price": price,
                "side": side
            }
        else:
            return {
                "success": True,
                "order_id": str(response),
                "status": "POSTED",
                "size": size,
                "price": price,
                "side": side
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


def place_market_order(token_id: str, side: str, size: float) -> dict:
    """
    Place a market order (FOK - Fill or Kill) on Polymarket.
    This tries to fill immediately at the best available price.
    
    Args:
        token_id: The token ID to trade
        side: "BUY" or "SELL"
        size: Number of shares
        
    Returns:
        dict with success status, order_id, and fill details
    """
    try:
        client = get_client()
        
        # Get current orderbook to find best price
        orderbook = client.get_order_book(token_id)
        
        order_side = BUY if side.upper() == "BUY" else SELL
        
        # Determine price based on side
        if order_side == BUY:
            # For buying, we need to match the best ask (lowest sell price)
            if not orderbook.asks:
                return {"success": False, "error": "No asks available"}
            best_ask = float(orderbook.asks[0].price)
            price = best_ask
        else:
            # For selling, we need to match the best bid (highest buy price)
            if not orderbook.bids:
                return {"success": False, "error": "No bids available"}
            best_bid = float(orderbook.bids[0].price)
            price = best_bid
        
        # Create order arguments
        order_args = OrderArgs(
            price=price,
            size=size,
            side=order_side,
            token_id=token_id,
        )
        
        # Create and sign the order
        signed_order = client.create_order(order_args)
        
        # Post as FOK (Fill or Kill) for immediate execution
        response = client.post_order(signed_order, OrderType.FOK)
        
        if response and hasattr(response, 'orderID'):
            return {
                "success": True,
                "order_id": response.orderID,
                "status": "FILLED",
                "size": size,
                "price": price,
                "side": side
            }
        elif isinstance(response, dict):
            return {
                "success": True,
                "order_id": response.get("orderID", response.get("id", "unknown")),
                "status": response.get("status", "FILLED"),
                "filled_size": response.get("filledSize", size),
                "price": price,
                "side": side
            }
        else:
            return {
                "success": True,
                "order_id": str(response),
                "status": "FILLED",
                "size": size,
                "price": price,
                "side": side
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


def get_balance() -> dict:
    """Get the current USDC balance from Polymarket."""
    try:
        client = get_client()
        
        # Get balance
        balance = client.get_balance()
        
        return {
            "success": True,
            "balance": float(balance) if balance else 0.0,
            "currency": "USDC"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "balance": 0.0
        }


def get_positions() -> dict:
    """Get current positions from Polymarket."""
    try:
        client = get_client()
        
        # Get positions
        positions = client.get_positions()
        
        position_list = []
        for pos in positions:
            position_list.append({
                "token_id": pos.token_id if hasattr(pos, 'token_id') else pos.get('token_id', ''),
                "size": float(pos.size) if hasattr(pos, 'size') else float(pos.get('size', 0)),
                "avg_price": float(pos.avgPrice) if hasattr(pos, 'avgPrice') else float(pos.get('avgPrice', 0))
            })
        
        return {
            "success": True,
            "positions": position_list
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "positions": []
        }


def cancel_order(order_id: str) -> dict:
    """Cancel an existing order."""
    try:
        client = get_client()
        
        response = client.cancel(order_id)
        
        return {
            "success": True,
            "cancelled": True,
            "order_id": order_id
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def cancel_all_orders() -> dict:
    """Cancel all open orders."""
    try:
        client = get_client()
        
        response = client.cancel_all()
        
        return {
            "success": True,
            "cancelled_all": True
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def derive_api_key() -> dict:
    """Derive API key from private key (first-time setup)."""
    try:
        client = get_client()
        
        # This derives a new API key
        api_creds = client.derive_api_key()
        
        return {
            "success": True,
            "api_key": api_creds.api_key,
            "api_secret": api_creds.api_secret,
            "api_passphrase": api_creds.api_passphrase,
            "message": "Save these credentials to your .env file!"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def main():
    parser = argparse.ArgumentParser(description="Polymarket Order Executor")
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")
    
    # Place order command
    place_parser = subparsers.add_parser("place", help="Place a limit order")
    place_parser.add_argument("--token", required=True, help="Token ID")
    place_parser.add_argument("--side", required=True, choices=["BUY", "SELL"], help="Order side")
    place_parser.add_argument("--size", type=float, required=True, help="Number of shares")
    place_parser.add_argument("--price", type=float, required=True, help="Price per share")
    
    # Market order command
    market_parser = subparsers.add_parser("market", help="Place a market order (FOK)")
    market_parser.add_argument("--token", required=True, help="Token ID")
    market_parser.add_argument("--side", required=True, choices=["BUY", "SELL"], help="Order side")
    market_parser.add_argument("--size", type=float, required=True, help="Number of shares")
    
    # Balance command
    subparsers.add_parser("balance", help="Get USDC balance")
    
    # Positions command
    subparsers.add_parser("positions", help="Get current positions")
    
    # Cancel order command
    cancel_parser = subparsers.add_parser("cancel", help="Cancel an order")
    cancel_parser.add_argument("--order-id", required=True, help="Order ID to cancel")
    
    # Cancel all command
    subparsers.add_parser("cancel-all", help="Cancel all open orders")
    
    # Derive API key command
    subparsers.add_parser("derive-key", help="Derive API key from private key")
    
    args = parser.parse_args()
    
    result = {}
    
    if args.command == "place":
        result = place_order(args.token, args.side, args.size, args.price)
    elif args.command == "market":
        result = place_market_order(args.token, args.side, args.size)
    elif args.command == "balance":
        result = get_balance()
    elif args.command == "positions":
        result = get_positions()
    elif args.command == "cancel":
        result = cancel_order(args.order_id)
    elif args.command == "cancel-all":
        result = cancel_all_orders()
    elif args.command == "derive-key":
        result = derive_api_key()
    else:
        result = {"success": False, "error": "Unknown command. Use --help for usage."}
    
    # Output as JSON for C++ to parse
    print(json.dumps(result))
    
    # Exit with appropriate code
    sys.exit(0 if result.get("success", False) else 1)


if __name__ == "__main__":
    main()

