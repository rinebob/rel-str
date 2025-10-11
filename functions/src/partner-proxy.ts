import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {GoogleAuth} from "google-auth-library";

// Partner Time Series API audience (prod) - can be overridden via env
export const PARTNER_AUDIENCE =
  process.env.PARTNER_AUDIENCE ||
  "https://partnertimeseriesv2-lsluydmucq-uc.a.run.app";

// Service account email for rel-str prod (split to satisfy max-len)
const SA_EMAIL =
  "rel-str-partner-caller-prod@" + "rel-str.iam.gserviceaccount.com";

/**
 * Create an ID token client for the Partner API audience.
 */
export async function getPartnerIdTokenClient() {
  // IMPORTANT: Do not pass OAuth scopes when requesting an ID token client.
  // Scopes + target_audience together cause: "invalid_request: cannot specify both scope and target audience in jwt."
  const auth = new GoogleAuth();
  return auth.getIdTokenClient(PARTNER_AUDIENCE);
}

export type PartnerInterval = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Call Savant Partner Time Series API.
 * Params mirror partner docs: symbol, interval, optional range/from/to/limit.
 */
export async function callPartnerTimeSeries(params: {
  symbol: string;
  interval: PartnerInterval;
  range?: string;
  from?: string | number;
  to?: string | number;
  limit?: string | number;
}) {
  const client = await getPartnerIdTokenClient();
  const search = new URLSearchParams();
  search.set("symbol", params.symbol);
  search.set("interval", params.interval);
  if (params.range) search.set("range", String(params.range));
  if (params.from !== undefined) search.set("from", String(params.from));
  if (params.to !== undefined) search.set("to", String(params.to));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const url = `${PARTNER_AUDIENCE}?${search.toString()}`;
  const resp = await client.request({url, method: "GET"});
  return resp.data as unknown;
}

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

      const data = await callPartnerTimeSeries({
        symbol,
        interval: interval as PartnerInterval,
        range,
      });
      logger.info("partnerProxyTest upstream success");

      res.status(200).json(data);
    } catch (err: unknown) {
      const anyErr = err as any;
      const upstreamStatus = anyErr?.response?.status as number | undefined;
      const upstreamData = anyErr?.response?.data as unknown;
      const e = err as {message?: string; code?: string; stack?: string};
      logger.error("partnerProxyTest error", {
        message: e?.message,
        code: e?.code,
        stack: e?.stack,
        upstreamStatus,
        upstreamDataSnippet:
          typeof upstreamData === "string" ? upstreamData.slice(0, 500) : upstreamData,
      });
      res.status(upstreamStatus || 500).json({
        ok: false,
        error: "partnerProxyTest_failed",
        message: e?.message || "Unknown error",
        upstreamStatus,
      });
    }
  }
);
