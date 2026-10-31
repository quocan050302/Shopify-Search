/**
 * Local Stdio MCP Test Server for KH-02 V12.4.3.5.0.1 Wave C Integration Testing
 *
 * Implements a real Model Context Protocol (`@modelcontextprotocol/sdk`) server over
 * `StdioServerTransport` exposing `browser_navigate`, `browser_snapshot`, and `browser_close`.
 *
 * IMPORTANT:
 * - Server name is explicitly `playwright-mcp-local-test-double` so `connectAmazonPlaywrightMcp`
 *   stamps `serverOrigin: "LOCAL_MCP_TEST_DOUBLE"` and `observationClass: "TEST_FIXTURE"`.
 * - This server is NEVER counted as `REAL_PROVIDER_VERIFIED` or `AUTHORIZED_LIVE`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const FIXTURE_PRODUCTS_BY_URL: Record<
  string,
  {
    title: string;
    asin: string;
    parentAsin: string;
    variationAsin: string;
    brand: string;
    merchant: string;
    seller: string;
    price: number;
    currency: string;
    availability: string;
    deliveryMarket: "US" | "NON_US";
    modelNumber?: string;
    sku?: string;
    gtin?: string;
    httpStatus?: number;
  }
> = {
  "https://www.amazon.com/dp/B08N5WRWNW": {
    title: "UAHPET Wireless Cat Water Fountain",
    asin: "B08N5WRWNW",
    parentAsin: "B08N5WR000",
    variationAsin: "B08N5WRWNW",
    brand: "UAHPET",
    merchant: "UAHPET Official Store",
    seller: "UAHPET US",
    price: 49.99,
    currency: "USD",
    availability: "In Stock",
    deliveryMarket: "US",
    modelNumber: "UAH-WF-01",
    sku: "UAH-SKU-01",
    gtin: "0085001234567",
  },
  "https://www.amazon.com/dp/B09V3KXJPB": {
    title: "KittySpout Stainless Steel Cat Water Fountain",
    asin: "B09V3KXJPB",
    parentAsin: "B09V3KX000",
    variationAsin: "B09V3KXJPB",
    brand: "KittySpout",
    merchant: "KittySpout Official",
    seller: "KittySpout US",
    price: 54.95,
    currency: "USD",
    availability: "In Stock",
    deliveryMarket: "US",
    modelNumber: "KS-SS-02",
    sku: "KS-SKU-02",
    gtin: "0085009876543",
  },
  "https://www.amazon.com/dp/B07XJ8C8F5": {
    title: "Uproot Clean Pro Pet Hair Remover",
    asin: "B07XJ8C8F5",
    parentAsin: "B07XJ8C000",
    variationAsin: "B07XJ8C8F5",
    brand: "Uproot Clean",
    merchant: "Uproot Clean Official",
    seller: "Uproot Clean LLC",
    price: 19.99,
    currency: "USD",
    availability: "In Stock",
    deliveryMarket: "US",
    modelNumber: "UC-PRO-03",
    sku: "UC-SKU-03",
    gtin: "0085005554443",
  },
};

let currentNavigatedUrl = "";

async function main() {
  const server = new Server(
    {
      name: "playwright-mcp-local-test-double",
      version: "0.0.83",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate to a URL",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
            },
            required: ["url"],
          },
        },
        {
          name: "browser_snapshot",
          description: "Capture accessibility snapshot of current page",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "browser_close",
          description: "Close browser page",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments || {}) as Record<string, any>;

    if (toolName === "browser_navigate") {
      currentNavigatedUrl = String(args.url || "").trim();
      const entry = FIXTURE_PRODUCTS_BY_URL[currentNavigatedUrl];
      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: `Page URL: ${currentNavigatedUrl}\nHTTP Status: 404\nPage Title: Page Not Found`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `Page URL: ${currentNavigatedUrl}\nCanonical URL: ${currentNavigatedUrl}\nHTTP Status: ${entry.httpStatus || 200}\nPage Title: ${entry.title}`,
          },
        ],
      };
    }

    if (toolName === "browser_snapshot") {
      const entry = FIXTURE_PRODUCTS_BY_URL[currentNavigatedUrl];
      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: "<html><body>SORRY we couldn't find that page</body></html>",
            },
          ],
        };
      }
      const structuredData = {
        asin: entry.asin,
        parentAsin: entry.parentAsin,
        variationAsin: entry.variationAsin,
        productTitle: entry.title,
        brand: entry.brand,
        merchant: entry.merchant,
        seller: entry.seller,
        currency: entry.currency,
        price: entry.price,
        availability: entry.availability,
        deliveryMarket: entry.deliveryMarket,
        modelNumber: entry.modelNumber,
        sku: entry.sku,
        gtin: entry.gtin,
      };
      return {
        content: [
          {
            type: "text",
            text: [
              `Page URL: ${currentNavigatedUrl}`,
              `Canonical URL: ${currentNavigatedUrl}`,
              `HTTP Status: ${entry.httpStatus || 200}`,
              `Page Title: ${entry.title}`,
              `STRUCTURED_DATA_JSON:${JSON.stringify(structuredData)}`,
            ].join("\n"),
          },
        ],
      };
    }

    if (toolName === "browser_close") {
      currentNavigatedUrl = "";
      return {
        content: [{ type: "text", text: "Browser closed" }],
      };
    }

    throw new Error(`Unknown tool: ${toolName}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Local MCP test server error: ${err?.message || err}\n`);
  process.exit(1);
});

