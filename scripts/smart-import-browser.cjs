const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { build } = require("esbuild");
const staticFetch = global.fetch;
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
        const headers = Object.fromEntries(response.headers);
        if (headers.location?.startsWith(h.env.APP_ORIGIN))
          headers.location =
            base + headers.location.slice(h.env.APP_ORIGIN.length);
        if (response.headers.getSetCookie().length)
          headers["set-cookie"] = response.headers.getSetCookie();
        res.writeHead(response.status, headers);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (process.env.SMART_IMPORT_FRONTEND_ORIGIN) {
        const upstream = await staticFetch(
          new URL(url.pathname, process.env.SMART_IMPORT_FRONTEND_ORIGIN),
          { signal: AbortSignal.timeout(20000) },
        );
        res.writeHead(upstream.status, {
          "Content-Type":
            upstream.headers.get("content-type") || "application/octet-stream",
        });
        res.end(Buffer.from(await upstream.arrayBuffer()));
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
  const base = "http://localhost:" + server.address().port; // HTTPS Worker origin retained in this in-memory transport adapter only.
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
    const pair = await generateKeyPair("RS256", { extractable: true }),
      jwk = {
        ...(await exportJWK(pair.publicKey)),
        kid: "browser-google-key",
        alg: "RS256",
        use: "sig",
      };
    Object.assign(h.env, {
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "fixture-site",
      TURNSTILE_SECRET_KEY: "fixture-secret",
      LIVE_OWNER_USER_IDS: "existing-owner",
    });
    let currentAuth = null,
      mailbox = "new.student@gmail.com";
    const providerCalls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      url = String(url);
      providerCalls.push(url);
      if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify")
        return Response.json({
          success: true,
          hostname: new URL(h.env.APP_ORIGIN).hostname,
          action: "signup",
          challenge_ts: new Date().toISOString(),
        });
      if (url === "https://oauth2.googleapis.com/token") {
        const state = currentAuth.searchParams.get("state"),
          row = h.db
            .prepare("SELECT * FROM oauth_states WHERE state_hash=?")
            .get(
              require("node:crypto")
                .createHash("sha256")
                .update(state)
                .digest("hex"),
            );
        assert(!row, "State must already be consumed before code exchange");
        const now = Math.floor(Date.now() / 1000);
        const id_token = await new SignJWT({
          iss: "https://accounts.google.com",
          aud: h.env.GMAIL_CLIENT_ID,
          sub: "browser-stable-google-sub",
          email: mailbox,
          email_verified: true,
          nonce: currentAuth.searchParams.get("nonce"),
          iat: now,
          exp: now + 3600,
        })
          .setProtectedHeader({ alg: "RS256", kid: "browser-google-key" })
          .sign(pair.privateKey);
        return Response.json({
          access_token: "browser-access",
          refresh_token: "browser-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope:
            "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
          id_token,
        });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/certs")
        return Response.json({ keys: [jwk] });
      if (url === "https://openidconnect.googleapis.com/v1/userinfo")
        return Response.json({
          sub: "browser-stable-google-sub",
          email: mailbox,
          email_verified: true,
        });
      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile")
        return Response.json({ emailAddress: mailbox });
      throw Error("Unexpected external traffic forbidden");
    };
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [];
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route(
      "https://challenges.cloudflare.com/turnstile/**",
      (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: "window.turnstile={render:function(el,options){var field=document.createElement('input');field.type='hidden';field.name='cf-turnstile-response';field.value='browser-turnstile-fixture';el.appendChild(field);setTimeout(function(){options.callback('browser-turnstile-fixture');},0);return 'fixture-widget';},remove:function(){}};if(window.onTurnstileLoad)window.onTurnstileLoad();",
        }),
    );
    await context.route("https://accounts.google.com/**", async (route) => {
      currentAuth = new URL(route.request().url());
      assert.equal(
        currentAuth.searchParams.get("code_challenge_method"),
        "S256",
      );
      assert(currentAuth.searchParams.get("nonce"));
      await route.fulfill({
        contentType: "text/html",
        body:
          '<!doctype html><html><body><h1>Isolated Google consent fixture</h1><a href="' +
          base +
          "/api/oauth/gmail/callback?code=fixture-code&state=" +
          currentAuth.searchParams.get("state") +
          '">Authorize matching Google account</a></body></html>',
      });
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
    await page.getByLabel("First name", { exact: true }).fill("Google");
    await page.getByLabel("Last name", { exact: true }).fill("Student");
    await page.getByLabel("Display name").fill("Google Student");
    await page.getByLabel("Email address").fill(mailbox);
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
    assert.equal(
      h.db
        .prepare("SELECT email_verified_at FROM users WHERE email=?")
        .get(mailbox).email_verified_at,
      null,
    );
    await page
      .locator("input[name=password]")
      .first()
      .fill("Maple river lantern planets 47");
    await page.getByRole("button", { name: "Sign in with password" }).click();
    await page
      .getByRole("button", {
        name: "Verify with Google & Connect Gmail",
        exact: true,
      })
      .waitFor();
    // A mismatched identity must return helpful guidance without connecting anything.
    mailbox = "different@gmail.com";
    await page
      .getByRole("button", {
        name: "Verify with Google & Connect Gmail",
        exact: true,
      })
      .click();
    await page
      .getByRole("link", { name: "Authorize matching Google account" })
      .click();
    await page
      .getByText(/The Google email does not match your registered email/)
      .waitFor();
    assert.equal(h.db.prepare("SELECT count(*) n FROM connections").get().n, 0);
    assert.equal(
      h.db.prepare("SELECT count(*) n FROM google_student_identities").get().n,
      0,
    );
    mailbox = "new.student@gmail.com";
    await page
      .getByRole("button", {
        name: "Verify with Google & Connect Gmail",
        exact: true,
      })
      .click();
    await page
      .getByRole("link", { name: "Authorize matching Google account" })
      .click();
    await page
      .getByRole("heading", { name: "Your email is verified", exact: true })
      .waitFor();
    await page
      .getByText("Outreach ready ? review and explicit approval required", {
        exact: true,
      })
      .waitFor();
    assert(
      await page.getByText("Gmail connected", { exact: true }).isVisible(),
    );
    assert.equal(
      h.db.prepare("SELECT google_sub FROM google_student_identities").get()
        .google_sub,
      "browser-stable-google-sub",
    );
    await page.screenshot({
      path: "apps/api/.wrangler/google-activation-dashboard.png",
      fullPage: true,
    });
    await nav("Settings");
    assert(
      (await page.getByText("new.student@gmail.com", { exact: true }).count()) >
        0,
    );
    await nav("Documents");
    await page.locator('input[type="file"]').setInputFiles({
      name: "Smart Test CV.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Fictional CV for isolated Smart Import browser testing",
      ),
    });
    await page.getByText("Smart Test CV.txt", { exact: true }).waitFor();
    await nav("Smart Import");
    await page
      .getByRole("heading", { name: "Build a campaign your way" })
      .waitFor();
    assert.equal(
      await page
        .locator(".smart-columns")
        .evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        ),
      2,
    );
    const { build: bundle } = require("esbuild");
    const smart = await bundle({
      entryPoints: ["shared/smart-import.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
    });
    const module = { exports: {} };
    new Function("module", "exports", "require", smart.outputFiles[0].text)(
      module,
      module.exports,
      require,
    );
    const { exampleRows, textTemplate, tableTemplate } = module.exports;
    await page
      .getByRole("button", { name: "Copy Prompt for AI", exact: true })
      .click();
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())).includes(
        "verified official professor information",
      ),
    );
    await page
      .getByRole("button", { name: "Copy Text Template", exact: true })
      .click();
    assert(
      (await page.evaluate(() => navigator.clipboard.readText())).startsWith(
        "=== PROFESSOR ===",
      ),
    );
    const input = exampleRows();
    input[0].body =
      'Dear Professor,\n\nExact UTF-8: ??????? ??, "quoted" and <script>window.__smartInjected=true</script>\nRegards';
    const bad = [{ ...input[0], email: "broken" }];
    await page
      .getByLabel("Campaign text (up to 1 MiB)")
      .fill(textTemplate(bad));
    await page
      .getByRole("button", { name: "Parse and preview", exact: true })
      .click();
    assert(
      await page
        .getByRole("button", { name: "Add to Campaign", exact: true })
        .isDisabled(),
    );
    await page
      .getByLabel("email professor 1", { exact: true })
      .fill(input[0].email);
    await page
      .getByLabel("Local sending time professor 1")
      .fill(
        new Date(Date.now() + 86400000).toISOString().slice(0, 10) + "T10:00",
      );
    await page.getByLabel("Timezone selector professor 1").fill("Asia/Seoul");
    await page
      .getByRole("button", { name: "Convert local time to UTC", exact: true })
      .click();
    assert(
      (
        await page
          .getByLabel("scheduled_at professor 1", { exact: true })
          .inputValue()
      ).includes("T01:00:00.000Z"),
    );
    assert.equal(
      await page.getByLabel("body professor 1", { exact: true }).inputValue(),
      input[0].body,
    );
    assert.equal(await page.evaluate(() => window.__smartInjected), undefined);
    await page.screenshot({
      path: process.env.SMART_IMPORT_FRONTEND_ORIGIN
        ? "apps/api/.wrangler/smart-import-live-desktop.png"
        : "apps/api/.wrangler/smart-import-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Add to Campaign", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve Complete Campaign", exact: true })
      .waitFor();
    await page
      .getByRole("checkbox", {
        name: "Attach Smart Test CV.txt to initial emails",
        exact: true,
      })
      .check();
    assert(
      await page
        .getByRole("checkbox", {
          name: "Attach Smart Test CV.txt to initial emails",
          exact: true,
        })
        .isChecked(),
    );
    assert.equal(
      h.db.prepare("SELECT count(*) n FROM campaign_approvals").get().n,
      0,
    );
    const imported = h.db
      .prepare("SELECT * FROM messages ORDER BY rowid DESC LIMIT 1")
      .get();
    assert.equal(imported.body, input[0].body);
    assert.equal(imported.status, "draft");
    assert.equal(imported.approved, 0);
    assert.equal(imported.authorized, 0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Paste Table", exact: true })
      .click();
    await page
      .getByLabel("Campaign table (up to 1 MiB)")
      .fill(tableTemplate(input));
    await page
      .getByRole("button", { name: "Parse and preview", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("body professor 1", { exact: true }).inputValue(),
      input[0].body,
    );
    await page
      .getByRole("button", { name: "Excel / CSV Upload", exact: true })
      .click();
    await page.getByLabel("Smart Import file").setInputFiles({
      name: "smart.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(tableTemplate(input)),
    });
    assert.equal(
      await page.getByLabel("body professor 1", { exact: true }).inputValue(),
      input[0].body,
    );
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download Excel Template", exact: true })
      .click();
    const workbookDownload = await downloadPromise;
    await workbookDownload.saveAs(
      "apps/api/.wrangler/smart-browser-template.xlsx",
    );
    await page
      .getByLabel("Smart Import file")
      .setInputFiles("apps/api/.wrangler/smart-browser-template.xlsx");
    await page.getByLabel("name professor 1", { exact: true }).waitFor();
    assert(
      await page
        .getByRole("button", { name: "Add to Campaign", exact: true })
        .isEnabled(),
    );
    await page
      .getByLabel("Smart Import file")
      .setInputFiles("apps/web/public/professors-email-template.xlsx");
    await page.getByLabel("name professor 1", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await nav("Overview");
    await nav("Smart Import");
    assert.equal(
      await page.locator(".smart-template").getAttribute("open"),
      null,
    );
    await page.locator(".smart-template>summary").click();
    assert(
      await page
        .getByRole("button", { name: "Copy Text Template", exact: true })
        .isVisible(),
    );
    assert(
      await page
        .getByRole("button", { name: "Copy Prompt for AI", exact: true })
        .isVisible(),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page
      .getByRole("button", { name: "Try a fictional example", exact: true })
      .click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert(
      await page
        .locator(".smart-preview .table-wrap")
        .evaluate(
          (el) =>
            el.scrollWidth > el.clientWidth &&
            getComputedStyle(el).overflowX !== "visible",
        ),
    );
    await page.locator(".smart-template>summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.locator(".smart-template").getAttribute("open"),
      null,
    );
    await page.getByRole("button", { name: "Use dark mode" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({
      path: process.env.SMART_IMPORT_FRONTEND_ORIGIN
        ? "apps/api/.wrangler/smart-import-live-mobile-dark.png"
        : "apps/api/.wrangler/smart-import-mobile-dark.png",
      fullPage: true,
    });
    await nav("Practice Campaign");
    await page
      .getByRole("button", { name: "Try a fictional example", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Simulate Add to Campaign", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Amina Noor", exact: true })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Next: dates, follow-ups & CV",
        exact: true,
      })
      .click();
    assert(
      await page
        .getByRole("checkbox", {
          name: "Attach Fictional CV.pdf to initial emails",
          exact: true,
        })
        .isChecked(),
    );
    await page
      .getByRole("button", { name: "Next: complete review", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Simulate Approval", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Animate next scheduled time", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Simulate reply: Amina Noor", exact: true })
      .waitFor({ state: "visible" });
    await page
      .getByRole("button", { name: "Simulate reply: Amina Noor", exact: true })
      .click();
    assert(
      (await page.locator(".practice-statistics").innerText()).includes(
        "Cancelled: 1",
      ),
    );
    assert.equal(h.db.prepare("SELECT count(*) n FROM messages").get().n, 1);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Use light mode" }).click();
    await nav("Professors");
    const csv =
      "name,email,university,interests,subject,body,scheduled_at,timezone\nFictional Professor,professor@example.com,Example University,Robotics,Research enquiry,Fictional dry-run content," +
      new Date(Date.now() + 86400000).toISOString() +
      ",Asia/Karachi";
    await page.locator('input[accept=".csv,.xlsx"]').setInputFiles({
      name: "google-dry-run.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page
      .getByRole("button", { name: /Manual \/ Use Excel content/ })
      .click();
    await page
      .getByRole("button", { name: "Review entire campaign once", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Approve Complete Campaign", exact: true })
      .waitFor();
    assert.equal(
      h.db.prepare("SELECT count(*) n FROM campaign_approvals").get().n,
      0,
    );
    assert.equal(
      h.db.prepare("SELECT count(*) n FROM message_authorizations").get().n,
      0,
    );
    assert.equal(h.db.prepare("SELECT count(*) n FROM transports").get().n, 0);
    assert.equal(h.db.prepare("SELECT count(*) n FROM deliveries").get().n, 0);
    assert.equal(
      providerCalls.filter((url) => url.includes("/messages/send")).length,
      0,
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await nav("Overview");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Use dark mode" }).click();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: "apps/api/.wrangler/google-activation-mobile-dark.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    global.fetch = originalFetch;
    console.log(
      "PASS Smart Import: text/table/CSV/XLSX, editing, UTC conversion, safe markup, draft-only creation, existing CV selection, mobile/dark/reduced-motion, isolated practice, legacy CSV review. Also registration + Turnstile, login, signed Google OAuth mismatch rejection/retry, matching activation + Gmail + outreach access, CSV review without any approval/transport/send, desktop/mobile/dark. Provider traffic intercepted.",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    h.db.close();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
