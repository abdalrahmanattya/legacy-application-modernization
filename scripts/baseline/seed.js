const { openDatabase, seedProducts } = require("../../app/baseline/db");
const db = openDatabase();
seedProducts(db);
db.close();
console.log("seeded deterministic product catalog");
