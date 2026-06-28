// Bookmark Manager API — entrypoint
// See PRODUCT_SPEC.md for full requirements
// The agent will build this out across tasks T1-T6

import express from "express";
import { authRouter, authenticate } from "./auth";
import { bookmarksRouter } from "./bookmarks";
import { db } from "./database";
import { foldersRouter, sharedRouter } from "./folders";
import { portabilityRouter } from "./portability";
import { tagsRouter } from "./tags";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/bookmarks", authenticate, bookmarksRouter);
app.use("/folders", authenticate, foldersRouter);
app.use("/shared", authenticate, sharedRouter);
app.use("/tags", authenticate, tagsRouter);
app.use("/", authenticate, portabilityRouter);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
export { db };
