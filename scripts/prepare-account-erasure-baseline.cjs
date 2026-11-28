const fs=require('node:fs'),path=require('node:path');
const dir='apps/api/.wrangler',root=dir+'/account-erasure-baseline';
fs.mkdirSync(root+'/apps/api',{recursive:true});fs.cpSync('apps/api/src',root+'/apps/api/src',{recursive:true});fs.cpSync('shared',root+'/shared',{recursive:true});
fs.copyFileSync(dir+'/lifecycle-baseline/apps/api/src/accounts.ts',root+'/apps/api/src/accounts.ts');
const cfg=JSON.parse(fs.readFileSync(dir+'/management-config.json','utf8'));
fs.writeFileSync(dir+'/account-erasure-baseline-config.json',JSON.stringify({...cfg,main:path.resolve(root+'/apps/api/src/index.ts')}));
console.log('Isolated baseline source prepared; no production changes.');
