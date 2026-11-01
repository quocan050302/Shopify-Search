/**
 * SWAI KH-02 V12.4.3.5.1 — Realistic Walmart US Jina Reader REST Test Fixtures
 *
 * Used strictly for deterministic unit and integration testing (`evidenceOrigin: "TEST_FIXTURE"`).
 * Never reported as `REAL_JINA_READER` or live verification.
 */

export function wrapNextDataInWalmartHtml(
  nextDataObj: Record<string, any>,
  pageTitle = "Walmart.com"
): string {
  const serialized = JSON.stringify(nextDataObj);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${pageTitle}</title></head><body><div id="__next"><h1>${pageTitle}</h1></div><script id="__NEXT_DATA__" type="application/json">${serialized}</script></body></html>`;
}

export function wrapHtmlInJinaEnvelope(params: {
  targetUrl: string;
  title: string;
  html: string;
  code?: number;
  status?: number;
}): string {
  return JSON.stringify({
    code: params.code ?? 200,
    status: params.status ?? 20000,
    data: {
      title: params.title,
      url: params.targetUrl,
      html: params.html,
      content: params.title,
    },
  });
}

export function buildChomChomSearchJinaBody(query = "ChomChom Roller Pet Hair Remover"): string {
  const targetUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
  const nextData = {
    buildId: "wmt-prod-20261101",
    page: "/search",
    query: { q: query },
    props: {
      pageProps: {
        initialData: {
          searchResult: {
            title: `Results for "${query}"`,
            count: 3,
            aggregatedCount: 3,
            itemStacks: [
              {
                title: "Main Results",
                items: [
                  {
                    __typename: "Product",
                    usItemId: "674275778",
                    id: "4F9K2L8P1Q",
                    name: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller for Dog and Cat Hair",
                    brand: "ChomChom Roller",
                    canonicalUrl: "/ip/ChomChom-Roller-Pet-Hair-Remover/674275778",
                    sellerName: "Walmart.com",
                    availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                    isSponsoredFlag: true,
                    priceInfo: {
                      currentPrice: {
                        price: 24.99,
                        priceString: "$24.99",
                        currencyUnit: "USD",
                      },
                    },
                    imageInfo: {
                      thumbnailUrl: "https://i5.walmartimages.com/asr/chomchom-674275778.jpg",
                    },
                  },
                  {
                    __typename: "Product",
                    usItemId: "674275778",
                    id: "4F9K2L8P1Q",
                    name: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller for Dog and Cat Hair",
                    brand: "ChomChom Roller",
                    canonicalUrl: "/ip/ChomChom-Roller-Pet-Hair-Remover/674275778?athbdg=L1102",
                    sellerName: "Walmart.com",
                    availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                    isSponsoredFlag: false,
                    priceInfo: {
                      currentPrice: {
                        price: 24.99,
                        priceString: "$24.99",
                        currencyUnit: "USD",
                      },
                    },
                    imageInfo: {
                      thumbnailUrl: "https://i5.walmartimages.com/asr/chomchom-674275778.jpg",
                    },
                  },
                  {
                    __typename: "Product",
                    usItemId: "999111222",
                    id: "ACC999111",
                    name: "Replacement Sticky Refill Pads Compatible with ChomChom Roller (3-Pack Accessory)",
                    brand: "Generic Pet Care",
                    canonicalUrl: "/ip/Replacement-Sticky-Refill-Pads/999111222",
                    sellerName: "ThirdPartyPetSupplies",
                    availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                    isSponsoredFlag: false,
                    priceInfo: {
                      currentPrice: {
                        price: 9.99,
                        priceString: "$9.99",
                        currencyUnit: "USD",
                      },
                    },
                  },
                  {
                    __typename: "Product",
                    usItemId: "888111222",
                    id: "COMP888111",
                    name: "FurZapper Reusable Pet Hair Remover for Laundry",
                    brand: "FurZapper",
                    canonicalUrl: "/ip/FurZapper-Pet-Hair-Remover/888111222",
                    sellerName: "Walmart.com",
                    availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                    isSponsoredFlag: false,
                    priceInfo: {
                      currentPrice: {
                        price: 12.99,
                        priceString: "$12.99",
                        currencyUnit: "USD",
                      },
                    },
                  },
                ],
              },
            ],
          },
          location: {
            postalCode: "95829",
            city: "Sacramento",
            stateOrProvinceCode: "CA",
            storeIds: ["3081"],
          },
        },
      },
    },
  };

  const html = wrapNextDataInWalmartHtml(nextData, `${query} - Walmart.com`);
  return wrapHtmlInJinaEnvelope({
    targetUrl,
    title: `${query} - Walmart.com`,
    html,
  });
}

export function buildChomChomPdpJinaBody(options?: {
  availability?: "IN_STOCK" | "OUT_OF_STOCK";
  price?: number | null;
  currencyUnit?: string | null;
  upc?: string | null;
  usItemId?: string;
}): string {
  const usItemId = options?.usItemId ?? "674275778";
  const targetUrl = `https://www.walmart.com/ip/${usItemId}`;
  const availability = options?.availability ?? "IN_STOCK";
  const price = options?.price !== undefined ? options.price : 24.99;
  const currencyUnit = options?.currencyUnit !== undefined ? options.currencyUnit : "USD";
  const upc = options?.upc !== undefined ? options.upc : "856957004000";

  const nextData = {
    buildId: "wmt-prod-20261101",
    page: "/ip/[id]",
    query: { id: usItemId },
    props: {
      pageProps: {
        initialData: {
          data: {
            product: {
              usItemId,
              id: "4F9K2L8P1Q",
              name: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller for Dog and Cat Hair",
              brand: "ChomChom Roller",
              model: "CC-ROLLER-01",
              upc,
              canonicalUrl: `/ip/ChomChom-Roller-Pet-Hair-Remover/${usItemId}`,
              sellerName: "Walmart.com",
              availabilityStatus: availability,
              availabilityStatusV2: {
                value: availability,
                display: availability === "IN_STOCK" ? "In stock" : "Out of stock",
              },
              priceInfo: {
                currentPrice: {
                  price,
                  priceString: price !== null ? `$${price.toFixed(2)}` : null,
                  currencyUnit,
                },
              },
              location: {
                postalCode: "95829",
                city: "Sacramento",
                stateOrProvinceCode: "CA",
                storeIds: ["3081"],
              },
              imageInfo: {
                allImages: [
                  { url: "https://i5.walmartimages.com/asr/chomchom-674275778-1.jpg" },
                ],
              },
            },
            // Secondary carousel prices that MUST NEVER be used when primary price is null
            recommendations: [
              {
                usItemId: "777000111",
                name: "Recommended Pet Brush",
                priceInfo: {
                  currentPrice: {
                    price: 19.99,
                    priceString: "$19.99",
                    currencyUnit: "USD",
                  },
                },
              },
            ],
          },
        },
      },
    },
  };

  const html = wrapNextDataInWalmartHtml(
    nextData,
    "ChomChom Roller Pet Hair Remover - Walmart.com"
  );
  return wrapHtmlInJinaEnvelope({
    targetUrl,
    title: "ChomChom Roller Pet Hair Remover - Walmart.com",
    html,
  });
}

export function buildBlackDeckerPdpJinaBody(): string {
  const usItemId = "339091722";
  const targetUrl = `https://www.walmart.com/ip/${usItemId}`;
  const nextData = {
    buildId: "wmt-prod-20261101",
    page: "/ip/[id]",
    query: { id: usItemId },
    props: {
      pageProps: {
        initialData: {
          data: {
            product: {
              usItemId,
              id: "BD339091722",
              name: "BLACK+DECKER dustbuster AdvancedClean Cordless Handheld Vacuum (CHV1410L)",
              brand: "BLACK+DECKER",
              model: "CHV1410L",
              upc: "885911830997",
              canonicalUrl: `/ip/BLACK-DECKER-dustbuster-Cordless-Handheld-Vacuum/${usItemId}`,
              sellerName: "Walmart.com",
              availabilityStatus: "IN_STOCK",
              availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
              priceInfo: {
                currentPrice: {
                  price: 49.0,
                  priceString: "$49.00",
                  currencyUnit: "USD",
                },
              },
              location: {
                postalCode: "95829",
                storeIds: ["3081"],
              },
            },
          },
        },
      },
    },
  };
  const html = wrapNextDataInWalmartHtml(
    nextData,
    "BLACK+DECKER dustbuster Cordless Handheld Vacuum - Walmart.com"
  );
  return wrapHtmlInJinaEnvelope({
    targetUrl,
    title: "BLACK+DECKER dustbuster Cordless Handheld Vacuum - Walmart.com",
    html,
  });
}

export function buildSonyLeadingZeroUpcPdpJinaBody(options?: {
  availability?: "IN_STOCK" | "OUT_OF_STOCK";
}): string {
  const usItemId = "16504921979";
  const availability = options?.availability ?? "IN_STOCK";
  const targetUrl = `https://www.walmart.com/ip/${usItemId}`;
  const nextData = {
    buildId: "wmt-prod-20261101",
    page: "/ip/[id]",
    query: { id: usItemId },
    props: {
      pageProps: {
        initialData: {
          data: {
            product: {
              usItemId,
              id: "SONY16504921979",
              name: "Sony WH-1000XM4 Wireless Noise Canceling Overhead Headphones",
              brand: "Sony",
              model: "WH1000XM4/B",
              upc: "027242930698", // Leading zero MUST be preserved as string
              canonicalUrl: `/ip/Sony-WH-1000XM4-Wireless-Headphones/${usItemId}`,
              sellerName: "Walmart.com",
              availabilityStatus: availability,
              availabilityStatusV2: {
                value: availability,
                display: availability === "IN_STOCK" ? "In stock" : "Out of stock",
              },
              priceInfo: {
                currentPrice: {
                  price: 348.0,
                  priceString: "$348.00",
                  currencyUnit: "USD",
                },
              },
              location: {
                postalCode: "95829",
                storeIds: ["3081"],
              },
            },
          },
        },
      },
    },
  };
  const html = wrapNextDataInWalmartHtml(
    nextData,
    "Sony WH-1000XM4 Wireless Headphones - Walmart.com"
  );
  return wrapHtmlInJinaEnvelope({
    targetUrl,
    title: "Sony WH-1000XM4 Wireless Headphones - Walmart.com",
    html,
  });
}

export function buildEmptyWalmartSearchJinaBody(query = "Unobtainium Gadget 9999"): string {
  const targetUrl = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
  const nextData = {
    buildId: "wmt-prod-20261101",
    page: "/search",
    query: { q: query },
    props: {
      pageProps: {
        initialData: {
          searchResult: {
            title: `Results for "${query}"`,
            count: 0,
            aggregatedCount: 0,
            itemStacks: [
              {
                title: "Main Results",
                items: [],
              },
            ],
          },
          location: {
            postalCode: "95829",
            storeIds: ["3081"],
          },
        },
      },
    },
  };
  const html = wrapNextDataInWalmartHtml(nextData, `${query} - Walmart.com`);
  return wrapHtmlInJinaEnvelope({
    targetUrl,
    title: `${query} - Walmart.com`,
    html,
  });
}

export function buildBotWallWalmartJinaBody(targetUrl = "https://www.walmart.com/ip/674275778"): string {
  const html = `<!DOCTYPE html><html><head><title>Robot or human?</title></head><body><h1>Robot or human?</h1><p>Activate and hold the button to confirm that you are human. Reference ID /px/captcha</p></body></html>`;
  return wrapHtmlInJinaEnvelope({
    targetUrl,
    title: "Robot or human?",
    html,
  });
}

