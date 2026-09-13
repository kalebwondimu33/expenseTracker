const { MongoClient } = require("mongodb");

let client;
let db;

function databaseName() {
  const configured = (process.env.MONGODB_DB || "").trim();
  if (configured) return configured;
  const uri = process.env.MONGODB_URI || "";
  const match = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  if (match && match[1]) return match[1];
  return "shop_ledger";
}

async function connectDb() {
  if (db) return db;
  const uri = (process.env.MONGODB_URI || "").trim();
  if (!uri) {
    const error = new Error("MongoDB Atlas is not configured yet.");
    error.status = 503;
    throw error;
  }
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  db = client.db(databaseName());
  await db.collection("earnings").createIndex({ id: 1 }, { unique: true });
  await db.collection("expenses").createIndex({ id: 1 }, { unique: true });
  return db;
}

function getDb() {
  return db;
}

module.exports = { connectDb, getDb, databaseName };
