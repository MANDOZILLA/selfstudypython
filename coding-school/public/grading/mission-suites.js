// Inspectable educational checks. As with the CSV suite, not a hostile-code security boundary.
const harness = String.raw`
import ast
import copy
import json
import traceback
from decimal import Decimal as GraderDecimal

def grade(source, fixtures, concepts=False):
    checks = []
    activity, money_values = set(), []
    def check(identifier, passed, detail=''):
        checks.append({'id': identifier, 'name': identifier.replace('-', ' ').capitalize(), 'required': True, 'passed': bool(passed), 'detail': detail})
    def tracked(kind, constructor):
        def call(*args, **kwargs):
            value = constructor(*args, **kwargs)
            if args and isinstance(args[0], str):
                activity.add(kind)
                if kind == 'concept-decimal' and isinstance(value, GraderDecimal) and value.is_finite():
                    money_values.append(value)
            return value
        return call
    try:
        tree = ast.parse(source)
        aliases = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for item in node.names: aliases[item.asname or item.name] = item.name
            elif isinstance(node, ast.ImportFrom):
                for item in node.names: aliases[item.asname or item.name] = (node.module or '') + '.' + item.name
        def target(node):
            if isinstance(node, ast.Name): return aliases.get(node.id, node.id)
            if isinstance(node, ast.Attribute): return target(node.value) + '.' + node.attr
            return ''
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        def used(node):
            parent = parents.get(node)
            if isinstance(parent, ast.Expr): return False
            if isinstance(parent, (ast.Assign, ast.AnnAssign)):
                targets = parent.targets if isinstance(parent, ast.Assign) else [parent.target]
                names = {item.id for root in targets for item in ast.walk(root) if isinstance(item, ast.Name)}
                scope = parent
                while scope in parents and not isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    scope = parents[scope]
                return any(isinstance(item, ast.Name) and isinstance(item.ctx, ast.Load) and item.id in names for item in ast.walk(scope))
            return True
        class Calls(ast.NodeTransformer):
            def visit_Call(self, node):
                kind = {'json.loads':'concept-json', 'decimal.Decimal':'concept-decimal'}.get(target(node.func))
                consumed = used(node)
                variable_arg = node.args and any(isinstance(item, (ast.Name, ast.Subscript)) for item in ast.walk(node.args[0]))
                self.generic_visit(node)
                if kind and consumed and variable_arg:
                    node.func = ast.Call(func=ast.Name(id='__grade_track__', ctx=ast.Load()), args=[ast.Constant(kind), node.func], keywords=[])
                return node
        if concepts:
            tree = ast.fix_missing_locations(Calls().visit(tree))
            check('concept-json', False)
            check('concept-decimal', False)
        namespace = {'__name__':'__submission__', '__grade_track__':tracked}
        exec(compile(tree, 'main.py', 'exec'), namespace)
        solve = namespace.get('solve')
        if not callable(solve): raise ValueError('Define solve with one input argument.')
    except BaseException:
        return {'executionOk':False, 'tests':checks, 'error':traceback.format_exc()}
    execution_ok, decimal_covered, saw_outputs = True, True, False
    for identifier, cases in fixtures:
        errors = []
        for value, expected in cases:
            try:
                money_values.clear()
                before = copy.deepcopy(value)
                actual = solve(value)
                # JSON serialization equality is insufficient: Python True == 1.
                def exact(a, b):
                    if type(a) is not type(b): return False
                    if type(b) is list: return len(a) == len(b) and all(exact(x,y) for x,y in zip(a,b))
                    if type(b) is dict: return a.keys() == b.keys() and all(exact(a[k],b[k]) for k in b)
                    return a == b
                if not exact(actual, expected) or value != before:
                    errors.append('Expected ' + repr(expected) + '; received ' + repr(actual)[:400] + ' (input must remain unchanged)')
                if concepts and expected:
                    saw_outputs = True
                    remaining = list(money_values)
                    for row in expected:
                        money = GraderDecimal(row['amount'])
                        if money in remaining: remaining.remove(money)
                        else: decimal_covered = False
            except BaseException:
                execution_ok = False
                errors.append(traceback.format_exc())
        check(identifier, not errors, '\n'.join(errors))
    if concepts:
        for item in checks[:2]:
            item['passed'] = item['id'] in activity
            if item['id'] == 'concept-decimal': item['passed'] = item['passed'] and decimal_covered and saw_outputs
            if not item['passed']: item['detail'] = 'Call and use the required parser on the executed path. Each accepted amount must have a matching Decimal conversion from text in that solve invocation.'
    return {'executionOk':execution_ok, 'tests':checks, 'error':''}
`;

export const contactsSuite = harness + String.raw`
fixtures = [
 ('sample', [([{'email':' A@EXAMPLE.COM '}, {'email':'b@site'}, None], ['a@example.com','b@site'])]),
 ('empty', [([],[]), (None,[]), ({},[]), ('text',[])]),
 ('invalid', [([None, 1, [], {}, {'email':None}, {'email':True}, {'email':2}, {'email':'@x'}, {'email':'x@'}, {'email':'a@@b'}, {'email':'a b@c'}, {'email':'a@b\tc'}, {'email':'ok@site'}], ['ok@site'])]),
 ('duplicates', [([{'email':'bad'}, {'email':' A@B '}, {'email':'a@b'}, {'email':'B@C'}, {'email':'b@c'}], ['a@b','b@c'])]),
 ('shape', [([{'email':' x@y ', 'ignored':42}], ['x@y'])]),
]
json.dumps(grade(submission_source, fixtures))
`;
export const inventorySuite = harness + String.raw`
fixtures = [
 ('sample', [([{'sku':' A ', 'quantity':2},{'sku':'B','quantity':0}], [{'sku':'A','quantity':2},{'sku':'B','quantity':0}])]),
 ('empty', [([],[]), (None,[]), ({},[]), ('text',[])]),
 ('invalid', [([None, 1, [], {}, {'sku':None,'quantity':1}, {'sku':' ','quantity':1}, {'sku':'a','quantity':True}, {'sku':'b','quantity':False}, {'sku':'c','quantity':1.0}, {'sku':'d','quantity':'2'}, {'sku':'e','quantity':-1}, {'sku':'f'}, {'sku':'ok','quantity':4}], [{'sku':'ok','quantity':4}])]),
 ('duplicates', [([{'sku':'A','quantity':-1},{'sku':' A ','quantity':3},{'sku':'A','quantity':9},{'sku':'a','quantity':1}], [{'sku':'A','quantity':3},{'sku':'a','quantity':1}])]),
 ('shape', [([{'sku':' C ','quantity':5,'ignored':42}], [{'sku':'C','quantity':5}])]),
]
json.dumps(grade(submission_source, fixtures))
`;
export const apiSuite = harness + String.raw`
def payment(identifier, amount, currency='USD'):
    return {'id':identifier,'money':{'amount':amount,'currency':currency}}
def output(identifier, amount, currency='USD'):
    return {'id':identifier,'amount':amount,'currency':currency}
def envelope(rows): return json.dumps({'payments':rows})
fixtures = [
 ('sample', [(envelope([payment(' p1 ','0.10',' eur '),payment('p2','12')]), [output('p1','0.10','EUR'),output('p2','12.00')])]),
 ('empty', [('',[]), (envelope([]),[])]),
 ('envelope', [(text,[]) for text in ['null','[]','1','true','"hello"','{}','{"payments":null}','{"payments":{}}','{"payments":"text"}']]),
 ('malformed', [(text,[]) for text in ['{','not json','{"payments":[}','{"payments":[]} trailing']]),
 ('types', [(envelope([None,1,True,[],{}, {'id':2,'money':{'amount':'2','currency':'USD'}},{'id':'x','money':None},payment('a',2),payment('b',True),payment('c',None),payment('d','2',None),payment('e','2',12)]),[])]),
 ('mixed', [(envelope([payment('a','2'),None,{'id':'x'},payment('b','3','GBP')]),[output('a','2.00'),output('b','3.00','GBP')])]),
 ('precision', [(envelope([payment('a','0.10'),payment('b','0.20'),payment('c','12.345'),payment('d','-0.00'),payment('e','90071992547409.91'),payment('f','90071992547409.915'),payment('g','12345678901234567890123456.78')]), [output('a','0.10'),output('b','0.20'),output('d','0.00'),output('e','90071992547409.91'),output('g','12345678901234567890123456.78')])]),
 ('invalid', [(envelope([payment('a','NaN'),payment('b','Infinity'),payment('c','-1'),payment('d','bad'),payment('e',''),payment(' ','2'),payment('f','2','JPY'),payment('g','1e99'),payment('ok',' 2.0 ','gbp')]), [output('ok','2.00','GBP')])]),
 ('duplicates', [(envelope([payment('x','bad'),payment('x','2'),payment(' x ','3'),payment('X','4')]),[output('x','2.00'),output('X','4.00')])]),
 ('shape', [(json.dumps({'ignored':1,'payments':[{'id':'a','ignored':2,'money':{'amount':'2','currency':'USD','ignored':3}}]}),[output('a','2.00')])]),
]
json.dumps(grade(submission_source, fixtures, True))
`;
export const csvTagsSuite = harness + String.raw`
fixtures = [
 ('sample', [('id,tag\n a , red \na,blue\n', [{'id':'a','tag':'red'},{'id':'a','tag':'blue'}])]),
 ('empty', [('',[]), ('id,tag\n',[])]),
 ('header', [('tag,id\nred,a\n',[]), ('id,label\na,red\n',[])]),
 ('quoted', [('id,tag\n"a,b","two\nlines"\n', [{'id':'a,b','tag':'two\nlines'}])]),
 ('invalid', [('id,tag\na,\n,red\nb,red,extra\nc\nok, blue \n', [{'id':'ok','tag':'blue'}])]),
]
json.dumps(grade(submission_source, fixtures))
`;
export const invoiceCentsSuite = harness + String.raw`
fixtures = [
 ('sample', [(' 12.30 ',1230), ('0',0), ('-0.00',0), ('2E1',2000)]),
 ('precision', [('0.10',10), ('12.345',None), ('90071992547409.91',9007199254740991), ('90071992547409.915',None), ('12345678901234567890123456.78',1234567890123456789012345678)]),
 ('invalid', [(value,None) for value in ['', ' ', 'bad', 'NaN', 'Infinity', '-1', '1e99', None, True, 2, 1.5, [], {}]]),
]
json.dumps(grade(submission_source, fixtures))
`;
export const webhookEventsSuite = harness + String.raw`
fixtures = [
 ('sample', [('{"events":[{"id":" a "},{"id":"B","extra":1}]}',['a','B'])]),
 ('empty', [('{"events":[]}',[])]),
 ('envelope', [(text,[]) for text in ['{','not json','null','[]','{}','{"events":null}','{"events":{}}','{"events":"hello"}']]),
 ('invalid', [('{"events":[null,1,true,[],{},{"id":null},{"id":2},{"id":true},{"id":" "},{"id":"ok"}]}',['ok'])]),
 ('duplicates', [('{"events":[{"id":" a "},{"id":"a"},{"id":"A"},{"id":"b"}]}',['a','A','b'])]),
]
json.dumps(grade(submission_source, fixtures))
`;
