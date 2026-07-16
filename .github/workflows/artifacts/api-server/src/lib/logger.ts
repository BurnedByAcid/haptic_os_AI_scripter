import pino from "pino";
import pinoP from "pino-pretty";

const isProduction = process.env.NODE_ENV === "production";

const opts = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
};

export const logger = isProduction
  ? pino(opts)
  : pino(opts, pinoP({ colorize: true }));
