import "dotenv/config";
import { Sequelize } from "sequelize";

const databaseUrl = process.env.DATABASE_URL;

export const database = databaseUrl
  ? new Sequelize(databaseUrl, {
      dialect: "postgres",
      logging: false,
    })
  : undefined;
