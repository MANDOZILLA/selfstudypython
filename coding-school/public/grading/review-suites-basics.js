export const REVIEW_BASICS_SUITES = {
  "py-values-retrieval-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key, cases in {'sample':(('Muffin',2,'Muffin x 2'),('Juice',1,'Juice x 1')),'edge':(('Tea',0,'Tea x 0'),('Bread',-2,'Bread x -2')),'shape':(('Soup',12,'Soup x 12'),('Toast',8,'Toast x 8')),'behavior':(('Pie',3,'Pie x 3'),('Rice',7,'Rice x 7'))}.items():
        try: ok=all(solve(a,b)==want for a,b,want in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Return the complete item label.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for args, expected in [[['Oat', 1], 'Oat x 1'], [['Fig', -3], 'Fig x -3'], [['Kale', 1000], 'Kale x 1000'], [['Mint tea', 4], 'Mint tea x 4']]:
        try:
            before = copy.deepcopy(args)
            actual = solve(*args)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(*' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif args != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(args))
        except BaseException: more_errors.append('solve(*' + repr(args) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-conditionals-retrieval-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':((12,'short'),(25,'medium')),'edge':((20,'medium'),(40,'tall'),(19,'short'),(39,'medium')),'shape':((0,'short'),(55,'tall')),'behavior':((41,'tall'),(19,'short'),(21,'medium'))}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Use the stated height ranges.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for args, expected in [[[-1], 'short'], [[1], 'short'], [[38], 'medium'], [[1000], 'tall'], [[19.5], 'short']]:
        try:
            before = copy.deepcopy(args)
            actual = solve(*args)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(*' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif args != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(args))
        except BaseException: more_errors.append('solve(*' + repr(args) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-loops-retrieval-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':(([2,5,7],2),([4,6,8],2)),'edge':(([],0),([4],0),([5],1)),'shape':(([5],1),([4,5,9,0],2)),'behavior':(([1,4,5,9],2),([10,2,5,5],3))}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Count every score that is at least five.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for args, expected in [[[[5, 5, 5]], 3], [[[0, 1, 2, 3, 4]], 0], [[[100]], 1], [[[-5, 6]], 1], [[[4.9, 5.0]], 1]]:
        try:
            before = copy.deepcopy(args)
            actual = solve(*args)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(*' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif args != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(args))
        except BaseException: more_errors.append('solve(*' + repr(args) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-lists-strings-retrieval-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':(([" Pine ","LAKE"],["pine","lake"]),),'edge':(([],[]),),'shape':(([" Oak "],["oak"]),(["  Cedar  ","Birch"],["cedar","birch"])),'behavior':((["Fir"," fir ","MAPLE"],["fir","fir","maple"]),(["PINE\t",""][0:],["pine",""]))}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Trim and lowercase every name in order.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for args, expected in [[[[]], []], [[['\tAda\n']], ['ada']], [[['MiXeD Case']], ['mixed case']], [[['a', 'A', ' a ']], ['a', 'a', 'a']]]:
        try:
            before = copy.deepcopy(args)
            actual = solve(*args)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(*' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif args != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(args))
        except BaseException: more_errors.append('solve(*' + repr(args) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-dicts-retrieval-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','edge','shape','behavior', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    for key,cases in {'sample':((["red","blue","red"],{"red":2,"blue":1}),),'edge':(([],{}),),'shape':((["green"],{"green":1}),),'behavior':((["A","a","A"],{"A":2,"a":1}),)}.items():
        try: ok=all(solve(x)==y for x,y in cases)
        except BaseException: ok=False
        out[key].update(passed=ok,detail='' if ok else 'Count each exact color spelling.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for args, expected in [[[[]], {}], [[['x']], {'x': 1}], [[['A', 'a', 'A']], {'A': 2, 'a': 1}], [[['b', 'b', 'b', 'c']], {'b': 3, 'c': 1}]]:
        try:
            before = copy.deepcopy(args)
            actual = solve(*args)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(*' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif args != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(args))
        except BaseException: more_errors.append('solve(*' + repr(args) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "py-classes-retrieval-v1": String.raw`import copy
import ast,json,traceback
def grade(source):
    ids=('class','method','state','solve', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try:
        tree=ast.parse(source); cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Book'); methods={n.name for n in cls.body if isinstance(n,ast.FunctionDef)}
        ns={}; exec(compile(tree,'main.py','exec'),ns); Book=ns['Book']; solve=ns.get('solve'); assert callable(solve); book=Book('River')
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    out['class'].update(passed=True,detail='')
    out['method'].update(passed='borrow' in methods and book.borrow() is None and book.borrowed is True,detail='')
    try: fresh=Book('River'); ok=fresh.title=='River' and fresh.borrowed is False
    except BaseException: ok=False
    out['state'].update(passed=ok,detail='' if ok else 'A new book starts available.')
    try: ok=all(solve(title,borrow)=={'title':title,'borrowed':borrow} for title,borrow in [('River',True),('Atlas',False),('Map',True),('Novel',False)])
    except BaseException: ok=False
    out['solve'].update(passed=ok,detail='' if ok else 'Return the state of the created Book.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for args, expected in [[['River', True], {'title': 'River', 'borrowed': True}], [['Atlas', False], {'title': 'Atlas', 'borrowed': False}], [['', True], {'title': '', 'borrowed': True}], [['Long Title Here', False], {'title': 'Long Title Here', 'borrowed': False}]]:
        try:
            before = copy.deepcopy(args)
            actual = solve(*args)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(*' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif args != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(args))
        except BaseException: more_errors.append('solve(*' + repr(args) + ') raised ' + traceback.format_exc(limit=1))
    try:
        BookClass = ns['Book']; first = BookClass('A'); second = BookClass('B'); first.borrow()
        if first.borrowed is not True or second.borrowed is not False: more_errors.append('Each Book must keep its own borrowed state: borrowing one book changed another (or did not update it).')
    except BaseException: more_errors.append(traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
};

export const REVIEW_BASICS_CATALOG = Object.freeze({
  "py-values-retrieval-v1": Object.freeze({ exerciseId: "py-values-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior","more"] }),
  "py-conditionals-retrieval-v1": Object.freeze({ exerciseId: "py-conditionals-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior","more"] }),
  "py-loops-retrieval-v1": Object.freeze({ exerciseId: "py-loops-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior","more"] }),
  "py-lists-strings-retrieval-v1": Object.freeze({ exerciseId: "py-lists-strings-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior","more"] }),
  "py-dicts-retrieval-v1": Object.freeze({ exerciseId: "py-dicts-retrieval", version: "1.0.0", requiredTests: ["sample", "edge", "shape", "behavior","more"] }),
  "py-classes-retrieval-v1": Object.freeze({ exerciseId: "py-classes-retrieval", version: "1.0.0", requiredTests: ["class", "method", "state", "solve","more"] }),
});
