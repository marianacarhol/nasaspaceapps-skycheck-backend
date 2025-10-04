import "dotenv/config";
import express from "express";
import morgan from "morgan";
import type { Express, Request, Response, NextFunction } from "express";

const app: Express = express();
const port = Number(process.env.PORT) || 3000;

app.use(morgan("dev"));

app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.send("Hello TypeScript + Morgan!");
});

app.listen(port, () => {
  console.log(`API lista en http://localhost:${port}`);
});
