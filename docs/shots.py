import json, subprocess, urllib.request
from playwright.sync_api import sync_playwright
B="http://127.0.0.1:3111"
def psql(q): return subprocess.check_output(["psql","-h","127.0.0.1","-p","5433","-U","postgres","-d","ft","-Atc",q]).decode().strip()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    ctx=b.new_context(viewport={"width":390,"height":844},device_scale_factor=2,has_touch=True,is_mobile=True)
    pg=ctx.new_page()
    errs=[]
    pg.on("console",lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.on("pageerror",lambda e: errs.append(str(e)))
    pg.goto(B+"/t/pizza/nominate"); pg.wait_for_timeout(1500); pg.screenshot(path="/home/claude/e2e/1-nominate.png")
    pg.goto(B+"/t/pizza"); pg.wait_for_timeout(1500); pg.screenshot(path="/home/claude/e2e/0-home-nom.png")
    # start bracket through admin UI API
    tid=psql("select id from tournaments where slug='pizza'")
    rq=urllib.request.Request(B+"/api/admin/login",data=json.dumps({"password":"testpass"}).encode(),headers={"content-type":"application/json"})
    ck=urllib.request.urlopen(rq).headers["Set-Cookie"].split(";")[0]
    rq=urllib.request.Request(B+"/api/admin/tournaments/start",data=json.dumps({"id":tid}).encode(),headers={"content-type":"application/json","cookie":ck})
    print("start",urllib.request.urlopen(rq).status)
    ctx.add_cookies([{"name":"adm","value":ck.split("=",1)[1],"url":B}])
    psql("update matchups set votes_a = (random()*200)::int, votes_b=(random()*200)::int where round_id in (select id from rounds where number=1)")
    pg.goto(B+"/t/pizza"); pg.wait_for_timeout(1500); pg.screenshot(path="/home/claude/e2e/2-home-bracket.png")
    pg.goto(B+"/t/pizza/vote"); pg.wait_for_timeout(1500); pg.screenshot(path="/home/claude/e2e/3-vote.png")
    btns=pg.locator("main button"); print("buttons", btns.count(), [btns.nth(i).get_attribute("aria-label") for i in range(min(btns.count(),4))])
    # swipe right with touch-like pointer drag
    box=pg.locator("main").bounding_box()
    pg.mouse.move(195,400); pg.mouse.down(); pg.mouse.move(250,402,steps=5); pg.mouse.move(330,405,steps=5); pg.wait_for_timeout(100); pg.screenshot(path="/home/claude/e2e/4-vote-drag.png"); pg.mouse.up()
    pg.wait_for_timeout(700); pg.screenshot(path="/home/claude/e2e/5-after-vote.png")
    pg.wait_for_timeout(2500); pg.screenshot(path="/home/claude/e2e/6-follow.png")
    print("votes in db", psql("select count(*), min(choice) from votes"))
    pg.goto(B+"/t/pizza/bracket"); pg.wait_for_timeout(1500); pg.screenshot(path="/home/claude/e2e/7-bracket.png")
    pg.goto(B+"/admin"); pg.wait_for_timeout(1200); pg.screenshot(path="/home/claude/e2e/8-admin.png")
    d=b.new_context(viewport={"width":1440,"height":900}).new_page(); d.goto(B+"/t/pizza/bracket"); d.wait_for_timeout(1500); d.screenshot(path="/home/claude/e2e/9-bracket-desktop.png")
    print("console errors:", errs[:10])
    b.close()
