const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const staticFetch=global.fetch;
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
    outfile: "apps/api/.wrangler/capacity-browser-harness.cjs",
  });
  const {
      harness,
      worker,
      encrypt,
      runLiveJobs,
    } = require("../apps/api/.wrangler/capacity-browser-harness.cjs"),
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
      if(process.env.REVISION_ASSET_URL){const upstream=await staticFetch(new URL(url.pathname,process.env.REVISION_ASSET_URL));res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/octet-stream'});res.end(Buffer.from(await upstream.arrayBuffer()));return;}
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

  const owner=await h.user("management-qa@example.com");h.env.LIVE_OWNER_USER_IDS=owner.id;
  const connection=crypto.randomUUID();const token=await encrypt(h.env,owner.id+":gmail:tokens:v1",{access_token:"synthetic",refresh_token:"synthetic",expires_in:3600});
  h.db.prepare("INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,'gmail','qa@example.com','qa-mailbox','gmail.send gmail.readonly',?,?)").run(connection,owner.id,token,Date.now()+86400000);
  h.db.prepare("INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','fixture')").run(connection,Date.now());

  global.fetch=async()=>{throw Error('External traffic forbidden');};
  const professor=crypto.randomUUID();h.db.prepare("INSERT INTO professors(id,user_id,name,email) VALUES(?,?,'Historical','historical@example.com')").run(professor,owner.id);
  const insert=h.db.prepare("INSERT INTO messages(id,user_id,professor_id,subject,body,mode,status,scheduled_at,timezone) VALUES(?,?,?,'Historical','Fixture','manual',?,'2027-01-01','UTC')");
  for(let i=0;i<100;i++)insert.run(crypto.randomUUID(),owner.id,professor,'sent');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try {
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   await context.addCookies([{name:'session',value:owner.session.split('=')[1],url:base}]);
   await context.addInitScript(()=>localStorage.setItem('ms-tour-v1:management-qa@example.com',JSON.stringify({dismissed:true})));
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   const page=await context.newPage();page.setDefaultTimeout(15000);
   const seq=JSON.stringify(Array.from({length:5},()=>({subject:'Follow-up',body:'Fixture',delay_value:1,delay_unit:'days',relative_to:'previous'})));
   const quote=s=>'"'+s.replaceAll('"','""')+'"';
   const csv='name,email,subject,body,scheduled_at,timezone,follow_up_sequence\n'+Array.from({length:16},(_,i)=>['Professor '+i,'fixture'+i+'@example.com','Capacity campaign','Fixture','2027-01-01T00:00:00Z','UTC',seq].map(quote).join(',')).join('\n');
   async function preview(name){
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('aside.sidebar nav').getByRole('button',{name:'Campaigns',exact:true}).click();
    await page.getByRole('button',{name:'New Campaign',exact:true}).click();
    await page.getByLabel('Campaign name',{exact:true}).fill(name);
    await page.getByRole('button',{name:'Continue to professors'}).click();
    await page.getByRole('button',{name:'Paste Table',exact:true}).click();
    await page.locator('#smart-paste').fill(csv);
    await page.getByRole('button',{name:'Parse and preview',exact:true}).click();
   }
   await preview('96-message browser fixture');
   await page.getByRole('button',{name:'Add to Campaign',exact:true}).click();
   await page.getByRole('button',{name:'Approve Complete Campaign',exact:true}).waitFor();
   assert.equal(h.db.prepare('SELECT count(*) n FROM active_message_capacity').get().n,96);
   assert.equal(h.db.prepare("SELECT count(*) n FROM messages WHERE status='sent'").get().n,100);
   for(let i=0;i<209;i++)insert.run(crypto.randomUUID(),owner.id,professor,'draft');
   await page.evaluate(()=>sessionStorage.clear());
   await preview('Over-capacity fixture');
   let posts=0;page.on('request',r=>{if(r.url().endsWith('/api/imports/drafts')&&r.method()==='POST')posts++;});
   await page.getByRole('button',{name:'Add to Campaign',exact:true}).click();
   await page.getByText(/Active message capacity reached/).waitFor();
   assert.equal(posts,0);assert.equal(h.db.prepare('SELECT count(*) n FROM active_message_capacity').get().n,305);
   assert.equal(h.db.prepare('SELECT count(*) n FROM deliveries').get().n,0);
   const result={import96With100Historical:true,frontendPreflightRejects401:true,backendUsageVerified:true,realEmailsSent:0};
   fs.writeFileSync('apps/api/.wrangler/capacity-browser-results.json',JSON.stringify(result));console.log(JSON.stringify(result));
  } finally {await browser.close();await new Promise(r=>server.close(r));h.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
