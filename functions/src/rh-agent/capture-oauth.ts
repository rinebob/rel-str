/**
 * One-time OAuth token capture script
 * Generates fresh OAuth URL and captures tokens
 */
import "dotenv/config";
import {
  auth,
  type OAuthClientProvider,
  type AuthResult,
} from "@modelcontextprotocol/sdk/client/auth";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline";

const MCP_SERVER_URL = "https://agent.robinhood.com/mcp/trading";
const TOKENS_FILE = path.join(process.cwd(), ".rh-tokens.json");

// Generate PKCE code verifier
function generateCodeVerifier(): string {
  const array = crypto.randomBytes(32);
  return base64UrlEncode(array);
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ---------- OAuth provider ----------

class RobinhoodOAuthProvider implements OAuthClientProvider {
  private _tokens: OAuthTokens | undefined;
  private _clientInfo: OAuthClientInformationMixed | undefined;
  private _codeVerifier: string;

  constructor(codeVerifier: string) {
    this._codeVerifier = codeVerifier;
  }

  get redirectUrl() { 
    return "http://localhost:3456/callback"; 
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "rh-cloud-function",
      redirect_uris: ["http://localhost:3456/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation() { return this._clientInfo; }
  saveClientInformation(info: OAuthClientInformationMixed) { this._clientInfo = info; }

  tokens() { return this._tokens; }
  saveTokens(tokens: OAuthTokens) {
    this._tokens = tokens;
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
    console.log("\n✅ Tokens saved to:", TOKENS_FILE);
  }

  saveCodeVerifier(v: string) { this._codeVerifier = v; }
  codeVerifier() { return this._codeVerifier; }

  redirectToAuthorization(authorizationUrl: URL) {
    const url = authorizationUrl.toString();
    console.log("\n" + "=".repeat(60));
    console.log("ROBINHOOD OAUTH - MANUAL CAPTURE");
    console.log("=".repeat(60));
    console.log("\n1. Open this URL in your browser (use Incognito):");
    console.log("\n" + url + "\n");
    console.log("2. Log in to Robinhood and authorize");
    console.log("3. When it tries to redirect to localhost, COPY the 'code' from the URL");
    console.log("   Example: http://localhost:3456/callback?code=Abc123...");
    console.log("4. Paste the code below:\n");
    
    const urlFile = path.join(process.cwd(), "auth-url.txt");
    fs.writeFileSync(urlFile, url, "utf-8");
  }
}

// ---------- Main ----------

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(answer.trim()));
    });
  };

  try {
    // Generate fresh PKCE
    const codeVerifier = generateCodeVerifier();
    
    console.log("Generating fresh OAuth URL...\n");
    
    const provider = new RobinhoodOAuthProvider(codeVerifier);
    
    // Start auth flow (will output URL)
    const result: AuthResult = await auth(provider, { serverUrl: MCP_SERVER_URL });
    
    if (result === "REDIRECT") {
      // Wait for manual code entry
      const authCode = await ask("Enter the authorization code: ");
      
      if (!authCode) {
        console.log("❌ No code provided. Exiting.");
        process.exit(1);
      }
      
      console.log("\nExchanging code for tokens...");
      await auth(provider, { 
        serverUrl: MCP_SERVER_URL, 
        authorizationCode: authCode 
      });
      
      console.log("\n✅ SUCCESS! Tokens saved to .rh-tokens.json");
      console.log("\nNext steps:");
      console.log("1. Store in Firebase Secrets:");
      console.log("   firebase functions:secrets:set ROBINHOOD_TOKENS < .rh-tokens.json");
      console.log("2. Deploy cloud functions:");
      console.log("   firebase deploy --only functions:rhExecuteTrade,rhGetAccountSummary");
    }
    
    rl.close();
  } catch (err) {
    console.error("\n❌ Error:", err);
    rl.close();
    process.exit(1);
  }
}

main();
