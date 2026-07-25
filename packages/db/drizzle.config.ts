import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: "../../apps/web/.env" });

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Migração roda como DONO do schema. A aplicação usa DATABASE_URL, que
    // aponta para um papel sem superusuário e sem BYPASSRLS — é o que faz a
    // RLS valer de verdade em runtime.
    url: process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL || "",
  },
});
