import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        // Read through process.env rather than Prisma's env() helper. env() throws
        // when the variable is missing, and this file is loaded for every command
        // including `prisma generate`, which npm runs as postinstall on a build host
        // that has no DATABASE_URL yet and never connects to anything. generate only
        // needs the schema, so the URL is optional here; the commands that do need a
        // connection fail on their own with a clear message when it is absent.
        url: process.env.DATABASE_URL ?? "",
    },
});
