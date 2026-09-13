const { getDb } = require("./db");

function clean(doc) {
  if (!doc) return null;
  const item = { ...doc };
  delete item._id;
  return item;
}

function collections() {
  const db = getDb();
  return {
    earnings: db.collection("earnings"),
    expenses: db.collection("expenses"),
    settings: db.collection("settings"),
  };
}

async function getData() {
  const { earnings, expenses, settings } = collections();
  const [pay, costs, current] = await Promise.all([
    earnings.find().sort({ date: -1 }).toArray(),
    expenses.find().sort({ date: -1 }).toArray(),
    settings.findOne({ id: "default" }),
  ]);
  return {
    earnings: pay.map(clean),
    expenses: costs.map(clean),
    settings: clean(current) || {
      id: "default",
      currency: "$",
      workDaysPerWeek: 6,
    },
  };
}

async function createEarning(item) {
  await collections().earnings.insertOne({
    id: item.id,
    date: item.date,
    amount: Number(item.amount),
    note: item.note || "",
  });
}

async function deleteEarning(id) {
  await collections().earnings.deleteOne({ id });
}

async function createExpense(item) {
  await collections().expenses.insertOne({
    id: item.id,
    date: item.date,
    amount: Number(item.amount),
    category: item.category || "Other",
    note: item.note || "",
  });
}

async function deleteExpense(id) {
  await collections().expenses.deleteOne({ id });
}

async function saveSettings(item) {
  const payload = {
    id: "default",
    currency: (item.currency || "$").trim() || "$",
    workDaysPerWeek: Number(item.workDaysPerWeek || 6),
  };
  await collections().settings.updateOne({ id: "default" }, { $set: payload }, { upsert: true });
  return payload;
}

async function importData(data) {
  const { earnings, expenses, settings } = collections();
  if (Array.isArray(data.earnings) && data.earnings.length) {
    await earnings.deleteMany({});
    await earnings.insertMany(
      data.earnings.map((item) => ({
        id: item.id,
        date: item.date,
        amount: Number(item.amount),
        note: item.note || "",
      })),
    );
  }
  if (Array.isArray(data.expenses) && data.expenses.length) {
    await expenses.deleteMany({});
    await expenses.insertMany(
      data.expenses.map((item) => ({
        id: item.id,
        date: item.date,
        amount: Number(item.amount),
        category: item.category || "Other",
        note: item.note || "",
      })),
    );
  }
  if (data.settings) {
    await saveSettings(data.settings);
  }
}

module.exports = {
  getData,
  createEarning,
  deleteEarning,
  createExpense,
  deleteExpense,
  saveSettings,
  importData,
};
