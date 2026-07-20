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

  it("preserves security identifiers but still redacts PII", () => {
    const response = {
      id: "b8c2d4f4-1234-5678-9abc-def012345678",
      chain_id: "a1b2c3d4-5678-90ab-cdef-1234567890ab",
      option_id: "opt-12345678-1234-1234-1234-1234567890ab",
      instrument_id: "instr-abc-123",
      url: "https://api.robinhood.com/options/instruments/123/",
      uuid: "request-uuid-1234",
      account_number: "1234567890",
      first_name: "Alice",
    };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.id, response.id);
    assert.equal(redacted.chain_id, response.chain_id);
    assert.equal(redacted.option_id, response.option_id);
    assert.equal(redacted.instrument_id, response.instrument_id);
    assert.equal(redacted.url, response.url);
    assert.equal(redacted.uuid, response.uuid);
    assert.equal(redacted.account_number, "••••7890");
    assert.equal(redacted.first_name, "A•••e");
  });

  it("matches sensitive patterns case-insensitively", () => {
    const response = {
      Account_Number: "1234567890",
      Brokerage_Account_ID: "abc-123",
      last_4_SSN: "7890",
    };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.Account_Number, "••••7890");
    assert.equal(redacted.Brokerage_Account_ID, "••••");
    assert.equal(redacted.last_4_SSN, "••••");
  });

  it("redacts plural email and phone arrays", () => {
    const response = {
      emails: ["alice@example.com", "bob@example.com"],
      phone_numbers: ["555-1234", "555-5678"],
    };
    const redacted = redactResponse(response) as typeof response;
    assert.equal(redacted.emails[0], "••••");
    assert.equal(redacted.emails[1], "••••");
    assert.equal(redacted.phone_numbers[0], "••••");
    assert.equal(redacted.phone_numbers[1], "••••");
  });
});
