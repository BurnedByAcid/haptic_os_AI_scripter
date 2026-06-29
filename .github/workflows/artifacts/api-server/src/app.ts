import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleBillingWebhook } from "./routes/billing";

const app: Express = express();

// Trust the Replit proxy so req.ip reflects the real client IP for rate limiting.
app.set("trust proxy", 1);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Stripe webhook must receive raw Buffer — register BEFORE express.json() ──
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    handleBillingWebhook(req, res).catch((err) => {
      logger.error({ err }, "Unhandled billing webhook error");
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    });
  }
);

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
  if (_res.headersSent) { next(err); return; }
  logger.error({ err }, "Unhandled server error");
  _res.status(500).json({ error: "Internal server error" });
});

export default app;
