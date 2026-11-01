"""Run every root test script and backend suite, preserving failures and skips."""
import concurrent.futures, json, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parents[1]
label=sys.argv[1]
files=sorted(list(root.glob('test-*.js'))+list(root.glob('test-*.mjs')))
commands=[(p.name,['node',str(p)]) for p in files]+[('backend',['npm','test','--prefix','backend'])]
def run(item):
    name,cmd=item
    try:
        p=subprocess.run(cmd,cwd=root,capture_output=True,text=True,timeout=90)
        return {'name':name,'exit':p.returncode,'output':p.stdout+p.stderr}
    except subprocess.TimeoutExpired as e:
        return {'name':name,'exit':'timeout','output':str(e.stdout)+str(e.stderr)}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: results=list(pool.map(run,commands))
folder=root/'test-results';folder.mkdir(exist_ok=True)
(folder/(label+'.json')).write_text(json.dumps(results,indent=2))
print(json.dumps({'scripts':len(results),'passed':sum(r['exit']==0 for r in results),'failed':[r['name'] for r in results if r['exit']!=0]},indent=2))

sys.exit(1 if any(r['exit'] != 0 for r in results) else 0)
