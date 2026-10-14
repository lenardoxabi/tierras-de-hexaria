const { chromium } = require('playwright');
const L='/tmp/claude-0/libs/package/';
const CHAOS = process.env.CHAOS === '1';
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  const errs=[];
  const mk=async(tag)=>{ const p=await b.newPage({viewport:{width:1000,height:650}});
    p.on('pageerror',e=>errs.push(tag+': '+e.message+' @ '+(e.stack||'').split('\n')[1]));
    await p.route('**/*',r=>{const u=r.request().url();
      if(u.startsWith('file:')||u.includes('127.0.0.1:8787'))return r.continue();
      if(u.includes('three.min.js'))return r.fulfill({path:L+'build/three.min.js'});
      if(u.includes('OrbitControls'))return r.fulfill({path:L+'examples/js/controls/OrbitControls.js'});
      if(u.includes('BufferGeometryUtils'))return r.fulfill({path:L+'examples/js/utils/BufferGeometryUtils.js'});
      if(u.includes('cannon'))return r.fulfill({path:L+'build/cannon.js'});
      return r.abort();});
    await p.addInitScript(()=>{ try{ localStorage.setItem('hexaria.server','http://127.0.0.1:8787'); localStorage.setItem('hexaria.speed','fast'); localStorage.setItem('hexaria.zoom','off'); localStorage.setItem('hexaria.cfg', JSON.stringify({players:3,vp:5,difficulty:'normal',theme:'medieval',mode:'classic'})); }catch(e){} });
    await p.goto('file:///tmp/claude-0/pw/test.html', {waitUntil:'domcontentloaded', timeout:120000}); await p.waitForTimeout(6000);
    await p.evaluate(()=>{ View.rollDice = f => new Promise(r=>setTimeout(()=>r(f || [1+Math.random()*6|0, 1+Math.random()*6|0]), 200)); });
    return p; };
  const act = async (p) => p.evaluate(()=>{ const G=App.g(); if(!G) return 'noG';
      if (View._pick()) return 'picked';
      const m=document.getElementById('modal'); if(!m.hidden){ const ok=m.querySelector('button[data-ok]:not([disabled])'); if(ok){ok.click(); return 'ok';} const b=m.querySelector('button[data-auto]'); if(b){b.click(); return 'auto';} const no=m.querySelector('button[data-no]'); if(no){no.click(); return 'no';} const x=m.querySelector('button[data-c="robber"]'); if(x){x.click(); return 'knight';} const cl=m.querySelector('button[data-close],button[data-x]'); if(cl){cl.click(); return 'close';} return 'modal?'+m.innerText.slice(0,40); }
      const roll=document.querySelector('button[data-act="roll"]:not([disabled])'); if(roll){roll.click(); return 'roll';}
      const bld=document.querySelector('button[data-act="settlement"]:not([disabled]),button[data-act="city"]:not([disabled]),button[data-act="road"]:not([disabled]),button[data-act="dev"]:not([disabled])'); if(bld && Math.random()<0.8){bld.click(); return 'build';}
      const tr=document.querySelector('button[data-act="trade"]:not([disabled])'); if(tr && Math.random()<0.15){tr.click(); return 'trade';}
      const end=document.querySelector('button[data-act="end"]:not([disabled])'); if(end){end.click(); return 'end';}
      return `phase=${G.phase} t=${G.turn} cur=${G.cur} me=${App.seat()} host=${App.net.host} loop=${App.net.loopActive} rolled=${G.rolled} pts=${G.players.map(p=>Core.points(G,p.id,true)).join('/')}`; });
  const diag = async (p) => p.evaluate(()=>{ const G=App.g(); return JSON.stringify({ banner: document.getElementById('banner').innerText.slice(0,60), modal: !document.getElementById('modal').hidden ? document.getElementById('modal').innerText.slice(0,80) : null, endBtn: !!document.querySelector('button[data-act="end"]:not([disabled])'), rollBtn: !!document.querySelector('button[data-act="roll"]:not([disabled])'), loop: App.net.loopActive, next: !!App.net.next, applying: App.net.applying, ws: App.net.ws&&App.net.ws.readyState, cur: G&&G.cur, me: App.seat(), host: App.net.host, bots: G&&G.players.map(p=>p.isBot?1:0).join(''), logs: [...document.querySelectorAll('#logList li')].slice(-3).map(l=>l.innerText.slice(0,70)) }); });
  const H=await mk('H'), C=await mk('C');
  await H.evaluate(()=>{ document.querySelector('button[data-go="srv"]').click(); }); await H.waitForTimeout(300);
  await H.evaluate(()=>{ document.getElementById('netNameHost').value='Xabi'; document.querySelector('button[data-nethost]').click(); }); await H.waitForTimeout(9000);
  const code=await H.evaluate(()=>App.net.code); console.log('code', code);
  await C.evaluate(()=>{ document.querySelector('button[data-go="srv"]').click(); }); await C.waitForTimeout(300);
  await C.evaluate(code=>{ document.getElementById('netNameJoin').value='Ana'; document.getElementById('netCode').value=code; document.querySelector('button[data-netjoin]').click(); }, code);
  await C.waitForTimeout(7000);
  console.log('lobby', await H.evaluate(()=>JSON.stringify(App.net.lobby.map(l=>l.name))));
  await H.evaluate(()=>document.querySelector('button[data-netstart]').click()); await H.waitForTimeout(7000);
  const T0=Date.now(); let last='', same=0, stuckReports=0;
  for (let i=0;i<(process.env.ITER?+process.env.ITER:900);i++){
    await H.waitForTimeout(600);
    const sh=await act(H), sc=await act(C); const st=sh+' || '+sc;
    if (st===last) same++; else { same=0; last=st; }
    if (i%25===0) console.log(((Date.now()-T0)/1000|0)+'s', i, st);
    if (CHAOS && i%40===20) { console.log('CHAOS: guest socket close'); await C.evaluate(()=>{ App.net.ws.close(); }); }
    if (CHAOS && i%40===0 && i>0) { console.log('CHAOS: host socket close'); await H.evaluate(()=>{ App.net.ws.close(); }); }
    if (same===25) { stuckReports++; console.log('STUCK?', st); console.log(' H', await diag(H)); console.log(' C', await diag(C)); if (stuckReports>=3) break; }
    if (/phase=over/.test(sh) && /phase=over/.test(sc)) { console.log('OVER', st); break; }
    if (errs.length) { console.log('ERRS', errs.slice(0,5)); errs.length=0; }
  }
  console.log('final H', await diag(H)); console.log('final C', await diag(C));
  await b.close();
})();
