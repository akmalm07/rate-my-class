import express from "express";
import { database } from "./database.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/ready", async (_request, response) => {
  if (!database) {
    response.status(503).json({ database: "unconfigured" });
    return;
  }

  try {
    await database.authenticate();
    response.json({ database: "connected" });
  } catch {
    response.status(503).json({ database: "unavailable" });
  }
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
