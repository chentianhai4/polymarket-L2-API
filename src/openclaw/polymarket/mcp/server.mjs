import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PolymarketGateway } from "../polymarketGateway.mjs";
import { toMcpErr, toMcpOk, createTraceId } from "./envelope.mjs";
import { buildPolymarketMcpTools } from "./tools.mjs";

function asToolResponse(envelope) {
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
  };
}

export function createPolymarketMcpServer({ gateway = undefined, gatewayOptions = undefined } = {}) {
  const activeGateway = gateway ?? new PolymarketGateway(gatewayOptions ?? {});

  const server = new McpServer({
    name: "openclaw-polymarket",
    version: "1.0.0",
  });

  const tools = buildPolymarketMcpTools({ gateway: activeGateway });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args = {}) => {
        const traceId = createTraceId();

        try {
          const payload = await tool.execute(args);
          const ok = toMcpOk(payload?.data ?? payload, {
            traceId,
            warnings: payload?.warnings ?? [],
          });
          return asToolResponse(ok);
        } catch (error) {
          const err = toMcpErr(error, { traceId });
          return {
            ...asToolResponse(err),
            isError: true,
          };
        }
      },
    );
  }

  async function start(transport = new StdioServerTransport()) {
    await server.connect(transport);
    return transport;
  }

  return {
    server,
    gateway: activeGateway,
    start,
  };
}

export async function startPolymarketMcpStdio(options = {}) {
  const app = createPolymarketMcpServer(options);
  const transport = new StdioServerTransport();
  await app.start(transport);
  return app;
}
