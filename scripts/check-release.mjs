import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const roots=['plugin.json','mcp.json','skills','assets','README.en.md','.agents/plugins/marketplace.json','src','tests','sites','scripts','examples','docs','plugin','third-party','package.json','README.md','LICENSE','NOTICE','SECURITY.md','.env.example'];
// npm omits package-lock.json and .gitignore from a packed source distribution.
for(const optional of ['package-lock.json','.gitignore'])if(existsSync(resolve(root,optional)))roots.push(optional);
const problems=[];const files=[];
function walk(path){
 const info=lstatSync(path);const name=relative(root,path);
 if(info.isSymbolicLink()){problems.push({file:name,reason:'symlink_not_allowed'});return;}
 if(info.isDirectory()){for(const entry of readdirSync(path))walk(resolve(path,entry));return;}
 if(!info.isFile()||info.size>1_000_000){problems.push({file:name,reason:'invalid_source_file'});return;}
 files.push(name);
 if(/(?:\.sqlite|\.db|\.log|\.zip|\.tgz|\.png|\.jpg)$/i.test(name)||(/(^|\/)\.env/.test(name)&&name!=='.env.example')){problems.push({file:name,reason:'runtime_file_not_allowed'});return;}
 const content=readFileSync(path,'utf8');
 const forbidden=[/https:\/\/[a-z0-9.-]+\.chatgpt\.site/i,/appgprj_[a-z0-9]{20,}/i,/GOCSPX-[A-Za-z0-9_-]{10,}/,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,/1\/\/[A-Za-z0-9_-]{30,}/,/ya29\.[A-Za-z0-9_-]{30,}/];
 if(forbidden.some(pattern=>pattern.test(content)))problems.push({file:name,reason:'private_binding_or_credential_pattern'});
}
for(const path of roots)walk(resolve(root,path));
const source=JSON.parse(readFileSync(resolve(root,'docs/source-provenance.json'),'utf8'));
for(const entry of source.modules){
 const hash=createHash('sha256').update(readFileSync(resolve(root,entry.file))).digest('hex');
 if(hash!==entry.currentSha256)problems.push({file:entry.file,reason:'provenance_hash_mismatch'});
}
const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
if(manifest.private!==true)problems.push({file:'package.json',reason:'accidental_npm_publication_enabled'});
const example=readFileSync(resolve(root,'.env.example'),'utf8');
for(const line of example.split('\n'))if(/^(GOOGLE_LOGIN_CLIENT_ID|GOOGLE_LOGIN_CLIENT_SECRET|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY)=.+/.test(line))problems.push({file:'.env.example',reason:'nonempty_secret_example'});
if(problems.length){console.error(JSON.stringify({ok:false,problems},null,2));process.exitCode=1;}
else console.log(JSON.stringify({ok:true,sourceFilesChecked:files.length,checks:['explicit_source_allowlist','no_symlinks','private_binding_and_secret_patterns','empty_credential_examples','provenance_hashes','npm_publication_guard'],limitations:'Pattern scanning does not prove absence of every possible secret; review exact publication contents before release.'},null,2));
