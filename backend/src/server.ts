import express from "express";
import { createAdvisorRouter } from "./advisor/router.js";
import { createCunyCatalog, createCunyRouter } from "./cuny/router.js";
import { database } from "./database.js";
import { professorRouter } from "./professors/router.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());
const catalog = createCunyCatalog(database);
app.use("/api/cuny", createCunyRouter(database, undefined, catalog));
app.use("/api/advisor", createAdvisorRouter(database, catalog));
app.use("/api/professors", professorRouter);

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
