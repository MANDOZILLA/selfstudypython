export const BASICS_2_SUITES = {
  "functions-first-guided-v1": String.raw`import copy
import ast, json, traceback
def grade(source):
    ids = ('helper', 'sample', 'empty', 'default', 'invalid', 'more')
    out = {i: {'id': i, 'name': i, 'required': True, 'passed': False, 'detail': 'Submission unavailable.'} for i in ids}
    try:
        tree = ast.parse(source)
        helpers = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name not in ('solve',)}
        calls = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        ns = {}; exec(compile(tree, 'main.py', 'exec'), ns); solve = ns.get('solve')
        if not callable(solve): raise ValueError('Define solve(numbers).')
    except BaseException:
        return {'executionOk': False, 'tests': list(out.values()), 'error': traceback.format_exc()}
    out['helper'].update(passed=bool(helpers & calls), detail='solve must call a helper you define.')
    cases = {'sample': (([1,2,3,4,5], 2), ([0,-2,8], 3)), 'empty': (([], 0), (None, 0)), 'default': (([2,4,6], 3),), 'invalid': (("no", 0),)}
    for key, pairs in cases.items():
        try: ok = all(solve(arg) == expected for arg, expected in pairs)
        except BaseException as e: ok = False
        out[key].update(passed=ok, detail='' if ok else 'Check the helper, return value, and default argument.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for arg, expected in [[[7], 0], [[1, 3], 0], [[10, 11, 12, 13], 2], [[-4, -3], 1], [[0], 1]]:
        try:
            before = copy.deepcopy(arg)
            actual = solve(arg)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif arg != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(arg))
        except BaseException: more_errors.append('solve(' + repr(arg) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk': True, 'tests': list(out.values()), 'error': ''}
json.dumps(grade(submission_source))`,
  "functions-first-project-v1": String.raw`import copy
import ast, json, traceback
def grade(source):
    ids = ('helper', 'sample', 'empty', 'invalid', 'shape', 'more')
    out = {i: {'id': i, 'name': i, 'required': True, 'passed': False, 'detail': 'Submission unavailable.'} for i in ids}
    try:
        tree = ast.parse(source); helpers = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name != 'solve'}
        calls = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
        ns = {}; exec(compile(tree, 'main.py', 'exec'), ns); solve = ns.get('solve')
        if not callable(solve): raise ValueError('Define solve(scores).')
    except BaseException: return {'executionOk': False, 'tests': list(out.values()), 'error': traceback.format_exc()}
    out['helper'].update(passed=bool(helpers & calls), detail='solve must use a helper you define.')
    for key, pairs in {'sample': (([80,90,100], {'average':90.0,'letter':'A'}), ([60,70], {'average':65.0,'letter':'D'})), 'empty': (([], {'average':0.0,'letter':'N/A'}), (None, {'average':0.0,'letter':'N/A'})), 'invalid': ((["bad", 80], {'average':0.0,'letter':'N/A'}),), 'shape': (([100], {'average':100.0,'letter':'A'}),)}.items():
        try: ok = all(solve(x) == y for x,y in pairs)
        except BaseException: ok = False
        out[key].update(passed=ok, detail='' if ok else 'Return the documented summary for every input.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for arg, expected in [[[59], {'average': 59.0, 'letter': 'F'}], [[60], {'average': 60.0, 'letter': 'D'}], [[89.5, 90.5], {'average': 90.0, 'letter': 'A'}], [[70, 80], {'average': 75.0, 'letter': 'C'}], [[100, 0], {'average': 50.0, 'letter': 'F'}]]:
        try:
            before = copy.deepcopy(arg)
            actual = solve(arg)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif arg != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(arg))
        except BaseException: more_errors.append('solve(' + repr(arg) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk': True, 'tests': list(out.values()), 'error': ''}
json.dumps(grade(submission_source))`,
  "dictionaries-guided-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','empty','punctuation','case','shape', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try:
        ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve')
        if not callable(solve): raise ValueError('Define solve(text).')
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    cases={'sample':(('red blue red',{'red':2,'blue':1}),),'empty':(('',{}),(None,{})), 'punctuation':(('Hi, hi! go.',{'hi':2,'go':1}),), 'case':(('A a B',{'a':2,'b':1}),), 'shape':(('one two one',{'one':2,'two':1}),)}
    for k, rows in cases.items():
        try:
            ok=True
            for x,y in rows: ok = ok and solve(x)==y
        except BaseException: ok=False
        out[k].update(passed=ok,detail='' if ok else 'Count lowercase words and ignore punctuation.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for arg, expected in [['Go go GO', {'go': 3}], ['end. end, END!', {'end': 3}], ['  spaced   out ', {'spaced': 1, 'out': 1}], ['tab\tsep tab', {'tab': 2, 'sep': 1}], ['a-b a-b', {'a-b': 2}]]:
        try:
            before = copy.deepcopy(arg)
            actual = solve(arg)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif arg != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(arg))
        except BaseException: more_errors.append('solve(' + repr(arg) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "dictionaries-project-v1": String.raw`import copy
import json, traceback
def grade(source):
    ids=('sample','empty','invalid','keys','shape', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try: ns={}; exec(compile(source,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    cases={'sample':(([('apple',2),('pear',1),('apple',3)],{'apple':5,'pear':1}),),'empty':(([],{}),(None,{})), 'invalid':(([('pear',-1),('bad','x')],{}),), 'keys':(([('x',2)],{'x':2}),), 'shape':(([('b',2),('a',1)],{'a':1,'b':2}),)}
    for k,rows in cases.items():
        try: ok=all(solve(x)==y for x,y in rows)
        except BaseException: ok=False
        out[k].update(passed=ok,detail='' if ok else 'Return totals by item, skipping invalid rows.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for arg, expected in [[[('a', 0)], {'a': 0}], [[('a', 1), ('b', 2), ('a', 3)], {'a': 4, 'b': 2}], [[('  ', 4), ('ok', 1)], {'ok': 1}], [[('x', 1.5), ('y', 2)], {'y': 2}], [[('z', 2), 'bad', ('z', 1, 2)], {'z': 2}]]:
        try:
            before = copy.deepcopy(arg)
            actual = solve(arg)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif arg != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(arg))
        except BaseException: more_errors.append('solve(' + repr(arg) + ') raised ' + traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "classes-objects-guided-v1": String.raw`import copy
import ast,json,traceback
def grade(source):
    ids=('class','deposit','withdraw','solve','sample','empty', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try:
        tree=ast.parse(source); cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='BankAccount')
        methods={n.name for n in cls.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
        ns={}; exec(compile(tree,'main.py','exec'),ns); Account=ns['BankAccount']; solve=ns.get('solve'); assert callable(solve)
        a=Account('A',10); b=Account('B',2)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    out['class'].update(passed=True,detail='')
    out['deposit'].update(passed='deposit' in methods and a.deposit(5) in (None,15) and a.balance==15,detail='')
    out['withdraw'].update(passed='withdraw' in methods and a.withdraw(4) in (None,11) and a.balance==11 and (a.withdraw(99) is False or a.balance==11),detail='')
    out['solve'].update(passed='BankAccount' in {n.id for n in ast.walk(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='solve')) if isinstance(n,ast.Name)},detail='solve must create and use BankAccount.')
    for k,rows in {'sample':(( [('A',10,[('deposit',5),('withdraw',3)]),('B',2,[('withdraw',8)])], {'A':12,'B':2}),), 'empty':(([],{}),(None,{}))}.items():
        try: ok=all(solve(x)==y for x,y in rows)
        except BaseException: ok=False
        out[k].update(passed=ok,detail='' if ok else 'Return final balances by account name.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for arg, expected in [[[('C', 0, [('deposit', 1)])], {'C': 1}], [[('D', 5, [('withdraw', 5)])], {'D': 0}], [[('E', 3, [('withdraw', 9), ('deposit', 2)])], {'E': 5}], [[('F', 1, []), ('G', 2, [('deposit', 3)])], {'F': 1, 'G': 5}]]:
        try:
            before = copy.deepcopy(arg)
            actual = solve(arg)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif arg != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(arg))
        except BaseException: more_errors.append('solve(' + repr(arg) + ') raised ' + traceback.format_exc(limit=1))
    try:
        x = Account('X', 1); y = Account('Y', 1); x.deposit(5)
        if y.balance != 1 or x.balance != 6: more_errors.append('Each BankAccount must keep its own balance: depositing into one account changed another (or did not update it).')
    except BaseException: more_errors.append(traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
  "classes-objects-project-v1": String.raw`import copy
import ast,json,traceback
def grade(source):
    ids=('class','methods','sample','empty','invalid','uses-class', 'more'); out={i:{'id':i,'name':i,'required':True,'passed':False,'detail':'Submission unavailable.'} for i in ids}
    try:
        tree=ast.parse(source); cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Inventory'); names={n.name for n in cls.body if isinstance(n,ast.FunctionDef)}
        ns={}; exec(compile(tree,'main.py','exec'),ns); solve=ns.get('solve'); assert callable(solve)
    except BaseException: return {'executionOk':False,'tests':list(out.values()),'error':traceback.format_exc()}
    out['class'].update(passed=True,detail=''); out['methods'].update(passed={'add','remove','items'}<=names,detail=''); out['uses-class'].update(passed='Inventory' in {n.id for n in ast.walk(next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='solve')) if isinstance(n,ast.Name)},detail='solve must use Inventory.')
    cases={'sample':(( [('add','tea',3),('add','tea',2),('add','rice',1),('remove','tea',5)], {'rice':1}),), 'empty':(([],{}),(None,{})), 'invalid':(([('remove','tea',10)],{}),)}
    for k,rows in cases.items():
        try: ok=all(solve(x)==y for x,y in rows)
        except BaseException: ok=False
        out[k].update(passed=ok,detail='' if ok else 'Keep positive quantities and remove empty stock.')
    # Extra inputs: every expected value was produced by running the task's reference solution.
    more_errors = []
    for arg, expected in [[[('add', 'x', 2)], {'x': 2}], [[('add', 'x', 2), ('remove', 'x', 1)], {'x': 1}], [[('add', 'x', 1), ('remove', 'x', 1)], {}], [[('add', 'x', 0), ('add', '', 3), ('add', 'y', -1)], {}], [[('add', 'a', 1), ('add', 'b', 2), ('remove', 'b', 3)], {'a': 1, 'b': 2}]]:
        try:
            before = copy.deepcopy(arg)
            actual = solve(arg)
            if type(actual) is not type(expected) or actual != expected: more_errors.append('solve(' + repr(before) + ') should return ' + repr(expected) + ', got ' + repr(actual))
            elif arg != before: more_errors.append('solve changed its input ' + repr(before) + ' to ' + repr(arg))
        except BaseException: more_errors.append('solve(' + repr(arg) + ') raised ' + traceback.format_exc(limit=1))
    try:
        Inv = ns['Inventory']; first = Inv(); second = Inv(); first.add('pen', 2)
        if second.items() != {} or first.items() != {'pen': 2}: more_errors.append('Each Inventory must keep its own stock: adding to one inventory changed another (or did not update it).')
    except BaseException: more_errors.append(traceback.format_exc(limit=1))
    out['more'].update(passed=not more_errors, detail='\n'.join(more_errors)[:800])
    return {'executionOk':True,'tests':list(out.values()),'error':''}
json.dumps(grade(submission_source))`,
};

export const BASICS_2_CATALOG = Object.freeze({
  "functions-first-guided-v1": Object.freeze({ exerciseId: "functions-first-guided", version: "1.0.0", requiredTests: ["helper","sample","empty","default","invalid","more"] }),
  "functions-first-project-v1": Object.freeze({ exerciseId: "functions-first-project", version: "1.0.0", requiredTests: ["helper","sample","empty","invalid","shape","more"] }),
  "dictionaries-guided-v1": Object.freeze({ exerciseId: "dictionaries-guided", version: "1.0.0", requiredTests: ["sample","empty","punctuation","case","shape","more"] }),
  "dictionaries-project-v1": Object.freeze({ exerciseId: "dictionaries-project", version: "1.0.0", requiredTests: ["sample","empty","invalid","keys","shape","more"] }),
  "classes-objects-guided-v1": Object.freeze({ exerciseId: "classes-objects-guided", version: "1.0.0", requiredTests: ["class","deposit","withdraw","solve","sample","empty","more"] }),
  "classes-objects-project-v1": Object.freeze({ exerciseId: "classes-objects-project", version: "1.0.0", requiredTests: ["class","methods","sample","empty","invalid","uses-class","more"] }),
});
