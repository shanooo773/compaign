const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root='apps/api/.wrangler/lifecycle-web-source';fs.mkdirSync(root+'/apps/api/src',{recursive:true});
const excluded=new Set(['node_modules','.next','out','.vercel','AGENTS.md']);
fs.cpSync('apps/web',root+'/apps/web',{recursive:true,filter:s=>!excluded.has(path.basename(s))&&!path.basename(s).startsWith('.env')&&!s.endsWith('.tsbuildinfo')});
fs.cpSync('shared',root+'/shared',{recursive:true});fs.mkdirSync(root+'/scripts',{recursive:true});fs.mkdirSync(root+'/.vercel',{recursive:true});
for(const f of ['package.json','package-lock.json','.vercelignore','scripts/generate-learning-config.cjs','apps/api/package.json','apps/api/src/storage.ts','.vercel/project.json'])fs.copyFileSync(f,root+'/'+f);
console.log('Curated frontend source prepared with existing project linkage; private diagnostics excluded.');
