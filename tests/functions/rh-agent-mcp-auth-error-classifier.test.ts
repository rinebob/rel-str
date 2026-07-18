import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedError } from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js";
import {
  AccessDeniedError,
  InvalidClientError,
  InvalidGrantError,
  ServerError,
  TemporarilyUnavailableError,
  TooManyRequestsError,
} from "../../functions/node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/errors.js";
import { classifyAuthenticationError } from "../../functions/src/rh-agent-mcp/index";

describe("classifyAuthenticationError", () => {
  it("requires reauthorization only for rejected or invalid authorization", () => {
    assert.deepEqual(classifyAuthenticationError(new InvalidGrantError("secret")), {
      state: "REAUTHORIZATION_REQUIRED",
      category: "AUTHORIZATION_REJECTED",
    });
    assert.deepEqual(classifyAuthenticationError(new AccessDeniedError("secret")), {
      state: "REAUTHORIZATION_REQUIRED",
      category: "AUTHORIZATION_REJECTED",
    });
    assert.deepEqual(classifyAuthenticationError(new UnauthorizedError("secret")), {
      state: "REAUTHORIZATION_REQUIRED",
      category: "USER_INTERACTION_REQUIRED",
    });
  });

  it("classifies invalid client configuration separately", () => {
    assert.deepEqual(classifyAuthenticationError(new InvalidClientError("secret")), {
      state: "MISCONFIGURED",
      category: "OAUTH_CONFIGURATION_INVALID",
    });
  });

  it("classifies server, throttling, and unknown errors as temporary", () => {
    for (const error of [
      new ServerError("secret"),
      new TemporarilyUnavailableError("secret"),
      new TooManyRequestsError("secret"),
      new Error("secret"),
    ]) {
      const result = classifyAuthenticationError(error);
      assert.equal(result.state, "TEMPORARILY_UNAVAILABLE");
      assert.equal(JSON.stringify(result).includes("secret"), false);
    }
  });
});
