/**
 * Access to the live Mongoose connection from plain (non-Nest) modules.
 *
 * NestJS's MongooseModule uses `mongoose.createConnection()`, so the default
 * `mongoose.connection` singleton NEVER opens in this app (see the comment in
 * main.ts). Any module-level helper that reached for `mongoose.connection`
 * therefore saw `readyState === 0` forever, and code guarded on
 * "is Mongo connected?" silently skipped itself in production.
 *
 * main.ts registers the real connection here at bootstrap; helpers resolve
 * models and readiness through this module instead of the dead default.
 */

import mongoose, { Connection, Model } from "mongoose";
import logger from "./logger";

let appConnection: Connection | null = null;

/** Called once from main.ts with the connection Nest actually opened. */
export const setAppConnection = (connection: Connection): void => {
  appConnection = connection;
  logger.info(
    `[mongo-connection] Registered Nest connection (db: ${connection.db?.databaseName ?? "unknown"})`,
  );
};

/**
 * The live connection: the one Nest opened, or the default mongoose singleton
 * if something (a script, a test) connected that way instead.
 */
export const getAppConnection = (): Connection | null => {
  if (appConnection) return appConnection;
  return mongoose.connection?.readyState === 1 ? mongoose.connection : null;
};

/** True only when a connection is actually open and usable. */
export const isMongoReady = (): boolean => getAppConnection()?.readyState === 1;

/**
 * A model bound to the live connection.
 * Returns null rather than throwing so callers can degrade gracefully.
 */
export const getModelSafe = <T = any>(name: string): Model<T> | null => {
  const connection = getAppConnection();
  if (!connection) return null;
  try {
    return connection.model<T>(name) as Model<T>;
  } catch {
    logger.warn(`[mongo-connection] Model "${name}" is not registered on the connection`);
    return null;
  }
};
