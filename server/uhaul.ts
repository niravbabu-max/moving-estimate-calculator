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

// Full browser-like headers
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
    const s3 = await fetch("https://www.uhaul.com/Reservations/RatesTrucks/", {
      headers: {
        ...BROWSER_HEADERS,
        Referer: "https://www.uhaul.com/Trucks/",
        Cookie: cookies,
      },
      redirect: "follow",
    });

    let html = s3.ok ? await s3.text() : "";

    // Retry direct HTTP once more before falling back to ScrapFly
    if (!html.includes("Rates for")) {
      console.log("[uhaul] Direct HTTP miss, retrying once...");
      await new Promise(r => setTimeout(r, 2000));
      try {
        const r1 = await fetch("https://www.uhaul.com/Trucks/", { headers: BROWSER_HEADERS, redirect: "follow" });
        await r1.arrayBuffer();
        let rc = getCookies(r1.headers);
        const r2 = await fetch("https://www.uhaul.com/EquipmentSearch/", {
          method: "POST",
          headers: { ...BROWSER_HEADERS, "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest", Referer: "https://www.uhaul.com/Trucks/", Origin: "https://www.uhaul.com", Cookie: rc, "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin" },
          body: formBody.toString(), redirect: "follow",
        });
        const rc2 = getCookies(r2.headers);
        if (rc2) rc = rc + "; " + rc2;
        await r2.arrayBuffer();
        const r3 = await fetch("https://www.uhaul.com/Reservations/RatesTrucks/", { headers: { ...BROWSER_HEADERS, Referer: "https://www.uhaul.com/Trucks/", Cookie: rc }, redirect: "follow" });
        if (r3.ok) { const retryHtml = await r3.text(); if (retryHtml.includes("Rates for")) html = retryHtml; }
      } catch { /* ignore, fall through to ScrapFly */ }
    }

    // If still no rates, try ScrapFly with JS form interaction (up to 2 attempts)
    if (!html.includes("Rates for")) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[uhaul] ScrapFly attempt ${attempt}/2`);
        const sfHtml = await fetchViaScrapFly(
          pickup,
          tripType === "one_way" ? dropoff : "",
          date
        );
        if (sfHtml && sfHtml.includes("Rates for")) {
          html = sfHtml;
          break;
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
      }
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

    return parseUhaulHtml(html, pickup, dropoff, date, tripType);
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

// ScrapFly fallback: 3-step HTTP through ScrapFly's residential proxy with explicit cookie threading.
// Direct HTTP sometimes fails because Railway's IP is flagged; ScrapFly's US residential IPs are cleaner.
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
  console.log("[scrapfly] 3-step residential proxy for:", pickup, "->", dropoff);

  const sfBase = "https://api.scrapfly.io/scrape";

  try {
    // Step 1: GET /Trucks/ — establish session and get cookies
    const s1Resp = await fetch(`${sfBase}?${new URLSearchParams({
      key: apiKey,
      url: "https://www.uhaul.com/Trucks/",
      asp: "true",
      country: "us",
    })}`);
    const s1Data = await s1Resp.json() as any;
    const cookieJar = new Map<string, string>();
    for (const c of (s1Data?.result?.cookies || [])) cookieJar.set(c.name, c.value);
    console.log("[scrapfly] Step1 url:", s1Data?.result?.url, "| cookies:", cookieJar.size);

    const cookieStr = () => Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");

    // Step 2: POST /EquipmentSearch/ with session cookies
    const formData = new URLSearchParams({
      Scenario: "TruckOnly",
      IsActionFrom: "False",
      UsedGeocoded: "false",
      PreviouslySharedLocation: "false",
      PreviouslySharedLocationDetail: "",
      PickupLocation: pickup,
      DropoffLocation: dropoff,
      PickupDate: date,
    });

    const s2Params = new URLSearchParams({
      key: apiKey,
      url: "https://www.uhaul.com/EquipmentSearch/",
      asp: "true",
      country: "us",
      "headers[Cookie]": cookieStr(),
      "headers[Content-Type]": "application/x-www-form-urlencoded",
      "headers[Referer]": "https://www.uhaul.com/Trucks/",
      "headers[Origin]": "https://www.uhaul.com",
      "headers[X-Requested-With]": "XMLHttpRequest",
    });

    const s2Resp = await fetch(`${sfBase}?${s2Params}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    });
    const s2Data = await s2Resp.json() as any;
    for (const c of (s2Data?.result?.cookies || [])) cookieJar.set(c.name, c.value);
    console.log("[scrapfly] Step2 url:", s2Data?.result?.url, "| cookies now:", cookieJar.size);

    // Step 3: GET /RatesTrucks/ with all accumulated cookies
    const s3Resp = await fetch(`${sfBase}?${new URLSearchParams({
      key: apiKey,
      url: "https://www.uhaul.com/Reservations/RatesTrucks/",
      asp: "true",
      render_js: "true",
      country: "us",
      wait: "3000",
      "headers[Cookie]": cookieStr(),
      "headers[Referer]": "https://www.uhaul.com/Trucks/",
    })}`);
    const s3Data = await s3Resp.json() as any;
    const html = s3Data?.result?.content || "";

    console.log("[scrapfly] Step3 url:", s3Data?.result?.url, "| len:", html.length, "| rates:", html.includes("Rates for"));

    if (html.length > 5000) return html;
    return null;
  } catch (err: any) {
    console.log("[scrapfly] Error:", err.message || err);
    return null;
  }
}

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

  const rateMatch = text.match(/up to (\d+) days? of use and ([\d,]+) miles/i);
  const includedDays = rateMatch ? parseInt(rateMatch[1]) : 0;
  const includedMiles = rateMatch ? parseInt(rateMatch[2].replace(",", "")) : 0;
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
        ? "Found rates page but couldn't parse prices. Try a different date or enter costs manually."
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
