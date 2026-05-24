// Bookmark Manager API — entrypoint
// See PRODUCT_SPEC.md for full requirements
// The agent will build this out across tasks T1-T6

import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// TODO: Implement endpoints per PRODUCT_SPEC.md

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
