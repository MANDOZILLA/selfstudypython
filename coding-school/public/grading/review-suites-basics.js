export const REVIEW_BASICS_SUITES = {
  "py-values-retrieval-v1": String.raw`import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key, cases in {'sample':(('Muffin',2,'Muffin x 2'),('Juice',1,'Juice x 1')),'edge':(('Tea',0,'Tea x 0'),),'shape':(('Soup',12,'Soup x 12'),),'behavior':(('Pie',3,'Pie x 3'),)}.items():
        try: ok=all(solve(a,b)==want for a,b,want in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Return the complete item label.')
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-conditionals-retrieval-v1": String.raw`import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':((12,'short'),(25,'medium')),'edge':((20,'medium'),(40,'tall')),'shape':((0,'short'),),'behavior':((41,'tall'),(19,'short'))}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Use the stated height ranges.')
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-loops-retrieval-v1": String.raw`import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':(([2,5,7],2),([4,6,8],2)),'edge':(([],0),),'shape':(([5],1),),'behavior':(([1,4,5,9],2),)}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Count every score that is at least five.')
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-lists-strings-retrieval-v1": String.raw`import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':(([" Pine ","LAKE"],["pine","lake"]),),'edge':(([],[]),),'shape':(([" Oak "],["oak"]),),'behavior':((["Fir"," fir ","MAPLE"],["fir","fir","maple"]),)}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Trim and lowercase every name in order.')
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-dicts-retrieval-v1": String.raw`import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':((["red","blue","red"],{"red":2,"blue":1}),),'edge':(([],{}),),'shape':((["green"],{"green":1}),),'behavior':((["A","a","A"],{"A":2,"a":1}),)}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Count each exact color spelling.')
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-classes-retrieval-v1": String.raw`import ast,json,traceback
def grade(source):
    ids=('class','method','state','solve'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try:
        tree=ast.parse(source); cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Book'); methods={n.name for n in cls.body if isinstance(n,ast.FunctionDef)}
        ns={}; exec(compile(tree,'main.py','exec'),ns); Book=ns['Book']; solve=ns.get('solve'); assert callable(solve); book=Book('River')
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    out['class'].update(passed=True,detail='')
    out['method'].update(passed='borrow' in methods and book.borrow() is None and book.borrowed is True,detail='')
    try: fresh=Book('River'); ok=fresh.title=='River' and fresh.borrowed is False
    except BaseException: ok=False
    out['state'].update(passed=ok,detail='' if ok else 'A new book starts available.')
    try: ok=solve('River',True)=={'title':'River','borrowed':True} and solve('Atlas',False)=={'title':'Atlas','borrowed':False}
    except BaseException: ok=False
    out['solve'].update(passed=ok,detail='' if ok else 'Return the state of the created Book.')
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
};

export const REVIEW_BASICS_CATALOG = Object.freeze({
  "py-values-retrieval-v1": Object.freeze({ exerciseId: "py-values-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior"] }),
  "py-conditionals-retrieval-v1": Object.freeze({ exerciseId: "py-conditionals-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior"] }),
  "py-loops-retrieval-v1": Object.freeze({ exerciseId: "py-loops-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior"] }),
  "py-lists-strings-retrieval-v1": Object.freeze({ exerciseId: "py-lists-strings-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior"] }),
  "py-dicts-retrieval-v1": Object.freeze({ exerciseId: "py-dicts-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior"] }),
  "py-classes-retrieval-v1": Object.freeze({ exerciseId: "py-classes-retrieval", version: "1.0.0", requiredTests: ["class", "method", "state", "solve"] }),
});
