import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

const MODEL = "claude-sonnet-4-5";
const MAX_ITERATIONS = 10;

const SYSTEM_PROMPT = `You are an autonomous trading agent connected to a Robinhood brokerage account via MCP tools.

Your responsibilities:
- Execute trading strategies accurately and safely
- Always check current prices and portfolio state before placing orders
- Confirm order details (symbol, quantity, price) before submitting
- Report clearly what actions you took and their outcomes
- If a strategy is ambiguous or risky, ask for clarification rather than guessing

When placing trades:
- Use limit orders when possible for better price control
- Never place an order without first checking the current quote
- Always report the order ID and status after submission

Be concise in your responses. Focus on actions and outcomes.`;

export interface AgentOptions {
  mcpClient: Client;
  strategy: string;
  dryRun?: boolean;
  indicatorContext?: string;
}

export async function runAgent(options: AgentOptions): Promise<void> {
  const { mcpClient, strategy, dryRun = false, indicatorContext } = options;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Fetch available MCP tools and convert to Anthropic tool format
  const { tools: mcpTools } = await mcpClient.listTools();

  if (mcpTools.length === 0) {
    throw new Error("No tools available from MCP server. Is it connected and authenticated?");
  }

  console.log(`\nLoaded ${mcpTools.length} MCP tools: ${mcpTools.map((t) => t.name).join(", ")}\n`);

  const anthropicTools: Tool[] = mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: (tool.inputSchema as Tool["input_schema"]) ?? { type: "object", properties: {} },
  }));

  const contextBlock = indicatorContext
    ? `The following technical indicators have been pre-computed from price history. Treat these as ground truth — do not recalculate them yourself:\n\n${indicatorContext}\n\n`
    : "";

  const userMessage = dryRun
    ? `[DRY RUN - do not place any real orders, just describe what you would do]\n\n${contextBlock}${strategy}`
    : `${contextBlock}${strategy}`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  console.log(`Strategy: ${strategy}`);
  if (dryRun) console.log("Mode: DRY RUN (no real orders will be placed)\n");
  console.log("─".repeat(60));

  // Agentic loop
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: anthropicTools,
      messages,
    });

    // Print any text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`\nAgent: ${block.text}`);
      }
    }

    // If no more tool calls, we're done
    if (response.stop_reason === "end_turn") {
      console.log("\n" + "─".repeat(60));
      console.log("Agent finished.");
      break;
    }

    // Collect tool use blocks
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolUseBlocks.length === 0) break;

    // Add assistant message to history
    messages.push({ role: "assistant", content: response.content });

    // Execute each tool call via MCP
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      console.log(`\n  → Calling tool: ${block.name}`);
      if (Object.keys(block.input as object).length > 0) {
        console.log(`    Input: ${JSON.stringify(block.input, null, 2)}`);
      }

      let resultContent: string;

      // In dry run mode, skip mutating tools
      const isMutatingTool = block.name.toLowerCase().includes("order") ||
        block.name.toLowerCase().includes("place") ||
        block.name.toLowerCase().includes("buy") ||
        block.name.toLowerCase().includes("sell") ||
        block.name.toLowerCase().includes("cancel");

      if (dryRun && isMutatingTool) {
        resultContent = JSON.stringify({ dry_run: true, message: "Order not placed (dry run mode)" });
        console.log(`    [DRY RUN] Skipped mutating tool: ${block.name}`);
      } else {
        try {
          const result = await mcpClient.callTool({
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
          const content = result.content as Array<{ type: string; text?: string }>;
          resultContent = content.map((c) => (c.type === "text" ? c.text ?? "" : JSON.stringify(c))).join("\n");
          console.log(`    Result: ${resultContent.slice(0, 200)}${resultContent.length > 200 ? "..." : ""}`);
        } catch (err) {
          resultContent = JSON.stringify({ error: String(err) });
          console.log(`    Error: ${err}`);
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultContent,
      });
    }

    // Add tool results back into the conversation
    messages.push({ role: "user", content: toolResults });
  }
}
