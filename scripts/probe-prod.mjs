const base = "https://obecinno.com";

async function main() {
  for (const path of ["/api/health/supabase", "/"]) {
    try {
      const r = await fetch(base + path, {
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0" },
      });
      const text = (await r.text()).slice(0, 300).replace(/\s+/g, " ");
      console.log(path, r.status, r.headers.get("content-type"), text);
    } catch (e) {
      console.log(path, "FAIL", e.message);
    }
  }

  const html = await (await fetch(base)).text();
  const scripts = [...html.matchAll(/src="(\/_next\/static[^"]+)"/g)].map((m) => m[1]);
  console.log("script count", scripts.length);

  let supabaseUrl = null;
  let anonKey = null;

  for (const s of scripts) {
    const js = await (await fetch(base + s)).text();
    const urlMatch = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
    if (urlMatch) {
      supabaseUrl = urlMatch[0];
      console.log("supabase url from", s, supabaseUrl);
    }
    // JWT-ish anon keys often appear near supabase createClient
    const keyMatch = js.match(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
    if (urlMatch && keyMatch) {
      anonKey = keyMatch[0];
      console.log("anon key length", anonKey.length);
      break;
    }
  }

  if (!supabaseUrl) {
    console.log("No supabase URL found in first-pass scripts; scanning all…");
    for (const s of scripts) {
      const js = await (await fetch(base + s)).text();
      const urlMatch = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
      if (urlMatch) {
        supabaseUrl = urlMatch[0];
        const keyMatch = js.match(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
        anonKey = keyMatch?.[0] ?? null;
        console.log("found later in", s, supabaseUrl, "key?", Boolean(anonKey));
        break;
      }
    }
  }

  if (!supabaseUrl) {
    console.log("Could not discover supabase URL from bundle");
    return;
  }

  // Probe REST root
  const headers = anonKey
    ? {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      }
    : { "Content-Type": "application/json" };

  for (const [label, req] of [
    [
      "rest root",
      () => fetch(`${supabaseUrl}/rest/v1/`, { headers }),
    ],
    [
      "rpc get_school_totals",
      () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/get_school_totals`, {
          method: "POST",
          headers,
          body: "{}",
        }),
    ],
    [
      "rpc get_district_stats",
      () =>
        fetch(`${supabaseUrl}/rest/v1/rpc/get_district_stats`, {
          method: "POST",
          headers,
          body: "{}",
        }),
    ],
  ]) {
    try {
      const r = await req();
      const body = (await r.text()).slice(0, 400);
      console.log(label, r.status, body);
    } catch (e) {
      console.log(label, "FAIL", e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
