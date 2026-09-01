
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "../apps/server/data/app.db");

const db = new Database(dbPath);
const users = db.prepare("SELECT * FROM users").all();
console.log("Users in DB:", users);
