import { chromium, type Browser, type Page } from "playwright";

// ── Singleton browser (reused across requests) ──
let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run",
      "--hide-scrollbars",
      "--mute-audio",
    ],
  });
  return _browser;
}

// ── Playwright-based one-way quote fetcher ──
export async function lookupUhaulOneWayPlaywright(
  pickup: string,
  dropoff: string,
  date: string // MM/DD/YYYY
): Promise<UhaulLookupResult> {
  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Step 1: visit uhaul.com to establish session + cookies
    console.log("[playwright] Establishing session on uhaul.com/Trucks/");
    await page.goto("https://www.uhaul.com/Trucks/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(1500); // let JS settle

    // Step 2: submit the equipment search form programmatically via JS
    // This replicates the POST to /EquipmentSearch/ using the session we just got
    console.log("[playwright] Submitting search via JS form injection");
    await page.evaluate(
      ({ pickup, dropoff, date }) => {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = "/EquipmentSearch/";
        const fields: Record<string, string> = {
          PickupLocation: pickup,
          DropoffLocation: dropoff,
          PickupDate: date,
          Scenario: "TruckOnly",
          ReturnLocation: dropoff,
          TripType: "OneWay",
        };
        for (const [name, value] of Object.entries(fields)) {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        }
        document.body.appendChild(form);
        form.submit();
      },
      { pickup, dropoff, date }
    );

    // Step 3: wait for navigation to rates page
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("[playwright] After EquipmentSearch, URL:", page.url());

    // Step 4: if we ended up on EquipmentSearch, navigate to RatesTrucks
    if (!page.url().includes("RatesTrucks")) {
      console.log("[playwright] Navigating to RatesTrucks");
      await page.goto("https://www.uhaul.com/Reservations/RatesTrucks/", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
    }

    // Give rates page time to render
    await page.waitForTimeout(2000);
    console.log("[playwright] Rates page URL:", page.url());

    const html = await page.content();
    console.log(
      "[playwright] Got page content, length:",
      html.length,
      "has Rates for:",
      html.includes("Rates for")
    );

    // Use existing HTML parser
    return parseUhaulHtml(html, pickup, dropoff, date, "one_way");
  } catch (err: any) {
    console.error("[playwright] Error:", err.message);
    // If browser died, reset it so next request gets a fresh one
    _browser = null;
    return {
      success: false,
      pickup,
      dropoff,
      date,
      tripType: "one_way",
      trucks: [],
      error: "Playwright fetch failed: " + (err.message || "unknown error"),
    };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Shared HTML parser (used by both HTTP and Playwright paths) ──
function parseUhaulHtml(
  html: string,
  pickup: string,
  dropoff: string,
  date: string,
  tripType: "one_way" | "in_town"
): UhaulLookupResult {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

  const trucks: UhaulPriceResult[] = [];
  const isInTown = tripType === "in_town";

  if (isInTown) {
    const pattern =
      /(\d+)'\s*(?:Truck|Cargo Van|Pickup Truck)[\s\S]*?\$([0-9,]+(?:\.\d{2})?)[\s\S]*?plus \$([0-9.]+)\/mile/gi;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const size = m[1];
      const baseRate = parseFloat(m[2].replace(",", ""));
      const mileageRate = parseFloat(m[3]);
      if (!trucks.find((t) => t.truckSize === size + "ft")) {
        trucks.push({ truckSize: size + "ft", price: baseRate, description: "", baseRate, mileageRate });
      }
    }
  } else {
    const pattern =
      /(\d+)'\s*(?:Truck|Cargo Van|Pickup Truck)[\s\S]*?(?:\$([\d,]+\.\d{2})|Not available)/gi;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const size = m[1];
      const price = m[2] ? parseFloat(m[2].replace(",", "")) : null;
      if (!trucks.find((t) => t.truckSize === size + "ft")) {
        trucks.push({ truckSize: size + "ft", price, description: "" });
      }
    }
  }

  const rateMatch = text.match(/up to (\d+) days? of use and ([\d,]+) miles/i);
  const includedDays = rateMatch ? parseInt(rateMatch[1]) : 0;
  const includedMiles = rateMatch ? parseInt(rateMatch[2].replace(",", "")) : 0;
  const available = trucks.filter((t) => t.price !== null);

  if (available.length === 0) {
    return {
      success: false,
      pickup,
      dropoff: tripType === "one_way" ? dropoff : null,
      date,
      tripType,
      trucks: [],
      error: html.includes("Rates for")
        ? "Found rates page but couldn't parse prices. Enter costs manually."
        : "Could not retrieve U-Haul pricing. Enter costs manually.",
    };
  }

  return {
    success: true,
    pickup,
    dropoff: tripType === "one_way" ? dropoff : null,
    date,
    tripType,
    trucks: available,
    includedDays: includedDays || undefined,
    includedMiles: includedMiles || undefined,
  };
}

interface UhaulPriceResult {
  truckSize: string;
  price: number | null;
  description: string;
  baseRate?: number;
  mileageRate?: number;
}

export interface UhaulLookupResult {
  success: boolean;
  pickup: string;
  dropoff: string | null;
  date: string;
  tripType: "one_way" | "in_town";
  trucks: UhaulPriceResult[];
  includedDays?: number;
  includedMiles?: number;
  error?: string;
}

export async function suggestLocations(
  term: string
): Promise<{ label: string; value: string }[]> {
  const url = `https://www.uhaul.com/suggest.axd?maxResults=10&type=geo-all&term=${encodeURIComponent(term)}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!resp.ok) return [];
  return resp.json();
}

// Full browser-like headers to avoid being blocked
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  Connection: "keep-alive",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function getCookies(headers: Headers): string {
  const raw =
    typeof (headers as any).getSetCookie === "function"
      ? (headers as any).getSetCookie()
      : [];
  if (raw.length > 0) {
    return raw.map((c: string) => c.split(";")[0]).join("; ");
  }
  // Fallback for environments where getSetCookie is unavailable
  const sc = headers.get("set-cookie") || "";
  if (!sc) return "";
  return sc
    .split(/,\s*(?=[A-Za-z_]+=)/)
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function lookupUhaulPricing(
  pickup: string,
  dropoff: string,
  date: string,
  tripType: "one_way" | "in_town"
): Promise<UhaulLookupResult> {
  try {
    // Step 1: Visit Trucks page to establish session
    const s1 = await fetch("https://www.uhaul.com/Trucks/", {
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    await s1.arrayBuffer();
    let cookies = getCookies(s1.headers);

    // Step 2: Submit search form
    const formBody = new URLSearchParams({
      Scenario: "TruckOnly",
      IsActionFrom: "False",
      UsedGeocoded: "false",
      PreviouslySharedLocation: "false",
      PreviouslySharedLocationDetail: "",
      PickupLocation: pickup,
      DropoffLocation: tripType === "one_way" ? dropoff : "",
      PickupDate: date,
    });

    const s2 = await fetch("https://www.uhaul.com/EquipmentSearch/", {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.uhaul.com/Trucks/",
        Origin: "https://www.uhaul.com",
        Cookie: cookies,
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
      },
      body: formBody.toString(),
      redirect: "follow",
    });
    const s2cookies = getCookies(s2.headers);
    if (s2cookies) cookies = cookies + "; " + s2cookies;
    await s2.arrayBuffer();

    // Step 3: Fetch rates page
    const s3 = await fetch(
      "https://www.uhaul.com/Reservations/RatesTrucks/",
      {
        headers: {
          ...BROWSER_HEADERS,
          Referer: "https://www.uhaul.com/Trucks/",
          Cookie: cookies,
        },
        redirect: "follow",
      }
    );

    let html = s3.ok ? await s3.text() : "";

    // If direct fetch didn't return rates (bot detection), try ScrapFly
    if (!html.includes("Rates for")) {
      const sfHtml = await fetchViaScrapFly(pickup, tripType === "one_way" ? dropoff : "", date);
      if (sfHtml) html = sfHtml;
    }

    if (!html || !html.includes("Rates for")) {
      return {
        success: false,
        pickup,
        dropoff: tripType === "one_way" ? dropoff : null,
        date,
        tripType,
        trucks: [],
        error: "Could not retrieve U-Haul pricing. Enter costs manually below.",
      };
    }

    // Strip HTML to text
    const text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ");

    const trucks: UhaulPriceResult[] = [];
    const isInTown = tripType === "in_town";

    if (isInTown) {
      // In-town: base rate + per-mile
      const pattern =
        /(\d+)'\s*(?:Truck|Cargo Van|Pickup Truck)[\s\S]*?\$([0-9,]+(?:\.\d{2})?)[\s\S]*?plus \$([0-9.]+)\/mile/gi;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const size = m[1];
        const baseRate = parseFloat(m[2].replace(",", ""));
        const mileageRate = parseFloat(m[3]);
        if (!trucks.find((t) => t.truckSize === size + "ft")) {
          const desc = extractDescription(text, m.index);
          trucks.push({
            truckSize: size + "ft",
            price: baseRate,
            description: desc,
            baseRate,
            mileageRate,
          });
        }
      }
    } else {
      // One-way: flat price
      const pattern =
        /(\d+)'\s*(?:Truck|Cargo Van|Pickup Truck)[\s\S]*?(?:\$([\d,]+\.\d{2})|Not available)/gi;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(text)) !== null) {
        const size = m[1];
        const price = m[2] ? parseFloat(m[2].replace(",", "")) : null;
        if (!trucks.find((t) => t.truckSize === size + "ft")) {
          const desc = extractDescription(text, m.index);
          trucks.push({ truckSize: size + "ft", price, description: desc });
        }
      }
    }

    // Included days/miles (one-way)
    const rateMatch = text.match(
      /up to (\d+) days? of use and ([\d,]+) miles/i
    );
    const includedDays = rateMatch ? parseInt(rateMatch[1]) : 0;
    const includedMiles = rateMatch
      ? parseInt(rateMatch[2].replace(",", ""))
      : 0;

    const available = trucks.filter((t) => t.price !== null);

    if (available.length === 0) {
      const hasRates = text.includes("Rates for");
      return {
        success: false,
        pickup,
        dropoff: tripType === "one_way" ? dropoff : null,
        date,
        tripType,
        trucks: [],
        error: hasRates
          ? `Found rates page but couldn't parse prices. Try a different date or enter costs manually.`
          : `U-Haul didn't return pricing (${html.length} bytes). Try again or enter costs manually.`,
      };
    }

    return {
      success: true,
      pickup,
      dropoff: tripType === "one_way" ? dropoff : null,
      date,
      tripType,
      trucks: available,
      includedDays: includedDays || undefined,
      includedMiles: includedMiles || undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      pickup,
      dropoff: tripType === "one_way" ? dropoff : null,
      date,
      tripType,
      trucks: [],
      error: err.message || "Failed to fetch U-Haul pricing",
    };
  }
}

// ScrapFly fallback for when direct HTTP is blocked by U-Haul's bot detection
async function fetchViaScrapFly(
  pickup: string,
  dropoff: string,
  date: string
): Promise<string | null> {
  const apiKey = process.env.SCRAPFLY_API_KEY;
  if (!apiKey) {
    console.log("[scrapfly] No SCRAPFLY_API_KEY set, skipping");
    return null;
  }
  console.log("[scrapfly] Using ScrapFly fallback for:", pickup, "->", dropoff);

  try {
    const sessionId = "uhaul_" + Date.now();
    const sfBase = "https://api.scrapfly.io/scrape";

    // Step 1: Visit trucks page (establishes session cookies)
    const s1Params = new URLSearchParams({
      key: apiKey,
      url: "https://www.uhaul.com/Trucks/",
      asp: "true",
      country: "us",
      session: sessionId,
    });
    const s1 = await fetch(`${sfBase}?${s1Params}`);
    await s1.arrayBuffer();

    // Step 2: Submit the search form via POST
    // ScrapFly POST: send the form body as the HTTP body of the request to ScrapFly
    const s2Params = new URLSearchParams({
      key: apiKey,
      url: "https://www.uhaul.com/EquipmentSearch/",
      asp: "true",
      country: "us",
      session: sessionId,
      "headers[Content-Type]": "application/x-www-form-urlencoded",
      "headers[X-Requested-With]": "XMLHttpRequest",
      "headers[Referer]": "https://www.uhaul.com/Trucks/",
      "headers[Origin]": "https://www.uhaul.com",
    });

    const formBody = new URLSearchParams({
      Scenario: "TruckOnly",
      IsActionFrom: "False",
      UsedGeocoded: "false",
      PreviouslySharedLocation: "false",
      PreviouslySharedLocationDetail: "",
      PickupLocation: pickup,
      DropoffLocation: dropoff,
      PickupDate: date,
    });

    const s2 = await fetch(`${sfBase}?${s2Params}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
    });
    await s2.arrayBuffer();

    // Step 3: Get the rates page
    const s3Params = new URLSearchParams({
      key: apiKey,
      url: "https://www.uhaul.com/Reservations/RatesTrucks/",
      asp: "true",
      country: "us",
      session: sessionId,
    });
    const s3 = await fetch(`${sfBase}?${s3Params}`);
    const data = await s3.json() as any;
    const html = data?.result?.content || "";
    console.log("[scrapfly] Step3 status:", s3.status, "content length:", html.length, "has rates:", html.includes("Rates for"));
    if (html.includes("Rates for")) return html;
    if (!html) console.log("[scrapfly] No content. Response:", JSON.stringify(data).substring(0, 500));
    return null;
  } catch (err: any) {
    console.log("[scrapfly] Error:", err.message || err);
    return null;
  }
}

function extractDescription(text: string, idx: number): string {
  const block = text.substring(idx, idx + 300);
  const m = block.match(
    /(?:Studio|Bedroom|Home|Small|Apartment|Deliveries)[^\n]*/i
  );
  if (!m) return "";
  return m[0]
    .replace(/\n.*/s, "")
    .replace(/\s{2,}/g, " ")
    .replace(/More Info.*/i, "")
    .replace(/\s*I$/, "")
    .trim();
}
