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
   const stage='after',folder='apps/api/.wrangler/ui-redesign';fs.mkdirSync(folder,{recursive:true});
   const shots=[],results=[],apiCalls=[],accessibility=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))apiCalls.push({path:new URL(request.url()).pathname,method:request.method()});});
   const navigate=async(name)=>{if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true}).click();};
   const check=async(label)=>{const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(overflow.scroll<=overflow.width+1,`${label}: page overflow ${overflow.scroll}/${overflow.width}`);results.push({label,overflow:false});if(label.includes('-1440-')){await page.waitForTimeout(220);const audit=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));accessibility.push({page:label,violations:audit.violations.map(rule=>({id:rule.id,impact:rule.impact,nodes:rule.nodes.map(node=>({target:node.target,summary:node.failureSummary}))}))});}};
   const screenshot=async(slug,width,theme)=>{const file=`${folder}/${stage}-${slug}-${width}-${theme}.png`;await page.screenshot({path:file,fullPage:true});shots.push(file);};
   await page.goto(assetBase,{waitUntil:'networkidle'});
   await page.evaluate(fs.readFileSync('apps/api/.wrangler/ui-a11y/node_modules/axe-core/axe.min.js','utf8'));
   await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();assert.deepEqual(await page.locator('.metric strong').allTextContents(),['1','1','1','0']);
   for(const theme of ['light','dark'])for(const width of [1440,1280,1024,768,390,320]){
    await page.setViewportSize({width,height:width<500?844:1000});await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);
    for(const [name,slug] of [['Dashboard','dashboard'],['Campaigns','campaigns'],['Professors','professors'],['Documents','documents'],['Notifications','notifications'],['Settings','settings'],['Getting started','getting-started'],['Practice campaign','practice'],['Help','help']]){
     await navigate(name);await check(`${slug}-${width}-${theme}`);
     if([1440,390].includes(width))await screenshot(slug,width,theme);
    }
    await navigate('Campaigns');await page.getByRole('button',{name:'Korea GKS Fall 2027',exact:true}).click();
    for(const tab of ['Overview','Professors','Schedule','Replies','Activity']){await page.getByRole('tab',{name:tab,exact:true}).click();await check(`detail-${tab}-${width}-${theme}`);if([1440,390].includes(width))await screenshot('detail-'+tab.toLowerCase(),width,theme);}
    await navigate('Campaigns');await page.getByRole('button',{name:'New Campaign',exact:true}).click();
    await page.getByLabel('Campaign name',{exact:true}).fill('Research opportunities - Fall 2027');await check(`create-details-${width}-${theme}`);
    if([1440,390].includes(width))await screenshot('create',width,theme);
    await page.getByRole('button',{name:'Continue to professors'}).click();await check(`create-methods-${width}-${theme}`);
    if([1440,390].includes(width))await screenshot('create-methods',width,theme);
   }
   await page.setViewportSize({width:390,height:844});await navigate('Dashboard');
   const toggle=page.getByRole('button',{name:'Open navigation',exact:true});await toggle.click();await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert(await toggle.evaluate(element=>element===document.activeElement),'Drawer did not restore focus');
   await page.setViewportSize({width:1440,height:1000});await navigate('Dashboard');await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await check('collapsed-sidebar');await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
   await navigate('Campaigns');await page.getByRole('button',{name:'Korea GKS Fall 2027',exact:true}).click();await page.getByText('Campaign actions',{exact:true}).click();await page.getByRole('button',{name:'Archive Campaign',exact:true}).click();const archiveDialog=page.getByRole('dialog',{name:'Confirm campaign archive'});await archiveDialog.waitFor();await page.keyboard.press('Escape');assert.equal(await archiveDialog.count(),0);
   await page.getByText('Campaign actions',{exact:true}).click();await page.getByRole('button',{name:'Archive Campaign',exact:true}).click();await page.getByRole('button',{name:'Confirm Archive',exact:true}).click();assert.equal(h.db.prepare('SELECT count(*) n FROM campaign_archives').get().n,1);await page.getByText('Campaign actions',{exact:true}).click();await page.getByRole('button',{name:'Restore Campaign',exact:true}).click();assert.equal(h.db.prepare('SELECT count(*) n FROM campaign_archives').get().n,0);
   await page.getByText('Campaign actions',{exact:true}).click();await page.getByRole('button',{name:'Delete Permanently',exact:true}).click();const deletion=page.getByRole('dialog',{name:'Confirm permanent campaign deletion'});await deletion.waitFor();assert(await deletion.getByRole('button',{name:'Confirm permanent deletion',exact:true}).isDisabled());await deletion.getByLabel('Campaign name confirmation').fill('wrong');assert(await deletion.getByRole('button',{name:'Confirm permanent deletion',exact:true}).isDisabled());await deletion.getByLabel('Campaign name confirmation').fill('Korea GKS Fall 2027');await deletion.getByRole('button',{name:'Confirm permanent deletion',exact:true}).click();await page.getByRole('heading',{name:'Campaigns',exact:true}).waitFor();assert.equal(h.db.prepare('SELECT state FROM campaign_workspace_deletions WHERE campaign_id=?').get(first).state,'deleted');
   await navigate('Campaigns');await page.getByRole('button',{name:/^Draft campaign for/}).click();await page.getByLabel('Select all campaign drafts').check();await page.getByLabel('Campaign Name',{exact:true}).fill('Deliberate repeat outreach');await page.getByRole('button',{name:/Approve initial emails only/}).click();
   const duplicate=page.getByRole('dialog',{name:'Previously contacted professors'});await duplicate.waitFor();assert(await duplicate.locator('.reply-warning').count()>0);assert(await duplicate.getByRole('button',{name:'Approve Anyway',exact:true}).isDisabled());await duplicate.getByRole('button',{name:'Change Recipients',exact:true}).click();assert.equal(h.db.prepare('SELECT count(*) n FROM campaign_approvals').get().n,2);
   await page.getByRole('button',{name:/Approve initial emails only/}).click();await duplicate.waitFor();await duplicate.getByRole('checkbox').check();await duplicate.getByRole('button',{name:'Approve Anyway',exact:true}).click();await page.getByText('Selected manual drafts approved',{exact:true}).waitFor();assert.equal(h.db.prepare("SELECT count(*) n FROM audit WHERE action='campaign.duplicate_override'").get().n,1);assert.equal(h.db.prepare('SELECT count(*) n FROM deliveries').get().n,0);
   assert.equal(errors.length,0,errors.join('; '));
   assert(!apiCalls.some(request=>/\/jobs\/run/.test(request.path)),'A scheduler endpoint was invoked');
   fs.writeFileSync(folder+'/accessibility-results.json',JSON.stringify(accessibility,null,2));
   const violations=accessibility.flatMap(result=>result.violations.map(rule=>({page:result.page,theme:result.theme,...rule})));
   assert.equal(violations.length,0,'Accessibility violations remain; inspect accessibility-results.json');
   console.log(JSON.stringify({accessibilityViolations:violations.length,details:violations.slice(0,8)}));
   const result={publishedAssets:!!process.env.MANAGEMENT_ASSET_URL,widths:[1440,1280,1024,768,390,320],themes:['light','dark'],checks:results.length,accessibilityViolationCount:violations.length,keyboardDrawer:true,collapsedSidebar:true,dialogEscape:true,typedDeleteConfirmation:true,archiveRestoreDelete:true,explicitDuplicateOverride:true,noProductionApi:true,screenshots:shots};
   fs.writeFileSync(folder+'/browser-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({...result,screenshots:shots.length}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));h.db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
