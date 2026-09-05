import mongoose from "mongoose";
import dns from "dns";
import { env } from "./env";
import { logger } from "./logger";

// Set fallback public DNS servers to prevent Windows SRV lookup hangs on MongoDB Atlas
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch {
  // Ignore if custom DNS overrides are prohibited by system policy
}

let isConnected = false;

export function isDbConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function connectToDatabase(retries = 3, delayMs = 1000): Promise<void> {
  mongoose.set("bufferCommands", false);

  mongoose.connection.on("connected", () => {
    isConnected = true;
    logger.info({ uri: redactMongoUri(env.MONGO_URI) }, "MongoDB connected");
  });

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    logger.warn("MongoDB disconnected");
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "MongoDB connection error");
  });

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(env.MONGO_URI, {
        serverSelectionTimeoutMS: 4000,
      });
      return;
    } catch (err) {
      logger.warn({ attempt, retries }, "MongoDB connection attempt failed...");
      if (attempt === retries) {
        logger.error({ err }, "MongoDB connection failed after retries — check your MONGO_URI or local MongoDB status");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}

function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@]+@/, "//");
}
