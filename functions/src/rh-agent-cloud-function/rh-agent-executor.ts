/**
 * RH Agent Trade Executor
 *
 * Cloud Callable function that executes trades via Robinhood MCP.
 * Uses stored OAuth tokens from Firebase Secrets.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_SERVER_URL = 'https://agent.robinhood.com/mcp/trading';
const AGENTIC_ACCOUNT_NUMBER = '6245'; // Last 4 digits of Agentic account

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
 * Create MCP client with tokens from Firebase Secrets
 */
async function createMCPClient(): Promise<Client> {
  // In production, tokens come from Firebase Secrets
  // For now, read from environment or secret manager
  const tokensJson = process.env.ROBINHOOD_TOKENS;
  
  if (!tokensJson) {
    throw new HttpsError('failed-precondition', 'Robinhood tokens not configured');
  }

  const tokens = JSON.parse(tokensJson);
  
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_SERVER_URL),
    { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }
  );

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
  request: TradeRequest
): Promise<TradeResponse> {
  const { symbol, side, amount, orderType = 'market', limitPrice, dryRun = false } = request;
  
  try {
    // Step 1: Review the order (preview)
    logger.info('trade_review_start', { symbol, side, amount, orderType });
    
    const reviewResult = await client.callTool({
      name: 'review_equity_order',
      arguments: {
        account_number: AGENTIC_ACCOUNT_NUMBER,
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
        account_number: AGENTIC_ACCOUNT_NUMBER,
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
    const orderData = JSON.parse(placeContent);
    
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
    cors: [
      'https://rel-str--rel-str.web.app',
      'https://rel-str--rel-str.us-central1.hosted.app',
      'https://rel-str.web.app',
      'https://savanttrader.com',
      'https://www.savanttrader.com',
      'http://localhost:4200',
      'http://localhost:5000',
    ],
    secrets: ['ROBINHOOD_TOKENS'],
    timeoutSeconds: 30,
  },
  async (request) => {
    const { symbol, side, amount, orderType, limitPrice, dryRun } = request.data;

    // Validate inputs
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
      client = await createMCPClient();
      const result = await executeTrade(client, {
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
    cors: true,
    secrets: ['ROBINHOOD_TOKENS'],
    timeoutSeconds: 15,
  },
  async () => {
    let client: Client | undefined;
    
    try {
      client = await createMCPClient();
      
      const result = await client.callTool({
        name: 'get_portfolio',
        arguments: { account_number: AGENTIC_ACCOUNT_NUMBER },
      });

      const content = (result.content as Array<{ type: string; text?: string }>)
        .map(c => c.text ?? '').join('');
      
      return JSON.parse(content);
    } catch (error: any) {
      logger.error('account_summary_error', { error: error?.message });
      throw new HttpsError('internal', `Failed to get account summary: ${error?.message}`);
    } finally {
      await client?.close();
    }
  }
);
