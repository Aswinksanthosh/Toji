/**
 * The phone page of the remote buttons: one laptop on screen at a time, a switch bar at the
 * bottom, a different look for each laptop, folding sections, a drop-down for games, and
 * animated background art (original drawings, drawn here as inline SVG).
 *
 * Safety: the page is served with a strict policy (scripts and styles only with a one-time
 * nonce, no outside connections). All text from a laptop is put on the page with
 * textContent, never as HTML. The only pictures allowed are blob: images made from the
 * optional background pictures the owner puts in ~/.jarvis/art (see README-remote.md).
 */

const ART_ROG = `<svg class="char" viewBox="0 0 400 560" aria-hidden="true">
<defs>
<linearGradient id="gHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6fb5"/><stop offset=".55" stop-color="#b05cff"/><stop offset="1" stop-color="#5b3bff"/></linearGradient>
<linearGradient id="gJacket" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a1860"/><stop offset="1" stop-color="#14061c"/></linearGradient>
<linearGradient id="gSkin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2f6"/><stop offset="1" stop-color="#ffd2e2"/></linearGradient>
<radialGradient id="gIris" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#ffd9f0"/><stop offset=".45" stop-color="#ff3d9a"/><stop offset="1" stop-color="#6b1fb8"/></radialGradient>
<filter id="rGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<g class="tail tail-l"><path d="M122 150 C58 200 36 330 68 430 C84 480 58 522 36 560 C112 540 144 470 132 400 C126 330 152 260 142 190 Z" fill="url(#gHair)"/></g>
<g class="tail tail-r"><path d="M278 150 C342 200 364 330 332 430 C316 480 342 522 364 560 C288 540 256 470 268 400 C274 330 248 260 258 190 Z" fill="url(#gHair)"/></g>
<path d="M108 205 C98 92 160 48 200 48 C240 48 302 92 292 205 C292 252 282 288 262 304 L138 304 C118 288 108 252 108 205 Z" fill="url(#gHair)"/>
<path d="M28 560 C40 440 100 380 200 366 C300 380 360 440 372 560 Z" fill="url(#gJacket)"/>
<path d="M146 366 L200 436 L254 366" fill="none" stroke="#ff7fc0" stroke-width="3" opacity=".75"/>
<path d="M84 470 L112 560 M316 470 L288 560" stroke="#ff7fc0" stroke-width="3" opacity=".45"/>
<path d="M175 300 L175 374 C190 394 210 394 225 374 L225 300 Z" fill="#ffcfe0"/>
<path d="M112 200 C112 125 158 98 200 98 C242 98 288 125 288 200 C288 262 250 312 200 316 C150 312 112 262 112 200 Z" fill="url(#gSkin)"/>
<path d="M104 212 C90 100 150 56 200 56 C250 56 310 100 296 212 C284 178 266 158 242 148 C232 170 214 182 200 184 C186 182 168 170 158 148 C134 158 116 178 104 212 Z" fill="url(#gHair)"/>
<path d="M200 58 C190 100 178 130 152 150" stroke="#ffc0e0" stroke-width="3" fill="none" opacity=".6"/>
<path d="M254 70 C262 110 270 130 290 160" stroke="#ffc0e0" stroke-width="3" fill="none" opacity=".45"/>
<g class="eyes">
<ellipse cx="160" cy="234" rx="19" ry="24" fill="#fff"/>
<ellipse cx="160" cy="238" rx="14" ry="19" fill="url(#gIris)"/>
<ellipse cx="160" cy="240" rx="6" ry="9" fill="#2a0a3a"/>
<circle cx="154" cy="230" r="5" fill="#fff"/><circle cx="166" cy="246" r="2.4" fill="#fff"/>
<path d="M137 224 C146 207 173 207 183 222" stroke="#2a0a3a" stroke-width="5" fill="none" stroke-linecap="round"/>
<ellipse cx="240" cy="234" rx="19" ry="24" fill="#fff"/>
<ellipse cx="240" cy="238" rx="14" ry="19" fill="url(#gIris)"/>
<ellipse cx="240" cy="240" rx="6" ry="9" fill="#2a0a3a"/>
<circle cx="234" cy="230" r="5" fill="#fff"/><circle cx="246" cy="246" r="2.4" fill="#fff"/>
<path d="M217 222 C227 207 254 207 263 224" stroke="#2a0a3a" stroke-width="5" fill="none" stroke-linecap="round"/>
</g>
<ellipse cx="138" cy="270" rx="16" ry="8" fill="#ff7fb0" opacity=".35"/><ellipse cx="262" cy="270" rx="16" ry="8" fill="#ff7fb0" opacity=".35"/>
<path d="M198 266 L202 266" stroke="#e59ab4" stroke-width="3" stroke-linecap="round"/>
<path d="M188 284 C196 294 204 294 212 284" stroke="#c4506f" stroke-width="3.5" fill="none" stroke-linecap="round"/>
<path d="M104 196 C96 66 304 66 296 196" fill="none" stroke="#2a0f3a" stroke-width="12" stroke-linecap="round"/>
<g filter="url(#rGlow)"><rect x="86" y="180" width="32" height="68" rx="14" fill="#ff4fa3"/><rect x="282" y="180" width="32" height="68" rx="14" fill="#ff4fa3"/></g>
<rect x="94" y="190" width="16" height="48" rx="8" fill="#2a0f3a"/><rect x="290" y="190" width="16" height="48" rx="8" fill="#2a0f3a"/>
<path class="spark s1" d="M336 118 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6z" fill="#fff"/>
<path class="spark s2" d="M60 250 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" fill="#ffd0ea"/>
<path class="spark s3" d="M318 330 l4 9 9 4 -9 4 -4 9 -4 -9 -9 -4 9 -4z" fill="#ffd0ea"/>
</svg>`

const ART_TUF = `<svg class="char" viewBox="0 0 400 560" aria-hidden="true">
<defs>
<linearGradient id="gSteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#555b62"/><stop offset="1" stop-color="#17191d"/></linearGradient>
<linearGradient id="gHood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34383e"/><stop offset="1" stop-color="#0d0e11"/></linearGradient>
<linearGradient id="gMask" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b7279"/><stop offset="1" stop-color="#2a2d32"/></linearGradient>
<filter id="tGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<path d="M6 560 L28 404 C60 344 140 320 200 318 C260 320 340 344 372 404 L394 560 Z" fill="url(#gSteel)"/>
<path d="M28 404 L82 348 L156 338 L136 424 Z" fill="#23262b" stroke="#ffa400" stroke-width="2.5"/>
<path d="M372 404 L318 348 L244 338 L264 424 Z" fill="#23262b" stroke="#ffa400" stroke-width="2.5"/>
<path d="M150 340 L200 478 L250 340" fill="none" stroke="#ffa400" stroke-width="3.5" opacity=".85"/>
<path d="M170 384 L200 438 L230 384 Z" fill="#14161a"/>
<path d="M120 470 L150 560 M280 470 L250 560" stroke="#ffa400" stroke-width="3" opacity=".4"/>
<path d="M200 36 C118 36 84 118 84 190 C84 252 96 292 100 338 C140 356 260 356 300 338 C304 292 316 252 316 190 C316 118 282 36 200 36 Z" fill="url(#gHood)"/>
<path d="M200 36 C250 50 290 100 296 170" fill="none" stroke="#6b7279" stroke-width="3" opacity=".5"/>
<path d="M138 162 C138 122 170 100 200 100 C230 100 262 122 262 162 C262 224 240 274 200 288 C160 274 138 224 138 162 Z" fill="#08090b"/>
<path d="M144 204 L200 220 L256 204 L246 262 L200 290 L154 262 Z" fill="url(#gMask)"/>
<path d="M168 236 L232 236 M172 252 L228 252 M180 268 L220 268" stroke="#14161a" stroke-width="4" stroke-linecap="round"/>
<g filter="url(#tGlow)">
<path class="eye" d="M148 164 L188 174 L184 188 L150 182 Z" fill="#ffa400"/>
<path class="eye" d="M252 164 L212 174 L216 188 L250 182 Z" fill="#ffa400"/>
</g>
<path d="M150 150 L192 160 M250 150 L208 160" stroke="#1a1c20" stroke-width="6" stroke-linecap="round"/>
<path d="M232 112 L206 214" stroke="#ffa400" stroke-width="2.5" opacity=".6"/>
</svg>`

const petals = Array.from({ length: 14 }, () => '<i></i>').join('')
const embers = Array.from({ length: 16 }, () => '<i></i>').join('')

export function page(nonce) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="color-scheme" content="dark">
<title>Remote</title>
<style nonce="${nonce}">
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;min-height:100%}
body{background:#05080d;color:#eaf6fa;font:16px/1.4 system-ui,"Segoe UI",sans-serif;overflow-x:hidden}
body{--a:#4fd0e6;--a2:#0c3a4c;--glass:rgba(8,18,26,.5);--line:rgba(79,208,230,.28);--r:14px;--rb:10px}
body[data-theme=rog]{--a:#ff4fa3;--a2:#4a1040;--glass:rgba(38,10,36,.36);--line:rgba(255,120,190,.38);--r:24px;--rb:999px}
body[data-theme=tuf]{--a:#ffa400;--a2:#2e2408;--glass:rgba(18,15,10,.5);--line:rgba(255,164,0,.4);--r:3px;--rb:3px}
.bg{position:fixed;inset:0;z-index:-3;opacity:0;transition:opacity .7s}
.bg.plain{background:radial-gradient(120% 80% at 80% 0,#0e2f3d 0,#06141c 50%,#03070c 100%)}
.bg.rog{background:radial-gradient(110% 70% at 85% 5%,#7a2170 0,#2d0c39 45%,#0c0414 100%)}
.bg.tuf{background:linear-gradient(165deg,#241d12 0,#0e0c09 55%,#17120a 100%)}
.bg.tuf::after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,164,0,.05) 0 2px,transparent 2px 26px)}
body[data-theme=plain] .bg.plain,body[data-theme=rog] .bg.rog,body[data-theme=tuf] .bg.tuf{opacity:1}
.art{position:fixed;right:max(-34px,calc(50vw - 330px));top:14px;width:340px;z-index:-2;opacity:0;transform:translateY(24px);transition:opacity .7s,transform .7s;pointer-events:none}
body[data-theme=rog] .art.rog,body[data-theme=tuf] .art.tuf{opacity:.82;transform:none}
.art{-webkit-mask-image:linear-gradient(#000 70%,transparent 98%);mask-image:linear-gradient(#000 70%,transparent 98%)}
.art .char{width:100%;height:auto;display:block;animation:breathe 6s ease-in-out infinite}
.art.rog .char{filter:drop-shadow(0 0 22px rgba(255,79,163,.5))}
.art.tuf .char{filter:drop-shadow(0 0 22px rgba(255,164,0,.35))}
.tail{transform-box:fill-box;transform-origin:50% 0}
.tail-l{animation:swayL 5s ease-in-out infinite}
.tail-r{animation:swayR 5.6s ease-in-out infinite}
.spark{transform-box:fill-box;transform-origin:center;animation:twinkle 2.6s ease-in-out infinite}
.spark.s2{animation-delay:-.9s}.spark.s3{animation-delay:-1.7s}
.eye{animation:flick 4.5s ease-in-out infinite}
.photo{position:fixed;inset:0;z-index:-2;background-size:cover;background-position:center top;opacity:0;transition:opacity .7s}
.photo::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.75))}
body[data-theme=rog] .photo.rog.on,body[data-theme=tuf] .photo.tuf.on{opacity:.6}
body[data-theme=rog] .photo.rog.on~.art.rog,body[data-theme=tuf] .photo.tuf.on~.art.tuf{opacity:0}
.fx{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;opacity:0;transition:opacity .7s}
body[data-theme=rog] .fx.rog,body[data-theme=tuf] .fx.tuf{opacity:1}
.fx i{position:absolute;display:block}
.fx.rog i{top:-24px;width:12px;height:16px;background:linear-gradient(135deg,#ffc2e0,#ff6fb5);border-radius:80% 0 80% 0;opacity:.8;animation:fall var(--d) linear infinite;animation-delay:var(--w);left:var(--x)}
.fx.tuf i{bottom:-10px;width:5px;height:5px;background:#ffb42e;border-radius:50%;box-shadow:0 0 8px #ffa400;animation:rise var(--d) linear infinite;animation-delay:var(--w);left:var(--x)}
.fx i:nth-child(1){--x:4%;--d:11s;--w:-2s}.fx i:nth-child(2){--x:12%;--d:9s;--w:-6s}.fx i:nth-child(3){--x:21%;--d:13s;--w:-4s}.fx i:nth-child(4){--x:29%;--d:10s;--w:-8s}
.fx i:nth-child(5){--x:37%;--d:12s;--w:-1s}.fx i:nth-child(6){--x:45%;--d:9s;--w:-5s}.fx i:nth-child(7){--x:52%;--d:14s;--w:-9s}.fx i:nth-child(8){--x:60%;--d:10s;--w:-3s}
.fx i:nth-child(9){--x:67%;--d:12s;--w:-7s}.fx i:nth-child(10){--x:74%;--d:9s;--w:-2s}.fx i:nth-child(11){--x:81%;--d:13s;--w:-10s}.fx i:nth-child(12){--x:88%;--d:11s;--w:-4s}
.fx i:nth-child(13){--x:94%;--d:10s;--w:-6s}.fx i:nth-child(14){--x:98%;--d:12s;--w:-8s}.fx i:nth-child(15){--x:17%;--d:15s;--w:-11s}.fx i:nth-child(16){--x:57%;--d:14s;--w:-12s}
@keyframes fall{0%{transform:translate(0,0) rotate(0)}100%{transform:translate(-60px,112vh) rotate(540deg)}}
@keyframes rise{0%{transform:translate(0,0);opacity:0}15%{opacity:1}100%{transform:translate(30px,-105vh);opacity:0}}
@keyframes breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes swayL{0%,100%{transform:rotate(-2.5deg)}50%{transform:rotate(3deg)}}
@keyframes swayR{0%,100%{transform:rotate(2.5deg)}50%{transform:rotate(-3deg)}}
@keyframes twinkle{0%,100%{transform:scale(.4);opacity:.3}50%{transform:scale(1.15);opacity:1}}
@keyframes flick{0%,92%,100%{opacity:1}94%{opacity:.5}96%{opacity:1}98%{opacity:.6}}
@keyframes pulse{0%,100%{box-shadow:0 0 3px 0 #38d27a}50%{box-shadow:0 0 11px 3px #38d27a}}
@keyframes inR{from{opacity:0;transform:translateX(34px)}to{opacity:1;transform:none}}
@keyframes inL{from{opacity:0;transform:translateX(-34px)}to{opacity:1;transform:none}}
@keyframes up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes ping{0%{box-shadow:0 0 0 0 var(--a)}100%{box-shadow:0 0 0 14px transparent}}
header{padding:14px 16px 4px;letter-spacing:.35em;font-size:.72rem;color:var(--a);transition:color .5s}
main{padding:8px 14px 120px;max-width:560px;margin:auto}
.panel>*{animation:up .45s ease both}
.panel>*:nth-child(2){animation-delay:.05s}.panel>*:nth-child(3){animation-delay:.1s}.panel>*:nth-child(4){animation-delay:.15s}.panel>*:nth-child(5){animation-delay:.2s}.panel>*:nth-child(6){animation-delay:.25s}.panel>*:nth-child(7){animation-delay:.3s}
.panel.fromR{animation:inR .4s ease both}.panel.fromL{animation:inL .4s ease both}
.panel{display:flex;flex-direction:column;gap:12px}
.hero{display:flex;flex-direction:column;gap:6px;padding:4px 2px;min-height:196px}
.hero .line{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hero h1{margin:0;font-size:2.1rem;line-height:1}
body[data-theme=rog] .hero h1{font-weight:300;letter-spacing:.02em;font-style:italic;background:linear-gradient(90deg,#ffd0ea,#ff4fa3 55%,#b05cff);-webkit-background-clip:text;background-clip:text;color:transparent}
body[data-theme=tuf] .hero h1{font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#ffb42e;border-left:6px solid var(--a);padding-left:10px;font-size:1.9rem}
body[data-theme=plain] .hero h1{font-weight:700}
.badge{font-size:.7rem;font-weight:800;letter-spacing:.22em;padding:3px 10px;border:1px solid var(--a);color:var(--a);border-radius:var(--rb)}
.chip{display:inline-flex;align-items:center;gap:7px;font-size:.82rem;color:#bcd0d8}
.dot{width:10px;height:10px;border-radius:50%;background:#3a4b55;display:inline-block}
.on .dot{background:#38d27a;animation:pulse 2s ease-in-out infinite}
.model{font-size:.85rem;color:#a9bcc5}
.glass{background:var(--glass);border:1px solid var(--line);border-radius:var(--r);padding:12px;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
body[data-theme=tuf] .glass{clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
.row{display:flex;gap:8px;flex-wrap:wrap}
.b{font:inherit;color:#fff;background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,0)),var(--a2);border:1px solid var(--line);border-radius:var(--rb);padding:12px 16px;cursor:pointer;transition:transform .12s,box-shadow .2s,background .2s}
body[data-theme=rog] .b{background:linear-gradient(135deg,rgba(255,79,163,.45),rgba(150,70,255,.35));border-color:rgba(255,150,205,.6);box-shadow:0 4px 14px rgba(255,79,163,.2)}
body[data-theme=tuf] .b{text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:.86rem;border-left:3px solid var(--a);clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
.b:active{transform:scale(.95)}
.b.ping{animation:ping .5s ease-out}
.b:disabled{opacity:.38;cursor:default}
.b:focus-visible,.dd-btn:focus-visible,.acc-h:focus-visible{outline:2px solid var(--a);outline-offset:2px}
.steam{position:relative;z-index:5;background:linear-gradient(180deg,rgba(27,40,56,.62),rgba(20,26,34,.62));backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border:1px solid #2a475e;border-radius:var(--r);padding:12px;display:flex;flex-direction:column;gap:10px;color:#c7d5e0}
.steam h3{margin:0;font-size:.7rem;letter-spacing:.28em;color:#66c0f4}
.sh{display:flex;gap:12px;align-items:center}
.sh .txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.avatar{flex:0 0 64px;width:64px;height:64px;border-radius:50%;background:#101822 center/cover no-repeat;border:2px solid var(--a);box-shadow:0 0 14px -2px var(--a);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.5rem;color:var(--a);overflow:hidden;transition:box-shadow .4s}
body[data-theme=rog] .avatar{box-shadow:0 0 18px 0 rgba(255,79,163,.6)}
body[data-theme=tuf] .avatar{border-radius:3px;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
.who{font-weight:700;color:#fff;font-size:1.05rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modes{display:flex;flex-direction:column;gap:10px}
.modes h3{margin:0;font-size:.7rem;letter-spacing:.28em;color:var(--a)}
.segs{display:flex;gap:6px}
.seg{flex:1;padding:12px 6px}
body[data-theme] .b.active{background:var(--a);color:#000;border-color:var(--a);box-shadow:0 0 16px -2px var(--a);font-weight:700}
.capline{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.9rem;color:#d6e8ee}
.hint{font-size:.78rem;color:#ffcf8a}
.now{color:#a4d007;font-size:.88rem}
.unk{color:#8a9aa6;font-size:.88rem}
.steam .b{background:#2a475e;border-color:#3d6c8d;color:#dfeaf2;box-shadow:none}
.steam .b.go{background:linear-gradient(#75b022,#588a1b);border-color:#8fd02a;color:#fff}
.dd{position:relative;flex:1 1 100%}
.dd-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;font:inherit;color:#dfeaf2;background:#101822;border:1px solid #3d6c8d;border-radius:var(--rb);padding:12px 16px;cursor:pointer}
body[data-theme=tuf] .dd-btn,body[data-theme=tuf] .steam .b{border-radius:3px}
.dd .chev,.acc-h .chev{width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform .3s}
.dd.open .chev,.acc.open .chev{transform:rotate(225deg) translateY(-2px)}
.dd-list{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:6;margin:0;padding:4px;list-style:none;max-height:0;overflow:hidden;opacity:0;transform:translateY(-8px) scale(.98);transform-origin:top;transition:max-height .3s ease,opacity .25s,transform .25s;background:#0d1620;border:1px solid #3d6c8d;border-radius:12px;visibility:hidden}
.dd.open .dd-list{max-height:230px;overflow:auto;opacity:1;transform:none;visibility:visible}
.dd-list li{padding:11px 14px;border-radius:8px;cursor:pointer;color:#dfeaf2}
.dd-list li:active,.dd-list li.sel{background:#2a475e}
.acc{border-top:1px solid var(--line)}
.acc-h{width:100%;display:flex;align-items:center;justify-content:space-between;background:none;border:0;color:var(--a);padding:14px 4px;font:inherit;font-size:.86rem;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;transition:color .5s}
.acc-b{display:grid;grid-template-rows:0fr;transition:grid-template-rows .35s ease}
.acc.open .acc-b{grid-template-rows:1fr}
.acc-in{overflow:hidden;min-height:0}
.acc-in .row{padding:2px 0 14px}
nav.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;gap:10px;padding:14px 14px calc(14px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.78) 38%);z-index:20}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font:inherit;color:#d8e8ee;padding:10px 8px;cursor:pointer;background:rgba(10,16,22,.82);border:1px solid rgba(255,255,255,.14);transition:transform .25s,background .25s,border-color .25s,box-shadow .3s}
.tab .nm{font-weight:700;display:flex;align-items:center;gap:7px}
.tab .sm{font-size:.7rem;letter-spacing:.2em;opacity:.8}
.tab.rog{border-radius:999px;--a:#ff4fa3}
.tab.tuf{border-radius:3px;--a:#ffa400;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);text-transform:uppercase;letter-spacing:.06em}
.tab.plain{border-radius:14px;--a:#4fd0e6}
.tab.active{transform:translateY(-4px);border-color:var(--a);background:rgba(10,16,22,.92);box-shadow:0 0 20px -2px var(--a)}
.tab.rog.active{background:linear-gradient(135deg,rgba(255,79,163,.55),rgba(150,70,255,.45))}
.tab.tuf.active{background:linear-gradient(135deg,rgba(255,164,0,.42),rgba(40,30,8,.92))}
.tab:active{transform:scale(.96)}
.msg{position:sticky;top:8px;z-index:12;min-height:0;padding:0;margin:0 0 6px;color:#baf2c8;font-size:.9rem;opacity:0;transform:translateY(-6px);transition:opacity .3s,transform .3s}
.msg.show{opacity:1;transform:none;padding:9px 12px;background:rgba(5,12,10,.82);border:1px solid rgba(120,230,160,.4);border-radius:12px}
.msg.err{color:#ffc1b6;border-color:rgba(255,140,120,.5);background:rgba(20,6,4,.85)}
#login{margin:22vh auto 0;width:min(360px,88vw);display:flex;flex-direction:column;gap:12px;animation:up .5s ease both}
#login input{font:inherit;color:#fff;background:rgba(8,18,26,.8);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
#lerr{color:#ffc1b6}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
</style></head><body data-theme="plain">
<div class="bg plain"></div><div class="bg rog"></div><div class="bg tuf"></div>
<div class="photo rog" id="photo-rog"></div><div class="photo tuf" id="photo-tuf"></div>
<div class="art rog">${ART_ROG}</div><div class="art tuf">${ART_TUF}</div>
<div class="fx rog">${petals}</div><div class="fx tuf">${embers}</div>
<header>REMOTE</header>
<form id="login" autocomplete="off"><label for="pw">Password</label>
<input id="pw" type="password" autocomplete="current-password" required><button class="b">Unlock</button><div id="lerr"></div></form>
<main id="app" hidden><div id="msg" class="msg"></div><div id="panel" class="panel"></div></main>
<nav class="tabs" id="tabs" hidden></nav>
<script nonce="${nonce}">
const $=id=>document.getElementById(id)
let token='',timer=0,data=null,active='',lastSig='',msgTimer=0,dir=''
const opened=new Set(),picked={},seen={}
try{token=sessionStorage.getItem('t')||'';active=sessionStorage.getItem('dev')||''}catch(e){}
async function api(path,body){
  const h={'content-type':'application/json'};if(token)h.authorization='Bearer '+token
  const r=await fetch(path,{method:'POST',headers:h,body:JSON.stringify(body||{})})
  const j=await r.json().catch(()=>({}))
  if(!r.ok){const e=new Error(j.error||'Something went wrong');e.status=r.status;throw e}
  return j
}
function say(t,bad){
  const m=$('msg');m.textContent=t;m.className='msg show'+(bad?' err':'')
  clearTimeout(msgTimer);msgTimer=setTimeout(()=>{m.className='msg'+(bad?' err':'')},bad?6000:3500)
}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
async function act(device,action,arg){
  say('Sending…')
  try{const j=await api('/api/do',{device,action,arg});say(j.message||'Done.')}
  catch(err){if(err.status===401){token='';show()}say(err.message,true)}
  setTimeout(refresh,4000)
}
function btn(label,fn,disabled,sure,cls){
  const b=el('button','b'+(cls?' '+cls:''),label);b.disabled=!!disabled
  b.addEventListener('click',()=>{if(sure&&!confirm(sure))return;b.classList.remove('ping');void b.offsetWidth;b.classList.add('ping');fn()})
  return b
}
function acc(key,title,kids){
  const d=el('div','acc'+(opened.has(key)?' open':''))
  const h=el('button','acc-h');h.append(el('span','',title),el('span','chev'));h.setAttribute('aria-expanded',opened.has(key)?'true':'false')
  const b=el('div','acc-b'),inner=el('div','acc-in'),r=el('div','row');r.append(...kids);inner.append(r);b.append(inner)
  h.addEventListener('click',()=>{const o=d.classList.toggle('open');h.setAttribute('aria-expanded',o?'true':'false');if(o)opened.add(key);else opened.delete(key)})
  d.append(h,b);return d
}
function dropdown(options,value,onPick,disabled){
  const dd=el('div','dd'),b=el('button','dd-btn');b.disabled=!!disabled
  const label=el('span','',value||'No games yet');b.append(label,el('span','chev'))
  const ul=el('ul','dd-list');ul.setAttribute('role','listbox')
  for(const o of options){
    const li=el('li',o===value?'sel':'',o);li.setAttribute('role','option')
    li.addEventListener('click',e=>{e.stopPropagation();label.textContent=o;for(const x of ul.children)x.classList.remove('sel');li.classList.add('sel');dd.classList.remove('open');onPick(o)})
    ul.append(li)
  }
  b.addEventListener('click',e=>{e.stopPropagation();const o=!dd.classList.contains('open');for(const x of document.querySelectorAll('.dd.open'))x.classList.remove('open');if(o)dd.classList.add('open')})
  dd.append(b,ul);return dd
}
document.addEventListener('click',()=>{for(const x of document.querySelectorAll('.dd.open'))x.classList.remove('open')})
const avatars={}
function avatarKey(d){return d.name+'|'+((d.steam&&d.steam.user)||'')}
function paintAvatar(av,url){av.style.backgroundImage='url("'+url+'")';av.textContent=''}
async function ensureAvatar(d,av){
  const k=avatarKey(d)
  if(avatars[k]){paintAvatar(av,avatars[k]);return}
  if(avatars[k]!==undefined||!(d.steam&&d.steam.avatar))return
  avatars[k]=''
  try{
    const r=await fetch('/api/avatar',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({device:d.name})})
    if(r.status===200){avatars[k]=URL.createObjectURL(await r.blob());for(const a of document.querySelectorAll('.avatar'))if(a.dataset.key===k)paintAvatar(a,avatars[k])}
  }catch(e){delete avatars[k]}
}
function themeOf(d){
  if(d.theme==='rog'||d.theme==='tuf')return d.theme
  const m=d.model||''
  return /ROG/i.test(m)?'rog':/TUF/i.test(m)?'tuf':'plain'
}
function drawTabs(devs){
  const nav=$('tabs');nav.textContent='';nav.hidden=false
  for(const d of devs){
    const th=themeOf(d)
    const t=el('button','tab '+th+(d.name===active?' active':''));
    const nm=el('span','nm');nm.append(el('span','dot'),el('span','',d.name));if(d.awake)t.classList.add('on')
    t.append(nm)
    if(th!=='plain')t.append(el('span','sm',th.toUpperCase()))
    t.addEventListener('click',()=>switchTo(d.name))
    nav.append(t)
  }
}
function drawPanel(d,anim){
  const n=d.name,c=!d.canControl,th=themeOf(d)
  const go=(label,action,arg,sure,cls)=>btn(label,()=>act(n,action,arg),c,sure,cls)
  const p=$('panel');p.textContent='';p.className='panel'+(anim==='R'?' fromR':anim==='L'?' fromL':'')
  const hero=el('div','hero'+(d.awake?' on':''))
  const line=el('div','line');line.append(el('h1','',n))
  if(th!=='plain')line.append(el('span','badge',th.toUpperCase()))
  const st=el('span','chip');st.append(el('span','dot'),el('span','',d.awake?'awake':(d.canControl?'asleep or off':'no agent')));line.append(st)
  hero.append(line)
  if(d.model)hero.append(el('div','model',d.model))
  const quick=el('div','glass row');quick.append(btn('Wake',()=>act(n,'wake'),!d.canWake),go('Lock','lock',undefined,'Lock '+n+'?'),go('Screen off','screen_off'))
  const modes=el('div','glass modes');modes.append(el('h3','','MODE'))
  const segs=el('div','segs')
  for(const [k,label] of [['saver','Power saving'],['balanced','Balanced'],['gaming','Gaming']])segs.append(go(label,'mode_'+k,undefined,undefined,'seg'+(d.mode===k?' active':'')))
  const cap=d.cap||{on:false,target:70},capline=el('div','capline')
  capline.append(el('span','','GPU temperature cap '+cap.target+' °C'),go(cap.on?'On':'Off',cap.on?'cap_off':'cap_on',undefined,undefined,cap.on?'active':''))
  modes.append(segs,capline)
  if(d.awake&&d.governor===false)modes.append(el('div','hint','The cap needs Setup-Governor.cmd, run once as administrator (see README-remote).'))
  const steam=el('div','steam');steam.append(el('h3','','STEAM'))
  const head=el('div','sh'),txt=el('div','txt')
  if(d.steam&&d.steam.user){
    const av=el('div','avatar',d.steam.user.charAt(0).toUpperCase());av.dataset.key=avatarKey(d);head.append(av);ensureAvatar(d,av)
    txt.append(el('div','who',d.steam.user),el('div','unk','Steam profile'))
  }else txt.append(el('div','unk',d.awake?'No Steam user found':'Laptop not answering'))
  if(d.steam&&d.steam.playing)txt.append(el('div','now','Now playing: '+d.steam.playing))
  head.append(txt);steam.append(head)
  const games=d.games||data.games||[]
  if(!games.includes(picked[n]))picked[n]=games[0]||''
  const s1=el('div','row');s1.append(go('Steam','steam_open'),go('Big Picture','steam_bigpicture'),go('Show game','game_focus'))
  const s2=el('div','row');s2.append(dropdown(games,picked[n],v=>{picked[n]=v},c||!games.length),btn('Start game',()=>act(n,'steam_game',picked[n]),c||!games.length,undefined,'go'),go('Close game','close_game',undefined,'Close the running game on '+n+'?'))
  steam.append(s1,s2)
  const coding=[go('Start Ollama','ollama_start'),go('Stop Ollama','ollama_stop','','Stop Ollama on '+n+'?'),go('Start Jarvis','jarvis_start'),go('Update Jarvis','git_pull')]
  for(const b of d.buttons||[])coding.push(go(b,'button',b,'Run "'+b+'" on '+n+'?'))
  const more=el('div','glass')
  more.append(
    acc(n+'|media','Media',[go('Prev','media_prev'),go('Play / pause','media_playpause'),go('Next','media_next'),go('Vol -','volume_down'),go('Mute','mute'),go('Vol +','volume_up')]),
    acc(n+'|apps','Apps',[go('Discord','app','discord'),go('Spotify','app','spotify'),go('Epic','app','epic')]),
    acc(n+'|code','Coding',coding),
    acc(n+'|sys','System',[go('Status','status'),go('Game mode','game_mode',undefined,'Stop Jarvis and unload the local models on '+n+'?'),go('Restart','restart',undefined,'Restart '+n+'? It comes back by itself in about a minute.'),go('Sleep','sleep',undefined,'Sleep makes '+n+' unreachable from this phone until you press its power button. Sleep anyway?')]))
  p.append(hero,quick,modes,steam,more)
}
function render(anim){
  const devs=data.devices
  if(!devs.length){$('panel').textContent='No laptops are listed yet.';return}
  if(!devs.some(d=>d.name===active))active=devs[0].name
  const d=devs.find(x=>x.name===active)
  document.body.dataset.theme=themeOf(d)
  drawTabs(devs);drawPanel(d,anim)
}
function switchTo(name){
  if(!data||name===active)return
  const names=data.devices.map(d=>d.name)
  const a=names.indexOf(active),b=names.indexOf(name)
  active=name;try{sessionStorage.setItem('dev',active)}catch(e){}
  lastSig=''
  render(b>a?'R':'L')
  window.scrollTo({top:0})
}
function step(by){
  if(!data)return
  const names=data.devices.map(d=>d.name),i=names.indexOf(active)+by
  if(i>=0&&i<names.length)switchTo(names[i])
}
let sx=0,sy=0
document.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true})
document.addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.6)step(dx<0?1:-1)
},{passive:true})
async function refresh(){
  if(!token)return
  try{
    const next=await api('/api/devices')
    for(const d of next.devices){if(d.model)seen[d.name]=d.model;else if(seen[d.name])d.model=seen[d.name]}
    data=next
    const sig=JSON.stringify(next)+'|'+active
    if(sig===lastSig||document.querySelector('.dd.open'))return
    lastSig=sig;render('')
  }catch(err){if(err.status===401){token='';show()}}
}
async function loadArt(){
  for(const th of ['rog','tuf']){
    try{
      const r=await fetch('/api/art',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({theme:th})})
      if(r.status!==200)continue
      const url=URL.createObjectURL(await r.blob());const p=$('photo-'+th)
      p.style.backgroundImage='url("'+url+'")';p.classList.add('on')
    }catch(e){}
  }
}
function show(){
  $('login').hidden=!!token;$('app').hidden=!token;$('tabs').hidden=!token;clearInterval(timer)
  if(!token){document.body.dataset.theme='plain';return}
  refresh();loadArt();timer=setInterval(refresh,10000)
}
$('login').addEventListener('submit',async e=>{
  e.preventDefault();$('lerr').textContent=''
  try{const j=await api('/login',{password:$('pw').value});token=j.token;try{sessionStorage.setItem('t',token)}catch(x){};$('pw').value='';show()}
  catch(err){$('lerr').textContent=err.message}
})
show()
</script></body></html>`
}
