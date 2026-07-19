import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactResponse } from "../../functions/src/rh-agent-mcp/tools/robinhood-response-redactor";

describe("Robinhood response redactor", () => {
  it("leaves non-sensitive primitives unchanged", () => {
    const response = { symbol: "AAPL", price: 150.25, active: true };
    const redacted = redactResponse(response);
    assert.deepEqual(redacted, response);
  });

  it("masks account numbers", () => {
    const response = { account_number: "1234567890" };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.account_number, "••••7890");
  });

  it("masks short strings fully", () => {
    const response = { account_number: "1234" };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.account_number, "••••");
  });

  it("masks names while keeping first and last characters", () => {
    const response = { first_name: "Alice", last_name: "Smith" };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.first_name, "A•••e");
    assert.equal(redacted.last_name, "S•••h");
  });

  it("recursively redacts nested objects", () => {
    const response = {
      account: {
        account_number: "9876543210",
        holder: { first_name: "Bob" },
      },
    };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.account.account_number, "••••3210");
    assert.equal(redacted.account.holder.first_name, "B•b");
  });

  it("redacts every item in an array", () => {
    const response = [
      { account_number: "1111111111" },
      { account_number: "2222222222" },
    ];
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted[0].account_number, "••••1111");
    assert.equal(redacted[1].account_number, "••••2222");
  });

  it("redacts extra fields requested by the caller", () => {
    const response = { portfolio_value: "123456.78" };
    const redacted = redactResponse(response, { extraFields: ["portfolio_value"] }) as typeof response;
    assert.equal(redacted.portfolio_value, "••••");
  });

  it("replaces sensitive numeric fields with zero", () => {
    const response = { ssn: 123456789 };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.ssn, 0);
  });
});
