// History (2026-11-09, agreed with the owner in 6 preview rounds): three tabs — Report (7 checks), Trades (one row per trade), Compare.
// Rules: see the History decisions (checks 1–7, filters Q16, compare Q17, one mistake + "Followed my plan" Q19, changes marked once).
// The analysis works on plain numbers taken from the journal data; every value is recalculated from the trades on each draw.
import { h, closeTopDialog, dialog, para, toast, money, signed, qtyTxt, field, changeTable, datePicker, download } from './dom.js';
import * as D from '../decimal.js';
import * as C from '../calc.js';
import * as A from '../actions.js';
import { parseDMY, todayISO } from '../dates.js';
import { editTrade, withNew, resolveNew } from './tradeforms.js';
// data.js is loaded only when exporting (keeps History importable in the tests)

let loadedState = null;
let RAW, S, stockBy, setupBy, errBy, PLAN, TR = [], ROOT, CTX;
const $ = (id) => ROOT.querySelector('#' + id);
const PLAN_NAME = 'Followed my plan';
const realErrors = () => RAW.errors.filter((e) => e.name !== PLAN_NAME);
function load(state) {
  RAW = state; S = state.settings;
  stockBy = Object.fromEntries(state.stocks.map((s) => [s.id, s]));
  setupBy = Object.fromEntries(state.setups.map((s) => [s.id, s]));
  errBy = Object.fromEntries(state.errors.map((s) => [s.id, s]));
  PLAN = state.errors.find((e) => e.name === PLAN_NAME)?.id || null;
  TR = build();
}
// For tests: the numbers History shows, from a journal state.
export function analyse(state) { load(state); return { trades: TR, stats: stats(TR), checks: CHECKS.map((c) => c(TR)) }; }

// ---------------------------------------------------------------- formatting (journal style: 1 234,56 · dd-mm-yyyy)
const fx=(n,d=2)=>{if(n===null||n===undefined||isNaN(n))return'–';const m=10**d,r=Math.round(Math.abs(n)*m+1e-7)/m;const s=r.toFixed(d).split('.');s[0]=s[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ');return (n<0?'−':'')+s.join(',');};
const sx=(n,d=2)=>n===null||n===undefined||isNaN(n)?'–':(n>0?'+':'')+fx(n,d);
const usd=(n)=>n===null||n===undefined?'–':(n>0?'+$':n<0?'−$':'$')+fx(Math.abs(n),2);
const usd0=(n)=>(n>0?'+':n<0?'−':'')+fx(Math.abs(n),0);
const pct=(n,d=0)=>n===null||n===undefined||isNaN(n)?'–':fx(n,d)+' %';
const R=(n)=>n===null||n===undefined||isNaN(n)?'–':sx(n,2)+' R';
const dmy=(iso)=>iso?iso.slice(8,10)+'-'+iso.slice(5,7)+'-'+iso.slice(0,4):'–';
const dayN=(iso)=>Math.round(Date.parse(iso+'T00:00:00Z')/86400000);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mean=(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const sum=(a)=>a.reduce((x,y)=>x+y,0);
const times=(x)=>x===null?'–':(x>=1.95&&x<2.05?'2':x>=2.4&&x<2.6?'2½':x>=1.4&&x<1.6?'1½':fx(x,1));

// ---------------------------------------------------------------- model
// Review fix 2026-11-09: every per-trade value comes from the program's exact calculations (calc.js, BigInt decimals), so History can
// never differ from Close trade, Capital or the cards. Plain numbers are made only afterwards, for averages and display.
const BN=(b)=>b===null||b===undefined?null:Number(b)/1e8;            // exact value → number (8 decimals)
const BC=(b)=>{if(b===null||b===undefined)return null;const neg=b<0n,v=neg?-b:b,q=v/1000000n+((v%1000000n)*2n>=1000000n?1n:0n);return (neg?-1:1)*Number(q)/100;}; // money: rounded to cents like the rest of the program
function build(){
  const all=RAW.trades.map(t=>{
    const qty=BN(D.d(t.qty)), buy=BN(D.d(t.buyPrice)), bc=BN(C.N(t.buyCommission)??0n), soldB=C.soldQty(t), closed=t.sales.length>0&&C.openQty(t)===0n;
    const det=C.salesDetail(t), sales=det.map(x=>({...x.sale,q:BN(D.d(x.sale.qty)),net:BC(x.net)}));
    const last=t.sales.length?t.sales.reduce((a,b)=>(a.date>b.date||(a.date===b.date&&a.seq>b.seq))?a:b):null;
    const initB=C.N(t.initialStop);
    return {id:t.id,seq:t.seq,stockId:t.stockId,symRaw:stockBy[t.stockId]?.symbol??'?',sym:esc(stockBy[t.stockId]?.symbol??'?'),buyDate:t.buyDate,qty,buy,bc,init:BN(initB),sold:BN(soldB),closed,src:t,
      sellDate:last?last.date:null,lastSeq:last?last.seq:0,sales,setupId:t.setupId,errorId:t.errorId,comment:t.comment||'',capAtOpen:BN(C.N(t.capitalAtOpen)??0n)};
  });
  for(const t of all){
    if(!t.closed)continue;
    const src=t.src,netB=C.realized(src),capB=C.N(src.capitalAtOpen),RB=C.rMultiple(src),sdB=C.stopDistancePct(src);
    t.netB=netB; t.net=BC(netB);
    t.days=C.holdingDays(src);
    t.avgSell=BN(D.div(src.sales.reduce((a,x)=>a+D.mul(D.d(x.price),D.d(x.qty)),0n),C.soldQty(src)));
    t.capPct=capB&&capB!==0n?BN(D.pct(netB,capB)):null;
    t.R=BN(RB); t.labelRaw=C.rCategory(RB,S)??'–'; t.label=esc(t.labelRaw);
    t.sdPct=BN(sdB); t.sdRaw=C.stopDistanceLabel(sdB,S)??'No SL'; t.sd=esc(t.sdRaw);
    t.comm=BN((C.N(src.buyCommission)??0n)+src.sales.reduce((a,x)=>a+(C.N(x.commission)??0n),0n));
  }
  // how you bought (agreed: first / added higher / added lower / bought again after a loss or win within 15 days)
  const byBuy=[...all].sort((a,b)=>a.buyDate<b.buyDate?-1:a.buyDate>b.buyDate?1:a.seq-b.seq);
  for(const t of byBuy){
    const prev=byBuy.filter(o=>o.stockId===t.stockId&&(o.buyDate<t.buyDate||(o.buyDate===t.buyDate&&o.seq<t.seq)));
    const open=prev.filter(o=>!o.closed||o.sellDate>=t.buyDate);
    if(open.length){const ref=open[open.length-1];t.how=t.buy>ref.buy?'Added higher':'Added lower';continue;}
    const closed=prev.filter(o=>o.closed);
    if(closed.length){const last=closed.reduce((a,b)=>a.sellDate>=b.sellDate?a:b);
      if(dayN(t.buyDate)-dayN(last.sellDate)<=15){t.how=last.net<0?'Bought again after a loss':'Bought again after a win';continue;}}
    t.how='First trade';
  }
  const closed=all.filter(t=>t.closed).sort((a,b)=>a.sellDate<b.sellDate?-1:a.sellDate>b.sellDate?1:a.lastSeq-b.lastSeq);
  closed.forEach((t,i)=>t.order=i);
  return closed;
}

// Review fix 2026-11-09: names typed by you (or imported) are made safe text here, once, before they go into the page.
// The *Raw versions keep the original text for filters and the Excel export.
const setupNameRaw=(t)=>t.setupId?setupBy[t.setupId]?.name??'?':null;
const mistakeNameRaw=(t)=>(PLAN&&t.errorId===PLAN)?'Followed my plan':t.errorId?errBy[t.errorId]?.name??'?':null;
const setupName=(t)=>{const n=setupNameRaw(t);return n===null?null:esc(n);};
const mistakeName=(t)=>{const n=mistakeNameRaw(t);return n===null?null:esc(n);};
const realSetup=(t)=>{const n=setupNameRaw(t);return !!n&&n!=='Unclassified';};

// ---------------------------------------------------------------- statistics (shared by summary, checks, compare)
function stats(ts){
  const W=ts.filter(t=>t.net>0),L=ts.filter(t=>t.net<0);
  const wr=W.length+L.length?W.length/(W.length+L.length):null;
  const wR=W.map(t=>t.R).filter(r=>r!==null),lR=L.map(t=>t.R).filter(r=>r!==null),aR=ts.map(t=>t.R).filter(r=>r!==null);
  const winR=mean(wR),lossR=mean(lR),payoff=winR!==null&&lossR?winR/-lossR:null;
  return {n:ts.length,w:W.length,l:L.length,wr,winR,lossR,payoff,be:payoff!==null?1/(1+payoff):null,avgR:mean(aR),nR:aR.length,
    net:BC(ts.reduce((a,t)=>a+(t.netB??0n),0n)),capPct:sum(ts.map(t=>t.capPct||0)),days:mean(ts.map(t=>t.days)),
    best:ts.length?ts.reduce((a,b)=>b.net>a.net?b:a):null,worst:ts.length?ts.reduce((a,b)=>b.net<a.net?b:a):null};
}
const sample=(n)=>n<5?'Too little data':n<10?'Early signal':n<20?'Developing pattern':'Stronger observed pattern';
const VWORD={good:'Good',watch:'Watch',bad:'Bad',na:'Not enough data yet'};
const vd=(v)=>`<span class="vd ${v}">${VWORD[v]}</span>`;

// ---------------------------------------------------------------- the 7 checks (rules agreed 2026-11-08)
const RECENT=20;
function split(ts){return ts.length>=RECENT+5?{recent:ts.slice(-RECENT),before:ts.slice(0,-RECENT)}:null;}
const list=(ts,max=6)=>{const s=ts.slice(0,max).map(t=>t.sym);return s.join(', ')+(ts.length>max?` and ${ts.length-max} more`:'');};
const symCount=(ts)=>{const m={};ts.forEach(t=>m[t.sym]=(m[t.sym]||0)+1);return Object.entries(m).map(([s,n])=>n>1?`${s} ×${n}`:s).join(', ');};

function styleOf(st){
  const wr=st.wr*100,p=st.payoff;
  const name=p===null?'No clear edge':p>=2?(wr<45?'Trend follower':'Strong edge'):p>=1?'Balanced':wr>=55?'Many small winners':'No clear edge';
  const pay=st.avgR>0.1?'pay':st.avgR<-0.1?'lose':'even';
  const margin=st.be!==null?wr-st.be*100:null;
  const v=st.n<5?'na':pay==='lose'?'bad':pay==='pay'&&margin>=10?'good':'watch';
  const phrase=pay==='lose'?'losing money':pay==='even'?'about break-even':margin>=10?'making money comfortably':'making money, but only just';
  return {name,pay,margin,v,phrase};
}
function check1(ts){
  const st=stats(ts),s=styleOf(st);
  const body=`You win <b>${pct(st.wr*100)}</b> of your trades (${st.w} of ${st.w+st.l}). ${s.name==='Trend follower'?"That's fine for your style, because your wins are much bigger than your losses: ":''}an average win is about <b>${times(st.payoff)} times</b> an average loss. With wins that size you need to win at least <b>${pct(st.be*100)}</b> of trades just to break even. You're at ${pct(st.wr*100)}, so ${s.pay==='lose'?'you are <b>losing money</b>':s.margin>=10?'you are making money with a <b>comfortable</b> margin':s.pay==='even'?'you are about <b>break-even</b>':'you are making money, with a <b>small</b> safety margin'}.`;
  let recent=null;const sp=split(ts);
  if(sp){
    const a=stats(sp.before),b=stats(sp.recent),sa=styleOf(a),sb=styleOf(b);
    const changed=sa.name!==sb.name||sa.pay!==sb.pay||Math.abs((b.wr-a.wr)*100)>=10||(a.payoff&&b.payoff&&Math.abs(b.payoff/a.payoff-1)>=0.3);
    const lossSame=a.lossR&&b.lossR&&Math.abs(b.lossR/a.lossR-1)<0.15;
    const fewer=(a.wr-b.wr)*100>=10, smaller=a.winR&&b.winR&&b.winR/a.winR<=0.7;
    let txt=changed?`In your last ${RECENT} trades you won <b>${b.w} (${pct(b.wr*100)})</b>, and an average win was about ${times(b.payoff)} times a loss. With wins that size you'd need to win about <b>${pct(b.be*100)}</b> to break even${b.wr<b.be?", and you're far below that":''}. Your style now looks <b>${sb.name}</b>, ${sb.phrase}.`
      :`Your last ${RECENT} trades look like the ones before: ${pct(b.wr*100)} wins, wins about ${times(b.payoff)} times a loss.`;
    if(changed){
      txt+= lossSame?`<br><b>Your stops still work:</b> losses are the same size as before (${R(a.lossR)} → ${R(b.lossR)}), so this isn't a discipline problem.`
        :`<br>Your losses ${b.lossR<a.lossR?'got bigger':'got smaller'} (${R(a.lossR)} → ${R(b.lossR)}).`;
      if(fewer||smaller)txt+=` <b>What changed is the winners:</b> ${fewer&&smaller?'fewer of them, and smaller':fewer?'fewer of them':'they got smaller'} (${R(a.winR)} → ${R(b.winR)}).`;
    }
    recent={v:sb.v,word:changed?(sb.v==='bad'?'losing money':sb.v==='good'?'better':'changed'):'no clear change',txt};
  }
  return {id:1,name:'Trading style',v:s.v,head:`${s.name} — ${s.phrase}`,body,recent,
    q:'Were there fewer strong trends in the market, or did your winners stop running as far as before?',why:'It could be the market, your exits, or your stock picks.',
    detail:`Win rate ${pct(st.wr*100)} · average win ${R(st.winR)} · average loss ${R(st.lossR)} · per trade ${R(st.avgR)} · ${st.n} trades · ${sample(st.n)}`,
    acts:sp?[{l:`Compare last ${RECENT} with the ${sp.before.length} before`,f:()=>openCompare('recent')}]:[]};
}
function check2(ts){
  const st=stats(ts),top=[...ts].filter(t=>t.net>0).sort((a,b)=>b.net-a.net).slice(0,3),topSum=sum(top.map(t=>t.net)),without=st.net-topSum,gross=sum(ts.filter(t=>t.net>0).map(t=>t.net));
  const v=ts.length<5?'na':st.net<0?'bad':without<0?'watch':'good';
  const head=v==='bad'?'no big win was large enough to carry the losses':v==='watch'?`your profit stands on ${top.length} big wins`:'your profit is spread over many trades';
  const body=`${top.map(t=>`${t.sym} (${usd0(t.net)})`).join(', ').replace(/, ([^,]*)$/,' and $1')} made <b>${usd0(topSum)}</b> together. Your other ${ts.length-top.length} trades together ${without>=0?'made':'lost'} <b>${usd0(without)}</b>. `+
    (v==='good'?'Your result does not depend on a handful of trades.':`That's normal for a trend follower: a few big wins pay for many small losses. <b>Good</b> as long as big wins keep coming; <b>bad</b> when they stop, because then the small losses add up.`);
  let recent=null;const sp=split(ts);
  if(sp){const b=stats(sp.recent),inRecent=top.filter(t=>sp.recent.includes(t)).length,big=b.best;
    const rv=b.net<0?'bad':(b.net-sum([...sp.recent].filter(t=>t.net>0).sort((a,c)=>c.net-a.net).slice(0,3).map(t=>t.net)))<0?'watch':'good';
    recent={v:rv,word:inRecent===0&&rv==='bad'?'the big wins stopped':VWORD[rv].toLowerCase(),txt:`${inRecent===0?`All ${top.length} came before your last ${RECENT} trades. `:''}In your last ${RECENT} trades your biggest win was ${big&&big.net>0?`${usd0(big.net)} (${big.sym})`:'none'}, and those ${RECENT} trades ${b.net>=0?'made':'lost'} <b>${usd0(b.net)}</b> together.`};}
  return {id:2,name:'A few big winners',v,head,body,recent,
    q:'Did fewer of your trades have the chance to become big wins, or were good trades stopped out before they could run?',why:'It could be the market, your exits, or your stock picks.',
    detail:`Top ${top.length} = ${pct(gross?100*topSum/gross:null)} of all your gains · ${ts.length} trades · ${sample(ts.length)}`,
    acts:[{l:`Open your ${top.length} biggest wins`,f:()=>openIds(top.map(t=>t.id),`${top.length} biggest wins`)},{l:'Compare them with all other trades',f:()=>openCompare('top3')}]};
}
function stopFacts(ts){
  const L=ts.filter(t=>t.net<0),withR=L.filter(t=>t.R!==null),past=withR.filter(t=>t.R<-1.15),far=withR.filter(t=>t.R<-1.5),early=withR.filter(t=>t.R>=-0.5),noSL=ts.filter(t=>t.init===null);
  const rate=withR.length?past.length/withR.length:0;
  const v=ts.length<5?'na':(rate>0.2||far.length>0||noSL.length>1)?'bad':(rate>0.1||noSL.length===1)?'watch':'good';
  return {L,withR,past,far,early,noSL,v,ok:withR.length-past.length};
}
function check3(ts){
  const f=stopFacts(ts);
  const head=f.v==='good'?'you respect your stops':f.v==='watch'?'you mostly respect your stops, with a few exceptions':'some losses went past your stop';
  const pastTxt=f.past.sort((a,b)=>a.R-b.R).map(t=>`${t.sym} (${R(t.R)})`).join(', ');
  const body=`<b>${f.ok} of your ${f.withR.length} losses</b> ended at your stop or earlier.`+(f.past.length?` <b>${f.past.length} went past it:</b> ${pastTxt}.`:'')+
    (f.noSL.length?` And <b>${f.noSL.length} trade${f.noSL.length>1?'s':''} had no stop at all</b> (${symCount(f.noSL)}${f.noSL.every(t=>mistakeName(t))?`, tagged “${[...new Set(f.noSL.map(mistakeName))].join('”, “')}”`:''}).`:'')+
    ` This matters because your style only works when losses stay small.`+(f.far.length?` One loss at ${R(f.far[0].R)} wipes out most of an average winner.`:'');
  let recent=null;const sp=split(ts);
  if(sp){const g=stopFacts(sp.recent);recent={v:g.v,word:g.v===f.v?'no change':g.v==='good'?'clearly better':g.v==='bad'?'worse':'changed',
    txt:`In your last ${RECENT} trades ${g.past.length===0?'no loss':g.past.length===1?'only 1 loss':g.past.length+' losses'} went past the stop${g.past.length?` (${g.past.map(t=>`${t.sym}, ${R(t.R)}`).join('; ')})`:''}${g.noSL.length?`, and ${g.noSL.length} trade${g.noSL.length>1?'s':''} had no stop`:' and every trade had a stop'}.${g.v==='good'&&f.v!=='good'?' The problem cases were in your earlier trades.':''}`};}
  const problem=[...f.past,...f.noSL];
  return {id:3,name:'Respecting stops',v:f.v,head,body,recent,
    q:'What happened in the trades that went past the stop?',why:"It could be a price gap overnight or at a report, a late exit, or a stop that wasn't placed in IBKR.",
    detail:`Losses: ${f.ok} at or before the stop · ${f.past.length} past it · ${f.noSL.length} without a stop · ${f.early.length} closed early · average loss ${R(stats(ts).lossR)} · ${f.L.length} losses · ${sample(f.L.length)}`,
    acts:problem.length?[{l:`Open the ${problem.length} trades`,f:()=>openIds(problem.map(t=>t.id),'past the stop or no stop')}]:[]};
}
function check4(ts){
  const blocks=[];for(let i=0;i<ts.length;i+=10)blocks.push(ts.slice(i,i+10));
  let cum=0,peak=-Infinity,pk=null,pi=-1;ts.forEach((t,i)=>{cum+=t.net;if(cum>peak){peak=cum;pk=t;pi=i;}});
  const since=ts.length-1-pi,drop=cum-peak;let streak=0;for(let i=ts.length-1;i>=0&&ts[i].net<0;i--)streak++;
  const capNow=+(RAW.capital.start?.amount||0)+sum(RAW.capital.flows.map(f=>f.type==='withdrawal'?-f.amount:+f.amount))+sum(RAW.dividends.map(d=>+d.amount))+sum(TR.map(t=>t.net));
  const sp=split(ts);let v='na';
  if(sp){const a=stats(sp.before),b=stats(sp.recent);v=b.net<0?'bad':(b.avgR<a.avgR||-drop>capNow*0.01)?'watch':'good';}
  let best=null;for(let i=0;i+RECENT<=ts.length;i++){const w=ts.slice(i,i+RECENT),n=sum(w.map(t=>t.net));if(!best||n>best.n)best={n,w};}
  const mon=(iso)=>new Date(iso+'T00:00:00Z').toLocaleString('en-GB',{month:'long',timeZone:'UTC'});
  const head=v==='bad'?`your results turned after ${dmy(pk.sellDate)}`:v==='watch'?'results are weaker than before':v==='good'?'your recent results hold up':'not enough trades yet';
  const body=(best?`Your best stretch was <b>${dmy(best.w[0].sellDate)} – ${dmy(best.w[best.w.length-1].sellDate)}</b>: ${usd0(best.n)} in ${RECENT} trades. `:'')+
    (since>0?`Since your best point on <b>${dmy(pk.sellDate)}</b> you've given back <b>${usd0(drop)}</b> over ${since} trades`:'You are at your best point right now')+
    (streak>1?`, and your last <b>${streak} trades are all losses</b>.`:'.');
  // (the blocks chart is drawn in the check's facts; the long text has no chart)
  return {id:4,name:'Results over time',v,head,body:body,recent:null,
    q:best?`What was different during ${mon(best.w[0].sellDate)}–${mon(best.w[best.w.length-1].sellDate)} compared with now?`:'What changed?',why:'It could be the market (fewer strong trends), the kind of stocks you picked, or how you managed your trades.',
    detail:`Best point ${usd0(peak)} on ${dmy(pk.sellDate)} · now ${usd0(cum)} · ${ts.length} trades · ${sample(ts.length)}`,
    acts:best?[{l:'Compare your best stretch with the trades since',f:()=>openCompareIds(best.w.map(t=>t.id),ts.slice(pi+1).map(t=>t.id),'Best stretch','Since the best point')},{l:'Show last 20 trades',f:()=>{F={...newF(),period:'last20'};renderAll();scrollToTable();}}]:[]};
}
const HOW=['First trade','Added higher','Added lower','Bought again after a loss','Bought again after a win'];
const HOWTXT={'First trade':'first trade in a stock','Added higher':'adding at a higher price','Added lower':'adding to a losing position (at a lower price)','Bought again after a loss':'buying again after a loss','Bought again after a win':'buying again after a win'};
function check5(ts){
  const g=Object.fromEntries(HOW.map(h=>[h,ts.filter(t=>t.how===h)])),first=stats(g['First trade']);
  let worst=null,v='good';
  for(const h of HOW.slice(1)){const s=stats(g[h]);if(s.n<5||s.avgR===null)continue;const lv=s.avgR<-0.25?'bad':first.avgR!==null&&s.avgR<=first.avgR-0.3?'watch':'good';
    if(lv==='bad'||(lv==='watch'&&v==='good')){if(!(v==='bad'&&lv==='watch')){v=lv;if(!worst||s.avgR<stats(g[worst]).avgR)worst=h;}}}
  if(first.n<5)v='na';
  const head=v==='bad'?`${HOWTXT[worst]} has cost you`:v==='watch'?`${HOWTXT[worst]} does worse than your first trades`:'buying the same stock again works about as well as your first trades';
  const rows=HOW.map(h=>{const s=stats(g[h]);if(!s.n)return'';return `<div>${h}</div><div class="r">${s.n} trades</div><div class="r">${s.w} won</div><div class="r ${s.net>=0?'pos':'neg'}"><b>${usd0(s.net)}</b> · ${R(s.avgR)}</div>`;}).join('');
  const body=`Your <b>first trade in a stock</b> earns ${R(first.avgR)} per trade. `+HOW.slice(1).filter(h=>g[h].length).map(h=>{const s=stats(g[h]);return `${h} (${s.n}): ${s.w} won, ${usd0(s.net)}${s.n<5?' (too few to judge)':''}.`;}).join(' ')+
    `<div class="grp" style="margin-top:10px"><div class="hd">How you bought</div><div class="hd r">Trades</div><div class="hd r">Wins</div><div class="hd r">Result · per trade</div>${rows}</div>`;
  let recent=null;const sp=split(ts);
  if(sp){const parts=HOW.map(h=>{const r=sp.recent.filter(t=>t.how===h);return r.length?`${h.toLowerCase()} ${usd0(sum(r.map(t=>t.net)))} (${r.length})`:null;}).filter(Boolean);
    const rf=sp.recent.filter(t=>t.how!=='First trade'),allLost=rf.length&&HOW.slice(1).every(h=>{const r=sp.recent.filter(t=>t.how===h);return !r.length||sum(r.map(t=>t.net))<0;});
    recent={v:allLost?'bad':'watch',word:allLost?'still bad':'mixed',txt:`In your last ${RECENT} trades: ${parts.join(' · ')}.${allLost?' Every type of re-buying lost money.':''}`};}
  const re=ts.filter(t=>t.how!=='First trade');
  return {id:5,name:'Buying the same stock again',v,head,body,recent,
    q:'What made you buy again: a new setup, or wanting to win back a loss?',why:"It could be the stock's setup, the market, or your decision process.",
    detail:`First ${R(first.avgR)} (${first.n}) · ${HOW.slice(1).map(h=>`${h.toLowerCase()} ${R(stats(g[h]).avgR)} (${g[h].length})`).join(' · ')} · groups under 10 trades are early signals`,
    acts:[{l:'Compare first trades with “Added lower”',f:()=>openCompare('lower')},{l:`Open the ${re.length} re-buys`,f:()=>{F={...newF(),how:HOW.slice(1)};renderAll();scrollToTable();}}]};
}
function check6(ts){
  const fast=ts.filter(t=>t.net<0&&t.days<=1),rate=ts.length?fast.length/ts.length:0,held=ts.filter(t=>t.days>=6),hs=stats(held),fs=stats(fast);
  const v=ts.length<5?'na':rate<=0.1?'good':rate<=0.2?'watch':'bad';
  const tagged=fast.filter(t=>mistakeName(t)&&t.errorId!==PLAN);
  const head=v==='good'?'few trades fail on the first day':`about ${Math.round(rate*10)>=2?'1 in '+Math.round(1/rate):fast.length+' of '+ts.length} of your trades fail on the first day`;
  const body=`<b>${fast.length} of your ${ts.length} trades</b> were closed at a loss within a day of buying, <b>${usd0(fs.net)}</b> together${fs.net<0&&stats(ts).net>0?`, which is ${pct(-100*fs.net/stats(ts).net)} of your total profit (${usd0(stats(ts).net)})`:''}. `+
    `Your trades held 6 days or more did far better: ${hs.w} of ${hs.n} won, <b>${usd0(hs.net)}</b>. `+
    (fast.length?`<b>${tagged.length} of the ${fast.length}</b> have a mistake noted${tagged.length?` (${[...new Set(tagged.map(mistakeName))].join(', ')})`:''}.${fast.length-tagged.length?` The other ${fast.length-tagged.length} have no note.`:''}`:'');
  let recent=null;const sp=split(ts);
  if(sp){const r=sp.recent.filter(t=>t.net<0&&t.days<=1),rr=r.length/RECENT,rv=rr<=0.1?'good':rr<=0.2?'watch':'bad';
    recent={v:rv,word:rv===v?'no change':rv==='good'?'better':'worse',txt:`${r.length} of your last ${RECENT} trades failed right away${r.length?` (${symCount(r)}), ${usd0(sum(r.map(t=>t.net)))} together`:''}.`};}
  return {id:6,name:'Trades that fail right away',v,head,body,recent,
    q:'What was different on the day you bought these?',why:'It could be chasing a fast move, buying before the setup was ready, an emotional trade after a loss, or a stop placed too tight.',
    detail:`${fast.length} of ${ts.length} trades (${pct(rate*100)}) · ${usd0(fs.net)} · average ${R(fs.avgR)} · ${sample(fast.length)}`,
    acts:[{l:`Open the ${fast.length} trades`,f:()=>{F={...newF(),days:['0–1'],result:'losers'};renderAll();scrollToTable();}},{l:'Compare them with trades held 6+ days',f:()=>openCompare('fast')}]};
}
function check7(ts){
  const real=ts.filter(realSetup),rate=ts.length?real.length/ts.length:0,names=realErrors().map(e=>e.name.toLowerCase());
  const mention=ts.filter(t=>!t.errorId&&names.some(n=>t.comment.toLowerCase().includes(n)));
  const mist=ts.filter(t=>t.errorId&&t.errorId!==PLAN),plan=ts.filter(t=>PLAN&&t.errorId===PLAN),none=ts.filter(t=>!t.errorId);
  const v=ts.length<5?'na':rate<0.5?'bad':(rate<0.8||mention.length)?'watch':'good';
  const head=v==='bad'?"your journal can't yet tell you which setup works":v==='watch'?'some trades are still missing tags':'your trades are well tagged';
  const per={};real.forEach(t=>{(per[setupName(t)]??=[]).push(t);});
  const ready=Object.entries(per).filter(([,a])=>a.length>=10);
  const body=`<b>${ts.length-real.length} of ${ts.length}</b> trades are still “Unclassified” (setup missing), so History can't compare your setups yet. `+
    `<b>Mistakes:</b> ${mist.length} trade${mist.length===1?'':'s'} have a mistake tagged (${[...new Set(mist.map(mistakeName))].map(n=>`${n} ×${mist.filter(t=>mistakeName(t)===n).length}`).join(', ')}), ${plan.length} are marked “Followed my plan”, and <b>${none.length} are not filled in</b>.`+
    (mention.length?` <b>${mention.length} comment${mention.length>1?'s':''} mention a mistake without the tag</b> (${list(mention)}).`:' No comment mentions a mistake without its tag.')+
    (ready.length?`<div style="margin-top:8px">${ready.map(([n,a])=>{const s=stats(a);return `<b>${esc(n)}</b>: ${s.n} trades, ${pct(s.wr*100)} won, ${R(s.avgR)} per trade`;}).join('<br>')}</div>`:'');
  let recent=null;const sp=split(ts);
  if(sp){const r=sp.recent.filter(realSetup).length;recent={v:r/RECENT<0.5?'bad':r/RECENT<0.8?'watch':'good',word:r===0?'no change':'improving',txt:`${r} of your last ${RECENT} trades have a real setup.`};}
  return {id:7,name:'Missing tags',v,head,body,recent,
    q:'Which setup was each trade? Once a setup has 10 or more closed trades, History shows how it performs.',why:'Setup is now in the main Open trade form; older trades can be tagged here, one by one.',
    detail:`Real setup ${real.length} of ${ts.length} (${pct(rate*100)}) · mistakes tagged ${mist.length} · followed my plan ${plan.length} · not filled in ${none.length}`,
    acts:[{l:'Tag trades without a setup',f:()=>{F={...newF(),setups:['__none']};renderAll();scrollToTable();openFirstRow();}},...(mention.length?[{l:`Open the ${mention.length} comments`,f:()=>openIds(mention.map(t=>t.id),'mistake only in comment')}]:[])]};
}
const CHECKS=[check1,check2,check3,check4,check5,check6,check7];
let openCheck=0;

// ---------------------------------------------------------------- filters
const DAYS={'0–1':[0,1],'2–5':[2,5],'6–20':[6,20],'21+':[21,99999]};
const newF=()=>({period:'all',from:'',to:'',syms:[],result:'all',labels:[],setups:[],mistakes:[],days:[],sds:[],how:[],q:'',ids:null,idsLabel:'',not:[],skip:[]});
let F=newF();
function applyF(f,ts=TR){
  let r=ts;
  if(f.period==='last20')r=r.slice(-20);
  else if(f.period!=='all'){const t=new Date();let from;
    if(f.period==='month')from=new Date(Date.UTC(t.getFullYear(),t.getMonth(),1));
    else if(f.period==='3m')from=new Date(Date.UTC(t.getFullYear(),t.getMonth()-3,t.getDate()));
    else if(f.period==='year')from=new Date(Date.UTC(t.getFullYear(),0,1));
    if(from){const iso=from.toISOString().slice(0,10);r=r.filter(x=>x.sellDate>=iso);}
    if(f.period==='custom'){if(f.from)r=r.filter(x=>x.sellDate>=f.from);if(f.to)r=r.filter(x=>x.sellDate<=f.to);}}
  // 2026-11-10: each list filter can "show only" the chosen values or "leave out" them (f.not holds the keys in leave-out mode)
  const keep=(k,fn)=>{if(f[k].length){const out=(f.not||[]).includes(k);r=r.filter(t=>fn(t)!==out);}};
  keep('syms',t=>f.syms.includes(t.symRaw));
  if(f.result==='winners')r=r.filter(t=>t.net>0);else if(f.result==='losers')r=r.filter(t=>t.net<0);
  keep('labels',t=>f.labels.includes(t.labelRaw));
  keep('setups',t=>f.setups.includes(realSetup(t)?setupNameRaw(t):'__none'));
  keep('mistakes',t=>f.mistakes.includes(t.errorId?mistakeNameRaw(t):'__none'));
  keep('days',t=>f.days.some(d=>t.days>=DAYS[d][0]&&t.days<=DAYS[d][1]));
  keep('sds',t=>f.sds.includes(t.sdRaw));
  keep('how',t=>f.how.includes(t.how));
  if(f.q.trim())r=r.filter(t=>t.comment.toLowerCase().includes(f.q.trim().toLowerCase()));
  if(f.ids)r=r.filter(t=>f.ids.includes(t.id));
  if(f.skip&&f.skip.length)r=r.filter(t=>!f.skip.includes(t.id));
  return r;
}
// the same filters without anything "left out" (leave-out filters and ticked-off rows): the "before" side of the effect line
const outKeys=(f)=>(f.not||[]).filter(k=>f[k].length);
const hasOut=(f)=>outKeys(f).length>0||(f.skip||[]).length>0;
function baseF(f){const b={...f,not:[],skip:[]};for(const k of outKeys(f))b[k]=[];return b;}
const OPTS={
  syms:()=>[...new Set(TR.map(t=>t.symRaw))].sort().map(s=>[s,s]),
  labels:()=>[...S.rCategories.map(r=>r[1]),S.rCategoryElse,'–'].map(s=>[s,s==='–'?'No label (no stop)':s]),
  setups:()=>[['__none','Unclassified (missing)'],...RAW.setups.filter(s=>s.name!=='Unclassified').map(s=>[s.name,s.name])],
  mistakes:()=>[['__none','Not filled in'],['Followed my plan','Followed my plan'],...realErrors().map(e=>[e.name,e.name])],
  days:()=>Object.keys(DAYS).map(d=>[d,d==='0–1'?'0–1 days (failed right away)':d+' days']),
  sds:()=>[...S.stopDistance.map(s=>s[1]),S.stopDistanceElse,'No SL'].map(s=>[s,s]),
  how:()=>HOW.map(h=>[h,h]),
};
const FNAME={syms:'Symbol',labels:'Result label',setups:'Setup',mistakes:'Mistake',days:'Days held',sds:'Stop distance',how:'How you bought'};
const PERIODS=[['all','All trades'],['last20','Last 20 trades'],['month','This month'],['3m','Last 3 months'],['year','This year'],['custom','Own dates…']];
let openMs=null;
if(typeof document!=='undefined')document.addEventListener('click',e=>{if(openMs&&!openMs.contains(e.target)){openMs.querySelector('.pop')?.remove();openMs=null;}});
function ms(key,f,onChange){
  const w=document.createElement('div');w.className='ms';
  const b=document.createElement('button');b.type='button';b.className=f[key].length?'act':'';
  const isOut=(f.not||[]).includes(key);if(isOut&&f[key].length)b.className='act out';
  b.textContent=f[key].length?`${isOut?'Leave out ':FNAME[key]+': '}${f[key].length===1?(OPTS[key]().find(o=>o[0]===f[key][0])?.[1]??f[key][0]):f[key].length+(isOut?' '+FNAME[key].toLowerCase()+'s':' chosen')}`:FNAME[key];
  b.onclick=(e)=>{e.stopPropagation();if(openMs===w){w.querySelector('.pop')?.remove();openMs=null;return;}
    if(openMs){openMs.querySelector('.pop')?.remove();}openMs=w;
    const p=document.createElement('div');p.className='pop';
    if(f.not){const sw=document.createElement('div');sw.className='msmode';for(const [m,l] of [[false,'Show only'],[true,'Leave out']]){const x=document.createElement('button');x.type='button';x.textContent=l;x.className=((f.not.includes(key))===m)?'on':'';
      x.onclick=(e)=>{e.stopPropagation();f.not=m?[...new Set([...f.not,key])]:f.not.filter(k=>k!==key);p.querySelectorAll('.msmode button').forEach((y,i)=>y.className=(i===1)===m?'on':'');if(f[key].length)onChange(key);};sw.append(x);}p.append(sw);}
    for(const [v,l] of OPTS[key]()){const lab=document.createElement('label');const c=document.createElement('input');c.type='checkbox';c.checked=f[key].includes(v);
      c.onchange=()=>{f[key]=c.checked?[...f[key],v]:f[key].filter(x=>x!==v);onChange(key);};lab.append(c,document.createTextNode(l));p.append(lab);}
    w.append(p);};
  w.append(b);return w;
}
let showMore=false;

let view='report',sort={k:'sellDate',d:-1},page=0,openRow=null;const PAGE=25;

// ---------------------------------------------------------------- compare
const CMPF=['syms','days','how','mistakes','setups','labels'];
let G={a:{...newF(),name:'Group A'},b:{...newF(),name:'Group B'}};let gInit=false;
const PRESETS={
  recent:()=>{const ids=TR.slice(-RECENT).map(t=>t.id);return [{...newF(),ids,idsLabel:'last 20',name:`Last ${RECENT} trades`},{...newF(),ids:TR.slice(0,-RECENT).map(t=>t.id),idsLabel:'before',name:'The trades before'}];},
  lower:()=>[{...newF(),how:['First trade'],name:'First trades'},{...newF(),how:['Added lower'],name:'Added lower'}],
  fast:()=>[{...newF(),days:['0–1'],result:'losers',name:'Failed right away'},{...newF(),days:['6–20','21+'],name:'Held 6+ days'}],
  top3:()=>{const top=[...TR].filter(t=>t.net>0).sort((a,b)=>b.net-a.net).slice(0,3).map(t=>t.id);return [{...newF(),ids:top,idsLabel:'3 biggest wins',name:'3 biggest wins'},{...newF(),ids:TR.filter(t=>!top.includes(t.id)).map(t=>t.id),idsLabel:'all others',name:'All other trades'}];},
  plan:()=>[{...newF(),mistakes:['Followed my plan'],name:'Followed my plan'},{...newF(),mistakes:realErrors().map(e=>e.name),name:'With a mistake'}],
  stock:()=>{const top=Object.entries(TR.reduce((m,t)=>(m[t.symRaw]=(m[t.symRaw]||0)+1,m),{})).sort((a,b)=>b[1]-a[1])[0][0];return [{...newF(),syms:[top],name:top},{...newF(),syms:[...new Set(TR.map(t=>t.symRaw))].filter(s=>s!==top),name:'All other stocks'}];},
};
const PNAMES=[['recent',`Last ${RECENT} vs before`],['lower','First trades vs added lower'],['fast','Failed right away vs held 6+ days'],['top3','3 biggest wins vs the rest'],['plan','Followed my plan vs mistakes'],['stock','One stock vs all others']];
function openCompare(k){gInit=true;[G.a,G.b]=PRESETS[k]();view='compare';renderAll();scrollToTable();}
function openCompareIds(a,b,na,nb){gInit=true;G.a={...newF(),ids:a,idsLabel:na.toLowerCase(),name:na};G.b={...newF(),ids:b,idsLabel:nb.toLowerCase(),name:nb};view='compare';renderAll();scrollToTable();}
function openIds(ids,label){F={...newF(),ids,idsLabel:label};view='trades';renderAll();scrollToTable();}
function cmpSentence(a,b,sa,sb){
  if(!sa.n||!sb.n)return `${!sa.n?a.name:b.name} has no trades yet, so there is nothing to compare.${a.name==='Followed my plan'||b.name==='Followed my plan'?' “Followed my plan” is a new choice: it fills up as you tag trades.':''}`;
  const verb=(s)=>s.avgR===null?'has no R':s.avgR>0.05?`earned ${R(s.avgR)} per trade`:s.avgR<-0.05?`lost ${R(s.avgR)} per trade`:'was about break-even';
  const small=[[a,sa],[b,sb]].filter(([,s])=>s.n<10).map(([g,s])=>`${g.name} is small (${s.n} trades): ${sample(s.n)}.`).join(' ');
  return `<b>${esc(a.name)}</b> ${verb(sa)} and won ${pct(sa.wr*100)}; <b>${esc(b.name)}</b> ${verb(sb)} and won ${pct(sb.wr*100)}. ${small}`;
}

// ================================================================ design 4 UI (program parts only)
const capz=(s)=>s.charAt(0).toUpperCase()+s.slice(1);
// ---- report: short facts per check, each with a plain hover explanation (title); "last 20" as one plain sentence
const m0=(n)=>'$'+fx(Math.abs(n),0);
const RTIP='R = how many times the money you planned to risk (buy price − initial stop) × shares.';
function factsFor(id){
  const ts=TR,st=stats(ts),sp=split(ts),r=sp?sp.recent:[],rs=sp?stats(r):null;
  const f=(l,v,d,c,tip)=>({l,v,d,c:c||'',tip});
  if(id===1)return{f:[
      f('Win rate',pct(st.wr*100),`${st.w} of ${st.w+st.l} trades`,st.wr>=st.be?'pos':'neg',`The share of your trades that made money: ${st.w} of ${st.w+st.l}. With your win and loss sizes you need at least ${pct(st.be*100)} to break even.`),
      f('Average win',R(st.winR),'per winning trade','pos',`A winning trade made on average ${fx(st.winR,2)} times the money you planned to risk. ${RTIP}`),
      f('Average loss',R(st.lossR),'per losing trade','neg',`A losing trade lost on average ${fx(-st.lossR,2)} times the money you planned to risk. ${RTIP}`),
      f('Per trade',R(st.avgR),'all trades together',st.avgR>0?'pos':'neg',`Wins and losses together: each trade ${st.avgR>=0?'made':'lost'} on average ${fx(Math.abs(st.avgR),2)} times the money you risked. Above 0 = you make money over time. ${RTIP}`)],
    last:rs?(()=>{const bs=stats(sp.before);const smaller=bs.winR&&rs.winR&&rs.winR<bs.winR*0.85;return `You won ${rs.w} of ${RECENT} (${pct(rs.wr*100)}). ${smaller?`Your wins were smaller than before (${R(rs.winR)} instead of ${R(bs.winR)}), so you`:'You'} needed ${pct(rs.be*100)} to break even — ${rs.avgR<0?'so these trades lost money':'so these trades still made money'}.`;})():null};
  if(id===2){const top=[...ts].filter(t=>t.net>0).sort((a,b)=>b.net-a.net).slice(0,3),tsum=sum(top.map(t=>t.net)),gross=sum(ts.filter(t=>t.net>0).map(t=>t.net)),rest=st.net-tsum;
    return{f:[f(`Your ${top.length} biggest win${top.length===1?'':'s'}`,'+'+m0(tsum),top.map(t=>t.sym).join(', '),'pos',`${top.map(t=>`${t.sym} ${usd0(t.net)}`).join(', ')}. Together ${m0(tsum)}.`),
      f(`The other ${ts.length-top.length} trades`,(rest<0?'−':'+')+m0(rest),'all together',rest>=0?'pos':'neg',`All your other trades together ${rest<0?'lost':'made'} ${m0(rest)}. ${rest<0?'Without the 3 big wins you would be at a loss.':''}`),
      f('Share of all your gains',pct(100*tsum/gross),'came from those 3','',`Of all the money your winning trades made (${m0(gross)}), ${pct(100*tsum/gross)} came from just these 3 trades.`)],
      last:rs?(rs.net<0?`Your biggest win was only ${m0(rs.best.net)} (${rs.best.sym}). No big win came to pay for the small losses, so these ${RECENT} trades lost ${m0(rs.net)} together.`:`These ${RECENT} trades made ${m0(rs.net)} together; the biggest win was ${m0(rs.best.net)} (${rs.best.sym}).`):null};}
  if(id===3){const x=stopFacts(ts),y=sp?stopFacts(r):null,worst=x.past.length?x.past.reduce((a,b)=>b.R<a.R?b:a):null;
    let last=null;if(y){last=(y.past.length===0?'No loss went past the stop':y.past.length===1?`Only 1 loss went past the stop (${y.past[0].sym})`:`${y.past.length} losses went past the stop (${y.past.map(t=>t.sym).join(', ')})`)+(y.noSL.length?`, and ${y.noSL.length} trade${y.noSL.length>1?'s':''} had no stop.`:', and every trade had a stop.');
      last=(y.v==='good'&&x.v!=='good'?'Better than before. ':y.v===x.v?'':'')+last;}
    return{f:[f('Losses at the stop or earlier',`${x.ok} of ${x.withR.length}`,'losses','',`${x.ok} of your ${x.withR.length} losses (with a stop) ended at your stop or before it — down to −1,15 R.`),
      f('Went past the stop',x.past.length,worst?`worst ${worst.sym} ${R(worst.R)}`:'',x.past.length?'neg':'',`Losses bigger than −1,15 R: ${x.past.map(t=>`${t.sym} ${R(t.R)}`).join(', ')||'none'}. ${RTIP}`),
      f('Trades without a stop',x.noSL.length,x.noSL.length?symCount(x.noSL):'none',x.noSL.length?'neg':'',`Trades bought without an initial stop: ${symCount(x.noSL)||'none'}.`)],last};}
  if(id===4){let cum=0,peak=-Infinity,pk=null,pi=-1;ts.forEach((t,i)=>{cum+=t.net;if(cum>peak){peak=cum;pk=t;pi=i;}});let streak=0;for(let i=ts.length-1;i>=0&&ts[i].net<0;i--)streak++;
    return{f:[f('Best point','+'+m0(peak),dmy(pk.sellDate),'pos',`Your total result from closed trades was highest on ${dmy(pk.sellDate)}: ${m0(peak)}.`),
      f('Given back since','−'+m0(cum-peak),`over ${ts.length-1-pi} trades`,cum-peak<0?'neg':'',`Since that day your total went down by ${m0(cum-peak)}, over ${ts.length-1-pi} closed trades. Now: ${usd0(cum)}.`),
      f('Losing streak now',streak,streak===1?'trade':'losses in a row',streak>2?'neg':'',`Your last ${streak} closed trades were all losses.`)],
      last:rs?`These ${RECENT} trades ${rs.net<0?'lost':'made'} ${m0(rs.net)} together; only ${rs.w} of them were wins.`:null,bars:true};}
  if(id===5){const g=(h)=>stats(ts.filter(t=>t.how===h));const a=g('First trade'),b=g('Added higher'),c=g('Added lower');
    const parts=HOW.map(h=>{const q=r.filter(t=>t.how===h);if(!q.length)return null;const n=sum(q.map(t=>t.net));return `${HOWTXT[h]} ${n<0?'lost':'made'} ${m0(n)} (${q.length} trade${q.length>1?'s':''})`;}).filter(Boolean);
    const tip=(nm,s)=>`${nm}: ${s.n} trades, ${s.w} won, ${usd0(s.net)} together. Each trade ${s.avgR>=0?'made':'lost'} on average ${fx(Math.abs(s.avgR),2)} times the money you risked. ${RTIP}`;
    return{f:[f('First trade in a stock',R(a.avgR),`per trade · ${a.n} trades`,a.avgR>0?'pos':'neg',tip('Your first trade in a stock',a)),
      f('Added at a higher price',R(b.avgR),`per trade · ${b.n} trades`,b.avgR>0?'pos':'neg',tip('Bought more while the first trade was open, at a higher price',b)),
      f('Added at a lower price',R(c.avgR),`per trade · ${c.n} trades`,c.avgR>0?'pos':'neg',tip('Bought more while the first trade was open, at a lower price (adding to a loser)',c))],
      last:sp?(parts.length?capz(parts.join(', '))+'.':'No re-buys.'):null};}
  if(id===6){const fast=ts.filter(t=>t.net<0&&t.days<=1),held=stats(ts.filter(t=>t.days>=6)),rf=r.filter(t=>t.net<0&&t.days<=1);
    return{f:[f('Lost within a day',`${fast.length} of ${ts.length}`,fast.length?`about 1 in ${Math.round(ts.length/fast.length)}`:'none','',`${fast.length} trades were sold at a loss on the day of buying or the day after: ${symCount(fast)}.`),
      f('What they cost',(fast.length?'−':'')+m0(sum(fast.map(t=>t.net))),'together','neg',`Those ${fast.length} trades lost ${m0(sum(fast.map(t=>t.net)))} together${st.net>0&&fast.length?` — ${pct(-100*sum(fast.map(t=>t.net))/st.net)} of your total profit`:''}.`),
      f('Held 6 days or more',(held.net<0?'−':'+')+m0(held.net),`${held.w} of ${held.n} won`,held.net>0?'pos':'neg',`Trades you kept 6 days or more: ${held.n} trades, ${held.w} won, ${usd0(held.net)} together.`)],
      last:sp?(rf.length?`${rf.length} trades lost within a day (${symCount(rf)}) and cost ${m0(sum(rf.map(t=>t.net)))} together.`:'No trade lost within a day.')+(Math.abs(rf.length/RECENT-fast.length/ts.length)<0.06?' About the same as before.':rf.length/RECENT<fast.length/ts.length?' Fewer than before.':' More than before.'):null};}
  if(id===7){const real=ts.filter(realSetup).length,mist=ts.filter(t=>t.errorId&&t.errorId!==PLAN).length,none=ts.filter(t=>!t.errorId).length,rr=r.filter(realSetup).length;
    return{f:[f('With a real setup',`${real} of ${ts.length}`,'trades','',`Trades with a setup other than “Unclassified”. History compares setups once one has 10 or more closed trades.`),
      f('Mistake filled in',mist,'trades','',`Trades where you picked a mistake, for example FOMO or Revenge trade.`),
      f('Mistake left empty',none,'trades','',`Trades where the Mistake box is empty. Pick “Followed my plan” when there was no mistake.`)],
      last:sp?`${rr} of the ${RECENT} have a real setup${rr===0?', so History still can\'t tell which setup works for you':''}.`:null};}
}
let CK=[];
function renderChecks(){
  CK=CHECKS.map(c=>c(TR));
  if(!openCheck){const first=CK.find(c=>c.v==='bad')||CK.find(c=>c.v==='watch')||CK[0];openCheck=first.id;}
  $('checks').innerHTML=CK.map(c=>`<button class="hrl${c.id===openCheck?' on':''}" data-id="${c.id}" aria-pressed="${c.id===openCheck}"><span>${c.id}. ${c.name}${repChanged(c.id)?' <i class="chgdot" title="Changed since you last looked"></i>':''}</span><span class="w">${VWORD[c.v]}</span></button>`).join('');
  ROOT.querySelectorAll('.hrl').forEach(b=>b.onclick=()=>{openCheck=+b.dataset.id;renderChecks();if(window.innerWidth<900)$('ckcard').scrollIntoView({behavior:'smooth',block:'start'});});
  const c=CK.find(x=>x.id===openCheck),F4=factsFor(c.id),pc={good:'pos',watch:'warn',bad:'neg',na:''}[c.v];
  const N=NOW.report[c.id],P=repChanged(c.id)?PREV.report[c.id]:null,P0=PREV?.report?.[c.id];
  let bars='';
  if(F4.bars){const bl=[];for(let i=0;i<TR.length;i+=10)bl.push(sum(TR.slice(i,i+10).map(t=>t.net)));const mx=Math.max(...bl.map(Math.abs));
    bars=`<div class="hline"><span class="k">Blocks of 10 trades</span><span style="display:grid;gap:4px"><span class="hbars">${bl.map(n=>`<i title="${usd0(n)}" style="height:${Math.max(3,Math.abs(n)/mx*44)}px;background:${n>=0?'var(--pos)':'var(--neg)'}"></i>`).join('')}</span><span class="note" style="display:flex;gap:6px">${bl.map(n=>`<span style="width:44px;text-align:center">${usd0(n)}</span>`).join('')}</span></span></div>`;}
  $('ckcard').innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="pill ${pc}">${VWORD[c.v]}</span>${P0&&P0.v!==c.v?`<span class="chgtag">Was ${VWORD[P0.v]}</span>`:''}<span class="note">Check ${c.id} of 7 · ${c.name}</span></div>
    <h2>${capz(c.head)}.</h2>
    <div class="hfacts">${F4.f.map((x,i)=>{const pv=P?P.f[i]:undefined,ch=was(pv,String(x.v));return `<div class="metric${ch?' chg':''}" title="${esc((ch?'Before: '+pv+'. ':'')+(x.tip||''))}"><span class="lab">${x.l}</span><span class="v ${x.c}">${x.v}</span><span class="d">${ch?`<b class="was">was ${pv}</b>`:(x.d||'&nbsp;')}</span></div>`;}).join('')}</div>
    <div style="margin-top:8px">
      ${F4.last?`<div class="hline${P0&&(P0.rv||'')!==(N.rv||'')?' chg':''}"><span class="k">Last ${RECENT} trades</span><span>${F4.last}${P0&&(P0.rv||'')!==(N.rv||'')?` <span class="chgtag">Was ${VWORD[P0.rv]||'–'}, now ${VWORD[N.rv]||'–'}</span>`:''}</span></div>`:''}
      ${bars}
      <div class="hline"><span class="k">Ask yourself</span><span>${c.q}</span></div>
    </div>
    <div id="ckacts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"></div>
    <details class="hmore" style="margin-top:14px"><summary>Read the full explanation</summary><p>${c.body}</p>${c.recent?`<p><b>Last ${RECENT} trades:</b> ${c.recent.txt}</p>`:''}<p><i>${c.why}</i></p><p class="note">${c.detail}</p></details>`;
  const a=$('ckacts');c.acts.forEach((x,i)=>{const b=document.createElement('button');b.className='btn'+(i===0?' pri':'');b.textContent=x.l;b.onclick=x.f;a.append(b);});
}

// ---- trades table (program list table)
const COLS4=[['sym','Symbol'],['sellDate','Sold'],['days','Days','r'],['net','Net result','r'],['capPct','% capital','r'],['R','R','r'],['label','Result'],['setup','Setup'],['mistake','Mistake'],['c','']];
const labC=(l)=>/WINNER|GAIN/.test(l)?'g':l==='CONTROLLED LOSS'?'o':/LOSS/.test(l)?'r':'';
function renderTable(ts,inc=ts){
  const counted=new Set(inc.map(t=>t.id));
  const v=$('tview');
  if(!ts.length){v.innerHTML=`<div class="hempty"><b>No trades match these filters.</b><br><button class="linkbtn" id="rst">Reset filters</button></div>`;$('rst').onclick=()=>{F=newF();renderAll();};return;}
  const val=(t,k)=>k==='setup'?(realSetup(t)?setupName(t):'~'):k==='mistake'?(mistakeName(t)??'~'):k==='c'?t.comment:t[k];
  const rows=[...ts].sort((a,b)=>{const x=val(a,sort.k),y=val(b,sort.k);return ((x??-1e9)<(y??-1e9)?-1:(x??-1e9)>(y??-1e9)?1:a.order-b.order)*sort.d;});
  const pages=Math.max(1,Math.ceil(rows.length/PAGE));if(page>=pages)page=pages-1;const shown=rows.slice(page*PAGE,page*PAGE+PAGE);
  const tn=(n)=>n>0?'pos':n<0?'neg':'';
  v.innerHTML=`<div class="tw fx"><table class="stk"><thead><tr>${COLS4.map(([k,l,c])=>`<th class="sortable ${c||''}${sort.k===k?' on':''}">${k==='c'?'':`<button data-k="${k}">${l}<span class="sa">${sort.k===k?(sort.d>0?'▲':'▼'):'↕'}</span></button>`}</th>`).join('')}</tr></thead><tbody>${
    shown.map(t=>{const nw=PREV?.trades?.ids&&!PREV.trades.ids.includes(t.id);return `<tr class="hrow${openRow===t.id?' open':''}${nw?' newrow':''}${counted.has(t.id)?'':' outrow'}" data-id="${t.id}" tabindex="0"><td><input type="checkbox" class="hcount" data-cnt="${t.id}"${counted.has(t.id)?' checked':''}${!counted.has(t.id)&&!F.skip.includes(t.id)?' disabled title="Left out by a filter"':' title="Untick to leave this trade out of the numbers"'} aria-label="Count ${t.symRaw} ${t.id}"><b class="lsym">${t.sym}</b>${nw?' <span class="chgtag">New</span>':''}<span class="htid">${t.id}</span></td><td>${dmy(t.sellDate)}</td><td class="r">${t.days}</td>
     <td class="r ${tn(t.net)}"><b>${usd(t.net)}</b></td><td class="r ${tn(t.net)}">${sx(t.capPct,2)} %</td><td class="r">${t.R===null?'<span class="mut">–</span>':sx(t.R,2)}</td>
     <td>${t.label==='–'?'<span class="mut">–</span>':`<span class="hlab ${labC(t.label)}">${capz(t.label.toLowerCase())}</span>`}</td><td>${realSetup(t)?setupName(t):'<span class="lmiss">Missing</span>'}</td><td>${mistakeName(t)?mistakeName(t):'<span class="mut">–</span>'}</td><td>${t.comment?'💬':''}</td></tr>${openRow===t.id?detailRow4(t):''}`;}).join('')}</tbody></table></div>
    <div class="lfoot"><span class="note">Showing ${shown.length} of ${rows.length} trades${rows.length>counted.size?` · <b>${rows.length-counted.size} left out</b> (grey)`:''} · untick a trade to leave it out · click a row for details</span><span style="display:flex;gap:8px;align-items:center">${pages>1?`<span class="lpager">${Array.from({length:pages},(_,i)=>`<button class="btn sm${i===page?' on':''}" data-p="${i}">${i+1}</button>`).join('')}</span>`:''}<button class="btn sm" id="hx-export">Export to Excel</button></span></div>`;
  $('hx-export').onclick=()=>exportExcel(rows.filter(t=>counted.has(t.id)));
  v.querySelectorAll('[data-cnt]').forEach(c=>{c.onclick=(e)=>e.stopPropagation();c.onchange=()=>{const id=c.dataset.cnt;F.skip=c.checked?F.skip.filter(x=>x!==id):[...F.skip,id];renderAll();};});
  // 2026-11-09: a second sideways scroll bar that stays at the bottom of the window while the table's own bar is out of sight
  // (e.g. with two windows side by side). Both bars move together; the floating one hides when the table's own bar is visible.
  {const tw=v.querySelector('.tw'),fl=document.createElement('div'),inner=document.createElement('div');fl.className='hfloat';fl.setAttribute('aria-hidden','true');fl.append(inner);tw.after(fl);
   let own=false,lock=false;const sync=()=>{inner.style.width=tw.scrollWidth+'px';fl.hidden=own||tw.scrollWidth<=tw.clientWidth+1;fl.scrollLeft=tw.scrollLeft;};
   fl.addEventListener('scroll',()=>{if(lock)return;lock=true;tw.scrollLeft=fl.scrollLeft;lock=false;});
   tw.addEventListener('scroll',()=>{if(lock)return;lock=true;fl.scrollLeft=tw.scrollLeft;lock=false;});
   const foot=v.querySelector('.lfoot');if(foot&&'IntersectionObserver' in window)new IntersectionObserver((e)=>{own=e[0].isIntersecting;sync();}).observe(foot);
   if('ResizeObserver' in window)new ResizeObserver(sync).observe(tw);requestAnimationFrame(sync);}
  v.querySelectorAll('th button').forEach(b=>b.onclick=()=>{const k=b.dataset.k;sort={k,d:sort.k===k?-sort.d:(['net','R','capPct','days','sellDate'].includes(k)?-1:1)};renderTable(ts,inc);});
  v.querySelectorAll('tr.hrow').forEach(r=>{const go=()=>{openRow=openRow===r.dataset.id?null:r.dataset.id;renderTable(ts,inc);};r.onclick=go;r.onkeydown=(e)=>{if(e.key==='Enter'){e.preventDefault();go();}};});
  v.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{page=+b.dataset.p;renderTable(ts,inc);});
  v.querySelectorAll('[data-symf]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();F={...newF(),syms:[b.dataset.symf]};openRow=null;renderAll();});
  v.querySelectorAll('[data-esale]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();editSale(CTX,b.dataset.trade,b.dataset.esale);});
  v.querySelectorAll('select[data-tag]').forEach(s=>{s.onclick=(e)=>e.stopPropagation();
    // "+ New…" like in Edit trade (2026-11-09): type a new setup or mistake right here; it is added to the list and saved on the trade in one step
    const row=withNew(s,s.dataset.tag==='setupId'?'Setup':'Mistake');s.closest('.dtag').append(row);
    s.addEventListener('change',()=>{if(s.value!=='__new')saveTag(s.dataset.id,s.dataset.tag,s.value);});});
}
function detailRow4(t){
  const so=RAW.setups.filter(s=>s.name!=='Unclassified'&&(!s.archived||t.setupId===s.id)).map(s=>`<option value="${s.id}"${t.setupId===s.id?' selected':''}>${esc(s.name)}</option>`).join(''),eo=realErrors().filter(s=>!s.archived||t.errorId===s.id).map(s=>`<option value="${s.id}"${t.errorId===s.id?' selected':''}>${esc(s.name)}</option>`).join('');
  return `<tr class="dt"><td colspan="${COLS4.length}"><div class="dgrid">
    <div><span>Bought</span><b>${dmy(t.buyDate)} · ${fx(t.qty,0)} × $${fx(t.buy,2)}</b></div><div><span>Average sell price</span><b>$${fx(t.avgSell,2)}</b></div>
    <div><span>Initial stop</span><b>${t.init===null?'No stop':`$${fx(t.init,2)} · ${fx(t.sdPct,1)} % · ${t.sd}`}</b></div><div><span>How you bought</span><b>${t.how}</b></div>
    <div><span>Commissions</span><b>$${fx(t.comm,2)}</b></div><div><span>Capital at open</span><b>$${fx(t.capAtOpen,2)}</b></div></div>
    ${t.comment?`<p style="margin:12px 0 0;max-width:80ch">💬 ${esc(t.comment)}</p>`:''}
    <table class="dsales"><tbody>${t.sales.map(s=>`<tr><td class="note">Sale ${dmy(s.date)}</td><td>${fx(s.q,0)} × $${fx(+s.price,2)}</td><td class="${s.net>=0?'pos':'neg'}">${usd(s.net)}</td><td><button class="btn sm" data-esale="${s.id}" data-trade="${t.id}"${CTX.readOnly?' disabled':''}>Edit sale…</button></td></tr>`).join('')}</tbody></table>
    <div class="dtag"><label class="fld">Setup<select data-tag="setupId" data-id="${t.id}"${CTX.readOnly?' disabled':''}><option value="">Unclassified</option>${so}</select></label>
    <label class="fld">Mistake<select data-tag="errorId" data-id="${t.id}"${CTX.readOnly?' disabled':''}><option value="">Not filled in</option><option value="${PLAN||'__plan'}"${PLAN&&(PLAN&&t.errorId===PLAN)?' selected':''}>Followed my plan</option>${eo}</select></label>
    <button class="btn" data-symf="${t.sym}">All ${t.sym} trades</button><span class="note">Changes are saved at once</span></div></td></tr>`;
}

// ---- trades summary: six small cards, each with a hover explanation; follow the filters
function sumCards(s,ts){
  const above=s.wr!==null&&s.be!==null?s.wr>=s.be:null,tn=(v)=>v>0?'pos':v<0?'neg':'';
  const P=(ts.length===TR.length&&PREV?.trades)?PREV.trades:null,keyOf={'Trades':'n','Win rate':'wr','Average win':'winR','Average loss':'lossR','Per trade':'avgR','Net result':'net'};
  const m=(k,v,d,c,tip)=>{const pv=P?P[keyOf[k]]:undefined,ch=was(pv,String(v));return `<div class="metric${ch?' chg':''}" title="${esc((ch?'Before: '+pv+'. ':'')+tip)}"><span class="lab">${k}</span><span class="v ${c||''}">${v}</span><span class="d">${ch?`<b class="was">was ${pv}</b>`:d}</span></div>`;};
  return m('Trades',s.n,`${s.w} won · ${s.l} lost`,'',`Closed trades in this list. A trade counts when its last share is sold.`)+
    m('Win rate',pct(s.wr===null?null:s.wr*100),`you need ${pct(s.be===null?null:s.be*100)}`,above===null?'':above?'pos':'neg',s.wr===null?'':`${s.w} of ${s.w+s.l} trades made money. With these win and loss sizes you need at least ${pct(s.be*100)} to break even.`)+
    m('Average win',R(s.winR),'per winning trade','pos',s.winR===null?'No winning trades here.':`A winning trade made on average ${fx(s.winR,2)} times the money you planned to risk. ${RTIP}`)+
    m('Average loss',R(s.lossR),'per losing trade','neg',s.lossR===null?'No losing trades here.':`A losing trade lost on average ${fx(-s.lossR,2)} times the money you planned to risk. ${RTIP}`)+
    m('Per trade',R(s.avgR),'all trades together',tn(s.avgR),s.avgR===null?'':`Wins and losses together: each trade ${s.avgR>=0?'made':'lost'} on average ${fx(Math.abs(s.avgR),2)} times the money you risked. Above 0 = you make money over time.`)+
    m('Net result',usd(s.net),`${sx(s.capPct,2)} % of capital`,tn(s.net),`All these trades together, after commissions. % of capital = each trade's result divided by your capital when you bought it, added up.`);
}
function renderSummary(ts){$('sum').innerHTML=sumCards(stats(ts),ts);}
// 2026-11-10 what-if: when trades are left out, one line shows how the numbers move (with them → without them)
function renderEffect(all,ts){
  let e=$('heffect');if(!e){e=document.createElement('div');e.id='heffect';$('sum').before(e);}
  if(all===ts||all.length===ts.length){e.hidden=true;e.innerHTML='';return;}
  const a=stats(all),b=stats(ts),n=all.length-ts.length,tn=(v)=>v>0?'pos':v<0?'neg':'';
  const it=(l,x,y,f,c)=>`<span class="ef"><span class="k">${l}</span> <span class="${c?tn(x):''}">${f(x)}</span> <span class="ar">→</span> <b class="${c?tn(y):''}">${f(y)}</b></span>`;
  e.hidden=false;e.className='heffect';
  e.innerHTML=`<span class="eh">Without the ${n} trade${n>1?'s':''} you left out</span>${it('Win rate',a.wr===null?null:a.wr*100,b.wr===null?null:b.wr*100,pct,false)}${it('Per trade',a.avgR,b.avgR,R,true)}${it('Net result',a.net,b.net,usd,true)}${it('% of capital',a.capPct,b.capPct,(v)=>sx(v,2)+' %',true)}<button class="linkbtn" id="ef-undo" type="button">Count them again</button>`;
  $('ef-undo').onclick=()=>{for(const k of outKeys(F))F[k]=[];F.not=[];F.skip=[];renderAll();};
}

// ---- filters: own dates in the main row
function renderFilters(){
  const el=$('fbar');el.innerHTML='';
  const r1=document.createElement('div');r1.className='hf';
  const per=document.createElement('select');per.setAttribute('aria-label','Period');
  [['all','All trades'],['last20','Last 20 trades'],['month','This month'],['3m','Last 3 months'],['year','This year'],...(F.period==='custom'?[['custom','Own dates']]:[])].forEach(([v,l])=>{const o=new Option(l,v);o.selected=F.period===v;per.add(o);});
  per.onchange=()=>{F.period=per.value;F.from='';F.to='';renderAll();};
  const dt=(k,ph)=>{const w=datePicker({iso:F[k]||'',label:ph+' (sell date)',onChange:()=>apply()});w.classList.add('hdate');w.title='Sell date, dd-mm-yyyy — type it or pick it in the calendar';
    const apply=()=>{const v=w.getISO();if(v===null){w.classList.add('bad');return;}w.classList.remove('bad');if((v||'')===(F[k]||''))return;F[k]=v||'';F.period=(F.from||F.to)?'custom':'all';renderAll();};
    w.input.addEventListener('change',apply);return w;};
  const dates=document.createElement('span');dates.className='hdates';dates.append(dt('from','From'),document.createTextNode('–'),dt('to','To'));
  const res=document.createElement('select');res.setAttribute('aria-label','Result');[['all','Winners and losers'],['winners','Winners'],['losers','Losers']].forEach(([v,l])=>{const o=new Option(l,v);o.selected=F.result===v;res.add(o);});res.onchange=()=>{F.result=res.value;renderAll();};
  const q=document.createElement('input');q.type='search';q.placeholder='Search in comments';q.value=F.q;q.setAttribute('aria-label','Search in comments');q.oninput=()=>{F.q=q.value;renderAll(false,true);};
  r1.append(per,dates,ms('syms',F,()=>renderAll()),res,q);
  if(showMore)for(const k of ['labels','setups','mistakes','days','sds','how'])r1.append(ms(k,F,()=>renderAll()));
  const more=document.createElement('button');more.className='linkbtn';more.type='button';more.textContent=showMore?'Fewer filters':'More filters';more.onclick=()=>{showMore=!showMore;renderFilters();};
  const rs=document.createElement('button');rs.className='linkbtn';rs.type='button';rs.textContent='Reset';rs.onclick=()=>{F=newF();renderAll();};
  r1.append(more,rs);el.append(r1);
  const ch=[];
  if(F.period==='custom')ch.push([`Sold ${F.from?'from '+dmy(F.from):''} ${F.to?'to '+dmy(F.to):''}`.trim(),()=>{F.period='all';F.from='';F.to='';}]);
  else if(F.period!=='all')ch.push([PERIODS.find(p=>p[0]===F.period)[1],()=>{F.period='all';}]);
  for(const k of Object.keys(FNAME))for(const v of F[k])ch.push([`${F.not.includes(k)?'Leave out '+FNAME[k].toLowerCase():FNAME[k]}: ${OPTS[k]().find(o=>o[0]===v)?.[1]??v}`,()=>{F[k]=F[k].filter(x=>x!==v);},F.not.includes(k)]);
  if(F.skip.length)ch.push([`Left out by hand: ${F.skip.length} trade${F.skip.length>1?'s':''}`,()=>{F.skip=[];},true]);
  if(F.result!=='all')ch.push([F.result==='winners'?'Winners':'Losers',()=>{F.result='all';}]);
  if(F.q.trim())ch.push([`Comment: “${F.q.trim()}”`,()=>{F.q='';}]);
  if(F.ids)ch.push([`${capz(F.idsLabel)} (${F.ids.length})`,()=>{F.ids=null;}]);
  if(ch.length){const c=document.createElement('div');c.className='hchips';for(const [l,fn,o] of ch){const s=document.createElement('span');s.className='hchip'+(o?' out':'');s.textContent=l;const x=document.createElement('button');x.type='button';x.setAttribute('aria-label','Remove '+l);x.textContent='×';x.onclick=()=>{fn();renderAll();};s.append(x);c.append(s);}el.append(c);}
}

// ---- compare (design 5): pick a question → two group cards with the same numbers → the differences in plain sentences
let cmpKey='recent',cmpEdit=false;
const _oc=openCompare;openCompare=function(k){cmpKey=k;_oc(k);};
const _oci=openCompareIds;openCompareIds=function(...a){cmpKey='custom';_oci(...a);};
function diffs(A,B,sa,sb){
  const out=[],an=`<b>${esc(A.name)}</b>`,bn=`<b>${esc(B.name)}</b>`;
  if(!sa.n||!sb.n)return[`${!sa.n?an:bn} has no trades yet, so there is nothing to compare.`];
  const better=(x,y)=>x>y?[an,bn]:[bn,an];
  if(sa.avgR!==null&&sb.avgR!==null&&Math.abs(sa.avgR-sb.avgR)>=0.05){const [w,l]=better(sa.avgR,sb.avgR);out.push({k:Math.abs(sa.avgR-sb.avgR)*3,t:`Per trade, ${w} did better: ${R(Math.max(sa.avgR,sb.avgR))} against ${R(Math.min(sa.avgR,sb.avgR))} for ${l}.`});}
  if(sa.wr!==null&&sb.wr!==null&&Math.abs(sa.wr-sb.wr)>=0.05){const [w,l]=better(sa.wr,sb.wr);out.push({k:Math.abs(sa.wr-sb.wr)*5,t:`${w} won more often: ${pct(Math.max(sa.wr,sb.wr)*100)} of trades, against ${pct(Math.min(sa.wr,sb.wr)*100)}.`});}
  if(sa.winR&&sb.winR&&Math.abs(sa.winR/sb.winR-1)>=0.25){const [w,l]=better(sa.winR,sb.winR);out.push({k:Math.abs(sa.winR-sb.winR),t:`The wins were bigger in ${w}: ${R(Math.max(sa.winR,sb.winR))} on average, against ${R(Math.min(sa.winR,sb.winR))}.`});}
  if(sa.lossR&&sb.lossR&&Math.abs(sa.lossR/sb.lossR-1)>=0.2){const [w,l]=better(sa.lossR,sb.lossR);out.push({k:Math.abs(sa.lossR-sb.lossR),t:`The losses were smaller in ${w}: ${R(Math.max(sa.lossR,sb.lossR))} on average, against ${R(Math.min(sa.lossR,sb.lossR))}.`});}
  if(sa.days!==null&&sb.days!==null&&Math.abs(sa.days-sb.days)>=3){const [lo,sh]=sa.days>sb.days?[an,bn]:[bn,an];out.push({k:0.2,t:`${lo} were held longer: ${fx(Math.max(sa.days,sb.days),0)} days on average, against ${fx(Math.min(sa.days,sb.days),0)}.`});}
  const r=out.sort((x,y)=>y.k-x.k).slice(0,3).map(x=>x.t);if(!r.length)r.push('No clear difference between the two groups.');
  for(const [g,s] of [[A,sa],[B,sb]])if(s.n<10)r.push(`<span class="note">${esc(g.name)} has only ${s.n} trades (${sample(s.n).toLowerCase()}), so treat this as a first hint.</span>`);
  return r;
}
function renderCompare(){if(!gInit){gInit=true;[G.a,G.b]=PRESETS.recent();cmpKey='recent';}
  const v=$('cview'),ta=applyF(G.a),tb=applyF(G.b),sa=stats(ta),sb=stats(tb),both=ta.filter(t=>tb.includes(t)).length;
  const tn=(n)=>n>0?'pos':n<0?'neg':'';
  const PC=cmpKey!=='custom'&&cmpChanged(cmpKey)?PREV?.compare?.[cmpKey]:null;
  const card=(k,g,s)=>{const p=PC?PC[k]:null,n=grpSnap(k==='a'?ta:tb),w=(x)=>p&&was(p[x],n[x])?` chg" data-was="was ${esc(p[x])}`:'';return `<section class="card hcg"><div class="card-b">
     <div class="hcg-h"><span class="gl">${k.toUpperCase()}</span><div><b>${esc(g.name)}</b><span class="note">${s.n} trades · ${sample(s.n)}</span></div></div>
     <div class="hcg-big ${tn(s.net)}${w('net')}" title="All trades of this group together, after commissions.">${s.n?usd(s.net):'–'}</div>
     <div class="hcg-rows">
       <div class="${w('won')}" title="${s.n?`${s.w} of ${s.w+s.l} trades made money.`:''}"><span>Won</span><b>${s.n?`${s.w} of ${s.w+s.l}`:'–'}</b><i>${pct(s.wr===null?null:s.wr*100)}</i></div>
       <div class="${w('win')}" title="${esc(RTIP)}"><span>Average win</span><b class="pos">${R(s.winR)}</b><i></i></div>
       <div class="${w('loss')}" title="${esc(RTIP)}"><span>Average loss</span><b class="neg">${R(s.lossR)}</b><i></i></div>
       <div class="${w('per')}" title="Wins and losses together. Above 0 = this kind of trade makes money over time."><span>Per trade</span><b class="${tn(s.avgR)}">${R(s.avgR)}</b><i></i></div>
       <div class="${w('days')}"><span>Days held</span><b>${s.days===null?'–':fx(s.days,0)}</b><i>on average</i></div>
     </div>
     <button class="btn sm" data-view="${k}">Open these ${s.n} trades</button></div></section>`;};
  v.innerHTML=`
    <div class="hc-q"><span class="lab">What do you want to compare?</span><div class="hc-chips">${PNAMES.map(([k,l])=>`<button class="hcq${cmpKey===k?' on':''}" data-pre="${k}">${l}${cmpChanged(k)?' <i class="chgdot" title="Changed since you last looked"></i>':''}</button>`).join('')}<button class="hcq${cmpKey==='custom'?' on':''}" data-pre="custom">Your own groups…</button></div></div>
    ${cmpEdit||cmpKey==='custom'?`<div class="hc-g">${['a','b'].map(k=>`<section class="card"><div class="card-b"><div class="ttl"><span class="gl">${k.toUpperCase()}</span><input data-gname="${k}" value="${esc(G[k].name)}" aria-label="Name of group ${k.toUpperCase()}"></div><div class="hf" data-g="${k}"></div>${G[k].ids?`<div class="hchips" style="margin:0"><span class="hchip">${esc(capz(G[k].idsLabel))} (${G[k].ids.length})<button data-clr="${k}" aria-label="Remove">×</button></span></div>`:''}</div></section>`).join('')}</div>`:''}
    <section class="card"><div class="card-b hc-diff"><span class="lab">What is different</span><ul>${diffs(G.a,G.b,sa,sb).map(t=>`<li>${t}</li>`).join('')}</ul>${both?`<span class="note warn">${both} trade${both>1?'s are':' is'} in both groups.</span>`:''}</div></section>
    <div class="hc-cards">${card('a',G.a,sa)}<span class="hc-vs">vs</span>${card('b',G.b,sb)}</div>
    <p class="note" style="margin:0">Compare shows what is different, not why. ${cmpKey!=='custom'?`<button class="linkbtn" id="cmp-edit">${cmpEdit?'Hide the group settings':'Change these groups'}</button>`:''}</p>`;
  v.querySelectorAll('[data-pre]').forEach(b=>b.onclick=()=>{const k=b.dataset.pre;cmpKey=k;if(k==='custom'){G.a={...newF(),name:'Group A'};G.b={...newF(),name:'Group B'};}else{cmpEdit=false;[G.a,G.b]=PRESETS[k]();}renderCompare();});
  $('cmp-edit')?.addEventListener('click',()=>{cmpEdit=!cmpEdit;renderCompare();});
  v.querySelectorAll('.hf[data-g]').forEach(fl=>{const g=G[fl.dataset.g];
    const per=document.createElement('select');per.setAttribute('aria-label','Period');PERIODS.filter(p=>p[0]!=='custom').forEach(([val,l])=>{const o=new Option(l,val);o.selected=g.period===val;per.add(o);});per.onchange=()=>{g.period=per.value;cmpKey='custom';renderCompare();};fl.append(per);
    const res=document.createElement('select');res.setAttribute('aria-label','Result');[['all','Winners and losers'],['winners','Winners'],['losers','Losers']].forEach(([val,l])=>{const o=new Option(l,val);o.selected=g.result===val;res.add(o);});res.onchange=()=>{g.result=res.value;cmpKey='custom';renderCompare();};fl.append(res);
    CMPF.forEach(k=>fl.append(ms(k,g,()=>{cmpKey='custom';renderCompare();})));});
  v.querySelectorAll('[data-gname]').forEach(i=>{i.onchange=()=>{G[i.dataset.gname].name=i.value||('Group '+i.dataset.gname.toUpperCase());renderCompare();};});
  v.querySelectorAll('[data-clr]').forEach(b=>b.onclick=()=>{G[b.dataset.clr].ids=null;cmpKey='custom';renderCompare();});
  v.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{const g=G[b.dataset.view];F={...g};delete F.name;view='trades';renderAll();scrollToTable();});
}
// ================================================================ "What changed since you last looked" (2026-11-09)
// A snapshot of what you saw is kept per tab. Anything different is marked once (amber), then counts as seen.
// In the program the snapshot is saved with your journal (Drive), so it works on every computer; this preview keeps it in this browser.
function snapNow(){
  const rep={};CHECKS.forEach(fn=>{const c=fn(TR),f=factsFor(c.id);rep[c.id]={v:c.v,rv:c.recent?c.recent.v:'',f:f.f.map(x=>String(x.v)),last:f.last||''};});
  const s=stats(TR);
  const trd={n:String(s.n),wr:pct(s.wr*100),winR:R(s.winR),lossR:R(s.lossR),avgR:R(s.avgR),net:usd(s.net),ids:TR.map(t=>t.id)};
  const cmp={};for(const [k] of PNAMES){const [a,b]=PRESETS[k]();const A=applyF(a),B=applyF(b),sa=stats(A),sb=stats(B),win=(x,y)=>x===null||y===null||Math.abs(x-y)<0.05?'':x>y?'a':'b';cmp[k]={a:grpSnap(A),b:grpSnap(B),best:{per:win(sa.avgR,sb.avgR),won:win(sa.wr,sb.wr),net:win(sa.n?sa.net:null,sb.n?sb.net:null)}};}
  return {report:rep,trades:trd,compare:cmp};
}
function grpSnap(ts){const s=stats(ts);return {net:s.n?usd(s.net):'–',won:s.n?`${s.w} of ${s.w+s.l}`:'–',win:R(s.winR),loss:R(s.lossR),per:R(s.avgR),days:s.days===null?'–':fx(s.days,0)};}
let PREV=null,NOW=null,seenTabs=new Set(),lastParams=null;
function newVisit(){const h=CTX.store.state.historySeen;PREV=h?structuredClone(h):null;seenTabs=new Set();}
function markSeen(tab){if(CTX.readOnly||!NOW)return;const cur=CTX.store.state.historySeen||{};if(JSON.stringify(cur[tab])===JSON.stringify(NOW[tab]))return;
  CTX.act((d)=>{d.historySeen={...(d.historySeen||{}),[tab]:NOW[tab]};return {ok:true};},{label:'History seen',noUndo:true});}
const was=(a,b)=>a!==undefined&&a!==null&&b!==undefined&&a!==b;
// a check is marked only when its verdict changes (overall, or for the last 20 trades) — not for every small number
function repChanged(id){const p=PREV?.report?.[id],n=NOW.report[id];if(!p)return false;return p.v!==n.v||(p.rv||'')!==(n.rv||'');}
function tabChanged(tab){if(!PREV?.[tab])return false;
  if(tab==='report')return Object.keys(NOW.report).some(repChanged);
  if(tab==='trades'){const p=PREV.trades,n=NOW.trades;return ['n','wr','winR','lossR','avgR','net'].some(k=>was(p[k],n[k]));}
  return PNAMES.some(([k])=>cmpChanged(k));}
// a comparison is marked only when the better group flips (per trade, win rate or net result)
function cmpChanged(k){const p=PREV?.compare?.[k],n=NOW.compare[k];if(!p||!p.best)return false;return ['per','won','net'].some(x=>p.best[x]!==n.best[x]);}
const chgTag='<span class="chgtag" title="Changed since you last looked">Changed</span>';
// ---- render
function renderAll(keepMs,keepQ){
  const ts=applyF(F);
  renderChecks();
  for(const k of ['report','trades','compare']){const b=$('v-'+k);b.className=view===k?'on':'';b.querySelector('.chgdot')?.remove();if(tabChanged(k)&&!seenTabs.has(k)){b.insertAdjacentHTML('beforeend',' <i class="chgdot" title="Something changed here since you last looked"></i>');}if(view===k&&!seenTabs.has(k)){seenTabs.add(k);setTimeout(()=>markSeen(k),0);}b.setAttribute('aria-selected',String(view===k));$('sec-'+k).className='hview'+(view===k?' on':'');}
  $('n-trades').textContent=ts.length===TR.length?TR.length:`${ts.length} of ${TR.length}`;
  $('tabnote').textContent=view==='report'?'7 checks on all your closed trades':view==='trades'?'The numbers follow your filters':'Two groups of trades side by side';
  if(view==='trades'){const all=hasOut(F)?applyF(baseF(F)):ts;renderSummary(ts);renderEffect(all,ts);if(!keepQ)renderFilters();renderTable(all,ts);}
  else if(view==='compare')renderCompare();
}

function scrollToTable(){if(view==='report'){view='trades';renderAll();}$('trades-top')?.scrollIntoView({behavior:'smooth',block:'start'});}
function saveTag(id,field,value){
  const r=CTX.act((d)=>{let v=value||'';
    if(v.startsWith('new:')){v=resolveNew(d,field==='setupId'?'setups':'errors',v);if(!v)return {ok:false,error:'Could not add that name.'};}
    if(v==='__plan'){let it=d.errors.find((e)=>e.name===PLAN_NAME);if(!it){const x=A.addListItem(d,'errors',PLAN_NAME);if(!x.ok)return x;it=x.data;}v=it.id;}
    return A.editDaily(d,id,field,v);},{label:(field==='setupId'?'setup ':'mistake ')+id});
  if(!r.ok)toast(r.error);
}
async function exportExcel(rows){
  try{const X=await (await import('./data.js')).loadXLSX();
    const data=rows.map((t)=>({'Trade ID':t.id,Symbol:t.symRaw,'Buy date':dmy(t.buyDate),'Sell date':dmy(t.sellDate),Days:t.days,Shares:t.qty,'Buy price':t.buy,'Average sell price':+t.avgSell.toFixed(4),
      'Net result':+t.net.toFixed(2),'% of capital':t.capPct===null?'':+t.capPct.toFixed(2),R:t.R===null?'':+t.R.toFixed(2),Result:t.labelRaw,'Stop distance':t.sdRaw,Setup:setupNameRaw(t)||'',Mistake:mistakeNameRaw(t)||'','How you bought':t.how,Comment:t.comment}));
    const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.json_to_sheet(data),'Closed trades');
    download(`TradeJournal-History-${todayISO()}.xlsx`,new Blob([X.write(wb,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  }catch(e){toast(e.message);}
}
const SKELETON=`<div class="hlists">
    <div class="lbar" id="trades-top"><div class="ltabs" role="tablist">
      <button id="v-report" role="tab">Report</button><button id="v-trades" role="tab">Trades<span class="n" id="n-trades"></span></button><button id="v-compare" role="tab">Compare</button>
    </div><span class="note" id="tabnote"></span></div>
    <section class="hview" id="sec-report"><div class="hrep">
        <section class="scard"><div class="sch"><h3>7 checks</h3><span class="note">all closed trades</span></div><div id="checks"></div></section>
        <section class="card hdet"><div class="card-b" id="ckcard" aria-live="polite"></div></section></div></section>
    <section class="hview" id="sec-trades"><div class="metrics six" id="sum"></div>
      <section class="scard ltable"><div class="lhead" id="fbar"></div><div id="tview"></div></section></section>
    <section class="hview" id="sec-compare"><div id="cview" style="display:flex;flex-direction:column;gap:14px"></div></section>
  </div>`;

export function render(ctx) {
  // review fix 2026-11-09: the analysis runs again only when the data changed, not on every redraw
  CTX = ctx; const fresh = ctx.store.state !== loadedState; if (fresh) { load(ctx.store.state); loadedState = ctx.store.state; }
  ROOT = h('div'); ROOT.innerHTML = SKELETON;
  if (!TR.length) { ROOT.innerHTML = '<section class="card"><div class="card-b"><b>No closed trades yet.</b><p class="note" style="margin:6px 0 0">When you close your first trade (Open positions → Close trade), History shows your report, your trades and comparisons here.</p></div></section>'; return ROOT; }
  if (ctx.params !== lastParams) { lastParams = ctx.params; newVisit(); }
  if (gInit && cmpKey !== 'custom') [G.a, G.b] = PRESETS[cmpKey](); // ready-made groups follow new trades
  if (fresh || !NOW) NOW = snapNow();
  for (const k of ['report', 'trades', 'compare']) $('v-' + k).onclick = () => { view = k; renderAll(); };
  renderAll();
  return ROOT;
}

function editSale(ctx, tradeId, saleId) {
  const st = ctx.store.state; const t = A.tradeById(st, tradeId); const s = t.sales.find((x) => x.id === saleId); const sym = A.symbolOf(st, t);
  const date = datePicker({ iso: s.date, label: 'Sell date' }), qty = h('input', { value: D.edit(D.d(s.qty)), style: { textAlign: 'right' }, 'aria-label': 'Quantity sold' }), price = h('input', { value: D.edit(D.d(s.price)), style: { textAlign: 'right' }, 'aria-label': 'Sell price' }), comm = h('input', { value: s.commission === '' ? '' : D.edit(D.d(s.commission)), style: { textAlign: 'right' }, 'aria-label': 'Sell commission' });
  dialog({ title: `Edit sale of ${sym} · ${t.id}`, wide: true, ok: 'Save', body: h('div', { style: { display: 'grid', gap: '12px' } },
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' } }, field('Sell date', date), field('Quantity sold', qty), field('Sell price', price), field('Sell commission', comm)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => { closeTopDialog(); editTrade(ctx, t.id); } }, 'Edit buy data…'),
      h('button', { class: 'btn quiet-dng', onClick: async () => {
        const ok = await dialog({ title: `Reopen ${sym}: remove this sale?`, ok: 'Remove sale', body: para(`The ${qtyTxt(D.d(s.qty))} shares become open again and the sale moves to the Trash for 15 days. Capital and statistics change.`, '') });
        if (!ok) return; const r = ctx.act((d) => A.reopenSales(d, t.id, [s.id]), { label: 'reopen ' + sym, now: true }); if (r.ok) { closeTopDialog(); toast(`${sym} sale removed.`, 'Undo', () => ctx.store.undo()); } else toast(r.error); } }, 'Reopen (remove this sale)…'))),
    onOk: async () => {
      const iso = parseDMY(date.value); if (!iso) return 'Enter a valid sell date (dd-mm-yyyy).';
      const patch = { date: iso, qty: qty.value, price: price.value, commission: comm.value.trim() };
      const trial = structuredClone(st); const r = A.editSale(trial, t.id, s.id, patch); if (!r.ok) return r.error;
      const t2 = A.tradeById(trial, t.id); const n1 = C.tradeNet(t), n2 = C.tradeNet(t2);
      const changed = n1 !== n2 || s.date !== iso;
      if (changed) { const ok = await dialog({ title: `Change this sale of ${sym}?`, ok: 'Save changes', body: changeTable([Object.assign(['Net result of the trade so far', signed(n1), signed(n2)], { changed: true }), Object.assign(['Capital (closed trades)', money(C.capitalNow(st)), money(C.capitalNow(trial))], { changed: true })]) }); if (!ok) return false; }
      const res = ctx.act((d) => A.editSale(d, t.id, s.id, patch), { label: 'edit sale ' + sym, now: true }); return res.ok ? true : res.error;
    } });
}
