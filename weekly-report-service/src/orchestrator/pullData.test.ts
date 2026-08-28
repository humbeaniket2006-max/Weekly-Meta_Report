import { beforeEach, describe, expect, it, vi } from "vitest";

const mcp = vi.hoisted(() => ({
  callTool: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  clients: [] as Array<{ connect: unknown; callTool: unknown; close: unknown }>,
  transports: [] as Array<{ url: string; options: unknown }>
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => {
    const client = {
      connect: mcp.connect,
      callTool: mcp.callTool,
      close: mcp.close
    };
    mcp.clients.push(client);
    return client;
  })
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL, options: unknown) => {
    mcp.transports.push({ url: url.toString(), options });
    return { url, options };
  })
}));

const { pullFreshsales } = await import("./pullData.js");

beforeEach(() => {
  mcp.callTool.mockReset();
  mcp.connect.mockReset();
  mcp.close.mockReset();
  mcp.clients.length = 0;
  mcp.transports.length = 0;
  process.env.FRESHSALES_MCP_URL = "https://freshsales.example.test/mcp";
  process.env.FRESHSALES_MCP_TOKEN = "test-token";
});

describe("pullFreshsales", () => {
  it("collects paginated query_records results and stops after all records are loaded", async () => {
    mcp.callTool
      .mockResolvedValueOnce({ structuredContent: pageResponse(1, 100, 250) })
      .mockResolvedValueOnce({ structuredContent: pageResponse(2, 100, 250) })
      .mockResolvedValueOnce({ structuredContent: pageResponse(3, 50, 250) });

    const records = await pullFreshsales("2026-08-17", "2026-08-24");

    expect(records).toHaveLength(250);
    expect(mcp.callTool).toHaveBeenCalledTimes(3);
    expect(mcp.callTool.mock.calls.map(([call]) => call.name)).toEqual(["query_records", "query_records", "query_records"]);
    expect(mcp.callTool.mock.calls.map(([call]) => call.arguments.page)).toEqual([1, 2, 3]);
    expect(mcp.callTool.mock.calls[0][0].arguments).toMatchObject({
      entity: "contacts",
      filters: [{ field: "created_at", operator: "between", value: ["2026-08-17", "2026-08-24"] }],
      page: 1,
      per_page: 100
    });
    expect(mcp.transports[0].options).toEqual({ requestInit: { headers: { Authorization: "Bearer test-token" } } });
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("throws when query_records returns a truncated result", async () => {
    mcp.callTool.mockResolvedValueOnce({ structuredContent: { ...pageResponse(1, 1, 1), truncated: true } });

    await expect(pullFreshsales("2026-08-17", "2026-08-24")).rejects.toThrow("truncated result set");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it("requires FRESHSALES_MCP_TOKEN before attempting a connection", async () => {
    delete process.env.FRESHSALES_MCP_TOKEN;

    await expect(pullFreshsales("2026-08-17", "2026-08-24")).rejects.toThrow("FRESHSALES_MCP_TOKEN is required");
    expect(mcp.connect).not.toHaveBeenCalled();
    expect(mcp.callTool).not.toHaveBeenCalled();
  });
});

function pageResponse(page: number, count: number, total: number) {
  return {
    records: Array.from({ length: count }, (_, index) => freshsalesRecord(`${page}-${index}`)),
    total,
    page,
    per_page: 100,
    truncated: false
  };
}

function freshsalesRecord(id: string) {
  return {
    id,
    lead_source_id: "lead-source",
    stage: null,
    contact_status_id: null,
    cf_qualification_status: null,
    created_at: "2026-08-17T00:00:00.000Z",
    qualified_at: null
  };
}
