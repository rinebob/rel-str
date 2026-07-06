/**
 * RH Agent Trade Executor
 *
 * Cloud Callable function that executes trades via Robinhood MCP.
 * Auth is handled by the MCP session — no stored tokens required.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { RH_AGENT_ALLOWED_ORIGINS } from './rh-agent-cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const mcpServerUrlSecret = defineSecret('RH_AGENT_MCP_SERVER_URL');
const accountNumberSecret = defineSecret('RH_AGENT_ACCOUNT_NUMBER');

/**
 * Safely parse MCP text content as JSON. Returns null if the content is empty or
 * malformed so the caller can fail gracefully instead of throwing.
 */
function safeParseMcpJson(text: string): any | null {
  const trimmed = text.trim();
  if (!trimmed) {
    logger.warn('mcp_response_empty');
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error: any) {
    logger.warn('mcp_response_parse_failed', { error: error?.message, preview: trimmed.slice(0, 200) });
    return null;
  }
}

// Interface definitions
interface TradeRequest {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number; // Dollar amount
  orderType?: 'market' | 'limit';
  limitPrice?: number;
  dryRun?: boolean;
}

interface TradeResponse {
  success: boolean;
  orderId?: string;
  symbol: string;
  side: string;
  amount: number;
  state?: string;
  estimatedShares?: number;
  error?: string;
}

/**
 * Create MCP client connected to the RH Agentic API.
 */
async function createMCPClient(mcpServerUrl: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpServerUrl));

  const client = new Client(
    { name: 'rh-cloud-executor', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * Execute a trade via MCP
 */
async function executeTrade(
  client: Client,
  accountNumber: string,
  request: TradeRequest
): Promise<TradeResponse> {
  const { symbol, side, amount, orderType = 'market', limitPrice, dryRun = false } = request;

  try {
    // Step 1: Review the order (preview)
    logger.info('trade_review_start', { symbol, side, amount, orderType });

    const reviewResult = await client.callTool({
      name: 'review_equity_order',
      arguments: {
        account_number: accountNumber,
        symbol: symbol.toUpperCase(),
        side: side.toLowerCase(),
        type: orderType,
        dollar_amount: amount,
        limit_price: orderType === 'limit' ? limitPrice : undefined,
        time_in_force: 'gfd', // Good for day
      },
    });

    const reviewContent = (reviewResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text ?? '').join('');

    logger.info('trade_review_complete', { reviewContent: reviewContent.slice(0, 200) });

    // If dry run, stop here
    if (dryRun) {
      return {
        success: true,
        symbol,
        side,
        amount,
        state: 'DRY_RUN',
        error: undefined,
      };
    }

    // Step 2: Place the order
    logger.info('trade_place_start', { symbol, side, amount });

    const placeResult = await client.callTool({
      name: 'place_equity_order',
      arguments: {
        account_number: accountNumber,
        symbol: symbol.toUpperCase(),
        side: side.toLowerCase(),
        type: orderType,
        dollar_amount: amount,
        limit_price: orderType === 'limit' ? limitPrice : undefined,
        time_in_force: 'gfd',
      },
    });

    const placeContent = (placeResult.content as Array<{ type: string; text?: string }>)
      .map(c => c.text ?? '').join('');

    // Parse order confirmation
    const orderData = safeParseMcpJson(placeContent);
    if (!orderData) {
      return {
        success: false,
        symbol,
        side,
        amount,
        error: 'Invalid order confirmation from MCP',
      };
    }

    logger.info('trade_place_complete', {
      orderId: orderData.id,
      state: orderData.state,
    });

    return {
      success: true,
      orderId: orderData.id,
      symbol,
      side,
      amount,
      state: orderData.state,
      estimatedShares: orderData.estimated_shares,
    };

  } catch (error: any) {
    logger.error('trade_execution_error', {
      symbol,
      side,
      amount,
      error: error?.message,
    });

    return {
      success: false,
      symbol,
      side,
      amount,
      error: error?.message || 'Trade execution failed',
    };
  }
}

/**
 * Callable function: Execute a trade
 */
export const rhExecuteTrade = onCall<TradeRequest, Promise<TradeResponse>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
    timeoutSeconds: 30,
    secrets: [mcpServerUrlSecret, accountNumberSecret],
  },
  async (request) => {
    const { symbol, side, amount, orderType, limitPrice, dryRun } = request.data;

    if (!symbol || !side || !amount) {
      throw new HttpsError('invalid-argument', 'Missing required fields: symbol, side, amount');
    }

    if (!['buy', 'sell'].includes(side.toLowerCase())) {
      throw new HttpsError('invalid-argument', 'Side must be "buy" or "sell"');
    }

    if (amount <= 0 || amount > 5000) {
      throw new HttpsError('invalid-argument', 'Amount must be between $1 and $5000');
    }

    logger.info('trade_request_received', {
      symbol,
      side,
      amount,
      orderType: orderType || 'market',
      dryRun: dryRun || false,
      auth: request.auth?.uid,
    });

    let client: Client | undefined;

    try {
      const mcpServerUrl = mcpServerUrlSecret.value();
      const accountNumber = accountNumberSecret.value();
      client = await createMCPClient(mcpServerUrl);
      const result = await executeTrade(client, accountNumber, {
        symbol,
        side,
        amount,
        orderType,
        limitPrice,
        dryRun: dryRun || false,
      });

      return result;
    } catch (error: any) {
      logger.error('trade_callable_error', { error: error?.message });
      throw new HttpsError('internal', `Trade execution failed: ${error?.message}`);
    } finally {
      await client?.close();
    }
  }
);

/**
 * Callable function: Get account summary
 */
export const rhGetAccountSummary = onCall<void, Promise<any>>(
  {
    cors: RH_AGENT_ALLOWED_ORIGINS,
    timeoutSeconds: 15,
    secrets: [mcpServerUrlSecret, accountNumberSecret],
  },
  async () => {
    let client: Client | undefined;

    try {
      const mcpServerUrl = mcpServerUrlSecret.value();
      const accountNumber = accountNumberSecret.value();
      client = await createMCPClient(mcpServerUrl);

      const result = await client.callTool({
        name: 'get_portfolio',
        arguments: { account_number: accountNumber },
      });

      const content = (result.content as Array<{ type: string; text?: string }>)
        .map(c => c.text ?? '').join('');

      const parsed = safeParseMcpJson(content);
      if (!parsed) {
        throw new HttpsError('internal', 'Invalid account summary response from MCP');
      }
      return parsed;
    } catch (error: any) {
      logger.error('account_summary_error', { error: error?.message });
      throw new HttpsError('internal', `Failed to get account summary: ${error?.message}`);
    } finally {
      await client?.close();
    }
  }
);
