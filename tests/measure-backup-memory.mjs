// Desktop Safari RSS is a coarse process measurement, not JavaScript heap/iOS proof.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
function processes(){
 const output=execFileSync('/bin/ps',['-axo','pid=,rss=,comm='],{encoding:'utf8'});
 return output.split('\n').map(s=>s.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(m=>m && /Safari|WebKit.*WebContent/.test(m[3])).map(m=>({pid:Number(m[1]),kib:Number(m[2])}));
}
const original=new Set(processes().map(p=>p.pid));
let peak=0;
const timer=setInterval(()=>{peak=Math.max(peak,processes().filter(p=>!original.has(p.pid)).reduce((sum,p)=>sum+p.kib,0));},200);
try{
 const child=spawn('uv',['run','npm','run','test:backups'],{stdio:'inherit',env:{...process.env,TEST_MEMORY_ONLY:'1'}});
 const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
 if(code!==0)throw new Error('Memory fixture failed: '+code);
 const result={...JSON.parse(readFileSync('.cache/backups/stress.json','utf8')),new_safari_process_peak_rss_kib:peak};
 writeFileSync('.cache/backups/stress.json',JSON.stringify(result,null,2)+'\n');
 console.log('Desktop Safari memory fixture:',result);
}finally{clearInterval(timer);}
