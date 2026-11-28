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
  const base = "http://localhost:" + server.address().port; // HTTPS Worker origin retained in this in-memory transport adapter only.

  const owner=await h.user("management-qa@example.com");h.env.LIVE_OWNER_USER_IDS=owner.id;
  const connection=crypto.randomUUID();const token=await encrypt(h.env,owner.id+":gmail:tokens:v1",{access_token:"synthetic",refresh_token:"synthetic",expires_in:3600});
  h.db.prepare("INSERT INTO connections(id,user_id,provider,address,subject,scopes,tokens,expires_at) VALUES(?,?,'gmail','qa@example.com','qa-mailbox','gmail.send gmail.readonly',?,?)").run(connection,owner.id,token,Date.now()+86400000);
  h.db.prepare("INSERT INTO mailbox_checks(connection_id,checked_at,status,detail) VALUES(?,?,'ready','fixture')").run(connection,Date.now());
  async function draft(email,name){const r=await h.request('/imports/drafts','POST',{import_id:crypto.randomUUID(),rows:[{name,email,subject:'QA subject',body:'QA body',scheduled_at:new Date(Date.now()+86400000).toISOString(),timezone:'UTC'}]},owner.session);assert.equal(r.status,200);return(await r.json()).drafts[0];}
  async function approve(d,name){const r=await h.request('/messages/approve','POST',{ids:[d.id],name,sending_account_id:connection},owner.session);assert.equal(r.status,200);return(await r.json()).campaign_id;}
  const a=await draft('controlled@example.com','Professor Ahmed'),b=await draft('second@example.com','Professor Qatar');
  const first=await approve(a,'Korea GKS Fall 2027');await approve(b,'Qatar MS Scholarship 2027');await draft('controlled@example.com','Professor Ahmed duplicate');
  h.db.prepare("INSERT INTO notifications(id,user_id,kind,message,entity_id) VALUES('qa-warning',?,'reply_warning','Reply received in Spam from Professor Ahmed ? Korea GKS Fall 2027. Check your connected Gmail Spam folder.',?)").run(owner.id,a.id);
  const assetBase=process.env.MANAGEMENT_ASSET_URL || base;
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});
   await context.addCookies([{name:'session',value:owner.session.split('=')[1],url:assetBase}]);
   await context.addInitScript(()=>{localStorage.setItem('ms-tour-v1:management-qa@example.com',JSON.stringify({dismissed:true}));});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   if(process.env.MANAGEMENT_ASSET_URL) await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());
    const response=await worker.fetch(new Request(h.env.APP_ORIGIN+u.pathname+u.search,{method:req.method(),headers:{...req.headers(),origin:h.env.APP_ORIGIN,cookie:owner.session},...(req.method()==='GET'||req.method()==='HEAD'?{}:{body:req.postData()})}),h.env);
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   });
   await page.goto(assetBase,{waitUntil:'networkidle'});
   assert(await page.locator('.reply-warning').count()>=1,'Spam warning missing from dashboard');
   await page.getByRole('button',{name:/^Outreach/}).first().click();
   await page.getByRole('heading',{name:'Your campaigns'}).waitFor();
   assert(await page.getByRole('button',{name:'Korea GKS Fall 2027',exact:true}).isVisible());
   assert(await page.getByRole('button',{name:'Qatar MS Scholarship 2027',exact:true}).isVisible());
   await page.getByLabel('Search campaigns').fill('Korea');assert.equal(await page.getByRole('button',{name:'Qatar MS Scholarship 2027',exact:true}).count(),0);await page.getByLabel('Search campaigns').fill('');
   const shots=[];
   for(const width of [1440,390])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===390?844:1000});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Campaign directory overflow');
    const file=`apps/api/.wrangler/management-${width}-${theme}.png`;await page.screenshot({path:file,fullPage:true});shots.push(file);
   }
   await page.setViewportSize({width:1440,height:1000});
   await page.getByRole('button',{name:'Korea GKS Fall 2027',exact:true}).click();
   await page.getByRole('heading',{name:'Korea GKS Fall 2027',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Professor Qatar',exact:true}).count(),0,'Other campaign professor leaked');
   await page.getByPlaceholder('Korea GKS Fall 2027').fill('Germany Robotics Professors');await page.getByRole('button',{name:'Save name',exact:true}).click();await page.getByRole('heading',{name:'Germany Robotics Professors',exact:true}).waitFor();
   await page.getByRole('button',{name:'All campaigns',exact:true}).click();await page.getByRole('button',{name:/^Draft campaign /}).click();
   await page.getByLabel('Select all campaign drafts').check();
   await page.getByLabel('Campaign Name',{exact:true}).fill('Repeat research outreach');
   await page.getByRole('button',{name:/Approve initial emails only/}).click();
   const dialog=page.getByRole('dialog',{name:'Previously contacted professors'});await dialog.waitFor();assert(await dialog.getByText(/Professor Ahmed.*Germany Robotics/).isVisible());assert(await dialog.getByRole('button',{name:'Approve Anyway'}).isDisabled());
   await dialog.getByRole('button',{name:'Change Recipients'}).click();assert.equal(h.db.prepare('SELECT count(*) n FROM campaign_approvals').get().n,2);
   await page.getByRole('button',{name:/Approve initial emails only/}).click();await dialog.waitFor();await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Approve Anyway'}).click();
   await page.getByText('Selected manual drafts approved',{exact:true}).waitFor();assert.equal(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.duplicate_override'").get().n,1);
   assert.equal(h.db.prepare('SELECT count(*) n FROM deliveries').get().n,0,'Browser fixture must not submit mail');
   assert.equal(errors.length,0,errors.join('; '));
   console.log(JSON.stringify({publishedAssets:!!process.env.MANAGEMENT_ASSET_URL,desktopMobileLightDark:true,dashboardSpamWarning:true,campaignSearch:true,scopedDetails:true,renaming:true,changeRecipients:true,explicitApproveAnyway:true,auditedOverride:true,noEmailSubmissions:true,screenshots:shots}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));h.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
