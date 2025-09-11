import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {GoogleAuth} from "google-auth-library";

// Partner Time Series API audience (prod)
const PARTNER_AUDIENCE =
  "https://partnertimeseriesv2-lsluydmucq-uc.a.run.app";

// Service account email for rel-str prod (split to satisfy max-len)
const SA_EMAIL =
  "rel-str-partner-caller-prod@" + "rel-str.iam.gserviceaccount.com";

/**
 * HTTPS function: partnerProxyTest
 * Calls savant Partner Time Series API using OIDC from the rel-str
 * service account. Returns the proxied payload for diagnostics.
 * Query params: symbol (default AAPL), interval (default DAILY),
 * range (default 1y)
 */
export const partnerProxyTest = onRequest(
  {
    region: "us-central1",
    serviceAccount: SA_EMAIL,
    timeoutSeconds: 60,
  },
  async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "AAPL";
      const interval = (req.query.interval as string) || "DAILY";
      const range = (req.query.range as string) || "1y";

      const auth = new GoogleAuth({
        scopes: "https://www.googleapis.com/auth/cloud-platform",
      });
      const client = await auth.getIdTokenClient(PARTNER_AUDIENCE);

      const params = new URLSearchParams({symbol, interval, range});
      const url = `${PARTNER_AUDIENCE}?${params.toString()}`;
      const resp = await client.request({url, method: "GET"});

      res.status(200).json(resp.data);
    } catch (err: unknown) {
      const e = err as {message?: string; code?: string; stack?: string};
      logger.error("partnerProxyTest error", {
        message: e?.message,
        code: e?.code,
        stack: e?.stack,
      });
      res.status(500).json({
        ok: false,
        error: "partnerProxyTest_failed",
        message: e?.message || "Unknown error",
      });
    }
  }
);
