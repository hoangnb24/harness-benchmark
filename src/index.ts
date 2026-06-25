// Bookmark Manager API — entrypoint
// See PRODUCT_SPEC.md for full requirements
// The agent will build this out across tasks T1-T6

import express from "express";
import Database from "better-sqlite3";

const app = express();
const PORT = 3000;
const db: Database.Database = new Database("data.db");

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
export { db };
