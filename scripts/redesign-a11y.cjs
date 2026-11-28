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
    outfile: "apps/api/.wrangler/lifecycle-browser-harness.cjs",
  });
  const {
      harness,
      worker,
      encrypt,
      runLiveJobs,
    } = require("../apps/api/.wrangler/lifecycle-browser-harness.cjs"),
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
  h.db.prepare("UPDATE messages SET status='replied',sent_at=? WHERE id=?").run(new Date(Date.now()-86400000).toISOString(),a.id);
  h.db.prepare("UPDATE transports SET state='confirmed',provider_id='fixture-receipt',thread_id='fixture-thread' WHERE message_id=?").run(a.id);
  h.db.prepare("INSERT INTO reply_locations(connection_id,provider_id,user_id,message_id,location,labels,checked_at) VALUES(?,'fixture-reply',?,?,'Spam','[\"SPAM\"]',?)").run(connection,owner.id,a.id,Date.now());
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
   const folder='apps/api/.wrangler/ui-redesign';fs.mkdirSync(folder,{recursive:true});const accessibility=[];
   const navigate=async(name)=>{if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true}).click();};
   await page.goto(assetBase,{waitUntil:'networkidle'});await page.evaluate(fs.readFileSync('apps/api/.wrangler/ui-a11y/node_modules/axe-core/axe.min.js','utf8'));
   for(const theme of ['light','dark'])for(const name of ['Dashboard','Campaigns','Professors','Documents','Notifications','Settings','Getting started','Practice campaign','Help']){
    await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);await navigate(name);
    await page.waitForTimeout(220);const audit=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));accessibility.push({theme,page:name,violations:audit.violations.map(rule=>({id:rule.id,impact:rule.impact,nodes:rule.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}))});
   }
   fs.writeFileSync(folder+'/accessibility-fast.json',JSON.stringify(accessibility,null,2));const violations=accessibility.flatMap(result=>result.violations.map(rule=>({page:result.page,theme:result.theme,...rule})));console.log(JSON.stringify({violations:violations.length,details:violations.slice(0,12)}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));h.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
