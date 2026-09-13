import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from pymongo import MongoClient
from pymongo.errors import PyMongoError

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
ENV_PATH = ROOT / ".env"
load_dotenv(ENV_PATH)

app = Flask(__name__)
mongo = {"client": None, "db": None, "error": ""}


def local_only():
    return request.remote_addr in {"127.0.0.1", "::1"}


def db_name(client=None):
    configured = os.getenv("MONGODB_DB", "").strip()
    if configured:
        return configured
    if client is not None:
        try:
            default = client.get_default_database()
            if default is not None:
                return default.name
        except Exception:
            pass
    return "shop_ledger"


def connect(uri=None):
    uri = (uri or os.getenv("MONGODB_URI", "")).strip()
    if mongo["client"]:
        mongo["client"].close()
        mongo["client"] = None
        mongo["db"] = None
    if not uri:
        mongo["error"] = "MongoDB Atlas is not configured yet."
        return False
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=8000)
        client.admin.command("ping")
        mongo["client"] = client
        mongo["db"] = client[db_name(client)]
        mongo["error"] = ""
        mongo["db"].earnings.create_index("id", unique=True)
        mongo["db"].expenses.create_index("id", unique=True)
        return True
    except PyMongoError as exc:
        mongo["client"] = None
        mongo["db"] = None
        mongo["error"] = str(exc)
        return False


def require_db():
    if mongo["db"] is None and not connect():
        return None
    return mongo["db"]


def clean(doc):
    if not doc:
        return None
    item = dict(doc)
    item.pop("_id", None)
    return item


def write_env(uri, database):
    ENV_PATH.write_text(
        f"MONGODB_URI={uri}\nMONGODB_DB={database}\n",
        encoding="utf-8",
    )
    os.environ["MONGODB_URI"] = uri
    os.environ["MONGODB_DB"] = database


@app.get("/api/health")
def health():
    connected = mongo["db"] is not None or connect()
    return jsonify(
        {
            "connected": bool(connected),
            "database": db_name() if connected else "",
            "error": mongo["error"],
        }
    )


@app.post("/api/setup")
def setup():
    if not local_only():
        return jsonify({"error": "Setup can only run on this computer."}), 403
    data = request.get_json(silent=True) or {}
    uri = str(data.get("uri") or "").strip()
    database = str(data.get("database") or "shop_ledger").strip() or "shop_ledger"
    if not uri.startswith("mongodb"):
        return jsonify({"error": "Paste a MongoDB Atlas connection string."}), 400
    write_env(uri, database)
    if not connect(uri):
        return jsonify({"error": mongo["error"] or "Could not reach MongoDB Atlas."}), 400
    return jsonify({"ok": True, "database": database})


@app.get("/api/data")
def all_data():
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    settings = clean(database.settings.find_one({"id": "default"})) or {
        "id": "default",
        "currency": "$",
        "workDaysPerWeek": 6,
    }
    return jsonify(
        {
            "earnings": [clean(item) for item in database.earnings.find().sort("date", -1)],
            "expenses": [clean(item) for item in database.expenses.find().sort("date", -1)],
            "settings": settings,
        }
    )


@app.post("/api/earnings")
def create_earning():
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    item = request.get_json(silent=True) or {}
    database.earnings.insert_one(
        {
            "id": item["id"],
            "date": item["date"],
            "amount": float(item["amount"]),
            "note": item.get("note") or "",
        }
    )
    return jsonify({"ok": True}), 201


@app.delete("/api/earnings/<item_id>")
def delete_earning(item_id):
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    database.earnings.delete_one({"id": item_id})
    return jsonify({"ok": True})


@app.post("/api/expenses")
def create_expense():
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    item = request.get_json(silent=True) or {}
    database.expenses.insert_one(
        {
            "id": item["id"],
            "date": item["date"],
            "amount": float(item["amount"]),
            "category": item.get("category") or "Other",
            "note": item.get("note") or "",
        }
    )
    return jsonify({"ok": True}), 201


@app.delete("/api/expenses/<item_id>")
def delete_expense(item_id):
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    database.expenses.delete_one({"id": item_id})
    return jsonify({"ok": True})


@app.put("/api/settings")
def save_settings():
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    item = request.get_json(silent=True) or {}
    payload = {
        "id": "default",
        "currency": (item.get("currency") or "$").strip() or "$",
        "workDaysPerWeek": int(item.get("workDaysPerWeek") or 6),
    }
    database.settings.update_one({"id": "default"}, {"$set": payload}, upsert=True)
    return jsonify(payload)


@app.post("/api/import")
def import_data():
    database = require_db()
    if database is None:
        return jsonify({"error": mongo["error"]}), 503
    data = request.get_json(silent=True) or {}
    earnings = data.get("earnings") or []
    expenses = data.get("expenses") or []
    settings = data.get("settings") or {}
    if earnings:
        database.earnings.delete_many({})
        database.earnings.insert_many(
            [
                {
                    "id": item["id"],
                    "date": item["date"],
                    "amount": float(item["amount"]),
                    "note": item.get("note") or "",
                }
                for item in earnings
            ]
        )
    if expenses:
        database.expenses.delete_many({})
        database.expenses.insert_many(
            [
                {
                    "id": item["id"],
                    "date": item["date"],
                    "amount": float(item["amount"]),
                    "category": item.get("category") or "Other",
                    "note": item.get("note") or "",
                }
                for item in expenses
            ]
        )
    if settings:
        database.settings.update_one(
            {"id": "default"},
            {
                "$set": {
                    "id": "default",
                    "currency": settings.get("currency") or "$",
                    "workDaysPerWeek": int(settings.get("workDaysPerWeek") or 6),
                }
            },
            upsert=True,
        )
    return jsonify({"ok": True})


@app.get("/")
def home():
    return send_from_directory(PUBLIC, "index.html")


@app.get("/<path:name>")
def public_file(name):
    return send_from_directory(PUBLIC, name)


if __name__ == "__main__":
    connect()
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "4173")), debug=False)
