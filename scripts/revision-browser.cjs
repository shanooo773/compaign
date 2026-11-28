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
    outfile: "apps/api/.wrangler/revision-browser-harness.cjs",
  });
  const {
      harness,
      worker,
      encrypt,
      runLiveJobs,
    } = require("../apps/api/.wrangler/revision-browser-harness.cjs"),
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
  async function draft(email,name){const r=await h.request('/imports/drafts','POST',{import_id:crypto.randomUUID(),rows:[{name,email,subject:'QA subject',body:'QA body',scheduled_at:new Date(Date.now()+86400000).toISOString(),timezone:'UTC'}]},owner.session);assert.equal(r.status,200);return(await r.json()).drafts[0];}
  async function approve(d,name){const r=await h.request('/messages/approve','POST',{ids:[d.id],name,sending_account_id:connection,without_attachments_acknowledged:true},owner.session);assert.equal(r.status,200);return(await r.json()).campaign_id;}
  h.env.LIVE_TEST_RECIPIENTS+=',third@example.com';
  const a=await draft('controlled@example.com','Professor Scheduled'),first=await approve(a,'Revision fixture');
  const removable=await draft('second@example.com','Professor Delete'),warning=await draft('third@example.com','Professor Warning');
  const upload=new FormData();upload.set('file',new File(['Synthetic CV'],'cv.txt',{type:'text/plain'}));const uploadResponse=await h.request('/documents','POST',upload,owner.session);assert.equal(uploadResponse.status,200);const doc=(await uploadResponse.json()).id;
  global.fetch=async()=>{throw Error('External traffic forbidden in browser tests');};
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'session',value:owner.session.split('=')[1],url:base}]);
   await context.addInitScript(()=>localStorage.setItem('ms-tour-v1:management-qa@example.com',JSON.stringify({dismissed:true})));
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
   await page.goto(base+'/?campaign='+first,{waitUntil:'networkidle'});
   await page.locator('.context-menu>summary').click();await page.getByRole('button',{name:'Edit Upcoming Emails',exact:true}).click();
   const editor=page.getByRole('dialog',{name:'Edit Upcoming Emails'});await editor.getByText('Professor Scheduled ? Initial email',{exact:true}).waitFor();
   await editor.getByRole('checkbox',{name:'Revise this initial email for Professor Scheduled'}).check();
   await editor.getByLabel('Revision subject '+a.id,{exact:true}).fill('Corrected browser subject');await editor.getByRole('checkbox',{name:'cv.txt',exact:true}).check();
   await editor.getByRole('button',{name:'Review 1 selected revisions'}).click();await editor.getByRole('heading',{name:'Review original and revised values'}).waitFor();
   assert(await editor.getByText('QA subject',{exact:true}).isVisible());assert(await editor.getByText('Corrected browser subject',{exact:true}).isVisible());assert(await editor.getByRole('button',{name:'Approve Upcoming Changes'}).isDisabled());
   for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Revision review overflow');await page.screenshot({path:`apps/api/.wrangler/revision-review-${width}.png`,fullPage:true});}
   await editor.getByRole('checkbox',{name:/I approve changes to exactly/}).check();await editor.getByRole('button',{name:'Approve Upcoming Changes'}).click();await editor.waitFor({state:'hidden'});assert.equal(h.db.prepare('SELECT count(*) n FROM message_revisions').get().n,1);assert.equal(h.db.prepare('SELECT subject FROM messages WHERE id=?').get(a.id).subject,'QA subject');
   await page.setViewportSize({width:1440,height:1000});
   await page.goto(base+'/?campaign='+encodeURIComponent('draft:'+removable.campaign_import_id),{waitUntil:'networkidle'});await page.getByRole('button',{name:'Delete Draft',exact:true}).click();const deletion=page.getByRole('dialog',{name:'Delete Draft',exact:true});await deletion.getByRole('button',{name:'Keep draft'}).click();assert(h.db.prepare('SELECT id FROM messages WHERE id=?').get(removable.id));
   await page.getByRole('button',{name:'Delete Draft',exact:true}).click();await deletion.getByRole('button',{name:'Confirm Delete Draft'}).click();await deletion.waitFor({state:'hidden'});assert(!h.db.prepare('SELECT id FROM messages WHERE id=?').get(removable.id));assert.equal(h.db.prepare('SELECT storage_state FROM documents WHERE id=?').get(doc).storage_state,'ready');
   await page.goto(base+'/?campaign='+encodeURIComponent('draft:'+warning.campaign_import_id),{waitUntil:'networkidle'});await page.getByLabel('Select all campaign drafts',{exact:true}).check();await page.getByRole('button',{name:/Approve initial emails only/}).click();const missing=page.getByRole('dialog',{name:'No documents attached',exact:true});await missing.waitFor();assert(await missing.getByRole('button',{name:'Continue Without Attachments',exact:true}).isDisabled());await missing.getByRole('button',{name:'Attach Documents',exact:true}).click();assert.equal(h.db.prepare('SELECT count(*) n FROM campaign_approvals').get().n,1);
   await page.getByRole('button',{name:/Approve initial emails only/}).click();await missing.waitFor();await missing.getByRole('checkbox').check();await missing.getByRole('button',{name:'Continue Without Attachments',exact:true}).click();await page.getByText('Selected manual drafts approved',{exact:true}).waitFor();assert.equal(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.without_attachments_acknowledged'").get().n,2);
   const csv='name,email,subject,body,scheduled_at,timezone\nProfessor Reuse,controlled@example.com,Reuse subject,Reuse body,'+new Date(Date.now()+2*86400000).toISOString()+',Asia/Seoul';
   const smartAdd=async()=>{await page.goto(base,{waitUntil:'networkidle'});await page.locator('aside.sidebar nav').getByRole('button',{name:'Campaigns',exact:true}).click();await page.getByRole('button',{name:'New Campaign',exact:true}).click();await page.getByLabel('Campaign name',{exact:true}).fill('Cancelled import browser');await page.getByRole('button',{name:'Continue to professors'}).click();await page.getByRole('button',{name:'Paste Table',exact:true}).click();await page.locator('#smart-paste').fill(csv);await page.getByRole('button',{name:'Parse and preview',exact:true}).click();await page.getByRole('button',{name:'Add to Campaign',exact:true}).click();await page.getByRole('button',{name:'Approve Complete Campaign',exact:true}).waitFor();};
   await smartAdd();const original=h.db.prepare("SELECT * FROM messages WHERE subject='Reuse subject' ORDER BY rowid DESC LIMIT 1").get();assert(original);const history=await(await h.request('/campaigns/duplicate-check','POST',{ids:[original.id]},owner.session)).json();const approval=await h.request('/messages/approve','POST',{ids:[original.id],name:'Cancelled browser fixture',sending_account_id:connection,without_attachments_acknowledged:true,duplicate_acknowledgement:history.acknowledgement},owner.session);assert.equal(approval.status,200);const oldCampaign=(await approval.json()).campaign_id;await h.request(`/campaigns/${oldCampaign}/cancel`,'POST',{},owner.session);
   await smartAdd();const replacement=h.db.prepare("SELECT * FROM messages WHERE subject='Reuse subject' ORDER BY rowid DESC LIMIT 1").get();assert.notEqual(replacement.id,original.id);assert.notEqual(replacement.campaign_import_id,original.campaign_import_id);assert.equal(replacement.status,'draft');assert.equal(h.db.prepare('SELECT status FROM messages WHERE id=?').get(original.id).status,'cancelled');
   assert.equal(h.db.prepare('SELECT count(*) n FROM deliveries').get().n,0);assert.deepEqual(errors,[]);
   const result={publishedAssets:!!process.env.REVISION_ASSET_URL,desktop:true,mobile:true,cancelledSmartImportReuse:true,revisionOriginalAndRevised:true,explicitRevisionApproval:true,addForgottenCV:true,draftDeleteConfirmation:true,sharedDocumentPreserved:true,missingAttachmentConfirmation:true,noExternalTraffic:true,realEmailsSent:0};fs.writeFileSync('apps/api/.wrangler/'+(process.env.REVISION_ASSET_URL?'revision-published-browser-results.json':'revision-browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));h.db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
