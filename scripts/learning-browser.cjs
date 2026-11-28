const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { build } = require("esbuild");
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH || "playwright-core",
);
(async () => {
  await build({
    define: {
      "import.meta.url": JSON.stringify(
        require("node:url").pathToFileURL(
          path.resolve("apps/api/tests/harness.ts"),
        ).href,
      ),
    },
    stdin: {
      contents:
        "export {harness} from './apps/api/tests/harness'; export {passwordHash} from './apps/api/src/passwords';export {default as worker} from './apps/api/src/index';export {encrypt} from './apps/api/src/oauth';export {runLiveJobs} from './apps/api/src/automation';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "apps/api/.wrangler/browser-account-harness.cjs",
  });
  const {
      harness,
      worker,
      encrypt,
      runLiveJobs,
    } = require("../apps/api/.wrangler/browser-account-harness.cjs"),
    h = harness();
  Object.assign(h.env, {
    MOCK_DELIVERY_ENABLED: "false",
    LIVE_EMAIL_ENABLED: "true",
    OAUTH_ENABLED: "true",
    LIVE_TEST_RECIPIENTS: "controlled@example.com,second@example.com",
    GMAIL_CLIENT_ID: "synthetic-client",
    GMAIL_CLIENT_SECRET: "synthetic-secret",
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  });
  const root = path.resolve("apps/web/out");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      for (const rule of JSON.parse(
        fs.readFileSync("apps/web/vercel.json", "utf8"),
      ).headers) {
        if (
          rule.source === "/:path*" ||
          (rule.source === "/api/:path*" && url.pathname.startsWith("/api/"))
        )
          for (const header of rule.headers)
            res.setHeader(header.key, header.value);
      }
      if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const fixtureHeaders = { ...req.headers };
        if (fixtureHeaders.origin === base)
          fixtureHeaders.origin = h.env.APP_ORIGIN;
        const response = await worker.fetch(
          new Request(h.env.APP_ORIGIN + req.url, {
            method: req.method,
            headers: fixtureHeaders,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          }),
          h.env,
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      let target = path.resolve(root, "." + decodeURIComponent(url.pathname));
      if (!target.startsWith(root + path.sep) && target !== root) {
        res.writeHead(403).end();
        return;
      }
      if (fs.existsSync(target) && fs.statSync(target).isDirectory())
        target = path.join(target, "index.html");
      if (!fs.existsSync(target)) {
        res.writeHead(404).end();
        return;
      }
      const ext = path.extname(target);
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".ico": "image/x-icon",
          ".jpeg": "image/jpeg",
        }[ext] || "application/octet-stream",
      );
      res.end(fs.readFileSync(target));
    } catch {
      res.writeHead(500).end("Local QA error");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base =
    process.env.LEARNING_ASSET_BASE ||
    "http://localhost:" + server.address().port; // HTTPS Worker origin retained in this in-memory transport adapter only.
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    if (process.env.LEARNING_ASSET_BASE) {
      assert.equal(base, "https://ms-professor-agent-malang43.vercel.app");
      await context.route("**/*", async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (url.origin !== base) {
          await route.abort();
          return;
        }
        if (!url.pathname.startsWith("/api/")) {
          assert.equal(req.method(), "GET");
          await route.continue();
          return;
        }
        // Production assets, entirely local fixture API. No production API request leaves Chromium.
        const headers = { ...req.headers(), origin: h.env.APP_ORIGIN };
        const response = await worker.fetch(
          new Request(h.env.APP_ORIGIN + url.pathname + url.search, {
            method: req.method(),
            headers,
            body: ["GET", "HEAD"].includes(req.method())
              ? undefined
              : req.postDataBuffer(),
          }),
          h.env,
        );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
    }
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let mutations = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/") && req.method() !== "GET")
        mutations.push(new URL(req.url()).pathname);
    });
    const nav = async (name) => {
      if (await page.locator(".mobile-toggle").isVisible())
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
      await page
        .locator("aside.sidebar nav")
        .getByRole("button", { name, exact: true })
        .click();
    };
    await page.goto(base, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .first()
      .click();
    await page.getByLabel("First name", { exact: true }).fill("Learning");
    await page.getByLabel("Last name", { exact: true }).fill("Student");
    await page.getByLabel("Display name").fill("Learning Student");
    await page.getByLabel("Email address").fill("learning@example.invalid");
    await page
      .locator("input[name=password]")
      .first()
      .fill("Maple river lantern planets 47");
    await page
      .locator("input[name=confirm_password]")
      .fill("Maple river lantern planets 47");
    await page.locator("input[name=accept_terms]").check();
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "Sign in with password" }).waitFor();
    await page
      .locator("input[name=password]")
      .first()
      .fill("Maple river lantern planets 47");
    await page.getByRole("button", { name: "Sign in with password" }).click();
    await page
      .getByRole("heading", {
        name: "Verify your email to unlock mailbox actions",
      })
      .waitFor();
    assert(
      await page
        .getByRole("button", {
          name: "Verification email unavailable",
          exact: true,
        })
        .isDisabled(),
    );
    await page
      .getByRole("button", { name: "Start welcome tour", exact: true })
      .click();
    await page.getByRole("region", { name: "Product tutorial" }).waitFor();
    await page
      .getByRole("region", { name: "Product tutorial" })
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.getByRole("region", { name: "Product tutorial" }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "Resume tutorial", exact: true })
      .click();
    await page
      .getByRole("region", { name: "Product tutorial" })
      .getByRole("button", { name: "Skip / resume later" })
      .click();
    await page.getByRole('button',{name:'Replay welcome tour',exact:true}).click();
    for(let count=0;count<20;count++) {const panel=page.getByRole('region',{name:'Product tutorial'});if(await panel.getByRole('button',{name:'Finish',exact:true}).count()){await panel.getByRole('button',{name:'Finish',exact:true}).click();break;}await panel.getByRole('button',{name:'Next',exact:true}).click();}
    assert.equal(await page.getByRole('region',{name:'Product tutorial'}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Resume tutorial',exact:true}).count(),0);
    await nav('Overview');
    await page.screenshot({
      path: "apps/api/.wrangler/learning-dashboard-desktop.png",
      fullPage: true,
    });
    await nav("Getting Started");
    await page
      .getByRole("heading", { name: "Getting Started", exact: true })
      .last()
      .waitFor();
    assert.equal(await page.locator(".guide-menu button").count(), 14);
    await page.getByRole("button", { name: "Mark read & continue" }).click();
    assert(
      await page
        .getByText("1 of 14 lessons completed", { exact: true })
        .isVisible(),
    );
    await page.getByRole("button", { name: "B · Complete outreach" }).click();
    await page.getByRole("button", { name: "Play / replay" }).click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Next step", exact: true }).click();
    assert(
      await page
        .getByRole("heading", { name: "Upload a CV", exact: true })
        .isVisible(),
    );
    await nav("Practice Campaign");
    mutations = [];
    await page.getByRole("button", { name: "Simulate sample import" }).click();
    assert(
      await page
        .getByRole("heading", { name: "Amina Noor", exact: true })
        .isVisible(),
    );
    await page
      .getByRole("button", { name: "Next: dates, follow-ups & CV" })
      .click();
    await page.getByLabel("Attach Fictional CV.pdf to follow-ups").check();
    await page.getByRole("button", { name: "Next: complete review" }).click();
    await page
      .getByRole("button", { name: "Simulate Approval", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Animate next scheduled time" })
      .click();
    await page.getByText(/Scheduled: 2 · Sent: 2 · Cancelled: 0/).waitFor();
    await page
      .getByRole("button", { name: "Simulate reply: Amina Noor" })
      .click();
    await page.getByText(/Scheduled: 1 · Sent: 2 · Cancelled: 1/).waitFor();
    assert.deepEqual(mutations, []);
    assert.equal(
      h.db.prepare("SELECT count(*) n FROM campaign_approvals").get().n,
      0,
    );
    assert.equal(h.db.prepare("SELECT count(*) n FROM messages").get().n, 0);
    await page.screenshot({
      path: "apps/api/.wrangler/learning-practice-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "apps/api/.wrangler/learning-practice-mobile.png",
      fullPage: true,
    });
    await nav("Overview");
    await page.getByRole("button", { name: "Use dark mode" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "apps/api/.wrangler/learning-dashboard-mobile-dark.png",
      fullPage: true,
    });
    const owner = h.db
      .prepare("SELECT id FROM users WHERE email=?")
      .get("learning@example.invalid").id;
    Object.assign(h.env, {
      MAIL_PROVIDER: "brevo",
      MAIL_SENDER_VERIFIED: "true",
      MAIL_DELIVERY_ENABLED: "true",
      MAIL_FREE_PLAN_CONFIRMED: "true",
      MAIL_FROM: "operator@example.com",
      BREVO_API_KEY: "synthetic-not-a-secret",
    });
    let deliveredLink = "";
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      assert.equal(url, "https://api.brevo.com/v3/smtp/email");
      const payload = JSON.parse(init.body);
      deliveredLink = payload.textContent.match(/https:\/\/\S+/)[0];
      return Response.json({ messageId: "synthetic" }, { status: 201 });
    };
    await page
      .getByRole("button", { name: "Refresh verification status", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Resend Verification Email", exact: true })
      .click();
    await page.getByText(/If the account is eligible/).waitFor();
    assert(deliveredLink);
    global.fetch = originalFetch;
    const verification = new URLSearchParams(
      new URL(deliveredLink).hash.slice(1),
    ).get("verify");
    await page.goto(base + "/#verify=" + verification, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "Verify my email" }).click();
    await page.getByText("Email verified. You can now sign in.").waitFor();
    assert.equal(new URL(page.url()).hash, "");
    await page.getByRole("button", { name: "Continue to sign in" }).click();
    await page
      .getByRole("heading", { name: "Your email is verified", exact: true })
      .waitFor();
    await nav("Academic profile");
    await page
      .getByLabel("University", { exact: true })
      .fill("Example University");
    await page.getByLabel("Degree / program").fill("BS Computer Engineering");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await nav("Outreach");
    assert.equal(
      await page.getByRole("region", { name: "Product tutorial" }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS isolated Chromium: signup, unavailable verification, secure link redemption, welcome/skip/resume, 14 lessons, demonstrations, practice attachment/approval/reply cancellation with zero API mutations, desktop/mobile/dark/reduced-motion.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    h.db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
